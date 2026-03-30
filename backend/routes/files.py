"""
File routes: /files (upload, download)
"""
import os
import uuid
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession

from backend.database import get_db
from backend.auth import get_current_user
from backend.models import User

router = APIRouter()

# File upload settings
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
ALLOWED_TYPES = {
    # Images
    "image/jpeg", "image/png", "image/gif", "image/webp",
    # Documents
    "application/pdf",
    "text/plain", "text/html", "text/css", "text/javascript",
    # Archives
    "application/zip", "application/x-rar-compressed",
    # Audio
    "audio/mpeg", "audio/wav", "audio/ogg",
    # Video
    "video/mp4", "video/webm",
}


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload a file to the server.
    
    Returns:
        File info including URL and metadata
    """
    # Validate file type
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed types: {', '.join(ALLOWED_TYPES)}"
        )
    
    # Read file content
    contents = await file.read()
    file_size = len(contents)
    
    # Validate file size
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB."
        )
    
    # Generate unique filename
    file_extension = file.filename.split(".")[-1] if "." in file.filename else "bin"
    unique_filename = f"{uuid.uuid4()}.{file_extension}"
    
    # Create uploads directory if it doesn't exist
    upload_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "uploads", "files")
    os.makedirs(upload_dir, exist_ok=True)
    
    # Save file
    file_path = os.path.join(upload_dir, unique_filename)
    with open(file_path, "wb") as f:
        f.write(contents)
    
    # Determine file category
    file_category = "file"
    if file.content_type.startswith("image/"):
        file_category = "image"
    elif file.content_type.startswith("audio/"):
        file_category = "audio"
    elif file.content_type.startswith("video/"):
        file_category = "video"
    
    # Return file info
    file_url = f"/uploads/files/{unique_filename}"
    original_name = file.filename
    
    return {
        "id": str(uuid.uuid4()),
        "filename": original_name,
        "url": file_url,
        "size": file_size,
        "type": file.content_type,
        "category": file_category,
        "uploaded_by": current_user["username"]
    }
