# Troubleshooting

**English** · [简体中文](troubleshooting.zh-CN.md)

---

| Symptom | What to check |
|---------|---------------|
| Device stays "offline" in the UI | 1) Backend must listen on `0.0.0.0`, not `127.0.0.1` — devices on other hosts can't reach loopback. 2) From the device's network, ping the backend IP to rule out routing. 3) Verify the WS URL and Token in the Portal App's settings page are correct. |
| Connects, then disconnects repeatedly | Check `logcat` filtered by `ReverseConn` / `AgentWS`. `ECONNREFUSED` = backend not running. `Unauthorized / 401` = wrong token. `Connection reset` = a network middlebox is killing long connections (corporate WiFi / VPN are common culprits). |
| Portal App process crashes unexpectedly | 1) Update to latest — older versions had an `onError` self-recursion `StackOverflowError` (fixed). 2) Check `adb logcat -t 200 *:E` for `AndroidRuntime`. |
| Step report shows missing screenshots / always shows "before" state | Already fixed: every step with a tool call now writes a `StepLog`, and the verifier returns a combined frame (A: at-action / B: settled) that becomes the step's evidence. |
| Agent confuses SoM markers with in-game items | We switched markers to magenta crosshairs and added explicit `SYSTEM_PROMPT` warnings. If a model still confuses them, switch to a smaller / less prominent shape, or use `request_screenshot` to force a fresh frame on the next step. |
| Unity / Canvas pages time out on screenshot | `ws_device.py` has the timeout bumped from 15s to 25s; server-side `portal_ws.py` skips pings when there's a pending RPC, so a slow screenshot won't get falsely disconnected. |

---

## Portal App connection-stability strategy

The Portal App ships with a droidrun-portal-style stability strategy:

- **Library-level ping/pong** (30s timeout) — auto-detects zombie connections
- **Reconnect budget counted from first failure** — resets to zero on successful connect, so it doesn't accumulate over a long-running session
- **Terminal error detection** (401 / 403 / 400) — stops retrying immediately
- **`AtomicBoolean` guard against duplicate reconnect scheduling** — prevents reconnect storms when `onError` and `onClose` both fire

---

## Server-side strategy

`backend/ws/portal_ws.py` WebSocket endpoint:

- **60s receive timeout** — allows slow RPCs (25s screenshots) to finish
- **Skips idle pings when there are pending RPCs** — a busy device is by definition alive
- **Tolerates 2 consecutive ping failures before disconnect** — single jitter shouldn't drop the device
