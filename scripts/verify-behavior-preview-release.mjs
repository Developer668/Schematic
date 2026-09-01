#!/usr/bin/env node

/**
 * Release gate for the compiler-free Behavior Preview workflow.
 *
 * This is deliberately a static gate. It does not import the application or
 * run user source code. That makes it safe to run in CI, before a Site
 * package is created, and against a partially built checkout.
 *
 * The gate distinguishes the active authoring/preview surface from historical
 * tests, handoff documents, and the quarantined legacy runtime. The latter is
 * allowed to remain in the repository while the product moves to Behavior
 * Plans and editable source documents.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const notices = [];

function rel(file) {
  return relative(repoRoot, file) || ".";
}

function fail(check, message) {
  failures.push({ check, message });
}

function notice(message) {
  notices.push(message);
}

function sourceFiles(root, options = {}) {
  const directory = resolve(repoRoot, root);
  if (!existsSync(directory)) return [];
  const extensions = options.extensions ?? new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
  const skip = options.skip ?? (() => false);
  const result = [];

  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = resolve(current, entry.name);
      const relativeName = rel(file);
      if (skip(relativeName, entry)) continue;
      if (entry.isDirectory()) walk(file);
      else if (extensions.has(file.slice(file.lastIndexOf(".")))) result.push(file);
    }
  }

  walk(directory);
  return result.sort();
}

function read(file) {
  return readFileSync(file, "utf8");
}

function stripComments(value) {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

function importsIn(source) {
  const withoutComments = stripComments(source);
  const specifiers = [];
  const patterns = [
    /\b(?:from|import)\s*[{(]?\s*["']([^"']+)["']/g,
    /\b(?:require)\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of withoutComments.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1]);
    }
  }
  return [...new Set(specifiers)];
}

function sourceInventory() {
  const behavior = sourceFiles("packages/behavior/src");
  const frontend = sourceFiles("frontend/src", {
    skip: (name) => name.includes("/__tests__/") || name.startsWith("frontend/coverage/"),
  });
  const site = sourceFiles("chatgpt-site/app", {
    skip: (name) => name.startsWith("chatgpt-site/.next/") || name.startsWith("chatgpt-site/dist/"),
  });
  // Keep the server-side compatibility API inventory available for future
  // checks, but do not call it part of the browser preview dependency graph.
  // The compiler/simulation endpoints are intentionally dormant compatibility
  // routes until a separate hardware boundary is designed.
  const deployment = sourceFiles("functions", {
    skip: (name) => name.includes("/__tests__/") || name.includes("/tests/"),
  });
  const clientEntries = [
    resolve(repoRoot, "frontend/src/main.tsx"),
    resolve(repoRoot, "frontend/src/App.tsx"),
    resolve(repoRoot, "chatgpt-site/app/layout.tsx"),
    resolve(repoRoot, "chatgpt-site/app/[[...path]]/page.tsx"),
    resolve(repoRoot, "chatgpt-site/app/[[...path]]/SchematicClient.tsx"),
    resolve(repoRoot, "chatgpt-site/app/capabilities/page.tsx"),
  ].filter(existsSync);
  const serverEntries = site.filter((file) => /\/route\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file));
  return { behavior, frontend, site, deployment, clientEntries, serverEntries };
}

const inventory = sourceInventory();

function tsconfigAliases(configPath) {
  const absoluteConfig = resolve(repoRoot, configPath);
  if (!existsSync(absoluteConfig)) return [];
  const config = JSON.parse(read(absoluteConfig));
  const configDirectory = dirname(absoluteConfig);
  const baseDirectory = resolve(configDirectory, config.compilerOptions?.baseUrl ?? ".");
  return Object.entries(config.compilerOptions?.paths ?? {}).flatMap(([pattern, targets]) => {
    const target = Array.isArray(targets) ? targets[0] : undefined;
    return typeof target === "string" ? [{ pattern, target: resolve(baseDirectory, target) }] : [];
  }).sort((left, right) => right.pattern.length - left.pattern.length);
}

const frontendAliases = tsconfigAliases("frontend/tsconfig.json");
const siteAliases = tsconfigAliases("chatgpt-site/tsconfig.json");
const unresolvedInternalImports = new Set();

function aliasTarget(fromFile, specifier) {
  const aliases = rel(fromFile).startsWith("frontend/") ? frontendAliases : siteAliases;
  for (const alias of aliases) {
    const wildcard = alias.pattern.indexOf("*");
    if (wildcard < 0) {
      if (specifier === alias.pattern) return alias.target;
      continue;
    }
    const prefix = alias.pattern.slice(0, wildcard);
    const suffix = alias.pattern.slice(wildcard + 1);
    if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
    const capture = specifier.slice(prefix.length, specifier.length - suffix.length);
    return alias.target.replace("*", capture);
  }
  // Site client files intentionally import the frontend through a source-only
  // bridge that is configured by the Site package builder.
  if (specifier.startsWith("@frontend/")) return resolve(repoRoot, "frontend", specifier.slice("@frontend/".length));
  return undefined;
}

function resolvedSourceCandidate(base) {
  const extensionlessBase = base.replace(/\.(?:mjs|cjs|js|jsx)$/, "");
  const candidates = [base, extensionlessBase];
  for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) candidates.push(extensionlessBase + extension);
  for (const extension of [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) candidates.push(resolve(extensionlessBase, "index" + extension));
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

/**
 * Resolve the actual browser/Site client import closure. This is intentionally
 * narrower than "every file under frontend/src": quarantined files such as
 * useSimulationStore.ts and the old runtime can remain in the repository
 * without silently becoming release dependencies. Direct imports from an
 * active entrypoint still fail the boundary check below.
 */
