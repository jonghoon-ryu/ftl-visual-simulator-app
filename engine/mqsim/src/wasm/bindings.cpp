#include <emscripten/bind.h>
#include <fstream>
#include <string>
#include "../exec/MQSim_Interface.h"
#include "../exec/Simulation_Events.h"
#include "../nvm_chip/flash_memory/Physical_Page_Address.h"
#include "../ssd/Stats.h"

using namespace emscripten;

namespace
{
	// A single active simulation at a time - matches how the WASM module is
	// actually used (one browser tab, one running scenario). configure()
	// tears this down and rebuilds it from new config/workload text.
	MQSim_Interface::Workload_Set* g_workload = nullptr;
	MQSim_Interface::Simulation_Instance* g_instance = nullptr;

	// JS callback registered via set_event_callback(), forwarded simulation
	// events as they happen. Undefined until JS registers one.
	val g_event_callback = val::undefined();

	// Set by forward_mapping_updated() and consumed by step_io() below - lets
	// step_io() detect "a read or write just resolved" as it loops raw
	// event-groups, without needing its own separate hook into the FTL layer.
	bool g_mapping_updated_since_step_io_start = false;

	// Set by every forward_* function whose event describeEvent() (the JS
	// side, useMqsimEvents.ts) actually turns into a log line - i.e.
	// everything except the two dynamic_wl_block_* events, which are
	// deliberately sampled/suppressed there as too frequent to be a
	// meaningful "one step" boundary. Consumed by step_event() below, the
	// same way g_mapping_updated_since_step_io_start is consumed by
	// step_io() - a single flag set from several call sites, read-and-reset
	// by the one loop that cares.
	bool g_loggable_event_since_step_event_start = false;

	void write_memfs_file(const std::string& path, const std::string& text)
	{
		std::ofstream out(path.c_str());
		out << text;
	}

	val address_to_val(const NVM::FlashMemory::Physical_Page_Address& address)
	{
		val obj = val::object();
		obj.set("channel", address.ChannelID);
		obj.set("chip", address.ChipID);
		obj.set("die", address.DieID);
		obj.set("plane", address.PlaneID);
		obj.set("block", address.BlockID);
		return obj;
	}

	std::string page_state_to_string(SSD_Components::Block_Page_State state)
	{
		switch (state) {
			case SSD_Components::Block_Page_State::VALID: return "valid";
			case SSD_Components::Block_Page_State::INVALID: return "invalid";
			case SSD_Components::Block_Page_State::FREE:
			default: return "free";
		}
	}

	// GC_WL/GC_USER/GC_UWAIT/GC_USER_UWAIT all mean "this block currently
	// has a GC or WL operation in flight" from a UI's point of view - the
	// finer-grained distinction is about interleaving with concurrent user
	// I/O (see Block_Service_Status's doc comment in Flash_Block_Manager_
	// Base.h), not something a beginner-facing block grid needs to show.
	std::string block_status_to_string(SSD_Components::Block_Service_Status status)
	{
		switch (status) {
			case SSD_Components::Block_Service_Status::IDLE: return "idle";
			case SSD_Components::Block_Service_Status::USER: return "user";
			default: return "gc_wl";
		}
	}

	void teardown_current()
	{
		if (g_instance) {
			MQSim_Interface::Finalize_scenario(g_instance);
			g_instance = nullptr;
		}
		if (g_workload) {
			MQSim_Interface::Unload_workload(g_workload);
			g_workload = nullptr;
		}
	}

	// Simulation_Events::On_mapping_updated target - the only place in this
	// file that knows about Simulation_Events's event struct shape. Converts
	// it to a plain JS object and forwards to whatever JS registered.
	void forward_mapping_updated(const Simulation_Events::Mapping_Updated_Event& event)
	{
		g_mapping_updated_since_step_io_start = true;
		g_loggable_event_since_step_event_start = true;
		if (g_event_callback.isUndefined() || g_event_callback.isNull()) {
			return;
		}
		val payload = val::object();
		payload.set("type", std::string("mapping_updated"));
		payload.set("streamId", event.Stream_id);
		payload.set("lpa", event.Lpa);
		payload.set("ppa", event.Ppa);
		payload.set("isWrite", event.Is_write);
		val address = address_to_val(event.Address);
		address.set("page", event.Address.PageID);
		payload.set("address", address);
		g_event_callback(payload);
	}

