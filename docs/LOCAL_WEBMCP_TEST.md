# Genuine local WebMCP test

This test does not require hosting, a remote MCP server, UI automation, or an
application-owned executor. Chrome itself discovers and invokes the tools that
the page registered with `document.modelContext`.

## 1. Start the complete application

```powershell
cd D:\Schematic
pnpm dev:full
```

Confirm both URLs respond:

- `http://localhost:3000/studio/project/webmcp-proof`
- `http://localhost:8001/api/health`

## 2. Start a WebMCP-enabled Chrome

Schematic's local Chrome is version 152, which satisfies the current Chrome
DevTools MCP requirement. Launch a separate test profile with the native
`WebMCP` feature and local-only remote debugging enabled:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-webmcp-chrome.ps1
```

This does not change the normal Chrome profile. The test profile is stored at
`%LOCALAPPDATA%\SchematicWebMCPChrome`, and `.mcp.json` connects only to
`http://127.0.0.1:9222`.

## 3. Prove the page registration without an AI

1. Open `http://localhost:3000/studio/project/webmcp-proof` in that Chrome.
2. Open DevTools.
3. Select **Application > WebMCP**.
4. Confirm **Available Tools** contains 12 tools.
5. Select `project.apply_blueprint`.
6. Enter:

```json
{ "blueprintId": "meta-glasses" }
```

7. Select **Run tool**.
8. Confirm the visible canvas changes and the invocation appears as completed.
9. Run `design.auto_layout`, `project.get_graph`, and `validation.check` from
   the same panel.
10. Refresh and confirm the stable project URL still contains the build.

If the Application panel has no WebMCP entry and `document.modelContext` is
undefined, confirm that the studio was opened in the separate Chrome window
started by the script. Do not inject a polyfill.

## 4. Add an AI to the same local Chrome

Start an MCP-capable agent from this repository so it loads `.mcp.json`. Restart
the agent after changing MCP configuration. The agent must expose Chrome
DevTools tools including `list_webmcp_tools` and `execute_webmcp_tool`.

Prompt:

```text
Navigate to http://localhost:3000/studio/project/webmcp-proof.
List the page's WebMCP tools. Use project.apply_blueprint with blueprintId
"meta-glasses", then use design.auto_layout and validation.check. Do not use
DOM clicks, typing, REST calls, or an application-owned callback executor.
```

The AI portion passes only when Chrome's WebMCP invocation log records the
calls and the same visible canvas updates.

## 5. When hosting is required

Hosting is required only when the consuming browser runs on another machine,
such as Cloudflare Browser Run or a remote judge. A remote browser cannot reach
the Windows machine's `localhost`.

Do not expose the development-authenticated localhost server through a public
quick tunnel. Deploy the production build with authenticated Pages Functions
and the `SCHEMATIC_PROJECTS` KV binding instead.
