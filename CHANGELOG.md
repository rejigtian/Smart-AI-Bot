# Changelog

All notable changes to Smart-AI-Bot are documented here.

---

## v1.1.0

**English**

### Added
- **QR pairing** — the web Devices page shows a per-device QR; the Portal app's new
  **Scan QR** button reads the server URL + token and connects in one tap, no
  copy-paste. The QR encodes whatever host you browse with, so LAN/IP access just
  works without a public deployment.
- **QR app download** — a **Download App** QR on the web page; scan it with a phone
  browser to download and install the latest APK directly (served by the backend at
  `/api/app/download`).
- **Native app UI redesign** — the Portal app now matches the web frontend's
  cyan-terminal design system (electric-cyan accent, monospace labels, hairline
  cards on a cool canvas) and ships a consistent app icon.

### Fixed
- **Copy Token over plain HTTP** — clipboard now falls back to a legacy path on
  non-secure (`http://<ip>`) origins, so the button works off HTTPS/localhost.
- **Connection state** — the app now distinguishes *connecting* from *connected*
  (previously it never left "connecting").
- **Keyboard no longer covers the inputs** — the config screen resizes so the
  focused field stays visible.

### Build
- The debug APK is archived as `SmartAgent-<version>.apk` after each build and
  served for QR download.
- Backend dependencies pinned to exact versions for reproducible builds.

---

**简体中文**

### 新增
- **扫码连接** —— Web 设备页为每台设备生成二维码；Portal App 新增**扫码连接**按钮，扫一下即读取服务器地址 + token 并自动连接，免复制粘贴。二维码编码的就是你访问网页用的地址，所以局域网/IP 访问开箱即用，无需公网部署。
- **扫码安装 App** —— Web 页新增**安装 App** 二维码；用手机浏览器扫码即可直接下载并安装最新 APK（后端 `/api/app/download` 提供）。
- **原生 App UI 换肤** —— Portal App 改为与 Web 前端一致的「电青终端」设计体系（电青主色、等宽标签、cool 背景上的 hairline 卡片），并配套一致的应用图标。

### 修复
- **明文 HTTP 下复制 Token** —— 剪贴板在非安全上下文（`http://<ip>`）自动降级到旧写法，不在 HTTPS/localhost 也能复制。
- **连接状态** —— App 区分「连接中」与「已连接」（此前一直停在"连接中"）。
- **键盘不再遮挡输入框** —— 配置页随键盘自动收缩，聚焦的输入框始终可见。

### 构建
- 每次打包后 APK 归档为 `SmartAgent-<版本号>.apk` 并用于扫码下载。
- 后端依赖锁定为精确版本，保证可复现构建。

---

## v1.0.2

**English**

### Fixed
- **Overnight crash on Android 14+** — the keep-alive / connection foreground
  services used the `dataSync` type, which has a 6h/day cap; running overnight
  threw `ForegroundServiceDidNotStopInTimeException` and crashed the app, which
  also took the accessibility service down ("enabled but can't run"). Switched
  to `specialUse` (no time cap).
- **App launch from the background** — `start_app` now launches the target app
  from the AccessibilityService context, which is exempt from Android's
  background-activity-launch restriction, so the app reliably comes to the
  foreground instead of silently doing nothing.
- **Newer-model parameter compatibility** — the agent auto-strips optional
  sampling params (`temperature`, etc.) and retries when a model rejects them
  (e.g. Bedrock Claude Opus 4.8: "temperature is deprecated"), so runs no longer
  silently fall back to a weaker model.
- **Mid-run reconnect** — the agent waits for the device to reconnect (up to
  150s) when an OEM briefly cuts the backgrounded Portal's socket, instead of
  failing the case.
- **Generated content no longer repeats** — starred references redact typed text
  so the agent regenerates content (e.g. a joke) instead of copying last run's.

### Added
- **One-tap background-survival setup** — a card that detects battery-optimization
  state, requests the exemption, and deep-links into the OEM autostart page
  (MIUI / EMUI / ColorOS / OriginOS / OneUI).

---

**简体中文**

### 修复
- **Android 14+ 过夜崩溃** —— 保活/连接前台服务用的是 `dataSync` 类型，它有「每天 6 小时」上限；跑过一夜触发 `ForegroundServiceDidNotStopInTimeException` 把 App 崩掉，连带无障碍服务一起失效（"已启用但无法运行"）。改为无时长上限的 `specialUse`。
- **后台启动 App** —— `start_app` 改为从无障碍服务上下文启动目标 App（豁免 Android 后台 Activity 启动限制），App 能可靠被拉到前台，不再静默失败。
- **新模型参数兼容** —— 模型拒绝某个可选采样参数时（如 Bedrock Claude Opus 4.8 废弃了 `temperature`），Agent 自动剥掉并重试，不再静默降级到更弱的模型。
- **运行中断线重连** —— 厂商短暂掐断后台 Portal 的 socket 时，Agent 会等待设备重连（最多 150s），而不是直接判用例失败。
- **生成内容不再重复** —— 星标参考会脱敏输入文本，Agent 重新生成内容（如笑话），不再照抄上次。

### 新增
- **一键后台保活设置** —— 检测电池优化状态、申请豁免，并直接跳转到厂商自启动页（MIUI / EMUI / ColorOS / OriginOS / OneUI）。

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
