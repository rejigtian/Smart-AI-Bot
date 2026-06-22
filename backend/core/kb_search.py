"""Knowledge retrieval via a project's own search CLI.

A Project Profile may set `kb_search_cmd` — whatever command that project's
knowledge base / skill exposes for search. We shell out to it; the project's
service does the (usually better) retrieval and returns ranked fragments + doc
paths. The framework stays project-agnostic: the actual command lives in the
user's profile, never hard-coded here. Best-effort — any failure (missing
binary, timeout, error) returns "" so the run is unaffected.
"""
from __future__ import annotations

import glob
import logging
import os
import shlex
import shutil
import subprocess

logger = logging.getLogger(__name__)

_MAX_OUTPUT_CHARS = 4000
_MAX_DOC_CHARS = 8000
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


def read_kb_doc(kb_roots: list[str], path: str) -> str:
    """Read a full KB doc by the (possibly relative) path that search returned.

    Search fragments cite a path relative to the KB's own root, which may not be
    kb_path directly (e.g. the doc lives under kb_path/knowledge/...). So resolve
    it tolerantly: try the direct join, else find a file under kb_path whose path
    ends with the cited one (or matches its basename). Confined to kb_roots."""
    rel = (path or "").strip().lstrip("/")
    if not rel:
        return "Empty path."
    for root in kb_roots or []:
        root = os.path.realpath(os.path.expanduser(root))
        if not os.path.isdir(root):
            continue
        cand = None
        direct = os.path.realpath(os.path.join(root, rel))
        if os.path.isfile(direct) and (direct == root or direct.startswith(root + os.sep)):
            cand = direct
        else:
            hits = [p for p in glob.glob(os.path.join(root, "**", os.path.basename(rel)), recursive=True)
                    if os.path.isfile(p)]
            # Prefer a hit whose tail matches the full cited path.
            exact = [p for p in hits if p.replace(root + os.sep, "").endswith(rel)]
            cand = (exact or hits or [None])[0]
        if cand:
            try:
                return open(cand, encoding="utf-8", errors="ignore").read()[:_MAX_DOC_CHARS]
            except Exception as e:
                return f"Read failed: {e}"
    return f"KB doc not found: {rel}"
