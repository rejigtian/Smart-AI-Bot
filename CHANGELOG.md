# Changelog

All notable changes to Smart-AI-Bot are documented here.

---

## v1.1.3

**English**

### Fixed
- **Screenshots could fail mid-run and the live screen tore** — the agent and the
  live preview both drove Android's accessibility screenshot, which the OS
  rate-limits to ~1/s; colliding requests returned a corrupt frame that aborted
  the case. Device screenshots are now serialized per device with a minimum
  interval and a short cache: the preview reuses the agent's latest frame instead
  of competing, and the agent always gets a fresh one.
- **Device-side errors surfaced as a cryptic crash** — a Portal `status:"error"`
  reply (e.g. a failed screenshot) was treated as a successful result and
  base64-decoded; it is now raised as a clear error.

### Added / Changed (Portal app)
- **MIUI / HyperOS support** — declare the installed-app-list permission, retry
  the rate-limited screenshot, and one-tap deep-link to MIUI's per-app permission
  editor (后台弹出界面 / 读取应用列表 / 悬浮窗). The setup card now shows per-item
  ✓/✗ status instead of a long toast.
- Runtime permissions are requested in one batch, so every prompt appears on the
  first launch.
- The built-in QR scanner is locked to portrait.
- The IME (custom keyboard) step is marked optional.

**简体中文**

### 修复
- **运行中截图可能失败、实时画面裂图** —— Agent 与实时预览同时调用 Android 无障碍截图，
  而系统将其限流到约每秒一次，撞车时返回损坏帧导致用例报错。现在每设备串行截图 + 最小间隔
  + 短缓存：预览复用 Agent 最近的帧、不再竞争，Agent 始终拿到新帧。
- **设备端错误显示为莫名崩溃** —— Portal 的 `status:"error"`（如截图失败）被当成成功结果去
  base64 解码；现在会作为清晰的错误抛出。

### 新增 / 调整（Portal App）
- **适配 MIUI / HyperOS** —— 声明读取应用列表权限、对限流截图自动重试、一键直达 MIUI 原生
  权限页（后台弹出界面 / 读取应用列表 / 悬浮窗）；设置卡逐项显示 ✓/✗ 状态，替代冗长 toast。
- 运行时权限合并为一次性申请，首次启动即逐个弹出。
- 内置扫码页锁定为竖屏。
- 输入法（自定义键盘）步骤标注为可选。

## v1.1.2

**English**

### Added
- **Memory hygiene** — cross-run memory (the agent's reference paths + learned
  lessons) is all derived from run records, so records are now curatable:
  - Each case has a **run-history panel** (the "记录" toggle) listing every past
    result with status, date, model, steps and tokens.
  - Delete a single result, **clear all**, or **delete only failed** for a case.
  - A per-suite **run-history list** under the trend chart; delete a whole run.
  - Every delete cascades to the result's step logs **and the lessons distilled
    from it**, so discarded experience stops priming the next run.
- **Add a sibling check (子用例) to a scenario** — a folder/scenario row (and the
  collapsed root breadcrumb) gains a **+ 子用例** action. Keep the path and just
  fill Expected to add another verification under the same scenario; append
  `> 子场景` to create a deeper level.
- **Pass-rate trend redesign** — gradient area chart with gridlines, a highlighted
  latest value, and per-point hover details.

### Fixed
- **Lessons were silently disabled** — the `lessons_learned` table predated its
  `suite_id` / `task_keyword` columns and the auto-migration didn't add them, so
  every lesson load/save threw and was swallowed. Cross-run lessons now actually
  persist and load.
- **Couldn't add a sub-case to a single-case scenario** — the add form forced a
  deeper node and blocked same-path siblings; both are fixed.

**简体中文**

### 新增
- **记忆治理** —— 跨运行记忆(参考路径 + 经验教训)全部来自运行记录,现在记录可人工干预:
  - 每条用例的「记录」面板:列出历次结果(状态/时间/模型/步数/token)。
  - 删单条、**清空**、或**只删失败**。
  - 趋势图下方新增本套件的**运行历史列表**,可删除整次运行。
  - 删除会**级联清理** step logs **和由它提炼的经验**,丢弃的经验不再影响下次运行。
- **给场景加同级子用例** —— 文件夹/场景行(及折叠后的根面包屑)新增 **+ 子用例**:
  不改路径只填预期 = 加同级验证;末尾加 `> 子场景` = 建子层级。
