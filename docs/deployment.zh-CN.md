# 部署指南

> 如何部署 Smart-AI-Bot —— 从局域网内的笔记本，到一台公网服务器管理任意网络下的设备。

[English](deployment.md) · **简体中文**

---

## 拓扑

```
┌─────────────┐     HTTPS / WSS      ┌──────────────────────────┐
│  浏览器     │ ──────────────────▶ │   反向代理 (Caddy /       │
│  (操作者)   │                     │   Nginx) — TLS 终止       │
└─────────────┘                     └────────────┬─────────────┘
                                                  │ HTTP / WS (localhost)
                                     ┌────────────▼─────────────┐
                                     │  frontend (nginx :80)     │
                                     │  backend  (uvicorn :8000) │
                                     │  — docker compose —       │
                                     └────────────▲─────────────┘
                                                  │ WSS  /v1/providers/join
                                     ┌────────────┴─────────────┐
                                     │  Portal App (Android)     │
                                     │  4G / 5G / 公司 WiFi      │
                                     └──────────────────────────┘
```

设备是**主动向外**建立 WebSocket 连接到服务器，所以只要设备能访问到服务器的公网地址就能工作 —— 不要求同网段、不要 ADB、不要 USB。

---

## 地址解析 —— 设备拿到的是哪个 URL

设备页的**扫码配对二维码**和 **APK 下载二维码**，都是按你**打开 Web UI 所用的地址**生成的：

| 你访问 Web UI 的地址 | 二维码 / 配对地址变成 |
|---------------------|----------------------|
| `http://localhost:5173`（操作者本机） | 后端探测到的**内网 IP** —— `localhost` 会被自动替换，因为真机访问不到它 |
| `http://<内网IP>:5173`（同一局域网） | 该**内网 IP** —— 同局域网下任意手机扫码即可 |
| `https://bot.example.com`（公网） | `wss://bot.example.com/...` —— 任意网络可用 |

所以**改用公网地址或域名，本质就是通过那个域名去打开 Web UI**（见场景二）—— App 里没有单独的"服务器地址"要改，二维码和页面提示会跟随你访问用的 URL 自动变化。真机永远用不了 `localhost`，那只对操作者本机上的模拟器有效。

### 当自动探测的内网 IP 不对时（VPN / 多网卡）

上表里 `localhost` 那一行，依赖后端**自动探测**内网 IP —— 它问操作系统"去外网会走哪块网卡"。在装了 **VPN 或虚拟网卡**的机器上（公司 VPN、Radmin、Docker、VMware……），这个探测会选错地址，因为这些网卡可能占据了默认路由。结果 Web UI 发给设备的是 `10.x`（VPN）或 `26.x`（虚拟网卡）这类**手机在 WiFi 下根本访问不到**的地址 —— 表现就是扫码"一直转圈"或 APK 下载失败。

**可靠的解决办法 —— 直接用你希望设备访问的那个内网 IP 打开 Web UI**，例如 `http://192.168.31.215:5173`。只要访问地址不是 `localhost`，所有设备地址（二维码、配对、APK 下载）都会**原样跟随地址栏**，绕过自动探测。用 `ipconfig`（Windows）/ `ip addr`（Linux）/ `ipconfig getifaddr en0`（macOS）查你真正的内网 IP —— 取那块**真正接在你路由器网络上**的网卡地址（通常是 `192.168.*`，有时是 `10.*` / `172.16–31.*`）。或者干脆断开 VPN，默认路由就会回到内网网卡。

> **也要检查防火墙。** 设备会直接访问前端（`5173`）和后端（`8000`）两个端口，所以必须放行这两个端口的入站 TCP。Windows 上用管理员 PowerShell 放行一次即可：
> ```powershell
> New-NetFirewallRule -DisplayName "Smart-AI-Bot LAN" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173,8000
> ```

---

## 场景一 —— 本地 / 局域网（开发 & 团队内试用）

最快路径。服务器和设备在同一个 WiFi 下。

```bash
git clone https://github.com/rejigtian/Smart-AI-Bot.git
cd Smart-AI-Bot
docker compose up -d
```

- Web UI：`http://localhost:5173`
- 查服务器局域网 IP（macOS：`ipconfig getifaddr en0`，Linux：`ip addr`）
- Portal App → **服务器 WebSocket 地址**：`ws://<局域网IP>:8000/v1/providers/join`

