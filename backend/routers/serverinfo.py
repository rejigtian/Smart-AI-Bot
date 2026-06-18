"""Expose the server's LAN IP so the web UI can default QR / pairing addresses
to a phone-reachable internal address (localhost is useless to a real phone)."""
import socket

from fastapi import APIRouter
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


@router.get("/info", response_model=ServerInfo)
async def server_info():
    return ServerInfo(lan_ip=_lan_ip())
