"""Test suite management — upload XMind/MD files, list suites and cases."""
import json
from dataclasses import asdict
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.step_tree import ChainItem, NodeRow, chain_to_node, clone_chain
from core.test_parser import parse_file
from db.database import AsyncSessionLocal
from db.models import LessonLearned, StepNode, TestCase, TestResult, TestRun, TestStepLog, TestSuite

router = APIRouter(prefix="/api/suites", tags=["suites"])


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


class SuiteOut(BaseModel):
    id: str
    name: str
    source_format: str
    case_count: int
    created_at: str
    app_package: str = ""


class CaseOut(BaseModel):
    id: str
    order: int
    path: str
    expected: str
    parameters: str = ""
    # JSON list of {action, expected}; empty when the case is legacy single-expected.
    checkpoints: str = ""
    loop_task: bool = False  # repetitive task (quiz/bulk) — skips the L4 stuck backstop


class CaseIn(BaseModel):
    path: str
    expected: str = ""
    parameters: str = ""  # JSON array: [{"key": "val"}, ...]
    checkpoints: str = ""  # JSON array: [{"action": "...", "expected": "..."}, ...]
    # repetitive task (quiz/bulk) — skips the L4 stuck backstop. None = leave
    # unchanged on update (callers that send a partial body, e.g. rename, must
    # not silently reset it).
    loop_task: Optional[bool] = None


# ── Step-tree node schemas ─────────────────────────────────────────────────────

class NodeOut(BaseModel):
    id: str
    suite_id: str
    parent_id: Optional[str] = None
    action: str
    expected: str = ""
    order: int = 0
    reversible: bool = True
    loop_task: bool = False
    ref_id: Optional[str] = None   # set on a live-link node
    ref_path: str = ""             # the source's root→node path (for display)


class NodeIn(BaseModel):
    parent_id: Optional[str] = None
    action: str
    expected: str = ""
    loop_task: bool = False


class NodePatch(BaseModel):
    action: Optional[str] = None
    expected: Optional[str] = None
    loop_task: Optional[bool] = None
    reversible: Optional[bool] = None


class MoveIn(BaseModel):
    new_parent_id: Optional[str] = None


class NodeSearchHit(BaseModel):
    node_id: str
    suite_id: str
    suite_name: str
    path: str
    expected: str


class CopyIn(BaseModel):
    source_node_id: str
    parent_id: Optional[str] = None
    link: bool = False   # True = live link (one ref node); False = snapshot copy


@router.get("", response_model=List[SuiteOut])
async def list_suites(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TestSuite).order_by(TestSuite.created_at.desc()))
    suites = result.scalars().all()
    out = []
    for s in suites:
        count_res = await db.execute(
            select(TestCase).where(TestCase.suite_id == s.id)
        )
        count = len(count_res.scalars().all())
        out.append(SuiteOut(
            id=s.id,
            name=s.name,
            source_format=s.source_format,
            case_count=count,
            created_at=s.created_at.isoformat(),
            app_package=s.app_package or "",
        ))
    return out


