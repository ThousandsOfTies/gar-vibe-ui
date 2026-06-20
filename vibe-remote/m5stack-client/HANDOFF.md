# M5Stack クライアント開発 引継ぎメモ

最終更新: 2026-06-18
対象: Vibe Remote に接続する M5Stack 側クライアント

## 1. 目的

M5Stack から Vibe Remote（VS Code Extension 側の WebSocket サーバ）へ接続し、
以下を実現する。

- mDNS で接続先を自動発見
- トークン付き `hello` / `ping` / `agentStatus` 送信
- `state` / `ack` を受信して表示

## 2. 現在の実装状況

実装済みファイル:

- `m5stack-client/platformio.ini`
- `m5stack-client/src/main.cpp`
- `m5stack-client/src/minimal_vibe_remote.cpp`

主な実装済み機能:

- Arduino + ESP32 + M5Unified 構成
- Wi-Fi 接続
- mDNS クエリで `_vibe-remote._tcp.local` を探索
- WebSocket 接続（パス `/`）
- 接続時 `hello` 送信
- 定期 `ping` 送信（5秒）
- ボタン送信
  - BtnA -> `running`
  - BtnB -> `waiting`
  - BtnC -> `done`
  - BtnA長押し -> `failed`
  - BtnB長押し -> `idle`
  - BtnC長押し -> 再探索・再接続
- 受信メッセージ表示（Serial + M5 Display）

最小 firmware:

- environment: `m5stickc-plus2-vibe-min`
- source: `src/minimal_vibe_remote.cpp`
- M5StickC Plus2 / ESP32-PICO-V3-02 の最初の実機疎通確認用
- PlatformIO board は `m5stick-c` を流用。Plus2 の電源保持用に setup 冒頭で GPIO4 を High にする
- Windows / Local bridge が advertise する `_vibe-remote._tcp.local` を mDNS で探索
- `VIBE_REMOTE_HOST` は mDNS が使えない場合の fallback
- `hello` / `ping` / `agentStatus` のみを最小実装
- Serial Monitor から `r/w/d/f/i/p/x` で状態送信・ping・再接続を操作可能

## 3. 前提（PC側）

Vibe Remote Extension 側で以下が必要。

1. `vibeRemote.bindAddress = 0.0.0.0`
2. `vibeRemote.discoveryEnabled = true`
3. `Vibe Remote: サーバを再起動`
4. 接続トークンを表示し、M5 側の `VIBE_REMOTE_TOKEN` に設定

## 4. M5 側セットアップ手順

### 4.1 platformio.ini の設定

`m5stack-client/platformio.ini` の `build_flags` を更新:

- `VIBE_WIFI_SSID`
- `VIBE_WIFI_PASS`
- `VIBE_REMOTE_TOKEN`
- 必要なら `VIBE_SERVICE_TYPE`（デフォルト `vibe-remote`）

### 4.2 ボード種別

現在は以下で設定済み:

- `board = m5stack-core2`

M5StickC Plus2 の最小 firmware は以下:

- `PIO_ENV=m5stickc-plus2-vibe-min`
- `board = m5stick-c`
- `src/minimal_vibe_remote.cpp` のみを build

機種に応じて変更候補:

- `m5stack-core-esp32`
- `m5stack-fire`

### 4.3 ビルド/書込み

この作業環境では `pio` 未導入のため、未検証。
ローカル開発機で以下を実施する想定:

```bash
cd vibe-remote/m5stack-client
pio run
pio run -t upload
pio device monitor
```

最小 firmware の場合:

```bash
cd vibe-remote/m5stack-client
pio run -e m5stickc-plus2-vibe-min
pio run -e m5stickc-plus2-vibe-min -t upload
pio device monitor
```

## 4.4 GaplessAgentRuntime 想定フロー（VM合格バイナリを実機へ）

本ケースでは「VMで確認したバイナリそのもの」を実機に導入する。

1. VMでビルドしてアーティファクト化

```bash
cd vibe-remote/m5stack-client
make vm-package PIO_ENV=m5stack-core2
```

成果物は `artifacts/<timestamp>-<env>/` に生成される。

- `firmware.bin`
- `bootloader.bin`
- `partitions.bin`
- `boot_app0.bin`（見つかった場合）
- `manifest.json`
- `SHA256SUMS`

2. 実機へ同一アーティファクトを書込み

```bash
cd vibe-remote/m5stack-client
make install-artifact ARTIFACT_DIR=artifacts/<timestamp>-m5stack-core2 PORT=/dev/ttyUSB0
```

`install-artifact` は `SHA256SUMS` を検証後、`esptool` でフラッシュする。

これにより「VMで合格したバイナリID（sha256）」を保ったまま実機へ展開できる。

## 5. 既知の制約・注意点

1. TLS 未対応（`ws://`）
2. 認証は共有トークンのみ
3. mDNS が使えないネットワークでは自動発見不可
4. 再接続戦略は初期実装（要実運用チューニング）
5. UI 表示は状態ダッシュボード中心（詳細履歴はSerial Monitorで確認）

## 6. 次担当タスク（優先順）

1. `m5stickc-plus2-vibe-min` を実機で build/upload し、`hello` ack と `ping` state を確認
2. Serial Monitor の `r/w/d/f/i` で VS Code 側ステータスが変化することを確認
3. VM環境に PlatformIO/esptool を導入し、`make vm-package PIO_ENV=m5stickc-plus2-vibe-min` を実行
4. mDNS 探索結果の安定化（複数候補時の選択規則）
5. 接続失敗時の UX 改善（原因別の案内、復旧手順表示）
6. トークン入力方式の改善（NVS保存、QR導入検討）
7. PC側 mDNS 名変更時の追従テスト
8. 長押し操作の誤操作防止（確認表示、短いバイブ/音など）

## 7. 動作確認チェックリスト

- [ ] Wi-Fi 接続成功
- [ ] mDNS で `vibe-remote` サービスを検出
- [ ] WebSocket 接続成功
- [ ] `hello` で `ack ok=true` を受信
- [ ] `ping` で `state` を定期受信
- [ ] BtnA/B/C の押下で VS Code 側ステータスが変化

## 8. プロトコル最小仕様（現行）

送信:

```json
{"type":"hello","token":"..."}
{"type":"ping","token":"..."}
{"type":"agentStatus","token":"...","status":"running|waiting|done|failed|idle","source":"m5stack","message":"..."}
```

受信:

```json
{"type":"ack","ok":true}
{"type":"state","chat":"working|maybeWaiting|idle", ...}
```

## 9. 引継ぎメモ

- 現在のコードは、状態ダッシュボードとボタン操作まで含む実機向け初期版。
- まずは実機で通信安定性、mDNS探索、画面表示、ボタン送信を確認する。
- セキュリティ面ではトークン管理（配布/更新）の運用ルール設計が必須。
