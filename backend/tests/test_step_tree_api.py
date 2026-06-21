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


import httpx
from httpx import ASGITransport
from main import app
from routers.testsuites import get_db


@pytest_asyncio.fixture
async def client(session):
    async def _override():
        yield session
    app.dependency_overrides[get_db] = _override
    transport = ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
        yield c
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def suite_id(session):
    suite = TestSuite(name="s", source_format="manual")
    session.add(suite); await session.commit()
    return suite.id


@pytest.mark.asyncio
async def test_node_create_edit_delete_promote(client, suite_id):
    root = (await client.post(f"/api/suites/{suite_id}/nodes",
            json={"parent_id": None, "action": "登录"})).json()
    mid = (await client.post(f"/api/suites/{suite_id}/nodes",
            json={"parent_id": root["id"], "action": "我的页面"})).json()
    leaf = (await client.post(f"/api/suites/{suite_id}/nodes",
            json={"parent_id": mid["id"], "action": "答题", "expected": "完成"})).json()
    assert leaf["expected"] == "完成"

    # partial edit: only loop_task; action/expected unchanged
    patched = (await client.put(f"/api/suites/{suite_id}/nodes/{leaf['id']}",
               json={"loop_task": True})).json()
    assert patched["loop_task"] is True and patched["action"] == "答题"

    # delete the middle node -> its child (答题) promotes to root
    assert (await client.delete(f"/api/suites/{suite_id}/nodes/{mid['id']}")).status_code == 204
    nodes = (await client.get(f"/api/suites/{suite_id}/nodes")).json()
    answer = next(n for n in nodes if n["action"] == "答题")
    assert answer["parent_id"] == root["id"]
    assert all(n["id"] != mid["id"] for n in nodes)


@pytest.mark.asyncio
async def test_node_move_and_cycle_guard(client, suite_id):
    a = (await client.post(f"/api/suites/{suite_id}/nodes", json={"parent_id": None, "action": "A"})).json()
    b = (await client.post(f"/api/suites/{suite_id}/nodes", json={"parent_id": a["id"], "action": "B"})).json()
    c = (await client.post(f"/api/suites/{suite_id}/nodes", json={"parent_id": None, "action": "C"})).json()

    moved = (await client.post(f"/api/suites/{suite_id}/nodes/{c['id']}/move",
             json={"new_parent_id": b["id"]})).json()
    assert moved["parent_id"] == b["id"]

    # cycle: moving A under its own descendant C must 400
    bad = await client.post(f"/api/suites/{suite_id}/nodes/{a['id']}/move",
                            json={"new_parent_id": c["id"]})
    assert bad.status_code == 400


@pytest.mark.asyncio
async def test_list_nodes_self_heals_unmigrated_suite(client, session):
    # A suite with legacy cases but no StepNode rows (e.g. created after startup).
    suite = TestSuite(name="late", source_format="manual"); session.add(suite); await session.flush()
    session.add(TestCase(suite_id=suite.id, path="登录 > 答题", expected="完成", order=0))
    await session.commit()

    nodes = (await client.get(f"/api/suites/{suite.id}/nodes")).json()
    assert {n["action"] for n in nodes} == {"登录", "答题"}   # migrated on demand


@pytest.mark.asyncio
async def test_node_results_history(client, session):
    suite = TestSuite(name="s", source_format="manual"); session.add(suite); await session.flush()
    node = StepNode(suite_id=suite.id, parent_id=None, action="登录", order=0); session.add(node); await session.flush()
    run = TestRun(suite_id=suite.id, device_id="d", provider="p", model="m"); session.add(run); await session.flush()
    r = TestResult(run_id=run.id, case_id=node.id, status="pass", steps=3, total_tokens=42)
    session.add(r); await session.commit()

    results = (await client.get(f"/api/nodes/{node.id}/results")).json()
    assert len(results) == 1 and results[0]["status"] == "pass" and results[0]["steps"] == 3

    # purge clears them
    out = (await client.delete(f"/api/nodes/{node.id}/results", params={"scope": "all"})).json()
    assert out["deleted"] == 1
    assert (await client.get(f"/api/nodes/{node.id}/results")).json() == []


@pytest.mark.asyncio
async def test_node_search_across_suites(client, session):
    s1 = TestSuite(name="A", source_format="manual"); s2 = TestSuite(name="B", source_format="manual")
    session.add_all([s1, s2]); await session.flush()
    n1 = StepNode(suite_id=s1.id, parent_id=None, action="登录", order=0); session.add(n1); await session.flush()
    n2 = StepNode(suite_id=s1.id, parent_id=n1.id, action="进入语音页面", order=0); session.add(n2)
    other = StepNode(suite_id=s2.id, parent_id=None, action="设置", order=0); session.add(other)
    await session.commit()

    hits = (await client.get("/api/nodes/search", params={"q": "语音"})).json()
    assert any(h["node_id"] == n2.id and h["path"] == "登录 > 进入语音页面" for h in hits)
    assert all(h["node_id"] != other.id for h in hits)


@pytest.mark.asyncio
async def test_copy_chain_into_suite(client, session):
    src = TestSuite(name="src", source_format="manual"); dst = TestSuite(name="dst", source_format="manual")
    session.add_all([src, dst]); await session.flush()
    a = StepNode(suite_id=src.id, parent_id=None, action="登录", order=0); session.add(a); await session.flush()
    b = StepNode(suite_id=src.id, parent_id=a.id, action="语音", expected="进入语音页", order=0); session.add(b)
    root = StepNode(suite_id=dst.id, parent_id=None, action="首页", order=0); session.add(root)
    await session.commit()

    created = (await client.post(f"/api/suites/{dst.id}/nodes/copy",
               json={"source_node_id": b.id, "parent_id": root.id})).json()
    assert [c["action"] for c in created] == ["登录", "语音"]
    # persisted under dst, linked beneath root, fresh ids
    nodes = (await client.get(f"/api/suites/{dst.id}/nodes")).json()
    login = next(n for n in nodes if n["action"] == "登录")
    assert login["parent_id"] == root.id and login["suite_id"] == dst.id
    voice = next(n for n in nodes if n["action"] == "语音")
    assert voice["expected"] == "进入语音页" and voice["parent_id"] == login["id"]
