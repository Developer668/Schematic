# WebMCP Tools — 18 semantic hardware operations

All registered via `document.modelContext.registerTool({name,description,inputSchema,execute,annotations},{signal})` (WebMCP draft 26 Aug 2026). Each `execute` reuses same Zustand function human UI uses.

| Name | Description | Schema |
|------|-------------|--------|
| `project.get_graph` | Get full hardware graph (components, connections, firmware) | `{}` |
| `project.clear` | Clear project | `{}` |
| `component.search` | Search catalog (query, category, domain) | `{query?, category?, domain?}` |
| `component.inspect` | Inspect definition (ports, models, fidelity) | `{componentId}` |
| `component.add` | Add component at x,y | `{componentId, x?, y?}` → `{instanceId}` |
| `component.remove` | Remove instance | `{instanceId}` |
| `component.list_ports` | List ports for instance/def | `{componentId}` |
| `connection.connect` | Connect two ports (typed validation) | `{sourceComponentId, sourcePortId, targetComponentId, targetPortId}` |
| `connection.disconnect` | Remove connection | `{connectionId}` |
| `connection.get_connections` | Get all connections | `{}` |
| `firmware.write` | Write firmware files for board | `{componentId, files:[{name,content}]}` |
| `firmware.compile` | Compile via backend `/api/compile` | `{componentId, boardFqbn?}` |
| `simulation.run` | Run simulation | `{durationMs?}` |
| `simulation.stop` | Stop | `{}` |
| `simulation.get_state` | Running, timeNs, pinStates, engineStatus | `{}` |
| `simulation.set_input` | Set sensor input (motion, temperature…) | `{componentId, key, value}` |
| `validation.check` | Validate design (voltage, ground, I2C…) | `{}` |
| `validation.explain_error` | Explain code → fix guidance | `{code}` |
| `design.auto_layout` | Grid auto-layout | `{}` |

### Feature detection (use Chrome 146 + flag)

```js
const mc = document.modelContext ?? navigator.modelContext;
if (mc?.registerTool) { await mc.registerTool(tool, {signal}); }
else { window.__schematicTools[name] = execute; } // fallback
await document.modelContext.getTools(); // discover
await document.modelContext.executeTool(tool, {componentId:"esp32-s3"});
```

### Annotations

- `readOnlyHint:true` for `get_graph`, `search`, `inspect`, `list_ports`, `get_connections`, `get_state`, `check`.

### Permissions

- Requires SecureContext (HTTPS) and `Permissions-Policy: tools=(self)`. Cross-origin use `exposedTo`/`fromOrigins`.
