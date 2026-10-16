#!/usr/bin/env bash
set -euo pipefail

# Builds the vendored MQSim engine (engine/mqsim/src) plus the Emscripten
# bindings (engine/mqsim/src/wasm/bindings.cpp) into a WASM module the Vite
# app can import from src/wasm-build/.
#
# Prerequisite: an Emscripten SDK environment must already be active on
# PATH in this shell (i.e. you've run `source /path/to/emsdk/emsdk_env.sh`)
# - this script does not install or activate emsdk itself.

if ! command -v em++ >/dev/null 2>&1; then
	echo "error: em++ not found on PATH." >&2
	echo "Activate an Emscripten SDK first, e.g.:" >&2
	echo "  source /path/to/emsdk/emsdk_env.sh" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="$SCRIPT_DIR/mqsim"
OUT_DIR="$SCRIPT_DIR/../src/wasm-build"

INCLUDES=()
for m in exec host nvm_chip nvm_chip/flash_memory sim ssd utils; do
	INCLUDES+=("-I$ENGINE_DIR/src/$m")
done

SRCS=()
while IFS= read -r -d '' f; do
	SRCS+=("$f")
done < <(find "$ENGINE_DIR/src" -name "*.cpp" ! -name "main.cpp" -print0)
# main.cpp (the CLI entry point) is intentionally excluded - it's not part
# of the library, and linking it in risks its own main() being picked up by
# the WASM runtime's auto-run behavior instead of our embind bindings.

mkdir -p "$OUT_DIR"

em++ -std=c++17 -fexceptions -O2 \
	"${INCLUDES[@]}" \
	"${SRCS[@]}" \
	-lembind \
	-sSTACK_SIZE=16MB \
	-sALLOW_MEMORY_GROWTH=1 \
	-sINITIAL_MEMORY=128MB \
	-sMAXIMUM_MEMORY=4GB \
	-sMODULARIZE=1 \
	-sEXPORT_ES6=1 \
	-sEXPORT_NAME=createMQSimModule \
	-sEXPORTED_RUNTIME_METHODS=HEAPU8 \
	-sENVIRONMENT=web,worker,node \
	-o "$OUT_DIR/mqsim.mjs"
# -sMAXIMUM_MEMORY=4GB: WASM32's actual hard ceiling - large-occupancy
# configs can legitimately need close to 2GB (verified against
# AddressMappingDomain's own allocation size), so don't set this lower.
# -sEXPORTED_RUNTIME_METHODS=HEAPU8: the worker copies linear memory for
# the step-back (⏪) snapshots - see memory_layout() in bindings.cpp.
# -fexceptions: without it, a thrown C++ exception (e.g. std::bad_alloc)
# aborts with no message at all instead of being catchable/diagnosable.

echo "Built $OUT_DIR/mqsim.mjs (+ mqsim.wasm)"
