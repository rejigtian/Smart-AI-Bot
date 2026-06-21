from pathlib import Path
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

DB_PATH = Path(__file__).parent.parent / "data" / "db.sqlite3"
DB_PATH.parent.mkdir(exist_ok=True)

engine = create_async_engine(f"sqlite+aiosqlite:///{DB_PATH}", echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def init_db():
    # Import models so every table is registered on Base.metadata before
    # create_all runs — independent of import order at the call site.
    from db import models  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # ── Auto-migrate: add new columns to existing tables ─────────────
        # SQLite supports ADD COLUMN but not DROP/RENAME, so we just add
        # missing columns idempotently.

        async def _ensure_columns(table: str, columns: dict[str, str]):
            """Add missing columns to an existing table. columns = {name: DDL_type}"""
            existing = {
                row[1]
                for row in (await conn.execute(text(f"PRAGMA table_info({table})"))).fetchall()
            }
            for col, ddl in columns.items():
                if col not in existing:
                    await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))

        await _ensure_columns("test_results", {
            "is_starred": "BOOLEAN DEFAULT 0",
            "action_history_json": "TEXT DEFAULT ''",
            "total_tokens": "INTEGER DEFAULT 0",
        })

        await _ensure_columns("test_step_logs", {
            "prompt_tokens": "INTEGER DEFAULT 0",
            "completion_tokens": "INTEGER DEFAULT 0",
            "total_tokens": "INTEGER DEFAULT 0",
            "perception_ms": "INTEGER DEFAULT 0",
            "llm_ms": "INTEGER DEFAULT 0",
            "action_ms": "INTEGER DEFAULT 0",
            "subgoal_index": "INTEGER",
            "subgoal_desc": "TEXT DEFAULT ''",
        })

        await _ensure_columns("test_cases", {
            "parameters": "TEXT DEFAULT ''",
            "checkpoints": "TEXT DEFAULT ''",
            "loop_task": "BOOLEAN DEFAULT 0",
        })

        await _ensure_columns("step_nodes", {
            "source_id": "VARCHAR",
            "ref_id": "VARCHAR",
        })

        # suite_id + task_keyword were added to LessonLearned after the table
        # first shipped. Without these, the lesson load/save queries reference
        # non-existent columns and silently fail — i.e. NO cross-run lessons at
        # all on pre-existing databases.
        await _ensure_columns("lessons_learned", {
            "suite_id": "VARCHAR",
            "task_keyword": "VARCHAR DEFAULT ''",
        })

    # ── One-time migration: flat cases -> step-tree (idempotent per suite) ──
    from db.migrate_step_tree import migrate_suite_to_step_tree
    from db.models import TestSuite
    from sqlalchemy import select as _select
    async with AsyncSessionLocal() as _s:
        suite_ids = (await _s.execute(_select(TestSuite.id))).scalars().all()
        for sid in suite_ids:
            await migrate_suite_to_step_tree(_s, sid)