	void forward_gc_started(const Simulation_Events::GC_Started_Event& event)
	{
		g_loggable_event_since_step_event_start = true;
		if (g_event_callback.isUndefined() || g_event_callback.isNull()) {
			return;
		}
		val payload = val::object();
		payload.set("type", std::string("gc_started"));
		payload.set("streamId", event.Stream_id);
		payload.set("block", address_to_val(event.Block_address));
		g_event_callback(payload);
	}

	void forward_gc_page_migrated(const Simulation_Events::GC_Page_Migrated_Event& event)
	{
		g_loggable_event_since_step_event_start = true;
		if (g_event_callback.isUndefined() || g_event_callback.isNull()) {
			return;
		}
		val payload = val::object();
		payload.set("type", std::string("gc_page_migrated"));
		payload.set("streamId", event.Stream_id);
		val block = address_to_val(event.Page_address);
		block.set("page", event.Page_address.PageID);
		payload.set("block", block);
		val newBlock = address_to_val(event.New_page_address);
		newBlock.set("page", event.New_page_address.PageID);
		payload.set("newBlock", newBlock);
		g_event_callback(payload);
	}

	void forward_gc_block_erased(const Simulation_Events::GC_Block_Erased_Event& event)
	{
		g_loggable_event_since_step_event_start = true;
		if (g_event_callback.isUndefined() || g_event_callback.isNull()) {
			return;
		}
		val payload = val::object();
		payload.set("type", std::string("gc_block_erased"));
		payload.set("block", address_to_val(event.Block_address));
		g_event_callback(payload);
	}

	void forward_wl_started(const Simulation_Events::WL_Started_Event& event)
	{
		g_loggable_event_since_step_event_start = true;
		if (g_event_callback.isUndefined() || g_event_callback.isNull()) {
			return;
		}
		val payload = val::object();
		payload.set("type", std::string("wl_started"));
		payload.set("streamId", event.Stream_id);
		payload.set("block", address_to_val(event.Block_address));
		g_event_callback(payload);
	}

	void forward_wl_page_migrated(const Simulation_Events::WL_Page_Migrated_Event& event)
	{
		g_loggable_event_since_step_event_start = true;
		if (g_event_callback.isUndefined() || g_event_callback.isNull()) {
			return;
		}
		val payload = val::object();
		payload.set("type", std::string("wl_page_migrated"));
		payload.set("streamId", event.Stream_id);
		val block = address_to_val(event.Page_address);
		block.set("page", event.Page_address.PageID);
		payload.set("block", block);
		val newBlock = address_to_val(event.New_page_address);
		newBlock.set("page", event.New_page_address.PageID);
		payload.set("newBlock", newBlock);
		g_event_callback(payload);
	}

	void forward_wl_block_erased(const Simulation_Events::WL_Block_Erased_Event& event)
	{
		g_loggable_event_since_step_event_start = true;
		if (g_event_callback.isUndefined() || g_event_callback.isNull()) {
			return;
		}
		val payload = val::object();
		payload.set("type", std::string("wl_block_erased"));
		payload.set("block", address_to_val(event.Block_address));
		g_event_callback(payload);
	}

	// Fires continuously (every write-frontier rotation) - see the comment
	// on Dynamic_WL_Block_Allocated_Event in Simulation_Events.h. Far more
	// frequent than the GC_*/WL_* events above; the UI layer is expected to
	// throttle/sample these itself if needed rather than this layer doing it.
	void forward_dynamic_wl_block_allocated(const Simulation_Events::Dynamic_WL_Block_Allocated_Event& event)
	{
		if (g_event_callback.isUndefined() || g_event_callback.isNull()) {
			return;
		}
		val payload = val::object();
		payload.set("type", std::string("dynamic_wl_block_allocated"));
		payload.set("streamId", event.Stream_id);
		payload.set("block", address_to_val(event.Block_address));
		payload.set("eraseCount", event.Erase_count);
		payload.set("forMappingData", event.For_mapping_data);
		g_event_callback(payload);
	}

