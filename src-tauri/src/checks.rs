//! Passive check discovery. No configuration file is executed during discovery.
use crate::{store::Result, workspace::Workspace};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, io::Read, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: String,
    pub name: String,
    pub program: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: String,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub category: String,
}
fn default_timeout() -> u64 {
    600
}

pub fn validate(w: &Workspace, check: &Check) -> Result<()> {
    if check.id.is_empty()
        || check.id.len() > 200
        || check.name.trim().is_empty()
        || check.name.len() > 160
        || check.program.is_empty()
        || check.program.len() > 4096
        || check.program.contains('\0')
        || check.args.len() > 100
        || check
            .args
            .iter()
            .any(|arg| arg.len() > 8192 || arg.contains('\0'))
        || !(1..=3600).contains(&check.timeout)
        || !w.resolve(&check.cwd, false)?.is_dir()
    {
        return Err("Configuration de contrôle invalide".into());
    }
    Ok(())
}

fn read_small(path: &Path) -> Option<Vec<u8>> {
    let mut bytes = vec![];
    fs::File::open(path)
        .ok()?
        .take(512 * 1024 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    (bytes.len() <= 512 * 1024).then_some(bytes)
}
fn read_json(path: &Path, root: &Path) -> Option<Value> {
    if !fs::canonicalize(path).ok()?.starts_with(root) {
        return None;
    }
    serde_json::from_slice(&read_small(path)?).ok()
}
fn inherited_manager(directory: &Path, root: &Path) -> String {
    let mut current = Some(directory);
    while let Some(path) = current.filter(|path| path.starts_with(root)) {
        if let Some(package) = read_json(&path.join("package.json"), root) {
            if let Some(manager) = package["packageManager"]
                .as_str()
                .and_then(|s| s.split('@').next())
                .filter(|s| matches!(*s, "npm" | "pnpm" | "yarn" | "bun"))
            {
                return manager.into();
            }
        }
        for (file, manager) in [
            ("pnpm-lock.yaml", "pnpm"),
            ("yarn.lock", "yarn"),
            ("bun.lock", "bun"),
            ("bun.lockb", "bun"),
        ] {
            if path.join(file).is_file() {
                return manager.into();
            }
        }
        current = path.parent();
    }
    "npm".into()
}
fn excluded(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | "vendor"
            | ".venv"
            | "venv"
            | ".next"
            | ".cache"
            | "release-local"
            | "fixtures"
    )
}
fn directories(root: &Path) -> Vec<String> {
    let mut result = vec![String::new()];
    let mut pending = vec![(root.to_owned(), 0)];
    let mut scanned = 0;
    while let Some((directory, depth)) = pending.pop() {
        if depth >= 3 || scanned >= 1000 {
            continue;
        }
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.take(1000).flatten() {
            scanned += 1;
            if scanned > 1000 {
                break;
            }
            if !entry.file_type().is_ok_and(|kind| kind.is_dir())
                || excluded(&entry.file_name().to_string_lossy())
            {
                continue;
            }
            let path = entry.path();
            if let Ok(relative) = path.strip_prefix(root) {
                result.push(relative.to_string_lossy().into_owned());
                pending.push((path, depth + 1));
            }
        }
    }
    result.sort();
    result
}

