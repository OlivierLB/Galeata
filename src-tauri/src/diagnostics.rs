//! Bounded technical diagnostics. Never record arguments, paths or error payloads.
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Instant, SystemTime, UNIX_EPOCH},
};
static LOG: OnceLock<Mutex<PathBuf>> = OnceLock::new();
const LIMIT: u64 = 512 * 1024;
pub fn init(directory: PathBuf) {
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let _ = LOG.set(Mutex::new(
        directory.join(format!("runtime-{}.log", std::process::id())),
    ));
    // Keep at most eight other process logs; bounded across launches as well.
    let mut files: Vec<_> = fs::read_dir(&directory)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().starts_with("runtime-"))
        .collect();
    files.sort_by_cached_key(|e| std::cmp::Reverse(e.metadata().and_then(|m| m.modified()).ok()));
    for file in files.into_iter().skip(8) {
        let _ = fs::remove_file(file.path());
    }
    record("startup", 0, true);
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        record("panic", 0, false);
        crate::crash::capture_panic(info);
        previous(info);
    }));
}
pub fn record(operation: &str, elapsed_ms: u128, ok: bool) {
    record_with_error(operation, elapsed_ms, ok, None);
}
fn record_with_error(operation: &str, elapsed_ms: u128, ok: bool, error: Option<&str>) {
    let safe_operation = match operation {
        "startup" | "exit" | "panic" => operation,
        _ => operation_name(operation),
    };
    crate::crash::record_event(safe_operation, elapsed_ms, ok, error.unwrap_or("NONE"));
    let Some(log) = LOG.get() else {
        return;
    };
    let Ok(path) = log.lock() else {
        return;
    };
    if fs::metadata(&*path).is_ok_and(|m| m.len() >= LIMIT) {
        // One file per process; rotation truncates instead of growing without bound.
        let _ = fs::write(&*path, b"");
    }
    let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&*path)
    else {
        return;
    };
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let code = error.unwrap_or("NONE");
    let _ = writeln!(
        file,
        "{timestamp} {operation} ms={elapsed_ms} ok={ok} error={code}"
    );
}
// Unknown input must never be copied into diagnostics.
fn operation_name(method: &str) -> &'static str {
    match method {
        "activity.list" => "activity.list",
        "activity.report" => "activity.report",
        "agent.answer" => "agent.answer",
        "agent.close" => "agent.close",
        "agent.compact" => "agent.compact",
        "agent.interrupt" => "agent.interrupt",
        "agent.list" => "agent.list",
        "agent.mode" => "agent.mode",
        "agent.model" => "agent.model",
        "agent.models" => "agent.models",
        "agent.respond" => "agent.respond",
        "agent.send" => "agent.send",
        "agent.skills" => "agent.skills",
        "agent.start" => "agent.start",
        "git.branches" => "git.branches",
        "git.diff" => "git.diff",
        "git.get_diff" => "git.get_diff",
        "git.get_status" => "git.get_status",
        "git.mutate" => "git.mutate",
        "git.overview" => "git.overview",
        "git.status" => "git.status",
        "git.worktrees" => "git.worktrees",
        "mcp.config" => "mcp.config",
        "plan.get" => "plan.get",
        "plan.propose_change" => "plan.propose_change",
        "plan.save" => "plan.save",
        "plan.set" => "plan.set",
        "plan.update_step" => "plan.update_step",
        "preferences.get" => "preferences.get",
        "preferences.save" => "preferences.save",
        "providers.list" => "providers.list",
        "remote.connect" => "remote.connect",
        "remote.connection" => "remote.connection",
        "remote.detail" => "remote.detail",
        "remote.disconnect" => "remote.disconnect",
        "remote.list" => "remote.list",
        "session.save_handoff" => "session.save_handoff",
        "sessions.list" => "sessions.list",
        "terminal.close" => "terminal.close",
        "terminal.input" => "terminal.input",
        "terminal.resize" => "terminal.resize",
        "terminal.start" => "terminal.start",
        "ui.open_file" => "ui.open_file",
        "ui.show_diff" => "ui.show_diff",
        "verification.record" => "verification.record",
        "verification.run" => "verification.run",
        "workspace.context" => "workspace.context",
        "workspace.create" => "workspace.create",
        "workspace.delete" => "workspace.delete",
        "workspace.get_context" => "workspace.get_context",
        "workspace.list" => "workspace.list",
        "workspace.read" => "workspace.read",
        "workspace.rename" => "workspace.rename",
        "workspace.search_files" => "workspace.search_files",
        "workspace.search_text" => "workspace.search_text",
        "workspace.write" => "workspace.write",
        _ => "request.unknown",
    }
}
fn error_code(error: &str) -> &'static str {
    if error.starts_with("Action inconnue ou non autorisée : ") {
        return "UNKNOWN_OR_UNAUTHORIZED";
    }
    if error.starts_with("REVISION_CONFLICT:") || error.starts_with("FILE_CONFLICT:") {
        return "CONFLICT";
    }
    match error {
        "Ouvrez un dossier" => "WORKSPACE_REQUIRED",
        "Chemin hors du projet"
        | "Lien symbolique hors du projet"
        | "L’accès direct aux métadonnées Git est interdit"
        | "Action interdite sur la racine" => "ACCESS_DENIED",
        "Révision requise" | "Arguments attendus" | "Argument invalide" | "Plan invalide"
        | "Recherche invalide" => "INVALID_ARGUMENT",
        _ => "UNCLASSIFIED",
    }
}
pub struct Span {
    operation: &'static str,
    started: Instant,
    ok: bool,
    error: Option<&'static str>,
}
impl Span {
    pub fn new(operation: &str) -> Self {
        Self {
            operation: operation_name(operation),
            started: Instant::now(),
            ok: false,
            error: Some("INCOMPLETE"),
        }
    }
    pub fn complete(&mut self, result: Result<(), &str>) {
        self.ok = result.is_ok();
        self.error = result.err().map(error_code);
    }
}
impl Drop for Span {
    fn drop(&mut self) {
        let elapsed = self.started.elapsed().as_millis();
        if !self.ok || elapsed >= 250 {
            record_with_error(self.operation, elapsed, self.ok, self.error);
        } else {
            crate::crash::record_event(self.operation, elapsed, self.ok, "NONE");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn request_metadata_is_allowlisted() {
        assert_eq!(operation_name("agent.models"), "agent.models");
        assert_eq!(operation_name("secret\nforged"), "request.unknown");
        assert_eq!(error_code("/private/secret token=value"), "UNCLASSIFIED");
        assert_eq!(error_code("FILE_CONFLICT: private payload"), "CONFLICT");
        assert_eq!(error_code("Ouvrez un dossier"), "WORKSPACE_REQUIRED");
        let mut span = Span::new("unknown");
        span.complete(Ok(()));
        assert!(span.ok);
        assert_eq!(span.error, None);
        span.complete(Err("private payload"));
        assert_eq!(span.error, Some("UNCLASSIFIED"));
        span.complete(Ok(()));
    }
    #[test]
    fn logs_are_bounded_and_contain_only_technical_metadata() {
        let directory = tempfile::tempdir().unwrap();
        init(directory.path().to_owned());
        let path = LOG.get().unwrap().lock().unwrap().clone();
        fs::write(&path, vec![b'x'; LIMIT as usize]).unwrap();
        record("workspace.search", 321, false);
        let text = fs::read_to_string(path).unwrap();
        assert!(text.len() < 128);
        assert!(text.contains("workspace.search ms=321 ok=false"));
        let mut span = Span::new("secret\nforged");
        span.complete(Err("/private/secret token=value"));
        drop(span);
        let text = fs::read_to_string(LOG.get().unwrap().lock().unwrap().clone()).unwrap();
        assert!(text.contains("request.unknown ms="));
        assert!(text.contains("ok=false error=UNCLASSIFIED"));
        assert!(!text.contains("secret"));
        assert!(!text.contains("forged"));
    }
}
