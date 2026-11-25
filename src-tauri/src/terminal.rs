use crate::{store::Result, workspace::Workspace};
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager};

pub struct TerminalHandle {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    pub killer: Box<dyn ChildKiller + Send + Sync>,
}
pub type Terminals = Arc<Mutex<HashMap<String, TerminalHandle>>>;
pub fn bridge_path(app: &AppHandle) -> Result<std::path::PathBuf> {
    let sibling = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name("galeata-mcp");
    Ok(if sibling.is_file() {
        sibling
    } else {
        app.path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("galeata-mcp")
    })
}

pub fn start(
    app: AppHandle,
    terminals: &Terminals,
    w: &Workspace,
    kind: &str,
    session: Option<&str>,
    socket: &Path,
) -> Result<Value> {
    if let Some(id) = session {
        uuid::Uuid::parse_str(id).map_err(|_| "Identifiant de session invalide")?;
    }
    let mut command = match kind {
        "shell" => {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
            let mut c = CommandBuilder::new(shell);
            c.arg("-l");
            c
        }
        "codex" | "claude" => CommandBuilder::new(kind),
        _ => return Err("Outil inconnu".into()),
    };
    let bridge = bridge_path(&app)?;
    let bridge_available = bridge.is_file();
    let bridge_args = json!(["--socket", socket.to_string_lossy(), "--workspace", w.id]);
    if kind == "codex" {
        if bridge_available {
            command.args([
                "-c",
                &format!(
                    "mcp_servers.galeata.command={}",
                    json!(bridge.to_string_lossy())
                ),
                "-c",
                &format!("mcp_servers.galeata.args={bridge_args}"),
            ]);
        }
        if let Some(id) = session {
            command.args(["resume", id]);
        }
    } else if kind == "claude" {
        if bridge_available {
            let config = json!({"mcpServers":{"galeata":{"command":bridge.to_string_lossy(),"args":bridge_args}}});
            command.args(["--mcp-config", &config.to_string()]);
        }
        if let Some(id) = session {
            command.args(["--resume", id]);
        }
    }
    command.cwd(&w.root);
    // The shell and agents get the user's environment, not the AppImage runtime's.
    command.env_clear();
    for (key, value) in galeata_agent_protocol::host_env(std::env::vars_os()) {
        command.env(key, value);
    }
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 24,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| e.to_string())?;
    drop(pair.slave);
    let killer = child.clone_killer();
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    terminals.lock().map_err(|e| e.to_string())?.insert(
        id.clone(),
        TerminalHandle {
            writer,
            master: pair.master,
            killer,
        },
    );
    let event_id = id.clone();
    let collection = Arc::clone(terminals);
    let event_app = app.clone();
    std::thread::spawn(move || pump(event_app, collection, event_id, reader, child));
    Ok(json!({"id":id,"kind":kind,"mcpConnected":bridge_available&&kind!="shell"}))
}
fn pump(
    app: AppHandle,
    terminals: Terminals,
    id: String,
    mut reader: Box<dyn Read + Send>,
    mut child: Box<dyn Child + Send + Sync>,
) {
    let mut bytes = [0u8; 4096];
    let mut pending = Vec::new();
    let mut frame = std::time::Instant::now();
    let mut frame_bytes = 0;
    while let Ok(size) = reader.read(&mut bytes) {
        if size == 0 {
            break;
        }
        pending.extend_from_slice(&bytes[..size]);
        let valid = match std::str::from_utf8(&pending) {
            Ok(_) => pending.len(),
            Err(e) if e.error_len().is_none() => e.valid_up_to(),
            Err(_) => pending.len(),
        };
        if valid > 0 {
            let data = String::from_utf8_lossy(&pending[..valid]).into_owned();
            let _ = app.emit("terminal:output", json!({"id":id,"data":data}));
            pending.drain(..valid);
        }
        frame_bytes += size;
        if frame_bytes >= 65536 {
            let budget = std::time::Duration::from_millis(16);
            if frame.elapsed() < budget {
                std::thread::sleep(budget.saturating_sub(frame.elapsed()));
            }
            frame = std::time::Instant::now();
            frame_bytes = 0;
        }
    }
    let status = child.wait().map(|s| s.exit_code()).unwrap_or(1);
    if let Ok(mut map) = terminals.lock() {
        map.remove(&id);
    }
    let _ = app.emit("terminal:exit", json!({"id":id,"code":status}));
}
pub fn input(terminals: &Terminals, id: &str, data: &str) -> Result<()> {
    if data.len() > 65536 {
        return Err("Entrée trop volumineuse".into());
    }
    let mut map = terminals.lock().map_err(|e| e.to_string())?;
    let term = map.get_mut(id).ok_or("Terminal fermé")?;
    term.writer
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    term.writer.flush().map_err(|e| e.to_string())
}
pub fn resize(terminals: &Terminals, id: &str, cols: u16, rows: u16) -> Result<()> {
    if cols == 0 || rows == 0 || cols > 1000 || rows > 1000 {
        return Err("Dimensions invalides".into());
    }
    terminals
        .lock()
        .map_err(|e| e.to_string())?
        .get(id)
        .ok_or("Terminal fermé")?
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}
pub fn close(terminals: &Terminals, id: &str) -> Result<()> {
    if let Some(mut term) = terminals.lock().map_err(|e| e.to_string())?.remove(id) {
        term.killer.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}
