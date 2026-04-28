"""
Local Server for VoiceSpace Desktop App
Runs on localhost without static file serving (desktop loads frontend locally)
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

load_dotenv()

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Import from backend
from backend.database import init_db, close_db
from backend.routes import auth, groups, channels, livekit, users, files, dm
from backend.websocket import websocket_endpoint, dm_websocket_endpoint, dm_notification_websocket_endpoint


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    await init_db()
    yield
    await close_db()


# Create FastAPI app
app = FastAPI(
    title="VoiceSpace API",
    description="Local API for VoiceSpace Desktop",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS - allow all for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers (no prefix for channels - routes already have /groups/{id}/channels)
app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(users.router, prefix="/users", tags=["Users"])
app.include_router(groups.router, prefix="/groups", tags=["Groups"])
app.include_router(channels.router, prefix="", tags=["Channels"])
app.include_router(livekit.router, prefix="/livekit", tags=["LiveKit"])
app.include_router(files.router, prefix="/files", tags=["Files"])
app.include_router(dm.router, prefix="/dm", tags=["DM"])

# WebSocket endpoints
app.websocket_route("/ws")(websocket_endpoint)
app.websocket_route("/ws/dm")(dm_websocket_endpoint)
app.websocket_route("/ws/notifications")(dm_notification_websocket_endpoint)


@app.get("/")
async def root():
    return {"message": "VoiceSpace API Local", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "3000"))
    print(f"🚀 Starting local server on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)