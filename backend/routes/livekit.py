"""
LiveKit routes: /livekit/token (generate voice chat tokens)
Generates JWT tokens manually with correct LiveKit format.
"""
import os
import time
import httpx
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


async def ensure_room_exists(room_name: str) -> None:
    """Create room in LiveKit if it doesn't exist using the SDK"""
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        print("[LIVEKIT] Not configured, skipping room creation")
        return
    
    print(f"[LIVEKIT] Ensuring room exists: {room_name}")
    
    try:
        from livekit import api
        from livekit.api import LiveKitAPI
        print("[LIVEKIT] LiveKit SDK imported successfully")
        
        # Convert wss:// to https:// for REST API
        api_url = LIVEKIT_URL.replace("wss://", "https://").rstrip("/")
        print(f"[LIVEKIT] API URL: {api_url}")
        
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
        print(f"[LIVEKIT] Service token created")
        
        # Use LiveKit REST API to create room
        async with httpx.AsyncClient() as client:
            print(f"[LIVEKIT] Calling {api_url}/v1/rooms")
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
                print(f"[LIVEKIT] Room created: {room_name}")
            elif response.status_code == 409:
                print(f"[LIVEKIT] Room already exists: {room_name}")
            else:
                print(f"[LIVEKIT] Room creation response: {response.status_code} - {response.text}")
    except Exception as e:
        import traceback
        print(f"[LIVEKIT] Room creation error: {e}")
        print(f"[LIVEKIT] Traceback: {traceback.format_exc()}")


def generate_livekit_jwt(api_key: str, api_secret: str, identity: str, name: str, room: str) -> str:
    """
    Generate a LiveKit JWT token.
    Uses the LiveKit SDK (AccessToken) to generate a valid token.
    """
    print(f"[LIVEKIT] generate_livekit_jwt called with api_key={api_key[:10]}..., identity={identity}, room={room}")
    try:
        from livekit import api
        from livekit.api import AccessToken, VideoGrants
        print(f"[LIVEKIT] Import successful")
    except Exception as e:
        print(f"[LIVEKIT] Import error: {e}")
        raise RuntimeError(f"Failed to import LiveKit SDK: {e}")
    
    try:
        # Create access token
        token = AccessToken(api_key, api_secret)
        
        # Set identity (required for room join)
        token.with_identity(identity)
        
        # Set name
        token.with_name(name)
        
        # Set video grants (permissions)
        grants = VideoGrants(
            room_join=True,
            room=room,
            can_publish=True,
            can_subscribe=True,
        )
        token.with_grants(grants)
        
        # Generate JWT
        jwt_token = token.to_jwt()
        print(f"[LIVEKIT] Generated token (first 80 chars): {jwt_token[:80]}...")
        return jwt_token
    except Exception as e:
        import traceback
        print(f"[LIVEKIT] Token generation error: {e}")
        print(f"[LIVEKIT] Traceback: {traceback.format_exc()}")
        raise


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
    print(f"[TOKEN] LIVEKIT_URL: {LIVEKIT_URL[:20]}..." if LIVEKIT_URL else "[TOKEN] LIVEKIT_URL: NOT SET")
    print(f"[TOKEN] LIVEKIT_API_KEY: {LIVEKIT_API_KEY[:10]}..." if LIVEKIT_API_KEY else "[TOKEN] LIVEKIT_API_KEY: NOT SET")
    
    # Check if LiveKit is configured
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        print("[TOKEN] ERROR: LiveKit not configured!")
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
    
    # Ensure room exists before generating token
    await ensure_room_exists(room_name)
    
    # Debug: show what we're using for identity
    print(f"[TOKEN] user_id: {current_user['user_id']}, username: {current_user['username']}")
    
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


@router.get("/env_debug")
async def debug_env():
    """Debug endpoint to check environment variables"""
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