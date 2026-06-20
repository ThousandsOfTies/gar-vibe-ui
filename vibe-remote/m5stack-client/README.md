# Vibe Remote M5Stack Client

M5StackからVibe Remoteの状態ハブへ接続する小型リモコンアプリです。

## What It Does

- Wi-Fiへ接続
- mDNSで `_vibe-remote._tcp.local` を探索
- Vibe Remote WebSocketへトークン付きで接続
- Core2などBluetooth Classic対応機種では、Wi-Fiの代わりにSPPでも接続可能
- `state` を受信して画面に表示
- ボタン操作で簡易 `agentStatus` を送信

## Minimal Firmware For M5StickC Plus2

最初の実機疎通確認用に、mDNS や詳細ダッシュボードを省いた最小 firmware も用意しています。

- environment: `m5stickc-plus2-vibe-min`
- source: `src/minimal_vibe_remote.cpp`
- board: `m5stick-c`（PlatformIO に Plus2 専用 board 定義がないため、M5Stack の Plus2 例に合わせて流用）
- transport: Wi-Fi + WebSocket only
- discovery: Windows / Local bridge が advertise する `_vibe-remote._tcp.local` を mDNS で探索
- fallback: mDNS が使えない時だけ `VIBE_REMOTE_HOST` に VS Code / Local bridge 側の IP を指定
- buttons:
  - A: `running`
  - B: `waiting`
  - A hold: `failed`
  - B hold: `idle`
- Serial Monitor commands:
  - `r`: `running`
  - `w`: `waiting`
  - `d`: `done`
  - `f`: `failed`
  - `i`: `idle`
  - `p`: `ping`
  - `x`: reconnect

Wi-Fi / Vibe Remote token は repository に書き込まず、ビルド環境の環境変数か
`m5stack-client/.env.local` で指定します。

```bash
cat > .env.local <<'EOF'
VIBE_WIFI_SSID=your-home-ssid
VIBE_WIFI_PASS=your-home-password
VIBE_REMOTE_TOKEN=your-vibe-remote-token
EOF
```

`.env.local` は git ignore 済みです。Codespacesでビルドする場合は、Codespaces側の
`vibe-remote/m5stack-client/.env.local` に同じ値を置くか、同名の環境変数を付けて
`make vm-package` を実行します。mDNS が使えない時だけ `VIBE_REMOTE_HOST` も指定します。

Build / upload:

```bash
cd vibe-remote/m5stack-client
make build PIO_ENV=m5stickc-plus2-vibe-min
make upload PIO_ENV=m5stickc-plus2-vibe-min
make monitor
```

## Buttons

| 操作    | 送信/動作      |
| ------- | -------------- |
| A       | `running`      |
| B       | `waiting`      |
| C       | `done`         |
| A長押し | `failed`       |
| B長押し | `idle`         |
| C長押し | 再探索・再接続 |

## PC Side

VS Code側でVibe Remoteを起動し、以下を設定します。

1. `vibeRemote.bindAddress = 0.0.0.0`
2. `vibeRemote.discoveryEnabled = true`
3. `Vibe Remote: サーバを再起動`
4. `Vibe Remote: 接続トークンを表示`

## Device Build Settings

Wi-Fi / token は `.env.local` か環境変数で指定します。

```bash
VIBE_WIFI_SSID=your-home-ssid
VIBE_WIFI_PASS=your-home-password
VIBE_REMOTE_TOKEN=your-vibe-remote-token
```

mDNSが使えないネットワークでは、PCのIPを固定指定できます。

```bash
VIBE_REMOTE_HOST=192.168.1.10
VIBE_REMOTE_PORT=39271
```

Bluetooth Classic SPPで接続する場合は、Core2などSPP対応機種を使い、Wi-Fi設定の代わりに以下を有効化します。

```bash
VIBE_TRANSPORT_SPP=1
VIBE_DEVICE_NAME=M5Stack
VIBE_REMOTE_TOKEN=your-vibe-remote-token
```

PC側ではM5StackをBluetoothペアリングし、OSに現れたシリアルポートをVS Code設定へ入れます。

```json
{
  "vibeRemote.sppEnabled": true,
  "vibeRemote.sppPort": "COM5"
}
```

## Build And Flash

```bash
cd vibe-remote/m5stack-client
make build
make upload
make monitor
```

PlatformIOを直接使う場合:

```bash
pio run
pio run -t upload
pio device monitor
```

## Artifact Flow

VMでビルドしたバイナリをそのまま実機に入れる場合:

```bash
make vm-package PIO_ENV=m5stack-core2
make install-artifact ARTIFACT_DIR=artifacts/<timestamp>-m5stack-core2 PORT=/dev/ttyUSB0
```

GAR経由でM5StickC Plus2 Vibe Remote artifactを書き込む場合:

```bash
cd ~/Yurufuwa/GaplessAgentRuntime
gar target flash-esp32 --port COM3
```

`COM3` は WSL 上で `/dev/ttyS3` に自動変換されます。`--artifact-dir` を省略すると
`~/Yurufuwa/gar-vibe-ui/vibe-remote/m5stack-client/artifacts/` 配下の最新artifactを使います。
