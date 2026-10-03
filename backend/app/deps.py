from typing import Annotated
from fastapi import Cookie, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from .core.security import decode_access_token
from .database import get_db
from .models import User

bearer = HTTPBearer(auto_error=False)
DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    fittrack_access: Annotated[str | None, Cookie()] = None,
) -> User:
    token = credentials.credentials if credentials else fittrack_access
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    try:
        user_id = decode_access_token(token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired session")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account no longer exists")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_csrf(
    request: Request,
    current_user: CurrentUser,
    csrf_token: Annotated[str | None, Cookie()] = None,
) -> User:
    # Bearer-token API clients are not vulnerable to browser cookie CSRF. Browser
    # sessions use a same-site, double-submit token for every state change.
    if request.cookies.get("fittrack_access"):
        submitted = request.headers.get("x-csrf-token")
        if not csrf_token or not submitted or csrf_token != submitted:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
    return current_user


MutationUser = Annotated[User, Depends(require_csrf)]
