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
