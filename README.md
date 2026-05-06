# Smart-Bot

> AI-powered Android UI test automation platform — write test cases in plain English (or import from xmind / Markdown), have an AI agent run them on real devices, and get visual replay reports. Doubles as a general phone-automation tool with self-learning replay.

**English** · [简体中文](README.zh-CN.md)

---

## Demo

<video src="https://github.com/user-attachments/assets/b700f19a-fa30-4160-ab53-5b16b7187c34" controls width="100%"></video>

The demo above shows four panels recorded simultaneously for the same test case:

1. **Phone camera (top-left)** — physical proof: the device sits on a stand, no hands in the frame, system "Show Touches" is enabled so every synthetic tap appears as a white dot on the screen.
2. **Phone screen mirror (top-middle)** — the actual UI as seen by the AI agent.
3. **Backend log (top-right)** — live `uvicorn` output: agent thoughts, JSON-RPC calls (`tap_element`, `screenshot`), verifier verdicts.
4. **Web UI report (bottom)** — the test management page: step replay, agent reasoning per step, screenshots, pass/fail verdict.

The whole sequence is unedited — what you see is the agent operating the device end-to-end based on a single plain-language test case.

> **Note**: if the video doesn't render in your viewer, [download it directly](https://github.com/rejigtian/smart_bot/raw/main/assets/demo.mp4) (1.4 MB) or watch it on the [latest release page](https://github.com/rejigtian/smart_bot/releases).

---

## Table of Contents

- [Why Smart-Bot](#why-smart-bot)
- [Features](#features)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [More Docs](#more-docs)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## Why Smart-Bot

You write:

```
Open Settings, find About Phone, capture the version number.
Expected: System version is shown, no error dialog.
```

The AI agent finds the path, taps, verifies — every step has a screenshot and a thought trace. Failed cases automatically extract a "lesson learned"; the next time the same task runs, the agent avoids the same mistake.

No XPath, no Appium, no recorded scripts.

---

## Features

- **Plain-language test cases** — write in Chinese or English; import from YAML / Excel / xmind / Markdown
- **Dual perception** — screenshot (vision) + a11y tree (semantic), fused decision
- **Multi-LLM** — OpenAI, Anthropic, Gemini, Zhipu GLM, Groq, Ollama
- **Any-network device** — Portal App opens a reverse WebSocket; runs over 4G / 5G / corporate WiFi without ADB
- **Test management UI** — suites, cases, run history, step replay, run comparison, pass-rate trend
- **Self-contained HTML reports** — single-file export with screenshots, thoughts, actions, verdicts
- **Planner + Subagent** — complex tasks decomposed into subgoals, each with isolated context
- **Page-aware reasoning** — current Activity class + recent-pages trail injected, so the agent recognizes "wrong screen" instead of blindly tapping
- **Two-shot verifier** — at-action frame (catches transient toasts) + settled frame, both used for pass/fail judgment
- **Learn from mistakes** — `LessonLearned` auto-extracted from past runs and re-injected as guardrails
- **Auto-recovery** — 4-level escalation when stuck (warn → back → restart → fail)
- **Observability** — token usage, perception/LLM/action timing per step, pass-rate trend chart
- **CI/CD** — CLI runner, webhook notifications (Feishu / DingTalk / Slack)

Full comparison and roadmap: [Comparison](docs/comparison.md) · [Roadmap](docs/roadmap.md)

---

## Quick Start

### Prerequisites

- Python 3.9+
- Node.js 18+
- An Android device (real device or emulator)

### Run the backend & frontend

```bash
git clone https://github.com/rejigtian/smart_bot.git
cd smart_bot

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

Or one command:

```bash
./start.sh
```

Open http://localhost:5173 and drop your LLM API keys into Settings.

### Build & install the Portal App

```bash
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

First launch:

1. In the app's Settings, set the **Server WebSocket URL** (e.g. `ws://192.168.1.10:8000/v1/providers/join`) and a **Device Token** (generate one in the Web UI's Devices page).
2. System Settings → Accessibility → enable **AgentAccessibilityService**.
3. Back in the app, tap **Start Connection**. The persistent foreground notification means you're online.

### Write a test case

In the **Test Suites** page, create a suite and add a case:

```
Path: Open Settings, navigate to About Phone, capture the version number
Expected: System version info is shown, no error dialog
```

Pick a device + model, hit **Run**.

### CLI (CI/CD integration)

```bash
cd backend
python cli.py run --suite <id> --device <id> --json
```

Exit code: `0` = all passed, `1` = at least one failed.

---

## Architecture

```
Browser (management UI)
  │ REST + SSE
FastAPI server
  ├── Planner (decomposes complex tasks)
  │     └── SubAgent #1..N (isolated context per subgoal)
  ├── TestCaseAgent (6-layer + VLM fallback)
  │     perception → decision → action → memory → verification → replay
  └── SQLite + webhook + CLI
        Device / Suite / Case / Run / Result / StepLog
  │
  │ WebSocket JSON-RPC
Android device (Portal App)
  tap / swipe / input / screenshot / get_ui_state
```

Detailed design: [`docs/agent-architecture.md`](docs/agent-architecture.md).

---

## More Docs

| Doc | What it covers |
|-----|----------------|
| [Agent Architecture](docs/agent-architecture.md) | 6-layer agent + Planner / Subagent design |
| [Android Portal](docs/android-optimization.md) | Portal App performance & connection stability |
| [Test KB](test_knowledge/PLAN.md) | Building the test knowledge base for your own app |
| [Roadmap](docs/roadmap.md) | Done features + priorities |
| [Comparison](docs/comparison.md) | DroidRun / Midscene / AutoGLM technical comparison |
| [Troubleshooting](docs/troubleshooting.md) | Common issues — connection / screenshot / recognition |

---

## Acknowledgments

This project is inspired by:

- **[droidrun / droidrun-portal](https://github.com/droidrun/droidrun-portal)** — the Portal App's reverse WebSocket and connection-stability patterns (library-level ping/pong, reconnect budget, terminal-error detection) are directly inspired by droidrun-portal.
- **[Midscene.js](https://github.com/web-infra-dev/midscene)** — the Set-of-Marks visual annotation idea inspired our a11y element overlay. We ended up using magenta crosshairs instead of numbered bubbles to avoid confusion with in-game content.
- **[AutoGLM](https://github.com/THUDM/AutoGLM)** — the Planner / Grounder split influenced our dual-perception fusion architecture.

---

## Contributing

PRs and issues welcome. Common contribution paths:

- New LLM provider — add a branch in `agent/base.py`
- New Portal App action — define the tool in `agent/tools.py` + implement it in `ws_device.py`
- New test case format parser — `core/test_parser.py`
- Documentation / i18n

---

## License

MIT — see [LICENSE](LICENSE).
