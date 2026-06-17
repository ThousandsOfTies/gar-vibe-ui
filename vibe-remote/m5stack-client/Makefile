PIO_ENV ?= m5stack-core2
ARTIFACT_DIR ?=
PORT ?=

.PHONY: vm-package install-artifact

vm-package:
	./scripts/vm_build_and_package.sh "$(PIO_ENV)"

install-artifact:
	@if [ -z "$(ARTIFACT_DIR)" ]; then \
		echo "ARTIFACT_DIR is required"; \
		exit 1; \
	fi
	./scripts/install_artifact.sh "$(ARTIFACT_DIR)" "$(PORT)"
