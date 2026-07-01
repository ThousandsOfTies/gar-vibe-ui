# Vibe Remote — Project Handoff

Last updated: 2026-06-21

## Current Direction

Vibe Remote is an MCP-cooperative status and small-device UI bridge.

The earlier idea of controlling arbitrary VS Code agent UIs from the outside was
discarded. Practical testing showed that OK/NG prompts, submit buttons, mic
controls, and prompt text are usually owned by each agent extension's internal
webview state. They cannot be driven reliably through stable VS Code APIs.

The viable design is explicit cooperation from the agent side:

- The agent reports `running`, `waiting`, `done`, `failed`, or `idle`.
- The agent can publish a small declarative device UI.
- M5StickC/M5Stack-class devices subscribe to that state/UI stream.
- Physical button actions are returned to the agent through MCP.

This keeps the product experience: "notice that the agent is waiting and answer
from a small remote device," while avoiding brittle VS Code command-control.

## Implemented

### VS Code Extension / Status Hub

- Token-protected WebSocket server at `127.0.0.1:39271` by default.
- VS Code status viewer opened by `Vibe Remote: 状態ビューアを開く`.
- Activity snapshot from stable VS Code APIs:
  - terminal shell execution
  - diagnostics count
  - active file
  - task/debug/focus state
- Local Bridge manager commands:
  - `Vibe Remote: Local Bridgeを開始`
  - `Vibe Remote: Local Bridgeを停止`
  - `Vibe Remote: Local Bridgeの状態を表示`
- Windows/host Local Bridge support for LAN devices:
  - listens on host OS, default `39273`
  - proxies to WSL/extension host, default `39271`
  - advertises `_vibe-remote._tcp.local`
  - no hard-coded Node.js path; auto-detects host `node.exe`, with
    `vibeRemote.localBridge.nodePath` override

### MCP Server

MCP stdio server: `vibe-remote/scripts/mcp-server.js`

Tools:

- `vibe_remote_set_status`
- `vibe_remote_heartbeat`
- `vibe_remote_request_decision`
- `vibe_remote_show_ui`
- `vibe_remote_get_action`
- `vibe_remote_clear_ui`
- `vibe_remote_clear_status`

The MCP server now keeps a persistent WebSocket connection within the MCP
process instead of opening a new socket for every tool call.
`vibe_remote_request_decision` and `vibe_remote_show_ui` return structured MCP
content with `ui_id`, `status`, `action_count`, and `timeout_seconds`, while
keeping the human-readable text response for compatibility.
`vibe_remote_get_action` waits up to 60 seconds by default, or uses
`timeout_seconds` when provided. Use `timeout_seconds: 0` for immediate polling.

### Device UI Protocol

Small declarative UI payloads are supported via WebSocket and MCP.

Current supported UI shape:

- `id`
- `title`
- `state`: `running` / `waiting` / `done` / `failed` / `idle`
- `message`
- `fields`: up to 3 compact rows
- `actions`: up to 3 actions
- `button`: `A`, `B`, `P`, `A-hold`, `B-hold`, `P-hold`
- `ttlMs`

M5StickC display contract:

- Header: Wi-Fi and WebSocket connection chips.
- Status card: `state` label and `title`.
- Detail area: 3 compact rows.
  - If only `message` exists, render it wrapped across up to 3 rows.
  - If `fields` exist, render `message` on row 1 when present, then render
    field rows in the remaining space.
  - If `message` is absent, render up to 3 fields.
  - If both `message` and `fields` are absent, render up to 3 action hints.
- Footer: three persistent button rows for `A`, `B`, and `P`.
- Truncation:
  - `title`: normalized to 32 chars by the server; M5StickC shows 9 chars.
  - `message`: normalized to 120 chars; M5StickC wraps 18 chars x 3 lines, or
    shows 18 chars when fields are present.
  - `field.label`: normalized to 8 chars; M5StickC shows 7 chars.
  - `field.value`: normalized to 24 chars; M5StickC shows 18 chars.
  - `action.label`: normalized to 10 chars; footer shows the available width.
- Button mapping:
  - front button short press: `A`
  - side button short press: `B`
  - power button short press: `P`
  - front button hold: `A-hold`
  - side button hold: `B-hold`
  - power button hold: `P-hold`
- Fallback behavior when no matching device UI action exists:
  - `A`: sends `running`
  - `B`: sends `waiting`
  - `P`: sends `done`
  - `A-hold`: sends `failed`
  - `B-hold`: sends `idle`
  - `P-hold`: reconnects

### M5StickC Plus2 Firmware

Main firmware file:

`vibe-remote/m5stickc-client/src/main.cpp`

PlatformIO env:

`m5stickc-plus2-vibe-min`

Implemented:

- Wi-Fi connection with retry.
- mDNS discovery of the Local Bridge.
- fallback host/port via `.env.local`.
- WebSocket auth using `VIBE_REMOTE_TOKEN`.
- vertical M5StickC layout.
- partial redraw to reduce flicker.
- fixed header text removed to preserve space.
- device UI rendering, including compact `fields`.
- physical button action mapping:
  - front button `A`
  - side button `B`
  - power button short press `P`
- default status fallback when no device UI is active.

Verified on real M5StickC Plus2:

- Wi-Fi connected.
- WebSocket connected.
- UI displayed from MCP.
- `A OK` press returned:

```json
{
  "uiId": "mcp-proof-1",
  "actionId": "ok",
  "button": "A",
  "source": "M5StickC-Plus2-Vibe-Min"
}
```

