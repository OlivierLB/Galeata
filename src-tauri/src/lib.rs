mod agents;
mod atomic_file;
mod check_runner;
mod checks;
mod crash;
mod diagnostics;
mod git;
mod language;
mod mcp;
mod remote;
mod sessions;
mod skills;
pub mod store;
mod terminal;
mod tool_config;
pub mod workspace;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};
use store::{Result, Store};
use tauri::{Emitter, Manager};
use workspace::Workspace;

pub struct State {
    pub workspace: Mutex<Option<Workspace>>,
    pub store: Store,
    pub terminals: terminal::Terminals,
    pub agents: agents::Agents,
    pub checks: Arc<check_runner::Runner>,
    pub socket: PathBuf,
    watcher: Mutex<Option<RecommendedWatcher>>,
    files_lock: Mutex<()>,
    workspace_gate: RwLock<()>,
}
fn required<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key].as_str().ok_or_else(|| format!("{key} requis"))
}
impl State {
    fn current(&self) -> Result<Workspace> {
        self.workspace
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .ok_or("Ouvrez un dossier".into())
    }
    pub fn dispatch(
        &self,
        app: &tauri::AppHandle,
        method: &str,
        args: Value,
        agent: bool,
    ) -> Result<Value> {
        let mut diagnostic = diagnostics::Span::new(method);
        let result = self.dispatch_inner(app, method, args, agent);
        diagnostic.complete(result.as_ref().map(|_| ()).map_err(|error| error.as_str()));
        result
    }
    fn dispatch_inner(
        &self,
        app: &tauri::AppHandle,
        method: &str,
        args: Value,
        agent: bool,
    ) -> Result<Value> {
        let w = self.current()?;
        let plan_scope = if let Some(id) = args["conversationId"].as_str() {
            if id == "empty" {
                format!("{}:empty", w.id)
            } else {
                self.agents
                    .lock()
                    .map_err(|e| e.to_string())?
                    .get(id)
                    .filter(|running| running.workspace == w.id)
                    .map(|running| running.plan_scope.clone())
                    .ok_or("Conversation inconnue")?
            }
        } else {
            w.id.clone()
        };
        let author = if agent { "agent:mcp" } else { "vous" };
        let expected = || {
            args["revision"]
                .as_u64()
                .ok_or("Révision requise".to_string())
        };
        match method {
            "tools.config.list" if !agent => tool_config::list(&w, required(&args, "provider")?),
            "tools.config.read" if !agent => {
                tool_config::load(&w, required(&args, "provider")?, required(&args, "id")?)
            }
            "tools.config.write" if !agent => {
                let _guard = self.files_lock.lock().map_err(|e| e.to_string())?;
                tool_config::write(
                    &w,
                    required(&args, "provider")?,
                    required(&args, "id")?,
                    required(&args, "content")?,
                    required(&args, "stamp")?,
                )
            }
            "checks.catalog" if !agent => {
                checks::catalogue(&w, &self.store.preference(&w.id, "checks")?)
            }
            "checks.configure" if !agent => {
                if args.to_string().len() > 256 * 1024 {
                    return Err("Configuration trop volumineuse".into());
                }
                if let Some(custom) = args["custom"].as_array() {
                    if custom.len() > 64 {
                        return Err("Limite de 64 contrôles personnalisés".into());
                    }
                    for item in custom {
                        let check: checks::Check =
                            serde_json::from_value(item.clone()).map_err(|e| e.to_string())?;
                        checks::validate(&w, &check)?;
                    }
                }
                self.store.set_preference(&w.id, "checks", &args)?;
                Ok(Value::Null)
            }
            "checks.start" if !agent => check_runner::start(app, &w, &args),
            "checks.status" if !agent => self.checks.status(
                &w.id,
                if args["refresh"] == false {
                    vec![]
                } else {
                    check_runner::history(self, &w.id)
                },
            ),
            "checks.output" if !agent => self.checks.output(
                &w.id,
                required(&args, "id")?,
                required(&args, "checkId")?,
                if self.checks.has_run(&w.id, required(&args, "id")?) {
                    vec![]
                } else {
                    check_runner::history(self, &w.id)
                },
            ),
            "checks.cancel" if !agent => self.checks.cancel(&w.id, required(&args, "id")?),
            "workspace.context" | "workspace.get_context" => {
                let instructions = ["AGENTS.md", "CLAUDE.md"]
                    .iter()
                    .filter_map(|p| {
                        w.read(p)
                            .ok()
                            .map(|v| json!({"path":p,"content":v["content"]}))
                    })
                    .collect::<Vec<_>>();
                Ok(
                    json!({"workspace":w,"git":git::status(&w)?,"plan":self.store.plan(&plan_scope)?,"instructions":instructions}),
                )
            }
            "workspace.list" => w.list(
                args["path"].as_str().unwrap_or(""),
                args["offset"].as_u64().unwrap_or(0) as usize,
            ),
            "language.configuration.get" if !agent => self.store.preference(&w.id, "languages"),
            "language.configuration.save" if !agent => {
                language::validate_configuration(&args["configuration"])?;
                self.store
                    .set_preference(&w.id, "languages", &args["configuration"])?;
                language::stop_all();
                Ok(Value::Null)
            }
            "language.status" if !agent => {
                language::status(&w, &args, &self.store.preference(&w.id, "languages")?)
            }
            "language.format" if !agent => {
                language::format(&w, &args, &self.store.preference(&w.id, "languages")?)
            }
            "language.request" if !agent => {
                let mut args = args;
                args["configuration"] = self.store.preference(&w.id, "languages")?;
                language::dispatch(&w, &args)
            }
            "workspace.read" => w.read(required(&args, "path")?),
            "workspace.write" if !agent => {
                let _lock = self.files_lock.lock().map_err(|e| e.to_string())?;
                w.write(
                    required(&args, "path")?,
                    required(&args, "content")?,
                    required(&args, "stamp")?,
                )
            }
            "workspace.create" if !agent => {
                let _lock = self.files_lock.lock().map_err(|e| e.to_string())?;
                let path = w.resolve(required(&args, "path")?, true)?;
                if args["directory"] == true {
                    fs::create_dir(path).map_err(|e| e.to_string())?;
                } else {
                    fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(path)
                        .map_err(|e| e.to_string())?;
                }
                Ok(Value::Null)
            }
            "workspace.rename" if !agent => {
                let _lock = self.files_lock.lock().map_err(|e| e.to_string())?;
                let source = w.entry_path(required(&args, "path")?)?;
                let dest = w.resolve(required(&args, "destination")?, true)?;
                if dest.exists() {
                    return Err("Destination existante".into());
                }
                fs::rename(source, dest).map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            "workspace.delete" if !agent => {
                let _lock = self.files_lock.lock().map_err(|e| e.to_string())?;
                let path = w.entry_path(required(&args, "path")?)?;
                if path
                    .symlink_metadata()
                    .map_err(|e| e.to_string())?
                    .file_type()
                    .is_symlink()
                {
                    fs::remove_file(path).map_err(|e| e.to_string())?;
                } else if path.is_dir() {
                    fs::remove_dir(&path).map_err(|e| {
                        format!("Seuls les dossiers vides peuvent être supprimés : {e}")
                    })?;
                } else {
                    fs::remove_file(path).map_err(|e| e.to_string())?;
                }
                Ok(Value::Null)
            }
            "workspace.search_files" | "workspace.search_text" => w.search(
                required(&args, "query")?,
                method.ends_with("files"),
                args["offset"].as_u64().unwrap_or(0) as usize,
            ),
            "plan.get" => self.store.plan(&plan_scope),
            "plan.save" if !agent => {
                let result = self.store.update_plan(
                    &plan_scope,
                    expected()?,
                    args["plan"].clone(),
                    author,
                    "Plan modifié",
                )?;
                let _ = app.emit("plan:changed", json!({"workspaceId":w.id}));
                Ok(result)
            }
            // The agent (or Galeata) keeps the mission plan current: objective and steps.
            "plan.set" => {
                let steps = args["steps"]
                    .as_array()
                    .ok_or("Étapes attendues")?
                    .iter()
                    .map(|step| store::PlanStepInput {
                        id: step["id"].as_str().map(str::to_owned),
                        title: step["title"].as_str().unwrap_or_default().to_owned(),
                        status: step["status"].as_str().map(str::to_owned),
                    })
                    .collect::<Vec<_>>();
                let result = self.store.set_plan_document(
                    &plan_scope,
                    Some(expected()?),
                    required(&args, "objective")?,
                    &steps,
                    args["document"].as_str(),
                    None,
                    author,
                    "Plan mis à jour",
                )?;
                let _ = app.emit("plan:changed", json!({"workspaceId":w.id}));
                Ok(result)
            }
            "plan.update_step" => {
                let mut plan = self.store.plan(&plan_scope)?;
                let id = required(&args, "id")?;
                let status = required(&args, "status")?;
                let step = plan["steps"]
                    .as_array_mut()
                    .ok_or("Plan invalide")?
                    .iter_mut()
                    .find(|s| s["id"] == id)
                    .ok_or("Étape absente")?;
                step["status"] = json!(status);
                step["author"] = json!(author);
                step["updatedAt"] = json!(store::now());
                if let Some(note) = args["note"].as_str() {
                    step["note"] = json!(note)
                }
                // A real status change: progress is tracked from now on.
                if let Some(body) = plan.as_object_mut() {
                    body.remove("tracked");
                    body.remove("proposedAt");
                }
                let result = self.store.update_plan(
                    &plan_scope,
                    expected()?,
                    plan,
                    author,
                    "Avancement mis à jour",
                )?;
                let _ = app.emit("plan:changed", json!({"workspaceId":w.id}));
                Ok(result)
            }
            "plan.propose_change" => {
                let revision = expected()?;
                if self.store.plan(&plan_scope)?["revision"] != revision {
                    return Err(
                        "REVISION_CONFLICT: relisez le plan avant de proposer un changement".into(),
                    );
                }
                let proposal = json!({"objective":args["objective"],"steps":args["steps"],"baseRevision":revision});
                let event = self.store.record(
                    &plan_scope,
                    "proposal",
                    author,
                    required(&args, "reason")?,
                    proposal,
                )?;
                let _ = app.emit("activity:changed", json!({"workspaceId":w.id}));
                Ok(event)
            }
            "activity.list" => {
                let mut events = self.store.events(&w.id)?;
                if args["conversationId"].is_string() {
                    if let Some(items) = events.as_array_mut() {
                        items.retain(|event| event["data"]["conversationScope"] == plan_scope);
                    }
                }
                Ok(events)
            }
            "activity.report" | "verification.record" | "session.save_handoff" => {
                let kind = if method == "verification.record" {
                    "verification"
                } else if method == "session.save_handoff" {
                    "handoff"
                } else {
                    "activity"
                };
                let mut data = args.clone();
                if args["conversationId"].is_string() {
                    data["conversationScope"] = json!(plan_scope);
                }
                data["provenance"] = json!(if agent {
                    "agent_reported"
                } else {
                    "user_reported"
                });
                let event =
                    self.store
                        .record(&w.id, kind, author, required(&args, "message")?, data)?;
                let _ = app.emit("activity:changed", json!({"workspaceId":w.id}));
                Ok(event)
            }
            "verification.run" if !agent => {
                let program = required(&args, "program")?;
                let argv = args["args"]
                    .as_array()
                    .ok_or("Arguments attendus")?
                    .iter()
                    .map(|v| v.as_str().ok_or("Argument invalide"))
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                let output = workspace::run_outcome(
                    &w.root,
                    program,
                    &argv,
                    &[0, 1, 2, 101],
                    Duration::from_secs(120),
                    1024 * 1024,
                );
                let (message, data) = match output {
                    Ok((text, code, stderr)) => (
                        "Commande exécutée par Galeata",
                        json!({"provenance":"galeata_observed","program":program,"args":argv,"stepId":args["stepId"],"exitCode":code,"output":format!("{text}\n{stderr}").chars().take(16000).collect::<String>()}),
                    ),
                    Err(error) => (
                        "Échec d’exécution",
                        json!({"provenance":"galeata_observed","error":error}),
                    ),
                };
                let event = self
                    .store
                    .record(&w.id, "verification", author, message, data)?;
                let _ = app.emit("activity:changed", json!({"workspaceId":w.id}));
                Ok(event)
            }
            "git.status" | "git.get_status" => git::status(&w),
            "git.editor_diff" if !agent => git::editor_diff(&w, required(&args, "path")?),
            "git.diff" | "git.get_diff" => {
                git::diff(&w, required(&args, "path")?, args["staged"] == true)
            }
            "git.mutate" if !agent => {
                let _lock = self.files_lock.lock().map_err(|e| e.to_string())?;
                let result = git::mutate(&w, required(&args, "action")?, &args);
                // A failed merge/pop may still change files and leave conflicts.
                let _ = app.emit("workspace:changed", json!({"workspaceId":w.id}));
                let result = result?;
                self.store.record(
                    &w.id,
                    "git",
                    author,
                    required(&args, "action")?,
                    json!({"path":args["path"],"name":args["name"]}),
                )?;
                Ok(result)
            }
            "git.overview" => git::overview(&w),
            "git.branches" => Ok(json!(git::git(
                &w,
                &["branch", "--format=%(refname:short)"]
            )?
            .lines()
            .collect::<Vec<_>>())),
            "git.worktrees" => Ok(json!(git::git(&w, &["worktree", "list", "--porcelain"])?)),
            "sessions.list" => sessions::discover(&w),
            "providers.list" => Ok(sessions::providers()),
            "terminal.start" if !agent => terminal::start(
                app.clone(),
                &self.terminals,
                &w,
                args["kind"].as_str().unwrap_or("shell"),
                args["sessionId"].as_str(),
                &self.socket,
            ),
            "terminal.input" if !agent => {
                terminal::input(
                    &self.terminals,
                    required(&args, "id")?,
                    required(&args, "data")?,
                )?;
                Ok(Value::Null)
            }
            "terminal.resize" if !agent => {
                terminal::resize(
                    &self.terminals,
                    required(&args, "id")?,
                    args["cols"]
                        .as_u64()
                        .filter(|v| *v <= 1000)
                        .ok_or("Colonnes invalides")? as u16,
                    args["rows"]
                        .as_u64()
                        .filter(|v| *v <= 1000)
                        .ok_or("Lignes invalides")? as u16,
                )?;
                Ok(Value::Null)
            }
            "terminal.close" if !agent => {
                terminal::close(&self.terminals, required(&args, "id")?)?;
                Ok(Value::Null)
            }
            "agent.start" if !agent => agents::start(
                app,
                &self.agents,
                &w,
                required(&args, "provider")?,
                args["resumeId"].as_str(),
                args["mode"].as_str(),
                &self.socket,
            ),
            "agent.send" if !agent => agents::send(
                &self.agents,
                required(&args, "id")?,
                required(&args, "text")?,
                args.get("images").unwrap_or(&Value::Null),
            ),
            "agent.respond" if !agent => agents::respond(
                &self.agents,
                required(&args, "id")?,
                required(&args, "requestId")?,
                required(&args, "decision")?,
            ),
            "agent.answer" if !agent => agents::answer(
                &self.agents,
                required(&args, "id")?,
                required(&args, "requestId")?,
                &args["answer"],
            ),
            "agent.mode" if !agent => agents::set_mode(
                &self.agents,
                required(&args, "id")?,
                required(&args, "mode")?,
            ),
            "agent.models" if !agent => agents::models(&self.agents, required(&args, "id")?),
            "agent.skills" if !agent => skills::list(&w, required(&args, "provider")?),
            "agent.compact" if !agent => agents::compact(&self.agents, required(&args, "id")?),
            "agent.model" if !agent => agents::set_model(
                &self.agents,
                required(&args, "id")?,
                required(&args, "model")?,
            ),
            "agent.interrupt" if !agent => agents::interrupt(&self.agents, required(&args, "id")?),
            "agent.close" if !agent => agents::close(&self.agents, required(&args, "id")?),
            "agent.list" if !agent => agents::list(&self.agents, &w.id),
            "ui.open_file" | "ui.show_diff" => {
                w.resolve(required(&args, "path")?, false)?;
                let _ = app.emit(
                    "ui:request",
                    json!({"workspaceId":w.id,"method":method,"args":args}),
                );
                Ok(json!({"presented":true}))
            }
            "remote.connection" if !agent => remote::connection(&self.store, &w),
            "remote.connect" if !agent => remote::connect(&self.store, &w, &args),
            "remote.disconnect" if !agent => remote::disconnect(&self.store, &w),
            "remote.list" if !agent => remote::list(&self.store, &w),
            "remote.detail" if !agent => remote::detail(
                &self.store,
                &w,
                args["id"].as_u64().ok_or("Identifiant requis")?,
            ),
            "preferences.get" if !agent => self.store.preference(&w.id, "layout"),
            "preferences.save" if !agent => {
                self.store.set_preference(&w.id, "layout", &args)?;
                Ok(Value::Null)
            }
            "mcp.config" if !agent => {
                let bridge = terminal::bridge_path(app)?;
                Ok(
                    json!({"socket":self.socket,"workspaceId":w.id,"bridgeAvailable":bridge.is_file(),"bridge":bridge,"tools":mcp::tools()}),
                )
            }
            _ => Err(format!("Action inconnue ou non autorisée : {method}")),
        }
    }
}

#[tauri::command]
async fn request(
    app: tauri::AppHandle,
    method: String,
    args: Value,
    workspace_id: String,
) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Arc<State>>();
        let _gate = state.workspace_gate.read().map_err(|e| e.to_string())?;
        let current = state.current()?;
        if current.id != workspace_id {
            return Err("WORKSPACE_CHANGED: l’espace de travail a changé".into());
        }
        state.dispatch(&app, &method, args, false)
    })
    .await
    .map_err(|e| e.to_string())?
}
// Git/status, editor reloads and searches must not trigger another refresh just by reading.
fn workspace_event_changes_files(event: &notify::Event) -> bool {
    !matches!(event.kind, notify::EventKind::Access(_))
}

