"""Entry point: ``uv run python __main__.py``."""

from __future__ import annotations

import sys
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent
_SCRIPTS_ROOT = _SCRIPT_DIR.parent
for path in (_SCRIPT_DIR, _SCRIPTS_ROOT):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from runner import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
