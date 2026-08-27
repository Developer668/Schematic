# Master Build Prompt: Agent-Native WebMCP Universal Hardware Studio

You are the principal engineer responsible for implementing and shipping this project. Work directly in the current repository. Your responsibility is to produce a complete, working, tested, deployable product—not a plan, architecture document, mockup, scaffold, or partial proof of concept.

Do not ask me routine implementation questions. Inspect the existing repository, source code, official documentation, examples, tests, licenses, and current APIs, then make sound engineering decisions yourself. Only stop for a secret or credential that cannot be obtained from the environment. When something is difficult, debug it and continue. Do not replace working systems merely to use a preferred framework.

Do not spend your response explaining directory layouts, hypothetical future work, generic best practices, or lengthy setup theory. Implement the application, run it, test it, fix it, deploy it when credentials are available, and report concrete results.

## Product Mission

Build an open-source, browser-based, agent-native virtual hardware workbench.

A human must be able to visually place hardware components on a canvas, connect their real ports, write firmware, validate the design, run simulation, manipulate virtual sensor inputs, inspect outputs, and save or export the project.

An AI agent must be able to perform the same operations through WebMCP using structured semantic tools without screenshots, vision, coordinate guessing, DOM clicking, or mouse automation.

The defining experience is:

> A user states a hardware goal, and an external WebMCP-capable agent searches the component library, adds components, inspects their ports, wires them correctly, writes firmware, compiles it, validates power and interfaces, runs the simulation, observes the result, diagnoses failures, and repairs the design while the human watches every action appear live on the canvas.

This must not be a generic chatbot wrapper. Do not build an internal chat assistant as the main product. The external agent communicates through WebMCP. The visual application is the shared workspace where the human and agent collaborate.

## Primary Source Projects

Inspect and use these current upstream projects and their official documentation:

```text
https://github.com/davidmonterocrespo24/velxio
https://github.com/renode/renode
https://github.com/xyflow/xyflow
https://github.com/ngspice/ngspice
https://webmachinelearning.github.io/webmcp/
https://renode.readthedocs.io/
```

Use Velxio as the working application foundation. Preserve and extend its existing React, Vite, TypeScript, Zustand, Monaco, component catalog, firmware compilation, simulation, project persistence, FastAPI bridge, and ngspice functionality.

Do not rewrite the existing Velxio canvas solely to use React Flow. Use the existing canvas if it already supports stable component IDs, programmatic placement, wiring, selection, and visual updates. Add `@xyflow/react` only when replacing a specific deficient subsystem creates a clear implementation advantage and does not jeopardize delivery.

Use Renode as an additional serious firmware and virtual-platform engine. Use an official prebuilt Renode release in the simulation runtime unless building from source is genuinely required. Inspect the Renode source and documentation to implement the adapter correctly.

Use ngspice, preferably the existing Velxio ngspice-WASM integration, for real electrical calculations where models exist.

## Licensing Requirements

Because this work directly derives from Velxio:

- License the resulting application under `AGPL-3.0-or-later`.
- Preserve all Velxio copyright and attribution notices.
- Preserve the original licenses and notices of Renode, ngspice, React Flow, Monaco, and every other dependency.
- Do not relicense copied or adapted Velxio code as Apache-2.0.
- Add an accessible About/Licenses view listing the project’s original contributions and upstream projects.
- Clearly identify which functionality existed upstream and which functionality was added for this hackathon.
- Do not redistribute vendor component models unless their license permits redistribution.
- For an external model whose redistribution status is unclear, store only source metadata and require the user to import the file themselves.
- Do not obscure the origin of copied or modified open-source code.

## Required Technology

Use the existing Velxio stack unless repository inspection proves a particular part must change:

- TypeScript for browser application logic, component schemas, graph operations, validation, and WebMCP.
- React and Vite for the web application.
- Zustand or the existing Velxio state layer for canonical browser state.
- Monaco Editor for firmware editing.
- Zod or an equivalent strongly typed schema system for input validation.
- Python and FastAPI for backend orchestration.
- WebSockets for real-time simulation state, serial output, diagnostics, and engine events.
- Renode in headless mode for supported firmware targets.
- Existing Velxio processor backends for boards they already handle well.
- Existing ngspice-WASM or a reliable ngspice worker for electrical simulation.
- IndexedDB or the existing Velxio persistence mechanism for local project persistence.
- Vercel for the public web frontend.
- Render or another persistent container host for Renode and other native simulation processes.

Do not move heavy native simulation processes into short-lived serverless functions. Vercel should host the browser application and lightweight HTTP functions. Renode and other persistent native workers should run in a containerized backend service.

## Core Architectural Rule

The canonical project state must belong to this application, not to React Flow, Renode, ngspice, or an individual simulator.

All human UI actions and all WebMCP actions must call the same application command layer.

For example:

```text
Human clicks “Add ESP32”
                    ┐
                    ├──> addComponent(command) ──> canonical state
Agent calls tool    │                            ──> canvas updates
hardware.component.add                      ─────> validation updates
                    ┘                            ──> undo history
```

Do not maintain one code path for humans and another code path for agents.

