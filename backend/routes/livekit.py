"""
LiveKit routes: /livekit/token (generate voice chat tokens)
"""
import os
from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from livekit import api

from backend.database import get_db
from backend.models import Channel, GroupMember
from backend.schemas import LiveKitTokenRequest, LiveKitTokenResponse
from backend.auth import get_current_user

router = APIRouter()


# LiveKit configuration from environment
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")


@router.post("/token", response_model=LiveKitTokenResponse)
async def generate_token(
    token_request: LiveKitTokenRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a LiveKit token for voice chat.
    
    Args:
        token_request: Channel ID to join
        current_user: Authenticated user from JWT
        db: Database session
        
    Returns:
        LiveKit token and URL
        
    Raises:
        HTTPException: If channel not found, user not a member, or LiveKit not configured
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
    
    # Generate LiveKit token
    token = api.AccessToken(
        api_key=LIVEKIT_API_KEY,
        api_secret=LIVEKIT_API_SECRET
    )
    
    # Set identity and name
    token = token.with_identity(str(current_user["user_id"]))
    token = token.with_name(current_user["username"])
    
    # Grant permissions to join the room
    grants = api.VideoGrants(
        room=f"channel-{channel.id}",
        room_join=True,
        can_publish=True,
        can_subscribe=True
    )
    token = token.with_grants(grants)
    
    # Build URLs - Convert HTTPS to WSS for WebSocket
    livekit_url = LIVEKIT_URL.strip().rstrip("/")
    if livekit_url.startswith("https://"):
        livekit_url = livekit_url.replace("https://", "wss://", 1)
    
    jwt_token = token.to_jwt()
    
    return LiveKitTokenResponse(
        token=jwt_token,
        url=livekit_url,
        room_name=f"channel-{channel.id}"
    )


@router.get("/token_debug")
async def generate_debug_token(channel_id: int, user_id: int = 999, username: str = "debug", debug_secret: str | None = None):
    """
    Debug endpoint: generate a LiveKit token without DB checks.
    For development only - should be disabled in production.
    """
    # Check debug secret
    configured_secret = os.getenv('LIVEKIT_DEBUG_SECRET', '')
    if configured_secret and debug_secret != configured_secret:
        raise HTTPException(status_code=403, detail="Invalid debug secret")
    
    # Check if LiveKit is configured
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        raise HTTPException(
            status_code=503,
            detail="LiveKit is not configured"
        )
    
    # Generate token
    token = api.AccessToken(
        api_key=LIVEKIT_API_KEY,
        api_secret=LIVEKIT_API_SECRET
    )
    
    # Set identity and name
    token = token.with_identity(str(user_id))
    token = token.with_name(username)
    
    # Grant permissions to join the room
    grants = api.VideoGrants(
        room=f"channel-{channel_id}",
        room_join=True,
        can_publish=True,
        can_subscribe=True
    )
    token = token.with_grants(grants)
    
    # Build URLs - Convert HTTPS to WSS
    livekit_url = LIVEKIT_URL.strip().rstrip("/")
    if livekit_url.startswith("https://"):
        livekit_url = livekit_url.replace("https://", "wss://", 1)
    
    jwt_token = token.to_jwt()
    
    return LiveKitTokenResponse(
        token=jwt_token,
        url=livekit_url,
        room_name=f"channel-{channel_id}"
    )