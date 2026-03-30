"""
Group routes: /groups (list, create), /groups/{id}
"""
from fastapi import APIRouter, HTTPException, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from typing import List

from backend.database import get_db
from backend.models import Group, GroupMember, User
from backend.schemas import GroupCreate, GroupResponse, GroupDetailResponse
from backend.auth import get_current_user

router = APIRouter()


async def get_current_user_dep():
    """Dependency to get current authenticated user."""
    return await get_current_user()


@router.get("", response_model=List[GroupResponse])
async def list_groups(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    List all groups the current user is a member of.
    
    Args:
        current_user: Authenticated user from JWT
        db: Database session
        
    Returns:
        List of groups user belongs to
    """
    # Get groups where user is a member
    result = await db.execute(
        select(Group)
        .join(GroupMember, GroupMember.group_id == Group.id)
        .where(GroupMember.user_id == current_user["user_id"])
    )
    groups = result.scalars().all()
    
    return groups


@router.post("", response_model=GroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    group_data: GroupCreate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new group (server) and add creator as owner and member.
    
    Args:
        group_data: Group name
        current_user: Authenticated user from JWT
        db: Database session
        
    Returns:
        Created group data
    """
    # Create group
    new_group = Group(
        name=group_data.name,
        owner_id=current_user["user_id"]
    )
    
    db.add(new_group)
    await db.flush()  # Get the group ID
    
    # Add creator as member
    membership = GroupMember(
        user_id=current_user["user_id"],
        group_id=new_group.id
    )
    db.add(membership)
    await db.commit()
    await db.refresh(new_group)
    
    return new_group


@router.post("/{group_id}/invite", status_code=status.HTTP_201_CREATED)
async def invite_user_to_group(
    group_id: int,
    invite_data: dict,  # {"username": "nombre"}
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Invite a user to a group (any member can invite).
    """
    # DEBUG: Log the request
    print(f"[INVITE] User {current_user['user_id']} ({current_user['username']}) trying to invite to group {group_id}")
    
    # Get group
    result = await db.execute(
        select(Group).where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check if current user is a member (owner OR regular member can invite)
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
        print(f"[INVITE] ERROR: User {current_user['user_id']} is NOT a member of group {group_id}")
        raise HTTPException(status_code=403, detail="Only members can invite users")
    
    print(f"[INVITE] User {current_user['user_id']} IS a member of group {group_id}")
    
    # Find user to invite
    username_to_invite = invite_data.get("username", "")
    result = await db.execute(
        select(User).where(User.username == username_to_invite)
    )
    user_to_invite = result.scalar_one_or_none()
    
    if not user_to_invite:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if user is already a member
    result = await db.execute(
        select(GroupMember).where(
            and_(
                GroupMember.group_id == group_id,
                GroupMember.user_id == user_to_invite.id
            )
        )
    )
    existing_member = result.scalar_one_or_none()
    
    if existing_member:
        raise HTTPException(status_code=400, detail="User is already a member")
    
    # Add user to group
    membership = GroupMember(
        user_id=user_to_invite.id,
        group_id=group_id
    )
    db.add(membership)
    await db.commit()
    
    return {"status": "ok", "message": f"User {username_to_invite} added to group"}


@router.get("/{group_id}", response_model=GroupDetailResponse)
async def get_group(
    group_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get group details with member and channel counts.
    
    Args:
        group_id: Group ID
        current_user: Authenticated user from JWT
        db: Database session
        
    Returns:
        Group details
        
    Raises:
        HTTPException: If group not found or user is not a member
    """
    # Get group
    result = await db.execute(
        select(Group)
        .options(selectinload(Group.members), selectinload(Group.channels))
        .where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check if user is a member
    await db.refresh(group, ["members", "channels"])
    member_ids = [m.user_id for m in group.members]
    if current_user["user_id"] not in member_ids:
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    
    return GroupDetailResponse(
        id=group.id,
        name=group.name,
        owner_id=group.owner_id,
        member_count=len(group.members),
        channel_count=len(group.channels)
    )


@router.get("/{group_id}/members")
async def get_group_members(
    group_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get list of members in a group.
    """
    print(f"[MEMBERS] Getting members for group {group_id}, user {current_user['user_id']}")
    
    # Get group with members
    result = await db.execute(
        select(Group)
        .options(selectinload(Group.members))
        .where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    
    if not group:
        print(f"[MEMBERS] Group {group_id} not found")
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Get member IDs
    await db.refresh(group, ["members"])
    member_ids = [m.user_id for m in group.members]
    print(f"[MEMBERS] Found {len(member_ids)} members: {member_ids}")
    
    # Check if current user is a member
    if current_user["user_id"] not in member_ids:
        print(f"[MEMBERS] User {current_user['user_id']} not a member")
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    
    # Get member details (users table has username)
    if not member_ids:
        print("[MEMBERS] No members to fetch")
        return []
    
    from backend.models import User
    result = await db.execute(
        select(User).where(User.id.in_(member_ids))
    )
    members = result.scalars().all()
    
    print(f"[MEMBERS] Returning {len(members)} members")
    return [{"id": m.id, "username": m.username, "email": m.email, "avatar_url": m.avatar_url, "bio": m.bio} for m in members]


@router.put("/{group_id}", response_model=GroupResponse)
async def update_group(
    group_id: int,
    group_data: dict,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update a group's name (only owner can edit).
    """
    # Get group
    result = await db.execute(
        select(Group).where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check if current user is the owner
    if group.owner_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the owner can edit this group")
    
    # Update name if provided
    if "name" in group_data and group_data["name"]:
        group.name = group_data["name"]
    
    await db.commit()
    await db.refresh(group)
    
    return group


@router.delete("/{group_id}")
async def delete_group(
    group_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a group (only owner can delete).
    """
    # Get group
    result = await db.execute(
        select(Group).where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Check if current user is the owner
    if group.owner_id != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the owner can delete this group")
    
    # Delete all memberships first
    result = await db.execute(
        select(GroupMember).where(GroupMember.group_id == group_id)
    )
    members = result.scalars().all()
    for member in members:
        await db.delete(member)
    
    # Delete the group
    await db.delete(group)
    await db.commit()
    
    return {"status": "ok", "message": "Group deleted successfully"}
