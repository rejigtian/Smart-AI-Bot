"""
Parse test cases from XMind (.xmind) or Markdown (.md) files.

Output: list of TestCaseData(path, expected, steps)
  path     — full breadcrumb, e.g. "活动主页面 > 入口 > 开关-开"
  expected — the leaf node text (legacy; final/only assertion)
  steps    — optional ordered checkpoints; each Step is (action, expected).
             When present, the runner verifies each step in order and
             fails the case on the first step whose expected is not met.

Markdown arrow syntax for ordered checkpoints:
    - 点击"我的"   => 看到个人主页
    - 点击"设置"   => 看到设置列表
Either `=>` or `→` separates action from expected.  Bullets without an arrow
remain a single legacy leaf case (steps stays empty), preserving existing
behavior for older suites.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Union


# Action / expected separator inside a single bullet.  Both ASCII and the
# Unicode rightward arrow are accepted so non-English files don't need to
# type `=>`.  Order matters: the longer ASCII form first.
_STEP_SEPARATORS = ("=>", "→")


@dataclass
class Step:
    action: str     # "点击 我的"
    expected: str   # "看到个人主页"


@dataclass
class TestCaseData:
    path: str       # "Module > Scenario > Condition"
    expected: str   # leaf node — the legacy single-assertion text
    steps: list[Step] = field(default_factory=list)


def _split_step(text: str) -> Step | None:
    """If `text` contains a step separator, split into Step(action, expected).

    Returns None when no separator is present.  The first occurrence wins so
    expected text may itself contain `=>` (rare, but cheap to allow).
    """
    for sep in _STEP_SEPARATORS:
        if sep in text:
            action, _, expected = text.partition(sep)
            action = action.strip()
            expected = expected.strip()
            if action and expected:
                return Step(action=action, expected=expected)
    return None


# ---------------------------------------------------------------------------
# XMind parser
# ---------------------------------------------------------------------------

def parse_xmind(source: Union[str, Path, bytes]) -> list[TestCaseData]:
    """Extract leaf-node paths from an XMind file (new JSON format)."""
    if isinstance(source, (str, Path)):
        data = Path(source).read_bytes()
    else:
        data = source

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        content = json.loads(zf.read("content.json"))

    cases: list[TestCaseData] = []
    for sheet in content:
        root = sheet.get("rootTopic", {})
        _walk_xmind(root, ancestors=[], cases=cases)
    return cases


def _walk_xmind(node: dict, ancestors: list[str], cases: list[TestCaseData]):
    title = node.get("title", "").strip()
    if not title:
        return

    children = node.get("children", {}).get("attached", [])
    path = ancestors + [title]

    if not children:
        # Leaf node → one test case.  If the leaf itself contains an arrow
        # (`点击X => 看到Y`), treat it as a 1-step checkpoint case so the
        # runner can use the verifier on the explicit expected text.
        leaf_step = _split_step(title)
        case_path = " > ".join(path[:-1]) if len(path) > 1 else path[0]
        if leaf_step is not None:
            cases.append(TestCaseData(
                path=case_path,
                expected=leaf_step.expected,
                steps=[leaf_step],
            ))
        else:
            cases.append(TestCaseData(path=case_path, expected=title))
    else:
        # If ALL children are arrow-style leaves, fold them into ONE
        # multi-checkpoint case under the parent.  Otherwise recurse.
        attached_children = [c for c in children if c.get("title", "").strip()]
        all_arrow_leaves = (
            len(attached_children) >= 2
            and all(
                not c.get("children", {}).get("attached")
                and _split_step(c.get("title", "").strip()) is not None
                for c in attached_children
            )
        )
        if all_arrow_leaves:
            steps = [
                _split_step(c["title"].strip())  # type: ignore[arg-type]
                for c in attached_children
            ]
            case_path = " > ".join(path)
            cases.append(TestCaseData(
                path=case_path,
                expected=steps[-1].expected if steps else "",  # type: ignore[union-attr]
                steps=[s for s in steps if s is not None],
            ))
            return
        for child in children:
            _walk_xmind(child, path, cases)


# ---------------------------------------------------------------------------
# Markdown parser
# ---------------------------------------------------------------------------

def parse_markdown(source: Union[str, Path, bytes]) -> list[TestCaseData]:
    """
    Parse a Markdown file into test cases.

    Headings (#, ##, ###, ...) define the hierarchy.
    List items (-, *) under the current heading are leaf test cases.

    Two forms are supported:

      1. Legacy (single expected per case):

          ## Module
          ### Scenario
          - test condition A
          - test condition B
            - expected result   ← sub-list becomes the expected text

      2. Ordered checkpoints (one case, multiple verified steps):

          ### 用例: 进入个人主页
          - 点击"我的"   => 看到个人主页
          - 点击"设置"   => 看到设置列表
          - 点击"关于"   => 看到版本号

         When two or more sibling bullets under the SAME parent (heading
         or non-arrow bullet) all use the `=>` / `→` separator, they are
         folded into ONE TestCaseData whose `steps` is the ordered list.
         A lone arrow bullet still produces a 1-step case so the verifier
         is used.

    Mixing arrow and non-arrow siblings under the same parent falls back
    to the legacy "one case per leaf" behavior — no silent merging.
    """
    if isinstance(source, (str, Path)):
        if isinstance(source, Path) or (isinstance(source, str) and "\n" not in source):
            text = Path(source).read_text(encoding="utf-8")
        else:
            text = source
    else:
        text = source.decode("utf-8")

    # ── Pass 1: build a tree of (heading_path, bullet_node) ──────────────
    # A bullet_node is {"text": str, "indent": int, "children": [bullet_node]}
    # Headings reset the bullet roots; each heading_path owns a forest.

    @dataclass
    class _Bullet:
        text: str
        indent: int
        children: list = field(default_factory=list)
        heading_path: tuple = ()  # frozen heading stack at the moment of emit

    heading_stack: list[str] = []
    roots: list[_Bullet] = []
    stack: list[_Bullet] = []  # current open bullets, deepest last

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line:
            continue

        if line.startswith("#"):
            stripped = line.lstrip("#")
            level = len(line) - len(stripped)
            title = stripped.strip()
            # Trim to ancestors (positions 0..level-2).  Pad with "" when the
            # author skipped heading levels (e.g. ## then ####), so position
            # `level - 1` always lands on this heading.  Empty slots are
            # filtered out when paths are joined.
            heading_stack = heading_stack[: level - 1]
            while len(heading_stack) < level - 1:
                heading_stack.append("")
            heading_stack.append(title)
            stack.clear()
            continue

        lstripped = line.lstrip()
        indent = len(line) - len(lstripped)
        if not lstripped.startswith(("- ", "* ", "+ ")):
            continue

        item_text = lstripped[2:].strip()
        node = _Bullet(text=item_text, indent=indent, heading_path=tuple(heading_stack))

        while stack and stack[-1].indent >= indent:
            stack.pop()
        if stack:
            stack[-1].children.append(node)
        else:
            roots.append(node)
        stack.append(node)

    # ── Pass 2: walk the forest, emit cases ──────────────────────────────
    cases: list[TestCaseData] = []

    def _join(segments) -> str:
        """Join heading + bullet segments, dropping empty pad slots."""
        return " > ".join(s for s in segments if s)

    def emit_from(parent_path: list[str], bullet: _Bullet) -> None:
        children = bullet.children
        if not children:
            # Real leaf — legacy single-expected case, or 1-step arrow case.
            path_str = _join(parent_path)
            step = _split_step(bullet.text)
            if step is not None:
                cases.append(TestCaseData(
                    path=path_str,
                    expected=step.expected,
                    steps=[step],
                ))
            else:
                cases.append(TestCaseData(path=path_str, expected=bullet.text))
            return

        # Has children — see if ALL children are arrow leaves; if so fold.
        all_arrow_leaves = (
            len(children) >= 2
            and all(not c.children and _split_step(c.text) is not None for c in children)
        )
        if all_arrow_leaves:
            steps = [_split_step(c.text) for c in children]
            steps = [s for s in steps if s is not None]
            path_str = _join(parent_path + [bullet.text])
            cases.append(TestCaseData(
                path=path_str,
                expected=steps[-1].expected if steps else "",
                steps=steps,
            ))
            return

        for child in children:
            emit_from(parent_path + [bullet.text], child)

    # If a heading section's roots are all arrow leaves with the SAME
    # heading_path, fold them into one multi-checkpoint case under the
    # heading.  This is what users naturally write:
    #
    #   ### 进入个人主页
    #   - 点击"我的" => 看到个人主页
    #   - 点击"设置" => 看到设置列表
    #
    # without wrapping in an extra bullet.  Without this fold we'd emit
    # 3 separate 1-step cases which is rarely what they meant.
    i = 0
    while i < len(roots):
        head = roots[i].heading_path
        # Collect contiguous run of roots sharing this heading_path.
        j = i
        while j < len(roots) and roots[j].heading_path == head:
            j += 1
        group = roots[i:j]
        is_group_arrow_block = (
            len(group) >= 2
            and all(
                not r.children and _split_step(r.text) is not None
                for r in group
            )
        )
        if is_group_arrow_block and any(head):
            steps = [_split_step(r.text) for r in group]
            steps = [s for s in steps if s is not None]
            cases.append(TestCaseData(
                path=_join(head),
                expected=steps[-1].expected if steps else "",
                steps=steps,
            ))
        else:
            for r in group:
                emit_from(list(r.heading_path), r)
        i = j

    # Same-as-before de-dup safety net: drop legacy entries whose path is a
    # strict prefix of another emitted case (only matters for fallback
    # mixed-children case where parents would otherwise duplicate leaves).
    leaves: list[TestCaseData] = []
    all_keys = {f"{c.path} > {c.expected}" for c in cases}
    for c in cases:
        if c.steps:
            leaves.append(c)
            continue
        full = f"{c.path} > {c.expected}"
        is_parent = any(p.startswith(full + " >") for p in all_keys)
        if not is_parent:
            leaves.append(c)

    return leaves


# ---------------------------------------------------------------------------
# Unified entry point
# ---------------------------------------------------------------------------

def parse_file(filename: str, content: bytes) -> list[TestCaseData]:
    """Dispatch to the right parser based on file extension."""
    ext = Path(filename).suffix.lower()
    if ext == ".xmind":
        return parse_xmind(content)
    elif ext in (".md", ".markdown"):
        return parse_markdown(content)
    else:
        raise ValueError(f"Unsupported format: {ext}. Use .xmind or .md")
