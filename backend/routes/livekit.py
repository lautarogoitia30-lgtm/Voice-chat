"""
LiveKit routes: /livekit/token (generate voice chat tokens)
Generates JWT tokens manually with correct LiveKit format.
"""
import os
import time
import logging
import httpx
from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from jose import jwt

from backend.database import get_db
from backend.models import Channel, GroupMember
from backend.schemas import LiveKitTokenRequest, LiveKitTokenResponse
from backend.auth import get_current_user

# Configure logging to show in Render logs
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("livekit")

router = APIRouter()


# LiveKit configuration from environment
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")


async def ensure_room_exists(room_name: str) -> None:
    """Create room in LiveKit if it doesn't exist using the SDK"""
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        logger.info("[LIVEKIT] Not configured, skipping room creation")
        return
    
    logger.info(f"[LIVEKIT] Ensuring room exists: {room_name}")
    
    try:
        # LiveKit 1.x - no need to import api module, just use httpx directly
        import livekit
        logger.info(f"[LIVEKIT] LiveKit version: {livekit.__version__}")
        
        # Convert wss:// to https:// for REST API
        api_url = LIVEKIT_URL.replace("wss://", "https://").rstrip("/")
        logger.info(f"[LIVEKIT] API URL: {api_url}")
        
        # Create service token for admin operations
        import time
        import jwt as jwt_encoder
        
        now = int(time.time())
        service_claims = {
            "iss": LIVEKIT_API_KEY,
            "sub": "service",
            "exp": now + 60,
            "nbf": now,
            "jti": f"service-{now}",
        }
        service_token = jwt_encoder.encode(service_claims, LIVEKIT_API_SECRET, algorithm="HS256")
        logger.info(f"[LIVEKIT] Service token created")
        
        # Use LiveKit REST API to create room
        async with httpx.AsyncClient() as client:
            logger.info(f"[LIVEKIT] Calling {api_url}/v1/rooms")
            response = await client.post(
                f"{api_url}/v1/rooms",
                json={"name": room_name},
                headers={
                    "Authorization": f"Bearer {service_token}",
                    "Content-Type": "application/json",
                },
                timeout=10.0,
            )
            if response.status_code in (200, 201):
                logger.info(f"[LIVEKIT] Room created: {room_name}")
            elif response.status_code == 409:
                logger.info(f"[LIVEKIT] Room already exists: {room_name}")
            else:
                logger.info(f"[LIVEKIT] Room creation response: {response.status_code} - {response.text}")
    except Exception as e:
        import traceback
        logger.error(f"[LIVEKIT] Room creation error: {e}")
        logger.error(f"[LIVEKIT] Traceback: {traceback.format_exc()}")


def generate_livekit_jwt(api_key: str, api_secret: str, identity: str, name: str, room: str) -> str:
    """
    Generate a LiveKit JWT token manually using jose library.
    This avoids dependency on LiveKit SDK version issues.
    """
    import time
    import jwt as jwt_encoder
    
    logger.info(f"[LIVEKIT] Generating JWT manually for identity={identity}, room={room}")
    
    # Current time
    now = int(time.time())
    
    # Token validity: 1 hour
    exp = now + 3600
    
    # Build the JWT claims according to LiveKit format
    claims = {
        # Issuer - must match API key
        "iss": api_key,
        # Subject (identity) - the user identifier
        "sub": identity,
        # Not valid before
        "nbf": now,
        # Expiration time
        "exp": exp,
        # JWT ID - unique identifier
        "jti": f"token-{now}-{identity}",
        # Video/Audio grants
        "video": {
            "room": room,
            "join": True,
            "publish": True,
            "subscribe": True,
        },
        # Name (optional)
        "name": name,
    }
    
    # Generate the JWT
    jwt_token = jwt_encoder.encode(claims, api_secret, algorithm="HS256")
    logger.info(f"[LIVEKIT] Generated token (first 80 chars): {jwt_token[:80]}...")
    
    return jwt_token


