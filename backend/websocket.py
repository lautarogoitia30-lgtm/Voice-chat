"""
WebSocket handler for real-time text chat.
Manages connections and broadcasts messages to channels.
"""
from fastapi import WebSocket, WebSocketDisconnect
from typing import Optional
from typing import List, Dict
import json
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


# Global connection manager
manager = ConnectionManager()


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
