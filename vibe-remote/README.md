# Vibe Remote Approval Bridge

This package runs a local Vibe Remote bridge. It watches VS Code approval UI with Windows UI Automation and mirrors pending bash approvals to a physical Vibe Remote device.

## Features

- VS Code status viewer for local testing.
- Token-protected WebSocket status channel.
- Windows UI Automation approval broker for VS Code `Run bash command?` prompts.
- State updates for activity, diagnostics, active file, tasks, debug sessions, and focus state.
- Optional Bluetooth Classic SPP bridge support for future Core2-class M5Stack clients.
- `idle` means no observable VS Code activity; chat/agent prompts are not exposed by stable VS Code APIs unless the approval broker detects host UI.

## Commands

- `Vibe Remote: 状態ビューアを開く`
- `Vibe Remote: 接続トークンを表示`
- `Vibe Remote: 接続トークンを再生成`
- `Vibe Remote: サーバを再起動`
- `Vibe Remote: Local Bridgeを開始`
- `Vibe Remote: Local Bridgeを停止`
- `Vibe Remote: Local Bridgeの状態を表示`

## Settings

- `vibeRemote.port`
- `vibeRemote.bindAddress`
- `vibeRemote.token`
- `vibeRemote.idleThresholdMs`
- `vibeRemote.pollIntervalMs`
- `vibeRemote.discoveryEnabled`
- `vibeRemote.discoveryServiceType`
- `vibeRemote.discoveryServiceName`
- `vibeRemote.sppEnabled`
- `vibeRemote.sppPort`
- `vibeRemote.sppBaudRate`
- `vibeRemote.localBridge.listenPort`
- `vibeRemote.localBridge.upstreamPort`
- `vibeRemote.localBridge.advertiseHost`
- `vibeRemote.localBridge.logPath`
- `vibeRemote.approvalBroker.enabled`
- `vibeRemote.approvalBroker.dryRun`
- `vibeRemote.approvalBroker.host`
- `vibeRemote.approvalBroker.port`
- `vibeRemote.approvalBroker.pollSeconds`
- `vibeRemote.approvalBroker.decisionTimeoutSeconds`
- `vibeRemote.approvalBroker.logPath`

## Auto Discovery (mDNS)

Vibe Remote can advertise itself on LAN via mDNS for device-side auto discovery.

1. Set `vibeRemote.bindAddress` to `0.0.0.0`.
2. Set `vibeRemote.discoveryEnabled` to `true`.
3. Restart with `Vibe Remote: サーバを再起動`.

Service format is `_vibe-remote._tcp.local` by default (customizable via `vibeRemote.discoveryServiceType`).

Security notes:

- mDNS only advertises endpoint metadata. Token is never advertised.
- Keep token distribution on a separate channel (manual, QR, provisioning step).

## Bluetooth SPP

For future M5Stack Core2-class clients with Bluetooth Classic, Vibe Remote can
also use SPP as a serial transport. The protocol is the same JSON payloads as
the WebSocket transport, framed as newline-delimited JSON.

1. Build a Core2-class M5Stack client with `-D VIBE_TRANSPORT_SPP=1`.
2. Pair the M5Stack from the OS Bluetooth settings.
3. Set `vibeRemote.sppEnabled = true`.
4. Set `vibeRemote.sppPort` to the paired serial port, for example `COM5` or `/dev/rfcomm0`.
5. Run `Vibe Remote: サーバを再起動`.

## Local Bridge For WSL

When VS Code is connected to WSL, the extension usually runs in the WSL remote
extension host. That is a good place to observe workspace state, but a poor
place to touch physical LAN/mDNS/Bluetooth devices. Run the local bridge on the
local OS and let it proxy device traffic into the WSL Vibe Remote server.

Default shape:

```text
M5StickC -> Windows LAN/mDNS/ws://PC:39273 -> local bridge -> ws://127.0.0.1:39271 -> WSL extension
```

Start the Vibe Remote server in WSL with the safer local bind:

```json
{
  "vibeRemote.bindAddress": "127.0.0.1",
  "vibeRemote.discoveryEnabled": false,
  "vibeRemote.token": "my-local-vibe-token"
}
```

Then start the bridge from the Command Palette:

```text
Vibe Remote: Local Bridgeを開始
Vibe Remote: Local Bridgeの状態を表示
Vibe Remote: Local Bridgeを停止
```

For manual debugging, the same bridge can be run on the local OS:

```bash
npm run local:bridge
```

Useful options:

```bash
npm run local:bridge -- --listen-port=39273 --upstream-port=39271
npm run local:bridge -- --spp-port=COM5
npm run local:bridge -- --discovery=false
```

