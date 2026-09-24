#include <gtest/gtest.h>
#include <gmock/gmock.h>
#include "test_doubles.h"
#include "ssd/GC_and_WL_Unit_Page_Level.h"
#include "ssd/Stats.h"

using namespace SSD_Components;
using NVM::FlashMemory::Physical_Page_Address;
using mqsim_test::FakeFlashBlockManager;
using mqsim_test::FakeTSU;
using mqsim_test::MockAddressMappingUnit;
using ::testing::Field;
using ::testing::_;

namespace {

// check_static_wl_required()/run_static_wearleveling() are `protected` on
// GC_and_WL_Unit_Base (only its own subclasses and the static PHY-signal
// callback call them - no outside caller should). A derived class can
// still call an inherited protected member on an object of its own type,
// so a `using`-declaration in a public section re-exposes them for this
// test file only, without touching the real class's access rules.
class TestableGCAndWLUnit : public GC_and_WL_Unit_Page_Level {
public:
	using GC_and_WL_Unit_Page_Level::GC_and_WL_Unit_Page_Level;
	using GC_and_WL_Unit_Page_Level::check_static_wl_required;
	using GC_and_WL_Unit_Page_Level::run_static_wearleveling;
};

} // namespace

// This is the test the whole plan/wear-leveling-integration.md investigation
// was really after: does static wear-leveling trigger, and does it target
// the block it should, *without* needing to run a real workload for ~1.5
// million event-groups and hope the timing lines up? With the four classes
// wired together as fakes/mocks instead of a full simulation, the answer
// is yes, in well under a millisecond.
class StaticWearLevelingTest : public ::testing::Test {
protected:
	// 5 blocks, 1 stream -> Get_a_free_block() hands out blocks 0/1/2 as the
	// initial Data_wf/Translation_wf/GC_wf frontiers (in that order - see
	// Flash_Block_Manager_Base's constructor), leaving blocks 3 and 4 as
	// genuinely idle free blocks. is_safe_gc_wl_candidate() explicitly
	// rejects any of the three frontiers as a WL target (see GC_and_WL_Unit_
	// Base.cpp) - this is the exact structural reason, documented at
	// https://jonghoon-ryu.github.io/ftl-visual-simulator/reference/wl-threshold-not-wired-bug/,
	// that static WL only ever finds a real target once one of those idle
	// blocks becomes the coldest *and* isn't itself a frontier.
	//
	// Static WL's job is relocating *cold data*, so a real target must also
	// hold written pages - an empty free-pool block has nothing to move (and
	// erasing one would re-insert it into Free_block_pool a second time), see
	// GC_and_WL_Unit_Base::get_static_wl_erase_info(). Tests that expect a
	// trigger mark their cold block(s) as fully written with this.
	void MarkFullyWrittenColdData(flash_block_ID_type block_id) {
		PlaneBookKeepingType* plane = fbm.Get_plane_bookkeeping_entry(plane_address);
		plane->Blocks[block_id].Current_page_write_index = 4;
		// Every valid page gets a migration read built for it, which asks the
		// AMU for that page's PPA - expected, not what these tests assert on.
		EXPECT_CALL(amu, Convert_address_to_ppa(_)).Times(::testing::AnyNumber());
	}
	FakeFlashBlockManager fbm{/*gc_and_wl_unit=*/nullptr, /*max_allowed_block_erase_count=*/10000,
		/*total_concurrent_streams_no=*/1, /*channel_count=*/1, /*chip_no_per_channel=*/1,
		/*die_no_per_chip=*/1, /*plane_no_per_die=*/1, /*block_no_per_plane=*/5, /*page_no_per_block=*/4};
	MockAddressMappingUnit amu;
	FakeTSU tsu{"fake-tsu", nullptr, nullptr, Flash_Scheduling_Type::OUT_OF_ORDER,
		1, 1, 1, 1, false, false, 0, 0, 0};
	Physical_Page_Address plane_address;

