# Vibe Remote — Project Handoff

## Current Direction

Vibe Remote is now a status bridge, not a VS Code remote-control extension.

The earlier plan tried to press OK/NG, submit, mic, and read-aloud controls through VS Code commands. Practical testing showed that this does not generalize across AI plugins. Many agent UIs keep their prompt state inside their own webviews or extension internals, so another extension cannot reliably read or answer those prompts through stable VS Code APIs.

The viable direction is cooperation from the agent side:

- The agent reports `running`, `waiting`, `done`, `failed`, or `idle`.
- The report is sent through the Vibe Remote MCP bridge.
- The VS Code-side bridge stores that status and displays it in a small viewer.
- Future hardware or external UIs should consume the status channel, not try to drive arbitrary VS Code plugin UIs.

## Implemented

- Token-protected WebSocket server at `127.0.0.1:39271` by default.
- VS Code status viewer opened by `Vibe Remote: 状態ビューアを開く`.
- MCP stdio server at `vibe-remote/scripts/mcp-server.js`.
- MCP tools:
  - `vibe_remote_set_status`
  - `vibe_remote_heartbeat`
  - `vibe_remote_request_decision`
  - `vibe_remote_clear_status`
- Activity snapshot from stable VS Code APIs:
  - terminal shell execution
  - diagnostics count
  - active file
  - task/debug/focus state

## Removed

- VS Code command-control dispatch for OK/NG/submit/mic/read-aloud.
- The action message protocol.
- Debug command dumping.
- VS Code command-control claims in the promotional material.

## Promotional Material

`docs/vibe-remote-concept.html` is kept as a UX/concept document. The current version preserves the remote-supervision experience, but describes the implementation as MCP/agent cooperation instead of VS Code command-control. `advertizement.png` is restored as a temporary visual and can be regenerated later.

## Protocol

Inbound:

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
```

Outbound:

```json
{
  "type": "state",
  "chat": "working",
  "agent": {
    "source": "codex",
    "status": "running",
    "message": "building",
    "updatedAt": 1234567890
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
```

## MCP Configuration

```toml
[mcp_servers.vibe_remote]
command = "/home/user/Yurufuwa/gar-vibe-ui/vibe-remote/scripts/node.sh"
args = ["/home/user/Yurufuwa/gar-vibe-ui/vibe-remote/scripts/mcp-server.js"]
env = { VIBE_REMOTE_TOKEN = "YOUR_TOKEN" }
```

## Next Steps

1. Confirm the MCP bridge can be configured from the target agent environment.
2. Decide whether the UI should remain a VS Code view or become a standalone local web app.
3. If a hardware display is revived, make it consume `state` messages only.
