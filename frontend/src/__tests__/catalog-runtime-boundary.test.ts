import { beforeAll, describe, expect, it } from "vitest";
import { componentImportAnalyze } from "../../../functions/api/_catalog-runtime.ts";
import { issueSessionToken, type AuthEnv } from "../../../functions/_auth.ts";

const env: AuthEnv = {
  SCHEMATIC_AUTH_MODE: "chatgpt-sites",
  SCHEMATIC_DEPLOYMENT_ENV: "hosted",
  SCHEMATIC_SESSION_SECRET: "catalog-runtime-test-secret-with-32-bytes-minimum",
};

let authorization = "";

beforeAll(async () => {
  const token = await issueSessionToken({ subject: "test-user", environment: "chatgpt-sites" }, env);
  if (!token) throw new Error("Test session token was not issued");
  authorization = `Bearer ${token}`;
});

function request(body: string, contentLength?: string) {
  return new Request("https://example.chatgpt.site/api/components/import/analyze", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      ...(contentLength === undefined ? {} : { "content-length": contentLength }),
    },
    body,
  });
}

describe("component import analysis request boundary", () => {
  it("rejects an oversized streamed body when Content-Length is missing", async () => {
    const response = await componentImportAnalyze(request(JSON.stringify({ filenames: ["x".repeat(33 * 1024)] })), env);
    expect(response.status).toBe(413);
  });

  it("rejects an oversized streamed body when Content-Length lies low", async () => {
    const response = await componentImportAnalyze(request(JSON.stringify({ filenames: ["x".repeat(33 * 1024)] }), "1"), env);
    expect(response.status).toBe(413);
  });

  it("rejects an oversized declared body before JSON parsing", async () => {
    const response = await componentImportAnalyze(request("{}", String(33 * 1024)), env);
    expect(response.status).toBe(413);
  });

  it("keeps each file size aligned when blank filenames are filtered", async () => {
    const response = await componentImportAnalyze(request(JSON.stringify({ filenames: ["", "part.step"], fileSizes: [999, 123] })), env);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toMatchObject({ name: "part.step", size: 123 });
  });
});
