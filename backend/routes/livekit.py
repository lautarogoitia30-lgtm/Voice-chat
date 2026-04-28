"""
LiveKit routes: /livekit/token (generate voice chat tokens)
Generates JWT tokens manually without livekit package.
"""
import os
import time
from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from jose import jwt

from backend.database import get_db
from backend.models import Channel, GroupMember
from backend.schemas import LiveKitTokenRequest, LiveKitTokenResponse
from backend.auth import get_current_user

router = APIRouter()


# LiveKit configuration from environment
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")


def generate_livekit_jwt(api_key: str, api_secret: str, identity: str, name: str, room: str) -> str:
    """
    Generate a LiveKit JWT token manually.
    
    This is a simplified implementation that creates the same token structure
    that LiveKit's AccessToken would generate.
    """
    # Build the JWT payload (LiveKit token format)
    now = int(time.time())
    
    claims = {
        # Standard JWT claims
        "iss": api_key,
        "sub": identity,
        "name": name,
        "iat": now,
        "exp": now + 3600,  # 1 hour expiration
        "nbf": now,
        
        # LiveKit-specific claims
        "jti": f"{identity}-{now}",  # unique token ID
        "video": {
            "room": room,
            "room_join": True,
            "can_publish": True,
            "can_subscribe": True,
        }
    }
    
    # Sign with HS256
    return jwt.encode(claims, api_secret, algorithm="HS256")


@router.post("/token", response_model=LiveKitTokenResponse)
async def generate_token(
    token_request: LiveKitTokenRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a LiveKit token for voice chat.
    """
    # Check if LiveKit is configured
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
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
    jwt_token = generate_livekit_jwt(
        api_key=LIVEKIT_API_KEY,
        api_secret=LIVEKIT_API_SECRET,
        identity=str(current_user["user_id"]),
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


@router.get("/token_debug")
async def generate_debug_token(channel_id: int, user_id: int = 999, username: str = "debug", debug_secret: str | None = None):
    """
    Debug endpoint: generate a LiveKit token without DB checks.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Check debug secret
    configured_secret = os.getenv('LIVEKIT_DEBUG_SECRET', '')
    if configured_secret and debug_secret != configured_secret:
        raise HTTPException(status_code=403, detail="Invalid debug secret")
    
    # Check if LiveKit is configured
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        raise HTTPException(status_code=503, detail="LiveKit is not configured")
    
    # Debug: show what we're reading
    logger.info(f"DEBUG LIVEKIT_API_KEY: {LIVEKIT_API_KEY}")
    logger.info(f"DEBUG LIVEKIT_API_KEY starts with: {LIVEKIT_API_KEY[:8] if LIVEKIT_API_KEY else 'EMPTY'}")
    logger.info(f"DEBUG LIVEKIT_URL: {LIVEKIT_URL}")
    
    # Generate token
    room_name = f"channel-{channel_id}"
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