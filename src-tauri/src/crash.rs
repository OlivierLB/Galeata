//! Bounded structured reports; panic payloads and private paths are never captured.
use serde::{Deserialize, Serialize};
use std::{
    backtrace::Backtrace,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
const MAX_REPORT: u64 = 32 * 1024;
static RUNTIME: OnceLock<Mutex<Runtime>> = OnceLock::new();

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    schema: u8,
    report_id: String,
    version: String,
    build: String,
    platform: String,
    arch: String,
    kernel: String,
    display: String,
    started_at_ms: u64,
    observed_at_ms: u64,
    uptime_seconds: u64,
    memory_kib: Option<u64>,
    reason: String,
    panic: Option<PanicDetails>,
    events: Vec<TechnicalEvent>,
}
#[derive(Clone, Serialize, Deserialize)]
struct PanicDetails {
    kind: String,
    source: Option<String>,
    line: Option<u32>,
    column: Option<u32>,
    frames: Vec<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TechnicalEvent {
    at_ms: u64,
    operation: String,
    elapsed_ms: u64,
    ok: bool,
    code: String,
}
#[derive(Serialize, Deserialize)]
struct Marker {
    identity: String,
    report: Report,
}
struct Runtime {
    marker: PathBuf,
    started: Instant,
    active: bool,
    report: Report,
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
// This identity never leaves the local marker. PID alone can be reused after reboot.
fn process_identity(pid: u32) -> Option<String> {
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let start = stat.rsplit_once(')')?.1.split_whitespace().nth(19)?;
    let boot = fs::read_to_string("/proc/sys/kernel/random/boot_id").ok()?;
    Some(format!("{}:{start}", boot.trim()))
}
fn memory_kib() -> Option<u64> {
    fs::read_to_string("/proc/self/status")
        .ok()?
        .lines()
        .find(|line| line.starts_with("VmRSS:"))?
        .split_whitespace()
        .nth(1)?
        .parse()
        .ok()
}
fn new_report() -> Report {
    let kernel = fs::read_to_string("/proc/sys/kernel/osrelease")
        .unwrap_or_default()
        .trim()
        .split('-')
        .next()
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .take(32)
        .collect();
    Report {
        schema: 2,
        report_id: uuid::Uuid::new_v4().to_string(),
        version: env!("CARGO_PKG_VERSION").into(),
        build: env!("GALEATA_BUILD_REVISION").into(),
        platform: "linux".into(),
        arch: std::env::consts::ARCH.into(),
        kernel,
        display: if std::env::var_os("WAYLAND_DISPLAY").is_some() {
            "wayland"
        } else if std::env::var_os("DISPLAY").is_some() {
            "x11"
        } else {
            "unknown"
        }
        .into(),
        started_at_ms: now_ms(),
        observed_at_ms: now_ms(),
        uptime_seconds: 0,
        memory_kib: memory_kib(),
        reason: "abnormal_exit".into(),
        panic: None,
        events: Vec::new(),
    }
}
fn refresh(runtime: &mut Runtime) {
    runtime.report.observed_at_ms = now_ms();
    runtime.report.uptime_seconds = runtime.started.elapsed().as_secs();
    runtime.report.memory_kib = memory_kib();
    let marker = Marker {
        identity: process_identity(std::process::id()).unwrap_or_default(),
        report: runtime.report.clone(),
    };
    if let Ok(bytes) = serde_json::to_vec(&marker) {
        let _ = crate::atomic_file::replace(&runtime.marker, &bytes, || Ok(()));
    }
}
pub fn record_event(operation: &str, elapsed: u128, ok: bool, code: &str) {
    let Some(runtime) = RUNTIME.get() else {
        return;
    };
    let Ok(mut runtime) = runtime.try_lock() else {
        return;
    };
    if !runtime.active {
        return;
    }
    let event = TechnicalEvent {
        at_ms: now_ms(),
        operation: operation.into(),
        elapsed_ms: elapsed.min(u64::MAX as u128) as u64,
        ok,
        code: code.into(),
    };
    if runtime.report.events.len() == 32 {
        runtime.report.events.remove(0);
    }
    runtime.report.events.push(event);
    if !ok {
        refresh(&mut runtime);
    }
}
fn source_location(file: &str) -> Option<String> {
    let relative = file.rsplit("/src-tauri/").next().unwrap_or(file);
    if !(relative.starts_with("src/") || relative.starts_with("crates/"))
        || relative.len() > 160
        || relative.contains("..")
        || !relative.ends_with(".rs")
    {
        return None;
    }
    relative
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "_-/.".contains(c))
        .then(|| relative.to_owned())
}
fn galeata_frames(trace: &str) -> Vec<String> {
    trace
        .lines()
        .filter_map(|line| {
            let symbol = line.trim().split_once(": ")?.1;
            ((symbol.starts_with("galeata_lib::")
                || symbol.starts_with("galeata_agent_protocol::"))
                && symbol.len() <= 240
                && symbol
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "_:<> ,{}$.-".contains(c)))
            .then(|| symbol.to_owned())
        })
        .take(32)
        .collect()
}
pub fn capture_panic(info: &std::panic::PanicHookInfo<'_>) {
    let frames = galeata_frames(&Backtrace::force_capture().to_string());
    let Some(runtime) = RUNTIME.get() else {
        return;
    };
    let Ok(mut runtime) = runtime.try_lock() else {
        return;
    };
    if !runtime.active {
        return;
    }
    let location = info.location();
    let payload = info
        .payload()
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| info.payload().downcast_ref::<String>().map(String::as_str))
        .unwrap_or("");
    let kind = if payload.starts_with("assertion") {
        "assertion"
    } else if payload.starts_with("called `Option::unwrap()")
        || payload.starts_with("called `Result::unwrap()")
    {
        "unwrap"
    } else if payload.starts_with("index out of bounds") {
        "bounds"
    } else if payload.starts_with("attempt to") && payload.contains("overflow") {
        "overflow"
    } else {
        "other"
    };
    runtime.report.reason = "rust_panic".into();
    runtime.report.panic = Some(PanicDetails {
        kind: kind.into(),
        source: location.and_then(|location| source_location(location.file())),
        line: location.map(|location| location.line()),
        column: location.map(|location| location.column()),
        frames,
    });
    refresh(&mut runtime);
}
fn read_marker(path: &Path) -> Option<Marker> {
    if fs::metadata(path).ok()?.len() > MAX_REPORT {
        return None;
    }
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}
fn read_report(path: &Path) -> Option<Report> {
    if fs::metadata(path).ok()?.len() > MAX_REPORT {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    if let Ok(report) = serde_json::from_slice::<Report>(&bytes) {
        return Some(report);
    }
    let legacy: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let version = legacy["version"].as_str()?;
    if legacy["platform"] != "linux"
        || legacy["reason"] != "abnormal_exit"
        || version.len() > 64
        || !version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-+".contains(c))
    {
        return None;
    }
    let mut report = new_report();
    report.version = version.into();
    report.build = "unknown".into();
    report.kernel.clear();
    report.display = "unknown".into();
    report.started_at_ms = 0;
    report.observed_at_ms = 0;
    report.memory_kib = None;
    Some(report)
}
fn recover(directory: &Path) {
    let mut pending: Vec<_> = fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("pending-"))
        .collect();
    pending
        .sort_by_key(|entry| std::cmp::Reverse(entry.metadata().and_then(|m| m.modified()).ok()));
    let mut count = pending.len().min(16);
    for entry in pending.into_iter().skip(16) {
        let _ = fs::remove_file(entry.path());
    }
    for entry in fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .take(128)
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(pid) = name
            .strip_prefix("running-")
            .and_then(|s| s.strip_suffix(".json"))
            .and_then(|s| s.parse::<u32>().ok())
        else {
            continue;
        };
        let marker = read_marker(&entry.path());
        let live = process_identity(pid);
        if live.is_some()
            && marker
                .as_ref()
                .is_none_or(|marker| Some(&marker.identity) == live.as_ref())
        {
            continue;
        }
        if count < 16 {
            let report = marker
                .map(|marker| marker.report)
                .or_else(|| read_report(&entry.path()))
                .unwrap_or_else(new_report);
            let target = directory.join(format!("pending-{}.json", report.report_id));
            if fs::write(target, serde_json::to_vec(&report).unwrap_or_default()).is_ok() {
                count += 1;
            }
        }
        let _ = fs::remove_file(entry.path());
    }
}
fn transmit(directory: &Path, endpoint: &str) {
    let client = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(10))
        .redirects(0)
        .build();
    for entry in fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .take(128)
    {
        if !entry.file_name().to_string_lossy().starts_with("pending-")
            || !entry.metadata().is_ok_and(|m| m.len() <= MAX_REPORT)
        {
            continue;
        }
        let Some(report) = read_report(&entry.path()) else {
            continue;
        };
        if client.post(endpoint).send_json(&report).is_ok() {
            let _ = fs::remove_file(entry.path());
        }
    }
}
pub fn start(directory: &Path) {
    let directory = directory.join("crashes");
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    recover(&directory);
    let marker = directory.join(format!("running-{}.json", std::process::id()));
    if fs::write(&marker, b"{}").is_err() {
        return;
    }
    let mut runtime = Runtime {
        marker,
        started: Instant::now(),
        active: true,
        report: new_report(),
    };
    refresh(&mut runtime);
    if RUNTIME.set(Mutex::new(runtime)).is_err() {
        return;
    }
    if let Some(endpoint) =
        option_env!("GALEATA_CRASH_ENDPOINT").filter(|url| url.starts_with("https://"))
    {
        std::thread::spawn(move || transmit(&directory, endpoint));
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(15));
        let Some(runtime) = RUNTIME.get() else {
            return;
        };
        let Ok(mut runtime) = runtime.lock() else {
            return;
        };
        if !runtime.active {
            return;
        }
        refresh(&mut runtime);
    });
}
pub fn clean_exit() {
    let Some(runtime) = RUNTIME.get() else {
        return;
    };
    let Ok(mut runtime) = runtime.lock() else {
        return;
    };
    runtime.active = false;
    if runtime.report.reason == "rust_panic" {
        if let Some(directory) = runtime.marker.parent() {
            let _ = fs::write(
                directory.join(format!("pending-{}.json", runtime.report.report_id)),
                serde_json::to_vec(&runtime.report).unwrap_or_default(),
            );
        }
    }
    let _ = fs::remove_file(&runtime.marker);
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_transmission_retains_report_until_acknowledgement() {
        use std::io::{BufRead, Read, Write};
        let directory = tempfile::tempdir().unwrap();
        let report = new_report();
        let pending = directory.path().join("pending-test.json");
        fs::write(&pending, serde_json::to_vec(&report).unwrap()).unwrap();
        for status in [503, 204] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let endpoint = format!("http://{}/crashes", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    if let Ok((stream, _)) = listener.accept() {
                        break stream;
                    }
                    assert!(Instant::now() < deadline);
                    std::thread::sleep(Duration::from_millis(5));
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut reader = std::io::BufReader::new(stream.try_clone().unwrap());
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse::<usize>().unwrap();
                    }
                }
                assert!(length > 0 && length <= MAX_REPORT as usize);
                let mut bytes = vec![0; length];
                reader.read_exact(&mut bytes).unwrap();
                let data: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(data["schema"], 2);
                assert!(data.get("identity").is_none());
                write!(
                    stream,
                    "HTTP/1.1 {status} Test\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                )
                .unwrap();
            });
            transmit(directory.path(), &endpoint);
            server.join().unwrap();
            assert_eq!(pending.exists(), status != 204);
        }
    }
    #[test]
    fn legacy_pending_reports_keep_the_original_version_without_inventing_runtime_details() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("pending-legacy.json");
        fs::write(
            &path,
            r#"{"version":"0.0.9","platform":"linux","reason":"abnormal_exit","secret":"private"}"#,
        )
        .unwrap();
        let report = read_report(&path).unwrap();
        assert_eq!(report.version, "0.0.9");
        assert_eq!(report.build, "unknown");
        assert_eq!(report.started_at_ms, 0);
        assert!(!serde_json::to_string(&report).unwrap().contains("private"));
    }
    #[test]
    fn child_panic_fixture() {
        let Some(directory) = std::env::var_os("GALEATA_CRASH_TEST_DIRECTORY") else {
            return;
        };
        start(Path::new(&directory));
        std::panic::set_hook(Box::new(capture_panic));
        record_event("workspace.read", 25, false, "UNCLASSIFIED");
        panic!("private conversation /home/private/password token=secret");
    }
    #[test]
    fn real_panic_is_persisted_without_payload_and_recovered_on_next_launch() {
        let directory = tempfile::tempdir().unwrap();
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "crash::tests::child_panic_fixture"])
            .env("GALEATA_CRASH_TEST_DIRECTORY", directory.path())
            .output()
            .unwrap();
        assert!(!result.status.success());
        let reports = directory.path().join("crashes");
        recover(&reports);
        let report = fs::read_dir(reports)
            .unwrap()
            .flatten()
            .find(|entry| entry.file_name().to_string_lossy().starts_with("pending-"))
            .unwrap();
        let text = fs::read_to_string(report.path()).unwrap();
        assert!(!text.contains("private"));
        assert!(!text.contains("secret"));
        let report: Report = serde_json::from_str(&text).unwrap();
        assert_eq!(report.reason, "rust_panic");
        assert_eq!(report.events.last().unwrap().operation, "workspace.read");
        assert!(report.panic.unwrap().source.unwrap().ends_with("crash.rs"));
    }
    #[test]
    fn private_paths_and_payloads_are_not_stack_frames() {
        assert_eq!(
            source_location("/private/user/src-tauri/src/lib.rs"),
            Some("src/lib.rs".into())
        );
        assert_eq!(source_location("/private/project/password.rs"), None);
        assert_eq!(galeata_frames("0: galeata_lib::crash::start\n at /private/user/file.rs:12\n1: password=secret\n2: std::panicking::begin"), vec!["galeata_lib::crash::start"]);
    }
    #[test]
    fn recovery_distinguishes_live_processes_and_reused_pids() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory
            .path()
            .join(format!("running-{}.json", std::process::id()));
        let marker = Marker {
            identity: process_identity(std::process::id()).unwrap(),
            report: new_report(),
        };
        fs::write(&path, serde_json::to_vec(&marker).unwrap()).unwrap();
        recover(directory.path());
        assert!(path.exists());
        let marker = Marker {
            identity: "previous-boot".into(),
            ..marker
        };
        fs::write(&path, serde_json::to_vec(&marker).unwrap()).unwrap();
        recover(directory.path());
        assert!(!path.exists());
        let text = fs::read_to_string(
            directory
                .path()
                .join(format!("pending-{}.json", marker.report.report_id)),
        )
        .unwrap();
        assert!(!text.contains("previous-boot"));
        assert!(serde_json::from_str::<Report>(&text).is_ok());
    }
}
