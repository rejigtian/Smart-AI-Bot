# Comparison with Similar Tools

> Honest assessment of how Smart-AI-Bot compares to DroidRun, Midscene.js, and AutoGLM.

**English** · [简体中文](comparison.zh-CN.md)

---

## The tools

**[DroidRun](https://github.com/droidrun/droidrun)** (Germany, MIT, ~8.2k stars)
Python framework, multi-LLM, controls devices via ADB + a Portal App. Focused on Android/iOS automation workflows. Also offers a hosted parallel-execution service (Mobilerun).

**[Midscene.js](https://github.com/web-infra-dev/midscene)** (ByteDance, MIT, ~12.6k stars)
TypeScript framework. Pure-vision approach (Set of Marks), no DOM/a11y tree required. Supports Web + Android + iOS + HarmonyOS, controls Android via ADB. Has a polished local HTML replay report.

**[AutoGLM](https://github.com/THUDM/AutoGLM)** (Zhipu AI / Tsinghua, commercial product)
Built on the GLM model family. Reads UI tree via Android AccessibilityService, separates planner/grounder for click precision. Targeted at the Chinese ecosystem; powers parts of z.ai.

---

## Detailed comparison matrix

| Dimension | Smart-AI-Bot | DroidRun | Midscene.js | AutoGLM |
|-----------|:---------:|:--------:|:-----------:|:-------:|
| **Primary positioning** | Android testing platform | Automation workflows | Cross-platform UI automation | Phone/Web autonomous agent |
| **UI perception** | Screenshot + a11y tree | Screenshot (VLM) | Pure screenshot (Set of Marks) | Screenshot + AccessibilityService |
| **Android control** | WebSocket (Portal App) | ADB + Portal App | ADB | AccessibilityService |
| **Device connection** | Reverse WebSocket, any network | ADB, same network required | ADB, same network required | AccessibilityService, on-device only |
| **Test case format** | YAML / Excel / xmind / md | Python script | YAML + JS/TS SDK | Natural-language goal |
| **LLM providers** | 6 | 5 | 4 (VLMs) | GLM only |
| **Test suite management UI** | **Yes (full Web UI)** | None | None | None |
| **Step replay** | **Yes (inline + HTML report)** | Arize Phoenix integration | Yes (local HTML file) | None |
| **Live log streaming** | **Yes (SSE)** | None | None | None |
| **Run-to-run comparison** | **Yes** | None | None | None |
| **HTML report export** | **Yes (self-contained)** | None | Yes (local file) | None |
| **Coordinate accuracy** | Half-size screenshot + grid labels | None | Set of Marks | Planner/Grounder split |
| **Non-developer friendly** | Medium (Web UI lowers the bar) | Low (code only) | Medium (YAML) | High (chat-style) |
| **Open source** | Yes (MIT) | Yes (MIT) | Yes (MIT) | Partial (model weights) |
| **Self-hostable** | Fully self-hosted | Yes | Yes | No (commercial SaaS) |

---

## Technical differences

### Perception layer

```
Midscene.js:   screenshot → Set of Marks annotation → pure VLM decision
               + works on any UI surface (Canvas / games / non-standard widgets)
               − no semantic fallback when vision is ambiguous;
                 coordinate drift is a real risk

AutoGLM:       screenshot + AccessibilityService tree
               → Planner outputs semantics → Grounder converts to coordinates
               + high precision, well-tuned for Chinese apps
               − AccessibilityService is awkward for automated testing
                 (manual enable required)

Smart-AI-Bot:     screenshot ×0.5 + grid labels + magenta-crosshair SoM
               → a11y tree text + Activity name → LLM decision
               + dual-channel info complements each other; multiplicative
                 coordinate system (not normalized) is more intuitive;
                 grid eliminates estimation errors; crosshairs can never
                 be confused with in-game collectibles (orbs, flames);
                 Activity name lets the agent recognize "wrong screen"
               − non-standard UI (Canvas games) has empty a11y tree,
                 still relies on pure vision in those cases
```

### Control layer: WebSocket vs. ADB

DroidRun and Midscene both rely on ADB, requiring devices to share a network with the PC (or USB direct). Smart-AI-Bot's Portal App actively opens a WebSocket connection; the device can be anywhere (4G/5G, corporate WiFi), and the server can be deployed in the cloud to manage devices globally — a real advantage for distributed QA setups (device farms, remote testing).

### Test management layer: where the gap is real

The biggest common gap: **none of the three competitors ship a test case management UI + results dashboard**. DroidRun and Midscene focus on the execution framework — test organization is left to user-supplied Python/YAML + CI. AutoGLM is a conversational agent, not a testing framework.

Smart-AI-Bot has full coverage at this layer: suite creation / case CRUD / run history / single-run detail / step replay / starred reference cases / HTML report export. This is currently the most direct differentiation.

---

## Where we win

1. **Complete testing loop in one UI** — from authoring to result analysis, all in a single Web interface; competitors don't have this layer
2. **Network-agnostic devices** — reverse WebSocket lets devices live on any network, perfect for cloud QA farms
3. **Dual-perception fusion + VLM fallback** — a11y tree provides semantic backup; VLM kicks in for Canvas/game scenes when the tree is empty
4. **Planner + Subagent layering** — complex multi-step tasks decompose into subgoals with isolated context per subgoal
5. **Coordinate precision design** — half-size + grid labels solve the root cause of "AI guesses coordinates wrong"
6. **Inline step replay** — directly in the Web UI and HTML report, no external tools needed
7. **LLM-agnostic** — 6 providers, decoupled architecture, switching models doesn't require code changes
8. **Smart recovery + retry** — 4-level escalation when stuck; case-level retry with home reset
9. **Observability** — token tracking, perception/LLM/action timing, pass-rate trend chart
10. **Webhook + CLI** — Feishu / DingTalk / Slack notifications; CI/CD pipeline integration
11. **Learn from mistakes** — auto-extracted `LessonLearned` from past runs is re-injected to avoid repeating mistakes — a capability none of the competitors have

## Where we lose

1. **Pure-vision maturity** — VLM fallback works, but for Canvas/game scenes our robustness lags Midscene's Set-of-Marks approach
2. **Cross-platform** — Android only. Midscene supports Web + iOS + HarmonyOS + desktop
3. **Test case templates** — DroidRun has a 40+ workflow library for popular apps; we don't
4. **Parallel execution** — currently single-device serial; DroidRun's hosted service supports multi-device parallel
5. **Community / ecosystem** — independent project, no external user community yet
