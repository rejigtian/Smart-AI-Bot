"""Unit tests for AgentMemory stuck-detection (state-aware)."""
from agent.memory import AgentMemory, _STUCK_WINDOW


def _step(mem: AgentMemory, index: int, ui_text: str) -> bool:
    """Simulate one loop step: record the screen seen, then the action taken,
    then evaluate is_stuck() the way build_step_text() does."""
    mem.record_state(ui_text)
    stuck = mem.is_stuck()
    mem.record_action(0, "tap_element", {"index": index}, "ok")
    return stuck


def test_repeated_action_changing_screen_is_not_stuck():
    """Quiz case: same tap index every step, but the screen keeps changing."""
    mem = AgentMemory()
    for i in range(6):
        _step(mem, index=9, ui_text=f"question {i}")
    assert mem.is_stuck() is False
    assert mem.recovery_level == 0


def test_repeated_action_frozen_screen_is_stuck():
    """Genuine loop: same action AND same screen across the window."""
    mem = AgentMemory()
    stuck = False
    for _ in range(4):
        stuck = _step(mem, index=9, ui_text="frozen screen")
    assert stuck is True
    assert mem.recovery_level >= 1


def test_varying_actions_not_stuck():
    mem = AgentMemory()
    for i in range(6):
        _step(mem, index=i, ui_text="frozen screen")
    assert mem.is_stuck() is False
    assert mem.recovery_level == 0


def test_recovery_level_decays_when_screen_changes():
    """A loop that starts moving again should de-escalate, not hard-reset."""
    mem = AgentMemory()
    for _ in range(4):
        _step(mem, index=9, ui_text="frozen screen")
    peak = mem.recovery_level
    assert peak >= 1
    # Screen starts changing again -> not stuck, level decays by 1.
    _step(mem, index=9, ui_text="now moving")
    assert mem.is_stuck() is False
    assert mem.recovery_level == max(peak - 1, 0)


def test_below_window_is_not_stuck():
    mem = AgentMemory()
    _step(mem, index=9, ui_text="frozen screen")
    assert mem.is_stuck() is False
    assert mem.recovery_level == 0
