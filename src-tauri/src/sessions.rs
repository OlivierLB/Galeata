use crate::{
    store::Result,
    workspace::{run, Workspace},
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::Duration,
};

fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn claude_directory_from(config: Option<std::ffi::OsString>, home: &Path) -> PathBuf {
    config
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"))
}

pub fn claude_directory() -> PathBuf {
    claude_directory_from(std::env::var_os("CLAUDE_CONFIG_DIR"), &home())
}
pub fn providers() -> Value {
    let providers=["codex","claude"].iter().map(|provider|{
        let version=run(&home(),provider,&["--version"],&[0],Duration::from_secs(10),8192);
        // Keep the reason visible: a CLI that is installed but fails must not look absent.
        let error=version.as_ref().err().map(|e|e.chars().take(400).collect::<String>());
        json!({"id":provider,"available":version.is_ok(),"error":error,"version":version.unwrap_or_default().lines().filter(|l|!l.starts_with("WARNING")).collect::<Vec<_>>().join(" "),"capabilities":["terminal","resume","mcp","session_discovery"],"subagents":"historical_metadata_only"})
    }).collect::<Vec<_>>();
    json!(providers)
}
fn collect(path: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth == 0 || out.len() >= 5000 {
        return;
    }
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            let Ok(t) = entry.file_type() else { continue };
            if t.is_dir() {
                collect(&p, depth - 1, out)
            } else if t.is_file() && p.extension().is_some_and(|s| s == "jsonl") {
                out.push(p)
            }
            if out.len() >= 5000 {
                break;
            }
        }
    }
}
pub fn discover(w: &Workspace) -> Result<Value> {
    let mut files = vec![];
    let codex = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().join(".codex"));
    collect(&codex.join("sessions"), 5, &mut files);
    let claude = claude_directory();
    collect(&claude.join("projects"), 4, &mut files);
    files.sort_by_key(|p| std::cmp::Reverse(p.metadata().and_then(|m| m.modified()).ok()));
    let codex_names = codex_names(&codex.join("session_index.jsonl"));
    let mut sessions = vec![];
    for path in files.iter().take(3000) {
        if let Some(session) = parse(path, w, &codex_names) {
            sessions.push(session)
        }
        if sessions.len() >= 100 {
            break;
        }
    }
    Ok(json!(sessions))
}

/// Thread names given in Codex (`/rename` or generated), most recent wins.
fn codex_names(index: &Path) -> HashMap<String, String> {
    let mut names = HashMap::new();
    let Ok(file) = fs::File::open(index) else {
        return names;
    };
    let mut text = String::new();
    if file
        .take(8 * 1024 * 1024)
        .read_to_string(&mut text)
        .is_err()
    {
        return names;
    }
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let (Some(id), Some(name)) = (v["id"].as_str(), v["thread_name"].as_str()) {
            if !name.trim().is_empty() {
                names.insert(id.to_owned(), name.trim().to_owned());
            }
        }
    }
    names
}

/// Text of a message the user typed, if this line is one.
fn user_text<'a>(v: &'a Value, provider: &str) -> Option<&'a str> {
    if provider == "codex" {
        return (v["payload"]["type"] == "user_message")
            .then(|| v["payload"]["message"].as_str())
            .flatten();
    }
    if v["type"] != "user" || v["isMeta"] == true || v["isSidechain"] == true {
        return None;
    }
    v["message"]["content"].as_str().or_else(|| {
        v["message"]["content"]
            .as_array()
            .and_then(|blocks| blocks.iter().find_map(|b| b["text"].as_str()))
    })
}

fn parse(path: &Path, w: &Workspace, codex_names: &HashMap<String, String>) -> Option<Value> {
    let mut f = fs::File::open(path).ok()?;
    let metadata = f.metadata().ok()?;
    let mut head = Vec::new();
    Read::by_ref(&mut f)
        .take(64 * 1024)
        .read_to_end(&mut head)
        .ok()?;
    let mut tail = vec![];
    if metadata.len() > 64 * 1024 {
        f.seek(SeekFrom::End(-65536)).ok()?;
        f.read_to_end(&mut tail).ok()?;
    }
    let text = String::from_utf8_lossy(&head);
    let end = String::from_utf8_lossy(&tail);
    let mut cwd = None;
    let mut id = None;
    let mut provider = "claude";
    let mut summary = String::new();
    let mut parent = None;
    let mut name = None;
    let mut generated = None;
    let mut branch = None;
    let mut first_prompt = None;
    let mut last_prompt = None;
    // The head gives the start of the session, the tail its latest state
    // (names and titles are rewritten along the way, the last one wins).
    for line in text.lines().chain(end.lines()) {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if v["type"] == "session_meta" {
            provider = "codex";
            let p = &v["payload"];
            cwd = p["cwd"].as_str().map(str::to_owned);
            id = p["id"].as_str().map(str::to_owned);
            parent = p["source"]["subagent"]["thread_spawn"]["parent_thread_id"]
                .as_str()
                .map(str::to_owned);
        }
        if provider == "claude" {
            if cwd.is_none() {
                cwd = v["cwd"].as_str().map(str::to_owned)
            }
            if id.is_none() {
                id = v["sessionId"].as_str().map(str::to_owned)
            }
            if let Some(b) = v["gitBranch"].as_str().filter(|b| !b.is_empty()) {
                branch = Some(b.to_owned())
            }
            match v["type"].as_str() {
                Some("agent-name") => name = v["agentName"].as_str().map(str::to_owned),
                Some("custom-title") => name = v["customTitle"].as_str().map(str::to_owned),
                Some("ai-title") => generated = v["aiTitle"].as_str().map(str::to_owned),
                _ => {}
            }
        }
        if v["type"] == "summary" {
            if let Some(s) = v["summary"].as_str() {
                summary = s.chars().take(2000).collect()
            }
        }
        if let Some(prompt) = user_text(&v, provider).and_then(session_title) {
            if first_prompt.is_none() {
                first_prompt = Some(prompt.clone())
            }
            last_prompt = Some(prompt)
        }
    }
    if Path::new(&cwd?).canonicalize().ok()? != w.root {
        return None;
    }
    let id = id?;
    if uuid::Uuid::parse_str(&id).is_err() {
        return None;
    }
    if provider == "codex" {
        name = codex_names.get(&id).cloned();
    }
    let named = name.clone().filter(|n| !n.trim().is_empty());
    let title = named
        .clone()
        .or(generated.clone().filter(|g| !g.trim().is_empty()))
        .or(first_prompt.clone())
        .unwrap_or_else(|| format!("Session {}", &id[..8]));
    // What you were doing last is the most useful hint to pick a session.
    let description = [last_prompt, first_prompt, generated]
        .into_iter()
        .flatten()
        .find(|text| *text != title)
        .unwrap_or_default();
    let modified = metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some(
        json!({"id":id,"provider":provider,"title":title,"named":named.is_some(),"description":description,"branch":branch,"summary":summary,"path":path.to_string_lossy(),"modifiedAt":modified,"parentId":parent}),
    )
}

