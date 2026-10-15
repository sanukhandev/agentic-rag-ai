from __future__ import annotations

import secrets
import shutil
from pathlib import Path

from .pipeline import MAX_BYTES


class LocalStaging:
    """Private local staging for one worker attempt; callers must purge staged files."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def stage(self, source: Path) -> Path:
        source = source.resolve()
        if not source.is_file():
            raise ValueError("Input file does not exist.")
        if source.stat().st_size > MAX_BYTES:
            raise ValueError("Input exceeds the 5 MiB ingestion limit.")
        destination = self.root / f"{secrets.token_hex(16)}{source.suffix.lower()}"
        shutil.copyfile(source, destination)
        try:
            destination.chmod(0o600)
        except OSError:
            pass
        return destination

    def purge(self, staged: Path) -> None:
        staged = staged.resolve()
        if self.root not in staged.parents:
            raise ValueError("Staged path is outside the private staging root.")
        staged.unlink(missing_ok=True)
