//! Bounded, UI-only JSON-RPC transport for local language servers.
use crate::{store::Result, workspace::Workspace};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    process::{Child, Command, Stdio},
    sync::{mpsc, Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
struct Server {
    child: Child,
    input: mpsc::SyncSender<(Value, mpsc::SyncSender<Result<()>>)>,
    output: mpsc::Receiver<Value>,
    sequence: u64,
    documents: HashMap<String, String>,
    capabilities: Value,
    versions: HashMap<String, u64>,
    diagnostics: Arc<Mutex<HashMap<String, Value>>>,
    settings: Value,
}
impl Drop for Server {
    fn drop(&mut self) {
        let _ = nix::sys::signal::killpg(
            nix::unistd::Pid::from_raw(self.child.id() as i32),
            nix::sys::signal::Signal::SIGKILL,
        );
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
static SERVERS: OnceLock<Mutex<HashMap<String, Server>>> = OnceLock::new();
fn command(language: &str) -> Option<(&'static str, &'static [&'static str])> {
    Some(match language {
        "rust" => ("rust-analyzer", &[]),
        "python" => ("pyright-langserver", &["--stdio"]),
        "typescript" | "javascript" => ("typescript-language-server", &["--stdio"]),
        "go" => ("gopls", &[]),
        "c" | "cpp" | "objective-c" => ("clangd", &[]),
        "html" => ("vscode-html-language-server", &["--stdio"]),
        "css" | "scss" | "less" => ("vscode-css-language-server", &["--stdio"]),
        "json" => ("vscode-json-language-server", &["--stdio"]),
        "yaml" => ("yaml-language-server", &["--stdio"]),
        "shell" => ("bash-language-server", &["start"]),
        "vue" => ("vue-language-server", &["--stdio"]),
        "svelte" => ("svelteserver", &["--stdio"]),
        "lua" => ("lua-language-server", &[]),
        "zig" => ("zls", &[]),
        "ruby" => ("solargraph", &["stdio"]),
        "php" => ("intelephense", &["--stdio"]),
        _ => return None,
    })
}
impl Server {
    fn send(&mut self, value: Value) -> Result<()> {
        let (sender, receiver) = mpsc::sync_channel(1);
        self.input
            .try_send((value, sender))
            .map_err(|_| "Écriture du serveur indisponible".to_string())?;
        let result = receiver
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "Délai d’écriture du serveur dépassé".to_string())
            .and_then(|result| result);
        if result.is_err() {
            let _ = self.child.kill();
        }
        result
    }

    fn notify(&mut self, method: &str, params: Value) -> Result<()> {
        self.send(json!({"jsonrpc":"2.0","method":method,"params":params}))
    }
    fn call(&mut self, method: &str, params: Value) -> Result<Value> {
        self.sequence += 1;
        let id = self.sequence;
        self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))?;
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let value = self
                .output
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| "Serveur de langage indisponible ou délai dépassé".to_string())?;
            if value["id"].as_u64() == Some(id) && value.get("method").is_none() {
                if value.get("error").is_some() {
                    return Err(value["error"].to_string());
                }
                return Ok(value["result"].clone());
            }
            if value.get("id").is_some() && value.get("method").is_some() {
                let response = match value["method"].as_str() {
                    Some("workspace/configuration") => Value::Array(
                        value["params"]["items"]
                            .as_array()
                            .map(|items| {
                                items
                                    .iter()
                                    .map(|item| {
                                        item["section"]
                                            .as_str()
                                            .and_then(|section| self.settings.get(section))
                                            .cloned()
                                            .unwrap_or_else(|| self.settings.clone())
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                    ),
                    Some("workspace/workspaceFolders") => Value::Null,
                    _ => Value::Null,
                };
                self.send(json!({"jsonrpc":"2.0","id":value["id"],"result":response}))?;
            }
        }
    }
    fn start(workspace: &Workspace, language: &str) -> Result<Self> {
        let (program, args) = command(language).ok_or("Aucun serveur configuré pour ce langage")?;
        Self::start_configured(
            workspace,
            program,
            args,
            if ["json", "html", "css", "scss", "less"].contains(&language) {
                json!({"provideFormatter":true})
            } else {
                Value::Null
            },
            json!({}),
        )
    }
    #[cfg(test)]
    fn start_program(workspace: &Workspace, program: &str, args: &[&str]) -> Result<Self> {
        Self::start_configured(workspace, program, args, Value::Null, json!({}))
    }
    fn start_configured(
        workspace: &Workspace,
        program: &str,
        args: &[&str],
        initialization: Value,
        settings: Value,
    ) -> Result<Self> {
        use std::os::unix::process::CommandExt;
        let program_path = std::path::Path::new(program);
        let executable = if program_path.is_relative() && program.contains('/') {
            workspace.root.join(program_path)
        } else {
            program_path.to_path_buf()
        };
        let mut child = Command::new(executable)
            .args(args)
            .current_dir(&workspace.root)
            .env_clear()
            .envs(galeata_agent_protocol::host_env(std::env::vars_os()))
            .process_group(0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| format!("Serveur requis : {program}"))?;
        let mut input_pipe = child.stdin.take().ok_or("Entrée du serveur indisponible")?;
        let (input, writes) = mpsc::sync_channel::<(Value, mpsc::SyncSender<Result<()>>)>(1);
        std::thread::spawn(move || {
            while let Ok((value, reply)) = writes.recv() {
                let result = (|| -> Result<()> {
                    let data = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
                    write!(input_pipe, "Content-Length: {}\r\n\r\n", data.len())
                        .map_err(|e| e.to_string())?;
                    input_pipe.write_all(&data).map_err(|e| e.to_string())?;
                    input_pipe.flush().map_err(|e| e.to_string())
                })();
                let failed = result.is_err();
                let _ = reply.send(result);
                if failed {
                    break;
                }
            }
        });
        let output = child
            .stdout
            .take()
            .ok_or("Sortie du serveur indisponible")?;
        let (sender, receiver) = mpsc::sync_channel(128);
        let diagnostics = Arc::new(Mutex::new(HashMap::new()));
        let incoming_diagnostics = diagnostics.clone();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(output);
            loop {
                let mut length = None;
                loop {
                    let mut line = String::new();
                    match Read::by_ref(&mut reader).take(8193).read_line(&mut line) {
                        Ok(0) | Err(_) => return,
                        _ => {}
                    }
                    if line == "\r\n" || line == "\n" {
                        break;
                    }
                    if line.len() > 8192 {
                        return;
                    }
                    if let Some((name, value)) = line.split_once(':') {
                        if name.eq_ignore_ascii_case("content-length") {
                            length = value.trim().parse::<usize>().ok();
                        }
                    }
                }
                let length = match length {
                    Some(n) if n <= 8 * 1024 * 1024 => n,
                    _ => return,
                };
                let mut bytes = vec![0; length];
                if reader.read_exact(&mut bytes).is_err() {
                    return;
                }
                let value: Value = match serde_json::from_slice(&bytes) {
                    Ok(v) => v,
                    Err(_) => return,
                };
                if value["method"] == "textDocument/publishDiagnostics" {
                    if let Some(uri) = value["params"]["uri"].as_str() {
                        if let Ok(mut entries) = incoming_diagnostics.lock() {
                            if entries.len() < 128 || entries.contains_key(uri) {
                                entries.insert(
                                    uri.to_string(),
                                    value["params"]["diagnostics"].clone(),
                                );
                            }
                        }
                    }
                }
                // Drop notifications; only bounded responses and server requests are queued.
                if value.get("id").is_some() && sender.send(value).is_err() {
                    return;
                }
            }
        });
        let mut server = Self {
            child,
            input,
            output: receiver,
            sequence: 0,
            documents: HashMap::new(),
            capabilities: Value::Null,
            versions: HashMap::new(),
            diagnostics,
            settings,
        };
        let uri =
            url::Url::from_directory_path(&workspace.root).map_err(|_| "Chemin projet invalide")?;
        let result = server.call("initialize", json!({"processId":std::process::id(),"rootUri":uri.as_str(),"initializationOptions":initialization,"workspaceFolders":[{"uri":uri.as_str(),"name":workspace.name}],"capabilities":{"general":{"positionEncodings":["utf-16"]},"workspace":{"configuration":true,"workspaceFolders":true},"textDocument":{"publishDiagnostics":{"relatedInformation":true,"versionSupport":true},"definition":{"linkSupport":true},"documentSymbol":{"hierarchicalDocumentSymbolSupport":true},"codeAction":{"dataSupport":true,"resolveSupport":{"properties":["edit"]},"codeActionLiteralSupport":{"codeActionKind":{"valueSet":["quickfix","refactor","source.organizeImports"]}}},"synchronization":{"dynamicRegistration":false},"completion":{"completionItem":{"snippetSupport":false}},"hover":{"contentFormat":["plaintext"]}}}}))?;
        server.capabilities = result["capabilities"].clone();
        server.notify("initialized", json!({}))?;
        if !server.settings.is_null() {
            server.notify(
                "workspace/didChangeConfiguration",
                json!({"settings":server.settings}),
            )?;
        }
        Ok(server)
    }
}
pub fn dispatch(workspace: &Workspace, args: &Value) -> Result<Value> {
    let mut servers = SERVERS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|e| e.to_string())?;
    servers.retain(|key, _| key.starts_with(&format!("{}:", workspace.id)));
    let language = args["language"].as_str().ok_or("Langage requis")?;
    if args["method"] == "close" {
        let path = args["path"].as_str().ok_or("Fichier requis")?;
        Workspace::validate_relative(path)?;
        let raw_uri = url::Url::from_file_path(workspace.root.join(path))
            .map_err(|_| "Chemin invalide")?
            .to_string();
        let canonical_uri = workspace
            .resolve(path, false)
            .ok()
            .and_then(|path| url::Url::from_file_path(path).ok())
            .map(|uri| uri.to_string());
        for server in servers.values_mut() {
            for uri in [Some(raw_uri.as_str()), canonical_uri.as_deref()]
                .into_iter()
                .flatten()
            {
                if server.documents.remove(uri).is_some() {
                    let _ =
                        server.notify("textDocument/didClose", json!({"textDocument":{"uri":uri}}));
                    server.versions.remove(uri);
                    if let Ok(mut diagnostics) = server.diagnostics.lock() {
                        diagnostics.remove(uri);
                    }
                }
            }
        }
        servers.retain(|_, server| !server.documents.is_empty());
        return Ok(Value::Null);
    }
    let config = &args["configuration"][language];
    let language_workspace = server_workspace(workspace, args, config, language)?;
    let family = if ["javascript", "typescript"].contains(&language)
        && args["configuration"]["javascript"] == args["configuration"]["typescript"]
    {
        "typescript"
    } else {
        language
    };
    let key = format!(
        "{}:{}:{family}",
        workspace.id,
        language_workspace.root.display()
    );
    if args["method"] == "stop" {
        servers.retain(|key, _| !key.ends_with(&format!(":{family}")));
        return Ok(Value::Null);
    }
    let method = args["method"].as_str().ok_or("Méthode requise")?;
    if ![
        "capabilities",
        "diagnostics",
        "textDocument/rename",
        "textDocument/codeAction",
        "codeAction/resolve",
        "textDocument/definition",
        "textDocument/implementation",
        "textDocument/references",
        "textDocument/hover",
        "textDocument/completion",
        "textDocument/signatureHelp",
        "textDocument/documentSymbol",
        "workspace/symbol",
        "textDocument/formatting",
        "textDocument/rangeFormatting",
    ]
    .contains(&method)
    {
        return Err("Méthode de langage non autorisée".into());
    }
    if !servers.contains_key(&key) {
        if servers.len() >= 8 {
            return Err("Limite de serveurs actifs atteinte".into());
        }
        let server = if let Some(program) = config["command"].as_str() {
            let arguments: Vec<&str> = config["args"]
                .as_array()
                .map(|items| items.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            Server::start_configured(
                &language_workspace,
                program,
                &arguments,
                config["initializationOptions"].clone(),
                config["settings"].clone(),
            )?
        } else if !config.is_null() {
            let (program, arguments) =
                command(language).ok_or("Aucun serveur configuré pour ce langage")?;
            Server::start_configured(
                &language_workspace,
                program,
                arguments,
                config["initializationOptions"].clone(),
                config["settings"].clone(),
            )?
        } else {
            Server::start(&language_workspace, language)?
        };
        servers.insert(key.clone(), server);
    }
    let server = servers.get_mut(&key).ok_or("Serveur indisponible")?;
    if method == "capabilities" {
        return Ok(server.capabilities.clone());
    }
    let path = args["path"].as_str().ok_or("Fichier requis")?;
    let resolved = workspace.resolve(path, false)?;
    let uri = url::Url::from_file_path(resolved)
        .map_err(|_| "Chemin invalide")?
        .to_string();
    let content = args["content"].as_str().ok_or("Contenu requis")?;
    if content.len() > 2 * 1024 * 1024 {
        return Err("Fichier trop volumineux pour le serveur de langage".into());
    }
    if !server.documents.contains_key(&uri) {
        if server.documents.len() >= 128 {
            return Err("Limite de documents du serveur atteinte".into());
        }
        server.notify(
            "textDocument/didOpen",
            json!({"textDocument":{"uri":uri,"languageId":language,"version":1,"text":content}}),
        )?;
    } else if server.documents.get(&uri).map(String::as_str) != Some(content) {
        server.sequence += 1;
        let old = &server.documents[&uri];
        let line = old.bytes().filter(|byte| *byte == b'\n').count();
        let character = old.rsplit('\n').next().unwrap_or("").encode_utf16().count();
        let sync = &server.capabilities["textDocumentSync"];
        let incremental = sync.as_u64() == Some(2) || sync["change"].as_u64() == Some(2);
        let change = if incremental {
            json!({"range":{"start":{"line":0,"character":0},"end":{"line":line,"character":character}},"text":content})
        } else {
            json!({"text":content})
        };
        server.notify(
            "textDocument/didChange",
            json!({"textDocument":{"uri":uri,"version":server.sequence},"contentChanges":[change]}),
        )?;
    }
    if !server.documents.contains_key(&uri) {
        server.versions.insert(uri.clone(), 1);
    } else if server.documents.get(&uri).map(String::as_str) != Some(content) {
        server.versions.insert(uri.clone(), server.sequence);
    }
    server.documents.insert(uri.clone(), content.into());
    if method == "diagnostics" {
        return Ok(server
            .diagnostics
            .lock()
            .map_err(|e| e.to_string())?
            .get(&uri)
            .cloned()
            .unwrap_or(json!([])));
    }
    let mut params = args["params"].as_object().cloned().unwrap_or_default();
    if method.starts_with("textDocument/") {
        params.insert("textDocument".into(), json!({"uri":uri}));
    }
    let started = std::time::SystemTime::now();
    let result = server
        .call(method, Value::Object(params))
        .and_then(|value| {
            let edit = if method == "textDocument/rename" {
                &value
            } else {
                &value["edit"]
            };
            if let Some(changes) = edit["documentChanges"].as_array() {
                for change in changes {
                    if let Some(version) = change["textDocument"]["version"].as_u64() {
                        let changed_uri = change["textDocument"]["uri"]
                            .as_str()
                            .ok_or("Document de modification invalide")?;
                        if server.versions.get(changed_uri) != Some(&version) {
                            return Err("La version du document de refactorisation a changé".into());
                        }
                    }
                }
            }
            let mut value = value;
            if method == "textDocument/rename" {
                annotate_edit(workspace, &mut value, started, &server.versions)?;
            } else if method == "textDocument/codeAction" {
                if let Some(actions) = value.as_array_mut() {
                    for action in actions {
                        if !action["edit"].is_null() {
                            annotate_edit(
                                workspace,
                                &mut action["edit"],
                                started,
                                &server.versions,
                            )?;
                        }
                    }
                }
            } else if method == "codeAction/resolve" && !value["edit"].is_null() {
                annotate_edit(workspace, &mut value["edit"], started, &server.versions)?;
            }
            Ok(value)
        });
    if result.is_err() {
        servers.remove(&key);
    }
    result
}

fn annotate_edit(
    workspace: &Workspace,
    edit: &mut Value,
    started: std::time::SystemTime,
    versions: &HashMap<String, u64>,
) -> Result<()> {
    if edit.is_null() {
        return Ok(());
    }
    let mut uris: Vec<String> = edit["changes"]
        .as_object()
        .map(|changes| changes.keys().cloned().collect())
        .unwrap_or_default();
    if let Some(changes) = edit["documentChanges"].as_array() {
        for change in changes {
            if change.get("kind").is_some() {
                return Err("Opération de fichier non prise en charge dans une correction".into());
            }
            if let Some(version) = change["textDocument"]["version"].as_u64() {
                let uri = change["textDocument"]["uri"]
                    .as_str()
                    .ok_or("URI de modification requise")?;
                if versions.get(uri) != Some(&version) {
                    return Err("La version d’une modification a changé".into());
                }
            }
            uris.push(
                change["textDocument"]["uri"]
                    .as_str()
                    .ok_or("URI de modification requise")?
                    .into(),
            );
        }
    }
    uris.sort();
    uris.dedup();
    if uris.len() > 100 {
        return Err("Trop de fichiers modifiés par cette action".into());
    }
    let mut stamps = serde_json::Map::new();
    for uri in uris {
        let path = url::Url::parse(&uri)
            .map_err(|_| "URI invalide")?
            .to_file_path()
            .map_err(|_| "URI locale requise")?;
        let relative = path
            .strip_prefix(&workspace.root)
            .map_err(|_| "Modification hors du projet")?;
        let relative = relative.to_str().ok_or("Chemin non UTF-8")?;
        let resolved = workspace.resolve(relative, false)?;
        if std::fs::metadata(resolved)
            .and_then(|metadata| metadata.modified())
            .map_err(|error| error.to_string())?
            > started
        {
            return Err("Un fichier a changé pendant la refactorisation".into());
        }
        stamps.insert(uri, workspace.read(relative)?["stamp"].clone());
    }
    edit["_galeataStamps"] = Value::Object(stamps);
    Ok(())
}

pub fn stop_all() {
    if let Some(servers) = SERVERS.get() {
        if let Ok(mut servers) = servers.lock() {
            servers.clear();
        }
    }
}

pub fn validate_configuration(value: &Value) -> Result<()> {
    let languages = value
        .as_object()
        .ok_or("La configuration doit être un objet JSON")?;
    if languages.len() > 80 || value.to_string().len() > 131072 {
        return Err("Configuration trop volumineuse".into());
    }
    for (language, config) in languages {
        if language.is_empty()
            || !language
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '-')
            || !config.is_object()
        {
            return Err("Identifiant de langage invalide".into());
        }
        for key in ["command", "args"] {
            if key == "command"
                && config.get(key).is_some()
                && config[key]
                    .as_str()
                    .is_none_or(|command| command.is_empty() || command.len() > 4096)
            {
                return Err("Commande de serveur invalide".into());
            }
            if key == "args"
                && config.get(key).is_some()
                && config[key].as_array().is_none_or(|args| {
                    args.len() > 64
                        || args
                            .iter()
                            .any(|arg| arg.as_str().is_none_or(|arg| arg.len() > 8192))
                })
            {
                return Err("Arguments de serveur invalides".into());
            }
        }
        if let Some(markers) = config.get("rootMarkers") {
            if markers.as_array().is_none_or(|markers| {
                markers.len() > 16
                    || markers.iter().any(|marker| {
                        marker.as_str().is_none_or(|marker| {
                            marker.is_empty() || marker.contains('/') || marker == ".."
                        })
                    })
            }) {
                return Err("Marqueur de racine invalide".into());
            }
        }
        if let Some(formatter) = config.get("formatter") {
            if formatter["command"]
                .as_str()
                .is_none_or(|command| command.is_empty() || command.len() > 4096)
                || formatter["args"].as_array().is_none_or(|args| {
                    args.len() > 64
                        || args
                            .iter()
                            .any(|arg| arg.as_str().is_none_or(|arg| arg.len() > 8192))
                })
            {
                return Err("Formateur invalide : command et args sont requis".into());
            }
        }
    }
    Ok(())
}
pub fn format(workspace: &Workspace, args: &Value, configuration: &Value) -> Result<Value> {
    let language = args["language"].as_str().ok_or("Langage requis")?;
    let formatter = &configuration[language]["formatter"];
    let Some(program) = formatter["command"].as_str() else {
        return Ok(Value::Null);
    };
    let path = args["path"].as_str().ok_or("Fichier requis")?;
    let resolved = workspace.resolve(path, false)?;
    let content = args["content"].as_str().ok_or("Contenu requis")?;
    if content.len() > 2 * 1024 * 1024 {
        return Err("Fichier trop volumineux pour le formateur".into());
    }
    let arguments: Vec<String> = formatter["args"]
        .as_array()
        .ok_or("Arguments de formateur invalides")?
        .iter()
        .map(|arg| {
            arg.as_str()
                .unwrap_or("")
                .replace("{path}", &resolved.to_string_lossy())
                .replace("{relativePath}", path)
        })
        .collect();
    let arguments: Vec<&str> = arguments.iter().map(String::as_str).collect();
    let language_workspace = server_workspace(workspace, args, &configuration[language], language)?;
    let (output, _, _) = crate::workspace::run_with_input(
        &language_workspace.root,
        program,
        &arguments,
        &[0],
        Duration::from_secs(15),
        2 * 1024 * 1024,
        Some(content.as_bytes().to_vec()),
    )?;
    Ok(json!(output))
}

