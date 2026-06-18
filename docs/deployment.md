# Deployment Guide

> How to deploy Smart-AI-Bot — from a laptop on your LAN to a public server that
> manages devices across any network.

**English** · [简体中文](deployment.zh-CN.md)

---

## Topology

```
┌─────────────┐     HTTPS / WSS      ┌──────────────────────────┐
│  Browser    │ ──────────────────▶ │   Reverse proxy (Caddy /  │
│  (operator) │                     │   Nginx) — TLS termination │
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
                                     │  4G / 5G / corporate WiFi │
                                     └──────────────────────────┘
```

The device opens the WebSocket **outbound** to the server, so it works on any
network that can reach the server's public address — no shared LAN, no ADB, no
USB.

---

## Addressing — which URL the device gets

The Devices page builds the **QR pairing code** and the **APK-download code** from the
address you open the Web UI with:

| You open the Web UI at | QR / pairing address becomes |
|------------------------|------------------------------|
| `http://localhost:5173` (operator's own machine) | the backend-reported **LAN IP** — `localhost` is auto-substituted, since a real phone can't reach it |
| `http://<LAN-IP>:5173` (same network) | that **LAN IP** — scan it from any phone on the LAN |
| `https://bot.example.com` (public) | `wss://bot.example.com/...` — works from any network |

So **switching to a public address or domain just means opening the Web UI through that
domain** (Scenario 2) — there's no separate server-address field to edit in the app; the
QR and the on-page hint follow whatever URL you browse with. A real phone can never use
`localhost` — that only works for an emulator running on the operator's own machine.

---

## Scenario 1 — Local / LAN (development & in-team trial)

The fastest path. Server and devices share a WiFi network.

```bash
git clone https://github.com/rejigtian/Smart-AI-Bot.git
cd Smart-AI-Bot
docker compose up -d
```

- Web UI: `http://localhost:5173`
- Find the server's LAN IP (`ipconfig getifaddr en0` on macOS, `ip addr` on Linux).
- Portal App → **Server WebSocket URL**: `ws://<LAN-IP>:8000/v1/providers/join`

`ws://` (plaintext) is fine on a trusted LAN. For anything leaving the LAN, use
Scenario 2.

### Port overrides

If `5173` or `8000` are taken:

```bash
BACKEND_PORT=18000 FRONTEND_PORT=15173 docker compose up -d
# Web UI now at http://localhost:15173
```

---

## Scenario 2 — Public server (distributed devices)

This is what makes "run a test device on 4G from anywhere" real. You need:

- A server with a public IP
- A domain name pointing at it (e.g. `bot.example.com`)
- Ports 80 + 443 open

### Step 1 — Run the app

On the server:

```bash
git clone https://github.com/rejigtian/Smart-AI-Bot.git
cd Smart-AI-Bot
docker compose up -d
```

The frontend (port `5173`) and backend (port `8000`) now listen on localhost.
**Do not expose port 8000 publicly** — terminate TLS in front of it instead.

### Step 2 — Put HTTPS/WSS in front (Caddy — easiest)

[Caddy](https://caddyserver.com) auto-provisions Let's Encrypt certificates.
Create `/etc/caddy/Caddyfile`:

```caddy
bot.example.com {
    # Web UI + REST + SSE
    reverse_proxy localhost:5173

    # Portal App reverse WebSocket — long-lived, no buffering
    @ws path /v1/*
    reverse_proxy @ws localhost:8000 {
        flush_interval -1
    }
}
```

```bash
sudo caddy reload --config /etc/caddy/Caddyfile
```

That's it — Caddy handles the cert, HTTP→HTTPS redirect, and `ws`→`wss` upgrade.

### Step 2 (alternative) — Nginx

If you already run Nginx:

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
        proxy_buffering off;            # required for SSE log streaming
        proxy_read_timeout 3600s;
    }

    # Portal App reverse WebSocket
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

Get the certificate with `certbot --nginx -d bot.example.com`.

### Step 3 — Point devices at WSS

In the Portal App's **Server WebSocket URL**, use the secure scheme:

```
wss://bot.example.com/v1/providers/join
```

Generate a **Device Token** in the Web UI's Devices page, paste it into the app,
enable Accessibility, tap **Start Connection**. The device now appears online in
the Web UI regardless of which network it's on.

---

## Persistence & backups

The SQLite database lives in the `backend-data` Docker volume.

```bash
# Back up
docker run --rm -v smart-androidbot_backend-data:/data -v "$PWD":/backup \
  alpine tar czf /backup/smart-bot-backup.tar.gz -C /data .

# Restore
docker run --rm -v smart-androidbot_backend-data:/data -v "$PWD":/backup \
  alpine sh -c "cd /data && tar xzf /backup/smart-bot-backup.tar.gz"
```

LLM API keys entered in Settings are stored in this same database, so the backup
captures them too — keep it private.

---

## Updating

```bash
git pull
docker compose up -d --build
```

The database schema auto-migrates on startup (additive columns only), so updates
are safe without manual migration steps. The `backend-data` volume survives
rebuilds.

---

## Operations cheat sheet

```bash
docker compose ps                 # status
docker compose logs -f            # tail both services
docker compose logs backend       # backend only
docker compose restart backend    # restart one service
docker compose down               # stop & remove containers (volume kept)
docker compose down -v            # ⚠ also deletes the data volume
```

---

## Security checklist for public deployment

- [ ] **Never expose port 8000 directly** — only the reverse proxy should be public
- [ ] **Always use `wss://`** off-LAN — device tokens travel in the `Authorization` header
- [ ] Device tokens are bearer credentials — rotate them in the Devices page if leaked
- [ ] The Web UI itself has no auth yet — put it behind the reverse proxy's basic auth, an SSO proxy (oauth2-proxy), or a VPN if it's internet-facing
- [ ] Restrict CORS in `backend/main.py` (`allow_origins`) if you don't need `*`
- [ ] Keep the data-volume backup private — it holds your LLM API keys
