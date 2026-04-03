"""
Role-based permission system for groups.
Roles: owner > admin > member
"""
from fastapi import HTTPException
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from backend.models import GroupMember

# Role hierarchy — higher number = more power
ROLE_HIERARCHY = {"owner": 3, "admin": 2, "member": 1}


async def get_member_role(db: AsyncSession, group_id: int, user_id: int) -> str:
    """
    Get a user's role in a group.
    
    Returns:
        The user's role string ("owner", "admin", "member")
        
    Raises:
        HTTPException 403 if user is not a member
    """
    result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user_id
            )
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    return member.role or "member"


async def require_role(db: AsyncSession, group_id: int, user_id: int, min_role: str = "member") -> str:
    """
    Check if user has at least the specified role in a group.
    
    Args:
        db: Database session
        group_id: Group ID
        user_id: User ID
        min_role: Minimum required role ("member", "admin", "owner")
        
    Returns:
        The user's actual role
        
    Raises:
        HTTPException 403 if role is insufficient
    """
    role = await get_member_role(db, group_id, user_id)
    if ROLE_HIERARCHY.get(role, 0) < ROLE_HIERARCHY.get(min_role, 0):
        role_messages = {
            "admin": "You need admin or owner permissions to do this",
            "owner": "Only the group owner can do this"
        }
        detail = role_messages.get(min_role, f"Insufficient permissions (need '{min_role}' role)")
        raise HTTPException(status_code=403, detail=detail)
    return role


async def get_member_record(db: AsyncSession, group_id: int, user_id: int) -> GroupMember:
    """
    Get the full GroupMember record (includes role).
    
    Returns:
        GroupMember object
        
    Raises:
        HTTPException 404 if not a member
    """
    result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user_id
            )
        )
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=404, detail="User is not a member of this group")
    return member