	TestableGCAndWLUnit MakeUnit(unsigned int static_wl_threshold) {
		return TestableGCAndWLUnit("gc-wl-unit", &amu, &fbm, &tsu, /*flash_controller=*/nullptr,
			GC_Block_Selection_Policy_Type::RGA, /*gc_threshold=*/0.5, /*preemptible_gc_enabled=*/false,
			/*gc_hard_threshold=*/0.005, /*channel_count=*/1, /*chip_no_per_channel=*/1,
			/*die_no_per_chip=*/1, /*plane_no_per_die=*/1, /*block_no_per_plane=*/5, /*page_no_per_block=*/4,
			/*sector_no_per_page=*/8, /*use_copyback=*/false, /*rho=*/0, /*max_ongoing_gc_reqs_per_plane=*/10,
			/*dynamic_wearleveling_enabled=*/true, /*static_wearleveling_enabled=*/true, static_wl_threshold, /*seed=*/1);
	}
};

TEST_F(StaticWearLevelingTest, TriggersOnIdleColdestBlockAndBarriersIt) {
	// Frontiers (0/1/2) get worn down; blocks 3/4 sit idle. Block 3 is the
	// strictly-coldest block overall *and* isn't a frontier, so it's the
	// one and only safe candidate.
	PlaneBookKeepingType* plane = fbm.Get_plane_bookkeeping_entry(plane_address);
	plane->Blocks[0].Erase_count = 10;
	plane->Blocks[1].Erase_count = 10;
	plane->Blocks[2].Erase_count = 10;
	plane->Blocks[3].Erase_count = 0;
	plane->Blocks[4].Erase_count = 5;
	MarkFullyWrittenColdData(3);
	MarkFullyWrittenColdData(4);

	TestableGCAndWLUnit unit = MakeUnit(/*static_wl_threshold=*/5); // gap of 10 >= 5

	EXPECT_CALL(amu, Set_barrier_for_accessing_physical_block(
		Field(&Physical_Page_Address::BlockID, 3u))).Times(1);

	unsigned int wl_before = Stats::Total_wl_executions;
	ASSERT_TRUE(unit.check_static_wl_required(plane_address));
	unit.run_static_wearleveling(plane_address);

	EXPECT_EQ(Stats::Total_wl_executions, wl_before + 1);
	EXPECT_TRUE(plane->Blocks[3].Has_ongoing_gc_wl);
}

TEST_F(StaticWearLevelingTest, DoesNotTriggerBelowThreshold) {
	PlaneBookKeepingType* plane = fbm.Get_plane_bookkeeping_entry(plane_address);
	plane->Blocks[0].Erase_count = 4;
	plane->Blocks[1].Erase_count = 4;
	plane->Blocks[2].Erase_count = 4;
	plane->Blocks[3].Erase_count = 1;
	plane->Blocks[4].Erase_count = 3;
	MarkFullyWrittenColdData(3);
	MarkFullyWrittenColdData(4);
	// gap is 4 - 1 = 3

	TestableGCAndWLUnit unit = MakeUnit(/*static_wl_threshold=*/5);

	EXPECT_CALL(amu, Set_barrier_for_accessing_physical_block(_)).Times(0);
	EXPECT_FALSE(unit.check_static_wl_required(plane_address));
}

// The bug at
// https://jonghoon-ryu.github.io/ftl-visual-simulator/reference/wl-threshold-not-wired-bug/
// (SSD_Device.cpp never passing Static_Wearleveling_Threshold through to
// this class's constructor, so it always used the compiled-in default of
// 100) would have been caught immediately by a test like this one - it
// directly asserts that the threshold *this test* passed in is the one
// actually being compared against, independent of whatever XML config
// generation happens to do elsewhere in the app.
TEST_F(StaticWearLevelingTest, HonorsTheThresholdItWasConstructedWith) {
	PlaneBookKeepingType* plane = fbm.Get_plane_bookkeeping_entry(plane_address);
	plane->Blocks[0].Erase_count = 10;
	plane->Blocks[1].Erase_count = 10;
	plane->Blocks[2].Erase_count = 10;
	plane->Blocks[3].Erase_count = 3;
	plane->Blocks[4].Erase_count = 8;
	MarkFullyWrittenColdData(3);
	MarkFullyWrittenColdData(4);
	// gap is 10 - 3 = 7

	TestableGCAndWLUnit lenient_unit = MakeUnit(/*static_wl_threshold=*/7);
	EXPECT_TRUE(lenient_unit.check_static_wl_required(plane_address));

	TestableGCAndWLUnit strict_unit = MakeUnit(/*static_wl_threshold=*/8);
	EXPECT_FALSE(strict_unit.check_static_wl_required(plane_address));
}

