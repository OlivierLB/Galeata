from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts/install-linux.py"


@unittest.skipUnless(sys.platform == "linux" and shutil.which("dpkg-deb"), "Linux Debian tooling required")
class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="galeata-installer-test-")
        self.root = Path(self.temporary.name)
        self.data = self.root / "data with spaces"
        self.bin = self.root / "bin with spaces"

    def tearDown(self):
        self.temporary.cleanup()

    def package(self, name="galeata", bridge=True):
        payload = self.root / "payload"
        (payload / "DEBIAN").mkdir(parents=True)
        (payload / "DEBIAN/control").write_text(f"Package: {name}\nVersion: 0.1.0\nArchitecture: amd64\nMaintainer: Test <test@example.invalid>\nDescription: Installer fixture\n")
        (payload / "usr/bin").mkdir(parents=True)
        shutil.copy2("/bin/echo", payload / "usr/bin/galeata")
        if bridge:
            (payload / "usr/lib/galeata").mkdir(parents=True)
            shutil.copy2("/bin/true", payload / "usr/lib/galeata/galeata-mcp")
        icons = payload / "usr/share/icons/hicolor/128x128/apps"
        icons.mkdir(parents=True)
        shutil.copy2(ROOT / "src-tauri/icons/128x128.png", icons / "galeata.png")
        package = self.root / "galeata.deb"
        subprocess.run(["dpkg-deb", "--build", str(payload), str(package)], check=True, capture_output=True)
        return package

    def install(self, package):
        return subprocess.run([sys.executable, str(INSTALLER), "--archive", str(package), "--data-dir", str(self.data), "--bin-dir", str(self.bin)], text=True, capture_output=True)

    def test_zip_install_adds_menu_launcher_and_resource_without_changing_arguments(self):
        package = self.package()
        archive = self.root / "galeata.zip"
        with zipfile.ZipFile(archive, "w") as stream:
            stream.write(package, "../not-extracted/Galeata.deb")
        result = self.install(archive)
        self.assertEqual(result.returncode, 0, result.stderr)
        desktop = self.data / "applications/dev.olivierlb.galeata.desktop"
        self.assertIn('Name=Galeata', desktop.read_text())
        self.assertIn('Exec="', desktop.read_text())
        if shutil.which("desktop-file-validate"):
            validated = subprocess.run(["desktop-file-validate", str(desktop)], text=True, capture_output=True)
            self.assertEqual(validated.returncode, 0, validated.stdout + validated.stderr)
        current = self.data / "galeata/current"
        self.assertTrue(current.is_symlink())
        self.assertTrue((current / "usr/bin/galeata-mcp").is_file())
        launched = subprocess.run([str(self.bin / "galeata"), "un argument", "étoile"], text=True, capture_output=True)
        self.assertEqual(launched.returncode, 0, launched.stderr)
        self.assertEqual(launched.stdout.strip(), "un argument étoile")

    def test_reinstall_is_idempotent_and_keeps_application_data(self):
        package = self.package()
        self.assertEqual(self.install(package).returncode, 0)
        application_data = self.data / "dev.olivierlb.galeata"
        application_data.mkdir()
        database = application_data / "galeata.sqlite"
        database.write_bytes(b"keep this database")
        self.assertEqual(self.install(package).returncode, 0)
        self.assertEqual(len(list((self.data / "galeata/versions").iterdir())), 1)
        self.assertEqual(database.read_bytes(), b"keep this database")

    def test_existing_unrelated_launcher_is_preserved(self):
        package = self.package()
        self.bin.mkdir()
        launcher = self.bin / "galeata"
        launcher.write_text("precious existing file")
        result = self.install(package)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(launcher.read_text(), "precious existing file")
        self.assertFalse((self.data / "applications").exists())

    def test_other_package_is_rejected_before_installing(self):
        result = self.install(self.package(name="another-app"))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.bin / "galeata").exists())

    def test_incomplete_package_is_rejected_before_installing(self):
        result = self.install(self.package(bridge=False))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.bin / "galeata").exists())


if __name__ == "__main__":
    unittest.main()
