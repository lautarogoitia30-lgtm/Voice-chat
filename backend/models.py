"""
Database models using SQLAlchemy.
Contains: User, Group, Channel, GroupMember
"""
from sqlalchemy import Column, Integer, String, ForeignKey, Enum
from sqlalchemy.orm import relationship
import enum

from backend.database import Base


class ChannelType(str, enum.Enum):
    """Channel type enumeration."""
    VOICE = "voice"
    TEXT = "text"


class User(Base):
    """User model for authentication and ownership."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    email = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    
    # Profile fields
    avatar_url = Column(String(500), nullable=True)  # URL or uploaded image path
    bio = Column(String(500), nullable=True)  # About me / description

    # Relationships
    owned_groups = relationship("Group", back_populates="owner", lazy="selectin")
    memberships = relationship("GroupMember", back_populates="user", lazy="selectin")


class Group(Base):
    """Group (server) model - like a Discord server."""
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Relationships
    owner = relationship("User", back_populates="owned_groups")
    members = relationship("GroupMember", back_populates="group", lazy="selectin")
    channels = relationship("Channel", back_populates="group", lazy="selectin")


class Channel(Base):
    """Channel model - voice or text within a group."""
    __tablename__ = "channels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)
    name = Column(String(100), nullable=False)
    type = Column(Enum(ChannelType), nullable=False, default=ChannelType.TEXT)

    # Relationships
    group = relationship("Group", back_populates="channels")


class GroupMember(Base):
    """Many-to-many relationship between users and groups."""
    __tablename__ = "group_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=False)

    # Relationships
    user = relationship("User", back_populates="memberships")
    group = relationship("Group", back_populates="members")


class VoiceParticipant(Base):
    """Track which users are in which voice channels."""
    __tablename__ = "voice_participants"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=False)
    joined_at = Column(Integer, nullable=False)  # timestamp

    # Relationships
    user = relationship("User")
    channel = relationship("Channel")