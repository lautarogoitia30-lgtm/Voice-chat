"""
WebSocket handler for real-time text chat and DMs.
Manages connections and broadcasts messages to channels and DM conversations.
"""
from fastapi import WebSocket, WebSocketDisconnect
from typing import Optional
from typing import List, Dict
import json
import time
from datetime import datetime


class ConnectionManager:
    """
    Manages WebSocket connections for text chat.
    Groups connections by channel_id for targeted messaging.
    """
    
    def __init__(self):
        # {channel_id: [WebSocket connections]}
        self.active_connections: Dict[int, List[WebSocket]] = {}
    
    async def connect(self, channel_id: int, websocket: WebSocket):
        """Accept a new WebSocket connection."""
        await websocket.accept()
        
        if channel_id not in self.active_connections:
            self.active_connections[channel_id] = []
        
        self.active_connections[channel_id].append(websocket)
        print(f"WebSocket connected to channel {channel_id}")
    
    def disconnect(self, channel_id: int, websocket: WebSocket):
        """Remove a WebSocket connection."""
        if channel_id in self.active_connections:
            if websocket in self.active_connections[channel_id]:
                self.active_connections[channel_id].remove(websocket)
            
            # Clean up empty channels
            if not self.active_connections[channel_id]:
                del self.active_connections[channel_id]
        
        print(f"WebSocket disconnected from channel {channel_id}")
    
    async def send_personal_message(self, message: dict, websocket: WebSocket):
        """Send a message to a specific WebSocket."""
        try:
            await websocket.send_json(message)
        except Exception as e:
            print(f"Error sending personal message: {e}")
    
    async def broadcast(self, channel_id: int, message: dict):
        """Broadcast a message to all connections in a channel."""
        if channel_id not in self.active_connections:
            return
        
        disconnected = []
        
        for connection in self.active_connections[channel_id]:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"Error broadcasting message: {e}")
                disconnected.append(connection)
        
        # Remove disconnected connections
        for ws in disconnected:
            self.disconnect(channel_id, ws)


class DMConnectionManager:
    """
    Manages WebSocket connections for DM conversations.
    Groups connections by conversation_id for targeted messaging.
    """
    
    def __init__(self):
        # {conversation_id: [WebSocket connections]}
        self.active_connections: Dict[int, List[WebSocket]] = {}
    
    async def connect(self, conversation_id: int, websocket: WebSocket):
        """Accept a new WebSocket connection for a DM conversation."""
        await websocket.accept()
        
        if conversation_id not in self.active_connections:
            self.active_connections[conversation_id] = []
        
        self.active_connections[conversation_id].append(websocket)
        print(f"DM WebSocket connected to conversation {conversation_id}")
    
    def disconnect(self, conversation_id: int, websocket: WebSocket):
        """Remove a WebSocket connection from a DM conversation."""
        if conversation_id in self.active_connections:
            if websocket in self.active_connections[conversation_id]:
                self.active_connections[conversation_id].remove(websocket)
            
            if not self.active_connections[conversation_id]:
                del self.active_connections[conversation_id]
        
        print(f"DM WebSocket disconnected from conversation {conversation_id}")
    
    async def broadcast(self, conversation_id: int, message: dict):
        """Broadcast a message to all connections in a DM conversation."""
        if conversation_id not in self.active_connections:
            return
        
        disconnected = []
        
        for connection in self.active_connections[conversation_id]:
            try:
                await connection.send_json(message)
            except Exception as e:
                print(f"Error broadcasting DM: {e}")
                disconnected.append(connection)
        
        for ws in disconnected:
            self.disconnect(conversation_id, ws)


class DMNotificationManager:
    """
    Tracks per-user WebSocket connections for DM notifications.
    Unlike DMConnectionManager (per-conversation), this is per-user
    so we can notify users about messages in ANY conversation.
    """
    
    def __init__(self):
        # {user_id: [WebSocket connections]}
        self.active_connections: Dict[int, List[WebSocket]] = {}
    
    async def connect(self, user_id: int, websocket: WebSocket):
        """Accept a new notification WebSocket for a user."""
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        print(f"DM Notification WS connected for user {user_id}")
    
    def disconnect(self, user_id: int, websocket: WebSocket):
        """Remove a notification WebSocket for a user."""
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]
        print(f"DM Notification WS disconnected for user {user_id}")
    
    async def notify(self, user_id: int, message: dict):
        """Send a notification to a specific user."""
        if user_id not in self.active_connections:
            return
        disconnected = []
        for conn in self.active_connections[user_id]:
            try:
                await conn.send_json(message)
            except Exception:
                disconnected.append(conn)
        for ws in disconnected:
            self.disconnect(user_id, ws)


# Global connection managers
manager = ConnectionManager()
dm_manager = DMConnectionManager()
dm_notification_manager = DMNotificationManager()


