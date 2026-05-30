#!/usr/bin/env bash
# Compile the C++ engine to a WASM ES module usable in both the browser and Node.
# Output: dist/ingenious.mjs + dist/ingenious.wasm
set -euo pipefail
cd "$(dirname "$0")"

OUT_WEB="../web/src/engine"
OUT_WEB_PUB="../web/public"
OUT_SRV="../server/engine"
mkdir -p dist "$OUT_WEB" "$OUT_WEB_PUB" "$OUT_SRV"

COMMON="-std=c++17 -O3 -lembind -s MODULARIZE=1 -s EXPORT_ES6=1 \
  -s EXPORT_NAME=createIngenious -s ALLOW_MEMORY_GROWTH=1"

# Browser target: ENVIRONMENT=web only — avoids the top-level `import 'node:module'`
# the web,node glue emits, which breaks in browsers/Vite.
emcc bindings.cpp $COMMON -s ENVIRONMENT=web -o dist/ingenious.web.mjs
# Node target: server-side, resolves the wasm via import.meta.url.
emcc bindings.cpp $COMMON -s ENVIRONMENT=node -o dist/ingenious.node.mjs

# Distribute:
#  - browser: JS module in src/engine, wasm served from public/ (loaded via locateFile)
#  - server:  both files side-by-side
# Web: the browser loader overrides locateFile -> /ingenious.wasm, so the file
# name on disk can be simplified.
cp dist/ingenious.web.mjs "$OUT_WEB/ingenious.mjs"
cp dist/ingenious.web.wasm "$OUT_WEB_PUB/ingenious.wasm"
# Node: the glue resolves its wasm by its own basename via import.meta.url, so the
# wasm MUST keep the name the .mjs expects (ingenious.node.wasm).
cp dist/ingenious.node.mjs "$OUT_SRV/ingenious.mjs"
cp dist/ingenious.node.wasm "$OUT_SRV/ingenious.node.wasm"
rm -f "$OUT_SRV/ingenious.wasm"  # remove stale misnamed copy from older builds
echo "Engine built -> web/src/engine + web/public + server/engine"
