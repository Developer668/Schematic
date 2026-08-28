from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Request

from app.auth.session import SessionIdentity, auth_session, issue_ws_ticket, require_session

router = APIRouter()


@router.get("/session")
async def get_session(request: Request, authorization: str | None = Header(default=None)):
    """Return the single normalized session contract used by every frontend."""
    return await auth_session(request, authorization)


@router.post("/ws-ticket")
async def create_ws_ticket(_identity: SessionIdentity = Depends(require_session)):
    ticket, expires_in = issue_ws_ticket(_identity)
    return {"ticket": ticket, "expiresIn": expires_in}
