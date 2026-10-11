"""Exercise authorization and installation without requiring an HA runtime."""

import importlib.util
from pathlib import Path
import stat
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch


ROOT = Path(__file__).parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def stub(name, **attributes):
    module = ModuleType(name)
    module.__dict__.update(attributes)
    sys.modules[name] = module
    return module


class Forbidden(Exception):
    pass


stub("voluptuous", Schema=lambda value, **_: value, Optional=lambda value, **_: value,
     All=lambda *values: values, Match=lambda value: value, ALLOW_EXTRA=None)
web = stub("aiohttp.web", Request=object, Response=object, HTTPForbidden=Forbidden,
           json_response=lambda data, **kwargs: SimpleNamespace(data=data, **kwargs))
stub("aiohttp", web=web)
stub("homeassistant")
frontend = stub("homeassistant.components.frontend", async_register_built_in_panel=Mock())
stub("homeassistant.components", frontend=frontend)
stub("homeassistant.components.http", KEY_HASS="hass", HomeAssistantView=object)
stub("homeassistant.core", HomeAssistant=object)
cv = stub("homeassistant.helpers.config_validation", string=str)
stub("homeassistant.helpers", config_validation=cv)
stub("homeassistant.helpers.typing", ConfigType=dict)
panel = load("marco_panel", ROOT / "custom_components/marco/__init__.py")
installer = load("marco_installer", ROOT / "install-panel.py")


def user(*, active=True, admin=True, system=False):
    return SimpleNamespace(is_active=active, is_admin=admin, system_generated=system)


class Request(dict):
    def __init__(self, caller, target, user_id="a" * 32):
        super().__init__(hass_user=caller)
        self.query = {"user_id": user_id}
        self.lookup = AsyncMock(return_value=target)
        self.app = {"hass": SimpleNamespace(auth=SimpleNamespace(async_get_user=self.lookup))}


class AuthorizationTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_active_admin_callers_can_query_users(self):
        for caller in (None, user(active=False), user(admin=False)):
            with self.subTest(caller=caller), self.assertRaises(Forbidden):
                await panel.MarcoAccessView().get(Request(caller, user()))
        self.assertTrue(panel.MarcoAccessView.requires_auth)

    async def test_inactive_nonadmin_unknown_and_system_users_are_denied(self):
        for target in (None, user(active=False), user(admin=False), user(system=True)):
            with self.subTest(target=target):
                response = await panel.MarcoAccessView().get(Request(user(system=True), target))
                self.assertEqual(response.data, {"allowed": False})
                self.assertEqual(response.headers["Cache-Control"], "no-store")

    async def test_active_human_admin_is_allowed_and_checked_each_time(self):
        request = Request(user(system=True), user())
        for _ in range(2):
            response = await panel.MarcoAccessView().get(request)
            self.assertEqual(response.data, {"allowed": True})
        self.assertEqual(request.lookup.await_count, 2)

    async def test_missing_or_oversized_identifier_is_denied_without_lookup(self):
        for value in ("", "x" * 129):
            request = Request(user(system=True), user(), value)
            response = await panel.MarcoAccessView().get(request)
            self.assertEqual(response.data, {"allowed": False})
            request.lookup.assert_not_awaited()

    async def test_native_panel_uses_configured_app_and_admin_access(self):
        frontend.async_register_built_in_panel.reset_mock()
        hass = SimpleNamespace(http=SimpleNamespace(register_view=Mock()))
        self.assertTrue(await panel.async_setup(hass, {"marco": {"addon_slug": "local_marco"}}))
        kwargs = frontend.async_register_built_in_panel.call_args.kwargs
        self.assertEqual(kwargs["component_name"], "app")
        self.assertEqual(kwargs["frontend_url_path"], "marco")
        self.assertEqual(kwargs["config"], {"addon": "local_marco"})
        self.assertTrue(kwargs["require_admin"])
        self.assertIsInstance(hass.http.register_view.call_args.args[0], panel.MarcoAccessView)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.config = self.root / "configuration.yaml"
        self.original = b"default_config:\n\ncinema:\n"
        self.config.write_bytes(self.original)
        self.config.chmod(0o640)

    def test_install_preserves_unrelated_config_permissions_backup_and_is_idempotent(self):
        backup = installer.install(self.root, "local_marco")
        self.assertEqual((backup / "configuration.yaml").read_bytes(), self.original)
        self.assertTrue(self.config.read_bytes().startswith(self.original))
        self.assertIn("marco:\n  addon_slug: local_marco\n", self.config.read_text())
        self.assertEqual(stat.S_IMODE(self.config.stat().st_mode), 0o640)
        target = self.root / "custom_components/marco"
        self.assertTrue((target / "__init__.py").is_file())
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o755)
        self.assertIsNone(installer.install(self.root, "local_marco"))

    def test_managed_update_changes_only_its_entry_and_retains_old_integration(self):
        installer.install(self.root, "local_marco")
        before = self.config.read_bytes()
        backup = installer.install(self.root, "7cc5cd13_marco")
        self.assertEqual((backup / "configuration.yaml").read_bytes(), before)
        self.assertTrue((backup / "marco/__init__.py").is_file())
        self.assertTrue(self.config.read_bytes().startswith(self.original))
        self.assertEqual(self.config.read_text().count("marco:\n"), 1)

    def test_concurrent_configuration_edit_is_preserved_and_integration_is_rolled_back(self):
        copy = installer.shutil.copy2
        changed = self.original + b"\nnew_integration:\n"

        def concurrent_edit(source, destination):
            copy(source, destination)
            self.config.write_bytes(changed)

        with patch.object(installer.shutil, "copy2", concurrent_edit), self.assertRaisesRegex(ValueError, "changed during installation"):
            installer.install(self.root, "local_marco")
        self.assertEqual(self.config.read_bytes(), changed)
        self.assertFalse((self.root / "custom_components/marco").exists())

    def test_unmanaged_integration_duplicate_or_complex_configuration_are_rejected(self):
        target = self.root / "custom_components/marco"
        target.mkdir(parents=True)
        with self.assertRaises(ValueError):
            installer.install(self.root, "local_marco")
        target.rmdir()
        for content in ("marco:\nmarco:\n", "marco:\n  other: value\n"):
            self.config.write_text(content)
            with self.subTest(content=content), self.assertRaises(ValueError):
                installer.install(self.root, "local_marco")
            self.assertEqual(self.config.read_text(), content)

    def test_symlinks_and_invalid_slug_are_rejected_without_modifying_config(self):
        for slug in ("../marco", "marco\nother:", ""):
            with self.subTest(slug=slug), self.assertRaises(ValueError):
                installer.install(self.root, slug)
        components = self.root / "custom_components"
        components.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            installer.install(self.root, "local_marco")
        self.assertEqual(self.config.read_bytes(), self.original)


if __name__ == "__main__":
    unittest.main()
