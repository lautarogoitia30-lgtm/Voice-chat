"""
Direct Message routes: /dm/
Handles DM conversations and messages between users.
"""
import time
from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, desc
from typing import List
from pydantic import BaseModel

from backend.database import get_db
from backend.models import DMConversation, DirectMessage, User
from backend.auth import get_current_user

router = APIRouter()


# ==================== SCHEMAS ====================

class DMConversationResponse(BaseModel):
    """Response for a DM conversation."""
    id: int
    other_user_id: int
    other_username: str
    other_avatar_url: str | None = None
    last_message: str | None = None
    last_message_at: int | None = None


class DirectMessageResponse(BaseModel):
    """Response for a single DM."""
    id: int
    conversation_id: int
    sender_id: int
    sender_username: str
    sender_avatar_url: str | None = None
    content: str
    created_at: int


class SendMessageRequest(BaseModel):
    """Request to send a DM."""
    content: str


class StartConversationRequest(BaseModel):
    """Request to start a DM conversation."""
    username: str


# ==================== ROUTES ====================

@router.get("/conversations", response_model=List[DMConversationResponse])
async def get_conversations(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get all DM conversations for the current user, sorted by last message."""
    user_id = current_user["user_id"]
    
    # Get all conversations where user is participant
    result = await db.execute(
        select(DMConversation).where(
            or_(
                DMConversation.user1_id == user_id,
                DMConversation.user2_id == user_id
            )
        )
    )
    conversations = result.scalars().all()
    
    response = []
    for conv in conversations:
        # Determine the other user
        other_user_id = conv.user2_id if conv.user1_id == user_id else conv.user1_id
        
        # Get other user info
        user_result = await db.execute(
            select(User).where(User.id == other_user_id)
        )
        other_user = user_result.scalar_one_or_none()
        if not other_user:
            continue
        
        # Get last message
        msg_result = await db.execute(
            select(DirectMessage).where(
                DirectMessage.conversation_id == conv.id
            ).order_by(desc(DirectMessage.created_at)).limit(1)
        )
        last_msg = msg_result.scalar_one_or_none()
        
        response.append(DMConversationResponse(
            id=conv.id,
            other_user_id=other_user.id,
            other_username=other_user.username,
            other_avatar_url=other_user.avatar_url,
            last_message=last_msg.content if last_msg else None,
            last_message_at=last_msg.created_at if last_msg else conv.created_at
        ))
    
    # Sort by last message time (newest first)
    response.sort(key=lambda x: x.last_message_at or 0, reverse=True)
    
    return response


@router.post("/conversations", response_model=DMConversationResponse)
async def start_conversation(
    req: StartConversationRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Start a new DM conversation with a user (or return existing one)."""
    user_id = current_user["user_id"]
    
    # Find the target user
    result = await db.execute(
        select(User).where(User.username == req.username)
    )
    target_user = result.scalar_one_or_none()
    
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if target_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot DM yourself")
    
    # Ensure user1_id < user2_id to avoid duplicates
    u1 = min(user_id, target_user.id)
    u2 = max(user_id, target_user.id)
    
    # Check if conversation already exists
    result = await db.execute(
        select(DMConversation).where(
            and_(
                DMConversation.user1_id == u1,
                DMConversation.user2_id == u2
            )
        )
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        return DMConversationResponse(
            id=existing.id,
            other_user_id=target_user.id,
            other_username=target_user.username,
            other_avatar_url=target_user.avatar_url,
            last_message=None,
            last_message_at=existing.created_at
        )
    
    # Create new conversation
    conv = DMConversation(
        user1_id=u1,
        user2_id=u2,
        created_at=int(time.time())
    )
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    
    return DMConversationResponse(
        id=conv.id,
        other_user_id=target_user.id,
        other_username=target_user.username,
        other_avatar_url=target_user.avatar_url,
        last_message=None,
        last_message_at=conv.created_at
    )


@router.get("/conversations/{conversation_id}/messages", response_model=List[DirectMessageResponse])
async def get_messages(
    conversation_id: int,
    limit: int = 50,
    before: int | None = None,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get messages from a DM conversation."""
    user_id = current_user["user_id"]
    
    # Verify user is part of this conversation
    result = await db.execute(
        select(DMConversation).where(
            and_(
                DMConversation.id == conversation_id,
                or_(
                    DMConversation.user1_id == user_id,
                    DMConversation.user2_id == user_id
                )
            )
        )
    )
    conv = result.scalar_one_or_none()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Build query
    query = select(DirectMessage, User).join(
        User, DirectMessage.sender_id == User.id
    ).where(
        DirectMessage.conversation_id == conversation_id
    )
    
    if before:
        query = query.where(DirectMessage.created_at < before)
    
    query = query.order_by(desc(DirectMessage.created_at)).limit(limit)
    
    result = await db.execute(query)
    rows = result.all()
    
    messages = []
    for msg, user in rows:
        messages.append(DirectMessageResponse(
            id=msg.id,
            conversation_id=msg.conversation_id,
            sender_id=msg.sender_id,
            sender_username=user.username,
            sender_avatar_url=user.avatar_url,
            content=msg.content,
            created_at=msg.created_at
        ))
    
    # Return in chronological order (oldest first)
    messages.reverse()
    
    return messages


@router.post("/conversations/{conversation_id}/messages", response_model=DirectMessageResponse)
async def send_message(
    conversation_id: int,
    req: SendMessageRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Send a message in a DM conversation."""
    user_id = current_user["user_id"]
    
    # Verify user is part of this conversation
    result = await db.execute(
        select(DMConversation).where(
            and_(
                DMConversation.id == conversation_id,
                or_(
                    DMConversation.user1_id == user_id,
                    DMConversation.user2_id == user_id
                )
            )
        )
    )
    conv = result.scalar_one_or_none()
    
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    # Get sender info
    result = await db.execute(select(User).where(User.id == user_id))
    sender = result.scalar_one()
    
    # Create message
    msg = DirectMessage(
        conversation_id=conversation_id,
        sender_id=user_id,
        content=req.content.strip(),
        created_at=int(time.time())
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    
    return DirectMessageResponse(
        id=msg.id,
        conversation_id=msg.conversation_id,
        sender_id=msg.sender_id,
        sender_username=sender.username,
        sender_avatar_url=sender.avatar_url,
        content=msg.content,
        created_at=msg.created_at
    )
