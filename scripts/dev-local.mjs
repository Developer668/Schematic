import { spawn } from "node:child_process";

const environment = {
  ...process.env,
  SCHEMATIC_DEPLOYMENT_ENV: "local",
  SCHEMATIC_AUTH_MODE: "development",
};
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const python = process.platform === "win32" ? "python" : "python3";

const backend = spawn(python, ["-m", "uvicorn", "app.main:app", "--reload", "--port", "8001", "--app-dir", "backend"], {
  cwd: process.cwd(),
  env: environment,
  stdio: "inherit",
});
const frontend = spawn(pnpm, ["--filter", "frontend", "dev"], {
  cwd: process.cwd(),
  env: environment,
  stdio: "inherit",
});

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  backend.kill();
  frontend.kill();
  process.exitCode = exitCode;
}

backend.on("exit", (code) => stop(code ?? 1));
frontend.on("exit", (code) => stop(code ?? 1));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
