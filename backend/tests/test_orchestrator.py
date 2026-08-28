import asyncio

from app.simulation.behavioral import BehavioralSession
from app.simulation.orchestrator import SimulationOrchestrator
from app.api.routes.simulation import RunReq, run as run_simulation


def rtc_led_project(fqbn="esp32:esp32:esp32"):
    return {
        "id": "rtc-led-test",
        "components": [
            {"id": "board-1", "definitionId": "esp32-devkit-v1", "properties": {}},
            {"id": "rtc-1", "definitionId": "ds3231", "properties": {"epochMs": 1704067200000}},
            {"id": "led-1", "definitionId": "led", "properties": {}},
        ],
        "connections": [
            {"source": {"componentId": "board-1", "portId": "SDA"}, "target": {"componentId": "rtc-1", "portId": "SDA"}, "domain": "i2c"},
            {"source": {"componentId": "board-1", "portId": "SCL"}, "target": {"componentId": "rtc-1", "portId": "SCL"}, "domain": "i2c"},
            {"source": {"componentId": "board-1", "portId": "3V3"}, "target": {"componentId": "rtc-1", "portId": "VCC"}, "domain": "power"},
            {"source": {"componentId": "board-1", "portId": "GND"}, "target": {"componentId": "rtc-1", "portId": "GND"}, "domain": "ground"},
            {"source": {"componentId": "board-1", "portId": "GPIO19"}, "target": {"componentId": "led-1", "portId": "IN"}, "domain": "gpio"},
        ],
        "firmwareTargets": [{
            "id": "fw-board-1",
            "componentId": "board-1",
            "definitionId": "esp32-devkit-v1",
            "boardFqbn": fqbn,
            "files": [{
                "name": "main.ino",
                "content": "#include <Wire.h>\nconstexpr int LED_PIN = 19;\nvoid setup() { Wire.begin(); }\nvoid loop() { Wire.beginTransmission(0x68); Wire.write(0x00); Wire.endTransmission(); Wire.requestFrom(0x68, 1); int seconds = Wire.read(); digitalWrite(LED_PIN, seconds % 2 == 0 ? HIGH : LOW); delay(1000); }",
            }],
        }],
    }


def test_partition_assigns_only_supported_behavioral_models():
    orchestrator = SimulationOrchestrator()
    parts = orchestrator.partition(rtc_led_project())
    assert list(parts) == ["behavioral"]
    assert {component["definitionId"] for component in parts["behavioral"].components} == {"esp32-devkit-v1", "ds3231", "led"}


def test_backend_behavioral_slice_routes_ds3231_registers_to_led():
    async def exercise():
        orchestrator = SimulationOrchestrator()
        result = await orchestrator.run(rtc_led_project(), {}, 1_001_000_000)
        assert result["status"] == "completed"
        assert result["runtime"] == "remote"
        assert result["execution_mode"] == "behavioral"
        assert result["outputs"]["led-1:IN"] is False
        reads = [event for event in result["protocol_events"] if event["kind"] == "i2c" and event["operation"] == "read"]
        assert reads[0]["address"] == 0x68
        assert reads[0]["data"] == [0]
        assert reads[0]["acknowledged"] is True
        assert reads[1]["data"] == [1]
        rtc = next(device for device in result["device_states"] if device["componentId"] == "rtc-1")
        assert rtc["values"]["seconds"] == 1
        assert result["warnings"] == []
    asyncio.run(exercise())


def test_backend_device_states_report_the_button_and_led_models_used_by_execution():
    project = {
        "id": "button-led-test",
        "components": [
            {"id": "board-1", "definitionId": "esp32-devkit-v1", "properties": {}},
            {"id": "button-1", "definitionId": "pushbutton", "properties": {}},
            {"id": "led-1", "definitionId": "led", "properties": {}},
        ],
        "connections": [
            {"source": {"componentId": "board-1", "portId": "GPIO18"}, "target": {"componentId": "button-1", "portId": "A"}, "domain": "gpio"},
            {"source": {"componentId": "board-1", "portId": "GPIO19"}, "target": {"componentId": "led-1", "portId": "IN"}, "domain": "gpio"},
        ],
        "firmwareTargets": [{
            "id": "fw-board-1",
            "componentId": "board-1",
            "definitionId": "esp32-devkit-v1",
            "boardFqbn": "esp32:esp32:esp32",
            "files": [{"name": "main.ino", "content": "constexpr int BUTTON_PIN = 18; constexpr int LED_PIN = 19; void setup() {} void loop() { digitalWrite(LED_PIN, digitalRead(BUTTON_PIN) == LOW); delay(10); }"}],
        }],
    }
    result = BehavioralSession(project).run({"button-1:pressed": True}, 50_000_000)
    states = {device["componentId"]: device for device in result["device_states"]}
    assert result["status"] == "completed"
    assert result["outputs"]["led-1:IN"] is True
    assert states["button-1"]["family"] == "digital-input"
    assert states["button-1"]["support"] == "behavioral"
    assert states["button-1"]["values"]["pressed"] is True
    assert states["led-1"]["family"] == "digital-output"
    assert states["led-1"]["values"]["value"] is True


