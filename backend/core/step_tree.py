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
    """A flat StepNode row (id, parent_id, action, expected, order)."""
    id: str
    parent_id: str | None
    action: str
    expected: str = ""
    order: int = 0


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
        chain = prefix + [ChainItem(node.action, node.expected)]
        kids = children.get(node.id, [])
        if not kids:
            targets.append(RunTarget(node_id=node.id, chain=chain))
            return
        for c in kids:
            walk(c, chain)

    for root in children.get(None, []):
        walk(root, [])
    return targets