### Tooling / Quality

- ESLint added.
- Prettier added.
- Unit tests added for protocol helpers.
- `npm run ci` passes:
  - compile
  - typecheck
  - lint
  - format check
  - unit tests
  - audit

## Removed / Avoided

- VS Code command-control dispatch for OK/NG/submit/mic/read-aloud.
- DOM/webview scraping of other extensions.
- Claims that Vibe Remote can universally press arbitrary agent UI buttons.
- Runtime Local Bridge process management from GAR. Local Bridge belongs to the
  Vibe Remote extension/runtime side, not GaplessAgentRuntime.

## Protocol

Inbound examples:

```json
{ "type": "hello", "token": "..." }
{ "type": "ping", "token": "..." }
{
  "type": "agentStatus",
  "token": "...",
  "status": "running",
  "source": "codex",
  "message": "building",
  "ttlMs": 120000
}
{
  "type": "deviceUi",
  "token": "...",
  "ui": {
    "id": "decision-1",
    "title": "Decision",
    "state": "waiting",
    "message": "Flash firmware now?",
    "actions": [
      { "id": "ok", "label": "OK", "button": "A" },
      { "id": "ng", "label": "NG", "button": "B" },
      { "id": "later", "label": "Later", "button": "P" }
    ],
    "ttlMs": 180000
  }
}
{
  "type": "uiAction",
  "token": "...",
  "uiId": "decision-1",
  "actionId": "ok",
  "button": "A",
  "source": "M5StickC-Plus2-Vibe-Min"
}
```

Outbound examples:

```json
{
  "type": "state",
  "chat": "maybeWaiting",
  "agent": {
    "source": "codex",
    "status": "waiting",
    "message": "building",
    "updatedAt": 1234567890
  },
  "ui": {
    "id": "decision-1",
    "title": "Decision",
    "state": "waiting",
    "message": "Flash firmware now?",
    "actions": [
      { "id": "ok", "label": "OK", "button": "A" }
    ]
  },
  "activity": {
    "errors": 0,
    "warnings": 0,
    "debugging": false,
    "taskRunning": false,
    "focused": true
  },
  "ts": 1234567890
}
{
  "type": "uiActionResult",
  "action": {
    "uiId": "decision-1",
    "actionId": "ok",
    "button": "A",
    "source": "M5StickC-Plus2-Vibe-Min",
    "ts": 1234567890
  }
}
```

## MCP Configuration

```toml
[mcp_servers.vibe_remote]
command = "/home/user/Yurufuwa/gar-vibe-ui/vibe-remote/scripts/node.sh"
args = ["/home/user/Yurufuwa/gar-vibe-ui/vibe-remote/scripts/mcp-server.js"]
env = { VIBE_REMOTE_TOKEN = "YOUR_TOKEN" }
```

Optional env:

```toml
env = {
  VIBE_REMOTE_TOKEN = "YOUR_TOKEN",
  VIBE_REMOTE_HOST = "127.0.0.1",
  VIBE_REMOTE_PORT = "39271"
}
```

## Common Commands

Run CI:

```bash
cd /home/user/Yurufuwa/gar-vibe-ui/vibe-remote
./scripts/npm.sh run ci
```

Build/flash M5StickC firmware locally:

```bash
cd /home/user/Yurufuwa/gar-vibe-ui/vibe-remote/m5stickc-client
.tools/platformio/bin/platformio run -e m5stickc-plus2-vibe-min
.tools/platformio/bin/platformio run -e m5stickc-plus2-vibe-min -t upload --upload-port /dev/ttyACM0
```

Show UI through MCP server manually:

```bash
cd /home/user/Yurufuwa/gar-vibe-ui/vibe-remote
VIBE_REMOTE_TOKEN=YOUR_TOKEN ./scripts/node.sh scripts/mcp-server.js <<'JSON'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"vibe_remote_show_ui","arguments":{"id":"mcp-proof-1","title":"MCP Test","state":"waiting","message":"Choose from M5StickC","actions":[{"id":"ok","label":"OK","button":"A"},{"id":"ng","label":"NG","button":"B"},{"id":"later","label":"Later","button":"P"}],"ttl_seconds":180}}}
JSON
```

Read selected action:

```bash
VIBE_REMOTE_TOKEN=YOUR_TOKEN ./scripts/node.sh scripts/mcp-server.js <<'JSON'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"vibe_remote_get_action","arguments":{"ui_id":"mcp-proof-1","consume":false,"timeout_seconds":60}}}
JSON
```

## Related Repositories / Commits

Recent pushed commits:

- `gar-vibe-ui`: `484f34a Add M5StickC Vibe Remote bridge`
- `GaplessAgentRuntime`: `cd8ef92 Add ESP32 and Vibe Remote GAR support`

GAR has ESP32/M5Stack build/flash support and documentation, but Vibe Remote
runtime process management remains in `gar-vibe-ui/vibe-remote`.

## Promotional Material

`docs/vibe-remote-concept.html` is the concept/spec document. It should describe
the current MCP/device-UI architecture and avoid claiming generic VS Code
command-control.

## Next Steps

1. Add broader tests:
   - MCP persistent WebSocket behavior
   - server device UI normalization
   - Local Bridge text/binary forwarding regression
2. Consider hardware expansion:
   - M5StickC has limited buttons
   - possible options are button combinations, hold actions, I2C button unit, or
     a different M5Stack device with more inputs
