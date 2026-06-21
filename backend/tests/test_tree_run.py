"""Unit test for tree-run target assembly (no device)."""
import pytest, pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from db.database import Base
from db.models import StepNode, TestSuite
from core.test_runner import node_targets_for_suite


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as s:
        yield s
    await engine.dispose()


@pytest.mark.asyncio
async def test_node_targets_for_suite(session):
    suite = TestSuite(name="s", source_format="manual"); session.add(suite); await session.flush()
    n1 = StepNode(suite_id=suite.id, parent_id=None, action="登录", order=0); session.add(n1); await session.flush()
    n2 = StepNode(suite_id=suite.id, parent_id=n1.id, action="答题", expected="完成", order=0); session.add(n2)
    await session.commit()
    targets = await node_targets_for_suite(session, suite.id)
    assert len(targets) == 1
    assert targets[0].node_id == n2.id
    assert [c.action for c in targets[0].chain] == ["登录", "答题"]


@pytest.mark.asyncio
async def test_node_targets_single_node(session):
    suite = TestSuite(name="s", source_format="manual"); session.add(suite); await session.flush()
    n1 = StepNode(suite_id=suite.id, parent_id=None, action="登录", order=0); session.add(n1); await session.flush()
    n2 = StepNode(suite_id=suite.id, parent_id=n1.id, action="我的页面", order=0); session.add(n2); await session.flush()
    n3 = StepNode(suite_id=suite.id, parent_id=n2.id, action="答题", expected="完成", order=0); session.add(n3)
    await session.commit()

    # Run a single intermediate node -> just its root→node chain.
    targets = await node_targets_for_suite(session, suite.id, only_node_id=n2.id)
    assert len(targets) == 1
    assert targets[0].node_id == n2.id
    assert [c.action for c in targets[0].chain] == ["登录", "我的页面"]

    # Unknown node -> no targets.
    assert await node_targets_for_suite(session, suite.id, only_node_id="missing") == []


@pytest.mark.asyncio
async def test_tree_run_resolves_live_link(session):
    # Source suite: 登录 → 进入语音页
    src = TestSuite(name="src", source_format="manual"); session.add(src); await session.flush()
    s1 = StepNode(suite_id=src.id, parent_id=None, action="登录", order=0); session.add(s1); await session.flush()
    s2 = StepNode(suite_id=src.id, parent_id=s1.id, action="进入语音页", order=0); session.add(s2); await session.flush()
    # Target suite: a live link to s2, then the user's own step 点击录音
    dst = TestSuite(name="dst", source_format="manual"); session.add(dst); await session.flush()
    lk = StepNode(suite_id=dst.id, parent_id=None, action="🔗", order=0, ref_id=s2.id); session.add(lk); await session.flush()
    own = StepNode(suite_id=dst.id, parent_id=lk.id, action="点击录音", expected="开始录音", order=0)
    session.add(own); await session.commit()

    targets = await node_targets_for_suite(session, dst.id)
    assert len(targets) == 1
    # The reused login→voice prefix is expanded ahead of the user's own step.
    assert [c.action for c in targets[0].chain] == ["登录", "进入语音页", "点击录音"]
    assert targets[0].node_id == own.id            # leaf result attaches to the user's own node
