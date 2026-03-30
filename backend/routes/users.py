"""
User routes: /users/me (profile management)
"""
import os
import uuid
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.database import get_db
from backend.models import User
from backend.schemas import UserResponse, UserUpdate
from backend.auth import get_current_user

router = APIRouter()


@router.get("/me", response_model=UserResponse)
async def get_current_user_profile(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Get current user's profile.
    
    Returns:
        User profile data including avatar and bio
    """
    result = await db.execute(
        select(User).where(User.id == current_user["user_id"])
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return user


@router.put("/me", response_model=UserResponse)
async def update_current_user_profile(
    user_data: UserUpdate,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Update current user's profile.
    
    Args:
        user_data: Fields to update (username, email, bio, avatar_url)
        
    Returns:
        Updated user profile
    """
    result = await db.execute(
        select(User).where(User.id == current_user["user_id"])
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update fields if provided
    if user_data.username is not None:
        # Check if username is already taken by another user
        result = await db.execute(
            select(User).where(User.username == user_data.username, User.id != user.id)
        )
        if result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Username already taken")
        user.username = user_data.username
    
    if user_data.email is not None:
        # Check if email is already taken by another user
        result = await db.execute(
            select(User).where(User.email == user_data.email, User.id != user.id)
        )
        if result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Email already taken")
        user.email = user_data.email
    
    if user_data.bio is not None:
        user.bio = user_data.bio
    
    if user_data.avatar_url is not None:
        user.avatar_url = user_data.avatar_url
    
    await db.commit()
    await db.refresh(user)
    
    return user


@router.post("/me/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload an avatar image.
    
    Returns:
        URL to the uploaded image
    """
    # Validate file type
    allowed_types = {"image/jpeg", "image/png", "image/gif", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed."
        )
    
    # Validate file size (max 5MB)
    file_size = 0
    contents = await file.read()
    file_size = len(contents)
    
    if file_size > 5 * 1024 * 1024:  # 5MB
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 5MB.")
    
    # Generate unique filename
    file_extension = file.filename.split(".")[-1] if "." in file.filename else "jpg"
    unique_filename = f"{uuid.uuid4()}.{file_extension}"
    
    # Create uploads directory if it doesn't exist
    upload_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "uploads", "avatars")
    os.makedirs(upload_dir, exist_ok=True)
    
    # Save file
    file_path = os.path.join(upload_dir, unique_filename)
    with open(file_path, "wb") as f:
        f.write(contents)
    
    # Update user avatar URL
    result = await db.execute(
        select(User).where(User.id == current_user["user_id"])
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Save URL path (relative)
    avatar_url = f"/uploads/avatars/{unique_filename}"
    user.avatar_url = avatar_url
    
    await db.commit()
    
    return {"avatar_url": avatar_url}
