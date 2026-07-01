# gar-vibe-ui

Vibe Remote is a small status bridge for AI coding sessions. MCP-capable agents can report whether they are running, waiting, done, failed, or idle, and the VS Code-side viewer displays that state alongside observable editor activity.

The current direction is a lightweight status hub: agents report state, VS Code hosts the bridge, and LAN devices can discover the bridge via mDNS without exposing the shared token.

## Layout

```text
docs/
  PROJECT_HANDOFF.md        Project context and current design notes
  vibe-remote-concept.html  Promotional concept document
vibe-remote/
  VS Code status bridge and MCP helper source
advertizement.png           Temporary concept image for the promotional document
```

## Current Status

- MCP status bridge is implemented.
- Token-protected WebSocket status channel is implemented.
- VS Code status viewer is implemented.
- mDNS advertisement for LAN device discovery is implemented.
- M5StickC client firmware is implemented under `vibe-remote/m5stickc-client`.
- The earlier VS Code command-control direction has been removed.

## Build

Use a Node.js/npm installation that runs inside the same filesystem context as this checkout. In WSL, avoid the Windows npm shim when working from a `\\wsl.localhost` path.

```bash
cd vibe-remote
npm install
npm run compile
```

## Device Discovery

To let a LAN device discover the VS Code bridge:

1. Set `vibeRemote.bindAddress` to `0.0.0.0`.
2. Set `vibeRemote.discoveryEnabled` to `true`.
3. Run `Vibe Remote: サーバを再起動`.
4. Run `Vibe Remote: 接続トークンを表示` and put the token in the device build flags.

The mDNS advertisement publishes endpoint metadata only. The token is never advertised.

## M5StickC Client

The M5StickC client can connect over Wi-Fi, discover `_vibe-remote._tcp.local`,
open a WebSocket, render device UI payloads, and send A / B / P button actions.

```bash
cd vibe-remote/m5stickc-client
pio run
pio run -t upload
pio device monitor
```

For the VM-to-device flow, `make vm-package` creates a checksumed firmware artifact and `make install-artifact ARTIFACT_DIR=... PORT=...` flashes that exact artifact to hardware.

## Next Steps

1. Configure the MCP bridge in the agent runtime.
2. Verify status reporting against the VS Code status viewer.
3. Test mDNS discovery and WebSocket connection on real M5StickC hardware.
4. Design the decision response path for OK/NG and choice selection.
