#!/usr/bin/env python3
"""Install Calendar's native Home Assistant panel without restarting services."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import shutil
import tempfile


MARKER = ".marco-panel-installer"
MARKER_CONTENT = "Marco Home Assistant panel\n"
DEFAULT_ADDON_SLUG = "7cc5cd13_marco"


def replace_file(path: Path, content: bytes) -> None:
    """Keep a configuration's permissions while replacing it atomically."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            temporary.chmod(path.stat().st_mode & 0o777)
            stream.write(content)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def install(configuration: Path, addon_slug: str) -> Path | None:
    """Install only managed files, retaining a backup for every changed setup."""
    if not re.fullmatch(r"[a-z0-9_-]+", addon_slug):
        raise ValueError("Invalid Home Assistant app slug")
    config = configuration / "configuration.yaml"
    components = configuration / "custom_components"
    target = components / "marco"
    if (configuration.is_symlink() or not configuration.is_dir()
            or config.is_symlink() or not config.is_file() or components.is_symlink()
            or target.is_symlink()):
        raise ValueError("Use regular Home Assistant configuration and integration paths")
    if target.exists():
        marker = target / MARKER
        if (not target.is_dir() or marker.is_symlink() or not marker.is_file()
                or marker.read_text() != MARKER_CONTENT):
            raise ValueError("The existing Calendar integration (marco) is unmanaged; review it before replacing it")
    original = config.read_bytes()
    text = original.decode()
    entry = f"marco:\n  addon_slug: {addon_slug}\n"
    matches = list(re.finditer(r"(?m)^marco[ \t]*:.*(?:\n[ \t]+[^\n]*)*\n?", text))
    if len(matches) > 1:
        raise ValueError("Home Assistant configuration contains duplicate Calendar integration entries (marco)")
    if matches:
        old_entry = matches[0].group()
        if not re.fullmatch(r"marco[ \t]*:[ \t]*(?:\n[ \t]+addon_slug:[ \t]*[a-z0-9_-]+[ \t]*)?\n?", old_entry):
            raise ValueError("Review the existing Calendar integration configuration (marco) manually before installing")
        updated = (text[:matches[0].start()] + entry + text[matches[0].end():]).encode()
    else:
        updated = original + (b"" if original.endswith(b"\n") else b"\n") + b"\n# Calendar sidebar panel\n" + entry.encode()
    source = Path(__file__).parent / "custom_components" / "marco"
    files = {name: (source / name).read_bytes() for name in ("__init__.py", "manifest.json")}
    if updated == original and target.is_dir() and all(
            (target / name).is_file() and not (target / name).is_symlink()
            and (target / name).read_bytes() == content for name, content in files.items()):
        return None
    components.mkdir(exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix="marco-panel-backup-", dir=configuration))
    shutil.copy2(config, backup / "configuration.yaml")
    staged = Path(tempfile.mkdtemp(prefix=".marco-", dir=components))
    staged.chmod(0o755)
    try:
        for name, content in files.items():
            (staged / name).write_bytes(content)
        (staged / MARKER).write_text(MARKER_CONTENT)
        if target.exists():
            target.rename(backup / "marco")
        try:
            staged.rename(target)
            if updated != original:
                if config.read_bytes() != original:
                    raise ValueError("Home Assistant configuration changed during installation; try again")
                replace_file(config, updated)
        except Exception:
            if target.exists():
                shutil.rmtree(target)
            if (backup / "marco").exists():
                (backup / "marco").rename(target)
            raise
    finally:
        if staged.exists():
            shutil.rmtree(staged)
    return backup


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config-dir", type=Path, default=Path("/config"))
    parser.add_argument("--addon-slug", default=DEFAULT_ADDON_SLUG)
    args = parser.parse_args()
    try:
        backup = install(args.config_dir, args.addon_slug)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Panel installation failed: {error}\n")
    if backup is None:
        print("Calendar's panel is already installed with this configuration")
    else:
        print(f"Calendar's panel is installed; previous configuration saved in {backup}")
        print("Validate Home Assistant's configuration before restarting Core to activate /calendar-dashboard")


if __name__ == "__main__":
    main()
