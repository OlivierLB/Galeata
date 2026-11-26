//! On-demand, bounded local execution with a cross-process lock.
use crate::{
    checks::{self, Check},
    store::{self, Result},
    workspace::Workspace,
    State,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::Read,
    os::fd::AsRawFd,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const OUTPUT_TAIL: usize = 16 * 1024;
const OUTPUT_LIMIT: usize = 8 * 1024 * 1024;
// Prevent shutdown from missing a child between spawn and registration.
static SPAWN_GATE: Mutex<()> = Mutex::new(());
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub check: Check,
    pub status: String,
    pub output: String,
    pub started_at: Option<u64>,
    pub finished_at: Option<u64>,
    pub exit_code: Option<i32>,
    pub message: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub workspace: String,
    pub created_at: u64,
    pub jobs: Vec<Job>,
    pub epoch: String,
    pub revision: u64,
}
pub struct Runner {
    runs: Mutex<Vec<Run>>,
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    children: Mutex<HashMap<String, u32>>,
    pub revision: AtomicU64,
    epoch: String,
}
impl Default for Runner {
    fn default() -> Self {
        Self {
            runs: Mutex::new(vec![]),
            cancels: Mutex::new(HashMap::new()),
            children: Mutex::new(HashMap::new()),
            revision: AtomicU64::new(0),
            epoch: uuid::Uuid::new_v4().to_string(),
        }
    }
}
fn terminal(status: &str) -> bool {
    !matches!(status, "queued" | "waiting" | "running")
}
fn signal(pid: u32) {
    let _ = nix::sys::signal::killpg(
        nix::unistd::Pid::from_raw(pid as i32),
        nix::sys::signal::Signal::SIGKILL,
    );
}
impl Runner {
    pub fn has_run(&self, workspace: &str, id: &str) -> bool {
        self.runs.lock().is_ok_and(|runs| {
            runs.iter()
                .any(|run| run.id == id && run.workspace == workspace)
        })
    }
    pub fn is_running(&self) -> bool {
        self.cancels.lock().is_ok_and(|cancels| !cancels.is_empty())
    }
    pub fn cancel_all(&self) {
        if let Ok(cancels) = self.cancels.lock() {
            for cancel in cancels.values() {
                cancel.store(true, Ordering::Release);
            }
        }
        let _gate = SPAWN_GATE.lock().unwrap_or_else(|error| error.into_inner());
        if let Ok(children) = self.children.lock() {
            for pid in children.values() {
                signal(*pid);
            }
        }
    }
    pub fn cancel(&self, workspace: &str, id: &str) -> Result<Value> {
        if !self
            .runs
            .lock()
            .map_err(|e| e.to_string())?
            .iter()
            .any(|run| run.id == id && run.workspace == workspace)
        {
            return Err("Exécution introuvable".into());
        }
        if let Some(cancel) = self.cancels.lock().map_err(|e| e.to_string())?.get(id) {
            cancel.store(true, Ordering::Release);
        }
        let _gate = SPAWN_GATE.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(pid) = self.children.lock().map_err(|e| e.to_string())?.get(id) {
            signal(*pid);
        }
        Ok(Value::Null)
    }
    pub fn status(&self, workspace: &str, history: Vec<Run>) -> Result<Value> {
        let memory = self.runs.lock().map_err(|e| e.to_string())?;
        let mut runs: Vec<Run> = memory
            .iter()
            .filter(|run| run.workspace == workspace)
            .cloned()
            .collect();
        for mut run in history {
            if runs.iter().any(|existing| existing.id == run.id) {
                continue;
            }
            for job in &mut run.jobs {
                if !terminal(&job.status) {
                    job.status = "interrupted".into();
                    job.message = "Session précédente interrompue".into();
                }
            }
            runs.push(run);
        }
        runs.sort_by_key(|run| std::cmp::Reverse(run.created_at));
        runs.truncate(8);
        Ok(json!(runs.iter().map(|run| json!({"id":run.id,"createdAt":run.created_at,
            "stale":run.epoch != self.epoch || run.revision != self.revision.load(Ordering::Acquire),
            "active":run.jobs.iter().any(|job| !terminal(&job.status)),
            "jobs":run.jobs.iter().map(|job| json!({"check":job.check,"status":job.status,"startedAt":job.started_at,
                "finishedAt":job.finished_at,"exitCode":job.exit_code,"message":job.message,"hasOutput":!job.output.is_empty()})).collect::<Vec<_>>()
        })).collect::<Vec<_>>()))
    }
    pub fn output(
        &self,
        workspace: &str,
        id: &str,
        check: &str,
        history: Vec<Run>,
    ) -> Result<Value> {
        let memory = self.runs.lock().map_err(|e| e.to_string())?;
        let run = memory
            .iter()
            .chain(history.iter())
            .find(|run| run.workspace == workspace && run.id == id)
            .ok_or("Exécution introuvable")?;
        let job = run
            .jobs
            .iter()
            .find(|job| job.check.id == check)
            .ok_or("Contrôle introuvable")?;
        Ok(json!(job.output))
    }
}

