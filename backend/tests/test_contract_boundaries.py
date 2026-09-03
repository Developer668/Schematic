import asyncio
import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.api.routes.compile import CompileReq, SketchFile, _source_sha256, compile as compile_firmware
from app.api.routes import compile as compile_route
from app.api.routes.components import CATALOG, get_one, search
from app.api.routes import parts as parts_route
from app.api.routes.parts import search as search_parts
from app.simulation.orchestrator import SimulationOrchestrator
from test_orchestrator import rtc_led_project


def test_backend_catalog_exposes_the_full_canonical_dataset_and_searches_it():
    assert len(CATALOG) >= 500
    result = search(q="bmp280")
    assert result["count"] >= 1
    assert any(item["id"] == "bmp280" for item in result["results"])
    assert result["source"] == "canonical-components-metadata"
    assert "validation:metadata-only" in result["modelCoverage"]


def test_unknown_component_is_a_real_not_found_error():
    with pytest.raises(HTTPException) as error:
        get_one("does-not-exist")
    assert error.value.status_code == 404


def test_parts_provider_returns_live_brightdata_discovery_without_promoting_cart_records(monkeypatch):
    parts_route._cache.clear()
    parts_route._inflight.clear()
    monkeypatch.setattr(parts_route.settings, "BRIGHTDATA_API_KEY", "test-key")
    monkeypatch.setattr(parts_route.settings, "BRIGHTDATA_SERP_ZONE", "serp_api1")

    async def fake_fetch(_query: str):
        return 200, {"content-type": "application/json"}, json.dumps({
            "general": {"search_type": "shopping"},
            "shopping": [{
                "title": "Bosch BMP280 pressure sensor breakout",
                "price": "$8.95",
                "shop": "Example Electronics",
                "link": "https://retailer.example/bmp280",
                "shipping": "Free shipping",
                "rating": 4.7,
                "reviews_cnt": 128,
                "rank": 1,
            }],
        })

    monkeypatch.setattr(parts_route, "_fetch_brightdata", fake_fetch)
    response = asyncio.run(search_parts(query="BMP280", quantity=2, request_id="parts-test-brightdata"))
    body = json.loads(response.body)
    assert response.status_code == 200
    assert body["code"] == "LIVE_SHOPPING_RESULTS"
    assert body["source"] == "brightdata-serp"
    assert body["cartEligible"] is False
    assert body["candidates"][0]["price"] == pytest.approx(8.95)
    assert body["candidates"][0]["rating"] == pytest.approx(4.7)
    assert body["candidates"][0]["retailer"] == "Example Electronics"
    assert body["candidates"][0]["verificationUrl"] == "https://retailer.example/bmp280"
    assert body["publication"]["required"] is True


def test_parts_provider_is_explicitly_unavailable_without_server_credential(monkeypatch):
    parts_route._cache.clear()
    parts_route._inflight.clear()
    monkeypatch.setattr(parts_route.settings, "BRIGHTDATA_API_KEY", "")
    response = asyncio.run(search_parts(query="bmp280", quantity=2, request_id="parts-test-no-key"))
    body = json.loads(response.body)
    assert response.status_code == 503
    assert body["code"] == "PARTS_PROVIDER_NOT_CONFIGURED"
    assert body["liveOffers"] is False


def test_compile_contract_refuses_unknown_or_mismatched_board_identity():
    files = [SketchFile(name="sketch.ino", content="void setup(){} void loop(){}")]

    async def exercise():
        with pytest.raises(HTTPException) as unknown:
            await compile_firmware(CompileReq(files=files, board_fqbn="esp32:esp32:esp32", definition_id="does-not-exist"))
        assert unknown.value.status_code == 422

        with pytest.raises(HTTPException) as mismatch:
            await compile_firmware(CompileReq(files=files, board_fqbn="arduino:avr:uno", definition_id="esp32-devkit-v1"))
        assert mismatch.value.status_code == 422

    asyncio.run(exercise())


def test_compile_source_identity_is_deterministic():
    files = [SketchFile(name="main.ino", content="void setup(){}"), SketchFile(name="config.h", content="#define X 1")]
    assert _source_sha256(files) == _source_sha256(files)
    assert _source_sha256(files) != _source_sha256([SketchFile(name="main.ino", content="void setup(){}")])


def test_compile_failure_is_an_unsuccessful_http_response(monkeypatch):
    def failed_compile(_files, _fqbn):
        return {"success": False, "error": "compiler failed", "stdout": "", "stderr": "bad syntax"}

    monkeypatch.setattr(compile_route, "_compile", failed_compile)

    async def exercise():
        response = await compile_firmware(CompileReq(
            files=[SketchFile(name="main.ino", content="void setup(){} void loop(){}")],
            board_fqbn="esp32:esp32:esp32",
            component_id="board-1",
            definition_id="esp32-devkit-v1",
        ))
        assert response.status_code == 422
        assert json.loads(response.body)["success"] is False

    asyncio.run(exercise())


def test_simulation_sessions_are_owner_scoped_and_reexecution_step_is_deterministic():
    async def exercise():
        orchestrator = SimulationOrchestrator()
        result = await orchestrator.run(rtc_led_project(), {}, 1_000_000, "owned-session", "room-a")
        assert result["session_id"] == "owned-session"
        with pytest.raises(PermissionError):
            await orchestrator.state("owned-session", "room-b")
        stepped = await orchestrator.advance_to(2_000_000, "owned-session", "room-a")
        assert stepped["time_ns"] == 2_000_000
        assert stepped["programs"]

    asyncio.run(exercise())


def test_reused_session_rebinds_when_the_project_graph_changes():
    async def exercise():
        orchestrator = SimulationOrchestrator()
        project = rtc_led_project()
        first = await orchestrator.run(project, {}, 1_000_000, "same-session", "room-a")
        assert first["programs"]
        changed = {**project, "firmwareTargets": [{
            **project["firmwareTargets"][0],
            "files": [{"name": "main.ino", "content": "void setup() {} void loop() {}"}],
        }]}
        second = await orchestrator.run(changed, {}, 1_000_000, "same-session", "room-a")
        assert second["session_id"] == "same-session"
        assert second["programs"][0]["writes"] == 0
        assert second["time_ns"] == 1_000_000

    asyncio.run(exercise())


def test_behavioral_runtime_refuses_unknown_calls_and_malformed_source():
    project = rtc_led_project()
    project["firmwareTargets"][0]["files"][0]["content"] = "void setup() { unknownDevice.begin(); } void loop() {}"
    result = SimulationOrchestrator()

    async def exercise():
        unsupported = await result.run(project, {}, 1_000_000, "unsupported", "room")
        assert unsupported["status"] == "unsupported-api"
        assert "C++:unknownDevice.begin" in unsupported["unsupported_apis"]
        project["firmwareTargets"][0]["files"][0]["content"] = "void setup() {"
        malformed = await SimulationOrchestrator().run(project, {}, 1_000_000, "malformed", "room")
        assert malformed["status"] == "invalid-target"
        assert any(issue["code"] == "MALFORMED_FIRMWARE" for issue in malformed["target_issues"])

    asyncio.run(exercise())


def test_legacy_velxio_reference_is_quarantined_from_active_backend_imports():
    app_root = Path(__file__).resolve().parents[1] / "app"
    legacy_root = app_root / "velxio_reference"
    for path in app_root.rglob("*.py"):
        if legacy_root in path.parents:
            continue
        text = path.read_text(encoding="utf-8")
        assert "velxio_reference" not in text, f"active backend imports quarantined legacy path: {path}"
