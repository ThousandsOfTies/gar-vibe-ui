# Vibe Remote M5StickC Client

M5StickC / M5StickC Plus2 を Vibe Remote の小型リモコンにする firmware です。

## What It Does

- Wi-Fiへ接続
- mDNSで `_vibe-remote._tcp.local` を探索
- Vibe Remote WebSocketへトークン付きで接続
- WiFi / WS / battery 状態を小型画面に表示
- AI / Extension から届く device UI を表示
- A / B / P ボタンで決定、メニュー移動、戻るを送信

## Build Settings

- environment: `m5stickc-plus2-vibe-min`
- source: `src/main.cpp`
- board: `m5stick-c`
- transport: Wi-Fi + WebSocket

Wi-Fi / Vibe Remote token は repository に書き込まず、環境変数か `.env.local` で指定します。

```bash
cat > .env.local <<'EOF'
VIBE_WIFI_SSID=your-home-ssid
VIBE_WIFI_PASS=your-home-password
VIBE_REMOTE_TOKEN=your-vibe-remote-token
EOF
```

`.env.local` は git ignore 済みです。mDNS が使えない時だけ `VIBE_REMOTE_HOST` も指定します。

```bash
VIBE_REMOTE_HOST=192.168.1.10
VIBE_REMOTE_PORT=39271
```

## Build And Flash

```bash
cd vibe-remote/m5stickc-client
make build
make upload
make monitor
```

PlatformIOを直接使う場合:

```bash
pio run -e m5stickc-plus2-vibe-min
pio run -e m5stickc-plus2-vibe-min -t upload
pio device monitor
```

## Wokwi Workspace

Wokwiで確認する場合は、このアプリのMakefileからGARのWokwi workspaceを生成します。
アプリソースはこのrepo、配線とshimは `gar-tools`、生成先は
`GaplessAgentRuntime/.gar/wokwi/m5stackc` です。

```bash
make wokwi-workspace
cd ../../../GaplessAgentRuntime/.gar/wokwi/m5stackc
pio run
```

場所を変える場合:

```bash
make wokwi-workspace \
  GAR_ROOT=../../../GaplessAgentRuntime \
  GAR_TOOLS_ROOT=../../../gar-tools \
  WOKWI_WORKSPACE=../../../GaplessAgentRuntime/.gar/wokwi/m5stackc
```

## Buttons

| 操作 | 動作 |
| --- | --- |
| A | 選択 / 決定 |
| B | メニュー移動 |
| P | 戻る |
| A hold | A長押し action |
| B hold | B長押し action |
| P hold | P長押し action |

## Artifact Flow

Codespaces / VMでビルドしたバイナリをartifactとして固める場合:

```bash
make vm-package
make install-artifact ARTIFACT_DIR=artifacts/<timestamp>-m5stickc-plus2-vibe-min PORT=/dev/ttyUSB0
```

GAR経由でM5StickC Plus2 Vibe Remote artifactを書き込む場合:

```bash
cd ~/Yurufuwa/GaplessAgentRuntime
gar target flash-esp32 --port COM3
```

`COM3` は WSL 上で `/dev/ttyS3` に自動変換されます。`--artifact-dir` を省略すると
`~/Yurufuwa/gar-vibe-ui/vibe-remote/m5stickc-client/artifacts/` 配下の最新artifactを使います。
