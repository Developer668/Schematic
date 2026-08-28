from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.simulation.behavioral import SUPPORTED_BOARD_FQBNS
from app.auth.session import SessionIdentity, require_session

router = APIRouter()

class SketchFile(BaseModel):
    name: str
    content: str

class CompileReq(BaseModel):
    files: list[SketchFile] | None = None
    code: str | None = None
    board_fqbn: str | None = None
    component_id: str | None = None
    definition_id: str | None = None
    language: str | None = None


def _source_sha256(files: list[SketchFile]) -> str:
    digest = hashlib.sha256()
    for source in files:
        digest.update(Path(source.name).name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(source.content.encode("utf-8"))
        digest.update(b"\0")
    return digest.hexdigest()


def _command_json(executable: str, *arguments: str) -> dict | list | None:
    """Read optional compiler metadata without making compilation depend on it."""
    try:
        process = subprocess.run(
            [executable, *arguments],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if process.returncode != 0 or not process.stdout.strip():
        return None
    try:
        parsed = json.loads(process.stdout)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, (dict, list)) else None


def _compiler_metadata(executable: str, fqbn: str) -> dict[str, object]:
    version_payload = _command_json(executable, "version", "--format", "json")
    compiler_version = None
    if isinstance(version_payload, dict):
        compiler_version = version_payload.get("Version") or version_payload.get("version")

    # arduino-cli has emitted both a top-level list and a {platforms: []}
    # envelope across releases. Keep the exact FQBN in the identity even when
    # the installed CLI cannot provide a machine-readable core version.
    core_payload = _command_json(executable, "core", "list", "--format", "json")
    core_version = None
    platforms = core_payload.get("platforms", []) if isinstance(core_payload, dict) else core_payload
    if isinstance(platforms, list):
        package, architecture = fqbn.split(":", 2)[:2]
        for platform in platforms:
            if not isinstance(platform, dict):
                continue
            if str(platform.get("id", "")).startswith(f"{package}:{architecture}"):
                core_version = platform.get("version")
                break

    return {
        "name": "arduino-cli",
        "version": str(compiler_version) if compiler_version is not None else None,
        "core": {
            "fqbn": fqbn,
            "version": str(core_version) if core_version is not None else None,
        },
    }

def _compile(files: list[SketchFile], fqbn: str) -> dict:
    executable = shutil.which("arduino-cli")
    if not executable:
        raise HTTPException(status_code=503, detail="arduino-cli is not installed or is not available on PATH")
    if not files:
        raise HTTPException(status_code=422, detail="At least one source file is required")

    with tempfile.TemporaryDirectory(prefix="schematic-compile-") as temp:
        root = Path(temp)
        sketch = root / "sketch"
        output = root / "output"
        sketch.mkdir(); output.mkdir()
        for source in files:
            safe_name = Path(source.name).name
            if not safe_name or safe_name in {".", ".."}:
                raise HTTPException(status_code=422, detail="Invalid source filename")
            (sketch / safe_name).write_text(source.content, encoding="utf-8")
        if not any(path.suffix.lower() == ".ino" for path in sketch.iterdir()):
            (sketch / "sketch.ino").write_text(files[0].content, encoding="utf-8")

        process = subprocess.run(
            [executable, "compile", "--fqbn", fqbn, "--output-dir", str(output), str(sketch)],
            capture_output=True, text=True, timeout=120, check=False,
        )
        if process.returncode != 0:
            return {"success": False, "hex_content": None, "binary_content": None, "binary_type": None, "stdout": process.stdout, "stderr": process.stderr, "error": "Compilation failed", "simulation_ready": False}
        artifact = next(iter(output.glob("*.hex")), None) or next(iter(output.glob("*.bin")), None)
        if artifact is None:
            raise HTTPException(status_code=500, detail="Compiler succeeded but produced no HEX or BIN artifact")
        is_hex = artifact.suffix.lower() == ".hex"
        artifact_bytes = artifact.read_bytes()
        return {
            "success": True,
            "hex_content": artifact.read_text(encoding="utf-8", errors="replace") if is_hex else None,
            "binary_content": None if is_hex else artifact_bytes.hex(),
            "binary_type": artifact.suffix.lower().lstrip("."),
            "stdout": process.stdout,
            "stderr": process.stderr,
            "error": None,
            "simulation_ready": True,
            "artifact_identity": {
                "artifact_name": artifact.name,
                "artifact_sha256": hashlib.sha256(artifact_bytes).hexdigest(),
                "compiler": _compiler_metadata(executable, fqbn),
            },
        }

@router.post("")
async def compile(req: CompileReq, _identity: SessionIdentity = Depends(require_session)):
    files = req.files or ([SketchFile(name="sketch.ino", content=req.code)] if req.code else [])
    component_id = (req.component_id or "").strip()
    definition_id = (req.definition_id or "").strip()
    if not component_id:
        raise HTTPException(status_code=422, detail="component_id is required; compilation must be bound to a board instance")
    if not definition_id:
        raise HTTPException(status_code=422, detail="definition_id is required; compilation must be bound to an exact board definition")
    fqbn = (req.board_fqbn or "").strip()
    if not fqbn:
        raise HTTPException(status_code=422, detail="board_fqbn is required; compilation must be explicitly targeted to a board")
    if definition_id:
        expected_fqbn = SUPPORTED_BOARD_FQBNS.get(definition_id)
        if expected_fqbn is None:
            raise HTTPException(status_code=422, detail=f"No compiler profile is registered for board definition {definition_id}")
        if fqbn != expected_fqbn:
            raise HTTPException(status_code=422, detail=f"{definition_id} requires {expected_fqbn}; refusing compilation for {fqbn}")
    if req.language and req.language not in {"arduino", "c"}:
        raise HTTPException(status_code=422, detail=f"The arduino-cli compiler does not support {req.language} firmware")
    result = await asyncio.to_thread(_compile, files, fqbn)
    source_sha256 = _source_sha256(files)
    if not result.get("success"):
        result["target"] = {
            "component_id": component_id,
            "definition_id": definition_id,
            "language": req.language or "arduino",
            "board_fqbn": fqbn,
        }
        result["artifact_identity"] = {
            "component_id": component_id,
            "definition_id": definition_id,
            "source_sha256": source_sha256,
            "artifact_name": None,
            "artifact_sha256": None,
            "board_fqbn": fqbn,
            "language": req.language or "arduino",
            "compiler": None,
        }
        # A compiler diagnostic is an unsuccessful operation, not a successful
        # HTTP request with a false field. Preserve stdout/stderr in the body.
        return JSONResponse(status_code=422, content=result)
    result["target"] = {
        "component_id": component_id,
        "definition_id": definition_id,
        "language": req.language or "arduino",
        "board_fqbn": fqbn,
    }
    result["artifact_identity"] = {
        "component_id": component_id,
        "definition_id": definition_id,
        "source_sha256": source_sha256,
        "board_fqbn": fqbn,
        "language": req.language or "arduino",
        **(result.pop("artifact_identity", {})),
    }
    return result
