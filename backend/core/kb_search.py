"""Knowledge retrieval via a project's own search CLI.

A Project Profile may set `kb_search_cmd` — whatever command that project's
knowledge base / skill exposes for search. We shell out to it; the project's
service does the (usually better) retrieval and returns ranked fragments + doc
paths. The framework stays project-agnostic: the actual command lives in the
user's profile, never hard-coded here. Best-effort — any failure (missing
binary, timeout, error) returns "" so the run is unaffected.
"""
from __future__ import annotations

import logging
import shlex
import shutil
import subprocess

logger = logging.getLogger(__name__)

_MAX_OUTPUT_CHARS = 4000
_TIMEOUT = 60


def run_kb_search(cmd: str, query: str, n: int = 5) -> str:
    """Run `<cmd> "<query>" -n <n>` and return its stdout (capped). '' on failure."""
    cmd = (cmd or "").strip()
    query = (query or "").strip()
    if not cmd or not query:
        return ""
    try:
        argv = shlex.split(cmd)
    except Exception:
        return ""
    if not argv or not shutil.which(argv[0]):
        return ""
    try:
        out = subprocess.run(
            argv + [query, "-n", str(n)],
            capture_output=True, text=True, timeout=_TIMEOUT,
        ).stdout
    except Exception as exc:
        logger.warning("kb search (%s) failed: %s", argv[0], exc)
        return ""
    out = (out or "").strip()
    return out[:_MAX_OUTPUT_CHARS]
