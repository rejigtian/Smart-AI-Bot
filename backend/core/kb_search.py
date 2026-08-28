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
import re
import shlex
import shutil
import subprocess
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_MAX_OUTPUT_CHARS = 4000
_MAX_DOC_CHARS = 8000
_TIMEOUT = 60


@dataclass(frozen=True)
class KBSearchResult:
    """Outcome of a project knowledge-search CLI invocation.

    Some CLIs can print a tool/validation error while still
    exiting with status 0. Keeping success state separate from text prevents
    those diagnostics from being injected into the test agent as knowledge.
    """

    text: str = ""
    error: str = ""

    @property
    def succeeded(self) -> bool:
        return not self.error


_ERROR_OUTPUT_RE = re.compile(
    r"(?:^|\n)\s*(?:"
    r"Error executing tool\b|"
    r"Traceback \(most recent call last\):|"
    r"\d+ validation errors? for\b"
    r")",
    re.IGNORECASE,
)


def _short_error(text: str, limit: int = 500) -> str:
    """Collapse CLI diagnostics to a log-friendly single line."""
    compact = " ".join((text or "").split())
    return compact[:limit]


def run_kb_search_result(cmd: str, query: str, n: int = 5) -> KBSearchResult:
    """Run `<cmd> "<query>" -n <n>` and return text plus explicit status."""
    cmd = (cmd or "").strip()
    query = (query or "").strip()
    if not cmd or not query:
        return KBSearchResult(error="empty knowledge-search command or query")
    try:
        argv = shlex.split(cmd)
    except Exception as exc:
        return KBSearchResult(error=f"invalid knowledge-search command: {exc}")
    if not argv:
        return KBSearchResult(error="empty knowledge-search command")
    if not shutil.which(argv[0]):
        return KBSearchResult(error=f"knowledge-search executable not found: {argv[0]}")
    try:
        completed = subprocess.run(
            argv + [query, "-n", str(n)],
            capture_output=True, text=True, timeout=_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        result = KBSearchResult(error=f"knowledge search timed out after {_TIMEOUT}s")
    except Exception as exc:
        result = KBSearchResult(error=f"knowledge search failed: {exc}")
    else:
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        diagnostic = "\n".join(part for part in (stdout, stderr) if part)
        if completed.returncode != 0:
            detail = _short_error(stderr or stdout)
            suffix = f": {detail}" if detail else ""
            result = KBSearchResult(
                error=f"knowledge search exited with {completed.returncode}{suffix}"
            )
        elif _ERROR_OUTPUT_RE.search(diagnostic):
            result = KBSearchResult(
                error=f"knowledge search returned an error: {_short_error(diagnostic)}"
            )
        else:
            result = KBSearchResult(text=stdout[:_MAX_OUTPUT_CHARS])

    if result.error:
        logger.warning("kb search (%s) unavailable: %s", argv[0], result.error)
    return result


def run_kb_search(cmd: str, query: str, n: int = 5) -> str:
    """Compatibility wrapper returning only valid knowledge text."""
    result = run_kb_search_result(cmd, query, n)
    return result.text if result.succeeded else ""


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
