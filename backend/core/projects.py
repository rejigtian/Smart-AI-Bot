"""Project Profiles — optional pointers to an external project's own resources
(knowledge base, skills, source) so the agent can test it better.

This is distinct from the local ``test_knowledge/`` (our own test KB). A profile
references the *target app team's* resources by absolute path — nothing is copied
into this repo. Everything is optional: with no matching profile (or missing
paths) the agent runs exactly as before.

Stored in ``backend/data/projects.json`` (gitignored — paths are machine-local).
"""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Optional

PROJECTS_PATH = Path(__file__).resolve().parent.parent / "data" / "projects.json"


def load_projects() -> list[dict]:
    try:
        return json.loads(PROJECTS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_projects(projects: list[dict]) -> None:
    PROJECTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROJECTS_PATH.write_text(
        json.dumps(projects, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def new_project(data: dict) -> dict:
    return {
        "id": uuid.uuid4().hex,
        "name": (data.get("name") or "").strip() or "Untitled project",
        "app_package": (data.get("app_package") or "").strip(),
        "kb_path": (data.get("kb_path") or "").strip(),
        "skills_path": (data.get("skills_path") or "").strip(),
        "source_root": (data.get("source_root") or "").strip(),
        # The project's own knowledge-search CLI (whatever its KB/skill exposes).
        # When set, it's used for retrieval instead of keyword search over kb_path.
        "kb_search_cmd": (data.get("kb_search_cmd") or "").strip(),
    }


def match_project(app_package: str) -> Optional[dict]:
    """The profile whose app_package matches (exact). None if no package / match."""
    if not app_package:
        return None
    for p in load_projects():
        if p.get("app_package") and p["app_package"] == app_package:
            return p
    return None


def resolve_path(path: str) -> str:
    """Expand ~ and make absolute. Relative paths resolve against the backend
    process CWD (discouraged — prefer an absolute path or ~/...)."""
    if not path:
        return ""
    return os.path.abspath(os.path.expanduser(path.strip()))


def kb_roots_for(app_package: str) -> list[str]:
    """Existing KB directories for the matched project (empty if none/missing)."""
    p = match_project(app_package)
    if not p:
        return []
    kb = resolve_path(p.get("kb_path") or "")
    return [kb] if kb and os.path.isdir(kb) else []


def source_root_for(app_package: str) -> str:
    """Existing source root for the matched project ('' if none/missing)."""
    p = match_project(app_package)
    if not p:
        return ""
    src = resolve_path(p.get("source_root") or "")
    return src if src and os.path.isdir(src) else ""


def kb_search_cmd_for(app_package: str) -> str:
    """The matched project's knowledge-search CLI ('' if none)."""
    p = match_project(app_package)
    return (p.get("kb_search_cmd") or "").strip() if p else ""
