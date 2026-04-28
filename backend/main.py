"""
FastAPI application entry point.
Configures CORS, routes, and database initialization.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file (but don't override Railway's variables)
load_dotenv(override=False)

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.database import init_db, close_db
from backend.routes import auth, groups, channels, livekit, users, files, dm
from backend.websocket import websocket_endpoint, dm_websocket_endpoint, dm_notification_websocket_endpoint

# Paths
BASE_DIR = Path(__file__).parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager for startup and shutdown events.
    """
    # Startup
    await init_db()
    yield
    # Shutdown
    await close_db()


# Create FastAPI app
app = FastAPI(
    title="Voice-Chat API",
    description="Backend API for Voice-Chat application (Discord clone)",
    version="1.0.0",
    lifespan=lifespan,
)

# Configure CORS - allow all origins for desktop app compatibility
# In production, you might want to restrict this more
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files (JS, CSS, Images)
app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")
app.mount("/css", StaticFiles(directory=str(FRONTEND_DIR / "css")), name="css")
app.mount("/images", StaticFiles(directory=str(FRONTEND_DIR / "images")), name="images")

# Serve uploaded files (avatars and files)
UPLOADS_DIR = BASE_DIR / "uploads"
# Create uploads directories if they don't exist
AVATARS_DIR = UPLOADS_DIR / "avatars"
FILES_DIR = UPLOADS_DIR / "files"
UPLOADS_DIR.mkdir(exist_ok=True)
AVATARS_DIR.mkdir(exist_ok=True)
FILES_DIR.mkdir(exist_ok=True)

app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR), html=True), name="uploads")

# Include routers
app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(users.router, prefix="/users", tags=["Users"])
app.include_router(groups.router, prefix="/groups", tags=["Groups"])
app.include_router(channels.router, prefix="", tags=["Channels"])
app.include_router(livekit.router, prefix="/livekit", tags=["LiveKit"])
app.include_router(files.router, prefix="/files", tags=["Files"])
app.include_router(dm.router, prefix="/dm", tags=["Direct Messages"])

# Serve frontend index.html (only if it exists)
FRONTEND_PATH = BASE_DIR / "frontend" / "index.html"


@app.get("/")
async def root():
    """Serve the frontend index.html if available, otherwise API info."""
    if FRONTEND_PATH.exists():
        return FileResponse(FRONTEND_PATH)
    return {
        "name": "Voice-Chat API",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs"
    }


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


# WebSocket endpoint for text chat (REQUIRED JWT auth)
@app.websocket("/ws/chat/{channel_id}")
async def chat_websocket(websocket: WebSocket, channel_id: int, token: str = ""):
    """WebSocket endpoint for real-time text chat with JWT auth required."""
    # Validate JWT token - REQUIRED for WebSocket connections
    if not token or token == "null" or token == "undefined":
        await websocket.close(code=4001, reason="Authentication required")
        return
    
    user_data = None
    try:
        # Verify JWT token
        from backend.auth import verify_jwt_token
        user_data = verify_jwt_token(token)
        print(f"WebSocket auth: User {user_data['username']} (ID: {user_data['user_id']}) connecting to channel {channel_id}")
    except Exception as e:
        print(f"WebSocket auth failed: {e}")
        await websocket.close(code=4001, reason="Invalid token")
        return
    
    # Pass user_data to the endpoint
    await websocket_endpoint(websocket, channel_id, user_data)


# WebSocket endpoint for DMs (REQUIRED JWT auth)
@app.websocket("/ws/dm/{conversation_id}")
async def dm_websocket(websocket: WebSocket, conversation_id: int, token: str = ""):
    """WebSocket endpoint for real-time DM chat with JWT auth required."""
    if not token or token == "null" or token == "undefined":
        await websocket.close(code=4001, reason="Authentication required")
        return
    
    user_data = None
    try:
        from backend.auth import verify_jwt_token
        user_data = verify_jwt_token(token)
        print(f"DM WebSocket auth: User {user_data['username']} (ID: {user_data['user_id']}) connecting to conversation {conversation_id}")
    except Exception as e:
        print(f"DM WebSocket auth failed: {e}")
        await websocket.close(code=4001, reason="Invalid token")
        return
    
    # Pass user_data to the DM endpoint
    await dm_websocket_endpoint(websocket, conversation_id, user_data)


# WebSocket endpoint for DM notifications (global per-user)
@app.websocket("/ws/dm-notifications")
async def dm_notifications_websocket(websocket: WebSocket, token: str = ""):
    """WebSocket endpoint for DM notifications — notifies user about new messages in any conversation."""
    if not token or token == "null" or token == "undefined":
        await websocket.close(code=4001, reason="Authentication required")
        return
    
    user_data = None
    try:
        from backend.auth import verify_jwt_token
        user_data = verify_jwt_token(token)
        print(f"DM Notifications WS: User {user_data['username']} (ID: {user_data['user_id']}) connected")
    except Exception as e:
        print(f"DM Notifications WS auth failed: {e}")
        await websocket.close(code=4001, reason="Invalid token")
        return
    
    await dm_notification_websocket_endpoint(websocket, user_data)