// Regression test for why "마모평준화 시연" could only ever fire static WL
// once per run: the plane-wide coldest block was a write frontier that is
// never written (here: block 1, the Translation_wf - the whole mapping table
// fits in the CMT, so no translation page is ever programmed), permanently
// at erase count 0 and permanently rejected by is_safe_gc_wl_candidate().
// Upstream picked only that one block, gave up, and never looked at the
// next-coldest block that actually holds cold data.
TEST_F(StaticWearLevelingTest, SkipsUnwrittenFrontierAndTargetsNextColdestDataBlock) {
	PlaneBookKeepingType* plane = fbm.Get_plane_bookkeeping_entry(plane_address);
	plane->Blocks[0].Erase_count = 10;
	plane->Blocks[1].Erase_count = 0; // Translation_wf, never written
	plane->Blocks[2].Erase_count = 10;
	plane->Blocks[3].Erase_count = 6;
	plane->Blocks[4].Erase_count = 4;
	MarkFullyWrittenColdData(3);
	MarkFullyWrittenColdData(4);

	TestableGCAndWLUnit unit = MakeUnit(/*static_wl_threshold=*/5); // 10 - 4 = 6 >= 5

	EXPECT_CALL(amu, Set_barrier_for_accessing_physical_block(
		Field(&Physical_Page_Address::BlockID, 4u))).Times(1);

	ASSERT_TRUE(unit.check_static_wl_required(plane_address));
	unit.run_static_wearleveling(plane_address);

	EXPECT_TRUE(plane->Blocks[4].Has_ongoing_gc_wl);
	EXPECT_FALSE(plane->Blocks[1].Has_ongoing_gc_wl);
}

// An empty free-pool block has no cold data to relocate - it must never be
// the reason static WL fires, however low its erase count.
TEST_F(StaticWearLevelingTest, IgnoresEmptyFreeBlocks) {
	PlaneBookKeepingType* plane = fbm.Get_plane_bookkeeping_entry(plane_address);
	plane->Blocks[0].Erase_count = 10;
	plane->Blocks[1].Erase_count = 10;
	plane->Blocks[2].Erase_count = 10;
	plane->Blocks[3].Erase_count = 0; // free, never written
	plane->Blocks[4].Erase_count = 8;
	MarkFullyWrittenColdData(4);
	// plane-wide gap is 10 - 0 = 10, but among data-holding candidates it's
	// only 10 - 8 = 2

	TestableGCAndWLUnit unit = MakeUnit(/*static_wl_threshold=*/5);

	EXPECT_CALL(amu, Set_barrier_for_accessing_physical_block(_)).Times(0);
	EXPECT_FALSE(unit.check_static_wl_required(plane_address));
	unit.run_static_wearleveling(plane_address);
	EXPECT_FALSE(plane->Blocks[3].Has_ongoing_gc_wl);
}

// Watching real GC in the browser demo has two problems: the whole run can
// finish before you register what happened, and the *real* time gap between
// one write and the next isn't constant (it depends on queue depth, flash
// program latency, whether a previous request just completed, ...), so
// there's no consistent rhythm to watch for. This test sidesteps both by
// driving Check_gc_required() directly, one *write* at a time, with the
// free-block-pool size as the only thing that changes between steps - no
// simulated time enters into it at all, so every step is identical in
// "distance" from the last regardless of what real GC/flash timing would
// have been.
class GcTriggerTest : public ::testing::Test {
protected:
	static constexpr unsigned int kBlockNoPerPlane = 16;
	static constexpr unsigned int kPageNoPerBlock = 4;
	// floor(gc_threshold * kBlockNoPerPlane) = floor(0.5 * 16) = 8, and
	// max_ongoing_gc_reqs_per_plane below is passed as less than that so the
	// constructor's "clamp threshold up to at least max_ongoing_gc_reqs_per_
	// plane" rule (GC_and_WL_Unit_Base.cpp) doesn't override it.
	static constexpr unsigned int kExpectedThreshold = 8;

	FakeFlashBlockManager fbm{/*gc_and_wl_unit=*/nullptr, /*max_allowed_block_erase_count=*/10000,
		/*total_concurrent_streams_no=*/1, /*channel_count=*/1, /*chip_no_per_channel=*/1,
		/*die_no_per_chip=*/1, /*plane_no_per_die=*/1, kBlockNoPerPlane, kPageNoPerBlock};
	// NiceMock, not MockAddressMappingUnit directly - unlike
	// StaticWearLevelingTest, nothing here asserts on the AMU's calls (GC
	// does call Set_barrier_for_accessing_physical_block() as part of
	// locking its candidate, same as WL does), so a plain mock would print
	// an "uninteresting call" warning for it on every fire.
	::testing::NiceMock<MockAddressMappingUnit> amu;
	FakeTSU tsu{"fake-tsu", nullptr, nullptr, Flash_Scheduling_Type::OUT_OF_ORDER,
		1, 1, 1, 1, false, false, 0, 0, 0};
	Physical_Page_Address plane_address;

