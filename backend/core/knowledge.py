"""
Self knowledge base — conversational notes the user dictates about the app
under test, organized by an LLM into structured entries and stored as readable
markdown under ``test_knowledge/notes/``.

This is project-agnostic plumbing: the *feature* (dictate → organize → store →
query) ships to OSS, but the notes themselves live under ``test_knowledge/``
(excluded from the OSS sync), so each user's content stays private.

Notes are a queryable reference library — they are NOT auto-injected into the
agent at test time (unlike ``test_knowledge/features/``).
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from agent.llm import ModelTarget, resilient_completion
from core.i18n import current_language, lang_directive

logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────
NOTES_DIR = Path(__file__).resolve().parent.parent.parent / "test_knowledge" / "notes"
_SETTINGS = Path(__file__).resolve().parent.parent / "data" / "settings.json"

# A note file embeds its full metadata as JSON inside an HTML comment so the
# markdown stays human-readable while parsing stays dependency-free (no YAML).
_META_RE = re.compile(r"<!--\s*smartbot-note\s*(\{.*?\})\s*-->", re.DOTALL)


# ── Model resolution (reuse the configured default provider) ───────────────

def _resolve_model() -> tuple[str, str, str, str]:
    """(provider, model, api_key, api_base) from settings.json defaults."""
    try:
        data = json.loads(_SETTINGS.read_text())
    except Exception:
        return ("openai", "gpt-4o", "", "")
    provider = (data.get("default_provider") or "openai").lower()
    model = data.get("default_model") or "gpt-4o"
    key_map = {
        "openai": "openai_api_key", "anthropic": "anthropic_api_key",
        "google": "gemini_api_key", "gemini": "gemini_api_key",
        "zhipuai": "zhipu_api_key", "zhipu": "zhipu_api_key",
        "groq": "groq_api_key", "ollama": "",
    }
    api_key = data.get(key_map.get(provider, f"{provider}_api_key"), "")
    base_map = {
        "anthropic": data.get("anthropic_base_url", ""),
        "ollama": data.get("ollama_base_url", "http://localhost:11434"),
    }
    if provider == "bedrock":
        _apply_aws_env(data)  # litellm/boto3 read AWS creds from the environment
    return (provider, model, api_key, base_map.get(provider, ""))


def _apply_aws_env(data: dict) -> None:
    """Export AWS Bedrock creds from settings into the process env so the
    'bedrock' provider authenticates (mirrors the test-runner's behavior)."""
    ak, sk = data.get("aws_access_key_id", ""), data.get("aws_secret_access_key", "")
    region = data.get("aws_region_name", "") or "us-east-1"
    if ak and sk:
        os.environ["AWS_ACCESS_KEY_ID"] = ak
        os.environ["AWS_SECRET_ACCESS_KEY"] = sk
        os.environ["AWS_REGION_NAME"] = region
        os.environ["AWS_DEFAULT_REGION"] = region
        os.environ["AWS_REGION"] = region


# ── Storage ────────────────────────────────────────────────────────────────

def _slug(text: str) -> str:
    """A short filesystem-safe slug from a title (keeps CJK)."""
    s = re.sub(r"[^\w一-鿿]+", "-", text.strip()).strip("-")
    return (s[:32] or "note").lower()


def _note_path(note: dict) -> Path:
    return NOTES_DIR / f"{note['created_at'][:10]}-{_slug(note['title'])}-{note['id'][:6]}.md"


def _write_note(note: dict) -> None:
    NOTES_DIR.mkdir(parents=True, exist_ok=True)
    meta = json.dumps(note, ensure_ascii=False)
    kws = " · ".join(note.get("keywords") or [])
    aliases = " · ".join(note.get("aliases") or [])
    lines = [
        f"<!-- smartbot-note {meta} -->",
        "",
        f"# {note['title']}",
        "",
        note.get("body", "").strip(),
        "",
        "---",
        f"> 关键词 / keywords: {kws}" if kws else "",
        f"> 别名 / aliases: {aliases}" if aliases else "",
        f"> 原始输入 / raw: {note.get('raw_input', '')}",
        f"> 录入 / created: {note['created_at']}",
        "",
    ]
    _note_path(note).write_text("\n".join(l for l in lines if l is not None), encoding="utf-8")


def _parse_note(path: Path) -> Optional[dict]:
    try:
        m = _META_RE.search(path.read_text(encoding="utf-8"))
        if not m:
            return None
        note = json.loads(m.group(1))
        note["_file"] = str(path)
        return note
    except Exception as exc:
        logger.warning("Skipping unparseable note %s: %s", path.name, exc)
        return None


def list_notes() -> list[dict]:
    """All notes, newest first."""
    if not NOTES_DIR.exists():
        return []
    notes = [n for p in NOTES_DIR.glob("*.md") if (n := _parse_note(p))]
    notes.sort(key=lambda n: n.get("created_at", ""), reverse=True)
    return notes


def search_notes(query: str) -> list[dict]:
    """Keyword filter over title / body / keywords / aliases / raw input."""
    q = (query or "").strip().lower()
    if not q:
        return list_notes()
    tokens = [t for t in re.findall(r"[\w一-鿿]+", q) if t]
    out = []
    for n in list_notes():
        hay = " ".join([
            n.get("title", ""), n.get("body", ""), n.get("raw_input", ""),
            " ".join(n.get("keywords") or []), " ".join(n.get("aliases") or []),
        ]).lower()
        if all(t in hay for t in tokens):
            out.append(n)
    return out


def get_note(note_id: str) -> Optional[dict]:
    return next((n for n in list_notes() if n["id"] == note_id), None)


def delete_note(note_id: str) -> bool:
    n = get_note(note_id)
    if not n:
        return False
    try:
        Path(n["_file"]).unlink(missing_ok=True)
        return True
    except Exception:
        return False


def update_note(note_id: str, fields: dict) -> Optional[dict]:
    """Edit a note's structured fields (title/body/keywords/aliases)."""
    n = get_note(note_id)
    if not n:
        return None
    old_path = Path(n["_file"])
    for k in ("title", "body", "keywords", "aliases"):
        if k in fields and fields[k] is not None:
            n[k] = fields[k]
    n["updated_at"] = datetime.now().isoformat(timespec="seconds")
    n.pop("_file", None)
    old_path.unlink(missing_ok=True)  # title may change → path changes; rewrite fresh
    _write_note(n)
    return _parse_note(_note_path(n))


# ── LLM organize ────────────────────────────────────────────────────────────

_ORGANIZE_PROMPT = (
    "You organize a tester's free-form note about an app under test into a "
    "structured knowledge entry. The note may be jargon/slang ('X means Y'), a "
    "feature explanation, a navigation path, or a known pitfall.\n"
    "Return ONLY a JSON object with these fields:\n"
    '  "title":   a short title (<= 20 chars)\n'
    '  "body":    a clear, tidy explanation in markdown (keep it faithful to the input; do NOT invent facts)\n'
    '  "keywords": string[] — search terms, INCLUDING any proper nouns / slang / formal names mentioned\n'
    '  "aliases":  string[] — equivalent names or ways to refer to the same thing\n'
    "Do not wrap the JSON in prose or code fences.\n"
    'IMPORTANT: inside any string value do NOT use the double-quote character ("); '
    "if you need to quote a term use 「」 or '' instead, so the JSON stays valid."
)


def _parse_structured(content: str, raw_input: str) -> dict:
    """Parse the model's JSON, tolerating the common failure where a string
    value contains unescaped double-quotes. Strict parse first (best: body is
    cleaned too); on failure, salvage title/keywords/aliases by regex and fall
    back to the raw text for body so nothing is lost or truncated."""
    content = re.sub(r"^```[a-z]*\n?", "", content.strip()).rstrip("` \n")
    m = re.search(r"\{.*\}", content, re.DOTALL)
    blob = m.group() if m else content

    title = body = None
    keywords = aliases = None
    try:
        data = json.loads(blob)
        if isinstance(data, dict):
            title, body = data.get("title"), data.get("body")
            keywords, aliases = data.get("keywords"), data.get("aliases")
    except (ValueError, TypeError):
        def _arr(name: str) -> list:
            mm = re.search(rf'"{name}"\s*:\s*\[(.*?)\]', blob, re.DOTALL)
            return re.findall(r'"([^"\n]+)"', mm.group(1)) if mm else []
        tm = re.search(r'"title"\s*:\s*"([^"\n]+)"', blob)
        title = tm.group(1) if tm else None
        keywords, aliases = _arr("keywords"), _arr("aliases")
        # body is unreliable to salvage (unescaped quotes truncate it) → use raw

    return {
        "title": (title or raw_input.strip()[:20] or "未命名").strip()[:40],
        "body": (body or raw_input).strip(),
        "keywords": [str(k).strip() for k in (keywords or []) if str(k).strip()],
        "aliases": [str(a).strip() for a in (aliases or []) if str(a).strip()],
    }


async def organize(raw_input: str) -> dict:
    """Turn a free-form note into a structured entry via the default model.

    Always returns a usable dict; on any failure it falls back to storing the
    raw text verbatim so the user never loses input."""
    provider, model, api_key, api_base = _resolve_model()
    fallback = {
        "title": raw_input.strip()[:20] or "未命名",
        "body": raw_input.strip(),
        "keywords": [],
        "aliases": [],
    }
    try:
        response = await resilient_completion(
            primary=ModelTarget(provider, model, api_key, api_base),
            base_kwargs={
                "messages": [
                    {"role": "system", "content": _ORGANIZE_PROMPT + lang_directive(current_language())},
                    {"role": "user", "content": raw_input.strip()},
                ],
                "temperature": 0.2,
                "max_tokens": 600,
            },
            timeout=30.0,
        )
        content = (response.choices[0].message.content or "").strip()
        return _parse_structured(content, raw_input)
    except Exception as exc:
        logger.warning("Knowledge organize failed (%s) — storing raw", exc)
        return fallback


async def add_note(raw_input: str) -> dict:
    """Organize the input and persist it. Returns the stored note."""
    structured = await organize(raw_input)
    now = datetime.now().isoformat(timespec="seconds")
    note = {
        "id": uuid.uuid4().hex,
        "title": structured["title"],
        "body": structured["body"],
        "keywords": structured["keywords"],
        "aliases": structured["aliases"],
        "raw_input": raw_input.strip(),
        "created_at": now,
        "updated_at": now,
    }
    _write_note(note)
    logger.info("Knowledge note added: %s", note["title"])
    return _parse_note(_note_path(note))
