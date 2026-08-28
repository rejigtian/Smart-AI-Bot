"""Quick-run containers must not pollute the user-facing suite library."""

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from db.database import Base
from db.models import QUICK_SUITE_FORMAT, TestSuite
from routers.testsuites import visible_suite_clause


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as value:
        yield value
    await engine.dispose()


@pytest.mark.asyncio
async def test_quick_containers_and_legacy_quick_suites_are_hidden(session):
    session.add_all([
        TestSuite(name="Login regression", source_format="manual"),
        TestSuite(name="快速任务: current", source_format=QUICK_SUITE_FORMAT),
        TestSuite(name="快速任务: legacy", source_format="manual"),
        TestSuite(name="快速任务: imported.md", source_format="markdown"),
    ])
    await session.commit()

    visible = (await session.execute(
        select(TestSuite).where(visible_suite_clause()).order_by(TestSuite.name)
    )).scalars().all()

    assert {(suite.name, suite.source_format) for suite in visible} == {
        ("Login regression", "manual"),
        ("快速任务: imported.md", "markdown"),
    }
