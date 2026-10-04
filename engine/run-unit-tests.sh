#!/usr/bin/env bash
set -euo pipefail

# GMock/GTest unit tests for engine/mqsim/src - see engine/tests/unit/.
#
# Unlike run-regression-tests.sh (which runs a real workload end-to-end and
# diffs the result against a golden copy), these tests isolate one module
# at a time behind hand-written fakes/mocks of its collaborators, so they
# can check exact conditions (a specific erase-count spread, a specific
# threshold) deterministically in milliseconds - see
# https://jonghoon-ryu.github.io/ftl-visual-simulator/plan/
# for the investigation that motivated writing these: confirming static
# wear-leveling actually triggers took a native harness running millions of
# simulated event-groups before this test suite existed.
#
# Of this project's four "already abstract interface" classes
# (Address_Mapping_Unit_Base/Flash_Block_Manager_Base/GC_and_WL_Unit_Base/
# TSU_Base), only Address_Mapping_Unit_Base turned out to be richly enough
# virtual for genuine GMock EXPECT_CALL-style mocking - the others are only
# partially virtual, so engine/tests/unit/test_doubles.h uses hand-written
# fakes with directly-poked state for the methods that are concrete
# (Get_min_max_erase_difference, Get_coldest_block_id, ...) instead.
#
# Needs network access on first run (CMake's FetchContent pulls googletest
# from GitHub - no system package/sudo required); cached under
# engine/tests/unit/build/ after that.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DIR="$SCRIPT_DIR/tests/unit"
BUILD_DIR="$UNIT_DIR/build"

cmake -S "$UNIT_DIR" -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release
cmake --build "$BUILD_DIR" -j"$(nproc 2>/dev/null || echo 4)"
"$BUILD_DIR/mqsim_unit_tests"