pub fn discover(w: &Workspace, configuration: &Value) -> Result<Vec<Check>> {
    let mut checks = BTreeMap::new();
    for cwd in directories(&w.root) {
        let directory = w.root.join(&cwd);
        let mut add = |key: &str,
                       name: &str,
                       program: &str,
                       args: Vec<String>,
                       file: &str,
                       category: &str| {
            if checks.len() >= 256 {
                return;
            }
            let id = format!("{cwd}:{key}");
            checks.insert(
                id.clone(),
                Check {
                    id,
                    name: name.into(),
                    program: program.into(),
                    args,
                    cwd: cwd.clone(),
                    timeout: 600,
                    origin: directory
                        .join(file)
                        .strip_prefix(&w.root)
                        .unwrap_or(Path::new(file))
                        .to_string_lossy()
                        .into_owned(),
                    category: category.into(),
                },
            );
        };
        if let Some(package) = read_json(&directory.join("package.json"), &w.root) {
            let manager = inherited_manager(&directory, &w.root);
            if let Some(scripts) = package["scripts"].as_object() {
                for (name, body) in scripts {
                    let Some(body) = body.as_str() else {
                        continue;
                    };
                    if name.contains("watch")
                        || body.contains("--watch")
                        || body.contains("--fix")
                        || body.contains("--write")
                    {
                        continue;
                    }
                    let category = if name == "test" || name.starts_with("test:") {
                        "Tests"
                    } else if name == "build" || name.starts_with("build:") {
                        "Compilation"
                    } else if ["check", "lint", "typecheck"]
                        .iter()
                        .any(|prefix| name == prefix || name.starts_with(&format!("{prefix}:")))
                    {
                        "Analyse"
                    } else {
                        continue;
                    };
                    add(
                        &format!("script:{name}"),
                        &format!("{category} · {name}"),
                        &manager,
                        vec!["run".into(), name.clone()],
                        "package.json",
                        category,
                    );
                }
            }
        }
        if directory.join("Cargo.toml").is_file() {
            for (key, name, args) in [
                ("test", "Tests Rust", vec!["test", "--locked"]),
                ("check", "Compilation Rust", vec!["check", "--locked"]),
                ("clippy", "Analyse Clippy", vec!["clippy", "--locked"]),
                (
                    "fmt",
                    "Formatage Rust (contrôle)",
                    vec!["fmt", "--", "--check"],
                ),
            ] {
                add(
                    key,
                    name,
                    "cargo",
                    args.into_iter().map(str::to_owned).collect(),
                    "Cargo.toml",
                    if key == "test" { "Tests" } else { "Analyse" },
                );
            }
        }
        if directory.join("go.mod").is_file() {
            for (key, name) in [
                ("test", "Tests Go"),
                ("vet", "Analyse Go"),
                ("build", "Compilation Go"),
            ] {
                add(
                    key,
                    name,
                    "go",
                    vec![key.into(), "./...".into()],
                    "go.mod",
                    if key == "test" { "Tests" } else { "Analyse" },
                );
            }
        }
        let pytest = ["pytest.ini", "pyproject.toml", "setup.cfg"]
            .iter()
            .find(|file| {
                let path = directory.join(file);
                path.is_file()
                    && (file.ends_with("pytest.ini")
                        || fs::metadata(&path).is_ok_and(|m| m.len() <= 512 * 1024)
                            && read_small(&path).is_some_and(|bytes| {
                                String::from_utf8_lossy(&bytes).contains("pytest")
                            }))
            });
        let python = if directory.join(".venv/bin/python").is_file() {
            directory
                .join(".venv/bin/python")
                .to_string_lossy()
                .into_owned()
        } else {
            "python3".into()
        };
        if let Some(file) = pytest {
            add(
                "pytest",
                "Tests Python · pytest",
                &python,
                vec!["-m".into(), "pytest".into()],
                file,
                "Tests",
            );
        } else if directory.join("tests").is_dir()
            && directory.join("tests").read_dir().is_ok_and(|mut entries| {
                entries.any(|entry| {
                    entry.is_ok_and(|entry| {
                        entry.file_name().to_string_lossy().starts_with("test_")
                            && entry.path().extension().is_some_and(|ext| ext == "py")
                    })
                })
            })
        {
            add(
                "unittest",
                "Tests Python · unittest",
                &python,
                vec![
                    "-m".into(),
                    "unittest".into(),
                    "discover".into(),
                    "-s".into(),
                    "tests".into(),
                ],
                "tests",
                "Tests",
            );
        }
        if let Some(composer) = read_json(&directory.join("composer.json"), &w.root) {
            if let Some(scripts) = composer["scripts"].as_object() {
                for name in scripts.keys().filter(|name| {
                    ["test", "lint", "check"].iter().any(|prefix| {
                        name.as_str() == *prefix || name.starts_with(&format!("{prefix}:"))
                    })
                }) {
                    add(
                        &format!("composer:{name}"),
                        &format!("PHP · {name}"),
                        "composer",
                        vec!["run-script".into(), name.clone()],
                        "composer.json",
                        "Tests",
                    );
                }
            }
        }
        if directory.join("pom.xml").is_file() {
            let program = if directory.join("mvnw").is_file() {
                directory.join("mvnw").to_string_lossy().into_owned()
            } else {
                "mvn".into()
            };
            add(
                "maven",
                "Tests Java · Maven",
                &program,
                vec!["test".into()],
                "pom.xml",
                "Tests",
            );
        }
        if let Ok(entries) = directory.read_dir() {
            if entries.take(500).flatten().any(|entry| {
                matches!(
                    entry.path().extension().and_then(|e| e.to_str()),
                    Some("csproj" | "fsproj" | "sln")
                )
            }) {
                add(
                    "dotnet",
                    "Tests .NET",
                    "dotnet",
                    vec!["test".into(), "--no-restore".into()],
                    "*.csproj / *.sln",
                    "Tests",
                );
            }
        }
    }
    // Explicit project definitions and local overrides win over detection.
    let project = if w.root.join(".galeata/checks.json").exists() {
        let path = w.resolve(".galeata/checks.json", false)?;
        read_json(&path, &w.root)
            .ok_or("Le fichier .galeata/checks.json est invalide ou trop volumineux")?
    } else {
        Value::Null
    };
    for source in [project, configuration.clone()] {
        if let Some(custom) = source["custom"].as_array() {
            for item in custom.iter().take(64) {
                let mut check: Check = serde_json::from_value(item.clone())
                    .map_err(|e| format!("Contrôle personnalisé invalide : {e}"))?;
                validate(w, &check)?;
                check.origin = "Configuration personnalisée".into();
                checks.insert(check.id.clone(), check);
            }
        }
    }
    Ok(checks.into_values().collect())
}

