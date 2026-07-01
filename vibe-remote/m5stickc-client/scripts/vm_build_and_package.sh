#!/usr/bin/env bash
set -euo pipefail

PIO_ENV="${1:-m5stickc-plus2-vibe-min}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/.pio/build/$PIO_ENV"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARTIFACT_ROOT="$ROOT_DIR/artifacts/$STAMP-$PIO_ENV"

if ! command -v pio >/dev/null 2>&1; then
  echo "ERROR: pio command not found. Install PlatformIO first." >&2
  exit 1
fi

echo "[1/3] Build firmware in VM (env=$PIO_ENV)"
pio run -d "$ROOT_DIR" -e "$PIO_ENV"

if [[ ! -d "$BUILD_DIR" ]]; then
  echo "ERROR: build output not found: $BUILD_DIR" >&2
  exit 1
fi

echo "[2/3] Package immutable artifact"
mkdir -p "$ARTIFACT_ROOT"

cp "$BUILD_DIR/firmware.bin" "$ARTIFACT_ROOT/"
cp "$BUILD_DIR/bootloader.bin" "$ARTIFACT_ROOT/"
cp "$BUILD_DIR/partitions.bin" "$ARTIFACT_ROOT/"

BOOT_APP0_PATH=""
for p in \
  "$HOME/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin" \
  "$HOME/.platformio/packages/framework-espidf/components/bootloader/subproject/main/bootloader.bin"
  do
  if [[ -f "$p" ]]; then
    BOOT_APP0_PATH="$p"
    break
  fi
done

if [[ -n "$BOOT_APP0_PATH" ]]; then
  cp "$BOOT_APP0_PATH" "$ARTIFACT_ROOT/boot_app0.bin"
else
  echo "WARN: boot_app0.bin not found. Flash may fail on blank chips." >&2
fi

cat > "$ARTIFACT_ROOT/manifest.json" <<EOF
{
  "created_at": "$(date -Iseconds)",
  "pio_env": "$PIO_ENV",
  "flash_layout": [
    {"offset": "0x1000", "file": "bootloader.bin"},
    {"offset": "0x8000", "file": "partitions.bin"},
    {"offset": "0xE000", "file": "boot_app0.bin"},
    {"offset": "0x10000", "file": "firmware.bin"}
  ]
}
EOF

(
  cd "$ARTIFACT_ROOT"
  sha256sum *.bin > SHA256SUMS
)

echo "[3/3] Done"
echo "Artifact: $ARTIFACT_ROOT"
echo "Next: ./scripts/install_artifact.sh \"$ARTIFACT_ROOT\" /dev/ttyUSB0"
