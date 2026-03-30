"""
Pydantic schemas for request/response validation.
These are the "contracts" between frontend and backend.
"""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime

from backend.models import ChannelType


# ==================== AUTH SCHEMAS ====================

class UserRegister(BaseModel):
    """Schema for user registration request."""
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=8)


class UserLogin(BaseModel):
    """Schema for user login request."""
    username: str
    password: str


class TokenResponse(BaseModel):
    """Schema for authentication token response."""
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str


class UserResponse(BaseModel):
    """Schema for user data in responses."""
    id: int
    username: str
    email: str
    avatar_url: str | None = None
    bio: str | None = None

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    """Schema for updating user profile."""
    username: str | None = None
    email: str | None = None
    bio: str | None = None
    avatar_url: str | None = None


# ==================== GROUP SCHEMAS ====================

class GroupCreate(BaseModel):
    """Schema for creating a new group."""
    name: str = Field(..., min_length=1, max_length=100)


class GroupResponse(BaseModel):
    """Schema for group data in responses."""
    id: int
    name: str
    owner_id: int

    class Config:
        from_attributes = True


class GroupDetailResponse(GroupResponse):
    """Schema for group details with member count."""
    member_count: int = 0
    channel_count: int = 0


# ==================== CHANNEL SCHEMAS ====================

class ChannelCreate(BaseModel):
    """Schema for creating a new channel."""
    name: str = Field(..., min_length=1, max_length=100)
    type: ChannelType = ChannelType.TEXT


class ChannelResponse(BaseModel):
    """Schema for channel data in responses."""
    id: int
    group_id: int
    name: str
    type: ChannelType

    class Config:
        from_attributes = True


# ==================== LIVEKIT SCHEMAS ====================

class LiveKitTokenRequest(BaseModel):
    """Schema for requesting a LiveKit token."""
    channel_id: int


class LiveKitTokenResponse(BaseModel):
    """Schema for LiveKit token response."""
    token: str
    url: str
    room_name: str


# ==================== MESSAGE SCHEMAS ====================

class ChatMessage(BaseModel):
    """Schema for chat messages via WebSocket."""
    channel_id: int
    sender_id: int
    sender_username: str
    content: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)