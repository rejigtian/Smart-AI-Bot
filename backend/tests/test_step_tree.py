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


from core.step_tree import LegacyCase, build_tree_from_cases


def _find(nodes, action):
    for n in nodes:
        if n.action == action:
            return n
    raise AssertionError(f"no node {action!r} in {[n.action for n in nodes]}")


def test_build_tree_merges_shared_prefix():
    cases = [
        LegacyCase(path="登录 > 我的页面 > 答题", expected="完成", checkpoints=[],
                   loop_task=False, case_id="c1"),
        LegacyCase(path="登录 > 我的页面 > 设置", expected="打开设置", checkpoints=[],
                   loop_task=False, case_id="c2"),
    ]
    roots = build_tree_from_cases(cases)
    login = _find(roots, "登录")                 # single shared root
    mine = _find(login.children, "我的页面")       # single shared node
    assert {c.action for c in mine.children} == {"答题", "设置"}
    answer = _find(mine.children, "答题")
    assert answer.expected == "完成" and answer.source_case_id == "c1"


def test_build_tree_appends_checkpoints_under_leaf():
    cases = [
        LegacyCase(path="登录 > 语音", expected="完成", loop_task=True, case_id="c3",
                   checkpoints=[("点击录音", "开始录音"), ("试听", "可播放")]),
    ]
    roots = build_tree_from_cases(cases)
    voice = _find(_find(roots, "登录").children, "语音")
    rec = _find(voice.children, "点击录音")
    assert rec.expected == "开始录音"
    listen = _find(rec.children, "试听")
    assert listen.expected == "可播放"
    # case identity + loop_task land on the final node (the run target)
    assert listen.source_case_id == "c3" and listen.loop_task is True
    assert voice.source_case_id is None


from core.step_tree import NodeRow, RunTarget, dfs_run_targets


def test_dfs_targets_leaf_order_and_chains():
    # 登录 ─ 我的页面 ─┬ 答题
    #                  └ 设置
    nodes = [
        NodeRow("n1", None, "登录", order=0),
        NodeRow("n2", "n1", "我的页面", order=0),
        NodeRow("n3", "n2", "答题", expected="完成", order=0),
        NodeRow("n4", "n2", "设置", order=1),
    ]
    targets = dfs_run_targets(nodes)
    assert [t.node_id for t in targets] == ["n3", "n4"]           # leaves only, DFS order
    assert [c.action for c in targets[0].chain] == ["登录", "我的页面", "答题"]
    assert targets[0].chain[-1].expected == "完成"
    assert [c.action for c in targets[1].chain] == ["登录", "我的页面", "设置"]


def test_dfs_targets_respects_sibling_order_and_multiple_roots():
    nodes = [
        NodeRow("b", None, "B", order=1),
        NodeRow("a", None, "A", order=0),
        NodeRow("a1", "a", "A1", order=0),
    ]
    targets = dfs_run_targets(nodes)
    assert [t.node_id for t in targets] == ["a1", "b"]            # root A (order 0) before B


def test_dfs_targets_empty():
    assert dfs_run_targets([]) == []


from core.step_tree import chain_to_node


def test_chain_to_node_walks_up_to_root():
    nodes = [
        NodeRow("n1", None, "登录", order=0),
        NodeRow("n2", "n1", "我的页面", order=0),
        NodeRow("n3", "n2", "答题", expected="完成", order=0),
        NodeRow("n4", "n2", "设置", order=1),
    ]
    chain = chain_to_node(nodes, "n2")          # an intermediate (non-leaf) node
    assert [c.action for c in chain] == ["登录", "我的页面"]
    assert chain[-1].expected == ""

    full = chain_to_node(nodes, "n3")
    assert [c.action for c in full] == ["登录", "我的页面", "答题"]
    assert full[-1].expected == "完成"


def test_chain_to_node_unknown_id():
    assert chain_to_node([NodeRow("n1", None, "A")], "missing") == []
