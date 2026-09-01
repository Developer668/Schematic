"""Authenticated durable workspace storage for local development."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.session import SessionIdentity, require_session

router = APIRouter()
_DB_PATH = Path(__file__).resolve().parents[4] / "data" / "schematic.db"
_LOCK = Lock()
_MAX_WORKSPACE_BYTES = 10_000_000


class WorkspaceWrite(BaseModel):
    workspace: dict[str, Any]
    expectedRevision: int | None = None


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(_DB_PATH)
    connection.execute("CREATE TABLE IF NOT EXISTS workspaces (subject TEXT PRIMARY KEY, workspace TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL)")
    return connection


def _validate(workspace: dict[str, Any]) -> None:
    if workspace.get("version") != 1 or not isinstance(workspace.get("activeProjectId"), str) or not isinstance(workspace.get("projects"), list):
        raise HTTPException(status_code=422, detail="Invalid workspace")
    if len(workspace["projects"]) > 128:
        raise HTTPException(status_code=422, detail="Workspace has too many projects")
    if len(json.dumps(workspace, separators=(",", ":")).encode()) > _MAX_WORKSPACE_BYTES:
        raise HTTPException(status_code=413, detail="Workspace exceeds 10 MB")


@router.get("/workspace")
def get_workspace(identity: SessionIdentity = Depends(require_session)):
    with _LOCK, _connect() as connection:
        row = connection.execute("SELECT workspace, revision, updated_at FROM workspaces WHERE subject = ?", (identity.subject,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return {"workspace": json.loads(row[0]), "revision": row[1], "updatedAt": row[2]}


@router.put("/workspace")
def put_workspace(body: WorkspaceWrite, identity: SessionIdentity = Depends(require_session)):
    _validate(body.workspace)
    with _LOCK, _connect() as connection:
        row = connection.execute("SELECT revision FROM workspaces WHERE subject = ?", (identity.subject,)).fetchone()
        current_revision = int(row[0]) if row else 0
        if row and body.expectedRevision is not None and body.expectedRevision != current_revision:
            raise HTTPException(status_code=409, detail={"error": "Revision conflict", "revision": current_revision})
        revision = current_revision + 1
        updated_at = datetime.now(timezone.utc).isoformat()
        payload = json.dumps(body.workspace, separators=(",", ":"))
        connection.execute(
            "INSERT INTO workspaces(subject, workspace, revision, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(subject) DO UPDATE SET workspace=excluded.workspace, revision=excluded.revision, updated_at=excluded.updated_at",
            (identity.subject, payload, revision, updated_at),
        )
        connection.commit()
    return {"workspace": body.workspace, "revision": revision, "updatedAt": updated_at}
