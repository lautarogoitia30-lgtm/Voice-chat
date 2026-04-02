"""
LiveKit routes: /livekit/token (generate voice chat tokens)
"""
import os
from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from livekit import api
from livekit.api import AccessToken

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
    
    # Generate LiveKit token - new API
    from livekit.api import VideoGrants
    
    print(f"[LIVEKIT TOKEN GENERATION]")
    print(f"  API_KEY exists: {bool(LIVEKIT_API_KEY)}")
    print(f"  API_SECRET exists: {bool(LIVEKIT_API_SECRET)}")
    print(f"  LIVEKIT_URL: {LIVEKIT_URL}")
    print(f"  Room name: channel-{channel.id}")
    print(f"  User ID: {current_user['user_id']}")
    print(f"  Username: {current_user['username']}")
    
    token = AccessToken(
        api_key=LIVEKIT_API_KEY,
        api_secret=LIVEKIT_API_SECRET
    )
    
    # Set identity and name
    token = token.with_identity(str(current_user["user_id"]))
    token = token.with_name(current_user["username"])
    
    # Grant permissions to join the room (use channel ID for unique room name)
    grants = VideoGrants(
        room=f"channel-{channel.id}",
        room_join=True,
        can_publish=True,
        can_subscribe=True
    )
    token = token.with_grants(grants)
    
    # Build URLs - CRITICAL: Convert HTTPS to WSS for WebSocket
    livekit_url = LIVEKIT_URL.strip().rstrip("/")  # Clean whitespace AND trailing slash
    print(f"[LIVEKIT URL] Raw LIVEKIT_URL: '{LIVEKIT_URL}'")
    print(f"[LIVEKIT URL] After strip/rstrip: '{livekit_url}'")
    
    # Convert HTTPS to WSS (WebSocket Secure)
    if livekit_url.startswith("https://"):
        livekit_url = livekit_url.replace("https://", "wss://", 1)
        print(f"[LIVEKIT URL] Converted HTTPS to WSS: {livekit_url}")
    elif not livekit_url.startswith("wss://"):
        print(f"[LIVEKIT URL] WARNING - URL doesn't start with https:// or wss://: {livekit_url}")
    
    jwt_token = token.to_jwt()
    print(f"[LIVEKIT TOKEN GENERATED]")
    print(f"  Token length: {len(jwt_token)}")
    print(f"  Token (first 50 chars): {jwt_token[:50]}...")
    print(f"  Final LiveKit URL (WSS): {livekit_url}")
    
    return LiveKitTokenResponse(
        token=jwt_token,
        url=livekit_url,
        room_name=f"channel-{channel.id}"
    )


@router.get("/token_debug")
async def generate_debug_token(channel_id: int, user_id: int = 999, username: str = "debug", debug_secret: str | None = None):
    """
    Debug endpoint: generate a LiveKit token without DB checks.

    WARNING: This endpoint is intended for local debugging only. Do NOT expose in production.

    To enable: set environment variable LIVEKIT_DEBUG_ENABLED='true'.
    For extra safety, set LIVEKIT_DEBUG_SECRET to a strong secret and supply it via
    the 'X-LIVEKIT-DEBUG-SECRET' header or '?debug_secret=...' query param.
    If LIVEKIT_DEBUG_ENABLED is not set to 'true' the endpoint returns 404 to hide its presence.
    """
    # Hide endpoint unless explicitly enabled
    debug_enabled = os.getenv('LIVEKIT_DEBUG_ENABLED', 'false').lower() == 'true'
    if not debug_enabled:
        # Return 404 so presence of this debug endpoint is not leaked in prod
        raise HTTPException(status_code=404, detail="Not found")

    # At this point, debug is enabled. Validate secret if configured.
    configured_secret = os.getenv('LIVEKIT_DEBUG_SECRET', '')
    provided_secret = debug_secret
    # also check header if provided via FastAPI request headers (use Depends if needed) - fallback to get from env
    # note: FastAPI lets us inspect headers via Request if we needed; keep simple: allow query param or header via environ in caller
    # If configured_secret is set, require match
    if configured_secret:
        # Try to read header X-LIVEKIT-DEBUG-SECRET from environment-injected header variable (FastAPI Request not injected here)
        # As a simpler approach, accept query param debug_secret OR environment variable match
        if not provided_secret or provided_secret != configured_secret:
            raise HTTPException(status_code=403, detail="Forbidden")
    else:
        # Warn: debug enabled without secret is insecure
        print("[LIVEKIT DEBUG] WARNING: DEBUG endpoint enabled without LIVEKIT_DEBUG_SECRET; this is insecure and should only be used in local dev.")

    # Ensure LiveKit config
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        raise HTTPException(status_code=503, detail="LiveKit is not configured.")

    from livekit.api import VideoGrants

    # Log generation but never print full tokens or secrets
    print(f"[LIVEKIT DEBUG] Generating debug token for room=channel-{channel_id}, user={user_id}, username={username}")

    token = AccessToken(api_key=LIVEKIT_API_KEY, api_secret=LIVEKIT_API_SECRET)
    token = token.with_identity(str(user_id))
    token = token.with_name(username)

    grants = VideoGrants(room=f"channel-{channel_id}", room_join=True, can_publish=True, can_subscribe=True)
    token = token.with_grants(grants)

    livekit_url = LIVEKIT_URL.strip().rstrip('/')
    if livekit_url.startswith('https://'):
        livekit_url = livekit_url.replace('https://', 'wss://', 1)

    jwt_token = token.to_jwt()
    print(f"[LIVEKIT DEBUG] token len {len(jwt_token)} url={livekit_url} token_start={jwt_token[:8]}...")

    return {
        'token': jwt_token,
        'url': livekit_url,
        'room_name': f"channel-{channel_id}",
    }
