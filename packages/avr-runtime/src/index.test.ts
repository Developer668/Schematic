import { describe, expect, it } from "vitest";
import { UnoAvr8jsAdapter, type Avr8jsModule, type AvrPort, type AvrCpu } from "./index";
import { sha256Hex } from "./hash";

const validHex = ":0400000001020304F2\n:00000001FF\n";

class FakePort implements AvrPort {
  private readonly listeners = new Set<(value: number, oldValue: number) => void>();
  private readonly values = new Array<number>(8).fill(2);

  addListener(listener: (value: number, oldValue: number) => void) { this.listeners.add(listener); }
  removeListener(listener: (value: number, oldValue: number) => void) { this.listeners.delete(listener); }
  pinState(index: number) { return this.values[index]; }
  setPin(index: number, value: boolean) {
    const old = this.values[index];
    this.values[index] = value ? 1 : 0;
    for (const listener of this.listeners) listener(this.values[index], old);
  }
}

class FakeCpu implements AvrCpu {
  cycles = 0;
  constructor(readonly program: Uint16Array) {}
}

function fakeModule(): Avr8jsModule {
  return {
    CPU: FakeCpu as unknown as Avr8jsModule["CPU"],
    avrInstruction: (cpu) => { cpu.cycles += 1; },
    AVRIOPort: FakePort as unknown as Avr8jsModule["AVRIOPort"],
    portBConfig: {},
    portCConfig: {},
    portDConfig: {},
  };
}

describe("Uno AVR artifact handoff", () => {
  it("rejects changed bytes and preserves the exact loaded artifact hash", async () => {
    const adapter = new UnoAvr8jsAdapter({ module: fakeModule() });
    const bytes = new TextEncoder().encode(validHex);
    const sha256 = await sha256Hex(bytes);
    await adapter.loadArtifact({ format: "intel-hex", text: validHex, bytes, sha256, targetFqbn: "arduino:avr:uno" });
    expect(adapter.getLoadedArtifactSha256()).toBe(sha256);
    expect(adapter.getCpuCycles()).toBe(0);
    expect(() => adapter.loadArtifact({ format: "intel-hex", text: validHex, bytes, sha256: "0".repeat(64) })).rejects.toThrow(/hash mismatch/);
  });

  it("maps Arduino digital pins to AVR ports and reports output transitions", async () => {
    const adapter = new UnoAvr8jsAdapter({ module: fakeModule() });
    const bytes = new TextEncoder().encode(validHex);
    await adapter.loadArtifact({ format: "intel-hex", text: validHex, bytes, sha256: await sha256Hex(bytes) });
    const events: Array<{ pin: number; value: number }> = [];
    adapter.onDigitalOutput((event) => events.push(event));
    adapter.setDigitalInput(13, 1);
    expect(adapter.readDigital(13)).toBe(1);
    expect(events.at(-1)).toEqual({ pin: 13, value: 1 });
    expect(adapter.run(3)).toEqual({ executedInstructions: 3, cancelled: false });
    expect(adapter.getCpuCycles()).toBe(3);
  });
});