function resolveSourceImport(fromFile, specifier) {
  const cleanSpecifier = specifier.split("?")[0].split("#")[0];
  let base;
  const configuredAlias = aliasTarget(fromFile, cleanSpecifier);
  if (configuredAlias) {
    base = configuredAlias;
  } else if (cleanSpecifier.startsWith(".")) {
    base = resolve(dirname(fromFile), cleanSpecifier);
  } else return undefined;
  const resolved = resolvedSourceCandidate(base);
  if (!resolved && /^(?:@schematic\/|@frontend\/|@\/)/.test(cleanSpecifier)) {
    unresolvedInternalImports.add(`${rel(fromFile)} imports unresolved internal alias ${cleanSpecifier}`);
  }
  return resolved;
}

function importClosure(entries) {
  const seen = new Set();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsIn(read(file))) {
      const resolved = resolveSourceImport(file, specifier);
      if (resolved && !seen.has(resolved)) pending.push(resolved);
    }
  }
  return [...seen].sort();
}

const activeClientFiles = importClosure(inventory.clientEntries);
const activeServerFiles = importClosure(inventory.serverEntries);
for (const message of unresolvedInternalImports) fail("active-import-resolution", `${message}. Update the app tsconfig alias or the release-gate resolver; internal aliases may never be silently skipped.`);

// ---------------------------------------------------------------------------
// 1. Shared Behavior System dependency boundary
// ---------------------------------------------------------------------------

const behaviorImportRules = [
  { label: "frontend source", test: (specifier) => specifier.includes("/frontend/") || specifier === "frontend" || specifier.startsWith("@schematic/frontend") },
  { label: "React", test: (specifier) => /^(?:react|react-dom)(?:\/|$)/.test(specifier) },
  { label: "Zustand", test: (specifier) => /^(?:zustand)(?:\/|$)/.test(specifier) },
  { label: "Monaco", test: (specifier) => /^(?:@monaco-editor|monaco-editor)(?:\/|$)/.test(specifier) },
  { label: "WebMCP", test: (specifier) => /(?:^|[\/@_-])webmcp(?:[\/@_-]|$)/i.test(specifier) },
  { label: "network package", test: (specifier) => /^(?:axios|node-fetch|cross-fetch|undici|ky|got)(?:\/|$)/.test(specifier) },
  { label: "browser package", test: (specifier) => /^(?:vite|webpack|esbuild|rollup|browser-toolchain)(?:\/|$)/.test(specifier) || /(?:^|\/)(?:browser|browser-toolchain)(?:\/|$)/i.test(specifier) },
  { label: "compiler package", test: (specifier) => /(?:^|[\/@_-])(?:compiler|compile|avr-runtime|firmware-harness)(?:[\/@_-]|$)/i.test(specifier) },
  { label: "runtime/simulation package", test: (specifier) => specifier.startsWith("node:") || /(?:^|\/)(?:runtime|simulation)(?:\/|$)/i.test(specifier) || /@schematic\/(?:runtime|simulation)(?:\/|$)/i.test(specifier) },
];

