#!/usr/bin/env python3
"""Generate the GAR Wokwi workspace for this M5StickC client."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))

from scripts.gar_lib._hw import load_hw_definition
from scripts.gar_lib.environments.registry.simulation.wokwi import WokwiEnvironment
from scripts.gar_lib.sim.wokwi import WokwiSimProvider


def main() -> int:
    provider = WokwiSimProvider(WokwiEnvironment, host=None)
    return provider.prepare_project(load_hw_definition())


if __name__ == "__main__":
    raise SystemExit(main())