Every successful mutation must:

1. Validate its input.
2. Apply atomically.
3. Increment the project revision.
4. update the canvas immediately.
5. update validation results.
6. create an undoable history entry.
7. emit an activity event.
8. return structured machine-readable output.

Every failed mutation must leave the project unchanged and return a structured error.

## Canonical Hardware Model

Implement or normalize the existing Velxio project state into a canonical hardware model with the following concepts.

### Component Definition

A reusable component type must contain:

- Stable definition ID
- Name
- Manufacturer
- Part number
- Category
- Description
- Search tags
- Documentation/source references
- License metadata
- Ports
- Configurable parameters
- Electrical characteristics
- Protocol characteristics
- Visual representation
- Supported simulation models
- Supported firmware or driver information
- Model-fidelity information

### Component Instance

A component placed in a project must contain:

- Stable instance ID
- Reference to a component definition
- Human-readable instance name
- Position
- Rotation where supported
- Parameter overrides
- Current runtime state
- Assigned simulation engine
- Firmware target where applicable

### Port

Every connection point must be a typed port. At minimum support these domains:

```text
power
ground
gpio
digital
analog
adc
dac
pwm
i2c
spi
uart
can
usb
ethernet
pcie
csi
dsi
hdmi
displayport
rf
audio
mechanical
logical
```

A port can declare:

- Direction: input, output, bidirectional, passive
- Role: controller, target, host, device, source, sink, endpoint, root-complex, clock, chip-select, interrupt, reset, or other relevant role
- Minimum, nominal, and maximum voltage
- Maximum current
- Logic voltage
- Open-drain/open-collector behavior
- Pull-up or pull-down requirements
- Protocol version
- Bus address
- Number of lanes
- Maximum clock rate
- Bandwidth
- RF impedance and frequency range
- Whether the port is currently functional, metadata-only, or unsupported in simulation

### Nets and Buses

Do not represent every connection as only a two-ended visual line.

Support:

- Power nets with multiple endpoints
- Ground nets
- I²C buses
- SPI buses with shared clock/data and distinct chip-select lines
- CAN buses
- Multi-drop UART only when explicitly modeled
- Point-to-point GPIO and analog signals
- Higher-level functional links such as USB and Ethernet

Visual edges must map to these semantic nets and buses.

### Firmware Target

A programmable component must support:

- Target instance ID
- Language
- Source files
- Entry file
- Compiler configuration
- Build status
- Compiler output
- Firmware artifact
- Simulator assignment
- Last successful build hash

### Validation Issue

Every issue must contain:

- Stable issue code
- Severity: error, warning, or information
- Human-readable explanation
- Affected component and connection IDs
- Machine-readable details
- One or more suggested fixes
- Whether an automatic fix is available

### Project Revision

Maintain a monotonically increasing revision number.

Every WebMCP tool must return the revision it operated on and the new revision after a mutation. Reject or explicitly reconcile stale mutations where appropriate.

## Model Fidelity

Never imply that a component is fully simulated merely because it has a symbol or image.

Each component must display coverage for these model layers:

```text
visual
connection-aware
functional
firmware-visible
electrical
timing-aware
physical
thermal
rf
optical
hardware-validated
```

Use clear statuses:

```text
supported
partial
metadata-only
not-available
```

The component inspector and WebMCP output must disclose these statuses.

Examples:

- A STEP file provides geometry, not behavior.
- An SVD file provides registers, not complete peripheral behavior.
- A SPICE file provides electrical behavior, not firmware-visible behavior.
- A behavioral radar module can provide detections without claiming to model antennas or electromagnetic propagation.
- A Raspberry Pi or Jetson representation must not claim to reproduce proprietary GPU, CUDA, camera ISP, CSI PHY, or complete high-speed hardware unless an actual model exists.

## Component Library

Reuse as much of Velxio’s existing catalog as is reliable.

Ensure the final working demo library includes at least:

### Programmable boards

- One stable Arduino/AVR board
- One ESP32-family board when the current Velxio backend supports it reliably
- Raspberry Pi Pico or another RP2040 board
- One STM32 or other Cortex-M board simulated through Renode
- A generic Linux/SBC representation, clearly marked according to actual fidelity

### Basic electrical components

- Resistor
- Capacitor
- Diode
- LED
- RGB LED
- Push button
- Toggle switch
- Potentiometer
- 3.3 V supply
- 5 V supply
- Battery
- Voltage regulator
- Logic-level shifter
- Ground
- Breadboard or logical connection grouping when existing support is stable

### Sensors and inputs

- PIR motion sensor
- Temperature sensor
- Light sensor
- Ultrasonic distance sensor
- Generic analog sensor
- Generic I²C register sensor
- Generic SPI register sensor
- Rotary encoder

### Outputs and actuators

- Buzzer
- Relay
- Servo
- DC motor
- Motor driver
- OLED display
- LCD or TFT display
- UART terminal

### Communication

- MQTT or network-service abstraction
- Wi-Fi capability for boards where existing simulation supports it
- Ethernet functional connection where appropriate

Do not create fake active components merely to inflate the catalog. Every component must state its fidelity.

