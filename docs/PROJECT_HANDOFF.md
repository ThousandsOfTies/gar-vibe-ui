# Vibe Remote — Project Handoff

Last updated: 2026-07-05

## Current Direction

Vibe Remote is now a VS Code approval broker for small physical devices.

The project originally explored an MCP-cooperative agent path. That worked for
agents willing to call tools, but it was not reliable as a general approval
surface because tool availability and model behavior vary. The current product
path is harder and more direct: watch the actual VS Code host approval UI with
Windows UI Automation, mirror the pending approval to Vibe Remote, then invoke
the real VS Code `Allow` or `Skip` button after the user responds on the device.

Current flow:

```text
VS Code / Copilot shows "Run bash command?"
  -> vscode-approval-broker.ps1 detects Allow/Skip buttons through UIA
  -> broker posts a deviceUi payload to Vibe Remote
  -> M5StickC or the status viewer returns allow/skip/cancel
  -> broker re-finds the approval and invokes the matching VS Code button
```

The MCP stdio server and MCP configuration have been removed.

## Implemented

### VS Code Extension / Status Hub

- Token-protected WebSocket server at `127.0.0.1:39271` by default.
- VS Code status viewer opened by `Vibe Remote: 状態ビューアを開く`.
- Activity snapshot from stable VS Code APIs:
  - terminal shell execution
  - diagnostics count
  - active file
  - task/debug/focus state
- Device UI state distribution over WebSocket.
- Clickable decision buttons in the VS Code status viewer.
- First response wins for a given device UI id.

### Local Bridge

Used when VS Code runs in WSL/Remote but the physical device connects to the
Windows host over LAN.

- Host OS listen port: `39273`
- WSL/extension upstream port: `39271`
- Advertises `_vibe-remote._tcp.local`
- Proxies WebSocket traffic between the physical device and the WSL extension.
- Command Palette entries:
  - `Vibe Remote: Local Bridgeを開始`
  - `Vibe Remote: Local Bridgeを停止`
  - `Vibe Remote: Local Bridgeの状態を表示`

Default shape:

```text
M5StickC -> Windows LAN/mDNS/ws://PC:39273 -> Local Bridge -> ws://127.0.0.1:39271 -> WSL extension
```

### Approval Broker

Main files:

- `vibe-remote/src/approvalBrokerManager.ts`
- `vibe-remote/scripts/vscode-approval-broker.ps1`

Command Palette entries:

- `Vibe Remote: Approval Brokerを開始`
- `Vibe Remote: Approval Brokerを停止`
- `Vibe Remote: Approval Brokerの状態を表示`

Settings:

- `vibeRemote.approvalBroker.enabled`
- `vibeRemote.approvalBroker.dryRun`
- `vibeRemote.approvalBroker.host`
- `vibeRemote.approvalBroker.port`
- `vibeRemote.approvalBroker.pollSeconds`
- `vibeRemote.approvalBroker.decisionTimeoutSeconds`
- `vibeRemote.approvalBroker.logPath`

Important behavior:

- The broker watches Windows UIA for VS Code windows with enabled `Allow` and
  `Skip`/`Proceed without executing this command` buttons.
- It requires document text containing `Run bash command?`.
- It sends `Allow`, `Skip`, and `Cancel` choices to Vibe Remote.
- Before pressing a VS Code button, it re-finds the pending approval.
- `Cancel` and timeout leave VS Code untouched.
- `dryRun: true` shows the remote UI but does not press VS Code buttons.
- In WSL setups the broker usually connects to the Local Bridge at
  `127.0.0.1:39273`.

### Device UI Protocol

The protocol is still WebSocket JSON. It is no longer exposed as an MCP stdio
tool surface.

Inbound examples:

