from datetime import datetime, timedelta, timezone
import jwt
from pwdlib import PasswordHash
from .config import get_settings

password_hash = PasswordHash.recommended()
ALGORITHM = "HS256"


def hash_password(value: str) -> str:
    return password_hash.hash(value)


def verify_password(value: str, hashed: str) -> bool:
    return password_hash.verify(value, hashed)


def create_access_token(user_id: int) -> str:
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub": str(user_id), "exp": expires}, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> int:
    settings = get_settings()
    payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
    return int(payload["sub"])