async def websocket_endpoint(websocket: WebSocket, channel_id: int, user_data: Optional[dict] = None):
    """
    WebSocket endpoint for text chat.
    
    Client sends: {"content": "message text"}
    Server broadcasts: {"channel_id": ..., "sender_id": ..., "sender_username": ..., "content": ..., "timestamp": ...}
    """
    # Store user data for use when sending messages
    if user_data:
        websocket.user_data = user_data
    
    await manager.connect(channel_id, websocket)
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            
            try:
                message_data = json.loads(data)
                content = message_data.get("content", "")
                
                if content:
                    # Get sender info from authenticated user (JWT) - SECURE!
                    sender_id = websocket.user_data.get("user_id", 0) if hasattr(websocket, 'user_data') else 0
                    sender_username = websocket.user_data.get("username", "Anonymous") if hasattr(websocket, 'user_data') else "Anonymous"
                    
                    broadcast_message = {
                        "channel_id": channel_id,
                        "sender_id": sender_id,
                        "sender_username": sender_username,
                        "content": content,
                        "timestamp": datetime.utcnow().isoformat()
                    }
                    
                    # Broadcast to all in channel
                    await manager.broadcast(channel_id, broadcast_message)
                    
            except json.JSONDecodeError:
                print(f"Invalid JSON received: {data}")
                
    except WebSocketDisconnect:
        manager.disconnect(channel_id, websocket)
        
        # Notify others in channel
        await manager.broadcast(channel_id, {
            "channel_id": channel_id,
            "content": "User disconnected",
            "sender_username": "System"
        })


async def dm_websocket_endpoint(websocket: WebSocket, conversation_id: int, user_data: Optional[dict] = None):
    """
    WebSocket endpoint for DM conversations.
    
    Client sends: {"content": "message text"}
    Server broadcasts: {"conversation_id": ..., "sender_id": ..., "sender_username": ..., "content": ..., "created_at": ...}
    Also saves messages to database.
    """
    if not user_data:
        await websocket.close(code=4001, reason="Authentication required")
        return
    
    # Verify user is part of this conversation
    from backend.database import async_session_maker
    from backend.models import DMConversation, DirectMessage, User
    from sqlalchemy import select, and_, or_
    
    async with async_session_maker() as db:
        result = await db.execute(
            select(DMConversation).where(
                and_(
                    DMConversation.id == conversation_id,
                    or_(
                        DMConversation.user1_id == user_data["user_id"],
                        DMConversation.user2_id == user_data["user_id"]
                    )
                )
            )
        )
        conv = result.scalar_one_or_none()
        
        if not conv:
            await websocket.close(code=4003, reason="Not authorized for this conversation")
            return
    
    # Store conversation user IDs for notifications
    conv_user1_id = conv.user1_id
    conv_user2_id = conv.user2_id
    
    await dm_manager.connect(conversation_id, websocket)
    
    try:
        while True:
            data = await websocket.receive_text()
            
            try:
                message_data = json.loads(data)
                msg_type = message_data.get("type", "message")
                
                # Handle typing indicator — just relay, don't save
                if msg_type == "typing":
                    typing_broadcast = {
                        "type": "typing",
                        "sender_id": user_data["user_id"],
                        "sender_username": user_data["username"]
                    }
                    await dm_manager.broadcast(conversation_id, typing_broadcast)
                    continue
                
                content = message_data.get("content", "")
                
                if content.strip():
                    sender_id = user_data["user_id"]
                    sender_username = user_data["username"]
                    created_at = int(time.time())
                    
                    # Save message to database
                    msg_id = None
                    async with async_session_maker() as db:
                        msg = DirectMessage(
                            conversation_id=conversation_id,
                            sender_id=sender_id,
                            content=content.strip(),
                            created_at=created_at
                        )
                        db.add(msg)
                        await db.commit()
                        await db.refresh(msg)
                        msg_id = msg.id
                        
                        # Get sender avatar
                        result = await db.execute(select(User).where(User.id == sender_id))
                        sender = result.scalar_one_or_none()
                        sender_avatar = sender.avatar_url if sender else None
                    
                    # Broadcast to all in conversation
                    broadcast_message = {
                        "type": "dm_message",
                        "id": msg_id,
                        "conversation_id": conversation_id,
                        "sender_id": sender_id,
                        "sender_username": sender_username,
                        "sender_avatar_url": sender_avatar,
                        "content": content.strip(),
                        "created_at": created_at
                    }
                    
                    await dm_manager.broadcast(conversation_id, broadcast_message)
                    
                    # Notify the OTHER user via global notification WS
                    other_user_id = conv_user2_id if sender_id == conv_user1_id else conv_user1_id
                    await dm_notification_manager.notify(other_user_id, {
                        "type": "dm_notification",
                        "conversation_id": conversation_id,
                        "sender_id": sender_id,
                        "sender_username": sender_username,
                        "content": content.strip(),
                        "created_at": created_at
                    })
                    
            except json.JSONDecodeError:
                print(f"Invalid JSON in DM: {data}")
                
    except WebSocketDisconnect:
        dm_manager.disconnect(conversation_id, websocket)


async def dm_notification_websocket_endpoint(websocket: WebSocket, user_data: Optional[dict] = None):
    """
    Global DM notification WebSocket.
    Keeps a persistent connection per user to receive notifications
    about new messages in ANY of their conversations.
    """
    if not user_data:
        await websocket.close(code=4001, reason="Authentication required")
        return
    
    user_id = user_data["user_id"]
    await dm_notification_manager.connect(user_id, websocket)
    
    try:
        while True:
            # Keep alive — just wait for pings/disconnect
            await websocket.receive_text()
    except WebSocketDisconnect:
        dm_notification_manager.disconnect(user_id, websocket)
