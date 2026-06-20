"""Async tests for the step-tree model + node API."""
import pytest
import pytest_asyncio
from sqlalchemy import select
from db.database import Base
from db.models import StepNode, TestSuite
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


@pytest.mark.asyncio
async def test_stepnode_parent_child(session):
    suite = TestSuite(name="s", source_format="manual")
    session.add(suite)
    await session.flush()
    root = StepNode(suite_id=suite.id, parent_id=None, action="打开B站", order=0)
    session.add(root)
    await session.flush()
    child = StepNode(suite_id=suite.id, parent_id=root.id, action="登录", order=0)
    session.add(child)
    await session.commit()

    rows = (await session.execute(select(StepNode).where(StepNode.suite_id == suite.id))).scalars().all()
    assert len(rows) == 2
    kid = next(r for r in rows if r.parent_id is not None)
    assert kid.parent_id == root.id
    assert kid.reversible is True       # default
    assert kid.loop_task is False       # default
    assert kid.expected == ""           # default


from db.models import TestCase, TestRun, TestResult
from db.migrate_step_tree import migrate_suite_to_step_tree


@pytest.mark.asyncio
async def test_migrate_flat_cases_to_tree(session):
    suite = TestSuite(name="s", source_format="manual")
    session.add(suite); await session.flush()
    c1 = TestCase(suite_id=suite.id, path="登录 > 答题", expected="完成", order=0)
    c2 = TestCase(suite_id=suite.id, path="登录 > 设置", expected="打开", order=1)
    session.add_all([c1, c2]); await session.flush()
    run = TestRun(suite_id=suite.id, device_id="d"); session.add(run); await session.flush()
    res = TestResult(run_id=run.id, case_id=c1.id, status="pass")
    session.add(res); await session.commit()

    created = await migrate_suite_to_step_tree(session, suite.id)
    assert created == 3                      # 登录, 答题, 设置 (登录 shared)
    nodes = (await session.execute(select(StepNode).where(StepNode.suite_id == suite.id))).scalars().all()
    assert len(nodes) == 3
    answer = next(n for n in nodes if n.action == "答题")
    await session.refresh(res)
    assert res.case_id == answer.id          # result repointed to final node

    # Idempotent: running again creates nothing.
    again = await migrate_suite_to_step_tree(session, suite.id)
    assert again == 0
