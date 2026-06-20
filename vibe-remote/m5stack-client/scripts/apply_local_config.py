"""Inject local Vibe Remote firmware config into PlatformIO builds.

Values can be supplied via environment variables or .env.local in this project
directory. The file is intentionally ignored by git.
"""

from __future__ import annotations

import os
from pathlib import Path

Import("env")  # type: ignore[name-defined]

ROOT_DIR = Path(env.subst("$PROJECT_DIR"))  # type: ignore[name-defined]
LOCAL_ENV_PATH = ROOT_DIR / ".env.local"

STRING_DEFINES = (
    "VIBE_DEVICE_NAME",
    "VIBE_WIFI_SSID",
    "VIBE_WIFI_PASS",
    "VIBE_REMOTE_TOKEN",
    "VIBE_SERVICE_TYPE",
    "VIBE_REMOTE_HOST",
)
INTEGER_DEFINES = ("VIBE_REMOTE_PORT",)
BOOLEAN_DEFINES = ("VIBE_TRANSPORT_SPP",)


def _parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return None
    key, value = stripped.split("=", 1)
    key = key.strip()
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
        value = value[1:-1]
    return key, value


def _load_local_env() -> dict[str, str]:
    values: dict[str, str] = {}
    if not LOCAL_ENV_PATH.exists():
        return values
    for line in LOCAL_ENV_PATH.read_text(encoding="utf-8").splitlines():
        parsed = _parse_env_line(line)
        if parsed is None:
            continue
        key, value = parsed
        values[key] = value
    return values


local_values = _load_local_env()
cpp_defines: list[tuple[str, str] | tuple[str, int]] = []

for key in STRING_DEFINES:
    value = os.environ.get(key, local_values.get(key))
    if value:
        cpp_defines.append((key, env.StringifyMacro(value)))  # type: ignore[name-defined]

for key in INTEGER_DEFINES:
    value = os.environ.get(key, local_values.get(key))
    if value:
        cpp_defines.append((key, int(value)))

for key in BOOLEAN_DEFINES:
    value = os.environ.get(key, local_values.get(key))
    if value and value.lower() not in ("0", "false", "no", "off"):
        cpp_defines.append((key, 1))

if cpp_defines:
    env.Append(CPPDEFINES=cpp_defines)  # type: ignore[name-defined]
    names = ", ".join(name for name, _ in cpp_defines)
    print(f"Applied local firmware config: {names}")
