"""Serve the latest Android APK for QR-code download / install."""
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter(prefix="/api/app", tags=["app"])

APK_DIR = Path(__file__).parent.parent / "data" / "apk"


def _latest_apk() -> Optional[Path]:
    if not APK_DIR.exists():
        return None
    apks = sorted(APK_DIR.glob("*.apk"), key=lambda p: p.stat().st_mtime, reverse=True)
    return apks[0] if apks else None


class AppInfo(BaseModel):
    available: bool
    version: Optional[str] = None
    filename: Optional[str] = None
    size: Optional[int] = None


@router.get("/latest", response_model=AppInfo)
async def latest_app():
    apk = _latest_apk()
    if apk is None:
        return AppInfo(available=False)
    m = re.search(r"SmartAgent-(.+)\.apk", apk.name)
    return AppInfo(
        available=True,
        version=m.group(1) if m else None,
        filename=apk.name,
        size=apk.stat().st_size,
    )


@router.get("/download")
async def download_app():
    apk = _latest_apk()
    if apk is None:
        raise HTTPException(status_code=404, detail="No APK available — build the app first")
    return FileResponse(
        path=str(apk),
        media_type="application/vnd.android.package-archive",
        filename=apk.name,
    )
