"""Records a run's device screen via ADB screenrecord (local devices only).

We record ON-DEVICE mp4 segments (`adb shell screenrecord <file>`) rather than
streaming raw H.264 to stdout: the on-device encoder/muxer writes correct frame
timestamps, so playback runs at real-time speed (a raw elementary stream has no
timestamps, which made replay play slow). screenrecord caps at ~3 min/segment,
so we chain segments and concat them with ffmpeg when the run ends.

Remote devices (no local ADB) are skipped — the per-step screenshot replay
covers those."""
import asyncio
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)

REC_DIR = Path(__file__).parent.parent / "data" / "recordings"


def _adb_path() -> Optional[str]:
    found = shutil.which("adb")
    if found:
        return found
    fallback = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
    return fallback if os.path.exists(fallback) else None


def _single_adb_serial() -> Optional[str]:
    """Return the serial only when exactly one device is attached (unambiguous)."""
    adb = _adb_path()
    if not adb:
        return None
    try:
        out = subprocess.run([adb, "devices"], capture_output=True, text=True, timeout=5).stdout
    except Exception:
        return None
    serials = [l.split()[0] for l in out.splitlines()[1:] if len(l.split()) >= 2 and l.split()[1] == "device"]
    return serials[0] if len(serials) == 1 else None


def recording_path(run_id: str) -> Path:
    return REC_DIR / f"{run_id}.mp4"


def has_recording(run_id: str) -> bool:
    p = recording_path(run_id)
    return p.exists() and p.stat().st_size > 0


async def _run(*args: str, timeout: Optional[float] = None) -> None:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    try:
        await asyncio.wait_for(proc.wait(), timeout=timeout)
    except Exception:
        if proc.returncode is None:
            proc.kill()


class RunRecorder:
    def __init__(self, run_id: str):
        self.run_id = run_id
        self.serial: Optional[str] = None
        self._task: Optional[asyncio.Task] = None
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._stop = asyncio.Event()
        self._device_files: List[str] = []

    async def start(self) -> bool:
        self.serial = _single_adb_serial()
        if not self.serial:
            return False
        REC_DIR.mkdir(parents=True, exist_ok=True)
        self._task = asyncio.create_task(self._loop())
        logger.info("[rec:%s] recording via adb %s", self.run_id, self.serial)
        return True

    async def _loop(self) -> None:
        adb = _adb_path()
        n = 0
        while not self._stop.is_set():
            devfile = f"/sdcard/smartrec_{self.run_id}_{n}.mp4"
            self._proc = await asyncio.create_subprocess_exec(
                adb, "-s", self.serial, "shell", "screenrecord", "--time-limit", "180", devfile,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            await self._proc.wait()
            self._device_files.append(devfile)
            n += 1

    async def stop(self) -> None:
        if self._task is None:
            return
        self._stop.set()
        # SIGINT lets the on-device screenrecord finalize the current mp4 (write
        # the moov atom) so the last segment is playable.
        adb = _adb_path()
        await _run(adb, "-s", self.serial, "shell", "pkill", "-INT", "screenrecord", timeout=5)
        try:
            await asyncio.wait_for(self._task, timeout=15)
        except Exception:
            pass
        await self._finalize()

    async def _finalize(self) -> None:
        adb = _adb_path()
        local_segs: List[Path] = []
        for i, dev in enumerate(self._device_files):
            local = REC_DIR / f"{self.run_id}_seg{i}.mp4"
            await _run(adb, "-s", self.serial, "pull", dev, str(local), timeout=30)
            if local.exists() and local.stat().st_size > 0:
                local_segs.append(local)
            await _run(adb, "-s", self.serial, "shell", "rm", "-f", dev, timeout=10)

        if not local_segs:
            return
        mp4 = recording_path(self.run_id)
        try:
            if len(local_segs) == 1:
                local_segs[0].replace(mp4)
            else:
                listfile = REC_DIR / f"{self.run_id}_list.txt"
                listfile.write_text("".join(f"file '{s.name}'\n" for s in local_segs))
                await _run(
                    "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listfile),
                    "-c", "copy", "-movflags", "+faststart", str(mp4), timeout=120,
                )
                listfile.unlink(missing_ok=True)
                for s in local_segs:
                    s.unlink(missing_ok=True)
            logger.info("[rec:%s] saved %s", self.run_id, mp4.name)
        except Exception as e:
            logger.warning("[rec:%s] finalize failed: %s", self.run_id, e)
