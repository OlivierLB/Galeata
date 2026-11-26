//! Atomic replacement of existing files, with caller-owned conflict validation.
use crate::store::Result;
use std::{fs, io::Write, path::Path};

pub fn replace(target: &Path, content: &[u8], validate: impl FnOnce() -> Result<()>) -> Result<()> {
    let temp = target.with_file_name(format!(".galeata-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.set_permissions(
            fs::metadata(target)
                .map_err(|e| e.to_string())?
                .permissions(),
        )
        .map_err(|e| e.to_string())?;
        file.write_all(content).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        validate()?;
        fs::rename(&temp, target).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn replaces_content_and_preserves_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("file");
        fs::write(&target, "before").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();
        replace(&target, b"after", || Ok(())).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "after");
        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o640
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn validation_failure_preserves_external_changes_and_cleans_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("file");
        fs::write(&target, "before").unwrap();
        let result = replace(&target, b"ours", || {
            fs::write(&target, "external").unwrap();
            Err("FILE_CONFLICT".into())
        });
        assert_eq!(result.unwrap_err(), "FILE_CONFLICT");
        assert_eq!(fs::read_to_string(&target).unwrap(), "external");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn missing_destination_does_not_leave_temporary_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(replace(&dir.path().join("missing"), b"text", || Ok(())).is_err());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
