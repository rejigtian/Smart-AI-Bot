"""Test run management — trigger runs, stream logs via SSE, fetch results."""
import asyncio
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from core.report import generate_html_report
from core.run_recorder import has_recording, recording_path
from core.test_runner import active_runs, cancel_run, run_log_stream, start_run, start_batch_run
from db.database import AsyncSessionLocal
from db.models import LessonLearned, TestCase, TestResult, TestRun, TestStepLog, TestSuite
from ws.portal_ws import connected_devices

router = APIRouter(prefix="/api/runs", tags=["runs"])


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


# ── Request / Response models ────────────────────────────────────────────────

class StartRunRequest(BaseModel):
    suite_id: str
    device_id: str
    provider: str = "openai"
    model: str = "gpt-4o"
    max_steps: int = 20
    step_delay: float = 1.0
    max_retries: int = 0
    # Default: run the suite as one tree-aware session (shared navigation runs
    # once). Set true to run each case cold + isolated (max isolation, slower).
    isolated: bool = False


class StartBatchRunRequest(BaseModel):
    suite_id: str
    device_id: str
    provider: str = "openai"
    model: str = "gpt-4o"
    max_steps: int = 20
    base_path: str = ""          # the shared navigation prefix to enter once
    case_ids: List[str]          # the leaf cases to verify in one session


class QuickRunRequest(BaseModel):
    goal: str
    expected: str = "任务完成"
    device_id: str
    provider: str = "openai"
    model: str = "gpt-4o"
    max_steps: int = 20
    step_delay: float = 1.0
    max_retries: int = 0


class RunOut(BaseModel):
    id: str
    suite_id: str
    suite_name: Optional[str] = None
    device_id: str
    status: str
    provider: str
    model: str
    created_at: str
    finished_at: Optional[str] = None
    passed: int = 0
    failed: int = 0
    errored: int = 0
    skipped: int = 0
    total: int = 0
    total_tokens: int = 0
    has_recording: bool = False


class ResultOut(BaseModel):
    id: str
    case_id: str
    path: str
    expected: str
    status: str
    reason: str
    steps: int
    screenshot_b64: str
    log: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    is_starred: bool = False
    total_tokens: int = 0


