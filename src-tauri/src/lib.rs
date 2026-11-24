pub mod store;
pub mod workspace;
mod git;
mod sessions;
mod terminal;
mod remote;
mod mcp;

use notify::{RecommendedWatcher,RecursiveMode,Watcher};
use serde_json::{json,Value};
use std::{collections::HashMap,fs,path::PathBuf,sync::{Arc,Mutex,RwLock},time::Duration};
use store::{Result,Store};
use tauri::{Emitter,Manager};
use workspace::Workspace;

pub struct State {
    pub workspace:Mutex<Option<Workspace>>,
    pub store:Store,
    pub terminals:terminal::Terminals,
    pub socket:PathBuf,
    watcher:Mutex<Option<RecommendedWatcher>>,
    files_lock:Mutex<()>,
    workspace_gate:RwLock<()>,
}
fn required<'a>(v:&'a Value,key:&str)->Result<&'a str>{v[key].as_str().ok_or_else(||format!("{key} requis"))}
impl State {
    fn current(&self)->Result<Workspace>{self.workspace.lock().map_err(|e|e.to_string())?.clone().ok_or("Ouvrez un dossier".into())}
    pub fn dispatch(&self,app:&tauri::AppHandle,method:&str,args:Value,agent:bool)->Result<Value>{
        let w=self.current()?;
        let author=if agent{"agent:mcp"}else{"vous"};
        let expected=||args["revision"].as_u64().ok_or("Révision requise".to_string());
        match method {
            "workspace.context"|"workspace.get_context"=>Ok(json!({"workspace":w,"git":git::status(&w)?,"plan":self.store.plan(&w.id)?,"instructions":["AGENTS.md","CLAUDE.md"].iter().filter_map(|p|w.read(p).ok().map(|v|json!({"path":p,"content":v["content"]}))).collect::<Vec<_>>()})),
            "workspace.list"=>w.list(args["path"].as_str().unwrap_or(""),args["offset"].as_u64().unwrap_or(0) as usize),
            "workspace.read"=>w.read(required(&args,"path")?),
            "workspace.write" if !agent=>{let _lock=self.files_lock.lock().map_err(|e|e.to_string())?;w.write(required(&args,"path")?,required(&args,"content")?,required(&args,"stamp")?)},
            "workspace.create" if !agent=>{let _lock=self.files_lock.lock().map_err(|e|e.to_string())?;let path=w.resolve(required(&args,"path")?,true)?;if args["directory"]==true{fs::create_dir(path).map_err(|e|e.to_string())?;}else{fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|e|e.to_string())?;}Ok(Value::Null)},
            "workspace.rename" if !agent=>{let _lock=self.files_lock.lock().map_err(|e|e.to_string())?;let source=w.entry_path(required(&args,"path")?)?;let dest=w.resolve(required(&args,"destination")?,true)?;if dest.exists(){return Err("Destination existante".into())}fs::rename(source,dest).map_err(|e|e.to_string())?;Ok(Value::Null)},
            "workspace.delete" if !agent=>{let _lock=self.files_lock.lock().map_err(|e|e.to_string())?;let path=w.entry_path(required(&args,"path")?)?;if path.symlink_metadata().map_err(|e|e.to_string())?.file_type().is_symlink(){fs::remove_file(path).map_err(|e|e.to_string())?;}else if path.is_dir(){fs::remove_dir(&path).map_err(|e|format!("Seuls les dossiers vides peuvent être supprimés : {e}"))?;}else{fs::remove_file(path).map_err(|e|e.to_string())?;}Ok(Value::Null)},
            "workspace.search_files"|"workspace.search_text"=>w.search(required(&args,"query")?,method.ends_with("files"),args["offset"].as_u64().unwrap_or(0) as usize),
            "plan.get"=>self.store.plan(&w.id),
            "plan.save" if !agent=>{let result=self.store.update_plan(&w.id,expected()?,args["plan"].clone(),author,"Plan modifié")?;let _=app.emit("plan:changed",json!({"workspaceId":w.id}));Ok(result)},
            "plan.update_step"=>{let mut plan=self.store.plan(&w.id)?;let id=required(&args,"id")?;let status=required(&args,"status")?;let step=plan["steps"].as_array_mut().ok_or("Plan invalide")?.iter_mut().find(|s|s["id"]==id).ok_or("Étape absente")?;step["status"]=json!(status);step["author"]=json!(author);step["updatedAt"]=json!(store::now());if let Some(note)=args["note"].as_str(){step["note"]=json!(note)}let result=self.store.update_plan(&w.id,expected()?,plan,author,"Avancement mis à jour")?;let _=app.emit("plan:changed",json!({"workspaceId":w.id}));Ok(result)},
            "plan.propose_change"=>{let proposal=json!({"objective":args["objective"],"steps":args["steps"],"baseRevision":self.store.plan(&w.id)?["revision"]});let event=self.store.record(&w.id,"proposal",author,required(&args,"reason")?,proposal)?;let _=app.emit("activity:changed",json!({"workspaceId":w.id}));Ok(event)},
            "activity.list"=>self.store.events(&w.id),
            "activity.report"|"verification.record"|"session.save_handoff"=>{let kind=if method=="verification.record"{"verification"}else if method=="session.save_handoff"{"handoff"}else{"activity"};let mut data=args.clone();data["provenance"]=json!(if agent{"agent_reported"}else{"user_reported"});let event=self.store.record(&w.id,kind,author,required(&args,"message")?,data)?;let _=app.emit("activity:changed",json!({"workspaceId":w.id}));Ok(event)},
            "verification.run" if !agent=>{let program=required(&args,"program")?;let argv=args["args"].as_array().ok_or("Arguments attendus")?.iter().map(|v|v.as_str().ok_or("Argument invalide")).collect::<std::result::Result<Vec<_>,_>>()?;let output=workspace::run_outcome(&w.root,program,&argv,&[0,1,2,101],Duration::from_secs(120),1024*1024);let (message,data)=match output{Ok((text,code))=>("Commande exécutée par Galeata",json!({"provenance":"galeata_observed","program":program,"args":argv,"exitCode":code,"output":text.chars().take(16000).collect::<String>()})),Err(error)=>("Échec d’exécution",json!({"provenance":"galeata_observed","error":error}))};let event=self.store.record(&w.id,"verification",author,message,data)?;let _=app.emit("activity:changed",json!({"workspaceId":w.id}));Ok(event)},
            "git.status"|"git.get_status"=>git::status(&w),
            "git.diff"|"git.get_diff"=>git::diff(&w,required(&args,"path")?,args["staged"]==true),
            "git.mutate" if !agent=>{let result=git::mutate(&w,required(&args,"action")?,&args)?;self.store.record(&w.id,"git",author,required(&args,"action")?,json!({"path":args["path"]}))?;Ok(result)},
            "git.branches"=>Ok(json!(git::git(&w,&["branch","--format=%(refname:short)"])?.lines().collect::<Vec<_>>())),
            "git.worktrees"=>Ok(json!(git::git(&w,&["worktree","list","--porcelain"])?)),
            "sessions.list"=>sessions::discover(&w),
            "providers.list"=>Ok(sessions::providers()),
            "terminal.start" if !agent=>terminal::start(app.clone(),&self.terminals,&w,args["kind"].as_str().unwrap_or("shell"),args["sessionId"].as_str(),&self.socket),
            "terminal.input" if !agent=>{terminal::input(&self.terminals,required(&args,"id")?,required(&args,"data")?)?;Ok(Value::Null)},
            "terminal.resize" if !agent=>{terminal::resize(&self.terminals,required(&args,"id")?,args["cols"].as_u64().filter(|v|*v<=1000).ok_or("Colonnes invalides")? as u16,args["rows"].as_u64().filter(|v|*v<=1000).ok_or("Lignes invalides")? as u16)?;Ok(Value::Null)},
            "terminal.close" if !agent=>{terminal::close(&self.terminals,required(&args,"id")?)?;Ok(Value::Null)},
            "ui.open_file"|"ui.show_diff"=>{w.resolve(required(&args,"path")?,false)?;let _=app.emit("ui:request",json!({"workspaceId":w.id,"method":method,"args":args}));Ok(json!({"presented":true}))},
            "remote.connection" if !agent=>remote::connection(&self.store,&w),
            "remote.connect" if !agent=>remote::connect(&self.store,&w,&args),
            "remote.disconnect" if !agent=>remote::disconnect(&self.store,&w),
            "remote.list" if !agent=>remote::list(&self.store,&w),
            "remote.detail" if !agent=>remote::detail(&self.store,&w,args["id"].as_u64().ok_or("Identifiant requis")?),
            "preferences.get" if !agent=>self.store.preference(&w.id,"layout"),
            "preferences.save" if !agent=>{self.store.set_preference(&w.id,"layout",&args)?;Ok(Value::Null)},
            "mcp.config" if !agent=>{let bridge=terminal::bridge_path(app)?;Ok(json!({"socket":self.socket,"workspaceId":w.id,"bridgeAvailable":bridge.is_file(),"bridge":bridge,"tools":mcp::tools()}))},
            _=>Err(format!("Action inconnue ou non autorisée : {method}"))
        }
    }
}

