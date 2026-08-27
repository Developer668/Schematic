<div align="center">
  <img src="frontend/public/schematic-logo.png" width="118" alt="Schematic logo" />

  # Schematic

  **An agent-native workspace for designing and programming connected hardware.**

  [![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-f97316.svg)](LICENSE)
  [![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
  [![FastAPI](https://img.shields.io/badge/FastAPI-backend-009688.svg)](https://fastapi.tiangolo.com/)
  [![WebMCP](https://img.shields.io/badge/WebMCP-42_tools-8b5cf6.svg)](frontend/src/webmcp/tools.ts)
</div>

---

Schematic combines a visual hardware canvas, component catalog, firmware editor, validation tools, and WebMCP controls in one local-first studio. Humans and compatible agents operate on the same structured project graph.

## Highlights

- Visual drag-and-drop hardware workspace with typed connections
- Recognizable artwork for boards, sensors, displays, and modules
- Firmware editing with Monaco
- Inspector, project explorer, validation, terminal, and debug panels
- 42 WebMCP tools for project, component, wiring, firmware, simulation, workspace, and parts procurement operations
- FastAPI backend with honest local engine availability reporting
- Portable JSON-based project format

## Run locally

Requirements: Node.js 18+, pnpm 9+, and Python 3.11+.

```bash
git clone https://github.com/Developer668/Schematic.git
cd Schematic
pnpm install
pnpm dev
```

The frontend opens at `http://localhost:3000`.

Start the backend in another terminal:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r backend/requirements.txt
python -m uvicorn app.main:app --port 8001 --app-dir backend
```

API documentation is available at `http://localhost:8001/api/docs`.

## Verify

```bash
pnpm --filter frontend lint
pnpm --filter frontend test
pnpm --filter frontend build
python -m pytest backend/tests -q
```

External simulation engines such as Renode, QEMU, Verilator, and ngspice are detected from the local system. Missing engines are reported as unavailable instead of being simulated as successful.

## License

Schematic is licensed under [AGPL-3.0](LICENSE). Third-party components retain their original licenses; see [NOTICE](NOTICE).
