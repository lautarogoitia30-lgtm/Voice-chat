"""
Channel routes: /channels, /groups/{id}/channels
"""
from fastapi import APIRouter, HTTPException, Depends, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete
from typing import List
from pydantic import BaseModel

from backend.database import get_db
from backend.models import Group, Channel, GroupMember, VoiceParticipant
from backend.schemas import ChannelCreate, ChannelResponse
from backend.auth import get_current_user
from backend.permissions import require_role, get_member_role
import time

router = APIRouter()


@router.get("/groups/{group_id}/channels", response_model=List[ChannelResponse])
async def list_channels(
    group_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    List all channels in a group.
    
    Args:
        group_id: Group ID
        current_user: Authenticated user from JWT
        db: Database session
        
    Returns:
        List of channels in the group
        
    Raises:
        HTTPException: If group not found or user is not a member
    """
    # Check if group exists and user is a member
    result = await db.execute(
        select(Group).where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check membership
    result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.user_id == current_user["user_id"]
            )
        )
    )
    membership = result.scalar_one_or_none()
    
    if not membership:
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    
    # Get channels
    result = await db.execute(
        select(Channel).where(Channel.group_id == group_id)
    )
    channels = result.scalars().all()
    
    return channels


@router.post("/groups/{group_id}/channels", response_model=ChannelResponse, status_code=status.HTTP_201_CREATED)
async def create_channel(
    group_id: int,
    channel_data: ChannelCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new channel in a group.
    
    Args:
        group_id: Group ID
        channel_data: Channel name and type
        current_user: Authenticated user from JWT
        db: Database session
        
    Returns:
        Created channel data
        
    Raises:
        HTTPException: If group not found or user is not the owner
    """
    # Check if group exists
    result = await db.execute(
        select(Group).where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check if user is owner or admin
    await require_role(db, group_id, current_user["user_id"], min_role="admin")
    
    # Create channel
    new_channel = Channel(
        group_id=group_id,
        name=channel_data.name,
        type=channel_data.type
    )
    
    db.add(new_channel)
    await db.commit()
    await db.refresh(new_channel)
    
    return new_channel


@router.get("/{channel_id}", response_model=ChannelResponse)
async def get_channel(
    channel_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get channel details.
    
    Args:
        channel_id: Channel ID
        current_user: Authenticated user from JWT
        db: Database session
        
    Returns:
        Channel data
        
    Raises:
        HTTPException: If channel not found or user is not a member of the group
    """
    # Get channel with group
    result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    
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
        raise HTTPException(status_code=403, detail="You are not a member of this group's channel")
    
    return channel


@router.post("/{channel_id}/voice/join")
async def join_voice_channel(
    channel_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Join a voice channel - registers user in the voice channel.
    
    Args:
        channel_id: Channel ID
        current_user: Authenticated user from JWT
        db: Database session
        
    Returns:
        Success message
        
    Raises:
        HTTPException: If channel not found or user is not a member
    """
    # Get channel
    result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    
    # Check it's a voice channel
    if channel.type != "voice":
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
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    
    # Check if already in voice
    result = await db.execute(
        select(VoiceParticipant).where(
            and_(
                VoiceParticipant.channel_id == channel_id,
                VoiceParticipant.user_id == current_user["user_id"]
            )
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        # Update joined_at to refresh the stale timer
        existing.joined_at = int(time.time())
        await db.commit()
        return {"message": "Already in voice channel"}
    
    # Add to voice participants
    voice_participant = VoiceParticipant(
        user_id=current_user["user_id"],
        channel_id=channel_id,
        joined_at=int(time.time())
    )
    
    db.add(voice_participant)
    await db.commit()
    
    return {"message": "Joined voice channel"}


@router.post("/{channel_id}/voice/leave")
async def leave_voice_channel(
    channel_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Leave a voice channel - removes user from voice participants.
    
    Args:
        channel_id: Channel ID
        current_user: Authenticated user from JWT
        db: Database session
        
    Returns:
        Success message
    """
    # Remove from voice participants
    result = await db.execute(
        select(VoiceParticipant).where(
            and_(
                VoiceParticipant.channel_id == channel_id,
                VoiceParticipant.user_id == current_user["user_id"]
            )
        )
    )
    participant = result.scalar_one_or_none()
    
    if participant:
        await db.delete(participant)
        await db.commit()
    
    return {"message": "Left voice channel"}


class VoiceParticipantResponse(BaseModel):
    """Response model for voice participant."""
    user_id: int
    username: str
    joined_at: int
    avatar_url: str | None = None


@router.get("/{channel_id}/voice/participants", response_model=List[VoiceParticipantResponse])
async def get_voice_participants(
    channel_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get all users in a voice channel.
    
    Args:
        channel_id: Channel ID
        current_user: Authenticated user from JWT
        db: Database session
        
    Returns:
        List of users in the voice channel
    """
    # Get channel
    result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    
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
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    
    # Auto-cleanup stale participants (joined more than 5 minutes ago)
    stale_threshold = int(time.time()) - 300  # 5 minutes
    await db.execute(
        delete(VoiceParticipant).where(
            and_(
                VoiceParticipant.channel_id == channel_id,
                VoiceParticipant.joined_at < stale_threshold
            )
        )
    )
    await db.commit()
    
    # Get voice participants
    from backend.models import User
    result = await db.execute(
        select(VoiceParticipant, User).join(
            User, VoiceParticipant.user_id == User.id
        ).where(VoiceParticipant.channel_id == channel_id)
    )
    rows = result.all()
    
    participants = []
    for participant, user in rows:
        participants.append(VoiceParticipantResponse(
            user_id=user.id,
            username=user.username,
            joined_at=participant.joined_at,
            avatar_url=user.avatar_url
        ))
    
    return participants


@router.put("/{channel_id}", response_model=dict)
async def update_channel(
    channel_id: int,
    channel_data: dict,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update a channel's name or type (only owner/admin can edit).
    """
    # Get channel
    result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    
    # Check if user is owner or admin
    await require_role(db, channel.group_id, current_user["user_id"], min_role="admin")
    
    # Update name if provided
    if "name" in channel_data and channel_data["name"]:
        channel.name = channel_data["name"]
    
    # Update type if provided
    if "type" in channel_data and channel_data["type"] in ["text", "voice"]:
        channel.type = channel_data["type"]
    
    await db.commit()
    await db.refresh(channel)
    
    return {"id": channel.id, "name": channel.name, "type": channel.type, "group_id": channel.group_id}


@router.delete("/{channel_id}")
async def delete_channel(
    channel_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a channel (only owner/admin can delete).
    """
    # Get channel
    result = await db.execute(
        select(Channel).where(Channel.id == channel_id)
    )
    channel = result.scalar_one_or_none()
    
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    
    # Check if user is owner or admin
    await require_role(db, channel.group_id, current_user["user_id"], min_role="admin")
    
    # Delete any voice participants in this channel
    result = await db.execute(
        select(VoiceParticipant).where(VoiceParticipant.channel_id == channel_id)
    )
    participants = result.scalars().all()
    for p in participants:
        await db.delete(p)
    
    # Delete the channel
    await db.delete(channel)
    await db.commit()
    
    return {"status": "ok", "message": "Channel deleted successfully"}
