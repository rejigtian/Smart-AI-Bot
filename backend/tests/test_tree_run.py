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
