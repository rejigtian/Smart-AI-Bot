"""Knowledge-search CLI validation and project Markdown fallback tests."""
from __future__ import annotations

import subprocess
import unittest
from unittest.mock import patch

from agent import test_kb
from core import kb_search
from core.test_agent import TestCaseAgent


def _completed(stdout: str = "", stderr: str = "", returncode: int = 0):
    return subprocess.CompletedProcess([], returncode, stdout=stdout, stderr=stderr)


class KnowledgeSearchCliTests(unittest.TestCase):
    def test_accepts_successful_output(self):
        with (
            patch.object(kb_search.shutil, "which", return_value="/usr/local/bin/kbtool"),
            patch.object(kb_search.subprocess, "run", return_value=_completed("knowledge result")),
        ):
            result = kb_search.run_kb_search_result("kbtool search", "checkout")

        self.assertTrue(result.succeeded)
        self.assertEqual(result.text, "knowledge result")
        self.assertEqual(result.error, "")

    def test_rejects_zero_exit_validation_error(self):
        output = (
            "Search: checkout\nError executing tool search_docs: "
            "1 validation error for TextNode\nid_ input_value=nan"
        )
        with (
            patch.object(kb_search.shutil, "which", return_value="/usr/local/bin/kbtool"),
            patch.object(kb_search.subprocess, "run", return_value=_completed(output)),
        ):
            result = kb_search.run_kb_search_result("kbtool search", "checkout")
            compatible_text = kb_search.run_kb_search("kbtool search", "checkout")

        self.assertFalse(result.succeeded)
        self.assertEqual(result.text, "")
        self.assertIn("validation error", result.error)
        self.assertEqual(compatible_text, "")

    def test_rejects_nonzero_exit(self):
        with (
            patch.object(kb_search.shutil, "which", return_value="/usr/local/bin/kbtool"),
            patch.object(
                kb_search.subprocess,
                "run",
                return_value=_completed(stderr="service unavailable", returncode=2),
            ),
        ):
            result = kb_search.run_kb_search_result("kbtool search", "checkout")

        self.assertFalse(result.succeeded)
        self.assertIn("exited with 2", result.error)


class AgentKnowledgeFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_skips_project_markdown_after_cli_success(self):
        agent = object.__new__(TestCaseAgent)
        agent.kb_search_cmd = "kbtool search"
        agent.project_kb_roots = ["/project/kb"]
        seen_roots = []

        def fake_search(query, extra_roots=None, matches_out=None, **kwargs):
            seen_roots.append(extra_roots)
            return ""

        with (
            patch.object(
                kb_search,
                "run_kb_search_result",
                return_value=kb_search.KBSearchResult(text="Project result"),
            ),
            patch.object(test_kb, "search_feature", side_effect=fake_search),
        ):
            text, source = await agent._retrieve_kb("checkout")

        self.assertEqual(text, "Project result")
        self.assertEqual(seen_roots, [[]])
        self.assertIn("项目检索", source)

    async def test_falls_back_without_injecting_cli_error(self):
        agent = object.__new__(TestCaseAgent)
        agent.kb_search_cmd = "kbtool search"
        agent.project_kb_roots = ["/project/kb"]
        seen_roots = []

        def fake_search(query, extra_roots=None, matches_out=None, **kwargs):
            seen_roots.append(extra_roots)
            matches_out.append({
                "title": "Checkout flow",
                "slug": "checkout",
                "source": "project",
                "score": 20,
            })
            return "Markdown fallback"

        with (
            patch.object(
                kb_search,
                "run_kb_search_result",
                return_value=kb_search.KBSearchResult(error="TextNode id is NaN"),
            ),
            patch.object(test_kb, "search_feature", side_effect=fake_search),
        ):
            text, source = await agent._retrieve_kb("checkout")

        self.assertEqual(text, "Markdown fallback")
        self.assertNotIn("TextNode", text)
        self.assertEqual(seen_roots, [["/project/kb"]])
        self.assertIn("失败，已回退", source)