	TestableGCAndWLUnit MakeUnit() {
		return TestableGCAndWLUnit("gc-unit", &amu, &fbm, &tsu, /*flash_controller=*/nullptr,
			GC_Block_Selection_Policy_Type::RGA, /*gc_threshold=*/0.5, /*preemptible_gc_enabled=*/false,
			/*gc_hard_threshold=*/0.005, /*channel_count=*/1, /*chip_no_per_channel=*/1,
			/*die_no_per_chip=*/1, /*plane_no_per_die=*/1, kBlockNoPerPlane, kPageNoPerBlock,
			/*sector_no_per_page=*/8, /*use_copyback=*/false, /*rho=*/0, /*max_ongoing_gc_reqs_per_plane=*/2,
			/*dynamic_wearleveling_enabled=*/true, /*static_wearleveling_enabled=*/true, /*static_wl_threshold=*/100, /*seed=*/1);
	}

	// Check_gc_required() bails out immediately (see GC_and_WL_Unit_Page_
	// Level.cpp's "no invalid page to erase" guard) unless its candidate
	// block actually has something worth reclaiming - the real demo needed
	// a narrowed working set to make overwrites (and thus invalid pages)
	// happen at all (see buildGcWorkloadXml's doc comment). Marking every
	// non-frontier block as fully written *and* fully invalid sidesteps
	// that entirely and makes the RGA policy's random candidate draw
	// irrelevant - whichever block it lands on already qualifies.
	void MarkAllBlocksFullyInvalid() {
		PlaneBookKeepingType* plane = fbm.Get_plane_bookkeeping_entry(plane_address);
		for (unsigned int i = 0; i < kBlockNoPerPlane; i++) {
			plane->Blocks[i].Current_page_write_index = kPageNoPerBlock;
			plane->Blocks[i].Invalid_page_count = kPageNoPerBlock;
			plane->Blocks[i].Invalid_page_bitmap[0] = (uint64_t)0xF; // all 4 pages invalid (bit=1), see Is_page_valid()
		}
	}
};

TEST_F(GcTriggerTest, FiresExactlyWhenFreePoolCrossesThreshold_SteppedByWriteCount) {
	MarkAllBlocksFullyInvalid();
	TestableGCAndWLUnit unit = MakeUnit();

	unsigned int gc_before = Stats::Total_gc_executions;
	bool fired = false;
	unsigned int fired_at_write_count = 0;

	// One iteration = one write - the free pool shrinks by exactly one per
	// write, nothing else changes between steps.
	for (unsigned int writes_done = 1; writes_done <= kBlockNoPerPlane && !fired; writes_done++) {
		unsigned int free_pool_size = kBlockNoPerPlane - writes_done;
		unit.Check_gc_required(free_pool_size, plane_address);
		if (Stats::Total_gc_executions > gc_before) {
			fired = true;
			fired_at_write_count = writes_done;
		}
	}

	ASSERT_TRUE(fired);
	// Pool size stays >= threshold (8) through write 8 (pool=8); it first
	// drops below threshold at write 9 (pool=7) - that's the first write
	// Check_gc_required's "free_block_pool_size < block_pool_gc_threshold"
	// condition can be true.
	EXPECT_EQ(fired_at_write_count, kBlockNoPerPlane - kExpectedThreshold + 1);
}

TEST_F(GcTriggerTest, NeverFiresWhilePoolStaysAtOrAboveThreshold) {
	MarkAllBlocksFullyInvalid();
	TestableGCAndWLUnit unit = MakeUnit();

	unsigned int gc_before = Stats::Total_gc_executions;
	for (unsigned int free_pool_size = kBlockNoPerPlane; free_pool_size >= kExpectedThreshold; free_pool_size--) {
		unit.Check_gc_required(free_pool_size, plane_address);
	}

	EXPECT_EQ(Stats::Total_gc_executions, gc_before);
}
