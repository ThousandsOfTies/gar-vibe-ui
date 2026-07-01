#!/usr/bin/env bash
set -euo pipefail

ARTIFACT_DIR="${1:-}"
PORT="${2:-}"
BAUD="${BAUD:-921600}"

if [[ -z "$ARTIFACT_DIR" ]]; then
  echo "Usage: $0 <artifact_dir> [serial_port]" >&2
  exit 1
fi

if [[ ! -d "$ARTIFACT_DIR" ]]; then
  echo "ERROR: artifact dir not found: $ARTIFACT_DIR" >&2
  exit 1
fi

if [[ ! -f "$ARTIFACT_DIR/manifest.json" ]]; then
  echo "ERROR: manifest.json not found in $ARTIFACT_DIR" >&2
  exit 1
fi

if [[ -f "$ARTIFACT_DIR/SHA256SUMS" ]]; then
  echo "Verifying checksums..."
  (cd "$ARTIFACT_DIR" && sha256sum -c SHA256SUMS)
fi

if [[ -z "$PORT" ]]; then
  echo "ERROR: serial port is required (e.g. /dev/ttyUSB0)." >&2
  exit 1
fi

if command -v esptool.py >/dev/null 2>&1; then
  ESPTOOL_CMD=(esptool.py)
elif command -v esptool >/dev/null 2>&1; then
  ESPTOOL_CMD=(esptool)
elif python3 -c "import esptool" >/dev/null 2>&1; then
  ESPTOOL_CMD=(python3 -m esptool)
else
  echo "ERROR: esptool not found." >&2
  exit 1
fi

ARGS=(
  --chip esp32
  --port "$PORT"
  --baud "$BAUD"
  --before default_reset
  --after hard_reset
  write_flash -z
)

if [[ -f "$ARTIFACT_DIR/bootloader.bin" ]]; then
  ARGS+=(0x1000 "$ARTIFACT_DIR/bootloader.bin")
fi
if [[ -f "$ARTIFACT_DIR/partitions.bin" ]]; then
  ARGS+=(0x8000 "$ARTIFACT_DIR/partitions.bin")
fi
if [[ -f "$ARTIFACT_DIR/boot_app0.bin" ]]; then
  ARGS+=(0xE000 "$ARTIFACT_DIR/boot_app0.bin")
fi
if [[ -f "$ARTIFACT_DIR/firmware.bin" ]]; then
  ARGS+=(0x10000 "$ARTIFACT_DIR/firmware.bin")
else
  echo "ERROR: firmware.bin not found in $ARTIFACT_DIR" >&2
  exit 1
fi

echo "Flashing artifact: $ARTIFACT_DIR"
echo "Port: $PORT"

# shellcheck disable=SC2068
${ESPTOOL_CMD[@]} ${ARGS[@]}

echo "Flash complete."