可信局域网内用 `ws://`（明文）没问题。一旦要出局域网，用场景二。

### 改端口

如果 `5173` 或 `8000` 被占：

```bash
BACKEND_PORT=18000 FRONTEND_PORT=15173 docker compose up -d
# Web UI 现在在 http://localhost:15173
```

---

## 场景二 —— 公网服务器（设备分布在各处）

这是"在任意地方用 4G 跑一台测试机"真正成立的配置。你需要：

- 一台有公网 IP 的服务器
- 一个指向它的域名（如 `bot.example.com`）
- 开放 80 + 443 端口

### 第 1 步 —— 起服务

在服务器上：

```bash
git clone https://github.com/rejigtian/Smart-AI-Bot.git
cd Smart-AI-Bot
docker compose up -d
```

前端（`5173`）和后端（`8000`）现在监听在 localhost。**不要把 8000 直接暴露到公网** —— 在它前面做 TLS 终止。

### 第 2 步 —— 前面挂 HTTPS/WSS（Caddy，最简单）

[Caddy](https://caddyserver.com) 会自动申请 Let's Encrypt 证书。新建 `/etc/caddy/Caddyfile`：

```caddy
bot.example.com {
    # Web UI + REST + SSE
    reverse_proxy localhost:5173

    # Portal App 反向 WebSocket —— 长连接，不缓冲
    @ws path /v1/*
    reverse_proxy @ws localhost:8000 {
        flush_interval -1
    }
}
```

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
```

完成 —— Caddy 自动处理证书、HTTP→HTTPS 跳转、以及 `ws`→`wss` 升级。

### 第 2 步（备选）—— Nginx

如果你已经在用 Nginx：

```nginx
server {
    listen 443 ssl http2;
    server_name bot.example.com;

    ssl_certificate     /etc/letsencrypt/live/bot.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bot.example.com/privkey.pem;

    # Web UI + REST + SSE
    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_buffering off;            # SSE 日志流必须关缓冲
        proxy_read_timeout 3600s;
    }

    # Portal App 反向 WebSocket
    location /v1/ {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

用 `certbot --nginx -d bot.example.com` 申请证书。

### 第 3 步 —— 设备指向 WSS

在 Portal App 的 **服务器 WebSocket 地址** 里，用安全协议：

```
wss://bot.example.com/v1/providers/join
```

在 Web UI 设备页生成 **设备 Token**，粘进 App，启用无障碍服务，点 **启动连接**。无论设备在哪个网络，都会在 Web UI 里显示上线。

---

## 数据持久化与备份

SQLite 数据库存在 `backend-data` 这个 Docker volume 里。

```bash
# 备份
docker run --rm -v smart-androidbot_backend-data:/data -v "$PWD":/backup \
  alpine tar czf /backup/smart-bot-backup.tar.gz -C /data .

# 恢复
docker run --rm -v smart-androidbot_backend-data:/data -v "$PWD":/backup \
  alpine sh -c "cd /data && tar xzf /backup/smart-bot-backup.tar.gz"
```

在设置页填的 LLM API Key 也存在同一个数据库里，备份会一起带上 —— 注意保密。

---

## 更新

```bash
git pull
docker compose up -d --build
```

数据库 schema 在启动时自动迁移（只增列），更新无需手动迁移步骤。`backend-data` volume 在重新构建后保留。

---

## 运维速查

```bash
docker compose ps                 # 状态
docker compose logs -f            # 跟踪两个服务日志
docker compose logs backend       # 只看后端
docker compose restart backend    # 重启某个服务
docker compose down               # 停止并删除容器（volume 保留）
docker compose down -v            # ⚠ 连数据 volume 一起删
```

---

## 公网部署安全清单

- [ ] **绝不直接暴露 8000 端口** —— 只有反向代理对公网开放
- [ ] **出局域网一律用 `wss://`** —— 设备 Token 走 `Authorization` 头传输
- [ ] 设备 Token 是 bearer 凭证 —— 泄露了在设备页轮换
- [ ] Web UI 本身暂无鉴权 —— 对公网开放时用反代的 basic auth、SSO 代理（oauth2-proxy）或 VPN 兜底
- [ ] 不需要 `*` 的话，收紧 `backend/main.py` 里的 CORS（`allow_origins`）
- [ ] 数据 volume 的备份保密 —— 里面有你的 LLM API Key
