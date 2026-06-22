"""
Test Knowledge Base Search — query the local test_knowledge/ md files.

Returns relevant feature context for Planner/Agent based on task description.
Reads aliases from test_knowledge/config.yml — project-agnostic.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────

KB_ROOT = Path(__file__).resolve().parent.parent.parent / "test_knowledge"
FEATURES_DIR = KB_ROOT / "features"
INDEX_MD = KB_ROOT / "INDEX.md"
CONFIG_FILE = KB_ROOT / "config.yml"


# ── Keyword index (lazy-loaded) ───────────────────────────────────────────

_INDEX_CACHE: Optional[list[dict]] = None
_ALIASES_CACHE: Optional[dict[str, list[str]]] = None

# Cap for the fallback (whole-doc) injection used for KBs that don't follow our
# section format — keeps a long external doc from flooding the agent's context.
_MAX_FALLBACK_CHARS = 2000


def _load_aliases() -> dict[str, list[str]]:
    """Load runtime_aliases from config.yml — empty dict if not available."""
    global _ALIASES_CACHE
    if _ALIASES_CACHE is not None:
        return _ALIASES_CACHE
    _ALIASES_CACHE = {}
    if not CONFIG_FILE.exists():
        return _ALIASES_CACHE
    try:
        import yaml
        raw = yaml.safe_load(CONFIG_FILE.read_text(encoding="utf-8"))
        _ALIASES_CACHE = (raw or {}).get("runtime_aliases") or {}
    except ImportError:
        logger.warning("PyYAML not installed — skipping KB aliases")
    except Exception as exc:
        logger.warning("Failed to load KB aliases: %s", exc)
    return _ALIASES_CACHE


def _index_dir(root: Path, source: str = "local") -> list[dict]:
    """Index every *.md under a directory into KB entries (no caching).

    `source` labels where the entry came from ("local" test_knowledge vs an
    imported "project" KB) so callers can show it."""
    entries: list[dict] = []
    if not root.exists():
        return entries
    aliases = _load_aliases()
    for md_path in root.rglob("*.md"):
        try:
            content = md_path.read_text(encoding="utf-8")
        except Exception:
            continue

        slug = md_path.stem
        module = md_path.parent.name
        # First heading as title
        title_m = re.search(r"^#\s+(.+?)$", content, re.MULTILINE)
        title = title_m.group(1).strip() if title_m else slug

        # Build keyword set: slug, module, title words, plus aliases
        kws: set[str] = set()
        kws.add(slug.lower())
        kws.add(module.lower())
        for w in re.findall(r"[\w一-鿿]+", title):
            if len(w) >= 2:
                kws.add(w.lower())
        for primary, alts in aliases.items():
            if primary.lower() in slug.lower() or primary in title:
                kws.update(a.lower() for a in alts)
            if any(alt.lower() in slug.lower() or alt in title for alt in alts):
                kws.add(primary.lower())
                kws.update(a.lower() for a in alts)

        entries.append({
            "slug": slug, "module": module, "path": md_path,
            "title": title, "keywords": kws, "content": content,
            "source": source,
        })
    return entries


def _load_index() -> list[dict]:
    """Cached index of the local test_knowledge/features/*.md."""
    global _INDEX_CACHE
    if _INDEX_CACHE is None:
        _INDEX_CACHE = _index_dir(FEATURES_DIR)
        logger.info("Loaded %d features into Test KB index", len(_INDEX_CACHE))
    return _INDEX_CACHE


def _score_match(query: str, entry: dict) -> int:
    """Score how well an entry matches the query."""
    query_lower = query.lower()
    # Extract query tokens
    query_tokens = set()
    for w in re.findall(r"[\w一-鿿]+", query_lower):
        if len(w) >= 2:
            query_tokens.add(w)

    score = 0
    # Exact keyword match is strong signal
    for kw in entry["keywords"]:
        if kw in query_lower:
            score += 10
        if kw in query_tokens:
            score += 5

    # Title word match is also strong
    title_lower = entry["title"].lower()
    for token in query_tokens:
        if token in title_lower:
            score += 8

    # Content match is weaker
    content_lower = entry["content"].lower()
    for token in query_tokens:
        if token in content_lower:
            score += 1

    return score


def search_feature(query: str, top_k: int = 1, extra_roots: Optional[list[str]] = None,
                   matches_out: Optional[list] = None) -> str:
    """Search the test KB for relevant feature(s) and return markdown content.

    Args:
        query: task description (e.g. "open settings page and check version")
        top_k: how many top features to return
        extra_roots: additional KB directories to search (e.g. an imported
            Project Profile's kb_path). Scanned fresh; missing dirs are ignored.

    Returns:
        Concatenated markdown content of top-k features, or empty string.
    """
    entries = list(_load_index())
    for root in (extra_roots or []):
        try:
            entries.extend(_index_dir(Path(root), source="project"))
        except Exception:
            continue
    if not entries:
        return ""

    scored = [(_score_match(query, e), e) for e in entries]
    scored.sort(key=lambda x: -x[0])

    # Only return matches with meaningful score
    top = [(s, e) for s, e in scored[:top_k] if s >= 10]
    if not top:
        return ""

    parts = []
    for score, entry in top:
        logger.info("Test KB match: %s/%s [%s] (score=%d)",
                    entry["module"], entry["slug"], entry.get("source", "local"), score)
        if matches_out is not None:
            matches_out.append({
                "title": entry["title"], "slug": entry["slug"],
                "source": entry.get("source", "local"), "score": score,
            })
        # Extract only the most useful sections for the agent
        extracted = _extract_agent_relevant(entry["content"])
        parts.append(f"# Test KB: {entry['title']}\n\n{extracted}")

    return "\n\n---\n\n".join(parts)


def _extract_agent_relevant(content: str) -> str:
    """Extract the most useful parts for agent execution.

    Keep: 入口路径, 关键元素, 典型测试步骤, 已知坑点
    Drop: 相关源码, 业务子系统, meta block
    """
    keep_sections = ["业务简介", "入口路径", "关键元素", "典型测试步骤", "已知坑点", "期望结果类型"]
    drop_sections = ["相关源码", "业务子系统"]

    # Split by top-level markdown ## headings
    sections = re.split(r"\n##\s+", content)
    # First part is before any ## (title + meta)
    result_parts = []

    for sec in sections[1:]:  # skip pre-##
        first_line = sec.split("\n", 1)[0].strip()
        # Clean section name (drop trailing ---)
        section_name = first_line.split("(")[0].strip().rstrip()

        if any(drop in section_name for drop in drop_sections):
            continue
        if any(keep in section_name for keep in keep_sections):
            # Strip HTML comment markers so the agent doesn't see them
            cleaned = re.sub(r"<!--\s*(AUTO|END AUTO|HUMAN|END HUMAN)[^>]*-->", "", sec)
            cleaned = re.sub(r"\n---+\n", "\n", cleaned)
            cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
            result_parts.append(f"## {cleaned}")

    if result_parts:
        return "\n\n".join(result_parts)

    # Fallback: docs that don't use our section names (e.g. an imported project's
    # own KB) would otherwise contribute only their title. Inject the body as-is,
    # minus the meta/comment noise, capped so a long doc can't flood the context.
    body = re.sub(r"^#\s+.+?$", "", content, count=1, flags=re.MULTILINE)  # drop H1
    body = re.sub(r"<!--.*?-->", "", body, flags=re.DOTALL)
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return body[:_MAX_FALLBACK_CHARS]


def reload_index():
    """Force-reload the index (for testing or after KB updates)."""
    global _INDEX_CACHE, _ALIASES_CACHE
    _INDEX_CACHE = None
    _ALIASES_CACHE = None
    _load_index()