@router.post("", response_model=SuiteOut, status_code=201)
async def upload_suite(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    filename = file.filename or "upload"
    content = await file.read()

    try:
        cases = parse_file(filename, content)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not cases:
        raise HTTPException(status_code=422, detail="No test cases found in file")

    ext = filename.rsplit(".", 1)[-1].lower()
    fmt = "xmind" if ext == "xmind" else "markdown"

    suite = TestSuite(name=filename, source_format=fmt)
    db.add(suite)
    await db.flush()  # get suite.id

    for i, c in enumerate(cases):
        checkpoints_json = ""
        if c.steps:
            checkpoints_json = json.dumps(
                [asdict(s) for s in c.steps], ensure_ascii=False
            )
        db.add(TestCase(
            suite_id=suite.id,
            path=c.path,
            expected=c.expected,
            order=i,
            checkpoints=checkpoints_json,
        ))

    await db.commit()
    await db.refresh(suite)

    return SuiteOut(
        id=suite.id,
        name=suite.name,
        source_format=suite.source_format,
        case_count=len(cases),
        created_at=suite.created_at.isoformat(),
        app_package=suite.app_package or "",
    )


class SuitePatch(BaseModel):
    app_package: str = ""


@router.patch("/{suite_id}", response_model=SuiteOut)
async def update_suite(suite_id: str, body: SuitePatch, db: AsyncSession = Depends(get_db)):
    """Set the suite's target app package (used to match a Project Profile)."""
    suite = await db.get(TestSuite, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    suite.app_package = (body.app_package or "").strip()
    await db.commit()
    await db.refresh(suite)
    count = len((await db.execute(
        select(TestCase).where(TestCase.suite_id == suite_id)
    )).scalars().all())
    return SuiteOut(
        id=suite.id, name=suite.name, source_format=suite.source_format,
        case_count=count, created_at=suite.created_at.isoformat(),
        app_package=suite.app_package or "",
    )


@router.get("/{suite_id}", response_model=SuiteOut)
async def get_suite(suite_id: str, db: AsyncSession = Depends(get_db)):
    suite = await db.get(TestSuite, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    count_res = await db.execute(
        select(TestCase).where(TestCase.suite_id == suite_id)
    )
    count = len(count_res.scalars().all())
    return SuiteOut(
        id=suite.id,
        name=suite.name,
        source_format=suite.source_format,
        case_count=count,
        created_at=suite.created_at.isoformat(),
        app_package=suite.app_package or "",
    )


@router.get("/{suite_id}/cases", response_model=List[CaseOut])
async def list_cases(suite_id: str, db: AsyncSession = Depends(get_db)):
    suite = await db.get(TestSuite, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    result = await db.execute(
        select(TestCase)
        .where(TestCase.suite_id == suite_id)
        .order_by(TestCase.order)
    )
    cases = result.scalars().all()
    return [
        CaseOut(
            id=c.id, order=c.order, path=c.path, expected=c.expected,
            parameters=c.parameters or "", checkpoints=c.checkpoints or "",
            loop_task=c.loop_task,
        )
        for c in cases
    ]


@router.delete("/{suite_id}", status_code=204)
async def delete_suite(suite_id: str, db: AsyncSession = Depends(get_db)):
    suite = await db.get(TestSuite, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    await db.delete(suite)
    await db.commit()


# ── Test case CRUD ────────────────────────────────────────────────────────────

@router.post("/{suite_id}/cases", response_model=CaseOut, status_code=201)
async def add_case(suite_id: str, body: CaseIn, db: AsyncSession = Depends(get_db)):
    suite = await db.get(TestSuite, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")
    res = await db.execute(
        select(func.max(TestCase.order)).where(TestCase.suite_id == suite_id)
    )
    max_order = res.scalar() or 0
    case = TestCase(
        suite_id=suite_id, path=body.path, expected=body.expected,
        order=max_order + 1, parameters=body.parameters,
        checkpoints=body.checkpoints or "",
        loop_task=bool(body.loop_task),
    )
    db.add(case)
    await db.commit()
    await db.refresh(case)
    return CaseOut(
        id=case.id, order=case.order, path=case.path, expected=case.expected,
        parameters=case.parameters or "", checkpoints=case.checkpoints or "",
        loop_task=case.loop_task,
    )


@router.put("/{suite_id}/cases/{case_id}", response_model=CaseOut)
async def update_case(
    suite_id: str, case_id: str, body: CaseIn, db: AsyncSession = Depends(get_db)
):
    case = await db.get(TestCase, case_id)
    if not case or case.suite_id != suite_id:
        raise HTTPException(status_code=404, detail="Case not found")
    case.path = body.path
    case.expected = body.expected
    case.parameters = body.parameters
    case.checkpoints = body.checkpoints or ""
    if body.loop_task is not None:
        case.loop_task = body.loop_task
    await db.commit()
    return CaseOut(
        id=case.id, order=case.order, path=case.path, expected=case.expected,
        parameters=case.parameters or "", checkpoints=case.checkpoints or "",
        loop_task=case.loop_task,
    )


@router.delete("/{suite_id}/cases/{case_id}", status_code=204)
async def delete_case(suite_id: str, case_id: str, db: AsyncSession = Depends(get_db)):
    case = await db.get(TestCase, case_id)
    if not case or case.suite_id != suite_id:
        raise HTTPException(status_code=404, detail="Case not found")
    await db.delete(case)
    await db.commit()


# ── Step-tree node CRUD ────────────────────────────────────────────────────────

def _node_out(n: StepNode, ref_path: str = "") -> NodeOut:
    return NodeOut(
        id=n.id, suite_id=n.suite_id, parent_id=n.parent_id, action=n.action,
        expected=n.expected or "", order=n.order, reversible=n.reversible,
        loop_task=n.loop_task, ref_id=n.ref_id, ref_path=ref_path,
    )


@router.get("/{suite_id}/nodes", response_model=List[NodeOut])
async def list_nodes(suite_id: str, db: AsyncSession = Depends(get_db)):
    async def _load():
        return (await db.execute(
            select(StepNode).where(StepNode.suite_id == suite_id)
            .order_by(StepNode.order)
        )).scalars().all()

    rows = await _load()
    if not rows:
        # Self-heal: a suite created/imported after startup (the init_db migration
        # only ran over suites that existed then). Migrate its legacy cases now.
        from db.migrate_step_tree import migrate_suite_to_step_tree
        if await migrate_suite_to_step_tree(db, suite_id):
            rows = await _load()
    # For live-link nodes, resolve the source's path (cross-suite) for display.
    ref_paths: dict = {}
    link_targets = [r.ref_id for r in rows if r.ref_id]
    if link_targets:
        all_rows = (await db.execute(select(StepNode))).scalars().all()
        node_rows = [NodeRow(id=a.id, parent_id=a.parent_id, action=a.action,
                             expected=a.expected or "", order=a.order) for a in all_rows]
        for r in rows:
            if r.ref_id:
                chain = chain_to_node(node_rows, r.ref_id)
                ref_paths[r.id] = " > ".join(c.action for c in chain)
    return [_node_out(n, ref_paths.get(n.id, "")) for n in rows]


@router.post("/{suite_id}/nodes", response_model=NodeOut, status_code=201)
async def add_node(suite_id: str, body: NodeIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(func.max(StepNode.order))
        .where(StepNode.suite_id == suite_id, StepNode.parent_id == body.parent_id)
    )
    max_order = res.scalar()
    node = StepNode(
        suite_id=suite_id, parent_id=body.parent_id, action=body.action,
        expected=body.expected or "", loop_task=body.loop_task,
        order=(max_order + 1) if max_order is not None else 0,
    )
    db.add(node)
    await db.commit()
    await db.refresh(node)
    return _node_out(node)


@router.put("/{suite_id}/nodes/{node_id}", response_model=NodeOut)
async def update_node(suite_id: str, node_id: str, body: NodePatch,
                      db: AsyncSession = Depends(get_db)):
    node = await db.get(StepNode, node_id)
    if not node or node.suite_id != suite_id:
        raise HTTPException(status_code=404, detail="Node not found")
    if body.action is not None:
        node.action = body.action
    if body.expected is not None:
        node.expected = body.expected
    if body.loop_task is not None:
        node.loop_task = body.loop_task
    if body.reversible is not None:
        node.reversible = body.reversible
    await db.commit()
    return _node_out(node)


async def _descendant_ids(db: AsyncSession, node_id: str) -> set:
    """All descendants of node_id (exclusive) — for cycle guard on move."""
    out, frontier = set(), [node_id]
    while frontier:
        kids = (await db.execute(
            select(StepNode.id).where(StepNode.parent_id.in_(frontier))
        )).scalars().all()
        kids = [k for k in kids if k not in out]
        out.update(kids)
        frontier = kids
    return out


@router.post("/{suite_id}/nodes/{node_id}/move", response_model=NodeOut)
async def move_node(suite_id: str, node_id: str, body: MoveIn,
                    db: AsyncSession = Depends(get_db)):
    node = await db.get(StepNode, node_id)
    if not node or node.suite_id != suite_id:
        raise HTTPException(status_code=404, detail="Node not found")
    if body.new_parent_id == node_id or body.new_parent_id in await _descendant_ids(db, node_id):
        raise HTTPException(status_code=400, detail="Cannot move a node under itself")
    res = await db.execute(
        select(func.max(StepNode.order))
        .where(StepNode.suite_id == suite_id, StepNode.parent_id == body.new_parent_id)
    )
    max_order = res.scalar()
    node.parent_id = body.new_parent_id
    node.order = (max_order + 1) if max_order is not None else 0
    await db.commit()
    return _node_out(node)


@router.delete("/{suite_id}/nodes/{node_id}", status_code=204)
async def delete_node(suite_id: str, node_id: str, db: AsyncSession = Depends(get_db)):
    node = await db.get(StepNode, node_id)
    if not node or node.suite_id != suite_id:
        raise HTTPException(status_code=404, detail="Node not found")
    # Promote children to the deleted node's parent.
    await db.execute(
        update(StepNode).where(StepNode.parent_id == node_id)
        .values(parent_id=node.parent_id)
    )
    await db.delete(node)
    await db.commit()


@router.post("/{suite_id}/nodes/copy", response_model=List[NodeOut])
async def copy_nodes(suite_id: str, body: CopyIn, db: AsyncSession = Depends(get_db)):
    """Reuse a source flow under parent_id. link=False -> snapshot copy of the
    source's root→node chain (new ids, source_id provenance). link=True -> one
    live-link node (ref_id=source) that resolves to that chain at run time."""
    src = await db.get(StepNode, body.source_node_id)
    if not src:
        raise HTTPException(status_code=404, detail="Source node not found")
    res = await db.execute(
        select(func.max(StepNode.order))
        .where(StepNode.suite_id == suite_id, StepNode.parent_id == body.parent_id)
    )
    base_order = (res.scalar() or -1) + 1

    if body.link:
        node = StepNode(suite_id=suite_id, parent_id=body.parent_id,
                        action="🔗 链接", order=base_order, ref_id=body.source_node_id)
        db.add(node); await db.commit(); await db.refresh(node)
        all_rows = (await db.execute(select(StepNode))).scalars().all()
        node_rows = [NodeRow(id=a.id, parent_id=a.parent_id, action=a.action,
                             expected=a.expected or "", order=a.order) for a in all_rows]
        ref_path = " > ".join(c.action for c in chain_to_node(node_rows, body.source_node_id))
        return [_node_out(node, ref_path)]

    src_rows = (await db.execute(
        select(StepNode).where(StepNode.suite_id == src.suite_id)
    )).scalars().all()
    node_rows = [NodeRow(id=r.id, parent_id=r.parent_id, action=r.action,
                         expected=r.expected or "", order=r.order) for r in src_rows]
    chain = chain_to_node(node_rows, body.source_node_id)
    head = clone_chain([ChainItem(c.action, c.expected) for c in chain])
    if head is None:
        raise HTTPException(status_code=400, detail="Source chain is empty")
    created: list = []

    async def _persist(bn, parent_id, order, src_id=None):
        row = StepNode(suite_id=suite_id, parent_id=parent_id, action=bn.action,
                       expected=bn.expected, order=order, source_id=src_id)
        db.add(row); await db.flush()
        created.append(row)
        for i, ch in enumerate(bn.children):
            await _persist(ch, row.id, i)

    # Stamp provenance on the copy's leaf (the reused target).
    await _persist(head, body.parent_id, base_order, src_id=body.source_node_id)
    await db.commit()
    return [_node_out(n) for n in created]


# ── Cross-suite node search (case library) ─────────────────────────────────────

nodes_router = APIRouter(prefix="/api/nodes", tags=["nodes"])


@nodes_router.get("/search", response_model=List[NodeSearchHit])
async def search_nodes(q: str, limit: int = 20, db: AsyncSession = Depends(get_db)):
    """Search every suite's step-tree for nodes whose root→node path or expected
    contains `q` (case-insensitive substring)."""
    ql = q.strip().lower()
    if not ql:
        return []
    rows = (await db.execute(select(StepNode))).scalars().all()
    suites = {s.id: s.name for s in (await db.execute(select(TestSuite))).scalars().all()}
    by_suite: dict = {}
    for r in rows:
        by_suite.setdefault(r.suite_id, []).append(
            NodeRow(id=r.id, parent_id=r.parent_id, action=r.action,
                    expected=r.expected or "", order=r.order)
        )
    hits: list = []
    for r in rows:
        chain = chain_to_node(by_suite[r.suite_id], r.id)
        path = " > ".join(c.action for c in chain)
        if ql in (path + " " + (r.expected or "")).lower():
            hits.append(NodeSearchHit(
                node_id=r.id, suite_id=r.suite_id,
                suite_name=suites.get(r.suite_id, ""), path=path, expected=r.expected or "",
            ))
        if len(hits) >= limit:
            break
    return hits


# ── Trends ───────────────────────────────────────────────────────────────────

class TrendPoint(BaseModel):
    run_id: str
    created_at: str
    provider: str
    model: str
    passed: int
    failed: int
    errored: int
    total: int
    pass_rate: float  # 0.0 - 100.0


@router.get("/{suite_id}/trends", response_model=List[TrendPoint])
async def get_trends(suite_id: str, limit: int = 20, db: AsyncSession = Depends(get_db)):
    """Return pass rate trend for the last N runs of a suite."""
    suite = await db.get(TestSuite, suite_id)
    if not suite:
        raise HTTPException(status_code=404, detail="Suite not found")

    runs_res = await db.execute(
        select(TestRun)
        .where(TestRun.suite_id == suite_id, TestRun.status == "done")
        .order_by(TestRun.created_at.desc())
        .limit(limit)
    )
    runs = list(reversed(runs_res.scalars().all()))  # oldest first for chart

    points = []
    for run in runs:
        res = await db.execute(
            select(TestResult).where(TestResult.run_id == run.id)
        )
        results = res.scalars().all()
        counts = {"pass": 0, "fail": 0, "error": 0}
        for r in results:
            if r.status in counts:
                counts[r.status] += 1
        total = len(results)
        points.append(TrendPoint(
            run_id=run.id,
            created_at=run.created_at.isoformat(),
            provider=run.provider,
            model=run.model,
            passed=counts["pass"],
            failed=counts["fail"],
            errored=counts["error"],
            total=total,
            pass_rate=round(counts["pass"] / total * 100, 1) if total > 0 else 0.0,
        ))

    return points


# ── Per-case run history (memory hygiene) ─────────────────────────────────────
# A case's reference example (starred / last-pass action history) and its
# lessons learned all derive from TestResult rows. Listing and pruning those
# rows lets the user curate what the agent "remembers" for the next run.

class CaseResultOut(BaseModel):
    id: str            # result id
    run_id: str
    status: str        # pass / fail / error / skip
    reason: str
    steps: int
    total_tokens: int
    is_starred: bool
    provider: str
    model: str
    created_at: str    # the run's start time
    finished_at: Optional[str] = None


async def _require_case(suite_id: str, case_id: str, db: AsyncSession) -> TestCase:
    case = await db.get(TestCase, case_id)
    if not case or case.suite_id != suite_id:
        raise HTTPException(status_code=404, detail="Case not found")
    return case


@router.get("/{suite_id}/cases/{case_id}/results", response_model=List[CaseResultOut])
async def list_case_results(suite_id: str, case_id: str, db: AsyncSession = Depends(get_db)):
    """All run records for one case, newest first — the raw material of memory."""
    await _require_case(suite_id, case_id, db)
    rows = await db.execute(
        select(TestResult, TestRun)
        .join(TestRun, TestResult.run_id == TestRun.id)
        .where(TestResult.case_id == case_id)
        .order_by(TestRun.created_at.desc())
    )
    out: List[CaseResultOut] = []
    for result, run in rows.all():
        out.append(CaseResultOut(
            id=result.id,
            run_id=result.run_id,
            status=result.status,
            reason=result.reason,
            steps=result.steps,
            total_tokens=result.total_tokens,
            is_starred=result.is_starred,
            provider=run.provider,
            model=run.model,
            created_at=run.created_at.isoformat(),
            finished_at=result.finished_at.isoformat() if result.finished_at else None,
        ))
    return out


async def _purge_results(results: List[TestResult], db: AsyncSession) -> int:
    """Delete results + their step logs (cascade) + lessons distilled from them.

    Lessons are matched by (case_id, source_run_id) so the agent stops being
    primed by experience the user just discarded.
    """
    for r in results:
        await db.execute(
            delete(LessonLearned).where(
                LessonLearned.case_id == r.case_id,
                LessonLearned.source_run_id == r.run_id,
            )
        )
        await db.execute(delete(TestStepLog).where(TestStepLog.result_id == r.id))
        await db.execute(delete(TestResult).where(TestResult.id == r.id))
    await db.commit()
    return len(results)


@router.delete("/{suite_id}/cases/{case_id}/results/{result_id}", status_code=204)
async def delete_case_result(
    suite_id: str, case_id: str, result_id: str, db: AsyncSession = Depends(get_db)
):
    """Delete a single run record for a case (and the memory derived from it)."""
    await _require_case(suite_id, case_id, db)
    result = await db.get(TestResult, result_id)
    if not result or result.case_id != case_id:
        raise HTTPException(status_code=404, detail="Result not found")
    await _purge_results([result], db)


class PurgeOut(BaseModel):
    deleted: int


@router.delete("/{suite_id}/cases/{case_id}/results", response_model=PurgeOut)
async def delete_case_results(
    suite_id: str, case_id: str, scope: str = "all", db: AsyncSession = Depends(get_db)
):
    """Bulk-delete a case's run records. scope=all clears everything; scope=failed
    keeps only passing/skipped records (drops fail + error)."""
    await _require_case(suite_id, case_id, db)
    if scope not in ("all", "failed"):
        raise HTTPException(status_code=400, detail="scope must be 'all' or 'failed'")
    stmt = select(TestResult).where(TestResult.case_id == case_id)
    if scope == "failed":
        stmt = stmt.where(TestResult.status.in_(["fail", "error"]))
    rows = (await db.execute(stmt)).scalars().all()
    n = await _purge_results(list(rows), db)
    return PurgeOut(deleted=n)


# ── Per-node run history (same TestResult table, keyed by node id) ─────────────
# Defined here (end of file) so CaseResultOut / PurgeOut / _purge_results exist.

async def _require_node(node_id: str, db: AsyncSession) -> StepNode:
    node = await db.get(StepNode, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return node


@nodes_router.get("/{node_id}/results", response_model=List[CaseResultOut])
async def list_node_results(node_id: str, db: AsyncSession = Depends(get_db)):
    """All run records for one step-tree node, newest first."""
    await _require_node(node_id, db)
    rows = await db.execute(
        select(TestResult, TestRun)
        .join(TestRun, TestResult.run_id == TestRun.id)
        .where(TestResult.case_id == node_id)
        .order_by(TestRun.created_at.desc())
    )
    out: List[CaseResultOut] = []
    for result, run in rows.all():
        out.append(CaseResultOut(
            id=result.id, run_id=result.run_id, status=result.status, reason=result.reason,
            steps=result.steps, total_tokens=result.total_tokens, is_starred=result.is_starred,
            provider=run.provider, model=run.model, created_at=run.created_at.isoformat(),
            finished_at=result.finished_at.isoformat() if result.finished_at else None,
        ))
    return out


@nodes_router.delete("/{node_id}/results/{result_id}", status_code=204)
async def delete_node_result(node_id: str, result_id: str, db: AsyncSession = Depends(get_db)):
    await _require_node(node_id, db)
    result = await db.get(TestResult, result_id)
    if not result or result.case_id != node_id:
        raise HTTPException(status_code=404, detail="Result not found")
    await _purge_results([result], db)


@nodes_router.delete("/{node_id}/results", response_model=PurgeOut)
async def delete_node_results(node_id: str, scope: str = "all", db: AsyncSession = Depends(get_db)):
    await _require_node(node_id, db)
    if scope not in ("all", "failed"):
        raise HTTPException(status_code=400, detail="scope must be 'all' or 'failed'")
    stmt = select(TestResult).where(TestResult.case_id == node_id)
    if scope == "failed":
        stmt = stmt.where(TestResult.status.in_(["fail", "error"]))
    rows = (await db.execute(stmt)).scalars().all()
    return PurgeOut(deleted=await _purge_results(list(rows), db))


# ── Reuse stats (case library) ────────────────────────────────────────────────

class NodeUsageRef(BaseModel):
    node_id: str
    suite_id: str
    suite_name: str
    path: str
    kind: str   # "link" | "copy"


@nodes_router.get("/usage")
async def nodes_usage(db: AsyncSession = Depends(get_db)):
    """Map node_id -> {links, copies}: how many nodes reference it (live link)
    or were snapshot-copied from it. The de-facto reusable components."""
    rows = (await db.execute(select(StepNode.ref_id, StepNode.source_id))).all()
    counts: dict = {}
    for ref_id, source_id in rows:
        if ref_id:
            counts.setdefault(ref_id, {"links": 0, "copies": 0})["links"] += 1
        if source_id:
            counts.setdefault(source_id, {"links": 0, "copies": 0})["copies"] += 1
    return counts


class NodeListItem(BaseModel):
    node_id: str
    suite_id: str
    suite_name: str
    action: str
    expected: str
    path: str
    reuse_count: int
    child_count: int
    is_link: bool


class NodeListPage(BaseModel):
    total: int
    items: List[NodeListItem]


@nodes_router.get("/all", response_model=NodeListPage)
async def list_all_nodes(q: str = "", suite_id: str = "", include_derived: bool = False,
                         offset: int = 0, limit: int = 50, db: AsyncSession = Depends(get_db)):
    """Flat, searchable, paginated list of step nodes (the library catalog).
    Sorted most-reused first. q matches the node's path or expected; suite_id filters.
    By default DERIVED nodes (snapshot copies / live-link placeholders) are hidden so a
    reused flow isn't listed twice — set include_derived=true to show them."""
    rows = (await db.execute(select(StepNode))).scalars().all()
    suites = {s.id: s.name for s in (await db.execute(select(TestSuite))).scalars().all()}
    reuse: dict = {}
    child: dict = {}
    by_suite: dict = {}
    for r in rows:
        if r.ref_id:
            reuse[r.ref_id] = reuse.get(r.ref_id, 0) + 1
        if r.source_id:
            reuse[r.source_id] = reuse.get(r.source_id, 0) + 1
        if r.parent_id:
            child[r.parent_id] = child.get(r.parent_id, 0) + 1
        by_suite.setdefault(r.suite_id, []).append(
            NodeRow(id=r.id, parent_id=r.parent_id, action=r.action,
                    expected=r.expected or "", order=r.order))
    ql = q.strip().lower()
    items: list = []
    for r in rows:
        if suite_id and r.suite_id != suite_id:
            continue
        if not include_derived and (r.ref_id or r.source_id):
            continue  # hide snapshot copies / link placeholders by default
        path = " > ".join(c.action for c in chain_to_node(by_suite[r.suite_id], r.id))
        if ql and ql not in (path + " " + (r.expected or "")).lower():
            continue
        items.append(NodeListItem(
            node_id=r.id, suite_id=r.suite_id, suite_name=suites.get(r.suite_id, ""),
            action=r.action, expected=r.expected or "", path=path,
            reuse_count=reuse.get(r.id, 0), child_count=child.get(r.id, 0),
            is_link=bool(r.ref_id),
        ))
    items.sort(key=lambda x: (-x.reuse_count, x.path))
    return NodeListPage(total=len(items), items=items[offset:offset + limit])


class NodeBrief(BaseModel):
    node_id: str
    action: str
    expected: str


class NodeContextOut(BaseModel):
    node_id: str
    suite_id: str
    suite_name: str
    path: str
    parent: Optional[NodeBrief] = None
    children: List[NodeBrief]
    referrers: List[NodeUsageRef]   # who reuses THIS node (incoming)
    reuses: Optional[NodeUsageRef] = None  # what THIS node reuses (outgoing source)


@nodes_router.get("/{node_id}/context", response_model=NodeContextOut)
async def node_context(node_id: str, db: AsyncSession = Depends(get_db)):
    """A selected node's neighbourhood: its parent, its children, and every node
    that reuses it (live link / snapshot copy)."""
    node = await _require_node(node_id, db)
    all_rows = (await db.execute(select(StepNode))).scalars().all()
    by_id = {a.id: a for a in all_rows}
    node_rows = [NodeRow(id=a.id, parent_id=a.parent_id, action=a.action,
                         expected=a.expected or "", order=a.order) for a in all_rows]
    suites = {s.id: s.name for s in (await db.execute(select(TestSuite))).scalars().all()}
    path = " > ".join(c.action for c in chain_to_node(node_rows, node_id))
    parent = by_id.get(node.parent_id)
    children = [NodeBrief(node_id=a.id, action=a.action, expected=a.expected or "")
                for a in all_rows if a.parent_id == node_id]
    referrers = [
        NodeUsageRef(
            node_id=a.id, suite_id=a.suite_id, suite_name=suites.get(a.suite_id, ""),
            path=" > ".join(c.action for c in chain_to_node(node_rows, a.id)),
            kind="link" if a.ref_id == node_id else "copy",
        )
        for a in all_rows if a.ref_id == node_id or a.source_id == node_id
    ]
    # What THIS node reuses (its own outgoing source): live link (ref_id) or copy (source_id).
    reuses = None
    src_id = node.ref_id or node.source_id
    if src_id and src_id in by_id:
        s = by_id[src_id]
        reuses = NodeUsageRef(
            node_id=s.id, suite_id=s.suite_id, suite_name=suites.get(s.suite_id, ""),
            path=" > ".join(c.action for c in chain_to_node(node_rows, s.id)),
            kind="link" if node.ref_id else "copy",
        )
    return NodeContextOut(
        node_id=node.id, suite_id=node.suite_id, suite_name=suites.get(node.suite_id, ""),
        path=path,
        parent=NodeBrief(node_id=parent.id, action=parent.action, expected=parent.expected or "") if parent else None,
        children=children, referrers=referrers, reuses=reuses,
    )


@nodes_router.get("/{node_id}/usage", response_model=List[NodeUsageRef])
async def node_usage(node_id: str, db: AsyncSession = Depends(get_db)):
    """Where a node is reused: nodes that live-link to it or were copied from it."""
    refs = (await db.execute(
        select(StepNode).where(or_(StepNode.ref_id == node_id, StepNode.source_id == node_id))
    )).scalars().all()
    if not refs:
        return []
    all_rows = (await db.execute(select(StepNode))).scalars().all()
    node_rows = [NodeRow(id=a.id, parent_id=a.parent_id, action=a.action,
                         expected=a.expected or "", order=a.order) for a in all_rows]
    suites = {s.id: s.name for s in (await db.execute(select(TestSuite))).scalars().all()}
    out: List[NodeUsageRef] = []
    for r in refs:
        path = " > ".join(c.action for c in chain_to_node(node_rows, r.id))
        out.append(NodeUsageRef(
            node_id=r.id, suite_id=r.suite_id, suite_name=suites.get(r.suite_id, ""),
            path=path, kind="link" if r.ref_id == node_id else "copy",
        ))
    return out
