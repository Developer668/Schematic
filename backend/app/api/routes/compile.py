from __future__ import annotations

import asyncio
import shutil
import subprocess
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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
        return {
            "success": True,
            "hex_content": artifact.read_text(encoding="utf-8", errors="replace") if is_hex else None,
            "binary_content": None if is_hex else artifact.read_bytes().hex(),
            "binary_type": artifact.suffix.lower().lstrip("."),
            "stdout": process.stdout,
            "stderr": process.stderr,
            "error": None,
            "simulation_ready": True,
        }

@router.post("")
async def compile(req: CompileReq):
    files = req.files or ([SketchFile(name="sketch.ino", content=req.code)] if req.code else [])
    fqbn = (req.board_fqbn or "").strip()
    if not fqbn:
        raise HTTPException(status_code=422, detail="board_fqbn is required; compilation must be explicitly targeted to a board")
    if req.language and req.language not in {"arduino", "c"}:
        raise HTTPException(status_code=422, detail=f"The arduino-cli compiler does not support {req.language} firmware")
    result = await asyncio.to_thread(_compile, files, fqbn)
    result["target"] = {
        "component_id": req.component_id,
        "definition_id": req.definition_id,
        "language": req.language or "arduino",
        "board_fqbn": fqbn,
    }
    return result