## Generic Behavioral Templates

Implement reusable declarative templates so new components do not require custom code for common cases.

At minimum support templates for:

- GPIO input
- GPIO output
- Analog voltage source
- I²C register device
- SPI register device
- UART command/response device
- EEPROM/register memory
- LED
- Button
- Buzzer
- Relay
- PWM-driven servo
- PWM-driven DC motor approximation
- Sensor with configurable values
- Display framebuffer or text display
- MQTT/network event source

A custom component created from one of these templates must become immediately usable by both humans and WebMCP agents.

Do not hardcode individual pairings such as `connectEsp32ToPIR`. Connections must work through typed ports and generic protocol rules.

## Connection and Design Validation

Implement a real rule engine operating on component and port metadata.

At minimum detect:

- Protocol/domain mismatch
- Output connected to output
- Invalid input-to-input connection
- Power connected directly to ground
- Supply polarity reversal
- Missing shared ground
- Voltage above a component or port maximum
- Logic-level incompatibility
- Insufficient supply current
- LED without current-limiting resistance
- Missing I²C pull-up resistors
- Duplicate I²C addresses on the same bus
- I²C SDA/SCL role mismatch
- SPI controller/target role mismatch
- Missing or conflicting SPI chip-select
- UART TX connected to TX
- UART RX connected to RX
- USB host connected to host
- USB device connected to device
- PCIe endpoint connected to endpoint
- Missing required power pins
- Unconnected mandatory pins
- Unsupported simulator/model combination
- Firmware target with no compatible engine
- Component configured outside supported parameter range

Validation must return precise issue codes and suggested fixes.

Examples:

```text
VOLTAGE_OVER_LIMIT
MISSING_COMMON_GROUND
LED_REQUIRES_RESISTOR
I2C_ADDRESS_CONFLICT
I2C_PULLUP_REQUIRED
UART_DIRECTION_CONFLICT
USB_ROLE_CONFLICT
INSUFFICIENT_SUPPLY_CURRENT
SIMULATION_MODEL_UNAVAILABLE
```

Where safe, expose an automatic fix, such as:

- Insert an appropriate resistor
- Insert a logic-level shifter
- Connect ground
- Assign a free I²C address
- Add I²C pull-up resistors
- Swap UART TX/RX
- Move a chip-select line

Automatic fixes must be implemented through the same normal command layer and remain undoable.

## WebMCP Implementation

Implement real WebMCP using the current official imperative API.

Register tools from the top-level document through:

```javascript
document.modelContext.registerTool({
  name,
  title,
  description,
  inputSchema,
  execute,
  annotations
});
```

Requirements:

- Feature-detect `document.modelContext`.
- Register tools only after application state is initialized.
- Avoid duplicate registration.
- Use an `AbortController` to unregister tools during teardown or hot reload.
- Use static, precise tool descriptions.
- Validate all tool inputs at runtime.
- Return `JSON.stringify(...)` results.
- Honor the execution callback’s `AbortSignal`.
- Mark read-only operations with `readOnlyHint: true`.
- Mark operations returning imported external content with `untrustedContentHint: true`.
- Do not put external or user-controlled text into tool descriptions.
- Sanitize imported content before returning it to an agent.
- Keep the actual WebMCP registration visible and easy for judges to find in the public source.

Implement a shared internal tool registry so the same definitions can also be invoked through a developer Tool Inspector when WebMCP is unavailable. The Tool Inspector is only a development/testing fallback. It must not replace actual `document.modelContext.registerTool()` registration.

### Standard Tool Result Contract

Every tool must return a JSON string representing:

```json
{
  "ok": true,
  "tool": "hardware.component.add",
  "summary": "Added ESP32 DevKit as esp32-1",
  "previousRevision": 12,
  "revision": 13,
  "data": {},
  "warnings": [],
  "errors": [],
  "suggestedNextActions": []
}
```

Errors must use:

```json
{
  "ok": false,
  "tool": "hardware.connection.connect",
  "summary": "Connection rejected",
  "previousRevision": 13,
  "revision": 13,
  "data": null,
  "warnings": [],
  "errors": [
    {
      "code": "VOLTAGE_OVER_LIMIT",
      "message": "The source is 5 V and the target accepts at most 3.6 V.",
      "componentIds": ["sensor-1", "mcu-1"],
      "portIds": ["sensor-1.OUT", "mcu-1.GPIO4"],
      "suggestedFixes": [
        "Insert a 5 V to 3.3 V logic-level shifter."
      ]
    }
  ],
  "suggestedNextActions": [
    {
      "tool": "hardware.component.search",
      "reason": "Find a compatible logic-level shifter."
    }
  ]
}
```

### Required WebMCP Tools

Implement all of these as real functioning tools.

#### `hardware.capabilities.get`

Return:

- Supported component categories
- Supported port domains
- Available simulation engines
- Engine health
- Supported firmware languages
- Supported import formats
- Current project revision
- WebMCP version/status
- Known fidelity limitations

This is read-only.

#### `hardware.project.get_state`

Inputs:

- Optional detail level
- Optional component IDs
- Optional inclusion of firmware and runtime state

