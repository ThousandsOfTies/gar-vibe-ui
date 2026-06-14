# gar-vibe-ui

Vibe Remote is a companion UI for supervising AI coding from away from the keyboard. It provides a VS Code extension that exposes a small WebSocket remote control for OK/NG, submit, mic toggle, and read-aloud actions, plus a built-in virtual remote for testing without hardware.

## Layout

```text
docs/
  PROJECT_HANDOFF.md        Project context and design notes
  vibe-remote-concept.html  Visual concept document
vibe-remote/
  VS Code extension source
advertizement.png           Concept image
```

## Current Status

- Core VS Code extension is implemented.
- Virtual remote WebView is implemented.
- The WebSocket state/action channel is token-protected.
- ESP32/M5StickC firmware is not implemented yet.
- F5/manual VS Code extension verification is still the next practical milestone.

## Build

Use a Node.js/npm installation that runs inside the same filesystem context as this checkout. In WSL, avoid the Windows npm shim when working from a `\\wsl.localhost` path.

```bash
cd vibe-remote
npm install
npm run compile
```

## Next Steps

1. Verify the extension with VS Code F5 and the virtual remote.
2. Run the token-authenticated protocol smoke test against the F5 extension host.
3. Draft the ESP32/M5StickC firmware.
4. Package the extension as a `.vsix`.
