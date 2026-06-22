"""Source-code reading for the agent — Grep + Glob + Read over the target app's
source, scoped/sandboxed to the Project Profile's source_root.

Aims for the same effect as a general coding agent's code navigation: grep with
surrounding context, glob to find files by name, and read files by line range
with line numbers — so the agent can iterate (grep → read → grep) to locate
where a feature/screen/element lives when the UI alone isn't enough.

All operations are read-only and confined to source_root; a missing/invalid root
yields a clear, non-fatal message so the run continues.
"""
from __future__ import annotations

import os
import shutil
import subprocess

# Skip these dirs in the python fallback / glob (build noise, VCS).
_SKIP_DIRS = {".git", "build", ".gradle", ".idea", "node_modules", ".kotlin"}
_MAX_OUTPUT_CHARS = 4000
_MAX_READ_LINES = 400
_MAX_READ_BYTES = 16000


def _root(source_root: str) -> str:
    return os.path.realpath(os.path.expanduser((source_root or "").strip()))


def _within(root: str, path: str) -> bool:
    """True if `path` resolves inside `root` (blocks ../ escapes, symlinks)."""
    try:
        p = path if os.path.isabs(path) else os.path.join(root, path)
        p = os.path.realpath(p)
        return p == root or p.startswith(root + os.sep)
    except Exception:
        return False


def _ok(source_root: str) -> str:
    root = _root(source_root)
    return root if root and os.path.isdir(root) else ""


def search_source(source_root: str, query: str, context: int = 2,
                  glob: str = "", max_results: int = 60) -> str:
    """Grep the source for `query` (a regex) with N context lines, optional glob
    file filter. Returns matches with surrounding code, path:line prefixed."""
    root = _ok(source_root)
    if not root:
        return "Source not available (no source_root configured)."
    q = (query or "").strip()
    if not q:
        return "Empty query."
    context = max(0, min(int(context or 0), 6))

    rg = shutil.which("rg")
    if not rg:
        return _search_fallback(root, q, max_results)

    cmd = [rg, "-n", "--no-messages", "-S", "--max-count", "5",
           "--context", str(context), "-m", str(max_results)]
    for d in _SKIP_DIRS:
        cmd += ["-g", f"!{d}/"]
    if glob.strip():
        cmd += ["-g", glob.strip()]
    cmd += ["-e", q, root]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=25).stdout
    except Exception as e:
        return f"Search failed: {e}"
    if not out.strip():
        return f'No source matches for "{q}".'
    out = out.replace(root + os.sep, "")
    return f'Matches for "{q}" (path:line):\n{out[:_MAX_OUTPUT_CHARS]}'


def _search_fallback(root: str, q: str, max_results: int) -> str:
    matches: list[str] = []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
        for fn in files:
            fp = os.path.join(dirpath, fn)
            try:
                with open(fp, encoding="utf-8", errors="ignore") as f:
                    for i, ln in enumerate(f, 1):
                        if q in ln:
                            matches.append(f"{fp.replace(root + os.sep, '')}:{i}:{ln.strip()[:200]}")
                            if len(matches) >= max_results:
                                break
            except Exception:
                continue
            if len(matches) >= max_results:
                break
        if len(matches) >= max_results:
            break
    if not matches:
        return f'No source matches for "{q}".'
    return f'Matches for "{q}" (path:line):\n' + "\n".join(matches)


def glob_source(source_root: str, pattern: str, max_results: int = 100) -> str:
    """List files matching a glob (e.g. '**/*Activity.kt', 'activity_backpack.xml')."""
    root = _ok(source_root)
    if not root:
        return "Source not available (no source_root configured)."
    pat = (pattern or "").strip()
    if not pat:
        return "Empty pattern."
    rg = shutil.which("rg")
    paths: list[str] = []
    if rg:
        cmd = [rg, "--files", "--no-messages"]
        for d in _SKIP_DIRS:
            cmd += ["-g", f"!{d}/"]
        cmd += ["-g", pat, root]
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout
            paths = [p.replace(root + os.sep, "") for p in out.splitlines()][:max_results]
        except Exception as e:
            return f"Glob failed: {e}"
    else:
        import fnmatch
        for dirpath, dirs, files in os.walk(root):
            dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
            for fn in files:
                rel = os.path.join(dirpath, fn).replace(root + os.sep, "")
                if fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(fn, pat):
                    paths.append(rel)
                    if len(paths) >= max_results:
                        break
            if len(paths) >= max_results:
                break
    if not paths:
        return f'No files match "{pat}".'
    return f'{len(paths)} file(s) matching "{pat}":\n' + "\n".join(paths)


def read_source(source_root: str, path: str, offset: int = 1, limit: int = _MAX_READ_LINES) -> str:
    """Read a source file with line numbers, from `offset` (1-based) for `limit` lines."""
    root = _ok(source_root)
    if not root:
        return "Source not available (no source_root configured)."
    if not _within(root, path):
        return "Path is outside source_root — denied."
    fp = path if os.path.isabs(path) else os.path.join(root, path)
    if not os.path.isfile(fp):
        return f"Not a file: {path}"
    try:
        rows = open(fp, encoding="utf-8", errors="ignore").read().splitlines()
    except Exception as e:
        return f"Read failed: {e}"
    start = max(1, int(offset or 1))
    limit = max(1, min(int(limit or _MAX_READ_LINES), _MAX_READ_LINES))
    chunk = rows[start - 1:start - 1 + limit]
    numbered = "\n".join(f"{start + i:>5}\t{ln}" for i, ln in enumerate(chunk))
    suffix = "" if start - 1 + limit >= len(rows) else f"\n… ({len(rows)} lines total; continue with offset={start + limit})"
    return numbered[:_MAX_READ_BYTES] + suffix