Return the semantic project graph, not pixel-oriented UI data unless explicitly requested.

This is read-only.

#### `hardware.project.reset`

Clear the current project and initialize a new one.

Return the new project ID and revision.

#### `hardware.project.save`

Save the current project under a name and return its stable ID and exportable representation.

#### `hardware.component.search`

Inputs:

- Query
- Optional category
- Optional manufacturer
- Optional required interfaces
- Optional voltage constraints
- Optional fidelity requirements
- Result limit

Return stable component definition IDs, summaries, interfaces, voltage information, model coverage, and compatibility notes.

This is read-only.

#### `hardware.component.inspect`

Accept a definition ID or instance ID.

Return:

- Full port list
- Electrical limits
- Protocol roles
- Parameters
- Model coverage
- Simulation engines
- Firmware compatibility
- Source/license metadata
- Known limitations

This is read-only.

#### `hardware.component.add`

Inputs:

- Component definition ID
- Optional instance name
- Optional semantic placement hint
- Optional exact position
- Optional parameter overrides

Add the component and return its stable instance ID and ports.

#### `hardware.component.create_custom`

Create a declarative custom component from:

- Name
- Category
- Manufacturer/part number when known
- Ports
- Electrical constraints
- Parameters
- Behavioral template
- Model coverage
- Source/license information

It must immediately appear in the component library and be addable to the project.

#### `hardware.component.configure`

Inputs:

- Instance ID
- Parameter patch

Validate and update component parameters.

#### `hardware.component.remove`

Remove an instance and its connections atomically.

Return removed connection IDs and resulting warnings.

#### `hardware.connection.get_valid_targets`

Inputs:

- Source instance ID
- Source port ID

Return compatible target ports ranked by compatibility, including required adapters such as resistors or level shifters.

This is read-only.

#### `hardware.connection.connect`

Inputs:

- Source instance/port
- Target instance/port
- Optional bus/net ID
- Optional `autoInsertProtection`
- Optional `allowWarning`

Perform semantic connection validation.

When `autoInsertProtection` is true, safely insert required resistors, pull-ups, or level shifting when a deterministic solution exists. Return all inserted components and connections.

#### `hardware.connection.disconnect`

Disconnect by connection ID or endpoint pair.

#### `hardware.design.apply_batch`

Accept a list of component, configuration, and connection operations.

Requirements:

- Execute atomically.
- Validate all operations before commit where possible.
- Roll back the entire batch if a required operation fails.
- Return an operation-by-operation result.
- Create one undo history entry.
- This tool exists so agents can build efficiently without dozens of unnecessary round trips.

#### `hardware.design.auto_layout`

Arrange the project using semantic grouping:

- Power components together
- Controller near connected peripherals
- Bus-connected devices aligned
- Inputs and outputs separated sensibly
- Wires routed legibly
- No node overlaps

Return changed positions.

#### `hardware.validation.run`

Inputs:

- Optional scope
- Optional strictness
- Optional request for automatic-fix proposals

Return all validation issues, power summary, bus summary, unsupported-model warnings, and suggested fixes.

This is read-only unless explicit automatic fixes are requested through a separate mutation.

#### `hardware.validation.apply_fix`

Inputs:

- Validation issue ID
- Selected fix ID

Apply one deterministic repair through the normal command layer.

#### `hardware.firmware.set_source`

Inputs:

- Target component instance
- Language
- Source files
- Entry file

Store firmware source and update Monaco immediately.

#### `hardware.firmware.compile`

Compile firmware for the selected target using the existing Velxio compiler path or the proper supported toolchain.

Return:

- Success
- Compiler messages
- Warnings
- Artifact metadata
- Binary size
- Target engine
- Build hash

Do not return success without producing a real artifact.

#### `hardware.simulation.start`

Inputs:

- Optional engine mode
- Optional duration
- Optional speed
- Optional requested outputs

Requirements:

- Run validation first.
- Block on fatal electrical or structural errors.
- Start the appropriate simulation engines.
- Return a session ID.
- Stream events to the UI.
- Display actual engine assignment per component.
- Do not claim an engine is active when it is not.

#### `hardware.simulation.set_input`

Set a virtual input such as:

- Button pressed
- PIR motion detected
- Temperature
- Light level
- Potentiometer value
- Distance
- UART input
- Generic sensor field

Return the resulting immediate state and scheduled events.

#### `hardware.simulation.read`

Inputs:

- Session ID
- Optional components
- Optional signals
- Optional time range

Return:

- Pin states
- Bus transactions
- Display state
- Serial output
- Electrical values
- Validation/runtime errors
- Simulation time

This is read-only.

#### `hardware.simulation.stop`

Stop the active simulation cleanly and release worker resources.

#### `hardware.component.import`

Support:

- HTTPS URL
- Uploaded file reference
- Inline manifest for small declarative components

Return:

- Parsed metadata
- Detected files
- Pin mapping
- Model coverage
- License/source warnings
- Whether the component is ready or needs user mapping

Mark this tool with `untrustedContentHint: true`.

## Visual WebMCP Collaboration