def test_sessions_do_not_share_time_or_outputs_and_restore_is_deterministic():
    async def exercise():
        orchestrator = SimulationOrchestrator()
        first = await orchestrator.run(rtc_led_project(), {}, 1_001_000_000, "session-a")
        second_project = rtc_led_project()
        second_project["id"] = "other-project"
        second = await orchestrator.run(second_project, {}, 1_000_000, "session-b")
        assert first["session_id"] == "session-a"
        assert second["session_id"] == "session-b"
        assert (await orchestrator.state("session-a"))["time_ns"] == 1_001_000_000
        assert (await orchestrator.state("session-b"))["time_ns"] == 1_000_000

        snapshot = await orchestrator.snapshot("session-a")
        await orchestrator.advance_to(2_001_000_000, "session-a")
        await orchestrator.restore(snapshot, "session-a")
        restored = await orchestrator.state("session-a")
        assert restored["time_ns"] == 1_001_000_000
        assert restored["snapshot"]["runtime"]["outputs"] == snapshot["runtime"]["outputs"]
    asyncio.run(exercise())


def test_invalid_fqbn_is_reported_without_successful_execution():
    async def exercise():
        result = await SimulationOrchestrator().run(rtc_led_project("arduino:avr:uno"), {}, 1_000_000)
        assert result["status"] == "invalid-target"
        assert result["target_issues"][0]["code"] == "FIRMWARE_FQBN_MISMATCH"
        assert "led-1:IN" not in result["outputs"]
    asyncio.run(exercise())


def test_route_returns_remote_behavioral_result():
    async def exercise():
        response = await run_simulation(RunReq(project=rtc_led_project(), duration_ns=1_001_000_000))
        assert response["status"] == "completed"
        assert response["runtime"] == "remote"
        assert response["outputs"]["led-1:IN"] is False
    asyncio.run(exercise())


def test_direct_session_rejects_wrong_i2c_address_with_trace_warning():
    project = rtc_led_project()
    project["firmwareTargets"][0]["files"][0]["content"] = project["firmwareTargets"][0]["files"][0]["content"].replace("0x68", "0x69")
    result = BehavioralSession(project).run({}, 1_000_000)
    assert result["status"] == "completed-with-warnings"
    assert any(event["kind"] == "i2c" and event["acknowledged"] is False for event in result["protocol_events"])
    assert any(warning["code"] == "I2C_DEVICE_NOT_FOUND" for warning in result["warnings"])


def test_spi_transport_is_traced_and_does_not_claim_an_unimplemented_device_model():
    project = {
        "id": "spi-trace-test",
        "components": [
            {"id": "board-1", "definitionId": "esp32-devkit-v1", "properties": {}},
            {"id": "display-1", "definitionId": "tft-1-8-st7735-2", "properties": {}},
        ],
        "connections": [
            {"source": {"componentId": "board-1", "portId": "SCK"}, "target": {"componentId": "display-1", "portId": "SCL"}, "domain": "spi"},
            {"source": {"componentId": "board-1", "portId": "MOSI"}, "target": {"componentId": "display-1", "portId": "SDA"}, "domain": "spi"},
        ],
        "firmwareTargets": [{
            "id": "fw-board-1",
            "componentId": "board-1",
            "definitionId": "esp32-devkit-v1",
            "boardFqbn": "esp32:esp32:esp32",
            "files": [{"name": "main.ino", "content": "void setup() { SPI.begin(); } void loop() { SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0)); byte response = SPI.transfer(0xA5); SPI.endTransaction(); delay(10); }"}],
        }],
    }
    result = BehavioralSession(project).run({}, 25_000_000)
    transfers = [event for event in result["protocol_events"] if event["kind"] == "spi"]
    assert result["status"] == "completed-with-warnings"
    assert len(transfers) == 3
    assert transfers[0]["data"] == [0xA5]
    assert transfers[0]["acknowledged"] is False
    assert result["unsupported_apis"] == []
    assert any(warning["code"] == "SPI_DEVICE_MODEL_UNAVAILABLE" for warning in result["warnings"])


def test_uart_transport_records_tx_rx_and_consumes_an_injected_byte():
    project = {
        "id": "uart-trace-test",
        "components": [
            {"id": "board-1", "definitionId": "esp32-devkit-v1", "properties": {}},
            {"id": "module-1", "definitionId": "hc05-bluetooth", "properties": {}},
        ],
        "connections": [
            {"source": {"componentId": "board-1", "portId": "TX"}, "target": {"componentId": "module-1", "portId": "RXD"}, "domain": "uart"},
            {"source": {"componentId": "board-1", "portId": "RX"}, "target": {"componentId": "module-1", "portId": "TXD"}, "domain": "uart"},
        ],
        "firmwareTargets": [{
            "id": "fw-board-1",
            "componentId": "board-1",
            "definitionId": "esp32-devkit-v1",
            "boardFqbn": "esp32:esp32:esp32",
            "files": [{"name": "main.ino", "content": "void setup() {} void loop() { Serial.println(\"ready\"); if (Serial.available()) { int value = Serial.read(); Serial.write(value); } delay(10); }"}],
        }],
    }
    result = BehavioralSession(project).run({"module-1:rx": 65}, 15_000_000)
    uart = [event for event in result["protocol_events"] if event["kind"] == "uart"]
    assert result["status"] == "completed"
    assert result["serial_output"] == "ready\nready\n"
    assert any(event["direction"] == "rx" and event["data"] == [65] for event in uart)
    assert any(event["direction"] == "tx" and event["data"] == [65] for event in uart)
    assert result["unsupported_apis"] == []
