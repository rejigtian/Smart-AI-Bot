"""FastAPI application entry point for smart-androidbot."""
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import litellm

from db.database import init_db
from routers import appdist, devices, live, recorder, serverinfo, settings, testsuites, testruns
from ws.portal_ws import portal_websocket_endpoint

# Drop provider-unsupported params (e.g. vector_store_ids leaking into Anthropic)
litellm.drop_params = True

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("Database initialised")
    yield


app = FastAPI(title="smart-ai-bot", version="1.1.1", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# REST routers
app.include_router(devices.router)
app.include_router(testsuites.router)
app.include_router(testruns.router)
app.include_router(recorder.router)
app.include_router(settings.router)
app.include_router(appdist.router)
app.include_router(serverinfo.router)
app.include_router(live.router)

# Portal reverse WebSocket
app.add_api_websocket_route("/v1/providers/join", portal_websocket_endpoint)

# Live H.264 screen stream (ADB screenrecord) — under /v1 so the WS proxy applies
app.add_api_websocket_route("/v1/devices/{device_id}/live", live.stream_h264)

# Serve built frontend (production)
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="static")
else:
    @app.get("/")
    async def root():
        return {"status": "ok", "frontend": "not built — run: cd frontend && npm run build"}