When an agent invokes a tool:

- Highlight the affected components.
- Animate newly added components appearing.
- Animate newly created connections.
- Show a concise activity entry.
- Identify that the action came from WebMCP.
- Show validation results immediately.
- Keep the canvas interactive for the human.
- Allow the human to undo agent actions.
- Do not block the full interface with a modal for ordinary operations.
- Do not require the agent to supply pixel coordinates unless it chooses to.
- Support semantic placement hints such as `near controller`, `power section`, `input group`, or `output group`.

Create a visible WebMCP status indicator:

```text
WebMCP connected
20 tools registered
Last agent action: connected pir-1.OUT to esp32-1.GPIO4
```

When WebMCP is unavailable, show accurate instructions rather than pretending it is connected.

## Component Import System

Implement a universal component package named `.hwpkg`.

A package is a ZIP containing a required manifest and optional model assets.

The manifest must support:

- Schema version
- Stable component ID
- Name
- Manufacturer
- Part number
- Category
- Description
- License
- Source URL
- Ports
- Parameters
- Electrical limits
- Protocol roles
- Model coverage
- Behavioral template
- Model file references
- Visual asset references
- Documentation references
- Content hashes

Support these initial import types:

```text
.json
.yaml
.yml
.hwpkg
.lib
.cir
.sp
.model
.sub
.subckt
.kicad_sym
.svg
.png
.jpg
.glb
```

The minimum completed import workflow must support:

1. Importing a JSON/YAML manifest.
2. Importing an `.hwpkg`.
3. Attaching an unencrypted SPICE model.
4. Mapping SPICE model pins to component ports.
5. Adding the imported component to the library.
6. Using the component in a project.
7. Showing exactly which simulation layers are supported.

Support URL import from an HTTPS URL.

For the hackathon demo, host at least one valid sample `.hwpkg` publicly so an agent can discover or receive the URL, import it, inspect it, place it, and use it.

Do not automatically execute JavaScript, Python, native binaries, shell scripts, or arbitrary WebAssembly from imported packages.

## Import Security

Protect the import backend from SSRF and malicious archives:

- Accept HTTPS only for remote imports.
- Block localhost, private, loopback, link-local, and metadata-service addresses.
- Validate DNS before and after redirects.
- Limit redirects.
- Enforce download timeouts.
- Enforce compressed and uncompressed size limits.
- Reject path traversal in ZIP entries.
- Reject ZIP bombs and excessive file counts.
- Validate MIME type and extension.
- Hash imported files.
- Sanitize SVG and textual content.
- Never render imported HTML.
- Never execute imported code.
- Keep external descriptions clearly labeled as untrusted.
- Rate-limit remote imports.

## Simulation Engine Interface

Create a common engine contract conceptually equivalent to:

```typescript
interface SimulationEngine {
  readonly id: string;
  readonly capabilities: EngineCapabilities;

  healthCheck(): Promise<EngineHealth>;
  canHandle(component: ComponentDefinition): EngineMatch;
  prepare(project: HardwareProject): Promise<PreparedSimulation>;
  start(options: SimulationStartOptions): Promise<SimulationSession>;
  setInput(input: SimulationInput): Promise<void>;
  read(request: SimulationReadRequest): Promise<SimulationReadResult>;
  step?(durationNs: bigint): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
```

Do not force every engine to implement unsupported capabilities.

Each engine reports exactly what it can simulate.

The router assigns components according to:

1. Explicit model preference
2. Highest available fidelity
3. Supported target architecture
4. Available engine health
5. Safe behavioral fallback
6. Metadata-only fallback with a clear warning

## Existing Velxio Simulation

Preserve and expose existing working Velxio capabilities rather than duplicating them.

Wrap current simulation actions through the new canonical command and engine layers.

Ensure existing supported boards and interactive components continue to work.

Do not regress:

- Firmware editing
- Compilation
- Start/stop/reset
- GPIO
- UART/serial
- Existing displays
- Existing sensors
- Existing component interactions
- Existing project save/load
- Existing ngspice-based behavior

## Renode Integration

Implement a real Renode adapter.

Requirements:

- Run Renode headlessly.
- Provide an engine health endpoint.
- Start isolated simulation sessions.
- Use a supported Renode platform selected from current official demos.
- Load `.repl`/`.resc` platform descriptions.
- Load a real firmware artifact.
- Start, pause, stop, and reset the emulation.
- Capture UART output.
- Map at least GPIO input and output between the web project and Renode.
- Return structured Renode logs and errors.
- Cleanly terminate abandoned sessions.
- Enforce execution-duration and resource limits.
- Never expose the Renode monitor port publicly.
- Keep all control traffic on the private backend network or localhost.

Complete at least one tested Renode example:

- A supported Cortex-M board
- Real compiled firmware or a reproducibly built artifact
- One virtual input
- One virtual output
- UART output visible in the browser
- At least one GPIO state reflected on the canvas

Choose the most reliable officially supported Renode board after inspecting the installed version and current demos. Do not select a board solely because it sounds impressive.

Implement the first bridge using the simplest reliable Renode control method—official external-control API, monitor/telnet control, or a small Renode peripheral/plugin—based on current documentation and runtime stability.

