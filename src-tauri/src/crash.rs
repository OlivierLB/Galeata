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
    /// Fatal signal name (schema 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    signal: Option<String>,
    /// WebKit web process termination: `crashed` or `memory_limit` (schema 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    webview: Option<String>,
    /// Structured GTK/GLib error read back from the dead process' journal (schema 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    native: Option<NativeError>,
}
/// Only identifiers survive: domain, C source location, library file names and hints.
#[derive(Clone, Default, Debug, PartialEq, Serialize, Deserialize)]
struct NativeError {
    domain: Option<String>,
    level: Option<String>,
    source: Option<String>,
    line: Option<u32>,
    function: Option<String>,
    libraries: Vec<String>,
    hints: Vec<String>,
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
        schema: 3,
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
        signal: None,
        webview: None,
        native: None,
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
        let signal = signals::read(directory, pid);
        if signal.is_some_and(signals::is_termination) {
            // A requested stop (logout, kill, Ctrl+C) is not a crash: keep it local only.
            if let Some(mut report) = marker.map(|marker| marker.report) {
                report.signal = signal.map(|signal| signals::name(signal).into());
                report.reason = "terminated".into();
                let _ = fs::write(
                    directory.join(format!("local-{}.json", report.report_id)),
                    serde_json::to_vec(&report).unwrap_or_default(),
                );
            }
        } else if count < 16 {
            let mut report = marker
                .map(|marker| marker.report)
                .or_else(|| read_report(&entry.path()))
                .unwrap_or_else(new_report);
            if report.reason == "abnormal_exit" {
                if let Some(signal) = signal {
                    report.reason = "fatal_signal".into();
                    report.signal = Some(signals::name(signal).into());
                }
            }
            if report.reason != "rust_panic" && report.started_at_ms > 0 {
                report.native = journal_native(pid, report.started_at_ms, report.observed_at_ms);
            }
            let target = directory.join(format!("pending-{}.json", report.report_id));
            if fs::write(target, serde_json::to_vec(&report).unwrap_or_default()).is_ok() {
                count += 1;
            }
        }
        let _ = fs::remove_file(entry.path());
        let _ = fs::remove_file(signals::path(directory, pid));
    }
    prune(directory, "local-", 8);
    // Signal files whose process is gone and had no marker.
    for entry in fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .take(128)
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(pid) = name
            .strip_prefix("signal-")
            .and_then(|s| s.parse::<u32>().ok())
        {
            if process_identity(pid).is_none() {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}
fn prune(directory: &Path, prefix: &str, keep: usize) {
    let mut files: Vec<_> = fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(prefix))
        .collect();
    files.sort_by_key(|entry| std::cmp::Reverse(entry.metadata().and_then(|m| m.modified()).ok()));
    for entry in files.into_iter().skip(keep) {
        let _ = fs::remove_file(entry.path());
    }
}
/// Reads the dead process' own journal lines (GTK writes its fatal errors to
/// stderr, which the desktop session forwards to the user journal).
fn journal_native(pid: u32, started_at_ms: u64, observed_at_ms: u64) -> Option<NativeError> {
    let pid = format!("_PID={pid}");
    let since = format!("--since=@{}", started_at_ms / 1000);
    let until = format!("--until=@{}", observed_at_ms / 1000 + 30);
    let (output, _, _) = crate::workspace::run_outcome(
        Path::new("/"),
        "journalctl",
        &[
            "--user",
            "--quiet",
            "--no-pager",
            "--output=cat",
            "--lines=200",
            &since,
            &until,
            &pid,
        ],
        &[0, 1],
        Duration::from_secs(3),
        256 * 1024,
    )
    .ok()?;
    parse_native(&output)
}
fn identifier(value: &str, extra: &str, limit: usize) -> Option<String> {
    (!value.is_empty()
        && value.len() <= limit
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || extra.contains(c)))
    .then(|| value.to_owned())
}
fn libraries(line: &str, found: &mut Vec<String>) {
    for (start, _) in line.match_indices("lib") {
        if start > 0 && line[..start].ends_with(|c: char| c.is_ascii_alphanumeric() || c == '_') {
            continue;
        }
        let rest = &line[start..];
        let Some(end) = rest.find(".so") else {
            continue;
        };
        let mut name = rest[..end + 3].to_owned();
        let mut tail = rest[end + 3..].chars().peekable();
        while tail.peek() == Some(&'.') {
            let version: String = tail
                .clone()
                .skip(1)
                .take_while(char::is_ascii_digit)
                .collect();
            if version.is_empty() {
                break;
            }
            name.push('.');
            name.push_str(&version);
            tail.nth(version.len());
        }
        if identifier(&name, "+-.", 80).is_some()
            && name[3..end]
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "_+-".contains(c))
            && !found.contains(&name)
            && found.len() < 8
        {
            found.push(name);
        }
    }
}
fn parse_native(journal: &str) -> Option<NativeError> {
    let mut best: Option<(u8, NativeError)> = None;
    let mut libs = Vec::new();
    let mut hints: Vec<&str> = Vec::new();
    let mut hint = |value: &'static str| {
        if !hints.contains(&value) {
            hints.push(value);
        }
    };
    for raw in journal.lines().take(400) {
        let line = raw.trim().trim_start_matches("Bail out! ");
        if line.contains(".so") {
            libraries(line, &mut libs);
            let lower = line.to_lowercase();
            if [
                "no such file",
                "aucun fichier",
                "cannot open",
                "ne peut ouvrir",
            ]
            .iter()
            .any(|s| lower.contains(s))
            {
                hint("missing_library");
            }
        }
        if line.contains("Error reading events from display") || line.contains("X connection to") {
            hint("x_io_error");
        }
        if line.contains("X Window System error") {
            hint("x_protocol_error");
        }
        if line.contains("Wayland compositor") || line.contains("dispatching to Wayland display") {
            hint("wayland_disconnected");
        }
        // `Domain:ERROR:file.c:123:function: message` (g_assert family).
        let parts: Vec<&str> = line.splitn(6, ':').collect();
        let mut candidate = None;
        if parts.len() >= 5
            && matches!(parts[1], "ERROR" | "CRITICAL")
            && parts[3].parse::<u32>().is_ok()
        {
            let source = parts[2].trim_start_matches("../").trim_start_matches("./");
            candidate = Some((
                if parts[1] == "ERROR" { 3 } else { 2 },
                NativeError {
                    domain: identifier(parts[0], "-", 40),
                    level: Some(parts[1].into()),
                    source: identifier(source, "./-", 120).filter(|s| {
                        !s.contains("..")
                            && [".c", ".cpp", ".cc", ".h"].iter().any(|e| s.ends_with(e))
                    }),
                    line: parts[3].parse().ok(),
                    function: identifier(parts[4].trim(), "", 80),
                    ..NativeError::default()
                },
            ));
            if candidate.as_ref().is_some_and(|(_, e)| {
                e.domain
                    .as_deref()
                    .is_some_and(|d| d.starts_with("Gtk") || d.starts_with("Gdk"))
            }) {
                hint("gtk_assertion");
            }
        } else if let Some(position) = ["-ERROR **", "-CRITICAL **"]
            .iter()
            .find_map(|m| line.find(m).map(|p| (p, *m)))
        {
            // `(prog:pid): Domain-CRITICAL **: time: function: message` (g_log family).
            let (at, marker) = position;
            let domain = line[..at].rsplit([' ', ')']).next().unwrap_or("");
            let message = line[at + marker.len()..].trim_start_matches(':').trim();
            let message = message.split_once(": ").map_or(message, |(time, rest)| {
                if time
                    .chars()
                    .all(|c| c.is_ascii_digit() || c == ':' || c == '.')
                {
                    rest
                } else {
                    message
                }
            });
            let function = message
                .split_once(':')
                .map(|(f, _)| f.trim())
                .and_then(|f| identifier(f, "", 80));
            let level = if marker.starts_with("-ERROR") {
                "ERROR"
            } else {
                "CRITICAL"
            };
            candidate = Some((
                if level == "ERROR" { 3 } else { 2 },
                NativeError {
                    domain: identifier(domain, "-", 40),
                    level: Some(level.into()),
                    function,
                    ..NativeError::default()
                },
            ));
        }
        if let Some((rank, error)) = candidate {
            if best.as_ref().is_none_or(|(current, _)| rank >= *current) {
                best = Some((rank, error));
            }
        }
    }
    let hints: Vec<String> = hints.into_iter().take(5).map(String::from).collect();
    if best.is_none() && libs.is_empty() && hints.is_empty() {
        return None;
    }
    let mut error = best.map(|(_, error)| error).unwrap_or_default();
    error.libraries = libs;
    error.hints = hints;
    Some(error)
}
/// Async-signal-safe recording of the signal that kills the process: one byte
/// written to a file opened beforehand, then the previous disposition runs.
mod signals {
    use nix::libc::{self, c_int, c_void};
    use std::{
        os::fd::IntoRawFd,
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicI32, Ordering},
            OnceLock,
        },
    };
    const WATCHED: [c_int; 9] = [
        libc::SIGSEGV,
        libc::SIGABRT,
        libc::SIGBUS,
        libc::SIGILL,
        libc::SIGFPE,
        libc::SIGQUIT,
        libc::SIGTERM,
        libc::SIGHUP,
        libc::SIGINT,
    ];
    static FD: AtomicI32 = AtomicI32::new(-1);
    static PREVIOUS: OnceLock<[(c_int, libc::sigaction); 9]> = OnceLock::new();

    pub fn path(directory: &Path, pid: u32) -> PathBuf {
        directory.join(format!("signal-{pid}"))
    }
    pub fn name(signal: c_int) -> &'static str {
        match signal {
            libc::SIGSEGV => "SIGSEGV",
            libc::SIGABRT => "SIGABRT",
            libc::SIGBUS => "SIGBUS",
            libc::SIGILL => "SIGILL",
            libc::SIGFPE => "SIGFPE",
            libc::SIGQUIT => "SIGQUIT",
            libc::SIGTERM => "SIGTERM",
            libc::SIGHUP => "SIGHUP",
            _ => "SIGINT",
        }
    }
    pub fn is_termination(signal: c_int) -> bool {
        matches!(signal, libc::SIGTERM | libc::SIGHUP | libc::SIGINT)
    }
    pub fn read(directory: &Path, pid: u32) -> Option<c_int> {
        let byte = *std::fs::read(path(directory, pid)).ok()?.first()?;
        WATCHED
            .contains(&c_int::from(byte))
            .then_some(c_int::from(byte))
    }
    extern "C" fn on_signal(signal: c_int, info: *mut libc::siginfo_t, _: *mut c_void) {
        let fd = FD.load(Ordering::Relaxed);
        if fd >= 0 {
            let byte = signal as u8;
            // SAFETY: pwrite and sigaction are async-signal-safe; no allocation or lock.
            unsafe { libc::pwrite(fd, (&byte as *const u8).cast(), 1, 0) };
        }
        let previous = PREVIOUS
            .get()
            .and_then(|all| all.iter().find(|(s, _)| *s == signal).map(|(_, a)| *a));
        unsafe {
            match previous {
                Some(action) => libc::sigaction(signal, &action, std::ptr::null_mut()),
                None => {
                    libc::signal(signal, libc::SIG_DFL);
                    0
                }
            };
            // A hardware fault repeats on return and reaches the previous handler;
            // a signal sent by a process (kill, abort) must be raised again.
            if info.is_null() || (*info).si_code <= 0 {
                libc::raise(signal);
            }
        }
    }
    pub fn install(directory: &Path) {
        let Ok(file) = std::fs::File::create(path(directory, std::process::id())) else {
            return;
        };
        FD.store(file.into_raw_fd(), Ordering::Relaxed);
        // SAFETY: plain libc calls on zero-initialised sigaction structures.
        unsafe {
            let mut action: libc::sigaction = std::mem::zeroed();
            action.sa_sigaction = on_signal as *const () as usize;
            action.sa_flags = libc::SA_SIGINFO | libc::SA_ONSTACK;
            libc::sigemptyset(&mut action.sa_mask);
            let mut previous: [(c_int, libc::sigaction); 9] = std::mem::zeroed();
            for (slot, signal) in previous.iter_mut().zip(WATCHED) {
                slot.0 = signal;
                libc::sigaction(signal, &action, &mut slot.1);
            }
            let _ = PREVIOUS.set(previous);
        }
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
        if client
            .post(endpoint)
            .set(
                "User-Agent",
                concat!(
                    "Galeata/",
                    env!("CARGO_PKG_VERSION"),
                    " (+https://github.com/OlivierLB/Galeata)"
                ),
            )
            .send_json(&report)
            .is_ok()
        {
            let _ = fs::remove_file(entry.path());
        }
    }
}
fn endpoint() -> Option<&'static str> {
    option_env!("GALEATA_CRASH_ENDPOINT").filter(|url| url.starts_with("https://"))
}
/// The WebKit web process died while the window survived (blank page): report
/// it immediately instead of waiting for the next launch.
pub fn webview_terminated(memory_limit: bool) {
    static REPORTED: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
    if REPORTED.fetch_add(1, std::sync::atomic::Ordering::Relaxed) >= 3 {
        return;
    }
    let Some(runtime) = RUNTIME.get() else {
        return;
    };
    let Ok(mut runtime) = runtime.lock() else {
        return;
    };
    refresh(&mut runtime);
    let mut report = runtime.report.clone();
    report.report_id = uuid::Uuid::new_v4().to_string();
    report.reason = "webview_crash".into();
    report.webview = Some(
        if memory_limit {
            "memory_limit"
        } else {
            "crashed"
        }
        .into(),
    );
    report.panic = None;
    let Some(directory) = runtime.marker.parent().map(Path::to_path_buf) else {
        return;
    };
    drop(runtime);
    if fs::write(
        directory.join(format!("pending-{}.json", report.report_id)),
        serde_json::to_vec(&report).unwrap_or_default(),
    )
    .is_ok()
    {
        if let Some(endpoint) = endpoint() {
            std::thread::spawn(move || transmit(&directory, endpoint));
        }
    }
}
pub fn start(directory: &Path) {
    let directory = directory.join("crashes");
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
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
    signals::install(&directory);
    // Recovery reads the journal: keep it off the startup path.
    let background = directory.clone();
    std::thread::spawn(move || {
        recover(&background);
        if let Some(endpoint) = endpoint() {
            transmit(&background, endpoint);
        }
    });
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
    if let Some(directory) = runtime.marker.parent() {
        let _ = fs::remove_file(signals::path(directory, std::process::id()));
    }
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
                assert_eq!(data["schema"], 3);
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
    fn child(term: bool) -> (tempfile::TempDir, PathBuf) {
        let directory = tempfile::tempdir().unwrap();
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "crash::tests::child_signal_fixture"])
            .env("GALEATA_CRASH_TEST_DIRECTORY", directory.path());
        if term {
            command.env("GALEATA_CRASH_TEST_TERM", "1");
        }
        assert!(!command.output().unwrap().status.success());
        let reports = directory.path().join("crashes");
        recover(&reports);
        (directory, reports)
    }
    fn files(directory: &Path, prefix: &str) -> Vec<String> {
        fs::read_dir(directory)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(prefix))
            .map(|e| fs::read_to_string(e.path()).unwrap_or_default())
            .collect()
    }
    #[test]
    fn child_signal_fixture() {
        let Some(directory) = std::env::var_os("GALEATA_CRASH_TEST_DIRECTORY") else {
            return;
        };
        start(Path::new(&directory));
        if std::env::var_os("GALEATA_CRASH_TEST_TERM").is_some() {
            unsafe { nix::libc::raise(nix::libc::SIGTERM) };
        }
        std::process::abort();
    }
    #[test]
    fn native_abort_is_reported_with_its_signal() {
        let (_directory, reports) = child(false);
        let pending = files(&reports, "pending-");
        assert_eq!(pending.len(), 1);
        let report: Report = serde_json::from_str(&pending[0]).unwrap();
        assert_eq!(report.reason, "fatal_signal");
        assert_eq!(report.signal.as_deref(), Some("SIGABRT"));
        assert!(files(&reports, "signal-").is_empty());
    }
    #[test]
    fn requested_termination_stays_local() {
        let (_directory, reports) = child(true);
        assert!(files(&reports, "pending-").is_empty());
        let local: Report = serde_json::from_str(&files(&reports, "local-")[0]).unwrap();
        assert_eq!(local.reason, "terminated");
        assert_eq!(local.signal.as_deref(), Some("SIGTERM"));
    }
    #[test]
    fn gtk_assertion_from_the_journal_keeps_only_identifiers() {
        let journal = concat!(
            "Could not load a pixbuf from icon theme.\n**\n",
            "Gtk:ERROR:../../../../gtk/gtkiconhelper.c:494:ensure_surface_for_gicon: assertion failed (error == NULL): ",
            "Failed to load /usr/share/icons/Pop/16x16/status/image-missing.svg: Impossible de charger le module de chargement d’images : ",
            "libpixbufloader-svg.so : libpixbufloader-svg.so: Ne peut ouvrir le fichier d'objet partagé: Aucun fichier ou dossier de ce nom\n",
            "Bail out! Gtk:ERROR:../../../../gtk/gtkiconhelper.c:494:ensure_surface_for_gicon: assertion failed: /home/private/data\n",
            "Failed to load module \"canberra-gtk-module\""
        );
        let error = parse_native(journal).unwrap();
        assert_eq!(
            error,
            NativeError {
                domain: Some("Gtk".into()),
                level: Some("ERROR".into()),
                source: Some("gtk/gtkiconhelper.c".into()),
                line: Some(494),
                function: Some("ensure_surface_for_gicon".into()),
                libraries: vec!["libpixbufloader-svg.so".into()],
                hints: vec!["missing_library".into(), "gtk_assertion".into()],
            }
        );
        assert!(!serde_json::to_string(&error).unwrap().contains("private"));
        let critical = parse_native(
            "(galeata:42): Gtk-CRITICAL **: 15:07:30.123: gtk_widget_show: assertion 'GTK_IS_WIDGET (widget)' failed",
        )
        .unwrap();
        assert_eq!(critical.domain.as_deref(), Some("Gtk"));
        assert_eq!(critical.level.as_deref(), Some("CRITICAL"));
        assert_eq!(critical.function.as_deref(), Some("gtk_widget_show"));
        assert_eq!(
            parse_native(
                "Failed to load module \"canberra-gtk-module\"\nFailed to set scheduler settings"
            ),
            None
        );
        let x = parse_native(
            "Gdk-Message: 15:42:03.000: galeata: Error reading events from display: Broken pipe",
        )
        .unwrap();
        assert_eq!(x.hints, vec!["x_io_error".to_string()]);
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
