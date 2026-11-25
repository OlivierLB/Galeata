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
        &[
            "--no-optional-locks",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=normal",
        ],
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
        let conflicted = matches!(&record[..2], "DD" | "AU" | "UD" | "UA" | "DU" | "AA" | "UU");
        files.push(json!({"path":path,"index":x.to_string(),"worktree":y.to_string(),"conflicted":conflicted}));
    }
    let branch = git(w, &["symbolic-ref", "--short", "-q", "HEAD"]).unwrap_or_else(|_| {
        git(w, &["rev-parse", "--short", "HEAD"]).unwrap_or_else(|_| "HEAD".into())
    });
    let upstream = git(
        w,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .unwrap_or_default();
    let divergence = git(
        w,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .unwrap_or_default();
    let mut counts = divergence
        .split_whitespace()
        .map(|n| n.parse::<u64>().unwrap_or(0));
    let ahead = counts.next().unwrap_or(0);
    let behind = counts.next().unwrap_or(0);
    let merging = git(w, &["rev-parse", "--verify", "-q", "MERGE_HEAD"]).is_ok();
    let detached = git(w, &["symbolic-ref", "-q", "HEAD"]).is_err();
    Ok(json!({"isRepo":true,"branch":branch.trim(),"files":files,
        "upstream":upstream.trim(),"ahead":ahead,"behind":behind,"merging":merging,"detached":detached}))
}

pub fn overview(w: &Workspace) -> Result<Value> {
    let refs = git(
        w,
        &[
            "for-each-ref",
            "--sort=refname",
            "--format=%(refname)%00%(HEAD)%00%(upstream:short)%00%(worktreepath)",
            "refs/heads/",
            "refs/remotes/",
        ],
    )?;
    let branches: Vec<Value> = refs
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split('\0').collect();
            if fields.len() != 4 || fields[0].ends_with("/HEAD") {
                return None;
            }
            let remote = fields[0].starts_with("refs/remotes/");
            let name = fields[0].strip_prefix(if remote {
                "refs/remotes/"
            } else {
                "refs/heads/"
            })?;
            Some(json!({"name":name,"remote":remote,"current":fields[1]=="*",
            "upstream":fields[2],"inWorktree":!fields[3].is_empty() && fields[1]!="*"}))
        })
        .collect();
    let list = git(w, &["stash", "list", "--format=%gd%x00%H%x00%gs"])?;
    let stashes: Vec<Value> = list
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.splitn(3, '\0').collect();
            if fields.len() != 3 {
                return None;
            }
            Some(json!({"id":fields[0],"oid":fields[1],"message":fields[2]}))
        })
        .collect();
    let remotes = git(w, &["remote"])?;
    Ok(json!({"branches":branches,"stashes":stashes,"remotes":remotes.lines().collect::<Vec<_>>()}))
}

fn branch_ref(w: &Workspace, name: &str, remote: bool) -> Result<String> {
    // Match full refs from Git, never revisions, options or checkout shorthand.
    let prefix = if remote {
        "refs/remotes/"
    } else {
        "refs/heads/"
    };
    let reference = format!("{prefix}{name}");
    git(w, &["check-ref-format", &reference])?;
    git(w, &["show-ref", "--verify", "--quiet", &reference])?;
    Ok(reference)
}

