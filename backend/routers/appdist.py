"""Serve the latest Android APK for QR-code download / install.

The APK is never committed to git (it's a 16 MB binary). Resolution order:

  1. A locally-built APK in ``backend/data/apk/`` — what ``./gradlew assembleDebug``
     archives there; preferred (LAN-fast, matches your source).
  2. Fallback: the newest ``*.apk`` asset on the project's latest GitHub Release,
     lazily downloaded into ``backend/data/apk/`` once and then served locally.

So a fresh open-source clone (no local build, no Android toolchain) still serves
a working APK for the in-app "scan to install" QR, while internal/dev setups keep
using their freshly-built APK and never touch the network.
"""
import asyncio
import json
import logging
import os
import re
import urllib.request
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/app", tags=["app"])

APK_DIR = Path(__file__).parent.parent / "data" / "apk"

# Public repo whose latest Release holds the published APK. Override for forks /
# internal mirrors via env; set empty to disable the network fallback entirely.
RELEASE_REPO = os.environ.get("APP_RELEASE_REPO", "rejigtian/Smart-AI-Bot")

_download_lock = asyncio.Lock()


def _local_apk() -> Optional[Path]:
    if not APK_DIR.exists():
        return None
    apks = sorted(APK_DIR.glob("*.apk"), key=lambda p: p.stat().st_mtime, reverse=True)
    return apks[0] if apks else None


def _fetch_release_apk() -> Optional[Path]:
    """Download the latest GitHub Release's APK into APK_DIR (blocking). Returns
    the path, or None on any failure (offline, no release, no apk asset)."""
    if not RELEASE_REPO:
        return None
    try:
        api = f"https://api.github.com/repos/{RELEASE_REPO}/releases/latest"
        req = urllib.request.Request(api, headers={"Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            rel = json.load(resp)
        asset = next((a for a in rel.get("assets", []) if a["name"].endswith(".apk")), None)
        if not asset:
            logger.warning("Latest release of %s has no .apk asset", RELEASE_REPO)
            return None
        APK_DIR.mkdir(parents=True, exist_ok=True)
        dest = APK_DIR / asset["name"]
        if dest.exists() and dest.stat().st_size == asset.get("size", -1):
            return dest  # already cached
        tmp = dest.with_suffix(".apk.part")
        logger.info("Downloading %s (%s bytes) from %s release",
                    asset["name"], asset.get("size"), RELEASE_REPO)
        urllib.request.urlretrieve(asset["browser_download_url"], tmp)
        tmp.replace(dest)  # atomic
        return dest
    except Exception as exc:
        logger.warning("Could not fetch release APK for %s: %s", RELEASE_REPO, exc)
        return None


async def _resolve_apk() -> Optional[Path]:
    """Local APK if present, else lazily fetch the latest release APK (once)."""
    apk = _local_apk()
    if apk is not None:
        return apk
    async with _download_lock:
        apk = _local_apk()  # re-check: a concurrent request may have fetched it
        if apk is not None:
            return apk
        return await asyncio.to_thread(_fetch_release_apk)


class AppInfo(BaseModel):
    available: bool
    version: Optional[str] = None
    filename: Optional[str] = None
    size: Optional[int] = None
    source: Optional[str] = None  # "local" or "release"


@router.get("/latest", response_model=AppInfo)
async def latest_app():
    had_local = _local_apk() is not None
    apk = await _resolve_apk()
    if apk is None:
        return AppInfo(available=False)
    m = re.search(r"SmartAgent-(.+)\.apk", apk.name)
    return AppInfo(
        available=True,
        version=m.group(1) if m else None,
        filename=apk.name,
        size=apk.stat().st_size,
        source="local" if had_local else "release",
    )


@router.get("/download")
async def download_app():
    apk = await _resolve_apk()
    if apk is None:
        raise HTTPException(
            status_code=404,
            detail="No APK available — build it (./gradlew assembleDebug) or "
                   "ensure the server can reach the latest GitHub Release.",
        )
    return FileResponse(
        path=str(apk),
        media_type="application/vnd.android.package-archive",
        filename=apk.name,
    )