Do not attempt complete Jetson, Qualcomm, GPU, PCIe electrical, radar electromagnetic, or AR optical simulation in this hackathon build.

## Electrical Simulation

Use the existing Velxio ngspice integration where possible.

Build electrical nets from the canonical hardware graph.

At minimum support real calculations for:

- Voltage sources
- Ground
- Resistors
- Capacitors where existing simulation permits
- Diodes
- LEDs
- Basic transistor/MOSFET models where already supported
- Imported standard unencrypted SPICE subcircuits
- DC operating point
- Basic transient simulation where stable
- Voltage and current inspection
- Short-circuit detection
- Overcurrent warnings

Display measured values on wires or in the inspector when simulation is running.

Do not invent numeric outputs when the circuit has no valid model.

## Cross-Engine Events

Implement a timestamped internal event representation for at least:

```text
gpio-change
analog-value
uart-data
i2c-transaction
spi-transaction
display-update
sensor-input
electrical-sample
simulation-warning
simulation-error
```

For the hackathon, the required cross-engine bridge is:

```text
Browser component or sensor input
        ↓
Canonical simulation event
        ↓
Renode GPIO or input
        ↓
Real firmware execution
        ↓
Renode GPIO/UART output
        ↓
Canonical simulation event
        ↓
Canvas component/serial panel update
```

Do not attempt a universal nanosecond-accurate multi-physics scheduler during this build. Preserve timestamps and deterministic ordering, but prioritize a reliable working vertical slice.

## Firmware Experience

Reuse Monaco and existing Velxio compilation infrastructure.

Required capabilities:

- Select a programmable component.
- Edit source code.
- Support multiple source files where existing infrastructure allows.
- Compile.
- Show structured compiler diagnostics.
- Associate the artifact with the correct component.
- Run the artifact in the assigned engine.
- Show serial output.
- Preserve source with the project.

Include at least three known-good example firmware programs:

1. Motion alarm
2. Sensor-to-display project
3. Renode GPIO/UART demonstration

A compile button and a WebMCP compile call must execute the same function.

## User Interface

Keep the existing Velxio interface where it is strong, but deliver a coherent product experience.

The main workspace should include:

- Searchable component library
- Large central hardware canvas
- Component inspector
- Firmware editor
- Serial/output panel
- Validation panel
- Simulation controls
- Agent activity history
- WebMCP connection status
- Engine and fidelity status

The interface must be desktop-first and usable at common laptop resolutions.

Visual direction:

- Professional engineering application
- Neutral light or charcoal surfaces
- Restrained warm accent colors
- Clear hierarchy
- Dense enough for serious work
- No generic neon-blue “AI dashboard”
- No oversized empty cards
- No giant chatbot circle or unnecessary assistant mascot
- No excessive rounded corners
- Clear port labels
- Distinct visual styles for power, ground, digital buses, analog signals, and unsupported links
- Smooth but restrained animations
- Accessible contrast
- Keyboard navigation and shortcuts where practical

Agent-created changes should be visually understandable but should not look gimmicky.

## Example Projects

Ship working, one-click examples:

### Motion Alarm

Components:

- Supported MCU board
- PIR motion sensor
- Buzzer
- LED with resistor
- OLED display when stable
- Power and ground

Behavior:

- Virtual motion input can be toggled.
- Firmware detects motion.
- LED and buzzer activate.
- Serial output reports the event.
- Display updates when included.

### Environmental Monitor

Components:

- MCU board
- Temperature sensor
- Light sensor
- Display
- Warning LED
- Power

Behavior:

- Agent can set temperature and light values.
- Firmware reads values.
- Display and warning state update.

### Renode GPIO Demonstration

Components:

- Renode-supported board
- Button
- LED
- UART terminal

Behavior:

- Pressing the virtual button changes a Renode GPIO input.
- Real firmware changes a GPIO output.
- The virtual LED updates.
- UART output appears.

### Imported Motor Driver Demonstration

Components:

- MCU
- Imported component package
- Motor
- Power supply

Behavior:

- Import the package from a public URL.
- Inspect model coverage.
- Add and connect it.
- Validate voltage/current constraints.
- Run at least functional or electrical behavior according to actual available models.

## Required Winning Demonstration Flow

The product must support this flow without visual clicking by the agent.

### Flow 1: Build

User asks an external agent:

> Build a motion alarm using a microcontroller, PIR sensor, buzzer, LED, display, and correct power components. Write the firmware and simulate motion.

The agent must be able to:

1. Read capabilities.
2. Search components.
3. Inspect ports.
4. Add components.
5. Connect them.
6. Run validation.
7. Correct issues.
8. Set firmware source.
9. Compile.
10. Start simulation.
11. Trigger motion.
12. Read outputs.
13. Confirm that the alarm works.

The canvas must update live through every step.

### Flow 2: Break and Repair

Create at least two deliberate failures:

- Remove the LED resistor.
- Connect a 5 V output to a 3.3 V-only input, or create another real voltage mismatch.

The agent must:

1. Run validation.
2. Receive structured issue codes.
3. Search for or choose the proper repair.
4. Apply the repair.
5. Rerun validation.
6. Rerun simulation.
7. Confirm success.

### Flow 3: Import

The agent must:

1. Import a component from a public HTTPS URL.
2. Inspect detected files and fidelity.
3. Resolve pin mapping if needed.
4. Add the component.
5. Connect it.
6. Use it in validation or simulation.
7. Explain what is and is not actually modeled.

## Project Persistence

Projects must survive a browser refresh.

Support:

- Automatic local save
- Explicit save
- Rename
- Duplicate
- Export
- Import
- Example projects
- Undo and redo

A saved project must preserve:

- Components
- Positions
- Connections/nets
- Parameters
- Firmware
- Validation state
- Imported component definitions
- Simulation settings

Do not persist active native worker processes across refresh. Recreate sessions safely.

## Reliability and Security

Implement:

- Strict request validation
- Structured errors
- Simulation session limits
- Per-session resource limits
- Maximum project size
- Maximum component count
- Maximum connection count
- Maximum simulation duration
- Backend health checks
- Graceful engine-unavailable states
- WebSocket reconnect behavior
- CORS restricted to configured frontend origins
- No public Renode monitor ports
- Temporary-file cleanup
- Process cleanup on timeout or disconnect
- No arbitrary command execution
- No user-controlled shell arguments
- No direct execution of imported models
- No secrets in frontend bundles
- No sensitive data in logs

All errors visible to the user must be understandable and actionable.

## Internal Development Tool Inspector

Add a development/testing panel that:

- Lists every registered WebMCP tool
- Shows its description and input schema
- Accepts JSON input
- Invokes the same execute callback
- Shows the exact returned JSON string
- Displays registration errors
- Displays whether the browser has native WebMCP support

This panel is for debugging and judging transparency. Do not make it the primary product interface.

## Testing Requirements

Do not claim completion until all relevant tests pass.

### Unit tests

Test:

- Component add/remove/configure
- Stable IDs
- Port schemas
- Net and bus creation
- Connection compatibility
- Every major validation rule
- Automatic fixes
- Revision handling
- Undo/redo
- Batch transaction rollback
- Component manifest parsing
- Package import validation
- Tool input validation
- Standard tool-result serialization
- Engine capability routing

### WebMCP tests

Test:

- Registration of every tool
- Duplicate-registration prevention
- Read-only annotations
- Untrusted-content annotation
- Input-schema rejection
- Abort-signal handling
- Execution result serialization
- Mutations updating the visible application state
- Tool cleanup on teardown
- Tool invocation through the internal registry
- Actual `document.modelContext.getTools()` and `executeTool()` where the runtime supports them

### Backend tests

Test:

- Health endpoint
- Simulation-session lifecycle
- Timeout cleanup
- WebSocket events
- Renode process startup
- Firmware loading
- UART capture
- GPIO input/output bridge
- Renode process shutdown
- ngspice calculation or existing browser integration
- Import URL security
- Archive traversal rejection
- File-size enforcement

### End-to-end tests

Use Playwright or an equivalent browser test tool.

Automate:

1. Open blank project.
2. Invoke semantic tool functions.
3. Add components.
4. Connect components.
5. Validate.
6. Compile.
7. Start simulation.
8. Set a sensor input.
9. Observe output.
10. Break the design.
11. Detect failure.
12. Repair it.
13. Import a component.
14. Save and reload.
15. Verify state persistence.

Do not write end-to-end tests that bypass the actual command layer.

### Quality gates

Before completion:

- Type checking passes.
- Linting passes.
- Frontend production build passes.
- Backend tests pass.
- End-to-end tests pass.
- No unhandled browser-console errors.
- No unhandled backend exceptions during the demo.
- No dead primary controls.
- No fake success messages.
- No placeholder WebMCP tools.
- No unsupported engine shown as active.
- No core-demo TODO comments.

## Performance Requirements

The canvas should remain usable with at least:

- 75 component instances
- 150 visual connections
- Live validation
- Selection and panning
- Agent activity history

Avoid rerendering the entire graph for one pin update.

Throttle high-frequency simulation events before rendering while preserving full data where needed for logs or measurements.

## Deployment

Deploy the browser application to Vercel.

Deploy the persistent simulation backend to Render or another container host suitable for:

- FastAPI
- WebSockets
- Renode
- Native processes
- Persistent sessions during active connections

Requirements:

- Public HTTPS frontend URL
- Public backend API URL
- Configurable API base URL
- Correct CORS
- Working WebSocket connection
- Health status visible in the UI
- No login required for judges
- A preloaded example that works immediately
- Clear failure state if a simulation engine is temporarily unavailable

Do not deploy Renode inside a short-lived Vercel function.

## Hackathon Compliance

Ensure the public repository contains:

- Full required source code
- Visible `AGPL-3.0-or-later` license
- Upstream attribution
- Installation instructions
- Local run instructions
- Deployment instructions
- Live URL
- Explanation of WebMCP implementation
- Exact list of registered tools
- Explanation of human-agent collaboration
- Explanation of actual model fidelity
- Clear distinction between upstream Velxio functionality and new hackathon work
- Current screenshots
- Reproducible demo instructions