/// First line a human typed, or `None` for technical messages the CLIs record as
/// user turns (`<local-command-caveat>`, `<command-name>`, hook output…).
fn session_title(message: &str) -> Option<String> {
    let text = message.trim_start();
    if text.starts_with('<') || text.starts_with("Caveat:") {
        return None;
    }
    let line = text.lines().find(|l| !l.trim().is_empty())?;
    Some(line.trim().chars().take(120).collect())
}

#[cfg(test)]
mod title_tests {
    use super::*;

    #[test]
    fn claude_config_directory_overrides_the_home_default() {
        let home = Path::new("/home/tester");
        assert_eq!(claude_directory_from(None, home), home.join(".claude"));
        let custom = PathBuf::from("/tmp/custom claude config");
        assert_eq!(
            claude_directory_from(Some(custom.clone().into_os_string()), home),
            custom
        );
    }

    #[test]
    fn sessions_show_name_last_request_and_branch() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let w = Workspace::open(root.to_str().unwrap()).unwrap();
        let cwd = root.to_string_lossy();
        let claude = dir.path().join("c.jsonl");
        std::fs::write(
            &claude,
            [
                format!(r#"{{"type":"user","sessionId":"6e46ad76-900c-41ed-b952-ccc2088beb8d","cwd":"{cwd}","gitBranch":"main","message":{{"content":"<local-command-caveat>x"}}}}"#),
                format!(r#"{{"type":"user","cwd":"{cwd}","gitBranch":"theme","message":{{"content":"Prépare une présentation des thèmes"}}}}"#),
                r#"{"type":"ai-title","aiTitle":"Présentation thèmes Shopify"}"#.to_owned(),
                r#"{"type":"agent-name","agentName":"presentation-theme-shopify"}"#.to_owned(),
                format!(r#"{{"type":"user","cwd":"{cwd}","gitBranch":"theme","message":{{"content":[{{"type":"text","text":"Ajoute le header sticky"}}]}}}}"#),
            ]
            .join("\n"),
        )
        .unwrap();
        let session = parse(&claude, &w, &HashMap::new()).unwrap();
        assert_eq!(session["title"], "presentation-theme-shopify");
        assert_eq!(session["named"], true);
        assert_eq!(session["description"], "Ajoute le header sticky");
        assert_eq!(session["branch"], "theme");

        let codex = dir.path().join("x.jsonl");
        let id = "01a20c96-648a-7f13-90e0-faebe8096c41";
        std::fs::write(
            &codex,
            [
                format!(r#"{{"type":"session_meta","payload":{{"id":"{id}","cwd":"{cwd}"}}}}"#),
                r#"{"type":"event_msg","payload":{"type":"user_message","message":"Crée un IDE"}}"#.to_owned(),
                r#"{"type":"event_msg","payload":{"type":"user_message","message":"Ajoute le chat"}}"#.to_owned(),
            ]
            .join("\n"),
        )
        .unwrap();
        let names = HashMap::from([(id.to_owned(), "Galeata".to_owned())]);
        let session = parse(&codex, &w, &names).unwrap();
        assert_eq!(session["title"], "Galeata");
        assert_eq!(session["description"], "Ajoute le chat");
        // Without a name, the first request is the title and the last one the description.
        let session = parse(&codex, &w, &HashMap::new()).unwrap();
        assert_eq!(session["title"], "Crée un IDE");
        assert_eq!(session["named"], false);
        assert_eq!(session["description"], "Ajoute le chat");
    }

    #[test]
    fn technical_messages_are_not_titles() {
        assert_eq!(
            session_title("<local-command-caveat>The command below…"),
            None
        );
        assert_eq!(session_title("  <command-name>/plan</command-name>"), None);
        assert_eq!(
            session_title("\n\nCorrige le header\nensuite le footer").as_deref(),
            Some("Corrige le header")
        );
    }
}