```json
{ "type": "hello", "token": "..." }
{ "type": "ping", "token": "..." }
{
  "type": "agentStatus",
  "token": "...",
  "status": "waiting",
  "source": "approval-broker",
  "message": "VS Code approval",
  "ttlMs": 60000
}
{
  "type": "deviceUi",
  "token": "...",
  "ui": {
    "id": "vscode-approval-1234abcd",
    "title": "VS Code Approval",
    "state": "waiting",
    "mode": "menu",
    "message": "Run bash command?",
    "fields": [{ "label": "cmd", "value": "mkdir -p /tmp/example" }],
    "actions": [
      { "id": "allow", "label": "Allow" },
      { "id": "skip", "label": "Skip" },
      { "id": "cancel", "label": "Cancel" }
    ],
    "ttlMs": 60000
  }
}
{
  "type": "uiAction",
  "token": "...",
  "uiId": "vscode-approval-1234abcd",
  "actionId": "allow",
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
    "source": "approval-broker",
    "status": "waiting",
    "message": "VS Code approval",
    "updatedAt": 1234567890
  },
  "ui": {
    "id": "vscode-approval-1234abcd",
    "title": "VS Code Approval",
    "state": "waiting",
    "message": "Run bash command?",
    "actions": [
      { "id": "allow", "label": "Allow" },
      { "id": "skip", "label": "Skip" }
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
    "uiId": "vscode-approval-1234abcd",
    "actionId": "allow",
    "button": "A",
    "source": "M5StickC-Plus2-Vibe-Min",
    "ts": 1234567890
  }
}
```

## M5StickC Plus2 Firmware

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
- device UI rendering, including compact `fields`.
- menu mode: A selects, B rotates, P backs/cancels.
- selected cursor is preserved across refreshes of the same UI.
- after action send, the display shows a short `SENT` acknowledgement.
- WebSocket phase display to clarify search/connect/reconnect state.

Verified on real M5StickC Plus2:

- Wi-Fi connected.
- WebSocket connected through Local Bridge.
- UI displayed for VS Code `Run bash command?` approval.
- Selecting `Allow` from the device advanced the Copilot/VS Code approval.

## Configuration Notes

Workspace settings used during validation:

```json
{
  "vibeRemote.token": "YOUR_TOKEN",
  "vibeRemote.approvalBroker.dryRun": false,
  "vibeRemote.approvalBroker.host": "127.0.0.1",
  "vibeRemote.approvalBroker.port": 39273
}
```

For automatic broker startup:

```json
{
  "vibeRemote.approvalBroker.enabled": true
}
```

The old `vibe_remote` MCP entries were removed from:

- workspace `.vscode/mcp.json`
- Windows VS Code User `mcp.json`
- Codex `~/.codex/config.toml`

## Common Commands

Run validation:

```bash
cd /home/user/Yurufuwa/gar-vibe-ui/vibe-remote
./scripts/npm.sh run typecheck
./scripts/npm.sh run lint
./scripts/npm.sh test
```

Build/flash M5StickC firmware locally:

```bash
cd /home/user/Yurufuwa/gar-vibe-ui/vibe-remote/m5stickc-client
.tools/platformio/bin/platformio run -e m5stickc-plus2-vibe-min
.tools/platformio/bin/platformio run -e m5stickc-plus2-vibe-min -t upload --upload-port /dev/ttyACM0
```

Manual broker debug from Windows PowerShell:

```powershell
$env:VIBE_REMOTE_TOKEN = "YOUR_TOKEN"
$env:VIBE_REMOTE_HOST = "127.0.0.1"
$env:VIBE_REMOTE_PORT = "39273"
& "\\wsl.localhost\Ubuntu-26.04\home\user\Yurufuwa\gar-vibe-ui\vibe-remote\scripts\vscode-approval-broker.ps1" -Loop
```

Safe probe:

```powershell
& "\\wsl.localhost\Ubuntu-26.04\home\user\Yurufuwa\gar-vibe-ui\vibe-remote\scripts\vscode-approval-broker.ps1" -Loop -DryRun
```

## Removed / Avoided

- MCP stdio server and tool-surface dependency.
- Generic claims that Vibe Remote can control arbitrary agent UI.
- DOM/webview scraping of other extensions.
- Shelling into a fake/mock Vibe Remote server for approval behavior.
- Direct agent cooperation as the primary approval path.

## Related Commits

Recent pushed commit:

- `gar-vibe-ui`: `3ea722a Add Vibe Remote approval broker`

## Next Steps

1. Make extension packaging/install smoother so command palette entries appear
   without manual copying.
2. Add automated regression tests around device UI first-response behavior.
3. Harden UIA detection against VS Code/Copilot text and accessibility changes.
4. Consider masking or avoiding token exposure in broker process command lines.
