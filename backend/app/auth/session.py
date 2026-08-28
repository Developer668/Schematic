"""One small, platform-aware session boundary for Schematic.

The browser never chooses a room.  It asks the hosting boundary for a
session, then sends the short-lived signed token to the API.  Local
development has an explicit, non-production identity so the project can be
run without Docker or a second auth service; production must use Cloudflare
Access or a trusted ChatGPT Sites boundary.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Any, Mapping

from fastapi import Depends, Header, HTTPException, Request

from app.core.config import settings


_LOCAL_SECRET = "schematic-local-development-secret"
_TOKEN_ISSUER = "schematic"
_TOKEN_TYPE = "schematic-session"
_MAX_TOKEN_BYTES = 16_384
_MAX_WS_TICKETS = 4096
_WS_TICKETS: dict[str, tuple[str, int]] = {}
_WS_TICKETS_LOCK = threading.Lock()


@dataclass(frozen=True)
class SessionIdentity:
    subject: str
    email: str | None = None
    full_name: str | None = None
    environment: str = "unknown"

    def as_public_dict(self) -> dict[str, Any]:
        return {
            "authenticated": True,
            "subject": self.subject,
            "email": self.email,
            "fullName": self.full_name,
            "environment": self.environment,
        }


def _auth_mode() -> str:
    return str(settings.SCHEMATIC_AUTH_MODE or "development").strip().lower()


def validate_auth_config() -> None:
    """Fail closed before serving requests when deployment auth is ambiguous."""
    deployment = str(settings.SCHEMATIC_DEPLOYMENT_ENV or "").strip().lower()
    mode = _auth_mode()
    if deployment not in {"local", "development", "hosted", "production"}:
        raise RuntimeError("SCHEMATIC_DEPLOYMENT_ENV must be local, development, hosted, or production")
    if mode not in {"development", "cloudflare-access", "chatgpt-sites"}:
        raise RuntimeError("SCHEMATIC_AUTH_MODE is not supported")
    if deployment in {"hosted", "production"} and mode == "development":
        raise RuntimeError("development authentication is forbidden outside a local deployment")
    if deployment in {"hosted", "production"}:
        secret = str(settings.SCHEMATIC_SESSION_SECRET or "")
        if len(secret.encode("utf-8")) < 32:
            raise RuntimeError("SCHEMATIC_SESSION_SECRET must be at least 32 bytes outside local development")
        if not str(settings.SCHEMATIC_SESSION_AUDIENCE or "").strip():
            raise RuntimeError("SCHEMATIC_SESSION_AUDIENCE must be configured outside local development")
    if mode == "chatgpt-sites":
        if not settings.SCHEMATIC_TRUST_PLATFORM_HEADERS:
            raise RuntimeError("ChatGPT Sites mode requires an explicitly trusted platform ingress")
        if len(str(settings.SCHEMATIC_PLATFORM_INGRESS_SECRET or "").encode("utf-8")) < 32:
            raise RuntimeError("ChatGPT Sites mode requires a 32-byte platform ingress secret")
    if mode == "cloudflare-access":
        # Access JWT verification/exchange belongs at the trusted Pages/Worker
        # boundary. Refuse direct FastAPI deployment until that boundary is
        # configured rather than treating an Access header as an identity.
        if not settings.CF_ACCESS_TEAM_DOMAIN or not settings.CF_ACCESS_AUDIENCE:
            raise RuntimeError("Cloudflare Access mode requires a configured trusted token-exchange boundary")


def development_identity() -> SessionIdentity:
    return SessionIdentity(
        subject=str(settings.SCHEMATIC_DEV_SUBJECT or "local-development"),
        email=str(settings.SCHEMATIC_DEV_EMAIL or "local@localhost"),
        full_name="Local development",
        environment="local",
    )


def _secret() -> bytes:
    configured = str(settings.SCHEMATIC_SESSION_SECRET or "")
    if configured:
        if _auth_mode() != "development" and len(configured.encode("utf-8")) < 32:
            raise RuntimeError("SCHEMATIC_SESSION_SECRET must be at least 32 bytes outside local development")
        return configured.encode("utf-8")
    if _auth_mode() == "development":
        return _LOCAL_SECRET.encode("utf-8")
    raise RuntimeError("SCHEMATIC_SESSION_SECRET must be configured outside development")


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    if not value or len(value) > _MAX_TOKEN_BYTES:
        raise ValueError("invalid base64url segment")
    return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)


def _json_segment(value: Mapping[str, Any]) -> str:
    return _b64url_encode(json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8"))


def issue_session_token(identity: SessionIdentity, now: int | None = None) -> str:
    if not identity.subject.strip() or len(identity.subject.strip()) > 200:
        raise ValueError("session subject must be between 1 and 200 characters")
    issued_at = int(time.time() if now is None else now)
    ttl = max(60, min(int(settings.SCHEMATIC_SESSION_TTL_SECONDS), 86_400))
    header = {"alg": "HS256", "typ": _TOKEN_TYPE}
    payload: dict[str, Any] = {
        "iss": _TOKEN_ISSUER,
        "aud": str(settings.SCHEMATIC_SESSION_AUDIENCE or "schematic-api"),
        "sub": identity.subject,
        "iat": issued_at,
        "nbf": issued_at,
        "exp": issued_at + ttl,
        "env": identity.environment,
    }
    if identity.email:
        payload["email"] = identity.email
    if identity.full_name:
        payload["name"] = identity.full_name
    message = f"{_json_segment(header)}.{_json_segment(payload)}"
    signature = hmac.new(_secret(), message.encode("ascii"), hashlib.sha256).digest()
    return f"{message}.{_b64url_encode(signature)}"


def verify_session_token(token: str | None, now: int | None = None) -> SessionIdentity | None:
    if not token or len(token.encode("utf-8")) > _MAX_TOKEN_BYTES:
        return None
    try:
        header, payload_segment, signature = token.split(".", 2)
        header_data = json.loads(_b64url_decode(header))
        payload = json.loads(_b64url_decode(payload_segment))
        if not isinstance(header_data, dict) or header_data.get("alg") != "HS256" or header_data.get("typ") != _TOKEN_TYPE:
            return None
        message = f"{header}.{payload_segment}".encode("ascii")
        expected = hmac.new(_secret(), message, hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64url_decode(signature)):
            return None
        if not isinstance(payload, dict) or payload.get("iss") != _TOKEN_ISSUER or payload.get("aud") != str(settings.SCHEMATIC_SESSION_AUDIENCE or "schematic-api"):
            return None
        subject = str(payload.get("sub") or "").strip()
        expires_at = int(payload.get("exp", 0))
        issued_at = int(payload.get("iat", 0))
        not_before = int(payload.get("nbf", issued_at))
        current = int(time.time() if now is None else now)
        if not subject or len(subject) > 200 or expires_at <= current or issued_at > current + 60 or not_before > current + 60:
            return None
        return SessionIdentity(
            subject=subject,
            email=str(payload["email"])[:320] if payload.get("email") else None,
            full_name=str(payload["name"])[:320] if payload.get("name") else None,
            environment=str(payload.get("env") or "unknown")[:80],
        )
    except (ValueError, TypeError, KeyError, OverflowError, binascii.Error, json.JSONDecodeError, UnicodeError):
        return None


def _bearer_value(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


def _identity_from_platform_headers(headers: Mapping[str, str]) -> SessionIdentity | None:
    if _auth_mode() != "chatgpt-sites" or not settings.SCHEMATIC_TRUST_PLATFORM_HEADERS:
        return None
    subject = str(headers.get("oai-authenticated-user-id") or "").strip()
    if not subject or len(subject) > 200:
        return None
    ingress_secret = str(settings.SCHEMATIC_PLATFORM_INGRESS_SECRET or "")
    presented_secret = str(headers.get("x-schematic-platform-secret") or "")
    if not ingress_secret or not hmac.compare_digest(presented_secret, ingress_secret):
        return None
    email = str(headers.get("oai-authenticated-user-email") or "").strip() or None
    full_name = str(headers.get("oai-authenticated-user-full-name") or "").strip() or None
    if headers.get("oai-authenticated-user-full-name-encoding") == "percent-encoded-utf-8" and full_name:
        from urllib.parse import unquote

        full_name = unquote(full_name)
    if email and len(email) > 320:
        return None
    if full_name and len(full_name) > 320:
        return None
    return SessionIdentity(subject, email, full_name, "chatgpt-sites")


def issue_ws_ticket(identity: SessionIdentity, now: int | None = None) -> tuple[str, int]:
    """Create a one-use ticket for a browser WebSocket handshake.

    The ticket is intentionally opaque, short-lived, and bound to the verified
    subject. It is not a bearer session token and is deleted on first use.
    """
    issued_at = int(time.time() if now is None else now)
    ttl = max(15, min(int(settings.SCHEMATIC_WS_TICKET_TTL_SECONDS), 300))
    ticket = secrets.token_urlsafe(32)
    with _WS_TICKETS_LOCK:
        _purge_ws_tickets(issued_at)
        if len(_WS_TICKETS) >= _MAX_WS_TICKETS:
            raise RuntimeError("WebSocket authentication capacity has been reached")
        _WS_TICKETS[ticket] = (identity.subject, issued_at + ttl)
    return ticket, ttl


def consume_ws_ticket(ticket: str | None, now: int | None = None) -> SessionIdentity | None:
    if not ticket or len(ticket) > 256:
        return None
    current = int(time.time() if now is None else now)
    with _WS_TICKETS_LOCK:
        record = _WS_TICKETS.pop(ticket, None)
        _purge_ws_tickets(current)
    if not record:
        return None
    subject, expires_at = record
    if expires_at <= current:
        return None
    return SessionIdentity(subject=subject, environment=_auth_mode())


def _purge_ws_tickets(now: int) -> None:
    for ticket, (_, expires_at) in list(_WS_TICKETS.items()):
        if expires_at <= now:
            _WS_TICKETS.pop(ticket, None)


async def resolve_session(
    headers: Mapping[str, str],
    *,
    allow_development: bool = True,
) -> SessionIdentity | None:
    """Resolve a request from a signed token or an explicitly trusted boundary."""
    token = _bearer_value(headers.get("authorization"))
    if token:
        identity = verify_session_token(token)
        if identity is None:
            raise HTTPException(status_code=401, detail="Invalid or expired Schematic session")
        return identity

    platform_identity = _identity_from_platform_headers(headers)
    if platform_identity:
        return platform_identity

    if allow_development and _auth_mode() == "development":
        return development_identity()
    return None


async def require_session(
    request: Request,
    authorization: str | None = Header(default=None),
) -> SessionIdentity:
    headers = {key.lower(): value for key, value in request.headers.items()}
    if authorization:
        headers["authorization"] = authorization
    identity = await resolve_session(headers, allow_development=True)
    if identity is None:
        raise HTTPException(status_code=401, detail="Sign in to use this Schematic workspace")
    return identity


def route_identity(candidate: object) -> SessionIdentity:
    """Keep direct Python route tests useful without weakening HTTP production."""
    if isinstance(candidate, SessionIdentity):
        return candidate
    if _auth_mode() == "development":
        return development_identity()
    raise HTTPException(status_code=401, detail="Sign in to use this Schematic workspace")


def session_response(identity: SessionIdentity | None, *, issue_token: bool = True) -> dict[str, Any]:
    if identity is None:
        return {
            "authenticated": False,
            "subject": None,
            "email": None,
            "fullName": None,
            "environment": _auth_mode(),
        }
    result = identity.as_public_dict()
    if issue_token:
        # Do not return an authenticated response without a usable API token.
        # A missing production secret is a deployment error and must fail
        # closed instead of creating a UI/API split-brain.
        result["token"] = issue_session_token(identity)
        result["expiresIn"] = max(60, min(int(settings.SCHEMATIC_SESSION_TTL_SECONDS), 86_400))
    return result


async def auth_session(request: Request, authorization: str | None = None) -> dict[str, Any]:
    headers = {key.lower(): value for key, value in request.headers.items()}
    if authorization:
        headers["authorization"] = authorization
    identity = await resolve_session(headers, allow_development=True)
    return session_response(identity)