#[cfg(test)]
mod watcher_tests {
    use super::workspace_event_changes_files;
    use notify::{
        event::{AccessKind, AccessMode, CreateKind, DataChange, ModifyKind, RemoveKind},
        Event, EventKind,
    };

    #[test]
    fn reads_do_not_refresh_but_real_file_changes_do() {
        for access in [
            AccessKind::Read,
            AccessKind::Open(AccessMode::Read),
            AccessKind::Close(AccessMode::Read),
            AccessKind::Close(AccessMode::Write),
        ] {
            assert!(!workspace_event_changes_files(&Event::new(
                EventKind::Access(access)
            )));
        }
        for kind in [
            EventKind::Create(CreateKind::File),
            EventKind::Modify(ModifyKind::Data(DataChange::Any)),
            EventKind::Remove(RemoveKind::File),
            EventKind::Any,
        ] {
            assert!(workspace_event_changes_files(&Event::new(kind)));
        }
    }
}

#[tauri::command]
async fn open_workspace(app: tauri::AppHandle, path: String) -> Result<Value> {
    tauri::async_runtime::spawn_blocking(move||{
        let w=Workspace::open(&path)?;let state=app.state::<Arc<State>>();let _gate=state.workspace_gate.write().map_err(|e|e.to_string())?;
        // Existing agents stay associated with their old workspace. Close before switching.
        if state.checks.is_running() { return Err("Attendez ou annulez les contrôles avant de changer de projet".into()); }
        if !state.terminals.lock().map_err(|e|e.to_string())?.is_empty()||agents::any_alive(&state.agents){return Err("Fermez les terminaux et conversations d’agents avant de changer de dossier".into())}
        let event_app=app.clone();let workspace_id=w.id.clone();let last=Arc::new(Mutex::new(std::time::Instant::now()-Duration::from_secs(1)));
        let watched_root = w.root.clone();
        let checks_revision = state.checks.clone();
        checks_revision.revision.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        let mut watcher = notify::recommended_watcher(move |event: std::result::Result<notify::Event, notify::Error>| {
            if let Ok(event) = event {
                if !workspace_event_changes_files(&event) { return; }
                // Build/dependency output must not trigger Git and editor refresh storms.
                if !event.paths.is_empty() && event.paths.iter().all(|path| {
                    path.strip_prefix(&watched_root).ok().is_some_and(|relative| {
                        relative.components().any(|part| matches!(part.as_os_str().to_str(),
                            Some("node_modules" | "target" | "dist" | ".next" | ".cache" | "coverage" | "test-results" | "playwright-report" | "__pycache__" | ".pytest_cache" | ".mypy_cache" | ".ruff_cache" | ".venv")))
                    })
                }) { return; }
                checks_revision.revision.fetch_add(1, std::sync::atomic::Ordering::AcqRel);
                if let Ok(mut instant) = last.lock() {
                    if instant.elapsed() > Duration::from_millis(200) {
                        *instant = std::time::Instant::now();
                        let _ = event_app.emit("workspace:changed", json!({"workspaceId":workspace_id,"paths":event.paths}));
                    }
                }
            }
        }).map_err(|e|e.to_string())?;
        let watched=match watcher.watch(&w.root,RecursiveMode::Recursive){Ok(())=>Some(watcher),Err(error)=>{let _=state.store.record(&w.id,"capability","galeata","Surveillance des fichiers indisponible : actualisez Git et l’arborescence manuellement",json!({"reason":error.to_string()}));None}};
        *state.watcher.lock().map_err(|e|e.to_string())?=watched;
        language::stop_all();
        *state.workspace.lock().map_err(|e|e.to_string())?=Some(w.clone());
        if let Some(window) = app.get_webview_window("main") { let _ = window.set_title(&format!("{} — Galeata", w.name)); }
        Ok(json!(w))
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
fn startup_project() -> Option<String> {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--project" {
            return args.next();
        }
    }
    None
}

#[tauri::command]
fn open_project_window(path: String) -> Result<()> {
    let workspace = Workspace::open(&path)?;
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut child = std::process::Command::new(executable)
        .arg("--project")
        .arg(&workspace.root)
        .spawn()
        .map_err(|e| format!("Impossible d’ouvrir la fenêtre : {e}"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            request,
            open_workspace,
            startup_project,
            open_project_window
        ])
        .setup(|app| {
            let directory = app.path().app_data_dir()?;
            fs::create_dir_all(&directory)?;
            diagnostics::init(directory.join("diagnostics"));
            crash::start(&directory);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
            }
            let socket = directory.join(format!("mcp-{}.sock", std::process::id()));
            let state = Arc::new(State {
                workspace: Mutex::new(None),
                store: Store::open(&directory.join("galeata.sqlite"))
                    .map_err(std::io::Error::other)?,
                terminals: Arc::new(Mutex::new(HashMap::new())),
                agents: Mutex::new(HashMap::new()),
                checks: Arc::new(check_runner::Runner::default()),
                socket,
                watcher: Mutex::new(None),
                files_lock: Mutex::new(()),
                workspace_gate: RwLock::new(()),
            });
            app.manage(Arc::clone(&state));
            mcp::serve(app.handle().clone(), state).map_err(std::io::Error::other)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Impossible de démarrer Galeata");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            diagnostics::record("exit", 0, true);
            let state = handle.state::<Arc<State>>();
            state.checks.cancel_all();
            if let Ok(mut terminals) = state.terminals.lock() {
                for (_, mut terminal) in terminals.drain() {
                    let _ = terminal.killer.kill();
                }
            }
            language::stop_all();
            agents::stop_all(&state.agents);
            let _ = fs::remove_file(&state.socket);
            crash::clean_exit();
        }
    });
}
