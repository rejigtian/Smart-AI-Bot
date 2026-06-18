"""Expose the server's LAN IP so the web UI can default QR / pairing addresses
to a phone-reachable internal address (localhost is useless to a real phone)."""
import os
import socket

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/server", tags=["server"])


def _lan_ip() -> str:
    """Best-effort primary LAN IPv4 (picks the outbound interface; sends nothing)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


class ServerInfo(BaseModel):
    lan_ip: str
    port: int  # the backend's own listening port — phones must reach THIS, not
               # the Vite dev-proxy port the browser happens to be on.


def _backend_port(request: Request) -> int:
    """The backend's real listening port.

    Detected from the ASGI server scope (the socket uvicorn bound), so it's
    correct even when the request arrives via the Vite dev proxy. Falls back to
    the BACKEND_PORT env var, then 8000.
    """
    server = request.scope.get("server")
    if server and len(server) >= 2 and server[1]:
        return int(server[1])
    return int(os.environ.get("BACKEND_PORT", "8000"))


@router.get("/info", response_model=ServerInfo)
async def server_info(request: Request):
    return ServerInfo(lan_ip=_lan_ip(), port=_backend_port(request))
