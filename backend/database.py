"""
Database configuration and session management.
Uses SQLAlchemy with SQLite for development.

Para producción, cambiar DATABASE_URL a PostgreSQL:
postgresql+asyncpg://user:password@localhost/dbname
"""
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, Integer, String


class Base(DeclarativeBase):
    """Base class for all database models."""
    pass


# Get database URL from environment or use SQLite default
_database_url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./voice_chat.db")

# For Railway PostgreSQL, need to add asyncpg driver
if _database_url.startswith("postgresql://"):
    DATABASE_URL = _database_url.replace("postgresql://", "postgresql+asyncpg://", 1)
else:
    DATABASE_URL = _database_url

# Create async engine
engine = create_async_engine(
    DATABASE_URL,
    echo=bool(os.getenv("DEBUG", "").lower() == "true"),
    future=True,
)

# Create async session factory
async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncSession:
    """
    Dependency for FastAPI routes.
    Yields an async session and closes it after the request.
    """
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """
    Initialize database tables and run migrations.
    Call this on app startup.
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
        # Migration: add 'role' column to group_members if it doesn't exist
        from sqlalchemy import text
        
        is_postgres = DATABASE_URL.startswith("postgresql")
        
        try:
            if is_postgres:
                # PostgreSQL: check information_schema
                result = await conn.execute(text("""
                    SELECT column_name FROM information_schema.columns 
                    WHERE table_name = 'group_members' AND column_name = 'role'
                """))
                column_exists = result.fetchone() is not None
            else:
                # SQLite: use PRAGMA
                result = await conn.execute(text("PRAGMA table_info(group_members)"))
                columns = [row[1] for row in result]
                column_exists = "role" in columns
            
            if not column_exists:
                print("[MIGRATION] Adding 'role' column to group_members table...")
                if is_postgres:
                    await conn.execute(text("ALTER TABLE group_members ADD COLUMN role VARCHAR(20) DEFAULT 'member'"))
                else:
                    await conn.execute(text("ALTER TABLE group_members ADD COLUMN role VARCHAR(20) DEFAULT 'member' NOT NULL"))
                
                # Set existing group owners to "owner" role
                await conn.execute(text("""
                    UPDATE group_members SET role = 'owner' 
                    WHERE user_id IN (
                        SELECT g.owner_id FROM groups g 
                        WHERE g.id = group_members.group_id
                    ) AND (role = 'member' OR role IS NULL)
                """))
                # Set any remaining NULLs to 'member'
                await conn.execute(text("UPDATE group_members SET role = 'member' WHERE role IS NULL"))
                print("[MIGRATION] Role column added and owners set.")
            else:
                print("[MIGRATION] Role column already exists, skipping.")
        except Exception as e:
            print(f"[MIGRATION] Warning during role migration: {e}")


async def close_db():
    """
    Close database connections.
    Call this on app shutdown.
    """
    await engine.dispose()