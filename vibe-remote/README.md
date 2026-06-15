# Vibe Remote VS Code Extension

This extension runs a local WebSocket server and translates remote-control button events into stable VS Code commands for supervising AI coding.

## Features

- Virtual remote WebView for local testing.
- Token-protected WebSocket control channel.
- Actions for OK, NG, submit, mic toggle, accept all, read aloud, and stop read-aloud.
- State updates for activity, diagnostics, active file, tasks, debug sessions, and focus state.
- `idle` means no observable VS Code activity; Copilot Chat input prompts are not exposed by stable APIs.

## Commands

- `Vibe Remote: 仮想リモコンを開く`
- `Vibe Remote: 接続トークンを表示`
- `Vibe Remote: サーバを再起動`

## Settings

- `vibeRemote.port`
- `vibeRemote.bindAddress`
- `vibeRemote.idleThresholdMs`
- `vibeRemote.pollIntervalMs`

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

To verify an action:

```bash
npm run smoke:protocol -- --token=YOUR_TOKEN --action=ok
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
3. Run `Vibe Remote: 仮想リモコンを開く` from the command palette.
4. Use the virtual buttons to verify WebSocket actions and state updates.
