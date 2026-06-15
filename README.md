# gar-vibe-ui

Vibe Remote is a small status bridge for AI coding sessions. MCP-capable agents can report whether they are running, waiting, done, failed, or idle, and the VS Code-side viewer displays that state alongside observable editor activity.

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
- The earlier VS Code command-control direction has been removed.
- Hardware/physical remote work is deferred until there is a plugin-side cooperation model.

## Build

Use a Node.js/npm installation that runs inside the same filesystem context as this checkout. In WSL, avoid the Windows npm shim when working from a `\\wsl.localhost` path.

```bash
cd vibe-remote
npm install
npm run compile
```

## Next Steps

1. Configure the MCP bridge in the agent runtime.
2. Verify status reporting against the VS Code status viewer.
3. Decide whether the next UI should stay in VS Code or move to a standalone app.
