//! Opens web links from agent messages in the user's default browser.

use crate::store::Result;
use std::process::{Command, Stdio};

const MAX_URL_LEN: usize = 4096;

/// Only plain web and mail links are accepted: no `file:`, no custom schemes,
/// no whitespace or control characters that a handler could misinterpret.
pub fn validate(url: &str) -> Result<&str> {
    let lower = url.get(..8).unwrap_or(url).to_ascii_lowercase();
    let allowed = lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:");
    if !allowed {
        return Err("Seuls les liens http(s) et mailto peuvent être ouverts".into());
    }
    if url.len() > MAX_URL_LEN {
        return Err("Lien trop long".into());
    }
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Lien invalide".into());
    }
    Ok(url)
}

/// Hands the link to `xdg-open` (structured argument, host environment,
/// detached). The child is reaped in the background so no zombie remains.
pub fn open_url(url: &str) -> Result<()> {
    let url = validate(url)?;
    let mut command = Command::new("xdg-open");
    command
        .arg(url)
        // Without the AppImage runtime variables (see galeata_agent_protocol::host_env).
        .env_clear()
        .envs(galeata_agent_protocol::host_env(std::env::vars_os()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Impossible d’ouvrir le lien (xdg-open) : {e}"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate;

    #[test]
    fn accepts_web_and_mail_links() {
        assert!(validate("https://example.com/a?b=c#d").is_ok());
        assert!(validate("HTTP://example.com").is_ok());
        assert!(validate("mailto:someone@example.com").is_ok());
    }

    #[test]
    fn rejects_other_schemes_and_malformed_links() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "/home/user/x",
            "--help",
            "https://exa mple.com",
            "https://example.com/\n",
            "",
        ] {
            assert!(validate(url).is_err(), "{url} should be rejected");
        }
        assert!(validate(&format!("https://{}", "a".repeat(5000))).is_err());
    }
}
