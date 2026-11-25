//! Environment for processes started by Galeata.
//!
//! The AppImage runtime prepends its own directories to `PATH`, `LD_LIBRARY_PATH`,
//! `XDG_DATA_DIRS`… and sets `PYTHONHOME`, `PERLLIB`, `GTK_*`, `GIO_*` so that
//! Galeata finds its bundled libraries. Child processes must not inherit them: a
//! Python-based `claude` launcher, git hooks or the user's shell would load the
//! bundled runtime instead of the system one and fail.
//! When `APPDIR` is set, every entry under it is removed; variables that only
//! pointed into the AppImage are dropped. Outside an AppImage nothing changes.

use std::ffi::{OsStr, OsString};
use std::os::unix::ffi::{OsStrExt, OsStringExt};

/// Variables the AppImage runtime sets for itself, whatever their value.
const RUNTIME_ONLY: &[&str] = &[
    "APPDIR",
    "APPIMAGE",
    "ARGV0",
    "OWD",
    "PYTHONDONTWRITEBYTECODE",
];

/// Returns the environment to give child processes.
pub fn host_env<I>(vars: I) -> Vec<(OsString, OsString)>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    let vars: Vec<(OsString, OsString)> = vars.into_iter().collect();
    let Some(appdir) = vars
        .iter()
        .find(|(key, value)| key == "APPDIR" && !value.is_empty())
        .map(|(_, value)| value.as_bytes().to_vec())
    else {
        return vars;
    };
    let appdir = trim_slashes(&appdir).to_vec();
    let inside = |entry: &[u8]| {
        let entry = trim_slashes(entry);
        entry == appdir.as_slice()
            || (entry.starts_with(&appdir) && entry.get(appdir.len()) == Some(&b'/'))
    };
    vars.into_iter()
        .filter(|(key, _)| !RUNTIME_ONLY.iter().any(|name| key == OsStr::new(name)))
        .filter_map(|(key, value)| {
            let bytes = value.as_bytes();
            if !bytes.windows(appdir.len()).any(|w| w == appdir.as_slice()) {
                return Some((key, value));
            }
            let kept = bytes
                .split(|b| *b == b':')
                .filter(|entry| !entry.is_empty() && !inside(entry))
                .collect::<Vec<_>>();
            if kept.is_empty() {
                None
            } else {
                Some((key, OsString::from_vec(kept.join(&b':'))))
            }
        })
        .collect()
}

fn trim_slashes(value: &[u8]) -> &[u8] {
    let mut end = value.len();
    while end > 1 && value[end - 1] == b'/' {
        end -= 1;
    }
    &value[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Vec<(OsString, OsString)> {
        pairs
            .iter()
            .map(|(k, v)| (OsString::from(k), OsString::from(v)))
            .collect()
    }
    fn get<'a>(vars: &'a [(OsString, OsString)], key: &str) -> Option<&'a str> {
        vars.iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.to_str().unwrap())
    }

    #[test]
    fn appimage_entries_are_removed_and_user_entries_kept() {
        let vars = host_env(env(&[
            ("APPDIR", "/home/u/.local/share/galeata/versions/abc"),
            (
                "PATH",
                "/home/u/.local/share/galeata/versions/abc/usr/bin/:/home/u/.local/bin:/usr/bin",
            ),
            (
                "LD_LIBRARY_PATH",
                "/home/u/.local/share/galeata/versions/abc/usr/lib/",
            ),
            (
                "PYTHONHOME",
                "/home/u/.local/share/galeata/versions/abc/usr/",
            ),
            (
                "XDG_DATA_DIRS",
                "/home/u/.local/share/galeata/versions/abc/usr/share/:/usr/share",
            ),
            (
                "GTK_DATA_PREFIX",
                "/home/u/.local/share/galeata/versions/abc",
            ),
            ("PYTHONDONTWRITEBYTECODE", "1"),
            ("HOME", "/home/u"),
            ("GTK_THEME", "Adwaita:dark"),
            // Same prefix, different directory: must stay.
            ("OTHER", "/home/u/.local/share/galeata/versions/abcdef/bin"),
        ]));
        assert_eq!(get(&vars, "PATH"), Some("/home/u/.local/bin:/usr/bin"));
        assert_eq!(get(&vars, "XDG_DATA_DIRS"), Some("/usr/share"));
        assert_eq!(get(&vars, "LD_LIBRARY_PATH"), None);
        assert_eq!(get(&vars, "PYTHONHOME"), None);
        assert_eq!(get(&vars, "GTK_DATA_PREFIX"), None);
        assert_eq!(get(&vars, "APPDIR"), None);
        assert_eq!(get(&vars, "PYTHONDONTWRITEBYTECODE"), None);
        assert_eq!(get(&vars, "HOME"), Some("/home/u"));
        assert_eq!(get(&vars, "GTK_THEME"), Some("Adwaita:dark"));
        assert_eq!(
            get(&vars, "OTHER"),
            Some("/home/u/.local/share/galeata/versions/abcdef/bin")
        );
    }

    #[test]
    fn outside_an_appimage_nothing_changes() {
        let original = env(&[("PATH", "/usr/bin"), ("PYTHONDONTWRITEBYTECODE", "1")]);
        assert_eq!(host_env(original.clone()), original);
    }
}