	void forward_dynamic_wl_block_freed(const Simulation_Events::Dynamic_WL_Block_Freed_Event& event)
	{
		if (g_event_callback.isUndefined() || g_event_callback.isNull()) {
			return;
		}
		val payload = val::object();
		payload.set("type", std::string("dynamic_wl_block_freed"));
		payload.set("block", address_to_val(event.Block_address));
		payload.set("eraseCount", event.Erase_count);
		payload.set("dynamicWlConsidered", event.Dynamic_wl_considered);
		g_event_callback(payload);
	}
}

// Writes the given config/workload XML text into MEMFS at the paths MQSim's
// existing file-based parsing code expects, then loads and initializes
// scenario 1 - the WASM UI only ever drives one scenario at a time, unlike
// the CLI's "run every scenario in the file" batch mode.
void init(const std::string& ssd_config_xml, const std::string& workload_xml)
{
	// Wired here (not just once at module load) so it survives configure()
	// tearing down and rebuilding g_instance - the function pointer itself
	// is process-wide state, unaffected by teardown_current(), but setting
	// it unconditionally on every init() keeps this the one place that
	// "arms" event delivery, no matter which entry point triggered it.
	Simulation_Events::On_mapping_updated = forward_mapping_updated;
	Simulation_Events::On_gc_started = forward_gc_started;
	Simulation_Events::On_gc_page_migrated = forward_gc_page_migrated;
	Simulation_Events::On_gc_block_erased = forward_gc_block_erased;
	Simulation_Events::On_wl_started = forward_wl_started;
	Simulation_Events::On_wl_page_migrated = forward_wl_page_migrated;
	Simulation_Events::On_wl_block_erased = forward_wl_block_erased;
	Simulation_Events::On_dynamic_wl_block_allocated = forward_dynamic_wl_block_allocated;
	Simulation_Events::On_dynamic_wl_block_freed = forward_dynamic_wl_block_freed;

	teardown_current();

	write_memfs_file("/ssdconfig.xml", ssd_config_xml);
	write_memfs_file("/workload.xml", workload_xml);

	g_workload = MQSim_Interface::Load_workload("/ssdconfig.xml", "/workload.xml");
	g_instance = MQSim_Interface::Initialize_scenario(g_workload, 1);
}

// Registers the JS function that receives simulation events - mapping
// updates, GC activity (gc_started/gc_page_migrated/gc_block_erased),
// static wear-leveling activity (wl_started/wl_page_migrated/
// wl_block_erased), and dynamic wear-leveling activity
// (dynamic_wl_block_allocated/dynamic_wl_block_freed - fire far more often
// than the others, see Simulation_Events.h) - as they happen during
// step()/run(). Pass undefined/null to stop receiving events.
void set_event_callback(val callback)
{
	g_event_callback = callback;
}

