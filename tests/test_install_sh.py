"""Tests of the one-line installer (install.sh) with a fake AppImage served over file://.

Run: python3 -m unittest discover -s tests -p 'test_install_*.py' -v
The installer runs under dash when available, to stay POSIX-compatible.
"""
from pathlib import Path
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "install.sh"
ASSET = "galeata-linux-x86_64.AppImage"
SHELL = shutil.which("dash") or "/bin/sh"

# Minimal stand-in for an AppImage: supports --appimage-extract like the real runtime.
FAKE_APPIMAGE = """#!/bin/sh
if [ "$1" = "--appimage-extract" ]; then
    mkdir -p squashfs-root/usr/bin
    cat > squashfs-root/AppRun <<'RUN'
#!/bin/sh
printf 'galeata %s\\n' "{label}"
for argument in "$@"; do printf '[%s]\\n' "$argument"; done
RUN
    chmod +x squashfs-root/AppRun
    cp "{icon}" squashfs-root/galeata.png
    exit 0
fi
echo "FUSE requis" >&2
exit 1
"""


@unittest.skipUnless(sys.platform == "linux" and shutil.which("curl") and shutil.which("sha256sum"), "Linux, curl and sha256sum required")
class OneLineInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="galeata-install-sh-")
        self.root = Path(self.temporary.name)
        self.home = self.root / "home with spaces"
        self.home.mkdir()
        self.data = self.home / ".local/share"
        self.bin = self.home / ".local/bin"
        self.tools = self.root / "tools"
        self.tools.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def release(self, label, corrupt=False, version="v9.9.9"):
        directory = self.root / f"release-{label}"
        directory.mkdir()
        appimage = directory / ASSET
        appimage.write_text(FAKE_APPIMAGE.replace("{label}", label).replace("{icon}", str(ROOT / "src-tauri/icons/128x128.png")))
        appimage.chmod(0o755)
        digest = hashlib.sha256(appimage.read_bytes()).hexdigest()
        if corrupt:
            digest = "0" * 64
        (directory / "SHA256SUMS").write_text(f"{digest}  {ASSET}\n")
        (directory / "VERSION").write_text(version)
        return directory

    def run_installer(self, release=None, *arguments, extra_path=""):
        environment = {
            "HOME": str(self.home),
            "PATH": f"{extra_path + ':' if extra_path else ''}{self.tools}:/usr/bin:/bin",
            "TMPDIR": str(self.root),
            "LC_ALL": "C.UTF-8",
        }
        if release:
            environment["GALEATA_DOWNLOAD_URL"] = release.as_uri()
        return subprocess.run([SHELL, str(INSTALLER), *arguments], text=True, capture_output=True, env=environment)

    def launcher(self):
        return self.bin / "galeata"

    def desktop(self):
        return self.data / "applications/dev.olivierlb.galeata.desktop"

    def versions(self):
        return sorted(p.name for p in (self.data / "galeata/versions").iterdir() if not p.name.startswith("."))

    def test_install_adds_launcher_menu_entry_and_keeps_arguments(self):
        result = self.run_installer(self.release("A"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Empreinte SHA-256 vérifiée", result.stdout)
        self.assertIn("Galeata v9.9.9 est installée", result.stdout)
        launched = subprocess.run([str(self.launcher()), "un argument", "l'étoile $HOME"], text=True, capture_output=True)
        self.assertEqual(launched.returncode, 0, launched.stderr)
        self.assertEqual(launched.stdout.splitlines(), ["galeata A", "[un argument]", "[l'étoile $HOME]"])
        desktop = self.desktop().read_text()
        self.assertIn("Name=Galeata", desktop)
        self.assertIn(f'Exec="{self.launcher()}"', desktop)
        self.assertIn("Icon=", desktop)
        if shutil.which("desktop-file-validate"):
            validated = subprocess.run(["desktop-file-validate", str(self.desktop())], text=True, capture_output=True)
            self.assertEqual(validated.returncode, 0, validated.stdout + validated.stderr)

    def test_reinstall_updates_and_keeps_only_recent_versions(self):
        for label in ("A", "B", "C"):
            result = self.run_installer(self.release(label))
            self.assertEqual(result.returncode, 0, result.stderr)
        # Same release again: idempotent.
        self.assertEqual(self.run_installer(self.root / "release-C").returncode, 0)
        launched = subprocess.run([str(self.launcher())], text=True, capture_output=True)
        self.assertEqual(launched.stdout.strip(), "galeata C")
        self.assertEqual(len(self.versions()), 2, self.versions())

    def test_updates_preserve_running_versions_until_the_process_exits(self):
        release_a = self.release("A")
        self.assertEqual(self.run_installer(release_a).returncode, 0)
        active = (self.data / "galeata/current").resolve()
        # A real executable is needed: /proc/<pid>/exe points at the shell for scripts.
        binary = active / "usr/bin/galeata"
        shutil.copy2(shutil.which("sleep"), binary)
        library = active / "usr/lib/libpixbufloader-svg.so"
        library.parent.mkdir(parents=True)
        library.write_bytes(b"loader fixture")
        process = subprocess.Popen([str(binary), "60"])
        try:
            self.assertEqual(Path(f"/proc/{process.pid}/exe").resolve(), binary)
            for label in ("B", "C", "D"):
                result = self.run_installer(self.release(label))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(library.is_file(), "A running version lost its runtime loader")
            self.assertEqual(process.poll(), None)
            self.assertEqual(len(self.versions()), 3, self.versions())
            launched = subprocess.run([str(self.launcher())], text=True, capture_output=True)
            self.assertEqual(launched.stdout.strip(), "galeata D")
        finally:
            process.terminate()
            process.wait(timeout=5)
        result = self.run_installer(self.root / "release-D")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(active.exists())
        self.assertEqual(len(self.versions()), 2, self.versions())

    def test_wrong_checksum_installs_nothing(self):
        result = self.run_installer(self.release("A", corrupt=True))
        self.assertEqual(result.returncode, 1)
        self.assertIn("empreinte SHA-256 incorrecte", result.stderr)
        self.assertFalse(self.launcher().exists())
        self.assertFalse((self.data / "galeata/current").exists())

    def test_foreign_launcher_is_preserved(self):
        self.bin.mkdir(parents=True)
        self.launcher().write_text("#!/bin/sh\necho mien\n")
        result = self.run_installer(self.release("A"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("fichier existant conservé", result.stderr)
        self.assertEqual(self.launcher().read_text(), "#!/bin/sh\necho mien\n")

    def test_uninstall_keeps_user_data(self):
        self.assertEqual(self.run_installer(self.release("A")).returncode, 0)
        user_data = self.data / "dev.olivierlb.galeata"
        user_data.mkdir(parents=True)
        (user_data / "galeata.sqlite").write_text("plans")
        result = self.run_installer(None, "--uninstall")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.launcher().exists())
        self.assertFalse(self.desktop().exists())
        self.assertFalse((self.data / "galeata").exists())
        self.assertEqual((user_data / "galeata.sqlite").read_text(), "plans")

    def test_one_agent_cli_is_enough(self):
        agents = self.root / "agents"
        agents.mkdir()
        claude = agents / "claude"
        claude.write_text("#!/bin/sh\n")
        claude.chmod(0o755)
        result = self.run_installer(self.release("A"), extra_path=str(agents))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Claude Code : détecté", result.stdout)
        self.assertIn("Codex       : absent", result.stdout)
        self.assertNotIn("a besoin de", result.stdout)
        # The launcher remembers where the CLI lives for menu launches.
        self.assertIn(str(agents), self.launcher().read_text())

    def test_no_agent_cli_explains_that_one_is_needed(self):
        result = self.run_installer(self.release("A"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Claude Code ou de Codex (un seul suffit)", result.stdout)

    def test_piped_script_installs(self):
        """`curl … | sh`: the script arrives on stdin."""
        environment = {
            "HOME": str(self.home),
            "PATH": f"{self.tools}:/usr/bin:/bin",
            "TMPDIR": str(self.root),
            "GALEATA_DOWNLOAD_URL": self.release("A").as_uri(),
        }
        result = subprocess.run([SHELL], input=INSTALLER.read_text(), text=True, capture_output=True, env=environment)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.launcher().is_file())

    def test_unknown_option_is_rejected(self):
        result = self.run_installer(None, "--force")
        self.assertEqual(result.returncode, 1)
        self.assertIn("option inconnue", result.stderr)


if __name__ == "__main__":
    unittest.main()
