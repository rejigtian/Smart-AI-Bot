# Smart-AI-Bot v1.1.0

扫码即配对、扫码即安装，原生 App 全面换上 cyan-terminal 设计。
QR pairing, QR install, and a full cyan-terminal redesign of the native app.

> 安装包：`SmartAgent-1.1.0.apk`（debug 签名，可直接安装）
> APK: `SmartAgent-1.1.0.apk` (debug-signed, installable as-is)
> sha256: `18a40cfb304e10c0ffa89c6b1a6059706641c6f7e40360da348f348991273957`

---

## English

### ✨ Added
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

### 🐛 Fixed
- **Copy Token over plain HTTP** — clipboard now falls back to a legacy path on
  non-secure (`http://<ip>`) origins, so the button works off HTTPS/localhost.
- **Connection state** — the app now distinguishes *connecting* from *connected*
  (previously it never left "connecting").
- **Keyboard no longer covers the inputs** — the config screen resizes so the
  focused field stays visible.

### 🔧 Build & addressing
- The debug APK is archived as `SmartAgent-<version>.apk` after each build and
  served for QR download.
- QR pairing + APK-download addresses default to the server's LAN IP
  (`localhost` is auto-substituted, since a phone can't reach it); a real IP or
  public domain is kept as-is.
- Backend dependencies pinned to exact versions for reproducible builds.

### 📦 Install
1. Run the backend, open the Web UI's **Devices** page in a phone browser.
2. Tap **📱 Download App**, scan the QR, install the APK (allow "unknown sources").
3. Generate a token → **Show QR** → in the app tap **Scan QR** to pair & connect.

> A real phone can't reach `localhost`. On the same LAN, open the Web UI by the
> machine's internal IP (e.g. `http://192.168.1.10:5173`). For a public address or
> domain, see the [deployment guide](docs/deployment.md).

---

## 简体中文

### ✨ 新增
- **扫码连接** —— Web 设备页为每台设备生成二维码；Portal App 新增**扫码连接**按钮，
  扫一下即读取服务器地址 + token 并自动连接，免复制粘贴。二维码编码的就是你访问网页
  用的地址，所以局域网/IP 访问开箱即用，无需公网部署。
- **扫码安装 App** —— Web 页新增**安装 App** 二维码；用手机浏览器扫码即可直接下载并
  安装最新 APK（后端 `/api/app/download` 提供）。
- **原生 App UI 换肤** —— Portal App 改为与 Web 前端一致的「电青终端」设计体系
  （电青主色、等宽标签、cool 背景上的 hairline 卡片），并配套一致的应用图标。

### 🐛 修复
- **明文 HTTP 下复制 Token** —— 剪贴板在非安全上下文（`http://<ip>`）自动降级到旧写法，
  不在 HTTPS/localhost 也能复制。
- **连接状态** —— App 区分「连接中」与「已连接」（此前一直停在"连接中"）。
- **键盘不再遮挡输入框** —— 配置页随键盘自动收缩，聚焦的输入框始终可见。

### 🔧 构建与地址
- 每次打包后 APK 归档为 `SmartAgent-<版本号>.apk` 并用于扫码下载。
- 扫码配对 + APK 下载地址默认用服务器内网 IP（`localhost` 会被自动替换，因为真机访问
  不到它）；用 IP 或公网域名访问则保持原样。
- 后端依赖锁定为精确版本，保证可复现构建。

### 📦 安装
1. 启动后端，用手机浏览器打开 Web UI 的**设备页**。
2. 点 **📱 安装 App**，扫码，安装 APK（允许「未知来源」）。
3. 生成 Token → **Show QR** → App 里点**扫码连接**完成配对并连接。

> 真机访问不到 `localhost`。同一局域网下用本机内网 IP 打开 Web UI
> （如 `http://192.168.1.10:5173`）。公网地址或域名见
> [部署文档](docs/deployment.zh-CN.md)。

---

**Full changelog:** [CHANGELOG.md](CHANGELOG.md)