- **通过率趋势重做** —— 渐变面积图、网格、最新值高亮、逐点悬停详情。

### 修复
- **经验记忆此前一直失效** —— `lessons_learned` 表缺少后加的 `suite_id` / `task_keyword`
  两列且自动迁移漏了它,导致每次读写都报错被吞掉。现在跨运行经验真正生效。
- **单用例场景无法加子用例** —— 旧表单强制下沉、且挡住同路径同级;均已修复。

---

## v1.1.1

**English**

### Added
- **Live device screen** — the Devices page (and a run page while running) shows the
  device screen live. ADB-attached devices stream hardware-encoded H.264 decoded
  frame-by-frame via WebCodecs (scrcpy-style, low latency); over plain http it falls
  back to MSE, and remote devices fall back to ~1 fps screenshot polling. A per-device
  selector toggles 自动 / 截图 / 关.
- **Run screen recording & replay** — runs on a local ADB device are recorded to mp4
  (on-device `screenrecord`, correct timestamps → real-time playback). After a run ends
  the right rail shows the recording; any device also gets a per-step screenshot replay
  timeline. The HTML report's step replay gained an auto-play button.
- **Background app launch** — overlay (SYSTEM_ALERT_WINDOW) permission + a brief overlay
  window exempt the Portal from Android 10+ background-activity-launch limits, so
  `start_app` works reliably when the app isn't foregrounded.

### Changed
- **Web UI layout** — top nav replaced with a left sidebar and a wide-screen content
  area; the run page is a 3-region layout (results · steps/logs · live/replay) and case
  rows no longer truncate.

### Fixed
- **Live-view stutter / drift** — the MSE path stuttered every 1.5s and drifted behind
  real time; the WebCodecs canvas path renders frame-in/frame-out with no playback buffer.
- **Recording played slow** — switched from a raw timestamp-less H.264 stream to on-device
  mp4 so playback runs at real time.

---

**简体中文**

### 新增
- **设备实时画面** —— 设备页（及运行中的运行页）实时显示设备屏幕。本地 ADB 设备走硬件编码
  H.264，用 WebCodecs 逐帧解码上屏（scrcpy 同款、低延迟）；纯 http 回落 MSE，远程设备回落
  ~1fps 截图轮询。每台设备可选 自动 / 截图 / 关。
- **运行录屏与回放** —— 本地 ADB 设备的运行会录成 mp4（设备端 `screenrecord`，时间戳正确→
  实时回放）。运行结束后右栏显示录像；任意设备另有逐步截图回放时间轴。HTML 报告的步骤回放
  新增自动播放。
- **后台启动 App** —— 悬浮窗（SYSTEM_ALERT_WINDOW）权限 + 短暂悬浮窗，让 Portal 豁免
  Android 10+ 后台 Activity 启动限制，App 不在前台时 `start_app` 也能可靠拉起。

### 变更
- **Web UI 布局** —— 顶部导航改为左侧边栏 + 宽屏内容区；运行页改为三栏（结果 · 步骤/日志 ·
  实时/回放），用例行不再截断。

### 修复
- **实时画面卡顿/漂移** —— MSE 路径每 1.5s 顿一下且越播越慢；WebCodecs canvas 路径逐帧渲染、
  零播放缓冲。
- **录屏回放偏慢** —— 从无时间戳的裸 H.264 改为设备端 mp4，回放按真实速度。

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
- **App launch reliability** — `list_packages` now returns each app's display name (e.g. `My App | com.example.myapp`), so the agent stops guessing package names; `start_app` reports real launch failures instead of false success.
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
- **App 启动可靠性** —— `list_packages` 现在返回每个 App 的中文显示名（如 `示例App | com.example.myapp`），Agent 不再瞎猜包名；`start_app` 启动失败如实报错，不再谎报成功。
- **Agent 循环鲁棒性** —— 模型只用文字描述动作而不发工具调用时，自动用 `tool_choice="required"` 重试；连续无动作时快速失败，不再耗光整轮步数。

### Android
- **移植 droidrun 风格保活** —— 锁屏/灭屏时拉起恢复 Activity 把 App 拽回前台，扛过厂商/Doze 半夜杀进程。

---

## v1.0.0

Initial public release — AI-driven Android UI test platform: plain-language test
cases, dual-perception agent (screenshot + a11y tree), reverse-WebSocket device
connection, step replay, and self-contained HTML reports.
