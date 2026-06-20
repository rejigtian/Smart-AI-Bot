"""Test suite management — upload XMind/MD files, list suites and cases."""
import json
from dataclasses import asdict
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.test_parser import parse_file
from db.database import AsyncSessionLocal
from db.models import LessonLearned, TestCase, TestResult, TestRun, TestStepLog, TestSuite

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
    loop_task: bool = False  # repetitive task (quiz/bulk) — skips the L4 stuck backstop


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
        loop_task=body.loop_task,
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
