import os

os.environ.setdefault("SCHEMATIC_DEPLOYMENT_ENV", "local")

from fastapi.testclient import TestClient
import pytest

from app.auth.session import SessionIdentity, consume_ws_ticket, issue_session_token, issue_ws_ticket, validate_auth_config, verify_session_token
from app.core.config import settings
from app.main import app


def test_signed_session_tokens_are_subject_bound_and_expire(monkeypatch):
    monkeypatch.setattr(settings, "SCHEMATIC_AUTH_MODE", "production")
    monkeypatch.setattr(settings, "SCHEMATIC_SESSION_SECRET", "test-only-session-secret-0123456789012345")
    identity = SessionIdentity("alice", "alice@example.test", environment="cloudflare-access")
    token = issue_session_token(identity, now=100)

    verified = verify_session_token(token, now=101)
    assert verified is not None and verified.subject == "alice"
    assert verify_session_token(token + "x", now=101) is None
    assert verify_session_token(token, now=3700) is None


def test_tokens_require_the_expected_type_and_audience(monkeypatch):
    monkeypatch.setattr(settings, "SCHEMATIC_AUTH_MODE", "production")
    monkeypatch.setattr(settings, "SCHEMATIC_SESSION_SECRET", "test-only-session-secret-0123456789012345")
    token = issue_session_token(SessionIdentity("alice"), now=100)
    assert verify_session_token(token, now=101) is not None
    monkeypatch.setattr(settings, "SCHEMATIC_SESSION_AUDIENCE", "other-api")
    assert verify_session_token(token, now=101) is None


def test_overlong_subjects_are_rejected_instead_of_truncated(monkeypatch):
    monkeypatch.setattr(settings, "SCHEMATIC_AUTH_MODE", "production")
    monkeypatch.setattr(settings, "SCHEMATIC_SESSION_SECRET", "test-only-session-secret-0123456789012345")
    with pytest.raises(ValueError):
        issue_session_token(SessionIdentity("a" * 201), now=100)


def test_authenticated_session_response_does_not_hide_token_issuance_failure(monkeypatch):
    from app.auth.session import session_response

    monkeypatch.setattr(settings, "SCHEMATIC_AUTH_MODE", "production")
    monkeypatch.setattr(settings, "SCHEMATIC_SESSION_SECRET", "")
    with pytest.raises(RuntimeError, match="must be configured"):
        session_response(SessionIdentity("alice"))


def test_hosted_configuration_fails_closed_without_a_strong_secret(monkeypatch):
    monkeypatch.setattr(settings, "SCHEMATIC_DEPLOYMENT_ENV", "production")
    monkeypatch.setattr(settings, "SCHEMATIC_AUTH_MODE", "cloudflare-access")
    monkeypatch.setattr(settings, "SCHEMATIC_SESSION_SECRET", "too-short")
    monkeypatch.setattr(settings, "CF_ACCESS_TEAM_DOMAIN", "team.cloudflareaccess.com")
    monkeypatch.setattr(settings, "CF_ACCESS_AUDIENCE", "audience")
    with pytest.raises(RuntimeError, match="at least 32 bytes"):
        validate_auth_config()


def test_chatgpt_platform_headers_require_the_private_ingress_secret(monkeypatch):
    monkeypatch.setattr(settings, "SCHEMATIC_AUTH_MODE", "chatgpt-sites")
    monkeypatch.setattr(settings, "SCHEMATIC_TRUST_PLATFORM_HEADERS", True)
    monkeypatch.setattr(settings, "SCHEMATIC_PLATFORM_INGRESS_SECRET", "platform-secret-0123456789012345")
    from app.auth.session import resolve_session
    import asyncio
    headers = {"oai-authenticated-user-id": "alice"}
    assert asyncio.run(resolve_session(headers, allow_development=False)) is None
    headers["x-schematic-platform-secret"] = "platform-secret-0123456789012345"
    identity = asyncio.run(resolve_session(headers, allow_development=False))
    assert identity is not None and identity.subject == "alice"


def test_websocket_ticket_is_one_use_and_subject_bound(monkeypatch):
    monkeypatch.setattr(settings, "SCHEMATIC_AUTH_MODE", "production")
    monkeypatch.setattr(settings, "SCHEMATIC_SESSION_SECRET", "test-only-session-secret-0123456789012345")
    ticket, ttl = issue_ws_ticket(SessionIdentity("alice"), now=100)
    assert ttl >= 15
    identity = consume_ws_ticket(ticket, now=101)
    assert identity is not None and identity.subject == "alice"
    assert consume_ws_ticket(ticket, now=101) is None
    ticket, _ = issue_ws_ticket(SessionIdentity("alice"), now=100)
    assert consume_ws_ticket(ticket, now=100 + 301) is None




def test_production_api_requires_the_signed_session_and_ignores_room_header(monkeypatch):
    monkeypatch.setattr(settings, "SCHEMATIC_AUTH_MODE", "production")
    monkeypatch.setattr(settings, "SCHEMATIC_SESSION_SECRET", "test-only-session-secret-0123456789012345")
    client = TestClient(app)

    unauthenticated = client.post(
        "/api/simulation/run",
        headers={"X-Schematic-Room": "spoofed-room"},
        json={"project": {}},
    )
    assert unauthenticated.status_code == 401

    token = issue_session_token(SessionIdentity("alice", environment="cloudflare-access"))
    authenticated = client.post(
        "/api/simulation/run",
        headers={"Authorization": f"Bearer {token}", "X-Schematic-Room": "spoofed-room"},
        json={"project": {}},
    )
    assert authenticated.status_code == 200
    assert authenticated.json()["status"] == "no-firmware"
