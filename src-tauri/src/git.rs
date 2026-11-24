use crate::{
    store::Result,
    workspace::{run, Workspace},
};
use serde_json::{json, Value};
use std::time::Duration;

pub fn git(w: &Workspace, args: &[&str]) -> Result<String> {
    run(
        &w.root,
        "git",
        args,
        &[0],
        Duration::from_secs(60),
        4 * 1024 * 1024,
    )
}
pub fn status(w: &Workspace) -> Result<Value> {
    if git(w, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Ok(json!({"isRepo":false,"branch":"","files":[]}));
    }
    let text = git(
        w,
        &["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    )?;
    let mut records = text.split('\0').filter(|s| !s.is_empty());
    let mut files = vec![];
    while let Some(record) = records.next() {
        if record.len() < 4 {
            continue;
        }
        let x = record.as_bytes()[0] as char;
        let y = record.as_bytes()[1] as char;
        let path = &record[3..];
        if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
            records.next();
        }
        files.push(json!({"path":path,"index":x.to_string(),"worktree":y.to_string()}));
    }
    let branch = git(w, &["symbolic-ref", "--short", "-q", "HEAD"]).unwrap_or_else(|_| {
        git(w, &["rev-parse", "--short", "HEAD"]).unwrap_or_else(|_| "HEAD".into())
    });
    Ok(json!({"isRepo":true,"branch":branch.trim(),"files":files}))
}
pub fn diff(w: &Workspace, path: &str, staged: bool) -> Result<Value> {
    Workspace::validate_relative(path)?;
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv", "--no-color"];
    if staged {
        args.push("--cached")
    }
    args.extend(["--", path]);
    let patch = git(w, &args)?;
    let spec = format!("{}:{}", if staged { "HEAD" } else { "" }, path);
    let original = git(w, &["show", &spec]).unwrap_or_default();
    let modified = if staged {
        git(w, &["show", &format!(":{path}")]).unwrap_or_default()
    } else {
        w.read(path)
            .ok()
            .and_then(|v| v["content"].as_str().map(str::to_owned))
            .unwrap_or_default()
    };
    Ok(json!({"original":original,"modified":modified,"patch":patch}))
}
pub fn mutate(w: &Workspace, action: &str, a: &Value) -> Result<Value> {
    let get = |key: &str| {
        a[key]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("{key} requis"))
    };
    match action {
        "stage" => {
            let p = get("path")?;
            Workspace::validate_relative(p)?;
            git(w, &["add", "--", p])?;
        }
        "unstage" => {
            let p = get("path")?;
            Workspace::validate_relative(p)?;
            if git(w, &["rev-parse", "--verify", "HEAD"]).is_ok() {
                git(w, &["restore", "--staged", "--", p])?;
            } else {
                git(w, &["rm", "--cached", "--", p])?;
            }
        }
        "commit" => {
            let message = get("message")?;
            if message.len() > 10_000 {
                return Err("Message trop long".into());
            }
            git(w, &["commit", "-m", message])?;
        }
        "fetch" => {
            git(w, &["fetch", "--all", "--prune"])?;
        }
        "pull" => {
            git(w, &["pull", "--ff-only"])?;
        }
        "push" => {
            git(w, &["push"])?;
        }
        "branch" => {
            let name = get("name")?;
            git(w, &["check-ref-format", "--branch", name])?;
            git(w, &["switch", "-c", name])?;
        }
        "switch" => {
            let name = get("name")?;
            git(w, &["check-ref-format", "--branch", name])?;
            git(w, &["switch", "--", name])?;
        }
        "worktree" => {
            let name = get("name")?;
            git(w, &["check-ref-format", "--branch", name])?;
            let path = get("path")?;
            let target = std::path::Path::new(path);
            if !target.is_absolute() || target.exists() {
                return Err("Choisissez un nouveau chemin absolu pour le worktree".into());
            }
            git(w, &["worktree", "add", "-b", name, "--", path, "HEAD"])?;
        }
        _ => return Err("Action Git inconnue".into()),
    }
    status(w)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    #[test]
    fn stage_commit_diff_unstage_and_deleted_directory() {
        let directory = tempfile::tempdir().unwrap();
        let w = Workspace::open(directory.path().to_str().unwrap()).unwrap();
        git(&w, &["init", "-b", "main"]).unwrap();
        fs::create_dir(directory.path().join("src")).unwrap();
        fs::write(directory.path().join("src/é space.txt"), "before\n").unwrap();
        mutate(&w, "stage", &json!({"path":"src/é space.txt"})).unwrap();
        git(
            &w,
            &[
                "-c",
                "user.name=Galeata Test",
                "-c",
                "user.email=test@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-m",
                "Initial",
            ],
        )
        .unwrap();
        fs::write(directory.path().join("src/é space.txt"), "after\n").unwrap();
        assert_eq!(status(&w).unwrap()["files"][0]["path"], "src/é space.txt");
        assert_eq!(
            diff(&w, "src/é space.txt", false).unwrap()["original"],
            "before\n"
        );
        mutate(&w, "stage", &json!({"path":"src/é space.txt"})).unwrap();
        assert_eq!(
            diff(&w, "src/é space.txt", true).unwrap()["modified"],
            "after\n"
        );
        mutate(&w, "unstage", &json!({"path":"src/é space.txt"})).unwrap();
        fs::remove_dir_all(directory.path().join("src")).unwrap();
        assert_eq!(diff(&w, "src/é space.txt", false).unwrap()["modified"], "");
        mutate(&w, "stage", &json!({"path":"src/é space.txt"})).unwrap();
        assert!(mutate(&w, "stage", &json!({"path":"../outside"})).is_err());
    }
}
