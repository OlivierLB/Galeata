//! Abnormal exits are detected on the next launch, including SIGKILL.
use std::{
    fs,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::Duration,
};
static MARKER: OnceLock<PathBuf> = OnceLock::new();

fn alive(pid: u32) -> bool {
    Path::new(&format!("/proc/{pid}")).exists()
}

pub fn start(directory: &Path) {
    let directory = directory.join("crashes");
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let mut pending: Vec<_> = fs::read_dir(&directory)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("pending-"))
        .collect();
    pending
        .sort_by_key(|entry| std::cmp::Reverse(entry.metadata().and_then(|m| m.modified()).ok()));
    let mut reports = pending.len().min(16);
    for entry in pending.into_iter().skip(16) {
        let _ = fs::remove_file(entry.path());
    }
    for entry in fs::read_dir(&directory)
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
        if alive(pid) {
            continue;
        }
        if reports < 16 {
            let pending = directory.join(format!("pending-{}.json", uuid::Uuid::new_v4()));
            let _ = fs::rename(entry.path(), pending);
            reports += 1;
        } else {
            let _ = fs::remove_file(entry.path());
        }
    }
    let marker = directory.join(format!("running-{}.json", std::process::id()));
    let report = serde_json::json!({"version":env!("CARGO_PKG_VERSION"),"platform":"linux","reason":"abnormal_exit"});
    if fs::write(&marker, report.to_string()).is_ok() {
        let _ = MARKER.set(marker);
    }
    // The publisher supplies a public relay URL, never a GitHub credential.
    let Some(endpoint) =
        option_env!("GALEATA_CRASH_ENDPOINT").filter(|url| url.starts_with("https://"))
    else {
        return;
    };
    std::thread::spawn(move || {
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
            if !entry.file_name().to_string_lossy().starts_with("pending-") {
                continue;
            }
            let Ok(body) = fs::read_to_string(entry.path()) else {
                continue;
            };
            if body.len() > 1024 {
                continue;
            }
            if client
                .post(endpoint)
                .set("Content-Type", "application/json")
                .send_string(&body)
                .is_ok()
            {
                let _ = fs::remove_file(entry.path());
            }
        }
    });
}

pub fn clean_exit() {
    if let Some(marker) = MARKER.get() {
        let _ = fs::remove_file(marker);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn current_process_is_not_a_crash() {
        assert!(super::alive(std::process::id()));
    }
    #[test]
    fn abandoned_marker_is_queued_and_normal_exit_removes_current_marker() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("crashes");
        std::fs::create_dir_all(&directory).unwrap();
        let abandoned = directory.join("running-4294967295.json");
        std::fs::write(
            &abandoned,
            r#"{"version":"0.1.0","platform":"linux","reason":"abnormal_exit"}"#,
        )
        .unwrap();
        super::start(root.path());
        assert!(!abandoned.exists());
        assert!(std::fs::read_dir(&directory)
            .unwrap()
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().starts_with("pending-")));
        let marker = directory.join(format!("running-{}.json", std::process::id()));
        assert!(marker.exists());
        super::clean_exit();
        assert!(!marker.exists());
    }
}
