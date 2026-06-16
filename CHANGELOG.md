# Changelog

All notable changes to Smart-AI-Bot are documented here.

---

## v1.0.1

**English**

### Added
- **AWS Bedrock provider** — run Claude (Sonnet / Opus / Haiku) through AWS Bedrock with your AWS credentials; vision + tool-calling supported.
- **Resilient LLM completion** — automatic exponential-backoff retry on transient errors and fallback to backup models, so a flaky/rate-limited provider no longer fails a whole run.
- **Ordered per-step checkpoints** — a test case can carry an ordered list of `{action, expected}` steps (`点击X => 看到Y`), verified one by one.
- **Docker Compose deployment** + a deployment guide (LAN and public-server HTTPS/WSS).
- **New "cyan-terminal" design system** — a geeky/technical visual language (electric-cyan accent, monospace data, dark terminal log blocks), an app icon, and a provider-scoped Settings page.

### Fixed
- **App launch reliability** — `list_packages` now returns each app's display name (e.g. `我是卧底 | com.wepie.wespy`), so the agent stops guessing package names; `start_app` reports real launch failures instead of false success.
- **Agent loop robustness** — when a model narrates an action in plain text instead of emitting a tool call, the step is retried with `tool_choice="required"`; repeated no-action steps abort fast instead of burning the whole budget.

### Android
- **Ported droidrun-style keep-alive** — a recovery activity that re-foregrounds the app on screen-off/locked to survive overnight OEM/Doze process kills.

---

**简体中文**

### 新增
- **AWS Bedrock 接入** —— 用 AWS 凭证通过 Bedrock 跑 Claude（Sonnet / Opus / Haiku），支持视觉 + 工具调用。
- **韧性 LLM 调用** —— 瞬时错误自动指数退避重试，并在主模型失败时自动降级到备用模型，单个 provider 限流/抽风不再让整轮失败。
- **有序逐步校验（checkpoints）** —— 一条用例可携带有序的 `{动作, 预期}` 步骤（`点击X => 看到Y`），逐一验证。
- **Docker Compose 部署** + 部署指南（局域网 与 公网 HTTPS/WSS）。
- **全新「电青终端」设计体系** —— 极客/科技风视觉（电青主色、等宽数据、深色终端日志块）、应用图标、以及 provider 优先的设置页。

### 修复
- **App 启动可靠性** —— `list_packages` 现在返回每个 App 的中文显示名（如 `我是卧底 | com.wepie.wespy`），Agent 不再瞎猜包名；`start_app` 启动失败如实报错，不再谎报成功。
- **Agent 循环鲁棒性** —— 模型只用文字描述动作而不发工具调用时，自动用 `tool_choice="required"` 重试；连续无动作时快速失败，不再耗光整轮步数。

### Android
- **移植 droidrun 风格保活** —— 锁屏/灭屏时拉起恢复 Activity 把 App 拽回前台，扛过厂商/Doze 半夜杀进程。

---

## v1.0.0

Initial public release — AI-driven Android UI test platform: plain-language test
cases, dual-perception agent (screenshot + a11y tree), reverse-WebSocket device
connection, step replay, and self-contained HTML reports.
