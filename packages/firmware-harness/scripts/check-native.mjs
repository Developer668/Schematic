import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const compiler = process.env.CC ?? "cc";
const probe = spawnSync(compiler, ["--version"], { stdio: "ignore" });
if (probe.error || probe.status !== 0) {
  console.log(`native harness: skipped (compiler '${compiler}' unavailable; no artifact claimed)`);
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "schematic-firmware-harness-"));
const output = join(dir, "native-harness");
try {
  execFileSync(compiler, [
    "-std=c11", "-Wall", "-Wextra", "-Werror",
    "-I", join(root, "firmware/include"),
    join(root, "firmware/src/button_led.c"), join(root, "firmware/tests/native_harness.c"),
    "-o", output,
  ], { cwd: root, stdio: "inherit" });
  execFileSync(output, { cwd: root, stdio: "inherit" });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
