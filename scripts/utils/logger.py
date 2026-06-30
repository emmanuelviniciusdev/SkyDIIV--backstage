"""
Structured logger for backstage scripts.

Output format: YYYY-MM-DD HH:MM:SS ({TZ}): [{LEVEL}] {MESSAGE}

The timezone label is derived from the system's local UTC offset at startup
(e.g. ``UTC``, ``UTC+1``, ``UTC-3``).

Usage::

    from utils.logger import Logger

    log = Logger()                         # stdout only
    log = Logger(output_file="output.txt") # stdout + file

    log.info("Starting script")
    log.warning("Item skipped")
    log.error("Connection failed")
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import IO


def _utc_offset_label() -> str:
    """Return the local UTC offset as a human-readable label (e.g. 'UTC-3')."""
    offset = datetime.now(timezone.utc).astimezone().utcoffset()
    total_hours = int(offset.total_seconds() // 3600)
    if total_hours == 0:
        return "UTC"
    if total_hours > 0:
        return f"UTC+{total_hours}"
    return f"UTC{total_hours}"


class Logger:
    """
    Writes timestamped, leveled messages to stdout and optionally to a file.

    Parameters
    ----------
    output_file:
        Path to a file where messages are appended.  Pass ``None`` to disable
        file output (stdout only).
    tz_label:
        Override the timezone label shown in every line (e.g. ``"UTC-3"``).
        Defaults to the system's local UTC offset.
    """

    LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR")

    def __init__(
        self,
        output_file: str | Path | None = None,
        tz_label: str | None = None,
    ) -> None:
        self._locale = tz_label or _utc_offset_label()
        self._file: IO[str] | None = None
        if output_file is not None:
            self._file = open(output_file, "a", encoding="utf-8")

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    def debug(self, message: str) -> None:
        self._write("DEBUG", message)

    def info(self, message: str) -> None:
        self._write("INFO", message)

    def warning(self, message: str) -> None:
        self._write("WARNING", message)

    def error(self, message: str) -> None:
        self._write("ERROR", message)

    def close(self) -> None:
        if self._file is not None:
            self._file.close()
            self._file = None

    def __enter__(self) -> "Logger":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _write(self, level: str, message: str) -> None:
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"{ts} ({self._locale}): [{level}] {message}"
        print(line, flush=True)
        if self._file is not None:
            self._file.write(line + "\n")
            self._file.flush()