fn new_branch(w: &Workspace, name: &str) -> Result<()> {
    if name.starts_with('-') {
        return Err("Nom de branche invalide".into());
    }
    git(w, &["check-ref-format", &format!("refs/heads/{name}")])?;
    Ok(())
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
            if let Some(remote) = a["remote"].as_str() {
                if !git(w, &["remote"])?.lines().any(|name| name == remote) {
                    return Err("Dépôt distant inconnu".into());
                }
                let branch = git(w, &["symbolic-ref", "--short", "-q", "HEAD"])?;
                git(w, &["push", "--set-upstream", "--", remote, branch.trim()])?;
            } else {
                git(w, &["push"])?;
            }
        }
        "branch" => {
            let name = get("name")?;
            new_branch(w, name)?;
            git(w, &["switch", "-c", name])?;
        }
        "switch" => {
            let name = get("name")?;
            let remote = a["remote"] == true;
            let reference = branch_ref(w, name, remote)?;
            if remote {
                let state = overview(w)?;
                let tracking = state["branches"].as_array().and_then(|branches| {
                    branches.iter().find(|branch| {
                        branch["remote"] == false && branch["upstream"].as_str() == Some(name)
                    })
                });
                if let Some(local) = tracking.and_then(|branch| branch["name"].as_str()) {
                    git(w, &["switch", "--no-guess", "--", local])?;
                } else {
                    git(w, &["switch", "--track", "--", &reference])?;
                }
            } else {
                git(w, &["switch", "--no-guess", "--", name])?;
            }
        }
        "merge" => {
            let reference = branch_ref(w, get("name")?, a["remote"] == true)?;
            if git(w, &["symbolic-ref", "-q", "HEAD"]).is_err() {
                return Err("Choisissez une branche de destination avant de fusionner".into());
            }
            git(w, &["merge", "--no-edit", "--", &reference])?;
        }
        "mergeAbort" => {
            git(w, &["merge", "--abort"])?;
        }
        "mergeContinue" => {
            git(w, &["-c", "core.editor=true", "merge", "--continue"])?;
        }
        "stash" => {
            let message = a["message"]
                .as_str()
                .unwrap_or("Modifications mises de côté depuis Galeata");
            if message.len() > 10_000 {
                return Err("Message trop long".into());
            }
            git(w, &["stash", "push", "--include-untracked", "-m", message])?;
        }
        "stashPop" | "stashApply" => {
            // Resolve the stable object ID at the last moment: stash indices can change.
            let oid = get("oid")?;
            let state = overview(w)?;
            let stash = state["stashes"]
                .as_array()
                .and_then(|items| items.iter().find(|item| item["oid"].as_str() == Some(oid)))
                .and_then(|item| item["id"].as_str())
                .ok_or("Ce stash n’existe plus. Actualisez la liste.")?;
            let command = if action == "stashPop" { "pop" } else { "apply" };
            git(w, &["stash", command, "--index", "--", stash])?;
        }
        "worktree" => {
            let name = get("name")?;
            new_branch(w, name)?;
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
    fn repository() -> (tempfile::TempDir, Workspace) {
        let directory = tempfile::tempdir().unwrap();
        let w = Workspace::open(directory.path().to_str().unwrap()).unwrap();
        git(&w, &["init", "-b", "main"]).unwrap();
        for (key, value) in [
            ("user.name", "Galeata Test"),
            ("user.email", "test@example.invalid"),
            ("commit.gpgsign", "false"),
        ] {
            git(&w, &["config", key, value]).unwrap();
        }
        fs::write(directory.path().join("base.txt"), "base\n").unwrap();
        git(&w, &["add", "."]).unwrap();
        git(&w, &["commit", "-m", "Initial"]).unwrap();
        (directory, w)
    }

    #[test]
    fn branches_merge_conflicts_and_abort_preserve_the_destination() {
        let (directory, w) = repository();
        mutate(&w, "branch", &json!({"name":"feature/topic"})).unwrap();
        fs::write(directory.path().join("feature.txt"), "feature\n").unwrap();
        git(&w, &["add", "."]).unwrap();
        git(&w, &["commit", "-m", "Feature"]).unwrap();
        mutate(&w, "switch", &json!({"name":"main"})).unwrap();
        assert_eq!(
            overview(&w).unwrap()["branches"].as_array().unwrap().len(),
            2
        );
        mutate(&w, "merge", &json!({"name":"feature/topic"})).unwrap();
        assert!(directory.path().join("feature.txt").exists());
        mutate(&w, "branch", &json!({"name":"conflicting"})).unwrap();
        fs::write(directory.path().join("base.txt"), "topic\n").unwrap();
        git(&w, &["commit", "-am", "Topic"]).unwrap();
        mutate(&w, "switch", &json!({"name":"main"})).unwrap();
        fs::write(directory.path().join("base.txt"), "main\n").unwrap();
        git(&w, &["commit", "-am", "Main"]).unwrap();
        assert!(mutate(&w, "merge", &json!({"name":"conflicting"})).is_err());
        let state = status(&w).unwrap();
        assert_eq!(state["merging"], true);
        assert_eq!(state["files"][0]["conflicted"], true);
        mutate(&w, "mergeAbort", &json!({})).unwrap();
        assert_eq!(
            fs::read_to_string(directory.path().join("base.txt")).unwrap(),
            "main\n"
        );
        assert_eq!(status(&w).unwrap()["merging"], false);
        for name in ["--force", "@{-1}", "main~1", "missing"] {
            assert!(mutate(&w, "switch", &json!({"name":name})).is_err());
            assert!(mutate(&w, "merge", &json!({"name":name})).is_err());
        }
    }

    #[test]
    fn stash_tracks_untracked_files_and_uses_stable_ids() {
        let (directory, w) = repository();
        fs::write(directory.path().join("base.txt"), "saved\n").unwrap();
        git(&w, &["add", "base.txt"]).unwrap();
        fs::write(directory.path().join("new file.txt"), "untracked\n").unwrap();
        mutate(&w, "stash", &json!({"message":"Work in progress"})).unwrap();
        assert_eq!(status(&w).unwrap()["files"].as_array().unwrap().len(), 0);
        assert!(!directory.path().join("new file.txt").exists());
        let first = overview(&w).unwrap()["stashes"][0]["oid"].clone();
        fs::write(directory.path().join("other.txt"), "other\n").unwrap();
        mutate(&w, "stash", &json!({"message":"Other work"})).unwrap();
        mutate(&w, "stashPop", &json!({"oid":first})).unwrap();
        assert_eq!(
            fs::read_to_string(directory.path().join("base.txt")).unwrap(),
            "saved\n"
        );
        assert!(directory.path().join("new file.txt").exists());
        assert_eq!(status(&w).unwrap()["files"][0]["index"], "M");
        assert_eq!(
            overview(&w).unwrap()["stashes"].as_array().unwrap().len(),
            1
        );
        assert!(mutate(&w, "stashPop", &json!({"oid":first})).is_err());
    }

    #[test]
    fn conflicting_stash_is_retained_and_remote_branches_can_be_checked_out() {
        let (directory, w) = repository();
        git(&w, &["branch", "remote-topic"]).unwrap();
        let remote = tempfile::tempdir().unwrap();
        git(
            &w,
            &[
                "clone",
                "--bare",
                directory.path().to_str().unwrap(),
                remote.path().join("origin.git").to_str().unwrap(),
            ],
        )
        .unwrap();
        git(
            &w,
            &[
                "remote",
                "add",
                "origin",
                remote.path().join("origin.git").to_str().unwrap(),
            ],
        )
        .unwrap();
        git(&w, &["branch", "-D", "remote-topic"]).unwrap();
        mutate(&w, "fetch", &json!({})).unwrap();
        assert!(overview(&w).unwrap()["branches"]
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["name"] == "origin/remote-topic" && b["remote"] == true));
        mutate(
            &w,
            "switch",
            &json!({"name":"origin/remote-topic","remote":true}),
        )
        .unwrap();
        assert_eq!(status(&w).unwrap()["upstream"], "origin/remote-topic");
        mutate(&w, "switch", &json!({"name":"main"})).unwrap();
        mutate(
            &w,
            "switch",
            &json!({"name":"origin/remote-topic","remote":true}),
        )
        .unwrap();
        assert_eq!(status(&w).unwrap()["branch"], "remote-topic");
        mutate(&w, "branch", &json!({"name":"publish-topic"})).unwrap();
        mutate(&w, "push", &json!({"remote":"origin"})).unwrap();
        assert_eq!(status(&w).unwrap()["upstream"], "origin/publish-topic");
        fs::write(directory.path().join("base.txt"), "stash\n").unwrap();
        mutate(&w, "stash", &json!({})).unwrap();
        let oid = overview(&w).unwrap()["stashes"][0]["oid"].clone();
        fs::write(directory.path().join("base.txt"), "committed\n").unwrap();
        git(&w, &["commit", "-am", "Diverge"]).unwrap();
        assert!(mutate(&w, "stashPop", &json!({"oid":oid})).is_err());
        assert_eq!(
            overview(&w).unwrap()["stashes"].as_array().unwrap().len(),
            1
        );
        assert_eq!(status(&w).unwrap()["files"][0]["conflicted"], true);
    }

    #[test]
    fn resolved_merge_can_finish_and_stash_apply_keeps_the_stash() {
        let (directory, w) = repository();
        mutate(&w, "branch", &json!({"name":"topic"})).unwrap();
        fs::write(directory.path().join("base.txt"), "topic\n").unwrap();
        git(&w, &["commit", "-am", "Topic"]).unwrap();
        mutate(&w, "switch", &json!({"name":"main"})).unwrap();
        fs::write(directory.path().join("base.txt"), "main\n").unwrap();
        git(&w, &["commit", "-am", "Main"]).unwrap();
        assert!(mutate(&w, "merge", &json!({"name":"topic"})).is_err());
        fs::write(directory.path().join("base.txt"), "resolved\n").unwrap();
        mutate(&w, "stage", &json!({"path":"base.txt"})).unwrap();
        mutate(&w, "mergeContinue", &json!({})).unwrap();
        assert_eq!(status(&w).unwrap()["merging"], false);
        fs::write(directory.path().join("base.txt"), "work\n").unwrap();
        mutate(&w, "stash", &json!({})).unwrap();
        let oid = overview(&w).unwrap()["stashes"][0]["oid"].clone();
        mutate(&w, "stashApply", &json!({"oid":oid})).unwrap();
        assert_eq!(
            overview(&w).unwrap()["stashes"].as_array().unwrap().len(),
            1
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("base.txt")).unwrap(),
            "work\n"
        );
    }

    #[test]
    fn reading_status_does_not_rewrite_the_index() {
        let (directory, w) = repository();
        let index = directory.path().join(".git/index");
        let before = fs::read(&index).unwrap();
        // Identical content with fresh stat data would normally refresh the index.
        std::thread::sleep(Duration::from_millis(20));
        fs::write(directory.path().join("base.txt"), "base\n").unwrap();
        for _ in 0..3 {
            assert!(status(&w).unwrap()["files"].as_array().unwrap().is_empty());
        }
        assert_eq!(fs::read(index).unwrap(), before);
    }

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
