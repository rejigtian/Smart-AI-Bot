"""Pure step-tree logic — no DB, no web framework. Unit-testable in isolation.

A test case is a root→node path through a suite's step-tree. `flatten_chain`
turns that path into the runner's existing TestCaseData so the agent/verifier
need no changes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from core.test_parser import Step, TestCaseData


@dataclass
class ChainItem:
    """One node on a root→target path: an action with an optional expected."""
    action: str
    expected: str = ""
    node_id: str = ""


def flatten_chain(chain: List[ChainItem]) -> TestCaseData:
    """Flatten a root→target node chain into a TestCaseData.

    - path     = every node's action joined with " > " (the goal/nav sequence)
    - expected = the target (last) node's expected ("" = success-is-done)
    - steps    = one Step per node that HAS an expected (ordered checkpoints);
                 action-only nodes appear in path but are not checkpoints.
    """
    if not chain:
        return TestCaseData(path="", expected="", steps=[])
    path = " > ".join(item.action for item in chain)
    expected = chain[-1].expected
    steps = [Step(action=i.action, expected=i.expected) for i in chain if i.expected]
    return TestCaseData(path=path, expected=expected, steps=steps)


@dataclass
class LegacyCase:
    """A legacy flat TestCase to migrate."""
    path: str
    expected: str
    case_id: str
    loop_task: bool = False
    checkpoints: List[tuple] = field(default_factory=list)  # list[(action, expected)]


@dataclass
class BuiltNode:
    action: str
    expected: str = ""
    loop_task: bool = False
    order: int = 0
    source_case_id: str | None = None   # set on the final (run-target) node only
    children: List["BuiltNode"] = field(default_factory=list)


def _split_path(path: str) -> List[str]:
    return [seg.strip() for seg in (path or "").split(">") if seg.strip()]


def build_tree_from_cases(cases: List[LegacyCase]) -> List[BuiltNode]:
    """Materialize legacy flat cases into a step-tree (list of root BuiltNodes).

    Cases sharing a leading path prefix merge into the same nodes. Each case's
    checkpoints become a deeper chain under its leaf path-node; the final node
    carries that case's expected, loop_task, and source_case_id.
    """
    roots: List[BuiltNode] = []

    def _child(siblings: List[BuiltNode], action: str) -> BuiltNode:
        for n in siblings:
            if n.action == action:
                return n
        node = BuiltNode(action=action, order=len(siblings))
        siblings.append(node)
        return node

    for c in cases:
        segs = _split_path(c.path)
        # Walk/extend the shared path prefix.
        siblings = roots
        node: BuiltNode | None = None
        for seg in segs:
            node = _child(siblings, seg)
            siblings = node.children
        # Append checkpoints as a deeper chain under the leaf path-node.
        for action, expected in c.checkpoints:
            nxt = _child(siblings, action)
            nxt.expected = expected
            node = nxt
            siblings = node.children
        # The final node is the run target: stamp case identity + final expected.
        if node is not None:
            if not node.expected:
                node.expected = c.expected
            node.loop_task = c.loop_task
            node.source_case_id = c.case_id
    return roots


@dataclass
class NodeRow:
    """A flat StepNode row (id, parent_id, action, expected, order, reversible).

    ref_id  — set on a live-link node (resolves to ref_id's node + subtree).
    linked  — set on the EXPANDED nodes produced by resolve_links (read-only).
    """
    id: str
    parent_id: str | None
    action: str
    expected: str = ""
    order: int = 0
    reversible: bool = True
    ref_id: str = ""
    linked: bool = False


@dataclass
class RunTarget:
    node_id: str
    chain: List[ChainItem]   # root→target, in order


def dfs_run_targets(nodes: List[NodeRow]) -> List[RunTarget]:
    """Depth-first over the step-tree; one RunTarget per leaf (root→leaf chain).

    Siblings ordered by `order`. Leaves sharing a prefix come out adjacent, so a
    caller can share the common prefix via back-navigation between them.
    """
    children: dict = {}
    for n in nodes:
        children.setdefault(n.parent_id, []).append(n)
    for sibs in children.values():
        sibs.sort(key=lambda x: x.order)

    targets: List[RunTarget] = []

    def walk(node: NodeRow, prefix: List[ChainItem]) -> None:
        chain = prefix + [ChainItem(node.action, node.expected, node_id=node.id)]
        kids = children.get(node.id, [])
        if not kids:
            targets.append(RunTarget(node_id=node.id, chain=chain))
            return
        for c in kids:
            walk(c, chain)

    for root in children.get(None, []):
        walk(root, [])
    return targets


def resolve_links(suite_nodes: List[NodeRow], all_by_id: dict) -> List[NodeRow]:
    """Expand live-link nodes into the referenced node's root→node PREFIX chain.

    A link node (ref_id set) reuses the *flow that leads to* ref_id — the same
    thing a snapshot copy reuses, but live. It is replaced by the linear chain
    root→ref_id (source ids kept, marked linked=True). The chain's first node is
    reparented under the link's parent; the link's own children re-attach to the
    chain's LAST node (the source). Dangling ref → a single placeholder node.
    Non-link nodes pass through. One level only (no nested-link recursion in v1).
    """
    all_nodes = list(all_by_id.values())
    out: List[NodeRow] = []
    remap: dict = {}  # link id -> node its children should hang under (chain end)
    for n in suite_nodes:
        if not n.ref_id:
            out.append(n)
            continue
        if n.ref_id not in all_by_id:
            out.append(NodeRow(id=n.id, parent_id=n.parent_id, action="（链接已失效）",
                               order=n.order, linked=True))
            remap[n.id] = n.id
            continue
        prev = n.parent_id
        last = n.id
        for ci in chain_to_node(all_nodes, n.ref_id):  # root→source ChainItems
            srcrow = all_by_id.get(ci.node_id)
            out.append(NodeRow(id=ci.node_id, parent_id=prev, action=ci.action,
                               expected=ci.expected, order=n.order,
                               reversible=srcrow.reversible if srcrow else True, linked=True))
            prev = ci.node_id
            last = ci.node_id
        remap[n.id] = last
    if not remap:
        return out
    # Re-attach children that pointed at a (now-expanded) link node.
    fixed: List[NodeRow] = []
    for n in out:
        pid = remap.get(n.parent_id, n.parent_id) if n.parent_id else n.parent_id
        if pid == n.parent_id:
            fixed.append(n)
        else:
            fixed.append(NodeRow(n.id, pid, n.action, n.expected, n.order,
                                 n.reversible, n.ref_id, n.linked))
    return fixed


def chain_to_node(nodes: List[NodeRow], node_id: str) -> List[ChainItem]:
    """Build the root→node ChainItem list for a single (possibly non-leaf) node.

    Returns [] if node_id is unknown. Walks parent pointers up to the root.
    """
    by_id = {n.id: n for n in nodes}
    if node_id not in by_id:
        return []
    rev: List[ChainItem] = []
    cur: NodeRow | None = by_id[node_id]
    seen: set = set()
    while cur is not None and cur.id not in seen:
        seen.add(cur.id)
        rev.append(ChainItem(cur.action, cur.expected, node_id=cur.id))
        cur = by_id.get(cur.parent_id) if cur.parent_id else None
    return list(reversed(rev))


@dataclass
class BacktrackPlan:
    """How to get the device from the previous target to the next one.

    kind='fresh'  — first target; just run its chain from the app's start.
    kind='back'   — back-navigate to `to_node_id` (the LCA), then descend.
    kind='replay' — an irreversible step lies between; restart from the app's
                    start and replay the next target's full chain (to_node_id=None).
    """
    kind: str
    to_node_id: str | None = None


def _ancestors(by_id: dict, node_id: str) -> List[str]:
    """node_id, its parent, … up to the root (inclusive)."""
    out: List[str] = []
    cur: str | None = node_id
    seen: set = set()
    while cur is not None and cur not in seen and cur in by_id:
        seen.add(cur)
        out.append(cur)
        cur = by_id[cur].parent_id
    return out


def backtrack_plan(nodes: List[NodeRow], prev_id: str | None, next_id: str) -> BacktrackPlan:
    """Decide how to move from `prev_id`'s leaf to `next_id`.

    Conservative ("handle it well"): if any node on prev's path up to the
    lowest common ancestor is irreversible, back-navigation cannot restore a
    clean state, so we replay from the start rather than risk a dirty state.
    """
    if prev_id is None:
        return BacktrackPlan(kind="fresh")
    by_id = {n.id: n for n in nodes}
    anc_next = set(_ancestors(by_id, next_id))
    # Walk up from prev; first ancestor also above next is the LCA. Any
    # irreversible node crossed before reaching it forces a replay.
    cur: str | None = prev_id
    while cur is not None and cur in by_id:
        if cur in anc_next:
            return BacktrackPlan(kind="back", to_node_id=cur)
        if not by_id[cur].reversible:
            return BacktrackPlan(kind="replay", to_node_id=None)
        cur = by_id[cur].parent_id
    return BacktrackPlan(kind="replay", to_node_id=None)


def clone_chain(items: List[ChainItem]) -> "BuiltNode | None":
    """Build a fresh linear BuiltNode line from a chain (for snapshot reuse).

    Each item becomes one node nested under the previous; expected is carried,
    loop_task/source_case_id are not (a reused flow is a fresh case).
    """
    head: "BuiltNode | None" = None
    tail: "BuiltNode | None" = None
    for it in items:
        node = BuiltNode(action=it.action, expected=it.expected)
        if head is None:
            head = tail = node
        else:
            tail.children.append(node)
            tail = node
    return head