fn notify(app: &tauri::AppHandle, workspace: &str) {
    let _ = app.emit("checks:changed", json!({"workspaceId":workspace}));
}
fn update(
    app: &tauri::AppHandle,
    id: &str,
    index: usize,
    persist: bool,
    change: impl FnOnce(&mut Job),
) {
    let state = app.state::<Arc<State>>();
    let snapshot = if let Ok(mut runs) = state.checks.runs.lock() {
        if let Some(run) = runs.iter_mut().find(|run| run.id == id) {
            change(&mut run.jobs[index]);
            Some(run.clone())
        } else {
            None
        }
    } else {
        None
    };
    if let Some(run) = snapshot {
        if persist {
            let _ = state
                .store
                .save_check_run(&run.id, &run.workspace, &json!(run));
        }
        notify(app, &run.workspace);
    }
}
pub fn history(state: &State, workspace: &str) -> Vec<Run> {
    state
        .store
        .check_runs(workspace)
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

pub fn start(app: &tauri::AppHandle, w: &Workspace, args: &Value) -> Result<Value> {
    let state = app.state::<Arc<State>>();
    let ids = args["ids"].as_array().ok_or("Sélection attendue")?;
    if ids.is_empty() || ids.len() > 32 {
        return Err("Sélectionnez entre 1 et 32 contrôles".into());
    }
    let configuration = state.store.preference(&w.id, "checks")?;
    let catalogue = checks::discover(w, &configuration)?;
    let mut selected = vec![];
    for id in ids {
        let check = catalogue
            .iter()
            .find(|check| id.as_str() == Some(check.id.as_str()))
            .ok_or("Le catalogue a changé : actualisez la liste")?;
        checks::validate(w, check)?;
        if !selected.iter().any(|job: &Job| job.check.id == check.id) {
            selected.push(Job {
                check: check.clone(),
                status: "queued".into(),
                output: String::new(),
                started_at: None,
                finished_at: None,
                exit_code: None,
                message: String::new(),
            });
        }
    }
    let id = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut cancels = state.checks.cancels.lock().map_err(|e| e.to_string())?;
        if !cancels.is_empty() {
            return Err("Une sélection est déjà en cours dans cette fenêtre".into());
        }
        cancels.insert(id.clone(), cancel.clone());
    }
    let run = Run {
        id: id.clone(),
        workspace: w.id.clone(),
        created_at: store::now(),
        jobs: selected,
        epoch: state.checks.epoch.clone(),
        revision: state.checks.revision.load(Ordering::Acquire),
    };
    if let Err(error) = state.store.save_check_run(&id, &w.id, &json!(run)) {
        state
            .checks
            .cancels
            .lock()
            .map_err(|e| e.to_string())?
            .remove(&id);
        return Err(error);
    }
    {
        let mut runs = state.checks.runs.lock().map_err(|e| e.to_string())?;
        runs.insert(0, run.clone());
        runs.truncate(8);
    }
    let app = app.clone();
    let w = w.clone();
    let run_id = id.clone();
    std::thread::spawn(move || {
        for (index, job) in run.jobs.iter().enumerate() {
            if cancel.load(Ordering::Acquire) {
                update(&app, &run_id, index, true, |job| {
                    job.status = "cancelled".into();
                    job.finished_at = Some(store::now());
                });
                continue;
            }
            update(&app, &run_id, index, true, |job| {
                job.status = "waiting".into();
                job.message = "En attente du créneau commun aux fenêtres".into();
            });
            let state = app.state::<Arc<State>>();
            let lock_path = state
                .socket
                .parent()
                .unwrap_or(&w.root)
                .join("checks-execution.lock");
            let lock = acquire(&lock_path, &cancel);
            let outcome = match lock {
                Ok(Some(_guard)) => {
                    update(&app, &run_id, index, true, |job| {
                        job.status = "running".into();
                        job.started_at = Some(store::now());
                        job.message.clear();
                    });
                    execute(
                        &w,
                        &job.check,
                        &cancel,
                        |pid| {
                            if let Ok(mut children) = state.checks.children.lock() {
                                children.insert(run_id.clone(), pid);
                            }
                            if cancel.load(Ordering::Acquire) {
                                signal(pid);
                            }
                        },
                        |text| {
                            update(&app, &run_id, index, false, |job| {
                                job.output = text.to_owned()
                            })
                        },
                    )
                }
                Ok(None) => Outcome::new("cancelled", "Annulé avant exécution"),
                Err(error) => Outcome::new("blocked", &error),
            };
            if let Ok(mut children) = state.checks.children.lock() {
                children.remove(&run_id);
            }
            update(&app, &run_id, index, true, |job| {
                job.status = outcome.status;
                job.output = outcome.output;
                job.exit_code = outcome.code;
                job.message = outcome.message;
                job.finished_at = Some(store::now());
            });
        }
        let state = app.state::<Arc<State>>();
        if let Ok(mut cancels) = state.checks.cancels.lock() {
            cancels.remove(&run_id);
        }
        notify(&app, &w.id);
    });
    Ok(json!({"id":id}))
}

