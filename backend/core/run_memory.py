"""
Cross-run memory shared by every run mode (isolated, folder-batch, tree).

Two kinds of memory let a later run benefit from an earlier one:

  • Reference example — the action history of the best prior result for a case,
    injected as a soft few-shot navigation guide. We prefer an explicitly
    starred result, but fall back to the most recent PASSED result so a case
    that simply succeeded last time helps the next run with no manual starring
    ("success auto-memory").

  • Lesson learned — a short note distilled from a past mistake (see
    lesson_extractor), loaded by case / suite / task-keyword and injected as a
    "don't repeat this" hint.

Both executors (execute_run, execute_batch_run) call these helpers so the
behaviour stays identical across run modes.
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import select

from db.database import AsyncSessionLocal
from db.models import TestResult, TestStepLog

logger = logging.getLogger(__name__)

# Recovery actions that, when paired with a "this was wrong" thought, mark the
# preceding step as a wasted detour we should drop from the reference.
_RECOVERY_FNS = {"press_key", "global_action"}
_WRONG_KW = ["wrong", "not what", "accidentally", "误", "不是", "关闭", "keyboard"]


async def load_reference_examples(case_id: str) -> tuple[list, str]:
    """Load a soft navigation reference for one case from its best prior result.

    Prefers a starred result; otherwise falls back to the most recent PASSED
    result (success auto-memory). Action steps are enriched with the thought
    from each StepLog, and obvious tap→recover detours are filtered out.

    Returns (examples, message). `message` is a short human line to emit, or ""
    when there's nothing to load.
    """
    async with AsyncSessionLocal() as session:
        # Prefer an explicitly starred result; fall back to the latest pass.
        ref_row = (
            await session.execute(
                select(TestResult)
                .where(TestResult.case_id == case_id, TestResult.is_starred == True)  # noqa: E712
                .order_by(TestResult.finished_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        auto = False
        if ref_row is None:
            ref_row = (
                await session.execute(
                    select(TestResult)
                    .where(TestResult.case_id == case_id, TestResult.status == "pass")
                    .order_by(TestResult.finished_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            auto = ref_row is not None

        if not ref_row or not ref_row.action_history_json:
            return [], ""

        try:
            examples = json.loads(ref_row.action_history_json)
        except Exception:
            return [], ""
        if not examples:
            return [], ""

        # Enrich with thoughts from StepLog.
        step_rows = (
            await session.execute(
                select(TestStepLog)
                .where(TestStepLog.result_id == ref_row.id)
                .order_by(TestStepLog.step)
            )
        ).scalars().all()
        step_thoughts = {sl.step: sl.thought for sl in step_rows if sl.thought}
        for rec in examples:
            thought = step_thoughts.get(rec.get("step", 0), "")
            if thought:
                rec["thought"] = thought[:200]

        # Filter wasted steps: a tap immediately followed by a recovery
        # (back/close) whose thought says it was a mistake.
        filtered = []
        skip_next = False
        for j, rec in enumerate(examples):
            if skip_next:
                skip_next = False
                continue
            if j + 1 < len(examples):
                nxt_fn = examples[j + 1].get("fn_name", "")
                nxt_thought = step_thoughts.get(examples[j + 1].get("step", 0), "")
                if nxt_fn in _RECOVERY_FNS and any(kw in nxt_thought.lower() for kw in _WRONG_KW):
                    skip_next = True
                    continue
            filtered.append(rec)

    src = "passed run (auto)" if auto else "starred run"
    if len(filtered) < len(examples):
        msg = f"  📌 Loaded {len(filtered)}-step reference from {src} (filtered {len(examples) - len(filtered)} wasted steps)"
    else:
        msg = f"  📌 Loaded {len(filtered)}-step reference from {src}"
    return filtered, msg


async def load_lessons(case_id: str, suite_id: str = "", task_keyword: str = "") -> list[str]:
    """Load lessons learned relevant to a case. Best-effort; never raises."""
    try:
        from core.lesson_extractor import load_lessons_for_case
        return await load_lessons_for_case(
            case_id=case_id, suite_id=suite_id, task_keyword=task_keyword,
        )
    except Exception:
        logger.debug("load_lessons failed", exc_info=True)
        return []


async def extract_lessons(
    *, result_id: str, run_id: str, case_id: str, suite_id: str,
    task_keyword: str, provider: str, model: str, api_key: str, api_base: str,
) -> int:
    """Distil + store lessons from a completed result. Best-effort; never raises."""
    try:
        from core.lesson_extractor import extract_and_store_lessons
        return await extract_and_store_lessons(
            result_id=result_id, run_id=run_id, case_id=case_id, suite_id=suite_id,
            task_keyword=task_keyword, provider=provider, model=model,
            api_key=api_key, api_base=api_base,
        )
    except Exception:
        logger.debug("extract_lessons failed", exc_info=True)
        return 0


def task_keyword_for(path: str) -> str:
    """Derive a fuzzy task keyword from a case path for cross-run lesson matching."""
    return path.split(">")[0].strip()[:30] if ">" in path else path[:30]
