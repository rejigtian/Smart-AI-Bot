# Contributing to Smart-Bot

Thanks for your interest! This guide covers how to set up a dev environment, the conventions we follow, and the kinds of contributions we're most eager for.

---

## Quick start for contributors

```bash
git clone https://github.com/rejigtian/smart_bot.git
cd smart_bot

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install

# Android (only if you're working on the Portal App)
cd ../android
./gradlew assembleDebug
```

To run the full stack while developing, see the [README's Quick Start section](README.md#quick-start).

---

## What we're looking for

In rough priority order:

1. **New LLM provider adapters** — add a branch in `backend/agent/base.py`. We currently support OpenAI / Anthropic / Gemini / Zhipu GLM / Groq / Ollama; PRs for new providers are very welcome.
2. **Test case format parsers** — `backend/core/test_parser.py`. We support YAML, Excel, xmind, Markdown; importing from other formats (JIRA, TestRail, Allure) would be high impact.
3. **Portal App actions** — define a tool in `backend/agent/tools.py` and implement it in `backend/agent/ws_device.py` + the Android `ActionDispatcher`.
4. **Bug fixes** — see open issues with `bug` label.
5. **Documentation / i18n** — both English and Chinese docs are first-class. PRs that improve clarity or add a new language are appreciated.
6. **iOS Portal App** — there's an open question about supporting iOS via XCTest / WebDriverAgent. If you have iOS expertise, please reach out before starting; this is a substantial effort.

---

## Issue first, PR second

For anything beyond a small fix or typo, **please open an issue first** to discuss the approach. This avoids wasted work if we have a different direction in mind.

For bug reports and feature requests, use the issue templates — they prompt for the info we'll ask for anyway.

---

## Pull request guidelines

- **One concern per PR.** A bug fix and an unrelated refactor should be two PRs.
- **Tests pass.** Run `pytest` in `backend/` if you touched backend code; `npm run build` in `frontend/` if you touched frontend.
- **Commit message style:** lowercase verb + concise summary. Example:
  - `fix: agent retries forever when device offline`
  - `feat: add Excel test case import`
  - `docs: clarify Portal App setup steps`
- **No mass renames or formatting-only commits** mixed with logic changes — they're impossible to review.
- **Mark draft PRs as draft** so we know what's ready to review.

We'll usually respond within 2 business days. If we miss your PR, feel free to ping in the comments.

---

## Code style

### Python (backend)

- 4-space indent, type hints encouraged on public functions
- Async-first: prefer `async def` + `await` over thread pools
- Keep modules focused — agent layers are intentionally split (perception / decision / memory / verifier / etc.)
- Comments explain **why**, not what; the code shows what

### TypeScript (frontend)

- Strict mode on; no `any` unless really necessary
- Components in PascalCase, hooks in camelCase prefixed with `use`
- TanStack Query for server state, React state for UI state
- Tailwind for styling — avoid one-off inline styles

### Kotlin (Android)

- Standard Android Studio formatter
- Coroutines + structured concurrency; no `runBlocking` in production code
- Foreground service for long-running connections (see `ReverseConnectionService.kt`)

---

## Architecture map (where to look)

| Concern | File |
|---------|------|
| Agent main loop | `backend/core/test_agent.py` |
| Per-step perception (screenshot + a11y tree) | `backend/agent/perception.py` |
| LLM tool definitions | `backend/agent/tools.py` |
| LLM dispatch (multi-provider) | `backend/agent/base.py` |
| Pre/post action verification | `backend/agent/verifier.py` |
| Memory + step recording | `backend/agent/memory.py` |
| WebSocket bridge to device | `backend/agent/ws_device.py` |
| Server-side WS endpoint | `backend/ws/portal_ws.py` |
| Database models | `backend/db/models.py` |
| REST routes | `backend/routers/` |
| Web UI | `frontend/src/pages/` |
| Portal App service | `android/app/src/main/java/com/dream/smart_androidbot/service/` |

For deeper architecture, see [`docs/agent-architecture.md`](docs/agent-architecture.md).

---

## Reporting security issues

Please **don't** open a public GitHub issue for security vulnerabilities. Email **rejigtian@gmail.com** with details, and we'll respond within 72 hours.

---

## Code of Conduct

Be kind, assume good faith, focus on the code not the person. Disagreement is fine; harassment isn't. We follow the spirit of the [Contributor Covenant](https://www.contributor-covenant.org/) — if you wouldn't say it in front of a colleague, don't write it here.

---

Thanks again for contributing!
