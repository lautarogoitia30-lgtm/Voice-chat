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
from backend.schemas import GroupCreate, GroupResponse, GroupDetailResponse, RoleUpdate, MemberWithRole, TransferOwnership
from backend.auth import get_current_user
from backend.permissions import require_role, get_member_role, get_member_record, ROLE_HIERARCHY

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
    
    # Add creator as member with owner role
    membership = GroupMember(
        user_id=current_user["user_id"],
        group_id=new_group.id,
        role="owner"
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
    Get list of members in a group with their roles.
    """
    # Get group with members
    result = await db.execute(
        select(Group)
        .options(selectinload(Group.members))
        .where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
    # Get member records (with roles)
    await db.refresh(group, ["members"])
    member_map = {m.user_id: m.role or "member" for m in group.members}
    member_ids = list(member_map.keys())
    
    # Check if current user is a member
    if current_user["user_id"] not in member_ids:
        raise HTTPException(status_code=403, detail="You are not a member of this group")
    
    if not member_ids:
        return []
    
    # Get user details
    from backend.models import User
    result = await db.execute(
        select(User).where(User.id.in_(member_ids))
    )
    members = result.scalars().all()
    
    return [
        {
            "id": m.id,
            "username": m.username,
            "email": m.email,
            "avatar_url": m.avatar_url,
            "bio": m.bio,
            "role": member_map.get(m.id, "member")
        }
        for m in members
    ]


@router.put("/{group_id}", response_model=GroupResponse)
async def update_group(
    group_id: int,
    group_data: dict,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update a group's name (owner or admin can edit).
    """
    # Check if user is owner or admin
    await require_role(db, group_id, current_user["user_id"], min_role="admin")
    
    # Get group
    result = await db.execute(
        select(Group).where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
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
    # Only owner can delete
    await require_role(db, group_id, current_user["user_id"], min_role="owner")
    
    # Get group
    result = await db.execute(
        select(Group).where(Group.id == group_id)
    )
    group = result.scalar_one_or_none()
    
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    
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


# ==================== ROLE MANAGEMENT ====================

@router.patch("/{group_id}/members/{user_id}/role")
async def update_member_role(
    group_id: int,
    user_id: int,
    role_data: RoleUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update a member's role. Only owner can promote/demote.
    Admin can't promote others to admin or demote other admins.
    """
    # Only owner can change roles
    await require_role(db, group_id, current_user["user_id"], min_role="owner")
    
    # Can't change own role via this endpoint
    if user_id == current_user["user_id"]:
        raise HTTPException(status_code=400, detail="Can't change your own role. Use transfer ownership instead.")
    
    # Get the target member
    target_member = await get_member_record(db, group_id, user_id)
    
    # Can't change owner role via this endpoint
    if target_member.role == "owner":
        raise HTTPException(status_code=400, detail="Can't change the owner's role. Use transfer ownership instead.")
    
    # Update role
    target_member.role = role_data.role
    await db.commit()
    
    # Get username for response
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    username = user.username if user else "Unknown"
    
    return {
        "status": "ok",
        "message": f"{username} is now {role_data.role}",
        "user_id": user_id,
        "role": role_data.role
    }


@router.delete("/{group_id}/members/{user_id}")
async def kick_member(
    group_id: int,
    user_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Kick a member from the group.
    Owner can kick anyone. Admin can kick members only (not other admins or owner).
    """
    # Must be at least admin to kick
    caller_role = await require_role(db, group_id, current_user["user_id"], min_role="admin")
    
    # Can't kick yourself
    if user_id == current_user["user_id"]:
        raise HTTPException(status_code=400, detail="Can't kick yourself. Leave the group instead.")
    
    # Get target member
    target_member = await get_member_record(db, group_id, user_id)
    
    # Can't kick owner
    if target_member.role == "owner":
        raise HTTPException(status_code=403, detail="Can't kick the group owner")
    
    # Admin can't kick other admins
    if caller_role == "admin" and target_member.role == "admin":
        raise HTTPException(status_code=403, detail="Admins can't kick other admins")
    
    # Get username before deleting
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    username = user.username if user else "Unknown"
    
    # Remove member
    await db.delete(target_member)
    await db.commit()
    
    return {"status": "ok", "message": f"{username} has been kicked from the group"}


@router.post("/{group_id}/transfer-ownership")
async def transfer_ownership(
    group_id: int,
    transfer_data: TransferOwnership,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Transfer group ownership to another member.
    Only current owner can do this.
    """
    # Only owner can transfer
    await require_role(db, group_id, current_user["user_id"], min_role="owner")
    
    # Can't transfer to yourself
    if transfer_data.new_owner_id == current_user["user_id"]:
        raise HTTPException(status_code=400, detail="You're already the owner")
    
    # Get target member
    new_owner_member = await get_member_record(db, group_id, transfer_data.new_owner_id)
    
    # Get current owner member record
    current_owner_member = await get_member_record(db, group_id, current_user["user_id"])
    
    # Update roles
    new_owner_member.role = "owner"
    current_owner_member.role = "admin"  # Former owner becomes admin
    
    # Update group's owner_id
    result = await db.execute(select(Group).where(Group.id == group_id))
    group = result.scalar_one_or_none()
    if group:
        group.owner_id = transfer_data.new_owner_id
    
    await db.commit()
    
    return {"status": "ok", "message": "Ownership transferred successfully"}
