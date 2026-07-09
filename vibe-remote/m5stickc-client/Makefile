PIO_ENV ?= m5stickc-plus2-vibe-min
ARTIFACT_DIR ?=
PORT ?=
ARTIFACT_STAMP ?= .gar-artifact-$(PIO_ENV).stamp
GAR_TOOLS_ROOT ?= ../../../gar-tools
WOKWI_WORKSPACE ?= .gar/wokwi/m5stackc
WOKWI_TEMPLATE ?= $(GAR_TOOLS_ROOT)/targets/esp32/wokwi/m5stackc
WOKWI_PREPARE_SCRIPT ?= $(WOKWI_TEMPLATE)/scripts/prepare_workspace.py
WOKWI_APP_CONFIG ?= $(CURDIR)/wokwi.ini
WOKWI_STAMP = $(WOKWI_WORKSPACE)/.gar-generated
WOKWI_WORKSPACE_ABS := $(abspath $(WOKWI_WORKSPACE))
WOKWI_TEMPLATE_ABS := $(abspath $(WOKWI_TEMPLATE))
WOKWI_APP_CONFIG_ABS := $(abspath $(WOKWI_APP_CONFIG))
APP_SRC_ABS := $(abspath src)
WOKWI_TEMPLATE_FILES := $(shell test -d "$(WOKWI_TEMPLATE)" && find "$(WOKWI_TEMPLATE)" -type f 2>/dev/null)
APP_SRC_FILES := $(shell find src -maxdepth 2 -type f 2>/dev/null)
LOCAL_CONFIG := $(wildcard .env.local)
BUILD_INPUTS := platformio.ini scripts/apply_local_config.py scripts/vm_build_and_package.sh $(LOCAL_CONFIG) $(APP_SRC_FILES)

.PHONY: FORCE build upload monitor vm-package check-real-config artifact-latest install-artifact flash wokwi-workspace wokwi-build wokwi-clean

FORCE:

build:
	pio run -e "$(PIO_ENV)"

upload:
	pio run -e "$(PIO_ENV)" -t upload

monitor:
	pio device monitor

$(WOKWI_STAMP): $(WOKWI_TEMPLATE_FILES) $(WOKWI_APP_CONFIG) $(APP_SRC_FILES) FORCE
	@test -d "$(WOKWI_TEMPLATE)" || { echo "missing Wokwi template: $(WOKWI_TEMPLATE)"; exit 1; }
	@test -f "$(WOKWI_PREPARE_SCRIPT)" || { echo "missing Wokwi workspace tool: $(WOKWI_PREPARE_SCRIPT)"; exit 1; }
	GAR_WOKWI_PROJECT_DIR="$(WOKWI_WORKSPACE_ABS)" \
	GAR_WOKWI_TEMPLATE_DIR="$(WOKWI_TEMPLATE_ABS)" \
	GAR_WOKWI_APP_SRC_DIR="$(APP_SRC_ABS)" \
	GAR_WOKWI_APP_CONFIG="$(WOKWI_APP_CONFIG_ABS)" \
	python3 "$(WOKWI_PREPARE_SCRIPT)"
	@touch "$@"

wokwi-workspace: $(WOKWI_STAMP)

wokwi-build: wokwi-workspace
	cd "$(WOKWI_WORKSPACE_ABS)" && pio run

wokwi-clean:
	rm -rf "$(WOKWI_WORKSPACE)"

vm-package:
	./scripts/vm_build_and_package.sh "$(PIO_ENV)"

check-real-config:
	@if [ -z "$${VIBE_WIFI_SSID:-}" ] && ! grep -Eq '^VIBE_WIFI_SSID=.+' .env.local 2>/dev/null; then \
		echo "VIBE_WIFI_SSID is required for real-device firmware. Set it in .env.local or the environment."; \
		exit 1; \
	fi
	@if [ -z "$${VIBE_WIFI_PASS:-}" ] && ! grep -Eq '^VIBE_WIFI_PASS=.+' .env.local 2>/dev/null; then \
		echo "VIBE_WIFI_PASS is required for real-device firmware. Set it in .env.local or the environment."; \
		exit 1; \
	fi
	@if [ -z "$${VIBE_REMOTE_TOKEN:-}" ] && ! grep -Eq '^VIBE_REMOTE_TOKEN=.+' .env.local 2>/dev/null; then \
		echo "VIBE_REMOTE_TOKEN is required for real-device firmware. Set it in .env.local or the environment."; \
		exit 1; \
	fi

$(ARTIFACT_STAMP): check-real-config $(BUILD_INPUTS)
	./scripts/vm_build_and_package.sh "$(PIO_ENV)" | tee .gar-artifact-package.log
	@awk -F'Artifact: ' '/^Artifact: / { artifact=$$2 } END { if (!artifact) exit 1; print artifact }' .gar-artifact-package.log > "$@"

artifact-latest: $(ARTIFACT_STAMP)
	@cat "$(ARTIFACT_STAMP)"

install-artifact:
	@if [ -z "$(ARTIFACT_DIR)" ]; then \
		echo "ARTIFACT_DIR is required"; \
		exit 1; \
	fi
	./scripts/install_artifact.sh "$(ARTIFACT_DIR)" "$(PORT)"

flash: artifact-latest
	@test -x "$(GAR_ROOT)/scripts/gar" || { echo "missing GAR CLI: $(GAR_ROOT)/scripts/gar"; exit 1; }
	@test -n "$(PORT)" || { echo "PORT is required (example: make flash PORT=/dev/ttyACM0)"; exit 1; }
	cd "$(GAR_ROOT)" && scripts/gar target flash-esp32 --artifact-dir "$$(cat "$(CURDIR)/$(ARTIFACT_STAMP)")" --port "$(PORT)"