fn acquire(path: &std::path::Path, cancel: &AtomicBool) -> Result<Option<File>> {
    let file = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    while !cancel.load(Ordering::Acquire) {
        // SAFETY: flock operates only on the descriptor owned by this File.
        if unsafe { nix::libc::flock(file.as_raw_fd(), nix::libc::LOCK_EX | nix::libc::LOCK_NB) }
            == 0
        {
            return Ok(Some(file));
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::WouldBlock {
            return Err(error.to_string());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Ok(None)
}

pub struct Outcome {
    status: String,
    output: String,
    message: String,
    code: Option<i32>,
}
impl Outcome {
    fn new(status: &str, message: &str) -> Self {
        Self {
            status: status.into(),
            output: String::new(),
            message: message.into(),
            code: None,
        }
    }
}
pub fn execute(
    w: &Workspace,
    check: &Check,
    cancel: &AtomicBool,
    spawned: impl FnOnce(u32),
    mut progress: impl FnMut(&str),
) -> Outcome {
    use std::os::unix::process::CommandExt;
    let cwd = match w.resolve(&check.cwd, false) {
        Ok(path) => path,
        Err(error) => return Outcome::new("blocked", &error),
    };
    let program =
        if check.program.contains('/') && !std::path::Path::new(&check.program).is_absolute() {
            cwd.join(&check.program).to_string_lossy().into_owned()
        } else {
            check.program.clone()
        };
    let mut command = Command::new(&program);
    command
        .args(&check.args)
        .current_dir(cwd)
        .env_clear()
        .envs(galeata_agent_protocol::host_env(std::env::vars_os()))
        .env("CI", "true")
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    let spawn_gate = SPAWN_GATE.lock().unwrap_or_else(|error| error.into_inner());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return Outcome::new(
                "blocked",
                &format!("Impossible de lancer {} : {error}", check.program),
            )
        }
    };
    spawned(child.id());
    drop(spawn_gate);
    let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(64);
    let streams: Vec<Box<dyn Read + Send>> = vec![
        Box::new(child.stdout.take().unwrap()),
        Box::new(child.stderr.take().unwrap()),
    ];
    for mut stream in streams {
        let tx = tx.clone();
        std::thread::spawn(move || {
            let mut buffer = [0; 4096];
            loop {
                match stream.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(size) => {
                        if tx.send(buffer[..size].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        });
    }
    drop(tx);
    let began = Instant::now();
    let mut painted = Instant::now();
    let mut output = Vec::new();
    let mut total = 0usize;
    let mut published = 0usize;
    let mut exit = None;
    let mut closed = false;
    let mut forced = None;
    loop {
        if cancel.load(Ordering::Acquire) {
            forced = Some(("cancelled", "Exécution annulée"));
            break;
        }
        if began.elapsed() >= Duration::from_secs(check.timeout) {
            forced = Some(("timeout", "Délai dépassé"));
            break;
        }
        for _ in 0..64 {
            match rx.try_recv() {
                Ok(bytes) => {
                    total += bytes.len();
                    output.extend(bytes);
                    if output.len() > OUTPUT_TAIL {
                        output.drain(..output.len() - OUTPUT_TAIL);
                    }
                }
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    closed = true;
                    break;
                }
                Err(_) => break,
            }
        }
        if total > OUTPUT_LIMIT {
            forced = Some((
                "output_limit",
                "Sortie supérieure à 8 Mio : exécution arrêtée",
            ));
            break;
        }
        if exit.is_none() {
            match child.try_wait() {
                Ok(status) => exit = status,
                Err(_) => {
                    forced = Some(("failed", "Impossible de suivre le processus"));
                    break;
                }
            }
        }
        if total != published && painted.elapsed() >= Duration::from_millis(200) {
            progress(&String::from_utf8_lossy(&output));
            published = total;
            painted = Instant::now();
        }
        if exit.is_some() && closed {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    // Jobs own their process group, including servers started in the background.
    signal(child.id());
    let _ = child.kill();
    let _ = child.wait();
    let output = String::from_utf8_lossy(&output).into_owned();
    if let Some((status, message)) = forced {
        return Outcome {
            status: status.into(),
            message: message.into(),
            output,
            code: exit.and_then(|status| status.code()),
        };
    }
    let code = exit.and_then(|status| status.code());
    let no_tests = (check.args.iter().any(|arg| arg == "pytest")
        && code == Some(5)
        && output.contains("no tests ran"))
        || (check.args.iter().any(|arg| arg == "unittest")
            && code == Some(0)
            && output
                .lines()
                .any(|line| line.starts_with("Ran 0 tests in ")));
    Outcome {
        status: if no_tests {
            "no_tests"
        } else if matches!(code, Some(126 | 127)) {
            "blocked"
        } else if code == Some(0) {
            "passed"
        } else {
            "failed"
        }
        .into(),
        output,
        message: if total > OUTPUT_TAIL {
            "Fin de sortie conservée (16 Kio)".into()
        } else {
            String::new()
        },
        code,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn check(args: &[&str]) -> Check {
        Check {
            id: "test".into(),
            name: "Test".into(),
            program: "/bin/sh".into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            cwd: String::new(),
            timeout: 2,
            origin: String::new(),
            category: "Tests".into(),
        }
    }
    #[test]
    fn captures_failures_and_cancels_process_groups() {
        let directory = tempfile::tempdir().unwrap();
        let w = Workspace::open(directory.path().to_str().unwrap()).unwrap();
        let cancel = AtomicBool::new(false);
        let result = execute(
            &w,
            &check(&["-c", "printf failure; exit 7"]),
            &cancel,
            |_| {},
            |_| {},
        );
        assert_eq!(result.status, "failed");
        assert_eq!(result.code, Some(7));
        assert_eq!(result.output, "failure");
        let began = Instant::now();
        let result = execute(
            &w,
            &check(&["-c", "sleep 30 & wait"]),
            &cancel,
            |_| {
                cancel.store(true, Ordering::Release);
            },
            |_| {},
        );
        assert_eq!(result.status, "cancelled");
        assert!(began.elapsed() < Duration::from_secs(1));
    }
    #[test]
    fn global_lock_is_exclusive_and_wait_is_cancellable() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("lock");
        let cancel = Arc::new(AtomicBool::new(false));
        let held = acquire(&path, &cancel).unwrap().unwrap();
        let flag = cancel.clone();
        let waiting_path = path.clone();
        let waiter = std::thread::spawn(move || acquire(&waiting_path, &flag).unwrap().is_none());
        std::thread::sleep(Duration::from_millis(120));
        cancel.store(true, Ordering::Release);
        assert!(waiter.join().unwrap());
        drop(held);
        assert!(acquire(&path, &AtomicBool::new(false)).unwrap().is_some());
    }
    #[test]
    fn limits_output_and_times_out_quiet_jobs() {
        let directory = tempfile::tempdir().unwrap();
        let w = Workspace::open(directory.path().to_str().unwrap()).unwrap();
        let cancel = AtomicBool::new(false);
        let mut noisy = check(&["-c", "head -c 10000000 /dev/zero"]);
        noisy.timeout = 10;
        let result = execute(&w, &noisy, &cancel, |_| {}, |_| {});
        assert_eq!(result.status, "output_limit");
        assert!(result.output.len() <= OUTPUT_TAIL);
        let mut quiet = check(&["-c", "sleep 30"]);
        quiet.timeout = 1;
        let began = Instant::now();
        let result = execute(&w, &quiet, &cancel, |_| {}, |_| {});
        assert_eq!(result.status, "timeout");
        assert!(began.elapsed() < Duration::from_secs(3));
    }
    #[test]
    fn restored_runs_are_interrupted_and_output_is_not_sent_in_snapshots() {
        let runner = Runner::default();
        let run = Run {
            id: "old".into(),
            workspace: "project".into(),
            created_at: 1,
            epoch: "old-process".into(),
            revision: 0,
            jobs: vec![Job {
                check: check(&[]),
                status: "running".into(),
                output: "retained output".into(),
                started_at: Some(1),
                finished_at: None,
                exit_code: None,
                message: String::new(),
            }],
        };
        let snapshot = runner.status("project", vec![run]).unwrap();
        assert_eq!(snapshot[0]["jobs"][0]["status"], "interrupted");
        assert_eq!(snapshot[0]["active"], false);
        assert_eq!(snapshot[0]["stale"], true);
        assert!(!snapshot.to_string().contains("retained output"));
    }
}