#[tauri::command]
async fn request(app:tauri::AppHandle,method:String,args:Value,workspace_id:String)->Result<Value>{
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<Arc<State>>();let _gate=state.workspace_gate.read().map_err(|e|e.to_string())?;let current=state.current()?;if current.id!=workspace_id{return Err("WORKSPACE_CHANGED: l’espace de travail a changé".into())}state.dispatch(&app,&method,args,false)
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
async fn open_workspace(app:tauri::AppHandle,path:String)->Result<Value>{
    tauri::async_runtime::spawn_blocking(move||{
        let w=Workspace::open(&path)?;let state=app.state::<Arc<State>>();let _gate=state.workspace_gate.write().map_err(|e|e.to_string())?;
        // Existing agents stay associated with their old workspace. Close before switching.
        if !state.terminals.lock().map_err(|e|e.to_string())?.is_empty(){return Err("Fermez les terminaux et agents avant de changer de dossier".into())}
        let event_app=app.clone();let workspace_id=w.id.clone();let last=Arc::new(Mutex::new(std::time::Instant::now()-Duration::from_secs(1)));
        let mut watcher=notify::recommended_watcher(move|event:std::result::Result<notify::Event,notify::Error>|{if let Ok(event)=event{if let Ok(mut instant)=last.lock(){if instant.elapsed()>Duration::from_millis(200){*instant=std::time::Instant::now();let _=event_app.emit("workspace:changed",json!({"workspaceId":workspace_id,"paths":event.paths}));}}}}).map_err(|e|e.to_string())?;
        watcher.watch(&w.root,RecursiveMode::Recursive).map_err(|e|e.to_string())?;
        *state.watcher.lock().map_err(|e|e.to_string())?=Some(watcher);
        *state.workspace.lock().map_err(|e|e.to_string())?=Some(w.clone());
        Ok(json!(w))
    }).await.map_err(|e|e.to_string())?
}

pub fn run(){
    let app=tauri::Builder::default().plugin(tauri_plugin_dialog::init()).invoke_handler(tauri::generate_handler![request,open_workspace]).setup(|app|{
        let directory=app.path().app_data_dir()?;fs::create_dir_all(&directory)?;
        #[cfg(unix)]{use std::os::unix::fs::PermissionsExt;fs::set_permissions(&directory,fs::Permissions::from_mode(0o700))?;}
        let socket=directory.join(format!("mcp-{}.sock",std::process::id()));
        let state=Arc::new(State{workspace:Mutex::new(None),store:Store::open(&directory.join("galeata.sqlite")).map_err(std::io::Error::other)?,terminals:Arc::new(Mutex::new(HashMap::new())),socket,watcher:Mutex::new(None),files_lock:Mutex::new(()),workspace_gate:RwLock::new(())});
        app.manage(Arc::clone(&state));mcp::serve(app.handle().clone(),state).map_err(std::io::Error::other)?;Ok(())
    }).build(tauri::generate_context!()).expect("Impossible de démarrer Galeata");
    app.run(|handle,event|{if matches!(event,tauri::RunEvent::Exit){let state=handle.state::<Arc<State>>();if let Ok(mut terminals)=state.terminals.lock(){for (_,mut terminal) in terminals.drain(){let _=terminal.killer.kill();}}let _=fs::remove_file(&state.socket);}});
}
