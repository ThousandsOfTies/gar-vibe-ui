# M5StickC Client Handoff

対象: Vibe Remote に接続する M5StickC / M5StickC Plus2 firmware。

## Current Shape

- App root: `vibe-remote/m5stickc-client`
- Source: `src/main.cpp`
- PlatformIO env: `m5stickc-plus2-vibe-min`
- Transport: Wi-Fi + WebSocket
- Discovery: `_vibe-remote._tcp.local` via mDNS
- Local fallback: `VIBE_REMOTE_HOST` / `VIBE_REMOTE_PORT`

## Device UI

The firmware renders the UI payload received from the Vibe Remote bridge and
maps the physical buttons as follows:

| Button | Meaning |
| --- | --- |
| A | Select / confirm |
| B | Rotate menu |
| P | Back |

Hold variants are sent as `A-hold`, `B-hold`, and `P-hold` when matching
actions exist.

## Local Secrets

Use `.env.local` or environment variables. Do not commit Wi-Fi credentials or
tokens.

```dotenv
VIBE_WIFI_SSID=...
VIBE_WIFI_PASS=...
VIBE_REMOTE_TOKEN=...
```

## Build

```bash
cd vibe-remote/m5stickc-client
make build
make upload
make monitor
```

Package a VM/Codespaces build:

```bash
make vm-package
```
