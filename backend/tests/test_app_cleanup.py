"""Regression coverage for post-run app cleanup semantics."""

import pytest

from agent.ws_device import WebSocketDevice
from core.test_runner import _force_stop_app_after_run


class FakeCleanupDevice:
    def __init__(self, foreground: str, result: str = "Force-stopped target.app"):
        self.foreground = foreground
        self.result = result
        self.stopped: list[str] = []

    async def current_package(self) -> str:
        return self.foreground

    async def stop_app(self, package: str) -> str:
        self.stopped.append(package)
        return self.result

    async def global_action(self, action: str):
        raise AssertionError("cleanup must not use a cosmetic HOME/RECENTS gesture")


def async_collector(messages: list[str]):
    async def collect(message: str):
        messages.append(message)
    return collect


@pytest.mark.asyncio
async def test_cleanup_prefers_configured_app_over_transient_foreground():
    device = FakeCleanupDevice("com.android.permissioncontroller")
    messages: list[str] = []
    await _force_stop_app_after_run(device, "target.app", async_collector(messages))
    assert device.stopped == ["target.app"]
    assert messages == ["🛑 Force-stopped target.app"]


@pytest.mark.asyncio
async def test_cleanup_uses_foreground_only_without_configured_package():
    device = FakeCleanupDevice("target.app")
    messages: list[str] = []
    await _force_stop_app_after_run(device, "", async_collector(messages))
    assert device.stopped == ["target.app"]


@pytest.mark.asyncio
async def test_websocket_stop_app_rejects_cosmetic_success(monkeypatch):
    device = WebSocketDevice("device-id")

    async def fake_rpc(method, params=None, timeout=30.0):
        assert method == "app/stop"
        return "Force-stopped target.app"

    async def still_foreground():
        return "target.app"

    monkeypatch.setattr(device, "_rpc", fake_rpc)
    monkeypatch.setattr(device, "current_package", still_foreground)

    with pytest.raises(RuntimeError, match="still foreground"):
        await device.stop_app("target.app")
