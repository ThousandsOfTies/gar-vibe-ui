# gar-vibe-ui

Vibe Remote lets a small physical device approve VS Code host confirmations.
The current implementation watches VS Code's `Run bash command?` approval UI
with Windows UI Automation, mirrors the approval to Vibe Remote, and then
presses the matching VS Code `Allow` or `Skip` button when the device responds.

The old MCP-tool-driven route has been removed. The reliable path is now:

```text
VS Code approval UI
  -> Windows UIA Approval Broker
  -> Vibe Remote WebSocket / Local Bridge
  -> M5StickC / status viewer
  -> broker invokes VS Code Allow or Skip
```

## Layout

```text
docs/
  PROJECT_HANDOFF.md        Project context and current design notes
  vibe-remote-concept.html  Promotional concept document
vibe-remote/
  VS Code extension, Local Bridge, Approval Broker, and device clients
```

## Current Status

- UIA Approval Broker is implemented for VS Code `Run bash command?` approvals.
- Token-protected WebSocket status/UI channel is implemented.
- Local Bridge supports WSL/Remote setups by proxying host LAN traffic to the
  WSL extension host.
- VS Code status viewer can show the mirrored decision UI and accept clicks.
- M5StickC Plus2 firmware is implemented and tested with the approval flow.
- MCP server source and MCP configuration have been removed.

## Build

Use a Node.js/npm installation that runs inside the same filesystem context as
this checkout. In WSL, avoid the Windows npm shim when working from a
`\\wsl.localhost` path.

```bash
cd vibe-remote
npm install
npm run compile
npm run typecheck
npm run lint
npm test
```

## WSL / Device Path

When VS Code is connected to WSL, the extension runs inside the WSL remote
extension host, but the M5StickC connects to the Windows host over LAN. Start
the Local Bridge from VS Code:

```text
Vibe Remote: Local Bridgeを開始
```

Default shape:

```text
M5StickC -> ws://Windows-host:39273 -> Local Bridge -> ws://127.0.0.1:39271 -> WSL extension
```

The mDNS advertisement publishes endpoint metadata only. The token is never
advertised.

## Approval Broker

Start/stop from the Command Palette:

```text
Vibe Remote: Approval Brokerを開始
Vibe Remote: Approval Brokerを停止
Vibe Remote: Approval Brokerの状態を表示
```

Useful settings:

```json
{
  "vibeRemote.approvalBroker.enabled": true,
  "vibeRemote.approvalBroker.dryRun": false,
  "vibeRemote.approvalBroker.host": "127.0.0.1",
  "vibeRemote.approvalBroker.port": 39273
}
```

Keep `dryRun` enabled while testing detection. With `dryRun: false`, selecting
`Allow` or `Skip` on Vibe Remote invokes the matching VS Code button.

## M5StickC Client

The M5StickC client connects over Wi-Fi, discovers `_vibe-remote._tcp.local`,
opens a WebSocket, renders device UI payloads, and sends A / B / P button
actions.

```bash
cd vibe-remote/m5stickc-client
make build
make upload
make monitor
```

For the VM-to-device flow, `make vm-package` creates a checksumed firmware
artifact and `make install-artifact ARTIFACT_DIR=... PORT=...` flashes that
exact artifact to hardware.

## Next Steps

1. Keep hardening UIA detection against VS Code/Copilot UI changes.
2. Package the extension install/update flow so the broker commands are
   available without manual copying.
3. Add regression tests around the WebSocket device UI action path.
