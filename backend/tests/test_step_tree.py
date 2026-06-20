"""Unit tests for pure step-tree logic (no DB)."""
from core.step_tree import ChainItem, flatten_chain


def test_flatten_actions_join_into_path():
    chain = [ChainItem("打开B站"), ChainItem("登录"), ChainItem("进入语音页面")]
    tc = flatten_chain(chain)
    assert tc.path == "打开B站 > 登录 > 进入语音页面"
    assert tc.expected == ""        # last node has no expected
    assert tc.steps == []           # no node has an expected -> no checkpoints


def test_flatten_target_expected_is_final_assertion():
    chain = [ChainItem("打开B站"), ChainItem("完成答题", expected="任务完成")]
    tc = flatten_chain(chain)
    assert tc.path == "打开B站 > 完成答题"
    assert tc.expected == "任务完成"


def test_flatten_intermediate_expecteds_become_checkpoints():
    chain = [
        ChainItem("打开B站"),
        ChainItem("点击录音", expected="开始录音"),
        ChainItem("试听"),
    ]
    tc = flatten_chain(chain)
    assert tc.path == "打开B站 > 点击录音 > 试听"
    assert tc.expected == ""                                  # last node: no expected
    assert [(s.action, s.expected) for s in tc.steps] == [("点击录音", "开始录音")]


def test_flatten_empty_chain():
    tc = flatten_chain([])
    assert tc.path == "" and tc.expected == "" and tc.steps == []
