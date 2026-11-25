//! Bounded discovery of local skill instructions for the agent composer.
use crate::{sessions, store::Result, workspace::Workspace};
use serde_json::{json, Value};
use std::{collections::HashSet, fs, io::Read, path::PathBuf};

pub fn list(w: &Workspace, provider: &str) -> Result<Value> {
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
    let mut roots = vec![w.root.join(".agents/skills"), home.join(".agents/skills")];
    match provider {
        "claude" => roots.extend([
            w.root.join(".claude/skills"),
            sessions::claude_directory().join("skills"),
        ]),
        "codex" => roots.extend([
            w.root.join(".codex/skills"),
            std::env::var_os("CODEX_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".codex"))
                .join("skills"),
        ]),
        _ => return Err("Agent inconnu".into()),
    }
    Ok(discover(roots))
}

fn discover(roots: Vec<PathBuf>) -> Value {
    let mut pending = roots.into_iter().rev().map(|p| (p, 0)).collect::<Vec<_>>();
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    let mut visited = 0;
    while let Some((directory, depth)) = pending.pop() {
        visited += 1;
        if visited > 4000 || items.len() >= 500 {
            break;
        }
        let Ok(directory) = directory.canonicalize() else {
            continue;
        };
        if !seen.insert(directory.clone()) {
            continue;
        }
        let path = directory.join("SKILL.md");
        if let Ok(file) = fs::File::open(&path) {
            let mut content = String::new();
            if file.take(32 * 1024).read_to_string(&mut content).is_ok() {
                let field = |name: &str| {
                    content
                        .strip_prefix("---\n")
                        .and_then(|s| s.split_once("\n---"))
                        .and_then(|(front, _)| {
                            front
                                .lines()
                                .find_map(|line| line.strip_prefix(&format!("{name}:")))
                        })
                        .map(|s| s.trim().trim_matches(['\'', '"']).to_owned())
                };
                let name = field("name").filter(|s| !s.is_empty()).unwrap_or_else(|| {
                    directory
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned()
                });
                items.push(json!({"name":name,"description":field("description").unwrap_or_default(),"path":path}));
            }
            continue;
        }
        if depth < 5 {
            if let Ok(entries) = fs::read_dir(directory) {
                let mut paths = entries
                    .flatten()
                    .take(1000)
                    .map(|e| e.path())
                    .filter(|p| p.is_dir())
                    .collect::<Vec<_>>();
                paths.sort();
                pending.extend(paths.into_iter().rev().map(|p| (p, depth + 1)));
            }
        }
    }
    items.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    json!(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovers_nested_skills_and_deduplicates_symlinks() {
        let temp = tempfile::tempdir().unwrap();
        let skill = temp.path().join("nested/hello");
        fs::create_dir_all(&skill).unwrap();
        fs::write(
            skill.join("SKILL.md"),
            "---\nname: hello\ndescription: 'Dire bonjour'\n---\nInstructions",
        )
        .unwrap();
        std::os::unix::fs::symlink(temp.path(), temp.path().join("cycle")).unwrap();
        let result = discover(vec![temp.path().to_owned(), skill]);
        assert_eq!(result.as_array().unwrap().len(), 1);
        assert_eq!(result[0]["name"], "hello");
        assert_eq!(result[0]["description"], "Dire bonjour");
    }
}
