#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
"$ROOT_DIR/scripts/ensure-node.sh" >/dev/null

export PATH="$ROOT_DIR/.tools/node/bin:$PATH"
exec node "$@"
