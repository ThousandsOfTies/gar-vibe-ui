# Vibe Remote VS Code Extension

This extension runs a local WebSocket server and translates remote-control button events into stable VS Code commands for supervising AI coding.

## Features

- Virtual remote WebView for local testing.
- Token-protected WebSocket control channel.
- Actions for OK, NG, submit, mic toggle, accept all, read aloud, and stop read-aloud.
- State updates for activity, diagnostics, active file, tasks, debug sessions, and focus state.

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

## Protocol Smoke Test

After starting the extension in VS Code, show the token with `Vibe Remote: 接続トークンを表示`, then verify the WebSocket state channel:

```bash
npm run smoke:protocol -- --token=YOUR_TOKEN
```

To verify an action:

```bash
npm run smoke:protocol -- --token=YOUR_TOKEN --action=ok
```

## Run In VS Code

1. Open the `vibe-remote` folder in VS Code.
2. Press F5 to start an Extension Development Host.
3. Run `Vibe Remote: 仮想リモコンを開く` from the command palette.
4. Use the virtual buttons to verify WebSocket actions and state updates.
