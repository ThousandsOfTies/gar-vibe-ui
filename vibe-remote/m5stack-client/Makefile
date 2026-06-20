PIO_ENV ?= m5stack-core2
ARTIFACT_DIR ?=
PORT ?=

.PHONY: build upload monitor vm-package install-artifact

build:
	pio run -e "$(PIO_ENV)"

upload:
	pio run -e "$(PIO_ENV)" -t upload

monitor:
	pio device monitor

vm-package:
	./scripts/vm_build_and_package.sh "$(PIO_ENV)"

install-artifact:
	@if [ -z "$(ARTIFACT_DIR)" ]; then \
		echo "ARTIFACT_DIR is required"; \
		exit 1; \
	fi
	./scripts/install_artifact.sh "$(ARTIFACT_DIR)" "$(PORT)"