// Point-in-time simulator state for the UI to render, e.g. after step()/
// run() or on a timer. Currently just the mapping table; block/page grid
// state will be added here once the GC/block-manager hooks land.
val get_state()
{
	val mapping = val::array();
	if (g_instance) {
		auto snapshot = MQSim_Interface::Get_mapping_table_snapshot(g_instance, 0);
		for (const auto& entry : snapshot) {
			val row = val::object();
			row.set("lpa", entry.Lpa);
			row.set("ppa", entry.Mapped ? val(entry.Ppa) : val::null());
			row.set("mapped", entry.Mapped);
			if (entry.Mapped) {
				val address = address_to_val(entry.Address);
				address.set("page", entry.Address.PageID);
				row.set("address", address);
			} else {
				row.set("address", val::null());
			}
			mapping.call<void>("push", row);
		}
	}

	val blocks = val::array();
	if (g_instance) {
		auto snapshot = MQSim_Interface::Get_block_state_snapshot(g_instance);
		for (const auto& entry : snapshot) {
			val row = address_to_val(entry.Address);
			row.set("eraseCount", entry.EraseCount);
			row.set("status", block_status_to_string(entry.Status));
			row.set("hasOngoingGcWl", entry.Has_ongoing_gc_wl);
			row.set("isWriteFrontier", entry.Is_write_frontier);
			val pages = val::array();
			for (const auto& page_state : entry.Pages) {
				pages.call<void>("push", std::string(page_state_to_string(page_state)));
			}
			row.set("pages", pages);
			blocks.call<void>("push", row);
		}
	}

	val stats = val::object();
	stats.set("issuedProgramCmd", SSD_Components::Stats::IssuedProgramCMD);
	stats.set("gcExecutions", SSD_Components::Stats::Total_gc_executions);
	stats.set("wlExecutions", SSD_Components::Stats::Total_wl_executions);

	val state = val::object();
	state.set("mapping", mapping);
	state.set("blocks", blocks);
	state.set("stats", stats);
	return state;
}

// Runs exactly one event-group; returns whether events remain.
bool step()
{
	return MQSim_Interface::Run_step(g_instance);
}

// Runs up to n event-groups, stopping early if the queue empties; returns
// whether events remain afterwards.
bool run(int n)
{
	bool has_more = true;
	for (int i = 0; i < n && has_more; i++) {
		has_more = MQSim_Interface::Run_step(g_instance);
	}
	return has_more;
}

// Runs event-groups until exactly one flash-level read or write has
// resolved (a Mapping_Updated_Event - fired once per NVM_Transaction_Flash,
// see Address_Mapping_Unit_Page_Level.cpp), or the queue empties - whichever
// comes first. This project's goal is showing *how* read/write/GC work, not
// measuring performance, so raw step() (one internal event-group - could be
// a bus-timing tick far below anything visible in the UI) is too fine-
// grained for a "step" a person presses a key/button for. GC/WL activity
// that happens to fall between two such reads/writes still gets forwarded
// to JS as it occurs (same event callback as run()/step()) even though the
// loop's stopping condition is keyed on read/write only.
bool step_io()
{
	g_mapping_updated_since_step_io_start = false;
	bool has_more = true;
	while (has_more && !g_mapping_updated_since_step_io_start) {
		has_more = MQSim_Interface::Run_step(g_instance);
	}
	return has_more;
}

// Runs event-groups until exactly one loggable event has fired (anything
// describeEvent() in useMqsimEvents.ts turns into a log line: a read/write
// resolving, or one GC/WL sub-step - started, one page migrated, or the
// erase completing), or the queue empties - whichever comes first. Unlike
// step_io() (which only stops on a read/write and silently swallows any
// GC/WL activity that happens to fall between two of those into the same
// call), this is what backs the UI's per-log-line step button: press it
// once, get exactly one new log line, whatever kind it is. Deliberately
// does *not* stop on dynamic_wl_block_allocated/freed - those are excluded
// from "loggable" up in g_loggable_event_since_step_event_start's own
// comment, for the same reason the JS-side log already samples them.
bool step_event()
{
	g_loggable_event_since_step_event_start = false;
	bool has_more = true;
	while (has_more && !g_loggable_event_since_step_event_start) {
		has_more = MQSim_Interface::Run_step(g_instance);
	}
	return has_more;
}

// Re-initializes with new config/workload text, discarding the current run -
// same steps as init(), kept as a separate binding name to match the
// documented parameter-change/reset use case.
void configure(const std::string& ssd_config_xml, const std::string& workload_xml)
{
	init(ssd_config_xml, workload_xml);
}

EMSCRIPTEN_BINDINGS(mqsim_module)
{
	function("init", &init);
	function("step", &step);
	function("run", &run);
	function("stepIo", &step_io);
	function("stepEvent", &step_event);
	function("configure", &configure);
	function("setEventCallback", &set_event_callback);
	function("getState", &get_state);
}
