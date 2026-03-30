"""
FastAPI application entry point.
Configures CORS, routes, and database initialization.
"""
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.database import init_db, close_db
from backend.routes import auth, groups, channels, livekit, users, files
from backend.websocket import websocket_endpoint

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

# Configure CORS - allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files (JS, CSS)
app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")
app.mount("/css", StaticFiles(directory=str(FRONTEND_DIR / "css")), name="css")

# Serve uploaded files (avatars)
UPLOADS_DIR = BASE_DIR / "uploads"
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR), html=True), name="uploads")

# Include routers
app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(users.router, prefix="/users", tags=["Users"])
app.include_router(groups.router, prefix="/groups", tags=["Groups"])
app.include_router(channels.router, prefix="/channels", tags=["Channels"])
app.include_router(livekit.router, prefix="/livekit", tags=["LiveKit"])
app.include_router(files.router, prefix="/files", tags=["Files"])

# Serve frontend index.html
FRONTEND_PATH = Path(__file__).parent.parent / "frontend" / "index.html"


@app.get("/")
async def root():
    """Serve the frontend index.html."""
    return FileResponse(FRONTEND_PATH)


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}


# WebSocket endpoint for text chat (with JWT auth - OPTIONAL for now)
@app.websocket("/ws/chat/{channel_id}")
async def chat_websocket(websocket: WebSocket, channel_id: int, token: str = ""):
    """WebSocket endpoint for real-time text chat with JWT auth (optional for now)."""
    # Try to validate token if provided
    user_data = None
    if token and token != "null" and token != "undefined":
        try:
            # Verify JWT token
            from backend.auth import verify_jwt_token
            user_data = verify_jwt_token(token)
            print(f"WebSocket auth: User {user_data['username']} (ID: {user_data['user_id']}) connecting to channel {channel_id}")
        except Exception as e:
            print(f"WebSocket auth failed (continuing anyway): {e}")
            # Continue without auth for now
    
    # Pass user_data to the endpoint
    await websocket_endpoint(websocket, channel_id, user_data)