for (const file of inventory.behavior) {
  for (const specifier of importsIn(read(file))) {
    for (const rule of behaviorImportRules) {
      if (rule.test(specifier)) {
        fail("behavior-dependency-boundary", `${rel(file)} imports ${specifier} (${rule.label}). @schematic/behavior must stay framework-, browser-, network-, compiler-, and runtime-free; move that adapter to frontend/application code.`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Active application/Site dependency boundary
// ---------------------------------------------------------------------------

const legacyImportRules = [
  { label: "firmware harness", test: (specifier) => /(?:firmware-harness|@schematic\/firmware-harness)/i.test(specifier) },
  { label: "browser toolchain", test: (specifier) => /(?:browser-toolchain|@schematic\/browser-toolchain)/i.test(specifier) },
  { label: "AVR runtime", test: (specifier) => /(?:avr-runtime|@schematic\/avr-runtime)/i.test(specifier) },
  { label: "legacy simulation runtime", test: (specifier) => /(?:^|[\/._-])simulation[\/](?:runtime|portableHarness|protocolRuntime|SimulationEngine)(?:[\/._-]|$)/i.test(specifier) || /(?:^|[\/._-])(?:useSimulationStore|portableHarness|protocolRuntime|SimulationEngine)(?:[\/._-]|$)/i.test(specifier) },
  { label: "legacy firmware-model metadata", test: (specifier) => /(?:^|[\/._-])simulation[\/](?:modelContract|capabilityRegistry)(?:[\/._-]|$)/i.test(specifier) || /(?:^|[\/._-])(?:modelContract|capabilityRegistry)(?:[\/._-]|$)/i.test(specifier) },
];

for (const file of [...activeClientFiles, ...activeServerFiles]) {
  if (/(?:^|\/)frontend\/src\/simulation\/(?:runtime|portableHarness|protocolRuntime|SimulationEngine|modelContract|capabilityRegistry)\.[a-z]+$/i.test(rel(file))
    || /(?:^|\/)(?:packages\/(?:browser-toolchain|avr-runtime|firmware-harness)|frontend\/src\/store\/useSimulationStore)\//i.test(rel(file))) {
    fail("active-resolved-runtime-boundary", `${rel(file)} is reachable from the active Site/browser import closure. Alias or workspace-package imports may not hide legacy runtime/compiler/model metadata.`);
  }
}

for (const file of activeClientFiles) {
  for (const specifier of importsIn(read(file))) {
    for (const rule of legacyImportRules) {
      if (rule.test(specifier)) {
        fail("active-runtime-boundary", `${rel(file)} imports ${specifier} (${rule.label}). Keep the default web/Site workflow on typed Behavior Plans; quarantine legacy runtime/compiler adapters behind a future hardware boundary.`);
      }
    }
  }
}

for (const file of activeServerFiles) {
  for (const specifier of importsIn(read(file))) {
    for (const rule of legacyImportRules) {
      if (rule.test(specifier)) {
        fail("active-server-runtime-boundary", `${rel(file)} imports ${specifier} (${rule.label}). The active Site server graph must be compiler/runtime-free in source and may not depend on bundler tree-shaking for quarantine.`);
      }
    }
    if (/(?:^|\/)functions\/api\/_runtime(?:\.[a-z]+)?$/i.test(specifier) || /(?:^|\/)api\/_runtime(?:\.[a-z]+)?$/i.test(specifier)) {
      fail("active-server-runtime-boundary", `${rel(file)} imports the mixed legacy API runtime ${specifier}. Import the data-only Site API boundary instead.`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Default WebMCP registration
// ---------------------------------------------------------------------------

const webmcpFile = resolve(repoRoot, "frontend/src/webmcp/tools.ts");
const behaviorToolsFile = resolve(repoRoot, "frontend/src/webmcp/behaviorTools.ts");
const webmcpSource = existsSync(webmcpFile) ? read(webmcpFile) : "";
const behaviorToolsSource = existsSync(behaviorToolsFile) ? read(behaviorToolsFile) : "";
const registrationStart = webmcpSource.indexOf("const tools");
const registrationEnd = webmcpSource.indexOf("export const WEBMCP_TOOL_COUNT", registrationStart);
const registration = registrationStart >= 0
  ? webmcpSource.slice(registrationStart, registrationEnd >= 0 ? registrationEnd : undefined)
  : "";

if (!registration) {
  fail("webmcp-registration", "Could not locate the default `tools` registration array in frontend/src/webmcp/tools.ts. Keep one statically discoverable registration surface and expose it from App startup.");
} else {
  if (!registration.includes("...behaviorToolDefinitions")) {
    fail("webmcp-registration", "The default WebMCP registration does not spread `behaviorToolDefinitions`; behavior/code tools would not be available to the model in the normal Site startup path.");
  }

  const forbiddenToolNames = registration.match(/\bname\s*:\s*["'](?:firmware\.compile|simulation\.[^"']+)["']/g) ?? [];
  if (forbiddenToolNames.length > 0) {
    fail("webmcp-registration", `Default WebMCP registration contains deprecated compiler/simulation tools: ${[...new Set(forbiddenToolNames)].join(", ")}. Remove them from the default array; compatibility code may remain quarantined outside registration.`);
  }

  const forbiddenEndpoints = registration.match(/\/api\/(?:compile|simulation(?:\/|["'`]|$))[^\s"'`]*/g) ?? [];
  if (forbiddenEndpoints.length > 0) {
    fail("webmcp-registration", `Default WebMCP registration still contains legacy compiler/simulation endpoints: ${[...new Set(forbiddenEndpoints)].join(", ")}. Preview must call the Behavior System directly and code tools must only save/export source.`);
  }

  const requiredTools = [
    "behavior.get_capabilities",
    "behavior.plan.write",
    "behavior.preview",
    "behavior.invoke",
    "behavior.get_state",
    "code.write",
    "code.read",
    "code.export",
  ];
  for (const name of requiredTools) {
    const presentInDefinition = new RegExp(`\\bname\\s*:\\s*["']${escapeRegExp(name)}["']`).test(behaviorToolsSource);
    const presentInDefault = new RegExp(`\\bname\\s*:\\s*["']${escapeRegExp(name)}["']`).test(registration);
    if (!presentInDefinition || !presentInDefault && !registration.includes("...behaviorToolDefinitions")) {
      fail("webmcp-required-tools", `Required tool ${name} is absent from the default WebMCP surface. Define it in frontend/src/webmcp/behaviorTools.ts and include that definition in the startup registration.`);
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// 4. Exact catalog bindings for the initial profile set
// ---------------------------------------------------------------------------

const catalogFile = resolve(repoRoot, "frontend/src/data/catalog.ts");
const catalogSource = existsSync(catalogFile) ? stripComments(read(catalogFile)) : "";
const requiredBindings = [
  ["pushbutton", "momentary-input"],
  ["led", "digital-indicator"],
  ["lcd1602", "text-display"],
  ["buzzer", "buzzer"],
  ["relay", "relay"],
  ["servo", "rotary-actuator"],
  ["stepper-motor", "motor"],
  ["ntc-temperature-sensor", "numeric-sensor"],
];

for (const [componentId, profileId] of requiredBindings) {
  const key = escapeRegExp(componentId);
  const profile = escapeRegExp(profileId);
  const bindingPattern = new RegExp(`(?:["']${key}["']|\\b${key})\\s*:\\s*\\{[^}]{0,600}?profileId\\s*:\\s*["']${profile}["'][^}]{0,600}?profileVersion\\s*:\\s*1\\b`, "s");
  if (!bindingPattern.test(catalogSource)) {
    fail("catalog-profile-bindings", `Exact Behavior Profile binding is missing for ${componentId} → ${profileId}:v1 in frontend/src/data/catalog.ts. Add it to the explicit opt-in binding map; do not infer support from tags or category.`);
  }
}

// ---------------------------------------------------------------------------
// 5. Honesty copy and preview claims
// ---------------------------------------------------------------------------

const activeApplicationSource = activeClientFiles
  .filter((file) => !file.includes("/simulation/"))
  .map(read)
  .join("\n");

const honestyChecks = [
  {
    label: "preview disclaimer",
    test: /Scripted outcome\s*·\s*no code ran\s*·\s*wiring and hardware not verified/i,
    repair: "Keep a visible preview notice equivalent to `Scripted outcome · no code ran · wiring and hardware not verified.`.",
  },
  {
    label: "external source notice",
    test: /Editable source for external use/i,
    repair: "Label the code panel as editable source for external use.",
  },
  {
    label: "not compiled claim",
    test: /(?:has not|not) compiled/i,
    repair: "State that Schematic has not compiled the editable source.",
  },
  {
    label: "not uploaded claim",
    test: /(?:has not[^\.\n]{0,120}|not\s+)uploaded/i,
    repair: "State that Schematic has not uploaded the editable source to hardware.",
  },
  {
    label: "not physically tested claim",
    test: /(?:has not[^\.\n]{0,120}|not\s+)physically tested/i,
    repair: "State that physical hardware behavior has not been tested by Schematic.",
  },
  {
    label: "Behavior Plan/source separation",
    test: /Behavior Preview follows the Behavior Plan|source code[^.\n]{0,100}(?:not|never) (?:run|execut)/i,
    repair: "Explain that the Behavior Plan drives preview and source is not run by Schematic.",
  },
];

for (const check of honestyChecks) {
  if (!check.test.test(activeApplicationSource)) fail("honesty-copy", `${check.label} is absent from active frontend/Site source. ${check.repair}`);
}

const activePreviewFiles = inventory.frontend.filter((file) => [
  "/behavior/",
  "/application/behaviorCommands.ts",
  "/webmcp/behaviorTools.ts",
  "/components/canvas/ComponentVisualOverlay.tsx",
  "/components/layout/BottomDock.tsx",
  "/components/editor/MonacoWorkspace.tsx",
  "/pages/StudioPage.tsx",
].some((marker) => file.includes(marker)));

const previewSource = activePreviewFiles.map(read).join("\n");
const forbiddenPreviewClaims = [
  "sourceCodeExecuted",
  "sourceCodeCompiled",
  "hardwareUploaded",
  "physicalWiringVerified",
  "physicalBehaviorVerified",
  "physicallyTestedBySchematic",
];
const claimPattern = new RegExp(`\\b(?:${forbiddenPreviewClaims.join("|")})\\s*:\\s*true\\b`, "gi");
const forbiddenClaims = [...previewSource.matchAll(claimPattern)].map((match) => match[0]);
if (forbiddenClaims.length > 0) {
  fail("preview-claims", `Active preview results contain forbidden success claims (${[...new Set(forbiddenClaims)].join(", ")}). Preview output must keep compiler, upload, wiring, and physical-test claims false or explicitly unverified.`);
}

const forbiddenPreviewStatuses = previewSource.match(/\b(?:status|state)\s*:\s*["'](?:compiled|uploaded|physically-tested|hardware-verified)["']/gi) ?? [];
if (forbiddenPreviewStatuses.length > 0) {
  fail("preview-claims", `Active preview code emits compiler/hardware success status (${[...new Set(forbiddenPreviewStatuses)].join(", ")}). Use preview statuses such as ready, playing, paused, partial, or blocked; code lifecycle remains external.`);
}

if (/preflight\s+balanced_braces|balanced[_ -]?braces\s*:\s*true/i.test(activeApplicationSource)) {
  fail("honesty-copy", "Active product copy advertises a source preflight/balanced-braces result. Editable source is not parsed or checked in the compiler-free workflow.");
}

// ---------------------------------------------------------------------------
// 6. Built Site client asset quarantine check
// ---------------------------------------------------------------------------

const assetRoots = [
  resolve(repoRoot, "chatgpt-site/dist/client/_next/static"),
  resolve(repoRoot, "chatgpt-site/.next/static"),
].filter(existsSync);
const assetMarkers = [
  ["firmware harness", /(?:@schematic\/firmware-harness|firmware-harness|loadBundledButtonLedWasm)/i],
  ["browser toolchain", /(?:@schematic\/browser-toolchain|browser-toolchain)/i],
  ["AVR runtime", /(?:@schematic\/avr-runtime|avr-runtime)/i],
  ["legacy preview runtime", /(?:portableHarness|runFirmwareRuntime|createProtocolRuntime|SimulationEngine|compiled-c-wasm|simulation\.set_input)/i],
  ["legacy firmware-model metadata", /(?:inferModelContract|capabilityRegistryEntry|browser firmware model|Portable firmware calls)/i],
  ["deprecated compiler tool", /firmware\.compile/i],
  ["deprecated simulation tool", /simulation\.(?:run|stop|set_input|get_state)/i],
  ["legacy compiler endpoint", /\/api\/compile/i],
  ["legacy simulation endpoint", /\/api\/simulation/i],
];

function assetFiles(root) {
  return sourceFiles(relative(repoRoot, root), {
    extensions: new Set([".js", ".mjs", ".cjs", ".css", ".map"]),
  });
}

let assetCount = 0;
for (const root of assetRoots) {
  for (const file of assetFiles(root)) {
    assetCount += 1;
    const contents = read(file);
    for (const [label, marker] of assetMarkers) {
      if (marker.test(contents)) {
        fail("built-site-assets", `${rel(file)} contains a dormant ${label} marker (${marker}). Rebuild the Site after removing legacy runtime/compiler imports; stale client assets must never ship.`);
      }
    }
  }
}
if (assetRoots.length === 0) notice("No built Site client asset directory was present; the asset quarantine scan will run after the Site build.");
else notice(`Scanned ${assetCount} built Site client asset file${assetCount === 1 ? "" : "s"}.`);

const serverAssetRoots = [
  resolve(repoRoot, "chatgpt-site/dist/server"),
  resolve(repoRoot, "chatgpt-site/.next/server"),
].filter(existsSync);
let serverAssetCount = 0;
for (const root of serverAssetRoots) {
  for (const file of assetFiles(root)) {
    serverAssetCount += 1;
    const contents = read(file);
    for (const [label, marker] of assetMarkers) {
      if (marker.test(contents)) fail("built-site-server-assets", `${rel(file)} contains a dormant ${label} marker (${marker}). Rebuild the Site and keep the active server graph on the data-only API boundary.`);
    }
  }
}
if (serverAssetRoots.length === 0) notice("No built Site server asset directory was present; the server quarantine scan will run after the Site build.");
else notice(`Scanned ${serverAssetCount} built Site server asset file${serverAssetCount === 1 ? "" : "s"}.`);

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

if (failures.length > 0) {
  console.error(`Behavior Preview release gate: FAIL (${failures.length} check${failures.length === 1 ? "" : "s"})`);
  for (const [index, failure] of failures.entries()) console.error(`\n${index + 1}. [${failure.check}] ${failure.message}`);
  if (notices.length > 0) {
    console.error("\nNotes:");
    for (const item of notices) console.error(`- ${item}`);
  }
  process.exitCode = 1;
} else {
  console.log("Behavior Preview release gate: PASS");
  for (const item of notices) console.log(`- ${item}`);
}
