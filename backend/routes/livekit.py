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
    """Create room in LiveKit if it doesn't exist using REST API"""
    if not LIVEKIT_URL or not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        return
    
    # Convert wss:// to https://
    api_url = LIVEKIT_URL.replace("wss://", "https://").rstrip("/")
    
    async with httpx.AsyncClient() as client:
        # Try to create room
        try:
            response = await client.post(
                f"{api_url}/v1/rooms",
                json={"name": room_name},
                headers={
                    "Authorization": f"Bearer {LIVEKIT_API_SECRET}",
                    "Content-Type": "application/json",
                },
                timeout=5.0,
            )
            if response.status_code in (200, 201):
                print(f"[LIVEKIT] Room created: {room_name}")
            elif response.status_code == 409:
                print(f"[LIVEKIT] Room already exists: {room_name}")
            else:
                print(f"[LIVEKIT] Room creation response: {response.status_code}")
        except Exception as e:
            print(f"[LIVEKIT] Room creation error: {e}")


def generate_livekit_jwt(api_key: str, api_secret: str, identity: str, name: str, room: str) -> str:
    """
    Generate a LiveKit JWT token.
    Uses the LiveKit SDK if available, otherwise manual JWT generation.
    
    Also creates the room if it doesn't exist.
    """
    # Try to create the room first (rooms must exist before joining)
    try:
        from livekit import api
        import asyncio
        
        async def ensure_room():
            try:
                # Connect to LiveKit API
                lkapi = api.LiveKitAPI(
                    url=LIVEKIT_URL.replace("wss://", "https://").rstrip("/"),
                    api_key=api_key,
                    api_secret=api_secret,
                )
                # Try to create room (ignores error if already exists)
                try:
                    await lkapi.room.create_room(api.CreateRoomRequest(name=room))
                    print(f"[LIVEKIT] Created room: {room}")
                except Exception as e:
                    if "already exists" not in str(e).lower():
                        print(f"[LIVEKIT] Room creation note: {e}")
                await lkapi.aclose()
            except Exception as e:
                print(f"[LIVEKIT] Could not ensure room: {e}")
        
        # Run in new event loop
        try:
            asyncio.run(ensure_room())
        except RuntimeError:
            # If already in event loop, try sync way
            pass
    except Exception as e:
        print(f"[LIVEKIT] Room setup error: {e}")
    
    try:
        from livekit import api
    except ImportError:
        # Fallback: manual JWT generation with correct format
        import time
        from jose import jwt
        
        now = int(time.time())
        
        claims = {
            "iss": api_key,
            "sub": identity,
            "name": name,
            "iat": now,
            "exp": now + 3600,
            "nbf": now,
            "jti": f"{identity}-{now}",
            "video": {
                "room": room,
                "room_join": True,
                "can_publish": True,
                "can_subscribe": True,
            }
        }
        
        return jwt.encode(claims, api_secret, algorithm="HS256")
        
        claims = {
            "iss": api_key,
            "sub": identity,
            "name": name,
            "iat": now,
            "exp": now + 3600,
            "nbf": now,
            "jti": f"{identity}-{now}",
            "video": {
                "room": room,
                "room_join": True,
                "can_publish": True,
                "can_subscribe": True,
            }
        }
        
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
    
    # Ensure room exists before generating token
    await ensure_room_exists(room_name)
    
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