@router.post("/token", response_model=LiveKitTokenResponse)
async def generate_token(
    token_request: LiveKitTokenRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a LiveKit token for voice chat.
    """
    # Debug: log the environment
    logger.info(f"[TOKEN] LIVEKIT_URL: {LIVEKIT_URL[:20]}..." if LIVEKIT_URL else "[TOKEN] LIVEKIT_URL: NOT SET")
    logger.info(f"[TOKEN] LIVEKIT_API_KEY: {LIVEKIT_API_KEY[:10]}..." if LIVEKIT_API_KEY else "[TOKEN] LIVEKIT_API_KEY: NOT SET")
    
    # Check if LiveKit is configured
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        logger.info("[TOKEN] ERROR: LiveKit not configured!")
        raise HTTPException(
            status_code=503,
            detail="LiveKit is not configured. Please set LIVEKIT_* environment variables."
        )
    
    # Get channel
    result = await db.execute(
        select(Channel).where(Channel.id == token_request.channel_id)
    )
    channel = result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    
    # Check if channel is a voice channel
    if channel.type.value != "voice":
        raise HTTPException(status_code=400, detail="This is not a voice channel")
    
    # Check membership
    result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == channel.group_id,
                GroupMember.user_id == current_user["user_id"]
            )
        )
    )
    membership = result.scalar_one_or_none()
    
    if not membership:
        raise HTTPException(status_code=403, detail="You are not a member of this channel")
    
    # Generate the token manually
    room_name = f"channel-{channel.id}"
    
    # Note: Room auto-creation is disabled - LiveKit creates rooms on-demand
    # await ensure_room_exists(room_name)
    
    # Debug: show what we're using for identity
    logger.info(f"[TOKEN] user_id: {current_user['user_id']}, username: {current_user['username']}")
    
    jwt_token = generate_livekit_jwt(
        api_key=LIVEKIT_API_KEY,
        api_secret=LIVEKIT_API_SECRET,
        identity=current_user["username"],
        name=current_user["username"],
        room=room_name
    )
    
    # Build WebSocket URL
    livekit_url = LIVEKIT_URL.strip().rstrip("/")
    if livekit_url.startswith("https://"):
        livekit_url = livekit_url.replace("https://", "wss://", 1)
    
    return LiveKitTokenResponse(
            token=jwt_token,
            url=livekit_url,
            room_name=room_name
        )


@router.get("/test")
async def test_endpoint():
    """Simple test endpoint that doesn't call LiveKit"""
    logger.info("[TEST] test_endpoint called!")
    return {"status": "ok", "message": "This is a test"}


@router.get("/env_debug")
async def debug_env():
    """Debug endpoint to check environment variables"""
    logger.info("[ENV_DEBUG] called")
    return {
        "LIVEKIT_URL": "SET" if LIVEKIT_URL else "NOT SET",
        "LIVEKIT_URL_value": LIVEKIT_URL[:30] + "..." if LIVEKIT_URL else None,
        "LIVEKIT_API_KEY": "SET" if LIVEKIT_API_KEY else "NOT SET",
        "LIVEKIT_API_KEY_value": LIVEKIT_API_KEY[:10] + "..." if LIVEKIT_API_KEY else None,
        "LIVEKIT_API_SECRET": "SET" if LIVEKIT_API_SECRET else "NOT SET",
    }


@router.get("/token_debug")
async def generate_debug_token(channel_id: int, user_id: int = 999, username: str = "debug", debug_secret: str | None = None):
    """
    Debug endpoint: generate a LiveKit token without DB checks.
    """
    # Check debug secret
    configured_secret = os.getenv('LIVEKIT_DEBUG_SECRET', '')
    if configured_secret and debug_secret != configured_secret:
        raise HTTPException(status_code=403, detail="Invalid debug secret")
    
    # Check if LiveKit is configured
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        raise HTTPException(status_code=503, detail="LiveKit is not configured")
    
    # Generate token
    room_name = f"channel-{channel_id}"
    
    # Ensure room exists before generating token
    await ensure_room_exists(room_name)
    
    jwt_token = generate_livekit_jwt(
        api_key=LIVEKIT_API_KEY,
        api_secret=LIVEKIT_API_SECRET,
        identity=str(user_id),
        name=username,
        room=room_name
    )
    
    # Build WebSocket URL
    livekit_url = LIVEKIT_URL.strip().rstrip("/")
    if livekit_url.startswith("https://"):
        livekit_url = livekit_url.replace("https://", "wss://", 1)
    
    return LiveKitTokenResponse(
        token=jwt_token,
        url=livekit_url,
        room_name=room_name
    )