pub fn available(program: &str) -> bool {
    use std::os::unix::fs::PermissionsExt;
    let executable = |path: &Path| {
        fs::metadata(path)
            .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
    };
    if program.contains('/') {
        return executable(Path::new(program));
    }
    let environment = galeata_agent_protocol::host_env(std::env::vars_os());
    environment
        .iter()
        .find(|(key, _)| key == "PATH")
        .is_some_and(|(_, path)| {
            std::env::split_paths(path).any(|path| executable(&path.join(program)))
        })
}

pub fn catalogue(w: &Workspace, configuration: &Value) -> Result<Value> {
    Ok(
        json!({"checks": discover(w, configuration)?.into_iter().map(|check| {
        let program = if check.program.contains('/') && !Path::new(&check.program).is_absolute() {
            w.root.join(&check.cwd).join(&check.program).to_string_lossy().into_owned()
        } else { check.program.clone() };
        let ready = available(&program);
        json!({"available":ready,"definition":check})
    }).collect::<Vec<_>>(), "configuration":configuration, "scope":"Racine et sous-projets jusqu’à trois niveaux ; aucun programme exécuté pour la détection."}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovers_scripts_subprojects_and_python_without_running_them() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("package.json"), r#"{"packageManager":"pnpm@10","scripts":{"test":"touch SHOULD_NOT_EXIST","test:watch":"watch","lint":"eslint .","dev":"vite"}}"#).unwrap();
        fs::create_dir(directory.path().join("server")).unwrap();
        fs::write(directory.path().join("server/go.mod"), "module example\n").unwrap();
        fs::create_dir(directory.path().join("node_modules")).unwrap();
        fs::write(directory.path().join("node_modules/Cargo.toml"), "").unwrap();
        let w = Workspace::open(directory.path().to_str().unwrap()).unwrap();
        let checks = discover(&w, &Value::Null).unwrap();
        assert_eq!(checks.len(), 5);
        assert!(checks
            .iter()
            .any(|check| check.program == "pnpm" && check.args == ["run", "test"]));
        assert!(checks.iter().any(|check| check.cwd == "server"));
        assert!(!directory.path().join("SHOULD_NOT_EXIST").exists());
    }
    #[test]
    fn rejects_custom_checks_outside_workspace() {
        let directory = tempfile::tempdir().unwrap();
        let w = Workspace::open(directory.path().to_str().unwrap()).unwrap();
        assert!(discover(
            &w,
            &json!({"custom":[{"id":"x","name":"x","program":"true","args":[],"cwd":".."}]})
        )
        .is_err());
    }
}
