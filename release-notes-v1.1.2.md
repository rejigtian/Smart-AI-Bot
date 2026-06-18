# Smart-AI-Bot v1.1.2

自 v1.0.2 以来的首个发布 —— 实时画面、录屏回放、扫码连接、记忆治理。
First release since v1.0.2 — live device screen, run recording/replay, QR pairing, curatable memory.

> 安装包 / APK: `SmartAgent-1.1.2.apk`（debug 签名，可直接安装 / debug-signed, installable as-is）
> sha256: `d3d98e8fd13035b20c1c0d7f613c5884a540e703641efe1c179d33d4c2c35014`

---

## English

### ✨ Highlights
- **Live device screen** — watch the device live on the Devices / run page (ADB H.264 via WebCodecs, low latency; screenshot fallback for remote devices).
- **Run recording & replay** — local runs recorded to mp4; replay the recording or a per-step screenshot timeline. HTML report step replay can auto-play.
- **QR pairing & install** — scan a device QR to connect the Portal app in one tap; scan another to download/install the latest APK. Addresses default to the server's LAN IP.
- **Memory hygiene** — the agent's cross-run memory (reference paths + learned lessons) lives in run records; now list and delete them per case or per run.
- **Reliable background launch** — the overlay permission makes `start_app` work even when the Portal app isn't foregrounded.
- **Wide-screen UI + native redesign** — sidebar layout (results · live log · live/replay) and a cyan-terminal app theme/icon.

### 🐛 Fixed
- Cross-run lessons were silently disabled (missing migration) — now persist and load.
- Live-view stutter/drift and slow recording playback.
- Copy Token over plain http; keyboard covering inputs; connecting-vs-connected state.

### Install
Download `SmartAgent-1.1.2.apk` below, or scan the in-app **Download App** QR.

---

## 简体中文

### ✨ 亮点
- **设备实时画面** —— 设备页 / 运行页实时看设备（本地 ADB 走 H.264，WebCodecs 逐帧解码、低延迟；远程回落截图）。
- **运行录屏与回放** —— 本地运行录成 mp4，结束后可回放录像或逐步截图时间轴；HTML 报告步骤回放支持自动播放。
- **扫码连接与安装** —— 扫设备二维码一键连 Portal；扫另一个下载安装最新 APK。地址默认用服务器内网 IP。
- **记忆治理** —— Agent 的跨运行记忆（参考路径 + 经验教训）都来自运行记录，现在可按用例 / 按 Run 列出并删除。
- **可靠的后台启动** —— 悬浮窗权限让 `start_app` 在 Portal 不在前台时也能拉起目标 App。
- **宽屏 UI + 原生换肤** —— 侧边栏布局（结果 · 实时日志 · 实时/回放），电青终端主题与图标。

### 🐛 修复
- 跨运行经验此前一直失效（缺迁移）—— 现已正常持久化 / 加载。
- 实时画面卡顿/漂移、录屏回放偏慢。
- 明文 http 复制 Token；键盘遮挡输入框；连接中/已连接状态。

### 安装
下载下方 `SmartAgent-1.1.2.apk`，或扫描应用内**安装 App** 二维码。