fn server_workspace(
    workspace: &Workspace,
    args: &Value,
    config: &Value,
    language: &str,
) -> Result<Workspace> {
    let mut language_workspace = workspace.clone();
    if let Some(path) = args["path"].as_str() {
        let resolved = workspace.resolve(path, false)?;
        let markers: Vec<&str> = config["rootMarkers"]
            .as_array()
            .map(|items| items.iter().filter_map(Value::as_str).collect())
            .unwrap_or_else(|| match language {
                "rust" => vec!["Cargo.toml"],
                "python" => vec!["pyproject.toml", "pyrightconfig.json"],
                "go" => vec!["go.mod"],
                "javascript" | "typescript" | "vue" | "svelte" => {
                    vec!["tsconfig.json", "jsconfig.json", "package.json"]
                }
                _ => vec![],
            });
        let mut directory = resolved.parent();
        while let Some(candidate) = directory {
            if !candidate.starts_with(&workspace.root) {
                break;
            }
            if markers
                .iter()
                .any(|marker| candidate.join(marker).is_file())
            {
                language_workspace.root = candidate.into();
                break;
            }
            if candidate == workspace.root {
                break;
            }
            directory = candidate.parent();
        }
    }
    Ok(language_workspace)
}

pub fn status(workspace: &Workspace, args: &Value, configuration: &Value) -> Result<Value> {
    use std::os::unix::fs::PermissionsExt;
    let language = args["language"].as_str().ok_or("Langage requis")?;
    let program = configuration[language]["command"]
        .as_str()
        .or_else(|| command(language).map(|(program, _)| program));
    let language_workspace = server_workspace(workspace, args, &configuration[language], language)?;
    let installed = program.is_some_and(|program| {
        let executable = |path: &std::path::Path| {
            path.is_file()
                && std::fs::metadata(path)
                    .is_ok_and(|metadata| metadata.permissions().mode() & 0o111 != 0)
        };
        if program.contains('/') {
            executable(&language_workspace.root.join(program))
        } else {
            std::env::var_os("PATH").is_some_and(|path| {
                std::env::split_paths(&path).any(|directory| executable(&directory.join(program)))
            })
        }
    });
    Ok(
        json!({"language":language,"program":program,"installed":installed,"formatter":configuration[language]["formatter"]["command"]}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transport_initializes_and_exchanges_framed_unicode_messages() {
        let directory = tempfile::tempdir().unwrap();
        let script = directory.path().join("server.py");
        std::fs::write(&script, r#"
import json, sys
while True:
    headers = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line: sys.exit(0)
        if line == b'\r\n': break
        key, value = line.decode().split(':', 1)
        headers[key.lower()] = value.strip()
    message = json.loads(sys.stdin.buffer.read(int(headers['content-length'])))
    if 'id' not in message: continue
    result = {'capabilities': {'definitionProvider': True}} if message['method'] == 'initialize' else message.get('params')
    data = json.dumps({'jsonrpc':'2.0', 'id':message['id'], 'result':result}, ensure_ascii=False).encode()
    sys.stdout.buffer.write(('Content-Length: %d\r\n\r\n' % len(data)).encode() + data)
    sys.stdout.buffer.flush()
"#).unwrap();
        let workspace = Workspace::open(directory.path().to_str().unwrap()).unwrap();
        let mut server =
            Server::start_program(&workspace, "python3", &[script.to_str().unwrap()]).unwrap();
        assert_eq!(server.capabilities["definitionProvider"], true);
        assert_eq!(
            server
                .call("echo", json!({"text":"définition 🦀"}))
                .unwrap()["text"],
            "définition 🦀"
        );
    }
    #[test]
    fn arbitrary_methods_cannot_start_processes() {
        let directory = tempfile::tempdir().unwrap();
        let workspace = Workspace::open(directory.path().to_str().unwrap()).unwrap();
        assert!(dispatch(
            &workspace,
            &json!({"language":"rust","method":"workspace/executeCommand"})
        )
        .unwrap_err()
        .contains("non autorisée"));
    }
    #[test]
    fn validates_explicit_tool_configuration_and_formats_without_touching_the_file() {
        assert!(validate_configuration(&json!({"python":{"command":"pyright-langserver","args":["--stdio"],"rootMarkers":["pyproject.toml"]}})).is_ok());
        assert!(validate_configuration(&json!({"python":{"args":[42]}})).is_err());
        assert!(validate_configuration(&json!({"python":{"rootMarkers":["../outside"]}})).is_err());
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("sample.py"), "original").unwrap();
        let workspace = Workspace::open(directory.path().to_str().unwrap()).unwrap();
        let config = json!({"python":{"formatter":{"command":"python3","args":["-c","import sys; sys.stdout.write(sys.stdin.read().upper())"]}}});
        assert_eq!(
            format(
                &workspace,
                &json!({"language":"python","path":"sample.py","content":"hello"}),
                &config
            )
            .unwrap(),
            "HELLO"
        );
        assert_eq!(
            std::fs::read_to_string(directory.path().join("sample.py")).unwrap(),
            "original"
        );
    }
    #[test]
    fn edit_annotations_reject_outside_and_stale_documents() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("a.ts"), "const old = 1;").unwrap();
        let workspace = Workspace::open(directory.path().to_str().unwrap()).unwrap();
        let uri = url::Url::from_file_path(directory.path().join("a.ts"))
            .unwrap()
            .to_string();
        let mut edit = json!({"changes":{uri.clone():[]}});
        annotate_edit(
            &workspace,
            &mut edit,
            std::time::SystemTime::now(),
            &HashMap::new(),
        )
        .unwrap();
        assert!(edit["_galeataStamps"][&uri].is_string());
        let mut stale =
            json!({"documentChanges":[{"textDocument":{"uri":uri,"version":5},"edits":[]}]});
        assert!(annotate_edit(
            &workspace,
            &mut stale,
            std::time::SystemTime::now(),
            &HashMap::new()
        )
        .is_err());
        let mut outside = json!({"changes":{"file:///outside/a.ts":[]}});
        assert!(annotate_edit(
            &workspace,
            &mut outside,
            std::time::SystemTime::now(),
            &HashMap::new()
        )
        .is_err());
    }
    #[test]
    #[ignore = "requires isolated npm language-server fixtures in target/lsp-validation"]
    fn real_language_servers_cover_navigation_rename_diagnostics_and_formatting() {
        let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/lsp-validation");
        let directory = tempfile::tempdir_in(&base).unwrap();
        std::fs::write(directory.path().join("tsconfig.json"), r#"{"compilerOptions":{"strict":true,"target":"ES2022","module":"commonjs","types":["vite/client"]},"include":["*.ts"]}"#).unwrap();
        std::fs::write(
            directory.path().join("a.ts"),
            "export function greet(name: string) { return name; }\n",
        )
        .unwrap();
        let b = "import { greet } from './a';\nconst result = greet('dev');\n";
        std::fs::write(directory.path().join("b.ts"), b).unwrap();
        let workspace = Workspace::open(directory.path().to_str().unwrap()).unwrap();
        let binary = base.join("node_modules/.bin/typescript-language-server");
        let mut server =
            Server::start_program(&workspace, binary.to_str().unwrap(), &["--stdio"]).unwrap();
        let a_uri = url::Url::from_file_path(directory.path().join("a.ts"))
            .unwrap()
            .to_string();
        let b_uri = url::Url::from_file_path(directory.path().join("b.ts"))
            .unwrap()
            .to_string();
        server.notify("textDocument/didOpen", json!({"textDocument":{"uri":a_uri,"languageId":"typescript","version":1,"text":"export function greet(name: string) { return name; }\n"}})).unwrap();
        server.notify("textDocument/didOpen", json!({"textDocument":{"uri":b_uri,"languageId":"typescript","version":1,"text":b}})).unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        let definition = loop {
            let definition = server
                .call(
                    "textDocument/definition",
                    json!({"textDocument":{"uri":b_uri},"position":{"line":1,"character":16}}),
                )
                .unwrap();
            if definition.to_string().contains("a.ts") || Instant::now() >= deadline {
                break definition;
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        assert!(
            definition.to_string().contains("a.ts"),
            "{definition}; diagnostics={:?}",
            server.diagnostics.lock().unwrap()
        );
        let hover = server
            .call(
                "textDocument/hover",
                json!({"textDocument":{"uri":b_uri},"position":{"line":1,"character":16}}),
            )
            .unwrap();
        assert!(hover.to_string().contains("string"), "{hover}");
        let rename = server.call("textDocument/rename", json!({"textDocument":{"uri":a_uri},"position":{"line":0,"character":17},"newName":"welcome"})).unwrap();
        assert!(
            rename.to_string().contains("welcome") && rename.to_string().contains("b.ts"),
            "{rename}"
        );
        let completion = server
            .call(
                "textDocument/completion",
                json!({"textDocument":{"uri":b_uri},"position":{"line":1,"character":15}}),
            )
            .unwrap();
        assert!(completion.to_string().contains("greet"), "{completion}");
        let signature = server
            .call(
                "textDocument/signatureHelp",
                json!({"textDocument":{"uri":b_uri},"position":{"line":1,"character":22}}),
            )
            .unwrap();
        assert!(
            signature.to_string().contains("name: string"),
            "{signature}"
        );
        let symbols = server
            .call(
                "textDocument/documentSymbol",
                json!({"textDocument":{"uri":a_uri}}),
            )
            .unwrap();
        assert!(symbols.to_string().contains("greet"));
        let project_symbols = server
            .call("workspace/symbol", json!({"query":"greet"}))
            .unwrap();
        assert!(project_symbols.to_string().contains("greet"));
        let references = server.call("textDocument/references", json!({"textDocument":{"uri":a_uri},"position":{"line":0,"character":17},"context":{"includeDeclaration":true}})).unwrap();
        assert!(references.as_array().unwrap().len() >= 2);
        let formatting = server
            .call(
                "textDocument/formatting",
                json!({"textDocument":{"uri":b_uri},"options":{"tabSize":2,"insertSpaces":true}}),
            )
            .unwrap();
        assert!(formatting.is_array());
        server.notify("textDocument/didChange", json!({"textDocument":{"uri":b_uri,"version":2},"contentChanges":[{"text":"import { greet } from './a';\nconst result = greet(123);\n"}]})).unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        while server
            .diagnostics
            .lock()
            .unwrap()
            .get(&b_uri)
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
            && Instant::now() < deadline
        {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(
            server
                .diagnostics
                .lock()
                .unwrap()
                .get(&b_uri)
                .and_then(Value::as_array)
                .is_some_and(|items| !items.is_empty()),
            "Expected TypeScript diagnostics"
        );
        let d_uri = url::Url::from_file_path(directory.path().join("d.ts"))
            .unwrap()
            .to_string();
        let d_text = "export {};\nconst value = greet('dev');\n";
        std::fs::write(directory.path().join("d.ts"), d_text).unwrap();
        server.notify("textDocument/didOpen", json!({"textDocument":{"uri":d_uri,"languageId":"typescript","version":1,"text":d_text}})).unwrap();
        let deadline = Instant::now() + Duration::from_secs(8);
        while server
            .diagnostics
            .lock()
            .unwrap()
            .get(&d_uri)
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
            && Instant::now() < deadline
        {
            std::thread::sleep(Duration::from_millis(50));
        }
        let diagnostics = server
            .diagnostics
            .lock()
            .unwrap()
            .get(&d_uri)
            .cloned()
            .unwrap_or(json!([]));
        let actions = server.call("textDocument/codeAction", json!({"textDocument":{"uri":d_uri},"range":{"start":{"line":1,"character":14},"end":{"line":1,"character":19}},"context":{"diagnostics":diagnostics,"only":["quickfix"]}})).unwrap();
        assert!(
            actions.to_string().contains("import"),
            "Expected an auto-import correction: {actions}"
        );
        for (name, text, expect_missing) in [
            ("worker.ts", "import Worker from 'monaco-editor/esm/vs/editor/editor.worker?worker';\nnew Worker();\n", false),
            ("missing.ts", "import { missing } from './does-not-exist';\nmissing();\n", true),
        ] {
            std::fs::write(directory.path().join(name), text).unwrap();
            let uri = url::Url::from_file_path(directory.path().join(name)).unwrap().to_string();
            server.notify("textDocument/didOpen", json!({"textDocument":{"uri":uri,"languageId":"typescript","version":1,"text":text}})).unwrap();
            let deadline = Instant::now() + Duration::from_secs(8);
            while !server.diagnostics.lock().unwrap().contains_key(&uri) && Instant::now() < deadline { std::thread::sleep(Duration::from_millis(50)); }
            let diagnostics = server.diagnostics.lock().unwrap().get(&uri).cloned().expect("Project diagnostics must be published");
            let has_missing = diagnostics.as_array().unwrap().iter().any(|item| item["code"] == 2307);
            assert_eq!(has_missing, expect_missing, "{name}: {diagnostics}");
        }
        drop(server);
        let python = base.join("node_modules/.bin/pyright-langserver");
        let py = "def greet(name: str) -> str:\n    return name\n\nresult = greet('dev')\n";
        let py_uri = url::Url::from_file_path(directory.path().join("a.py"))
            .unwrap()
            .to_string();
        std::fs::write(directory.path().join("a.py"), py).unwrap();
        let mut python =
            Server::start_program(&workspace, python.to_str().unwrap(), &["--stdio"]).unwrap();
        python
            .notify(
                "textDocument/didOpen",
                json!({"textDocument":{"uri":py_uri,"languageId":"python","version":1,"text":py}}),
            )
            .unwrap();
        let definition = python
            .call(
                "textDocument/definition",
                json!({"textDocument":{"uri":py_uri},"position":{"line":3,"character":10}}),
            )
            .unwrap();
        assert!(definition.to_string().contains("a.py"), "{definition}");
        drop(python);
        let json_binary = base.join("node_modules/.bin/vscode-json-language-server");
        let mut json_server = Server::start_configured(
            &workspace,
            json_binary.to_str().unwrap(),
            &["--stdio"],
            json!({"provideFormatter":true}),
            json!({}),
        )
        .unwrap();
        let json_uri = url::Url::from_file_path(directory.path().join("sample.json"))
            .unwrap()
            .to_string();
        json_server.notify("textDocument/didOpen", json!({"textDocument":{"uri":json_uri,"languageId":"json","version":1,"text":"{\"name\":\"Galeata\",\"count\":42}"}})).unwrap();
        let formatted = json_server.call("textDocument/formatting", json!({"textDocument":{"uri":json_uri},"options":{"tabSize":2,"insertSpaces":true}})).unwrap();
        assert!(!formatted.as_array().unwrap().is_empty());
    }
    #[test]
    fn chooses_the_closest_project_marker_and_reports_missing_tools() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(directory.path().join("packages/api/src")).unwrap();
        std::fs::write(directory.path().join("Cargo.toml"), "[workspace]").unwrap();
        std::fs::write(
            directory.path().join("packages/api/Cargo.toml"),
            "[package]",
        )
        .unwrap();
        std::fs::write(
            directory.path().join("packages/api/src/main.rs"),
            "fn main() {}",
        )
        .unwrap();
        let workspace = Workspace::open(directory.path().to_str().unwrap()).unwrap();
        let selected = server_workspace(
            &workspace,
            &json!({"path":"packages/api/src/main.rs"}),
            &Value::Null,
            "rust",
        )
        .unwrap();
        assert_eq!(selected.root, workspace.root.join("packages/api"));
        let fallback = server_workspace(
            &workspace,
            &json!({"path":"packages/api/src/main.rs"}),
            &json!({"rootMarkers":["unavailable.marker"]}),
            "rust",
        )
        .unwrap();
        assert_eq!(fallback.root, workspace.root);
        let unavailable = status(
            &workspace,
            &json!({"language":"rust","path":"packages/api/src/main.rs"}),
            &json!({"rust":{"command":"galeata-missing-language-server-test"}}),
        )
        .unwrap();
        assert_eq!(unavailable["installed"], false);
        assert!(server_workspace(
            &workspace,
            &json!({"path":"../outside.rs"}),
            &Value::Null,
            "rust"
        )
        .is_err());
    }
}
