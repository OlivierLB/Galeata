//! On-demand inventory of agent configuration sources. Never executes discovered files.
use crate::{sessions, store::Result, workspace::Workspace};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const MAX_BYTES: usize = 512 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    name: String,
    path: PathBuf,
    scope: String,
    category: String,
    editable: bool,
    reason: String,
}
struct Inventory {
    entries: Vec<Entry>,
    seen: HashSet<PathBuf>,
    visited: usize,
}
impl Inventory {
    fn add(&mut self, path: PathBuf, scope: &str, category: &str, editable: bool) {
        if self.entries.len() >= 600 || !path.is_file() {
            return;
        }
        let Ok(target) = path.canonicalize() else {
            return;
        };
        if !self.seen.insert(target.clone()) {
            return;
        }
        let bundled = target
            .components()
            .any(|part| matches!(part.as_os_str().to_str(), Some(".system" | "plugins")));
        let editable = editable && !bundled;
        let name = if path.file_name().and_then(|n| n.to_str()) == Some("SKILL.md") {
            path.parent()
                .and_then(|p| p.file_name())
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        } else {
            path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        };
        self.entries.push(Entry { id: format!("{:x}", Sha256::digest(path.as_os_str().as_encoded_bytes())), name, path,
            scope: scope.into(), category: category.into(), editable,
            reason: if editable { String::new() } else { "Fichier fourni par un plugin, intégré ou lié hors de son dossier : consultation uniquement.".into() } });
    }
    fn scan(&mut self, root: &Path, scope: &str, category: &str, bundled: bool) {
        let Ok(boundary) = root.canonicalize() else {
            return;
        };
        let mut pending = vec![(root.to_owned(), 0)];
        let mut directories = HashSet::new();
        while let Some((directory, depth)) = pending.pop() {
            self.visited += 1;
            if self.visited > 4000 || self.entries.len() >= 600 {
                break;
            }
            let Ok(real) = directory.canonicalize() else {
                continue;
            };
            if !directories.insert(real.clone()) {
                continue;
            }
            let Ok(entries) = fs::read_dir(&directory) else {
                continue;
            };
            let mut paths = entries
                .flatten()
                .take(500)
                .map(|e| e.path())
                .collect::<Vec<_>>();
            paths.sort();
            for path in paths {
                let name = path.file_name().and_then(|p| p.to_str()).unwrap_or("");
                if matches!(
                    name,
                    ".git" | "node_modules" | "target" | "dist" | "marketplaces" | "repositories"
                ) {
                    continue;
                }
                if path.is_dir() {
                    if depth < 7 {
                        pending.push((path, depth + 1));
                    }
                } else {
                    let extension = path.extension().and_then(|p| p.to_str()).unwrap_or("");
                    let accepted = if bundled {
                        name == "SKILL.md"
                            || name == "hooks.json"
                            || name == "plugin.json"
                            || (extension == "md"
                                && path.components().any(|p| {
                                    matches!(
                                        p.as_os_str().to_str(),
                                        Some("agents" | "commands" | "rules")
                                    )
                                }))
                    } else if category == "skills" {
                        name == "SKILL.md"
                    } else {
                        matches!(
                            extension,
                            "md" | "json" | "toml" | "rules" | "sh" | "py" | "js" | "mjs" | "ts"
                        )
                    };
                    if accepted {
                        let editable =
                            !bundled && path.canonicalize().is_ok_and(|p| p.starts_with(&boundary));
                        self.add(path, scope, category, editable);
                    }
                }
            }
        }
    }
}
fn discover(w: &Workspace, provider: &str, home: &Path, user: &Path) -> Result<Inventory> {
    if !matches!(provider, "codex" | "claude") {
        return Err("Outil inconnu".into());
    }
    let mut inventory = Inventory {
        entries: vec![],
        seen: HashSet::new(),
        visited: 0,
    };
    let local = w.root.join(format!(".{provider}"));
    let settings = if provider == "codex" {
        "config.toml"
    } else {
        "settings.json"
    };
    let instructions = if provider == "codex" {
        "AGENTS.md"
    } else {
        "CLAUDE.md"
    };
    for (root, scope) in [(local.as_path(), "Projet"), (user, "Utilisateur")] {
        inventory.add(root.join(settings), scope, "settings", true);
        if provider == "claude" {
            inventory.add(root.join("settings.local.json"), scope, "settings", true);
        }
        inventory.add(root.join("hooks.json"), scope, "hooks", true);
        inventory.add(root.join(instructions), scope, "instructions", true);
        for category in ["skills", "agents", "hooks", "commands", "rules"] {
            inventory.scan(&root.join(category), scope, category, false);
        }
    }
    inventory.add(w.root.join(instructions), "Projet", "instructions", true);
    if provider == "codex" {
        inventory.add(
            w.root.join("AGENTS.override.md"),
            "Projet",
            "instructions",
            true,
        );
    }
    if provider == "claude" {
        inventory.add(
            w.root.join("CLAUDE.local.md"),
            "Projet",
            "instructions",
            true,
        );
        inventory.add(w.root.join(".mcp.json"), "Projet", "mcp", true);
    }
    for (root, scope) in [
        (w.root.join(".agents/skills"), "Projet · partagé"),
        (home.join(".agents/skills"), "Utilisateur · partagé"),
    ] {
        inventory.scan(&root, scope, "skills", false);
    }
    inventory.scan(
        &user.join("plugins/cache"),
        "Plugin installé",
        "plugins",
        true,
    );
    inventory
        .entries
        .sort_by(|a, b| (&a.scope, &a.category, &a.name).cmp(&(&b.scope, &b.category, &b.name)));
    Ok(inventory)
}
fn inventory(w: &Workspace, provider: &str) -> Result<Inventory> {
    let home = PathBuf::from(std::env::var_os("HOME").ok_or("Dossier utilisateur introuvable")?);
    let user = match provider {
        "claude" => sessions::claude_directory(),
        "codex" => sessions::codex_directory(),
        _ => return Err("Outil inconnu".into()),
    };
    discover(w, provider, &home, &user)
}
pub fn list(w: &Workspace, provider: &str) -> Result<Value> {
    let inventory = inventory(w, provider)?;
    Ok(
        json!({"entries":inventory.entries,"limited":inventory.entries.len() >= 600 || inventory.visited >= 4000}),
    )
}
fn read(path: &Path) -> Result<Value> {
    let mut bytes = vec![];
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("Fichier supérieur à 512 Kio".into());
    }
    let stamp = format!("{:x}", Sha256::digest(&bytes));
    let content = String::from_utf8(bytes).map_err(|_| "Ce fichier n’est pas un texte UTF-8")?;
    Ok(json!({"content":content,"stamp":stamp}))
}
fn find(w: &Workspace, provider: &str, id: &str) -> Result<Entry> {
    inventory(w, provider)?
        .entries
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or("Source de configuration introuvable".into())
}
pub fn load(w: &Workspace, provider: &str, id: &str) -> Result<Value> {
    read(&find(w, provider, id)?.path)
}
fn save(entry: &Entry, content: &str, stamp: &str) -> Result<Value> {
    if !entry.editable {
        return Err("Cette source est en consultation uniquement".into());
    }
    if content.len() > MAX_BYTES {
        return Err("Fichier supérieur à 512 Kio".into());
    }
    if entry.path.extension().and_then(|p| p.to_str()) == Some("json") {
        serde_json::from_str::<Value>(content)
            .map_err(|_| "JSON invalide : corrigez la syntaxe avant d’enregistrer")?;
    }
    if entry.path.extension().and_then(|p| p.to_str()) == Some("toml") {
        content
            .parse::<toml::Value>()
            .map_err(|_| "TOML invalide : corrigez la syntaxe avant d’enregistrer")?;
    }
    let target = entry.path.canonicalize().map_err(|e| e.to_string())?;
    if read(&target)?["stamp"].as_str() != Some(stamp) {
        return Err(
            "FILE_CONFLICT : fichier modifié ailleurs. Rechargez avant d’enregistrer.".into(),
        );
    }
    crate::atomic_file::replace(&target, content.as_bytes(), || {
        if read(&target)?["stamp"].as_str() != Some(stamp) {
            return Err("FILE_CONFLICT : fichier modifié ailleurs".into());
        }
        Ok(())
    })?;
    read(&target)
}
pub fn write(w: &Workspace, provider: &str, id: &str, content: &str, stamp: &str) -> Result<Value> {
    save(&find(w, provider, id)?, content, stamp)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovers_only_configuration_sources_and_protects_bundled_files() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        let user = temp.path().join("user");
        fs::create_dir_all(project.join(".claude/skills/hello")).unwrap();
        fs::create_dir_all(user.join("plugins/cache/demo/1/skills/plugin")).unwrap();
        fs::write(project.join(".claude/skills/hello/SKILL.md"), "hello").unwrap();
        fs::write(
            user.join("plugins/cache/demo/1/skills/plugin/SKILL.md"),
            "plugin",
        )
        .unwrap();
        fs::write(user.join("auth.json"), "secret").unwrap();
        let workspace = Workspace::open(project.to_str().unwrap()).unwrap();
        let result = discover(&workspace, "claude", temp.path(), &user).unwrap();
        assert_eq!(result.entries.len(), 2);
        assert!(result
            .entries
            .iter()
            .any(|e| e.name == "hello" && e.editable));
        assert!(result
            .entries
            .iter()
            .any(|e| e.name == "plugin" && !e.editable));
    }
    #[test]
    fn writes_atomically_and_rejects_conflicts_invalid_json_and_readonly() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("settings.json");
        fs::write(&path, "{}").unwrap();
        let mut entry = Entry {
            id: "id".into(),
            name: "settings".into(),
            path: path.clone(),
            scope: "Projet".into(),
            category: "settings".into(),
            editable: true,
            reason: String::new(),
        };
        let original = read(&path).unwrap();
        let stamp = original["stamp"].as_str().unwrap();
        assert!(save(&entry, "broken", stamp).is_err());
        save(&entry, "{\"hooks\":{}}", stamp).unwrap();
        assert!(save(&entry, "{}", stamp)
            .unwrap_err()
            .contains("FILE_CONFLICT"));
        entry.editable = false;
        assert!(save(&entry, "{}", stamp).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "{\"hooks\":{}}");
    }
}
