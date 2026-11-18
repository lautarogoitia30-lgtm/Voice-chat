"""Channel WebSocket authorization against an isolated in-memory database."""
import os
import unittest
from unittest.mock import AsyncMock, patch

# Keep test imports independent of developer/production credentials and databases.
os.environ.setdefault("SECRET_KEY", "test-only-chat-websocket-secret")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from backend.auth import create_jwt_token, verify_jwt_token
from backend.database import Base
from backend.main import chat_websocket
from backend.models import Channel, ChannelType, Group, GroupMember, User


class ChatWebSocketAccessTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with self.sessions() as db:
            db.add_all([
                User(id=1, username="member", email="member@example.test", password_hash="unused"),
                User(id=2, username="outsider", email="outsider@example.test", password_hash="unused"),
                Group(id=10, name="Private group", owner_id=1),
                Group(id=20, name="Other group", owner_id=2),
                Channel(id=100, group_id=10, name="private", type=ChannelType.TEXT),
                Channel(id=101, group_id=10, name="voice", type=ChannelType.VOICE),
                GroupMember(group_id=10, user_id=1),
                GroupMember(group_id=20, user_id=2),
            ])
            await db.commit()
        # Patch both conventional import sites; no application startup/network needed.
        self.factory_patch = patch("backend.database.async_session_maker", self.sessions)
        self.factory_patch.start()
        self.addCleanup(self.factory_patch.stop)
        self.endpoint_patch = patch("backend.main.websocket_endpoint", new_callable=AsyncMock)
        self.endpoint = self.endpoint_patch.start()
        self.addCleanup(self.endpoint_patch.stop)
        self.socket = AsyncMock()

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_nonmember_cannot_enter_private_channel(self):
        await chat_websocket(self.socket, 100, create_jwt_token(2, "outsider"))
        self.socket.close.assert_awaited_once_with(code=4003, reason="Not authorized for this channel")
        self.endpoint.assert_not_awaited()
        self.socket.accept.assert_not_awaited()

    async def test_member_can_enter_text_channel(self):
        token = create_jwt_token(1, "member")
        await chat_websocket(self.socket, 100, token)
        self.socket.close.assert_not_awaited()
        self.endpoint.assert_awaited_once_with(self.socket, 100, verify_jwt_token(token))

    async def test_missing_channel_is_rejected(self):
        await chat_websocket(self.socket, 999, create_jwt_token(1, "member"))
        self.socket.close.assert_awaited_once_with(code=4003, reason="Not authorized for this channel")
        self.endpoint.assert_not_awaited()

    async def test_voice_channel_is_rejected_by_text_socket(self):
        await chat_websocket(self.socket, 101, create_jwt_token(1, "member"))
        self.socket.close.assert_awaited_once_with(code=4003, reason="Not authorized for this channel")
        self.endpoint.assert_not_awaited()

    async def test_missing_token_is_rejected(self):
        await chat_websocket(self.socket, 100, "")
        self.socket.close.assert_awaited_once_with(code=4001, reason="Authentication required")
        self.endpoint.assert_not_awaited()

    async def test_invalid_token_is_rejected(self):
        await chat_websocket(self.socket, 100, "invalid-token")
        self.socket.close.assert_awaited_once_with(code=4001, reason="Invalid token")
        self.endpoint.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
