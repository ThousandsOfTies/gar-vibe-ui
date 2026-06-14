#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${VIBE_REMOTE_NODE_VERSION:-20.19.5}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$ROOT_DIR/.tools"
NODE_LINK="$TOOLS_DIR/node"

case "$(uname -m)" in
  x86_64) NODE_ARCH="x64" ;;
  aarch64 | arm64) NODE_ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

NODE_DIR="$TOOLS_DIR/node-v$NODE_VERSION-linux-$NODE_ARCH"
NODE_BIN="$NODE_LINK/bin/node"

if [ -x "$NODE_BIN" ]; then
  exit 0
fi

mkdir -p "$TOOLS_DIR"
ARCHIVE="node-v$NODE_VERSION-linux-$NODE_ARCH.tar.xz"
URL="https://nodejs.org/dist/v$NODE_VERSION/$ARCHIVE"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Installing Node.js v$NODE_VERSION for linux-$NODE_ARCH into $TOOLS_DIR"
curl -fsSL "$URL" -o "$TMP_DIR/$ARCHIVE"
tar -xJf "$TMP_DIR/$ARCHIVE" -C "$TOOLS_DIR"
ln -sfn "$NODE_DIR" "$NODE_LINK"

"$NODE_BIN" --version
