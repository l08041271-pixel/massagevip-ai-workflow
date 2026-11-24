SITE_DIR := site
PYTHON ?= python3

.PHONY: all check site clean

# Default target used by the Netlify build command (`make all`).
all: check site

# Sanity-check that every Python module compiles (no bytecode written).
check:
	$(PYTHON) -c "import ast, pathlib, sys; [ast.parse(p.read_text(encoding=\"utf-8\"), filename=str(p)) for p in pathlib.Path(\".\").glob(\"*.py\")]"

# Assemble the static site published by Netlify.
site:
	rm -rf $(SITE_DIR)
	mkdir -p $(SITE_DIR)
	cp QR_SETUP.html $(SITE_DIR)/index.html
	cp QR_SETUP.html $(SITE_DIR)/QR_SETUP.html

clean:
	rm -rf $(SITE_DIR)