The bridge advertises `_vibe-remote._tcp.local` by default, but the advertised
port is the local bridge port. Tokens are still only sent through the protocol;
they are not advertised via mDNS.

## Build

```bash
npm install
npm run compile
```

The compiled extension entrypoint is `dist/extension.js`.

When using VS Code Remote WSL without a Linux Node.js install, the bundled VS Code tasks call `scripts/npm.sh`. It installs a local Linux Node.js under `.tools/` and avoids accidentally running the Windows npm shim from a `\\wsl.localhost` path.

## Protocol Smoke Test

After starting the extension in VS Code, show the token with `Vibe Remote: 接続トークンを表示`, then verify the WebSocket state channel:

```bash
npm run smoke:protocol -- --token=YOUR_TOKEN
```

To verify an agent status update:

```bash
npm run smoke:protocol -- --token=YOUR_TOKEN --status=running
```

## Virtual Device

For simulation hosts where a real M5Stack is unavailable, Vibe Remote includes a
file-backed pseudo-device. It mirrors the same idea as the Graviton CUSE stubs:
the outside world gets a small `/tmp` device surface, and writes to that surface
become WebSocket protocol events.

```bash
npm run virtual:device -- --token=YOUR_TOKEN
```

Default pseudo-dev directory:

```text
/tmp/gar-vibe-remote-device/
```

Useful controls:

```bash
echo press > /tmp/gar-vibe-remote-device/button_a  # select / confirm current UI action
echo press > /tmp/gar-vibe-remote-device/button_b  # rotate menu selection
echo press > /tmp/gar-vibe-remote-device/button_c  # back / cancel current UI
echo hold  > /tmp/gar-vibe-remote-device/hold_a    # A-hold UI action when defined
echo hold  > /tmp/gar-vibe-remote-device/hold_b    # B-hold UI action when defined
echo hold  > /tmp/gar-vibe-remote-device/hold_c    # reconnect
cat /tmp/gar-vibe-remote-device/screen.txt
tail -f /tmp/gar-vibe-remote-device/events.log
```

## VS Code Approval Broker

`scripts/vscode-approval-broker.ps1` is a Windows UI Automation
broker for approvals that are owned by the VS Code host UI, such as a pending
`Run bash command?` confirmation. It watches the VS Code accessibility tree,
mirrors a detected bash approval to Vibe Remote, waits for `Allow` / `Skip`, and
then invokes the matching VS Code button.

Commands:

- `Vibe Remote: Approval Brokerを開始`
- `Vibe Remote: Approval Brokerを停止`
- `Vibe Remote: Approval Brokerの状態を表示`

Default settings are conservative:

```json
{
  "vibeRemote.approvalBroker.enabled": false,
  "vibeRemote.approvalBroker.dryRun": true,
  "vibeRemote.approvalBroker.host": "127.0.0.1",
  "vibeRemote.approvalBroker.port": 39273
}
```

In WSL/Remote setups, the broker runs on Windows and normally connects through
the Local Bridge at `127.0.0.1:39273`. Keep `dryRun` enabled until detection and
Vibe Remote actions have been verified. When `dryRun` is disabled, selecting
`Allow` or `Skip` on Vibe Remote invokes the matching VS Code approval button.

Manual debugging is still possible from Windows PowerShell, or from WSL through
`powershell.exe`:

```powershell
$env:VIBE_REMOTE_TOKEN = "YOUR_TOKEN"
$env:VIBE_REMOTE_HOST = "127.0.0.1"
$env:VIBE_REMOTE_PORT = "39273"
& "\\wsl.localhost\Ubuntu-26.04\home\user\Yurufuwa\gar-vibe-ui\vibe-remote\scripts\vscode-approval-broker.ps1" -Loop
```

For a safe probe that does not press VS Code buttons:

```powershell
& "\\wsl.localhost\Ubuntu-26.04\home\user\Yurufuwa\gar-vibe-ui\vibe-remote\scripts\vscode-approval-broker.ps1" -DryRun
```

Safety notes:

- The broker only handles approvals where enabled `Allow` and `Skip` buttons are
  visible in a VS Code window and the document text contains `Run bash command?`.
- It re-finds the pending approval immediately before pressing a button.
- `Cancel` or timeout clears the Vibe Remote UI and leaves VS Code untouched.
- Keep `-DryRun` on until the pending approval shape has been confirmed on the
  target machine.

## Run In VS Code

1. Open the `vibe-remote` folder in VS Code.
2. Press F5 to start an Extension Development Host.
3. Run `Vibe Remote: 状態ビューアを開く` from the command palette.
4. Use the smoke script or Approval Broker to verify status updates.