class StepOut(BaseModel):
    id: str
    step: int
    thought: str
    action: str
    action_result: str
    screenshot_b64: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    perception_ms: int = 0
    llm_ms: int = 0
    action_ms: int = 0
    subgoal_index: Optional[int] = None
    subgoal_desc: str = ""


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _run_out(run: TestRun, db: AsyncSession) -> RunOut:
    res = await db.execute(select(TestResult).where(TestResult.run_id == run.id))
    results = res.scalars().all()
    counts = {"pass": 0, "fail": 0, "error": 0, "skip": 0, "pending": 0, "running": 0}
    total_tokens = 0
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1
        total_tokens += r.total_tokens or 0
    suite = await db.get(TestSuite, run.suite_id)
    return RunOut(
        id=run.id,
        suite_id=run.suite_id,
        suite_name=suite.name if suite else None,
        device_id=run.device_id,
        status=run.status,
        provider=run.provider,
        model=run.model,
        created_at=run.created_at.isoformat(),
        finished_at=run.finished_at.isoformat() if run.finished_at else None,
        passed=counts.get("pass", 0),
        failed=counts.get("fail", 0),
        errored=counts.get("error", 0),
        skipped=counts.get("skip", 0),
        total=len(results),
        total_tokens=total_tokens,
        has_recording=has_recording(run.id),
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("", response_model=RunOut, status_code=201)
async def create_run(req: StartRunRequest, db: AsyncSession = Depends(get_db)):
    # Validate device is connected
    conn = connected_devices.get(req.device_id)
    if conn is None or not conn.is_connected:
        raise HTTPException(status_code=400, detail=f"Device {req.device_id} is not connected")

    # Validate suite exists and has cases
    cases_res = await db.execute(
        select(TestCase)
        .where(TestCase.suite_id == req.suite_id)
        .order_by(TestCase.order)
    )
    cases = cases_res.scalars().all()
    if not cases:
        raise HTTPException(status_code=404, detail="Suite not found or has no test cases")

    # Create run row
    run = TestRun(
        suite_id=req.suite_id,
        device_id=req.device_id,
        provider=req.provider,
        model=req.model,
        status="pending",
    )
    db.add(run)
    await db.flush()

    # Pre-create result rows
    for case in cases:
        db.add(TestResult(run_id=run.id, case_id=case.id, status="pending"))

    await db.commit()
    await db.refresh(run)

    # Launch background task. Default = tree-aware single session (cases already
    # ordered by TestCase.order, i.e. xmind depth-first order, so siblings are
    # adjacent → minimal re-navigation). isolated = legacy cold-run-each.
    if req.isolated:
        await start_run(run.id, max_steps=req.max_steps, step_delay=req.step_delay, max_retries=req.max_retries)
    else:
        await start_batch_run(run.id, base_path="", case_ids=[c.id for c in cases], max_steps=req.max_steps)

    return await _run_out(run, db)


@router.post("/batch", response_model=RunOut, status_code=201)
async def create_batch_run(req: StartBatchRunRequest, db: AsyncSession = Depends(get_db)):
    """Run a subset of cases (a tree folder's leaves) as ONE session — navigate to
    the shared base path once, then verify each leaf, with per-leaf results."""
    conn = connected_devices.get(req.device_id)
    if conn is None or not conn.is_connected:
        raise HTTPException(status_code=400, detail=f"Device {req.device_id} is not connected")
    if not req.case_ids:
        raise HTTPException(status_code=400, detail="No cases selected")

    cases_res = await db.execute(
        select(TestCase).where(TestCase.id.in_(req.case_ids), TestCase.suite_id == req.suite_id)
    )
    cases = {c.id: c for c in cases_res.scalars().all()}
    ordered_ids = [cid for cid in req.case_ids if cid in cases]
    if not ordered_ids:
        raise HTTPException(status_code=404, detail="None of the selected cases were found")

    run = TestRun(
        suite_id=req.suite_id, device_id=req.device_id,
        provider=req.provider, model=req.model, status="pending",
    )
    db.add(run)
    await db.flush()
    for cid in ordered_ids:
        db.add(TestResult(run_id=run.id, case_id=cid, status="pending"))
    await db.commit()
    await db.refresh(run)

    await start_batch_run(run.id, base_path=req.base_path, case_ids=ordered_ids, max_steps=req.max_steps)
    return await _run_out(run, db)


@router.get("", response_model=List[RunOut])
async def list_runs(
    suite_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    q = select(TestRun).order_by(TestRun.created_at.desc())
    if suite_id:
        q = q.where(TestRun.suite_id == suite_id)
    res = await db.execute(q)
    runs = res.scalars().all()
    return [await _run_out(r, db) for r in runs]


@router.post("/quick", response_model=RunOut, status_code=201)
async def quick_run(req: QuickRunRequest, db: AsyncSession = Depends(get_db)):
    """Create a single-case temporary suite and start a run immediately."""
    conn = connected_devices.get(req.device_id)
    if conn is None or not conn.is_connected:
        raise HTTPException(status_code=400, detail=f"Device {req.device_id} is not connected")

    suite = TestSuite(name=f"快速任务: {req.goal[:60]}", source_format="manual")
    db.add(suite)
    await db.flush()

    case = TestCase(suite_id=suite.id, path=req.goal, expected=req.expected, order=0)
    db.add(case)
    await db.flush()

    run = TestRun(
        suite_id=suite.id,
        device_id=req.device_id,
        provider=req.provider,
        model=req.model,
        status="pending",
    )
    db.add(run)
    await db.flush()

    db.add(TestResult(run_id=run.id, case_id=case.id, status="pending"))
    await db.commit()
    await db.refresh(run)

    await start_run(run.id, max_steps=req.max_steps, step_delay=req.step_delay, max_retries=req.max_retries)
    return await _run_out(run, db)


@router.post("/tree", response_model=RunOut, status_code=201)
async def create_tree_run(req: StartRunRequest, db: AsyncSession = Depends(get_db)):
    """Run a suite's step-tree as a DFS over its leaf cases."""
    conn = connected_devices.get(req.device_id)
    if conn is None or not conn.is_connected:
        raise HTTPException(status_code=400, detail=f"Device {req.device_id} is not connected")
    from core.test_runner import node_targets_for_suite, start_tree_run
    targets = await node_targets_for_suite(db, req.suite_id)
    if not targets:
        raise HTTPException(status_code=404, detail="Suite has no step-tree nodes")
    run = TestRun(suite_id=req.suite_id, device_id=req.device_id,
                  provider=req.provider, model=req.model, status="pending")
    db.add(run); await db.flush()
    for t in targets:
        db.add(TestResult(run_id=run.id, case_id=t.node_id, status="pending"))
    await db.commit(); await db.refresh(run)
    await start_tree_run(run.id, max_steps=req.max_steps)
    return await _run_out(run, db)


class NodeRunRequest(BaseModel):
    suite_id: str
    device_id: str
    node_id: str
    provider: str = "openai"
    model: str = "gpt-4o"
    max_steps: int = 20


@router.post("/node", response_model=RunOut, status_code=201)
async def create_node_run(req: NodeRunRequest, db: AsyncSession = Depends(get_db)):
    """Run a single step-tree node: execute its root→node chain."""
    conn = connected_devices.get(req.device_id)
    if conn is None or not conn.is_connected:
        raise HTTPException(status_code=400, detail=f"Device {req.device_id} is not connected")
    from core.test_runner import node_targets_for_suite, start_tree_run
    targets = await node_targets_for_suite(db, req.suite_id, req.node_id)
    if not targets:
        raise HTTPException(status_code=404, detail="Node not found in this suite's step-tree")
    run = TestRun(suite_id=req.suite_id, device_id=req.device_id,
                  provider=req.provider, model=req.model, status="pending")
    db.add(run); await db.flush()
    db.add(TestResult(run_id=run.id, case_id=req.node_id, status="pending"))
    await db.commit(); await db.refresh(run)
    await start_tree_run(run.id, max_steps=req.max_steps, only_node_id=req.node_id)
    return await _run_out(run, db)


# ── Run Comparison (must be before /{run_id} to avoid route shadowing) ──────

class CompareItem(BaseModel):
    case_id: str
    path: str
    expected: str
    status_a: Optional[str] = None
    status_b: Optional[str] = None
    reason_a: str = ""
    reason_b: str = ""
    steps_a: int = 0
    steps_b: int = 0


class CompareOut(BaseModel):
    run_a: RunOut
    run_b: RunOut
    cases: List[CompareItem]
    summary: dict


@router.get("/compare", response_model=CompareOut)
async def compare_runs(
    a: str = Query(..., description="Run A id"),
    b: str = Query(..., description="Run B id"),
    db: AsyncSession = Depends(get_db),
):
    """Compare results of two runs that share the same suite."""
    run_a = await db.get(TestRun, a)
    run_b = await db.get(TestRun, b)
    if not run_a or not run_b:
        raise HTTPException(status_code=404, detail="One or both runs not found")

    async def _results_by_case(run_id: str):
        res = await db.execute(
            select(TestResult, TestCase)
            .join(TestCase, TestResult.case_id == TestCase.id)
            .where(TestResult.run_id == run_id)
            .order_by(TestCase.order)
        )
        return {c.id: (r, c) for r, c in res.all()}

    map_a = await _results_by_case(a)
    map_b = await _results_by_case(b)
    all_case_ids = list(dict.fromkeys(list(map_a.keys()) + list(map_b.keys())))

    cases: List[CompareItem] = []
    improved = regressed = unchanged = 0

    for cid in all_case_ids:
        ra, ca = map_a.get(cid, (None, None))
        rb, cb = map_b.get(cid, (None, None))
        c = ca or cb
        item = CompareItem(
            case_id=cid,
            path=c.path if c else "",
            expected=c.expected if c else "",
            status_a=ra.status if ra else None,
            status_b=rb.status if rb else None,
            reason_a=ra.reason if ra else "",
            reason_b=rb.reason if rb else "",
            steps_a=ra.steps if ra else 0,
            steps_b=rb.steps if rb else 0,
        )
        cases.append(item)
        if ra and rb:
            if ra.status != "pass" and rb.status == "pass":
                improved += 1
            elif ra.status == "pass" and rb.status != "pass":
                regressed += 1
            else:
                unchanged += 1

    return CompareOut(
        run_a=await _run_out(run_a, db),
        run_b=await _run_out(run_b, db),
        cases=cases,
        summary={"improved": improved, "regressed": regressed, "unchanged": unchanged},
    )


@router.get("/{run_id}", response_model=RunOut)
async def get_run(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(TestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return await _run_out(run, db)


@router.delete("/{run_id}", status_code=204)
async def delete_run(run_id: str, db: AsyncSession = Depends(get_db)):
    """Delete an entire run record and everything derived from it: its per-case
    results, their step logs, and the lessons distilled from this run (so the
    agent's memory is cleaned too). Active runs are cancelled first."""
    run = await db.get(TestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # Stop the live task if this run is still in flight.
    if run_id in active_runs:
        state = active_runs.get(run_id)
        await cancel_run(run_id)
        if state is not None:
            await state.finish()
        active_runs.pop(run_id, None)

    result_ids = [
        r for (r,) in (
            await db.execute(select(TestResult.id).where(TestResult.run_id == run_id))
        ).all()
    ]
    # Lessons distilled from this run (keyed by source_run_id).
    await db.execute(delete(LessonLearned).where(LessonLearned.source_run_id == run_id))
    if result_ids:
        await db.execute(delete(TestStepLog).where(TestStepLog.result_id.in_(result_ids)))
    await db.execute(delete(TestResult).where(TestResult.run_id == run_id))
    await db.execute(delete(TestRun).where(TestRun.id == run_id))
    await db.commit()


@router.post("/{run_id}/cancel")
async def cancel_run_endpoint(run_id: str, db: AsyncSession = Depends(get_db)):
    """Cancel an active run. Always marks the DB as cancelled, even if the
    background task is no longer in memory (e.g. after a server restart)."""
    run = await db.get(TestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status not in ("pending", "running"):
        raise HTTPException(status_code=400, detail=f"Run is already {run.status}")

    # Kill the live task if it is still running (best-effort)
    state = active_runs.get(run_id)
    if state is not None:
        await cancel_run(run_id)
        # Notify any SSE consumers immediately
        await state.emit("⛔ Run cancelled by user")
        await state.finish()
        active_runs.pop(run_id, None)

    # Always write cancelled status to DB so the UI reflects the change
    await db.execute(
        update(TestRun).where(TestRun.id == run_id)
        .values(status="cancelled", finished_at=datetime.utcnow())
    )
    await db.commit()
    return {"ok": True}


@router.get("/{run_id}/logs")
async def stream_logs(run_id: str):
    """SSE endpoint: streams log lines while the run is active."""
    # If run is already done, fetch stored logs from DB and stream them
    async def _stream():
        if run_id in active_runs:
            async for chunk in run_log_stream(run_id):
                yield chunk
        else:
            async with AsyncSessionLocal() as session:
                run = await session.get(TestRun, run_id)
                if not run:
                    yield "data: Run not found\n\n"
                    return
                res = await session.execute(
                    select(TestResult).where(TestResult.run_id == run_id)
                )
                for r in res.scalars().all():
                    if r.log:
                        for line in r.log.splitlines():
                            yield f"data: {line}\n\n"
                yield "data: [done]\n\n"

    return StreamingResponse(
        _stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{run_id}/recording.mp4")
async def get_recording(run_id: str):
    """Serve the ADB screen recording for a finished run (404 if none)."""
    if not has_recording(run_id):
        raise HTTPException(status_code=404, detail="No recording for this run")
    return FileResponse(str(recording_path(run_id)), media_type="video/mp4")


@router.get("/{run_id}/report", response_class=HTMLResponse)
async def get_report(
    run_id: str,
    download: bool = Query(False, description="Set true to trigger file download"),
):
    """Generate and return a self-contained HTML test report."""
    try:
        html = await generate_html_report(run_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="report_{run_id[:8]}.html"'
    return HTMLResponse(content=html, headers=headers)


@router.post("/{run_id}/results/{result_id}/star")
async def toggle_star(run_id: str, result_id: str, db: AsyncSession = Depends(get_db)):
    """Toggle the starred (reference) flag on a test result."""
    result = await db.get(TestResult, result_id)
    if not result or result.run_id != run_id:
        raise HTTPException(status_code=404, detail="Result not found")
    result.is_starred = not result.is_starred
    await db.commit()
    return {"id": result_id, "is_starred": result.is_starred}


@router.get("/{run_id}/results", response_model=List[ResultOut])
async def get_results(run_id: str, db: AsyncSession = Depends(get_db)):
    run = await db.get(TestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    res = await db.execute(
        select(TestResult, TestCase)
        .join(TestCase, TestResult.case_id == TestCase.id)
        .where(TestResult.run_id == run_id)
        .order_by(TestCase.order)
    )
    rows = res.all()
    return [
        ResultOut(
            id=r.id,
            case_id=r.case_id,
            path=c.path,
            expected=c.expected,
            status=r.status,
            reason=r.reason,
            steps=r.steps,
            screenshot_b64=r.screenshot_b64,
            log=r.log,
            started_at=r.started_at.isoformat() if r.started_at else None,
            finished_at=r.finished_at.isoformat() if r.finished_at else None,
            is_starred=r.is_starred or False,
            total_tokens=r.total_tokens or 0,
        )
        for r, c in rows
    ]


@router.get("/{run_id}/results/{result_id}/steps", response_model=List[StepOut])
async def get_result_steps(run_id: str, result_id: str, db: AsyncSession = Depends(get_db)):
    """Return the per-step replay log for a single test result."""
    result = await db.get(TestResult, result_id)
    if not result or result.run_id != run_id:
        raise HTTPException(status_code=404, detail="Result not found")
    res = await db.execute(
        select(TestStepLog)
        .where(TestStepLog.result_id == result_id)
        .order_by(TestStepLog.step)
    )
    return [
        StepOut(
            id=sl.id,
            step=sl.step,
            thought=sl.thought,
            action=sl.action,
            action_result=sl.action_result,
            screenshot_b64=sl.screenshot_b64,
            prompt_tokens=sl.prompt_tokens or 0,
            completion_tokens=sl.completion_tokens or 0,
            total_tokens=sl.total_tokens or 0,
            perception_ms=sl.perception_ms or 0,
            llm_ms=sl.llm_ms or 0,
            action_ms=sl.action_ms or 0,
            subgoal_index=sl.subgoal_index,
            subgoal_desc=sl.subgoal_desc or "",
        )
        for sl in res.scalars().all()
    ]
