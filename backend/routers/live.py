"""Live device screen.

- `GET /{id}/screenshot.jpg` — a single JPEG frame (the web UI polls this ~1/s).
  Short requests that complete cleanly, so they never hog a browser connection
  the way a long-lived MJPEG stream does.
- WS `/v1/devices/{id}/live` — smooth H.264 from `adb screenrecord` (local only).

Blocking work (adb subprocess, Pillow encode) is pushed to threads so it never
stalls the asyncio event loop (which would hang every other request)."""
import asyncio
import io
import logging
import os
import shutil
import subprocess
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Response, WebSocket, WebSocketDisconnect
from PIL import Image
from pydantic import BaseModel

from agent.ws_device import WebSocketDevice
from ws.portal_ws import connected_devices

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/devices", tags=["live"])


def _adb_path() -> Optional[str]:
    found = shutil.which("adb")
    if found:
        return found
    fallback = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
    return fallback if os.path.exists(fallback) else None


def _adb_serials() -> List[str]:
    """Serials of devices in `adb devices` state == 'device'. Blocking — call via
    asyncio.to_thread from async code."""
    adb = _adb_path()
    if not adb:
        return []
    try:
        out = subprocess.run([adb, "devices"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return []
    serials = []
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            serials.append(parts[0])
    return serials


def _to_jpeg(raw: bytes, max_w: int = 540, quality: int = 70) -> bytes:
    """PNG/JPEG bytes → downscaled JPEG. CPU-bound — call via asyncio.to_thread."""
    img = Image.open(io.BytesIO(raw))
    if img.mode != "RGB":
        img = img.convert("RGB")
    if img.width > max_w:
        img = img.resize((max_w, int(img.height * max_w / img.width)))
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=quality)
    return out.getvalue()


async def _adb_jpeg(serial: str) -> bytes:
    adb = _adb_path()
    proc = await asyncio.create_subprocess_exec(
        adb, "-s", serial, "exec-out", "screencap", "-p",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    raw, _ = await proc.communicate()
    if not raw:
        raise RuntimeError("screencap returned no data")
    return await asyncio.to_thread(_to_jpeg, raw)


async def _screenshot_jpeg(device_id: str) -> bytes:
    raw = await WebSocketDevice(device_id).screenshot()
    return await asyncio.to_thread(_to_jpeg, raw)


def _resolve_adb_serial(serials: List[str], source: str, serial: Optional[str]) -> Optional[str]:
    if source == "adb":
        return serial or (serials[0] if serials else None)
    if source == "auto" and len(serials) == 1:
        return serials[0]
    return None


class Capabilities(BaseModel):
    online: bool
    adb_available: bool
    adb_serials: List[str]


@router.get("/{device_id}/capabilities", response_model=Capabilities)
async def capabilities(device_id: str):
    serials = await asyncio.to_thread(_adb_serials)
    conn = connected_devices.get(device_id)
    return Capabilities(
        online=conn is not None and conn.is_connected,
        adb_available=bool(serials),
        adb_serials=serials,
    )


@router.get("/{device_id}/screenshot.jpg")
async def screenshot_frame(device_id: str, source: str = "auto", serial: Optional[str] = None):
    """One JPEG frame. source: auto | adb | screenshot."""
    serials = await asyncio.to_thread(_adb_serials)
    use = _resolve_adb_serial(serials, source, serial)
    try:
        if use:
            jpeg = await _adb_jpeg(use)
        else:
            conn = connected_devices.get(device_id)
            if conn is None or not conn.is_connected:
                raise HTTPException(status_code=404, detail="Device offline")
            jpeg = await _screenshot_jpeg(device_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.debug("live frame failed: %s", e)
        raise HTTPException(status_code=503, detail="Frame unavailable")
    return Response(content=jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


async def stream_h264(websocket: WebSocket, device_id: str):
    """Smooth live screen over ADB: hardware-encoded H.264 from `screenrecord`,
    relayed as binary WS frames. Browser muxes to fMP4 (jmuxer). Local-only."""
    await websocket.accept()
    source = websocket.query_params.get("source", "auto")
    serials = await asyncio.to_thread(_adb_serials)
    serial = _resolve_adb_serial(serials, source, websocket.query_params.get("serial"))
    if not serial:
        await websocket.close(code=4404)  # no ADB → client falls back to screenshot
        return

    adb = _adb_path()
    proc = None
    try:
        while True:  # screenrecord caps at 3 min/run; loop to stay continuous
            proc = await asyncio.create_subprocess_exec(
                adb, "-s", serial, "exec-out", "screenrecord",
                "--output-format=h264", "--time-limit", "175", "--bit-rate", "8000000", "-",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
            while True:
                chunk = await proc.stdout.read(16384)
                if not chunk:
                    break
                await websocket.send_bytes(chunk)
            await proc.wait()
            proc = None
    except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
        pass
    except Exception as e:
        logger.debug("h264 stream ended: %s", e)
    finally:
        if proc is not None and proc.returncode is None:
            try:
                proc.kill()
            except Exception:
                pass