Maintain meaningful timestamped commits for the work added during the hackathon.

Prepare a demonstration script that fits within three minutes:

1. Ten-second product explanation
2. Agent builds motion alarm
3. Simulation succeeds
4. Design is deliberately broken
5. Agent validates and repairs it
6. Agent imports one online component
7. Final statement explaining why WebMCP eliminates screenshot-based hardware editing

Do not make claims in the submission video that exceed the implemented functionality.

## Scope Control

The architecture should make future adapters possible for:

- QEMU
- Verilator
- FMI/OpenModelica
- Gazebo
- GNU Radio
- openEMS
- Meep
- Hardware-in-the-loop

Do not fully integrate these during this implementation unless all core acceptance criteria are already complete and tested.

Do not expose them as active features merely because an interface exists.

The hackathon implementation must prioritize:

1. Real WebMCP
2. Shared human/agent command layer
3. Working visual hardware canvas
4. Typed components and ports
5. Real validation
6. Real firmware compile/simulation
7. One working Renode path
8. Electrical simulation
9. Online component import
10. Polished demo and deployment

## Non-Negotiable Restrictions

Do not:

- Return only a plan.
- Stop after scaffolding.
- Build a static mockup.
- Build a generic chatbot.
- Use screenshot automation as the agent interface.
- Make WebMCP tools call DOM click handlers.
- Require pixel coordinates for normal hardware operations.
- Hardcode every component pairing.
- Claim all hardware is fully simulated.
- Claim Jetson, Qualcomm, radar, RF, or AR optical simulation without real models.
- Mark metadata-only components as functional.
- Expose arbitrary code execution through component imports.
- Replace working Velxio systems without a concrete reason.
- Rebuild Renode from source unnecessarily.
- Add future engines before the core flow works.
- Change AGPL-derived code to Apache-2.0.
- Hide upstream attribution.
- Report tests as passing without running them.
- leave core-demo buttons disconnected.
- Use fake compile results.
- Use fake simulation results when a real model is expected.
- ask me to choose between ordinary implementation details.

## Execution Order

Perform the work in this practical order, but continue autonomously through all stages:

1. Inspect and run the existing Velxio application.
2. Identify the existing canonical store, component registry, simulation actions, compiler actions, persistence, and ngspice integration.
3. Add a stable shared command layer without regressing existing behavior.
4. Normalize component definitions, instances, ports, nets, validation issues, and project revision.
5. Expose the first WebMCP tools through the shared command layer.
6. Make component add/connect/configure operations update the canvas live.
7. Complete semantic validation and automatic fixes.
8. Make firmware set/compile/run work through both UI and tools.
9. Complete the motion-alarm vertical slice.
10. Add the Renode backend and tested GPIO/UART example.
11. Complete component package and URL import.
12. Complete break-and-repair flow.
13. Add persistence, examples, activity history, and Tool Inspector.
14. Run unit, integration, backend, and end-to-end tests.
15. Fix every core-flow failure.
16. Deploy frontend and backend.
17. Test the deployed version in an actual WebMCP-enabled environment.
18. Prepare submission documentation and the sub-three-minute demo script.

Do not postpone testing until the end. Run and repair the relevant tests after each completed vertical slice.

## Definition of Done

The project is complete only when all of the following are true:

- The deployed website loads without authentication.
- Native WebMCP tools register in a supported browser.
- The public source visibly contains real `document.modelContext.registerTool()` calls.
- An agent can inspect the project without vision.
- An agent can add and remove components.
- An agent can inspect ports and electrical limits.
- An agent can connect components semantically.
- The canvas updates live.
- Validation catches real design errors.
- At least one automatic repair works.
- Firmware can be set and genuinely compiled.
- At least one existing Velxio board simulation works.
- At least one Renode firmware/GPIO/UART simulation works.
- At least one electrical circuit produces real measured values.
- Sensor inputs can be changed through WebMCP.
- Outputs can be read through WebMCP.
- A public component package can be imported from a URL.
- Model fidelity is shown honestly.
- The motion-alarm example works from beginning to end.
- The broken design can be diagnosed and repaired.
- Projects save and reload.
- Undo/redo works for agent actions.
- Tests pass.
- Vercel frontend is live.
- Persistent simulation backend is live.
- License and attribution are correct.
- The repository clearly identifies new hackathon work.
- The project is coherent enough for a judge to understand and test without assistance.

## Final Response Required From You

After implementation, provide only a concrete engineering completion report containing:

1. What is fully implemented.
2. What upstream code was reused.
3. What new hackathon functionality was added.
4. Exact WebMCP tools implemented.
5. Real simulation engines working.
6. Tests run and their actual results.
7. Local run command.
8. Frontend and backend deployment URLs, when deployment credentials were available.
9. Exact three-minute demo sequence.
10. Honest remaining limitations.

Do not describe unfinished items as completed. Do not provide a speculative future roadmap in place of working results.

Begin by inspecting and running the existing Velxio repository. Then implement the product continuously until the definition of done is met.