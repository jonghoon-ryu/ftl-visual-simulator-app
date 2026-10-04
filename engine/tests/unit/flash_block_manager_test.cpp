#include <gtest/gtest.h>
#include "test_doubles.h"

using namespace SSD_Components;
using NVM::FlashMemory::Physical_Page_Address;
using mqsim_test::FakeFlashBlockManager;

// Regression test for the bug documented at
// https://jonghoon-ryu.github.io/ftl-visual-simulator/reference/code-change/bug-list/wl-bug-deviation/ -
// upstream MQSim's Get_min_max_erase_difference() returned the difference of
// the two blocks' *indices* instead of their *erase counts* (and could
// underflow to ~4 billion via unsigned subtraction when the higher-erase
// block happened to have the lower index). This project fixed it to return
// the actual erase-count difference. A GTest fixture like this checks that
// in milliseconds - no need to run a real workload for potentially millions
// of event-groups hoping erase counts happen to drift apart naturally
// (which is what this project's native step-count harness had to do before
// this test existed - see
// https://jonghoon-ryu.github.io/ftl-visual-simulator/plan/).
TEST(GetMinMaxEraseDifference, ReturnsEraseCountGapNotBlockIndexGap) {
	// 4 blocks, 1 channel/chip/die/plane, 1 concurrent stream, 4 pages/block -
	// tiny geometry, only Erase_count matters for this test.
	FakeFlashBlockManager fbm(/*gc_and_wl_unit=*/nullptr, /*max_allowed_block_erase_count=*/10000,
		/*total_concurrent_streams_no=*/1, /*channel_count=*/1, /*chip_no_per_channel=*/1,
		/*die_no_per_chip=*/1, /*plane_no_per_die=*/1, /*block_no_per_plane=*/4, /*page_no_per_block=*/4);

	Physical_Page_Address plane_address;
	PlaneBookKeepingType* plane = fbm.Get_plane_bookkeeping_entry(plane_address);

	// Deliberately put the *lower* erase count at the *higher* block index -
	// exactly the case that made the old (buggy) upstream implementation
	// underflow via unsigned subtraction (e.g. "5 - 1500") instead of
	// returning a small, correct difference.
	plane->Blocks[0].Erase_count = 40; // highest erase count, lowest index
	plane->Blocks[1].Erase_count = 12;
	plane->Blocks[2].Erase_count = 25;
	plane->Blocks[3].Erase_count = 3;  // lowest erase count, highest index

	unsigned int diff = fbm.Get_min_max_erase_difference(plane_address);

	EXPECT_EQ(diff, 37u); // 40 - 3, not 3 - 0 (index gap) and not an underflow
}

TEST(GetMinMaxEraseDifference, ZeroWhenAllBlocksEquallyWorn) {
	FakeFlashBlockManager fbm(nullptr, 10000, 1, 1, 1, 1, 1, 8, 4);
	Physical_Page_Address plane_address;
	PlaneBookKeepingType* plane = fbm.Get_plane_bookkeeping_entry(plane_address);
	for (unsigned int i = 0; i < 8; i++) {
		plane->Blocks[i].Erase_count = 7;
	}

	EXPECT_EQ(fbm.Get_min_max_erase_difference(plane_address), 0u);
}

// Get_coldest_block_id() picks the *first* block with the strictly-lowest
// erase count (ties broken by lowest index) - documenting this exact
// tie-breaking rule matters because it's the reason a genuinely idle block
// almost never gets picked over an actively-rotating write frontier at
// index 0-2 in this project's demo presets (see the wear-leveling
// integration doc's section on why static WL only fires once per run).
TEST(GetColdestBlockId, PicksLowestIndexAmongTiedMinimums) {
	FakeFlashBlockManager fbm(nullptr, 10000, 1, 1, 1, 1, 1, 5, 4);
	Physical_Page_Address plane_address;
	PlaneBookKeepingType* plane = fbm.Get_plane_bookkeeping_entry(plane_address);
	plane->Blocks[0].Erase_count = 10;
	plane->Blocks[1].Erase_count = 0;
	plane->Blocks[2].Erase_count = 0; // tied with block 1, but higher index
	plane->Blocks[3].Erase_count = 5;
	plane->Blocks[4].Erase_count = 0; // tied too, even higher index

	EXPECT_EQ(fbm.Get_coldest_block_id(plane_address), 1u);
}
