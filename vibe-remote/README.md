# Vibe Remote Status Bridge

This package runs a local status bridge. MCP-capable agents report their own state to a token-protected WebSocket server, and the VS Code view displays that state alongside observable editor activity.

## Features

- VS Code status viewer for local testing.
- Token-protected WebSocket status channel.
- MCP stdio server for agent status reports.
- State updates for activity, diagnostics, active file, tasks, debug sessions, and focus state.
- Optional Bluetooth Classic SPP transport via OS serial ports for Core2-class M5Stack devices.
- `idle` means no observable VS Code activity; chat/agent prompts are not exposed by stable VS Code APIs unless the agent reports them.

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

For M5Stack Core2-class devices with Bluetooth Classic, Vibe Remote can also use
SPP as a serial transport. The protocol is the same JSON payloads as the
WebSocket transport, framed as newline-delimited JSON.

1. Build the M5Stack client with `-D VIBE_TRANSPORT_SPP=1`.
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
M5Stack -> Windows LAN/mDNS/ws://PC:39273 -> local bridge -> ws://127.0.0.1:39271 -> WSL extension
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
echo press > /tmp/gar-vibe-remote-device/button_a  # running
echo press > /tmp/gar-vibe-remote-device/button_b  # waiting
echo press > /tmp/gar-vibe-remote-device/button_c  # done
echo hold  > /tmp/gar-vibe-remote-device/hold_a    # failed
echo hold  > /tmp/gar-vibe-remote-device/hold_b    # idle
cat /tmp/gar-vibe-remote-device/screen.txt
tail -f /tmp/gar-vibe-remote-device/events.log
```

## MCP Status Bridge

Vibe Remote includes a small stdio MCP server that lets an MCP-capable agent report its own status to the remote display.

1. Start the VS Code extension and run `Vibe Remote: 接続トークンを表示`.
2. Add an MCP server entry to Codex `config.toml`:

```toml
[mcp_servers.vibe_remote]
command = "/home/user/Yurufuwa/gar-vibe-ui/vibe-remote/scripts/node.sh"
args = ["/home/user/Yurufuwa/gar-vibe-ui/vibe-remote/scripts/mcp-server.js"]
env = { VIBE_REMOTE_TOKEN = "YOUR_TOKEN" }
```

Available tools:

- `vibe_remote_set_status`: set `running`, `waiting`, `done`, `failed`, or `idle`.
- `vibe_remote_heartbeat`: refresh `running` while work continues.
- `vibe_remote_request_decision`: show a human-decision prompt summary.
- `vibe_remote_clear_status`: mark the agent as idle.

Suggested agent instruction:

```text
While working, call vibe_remote_heartbeat every 60 seconds. Before asking the user for a decision, call vibe_remote_request_decision with a short summary and choices. On completion or failure, call vibe_remote_set_status.
```

## Run In VS Code

1. Open the `vibe-remote` folder in VS Code.
2. Press F5 to start an Extension Development Host.
3. Run `Vibe Remote: 状態ビューアを開く` from the command palette.
4. Use the MCP bridge or smoke script to verify status updates.
