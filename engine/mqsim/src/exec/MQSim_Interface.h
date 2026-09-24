#ifndef MQSIM_INTERFACE_H
#define MQSIM_INTERFACE_H

#include <string>
#include <vector>
#include "Execution_Parameter_Set.h"
#include "IO_Flow_Parameter_Set.h"
#include "SSD_Device.h"
#include "Host_System.h"
#include "../ssd/Address_Mapping_Unit_Page_Level.h"

// Callable-library form of what main.cpp used to do inline: parse the two
// config files once, then set up/run/report on one IO_Scenario at a time.
// main.cpp is now a thin CLI wrapper around these same functions - nothing
// about parsing or simulation behavior changed, only where the code lives.
namespace MQSim_Interface
{
	// Everything parsed from ssdconfig.xml/workload.xml: config (note
	// Execution_Parameter_Set's members are static, so there is only ever one
	// live configuration process-wide) plus the list of IO_Scenario blocks
	// found in the workload file.
	struct Workload_Set
	{
		Execution_Parameter_Set* Exec_params;
		std::vector<std::vector<IO_Flow_Parameter_Set*>*>* Io_scenarios;
	};

	// One initialized, ready-to-run scenario: the SSD_Device/Host_System pair
	// for a single IO_Scenario out of the workload file, with the simulator
	// singleton already Reset() and set up.
	struct Simulation_Instance
	{
		SSD_Device* Ssd;
		Host_System* Host;
		int Scenario_number; // 1-based, matches the CLI's "scenario N out of M" numbering
		int Scenario_count;
	};

	// Reads ssdconfig.xml and workload.xml exactly as MQSim always has (same
	// rapidxml parsing, same fallback to MQSim's built-in defaults if a file
	// is missing/invalid) and returns the parsed definitions, not yet
	// attached to any running scenario.
	Workload_Set* Load_workload(const std::string& ssd_config_file_path,
	                             const std::string& workload_defs_file_path);

	// Prepares scenario `scenario_number` (1-based) for execution: resets the
	// simulator singleton, builds the SSD_Device/Host_System for that
	// scenario's IO flows, and runs the engine's one-time setup. Mirrors the
	// per-iteration setup block that used to be inline in main()'s scenario
	// loop.
	Simulation_Instance* Initialize_scenario(Workload_Set* workload, int scenario_number);

	// Executes exactly one event-group and returns whether events remain -
	// forwards to Engine::Run_next_event_group().
	bool Run_step(Simulation_Instance* instance);

	// Repeatedly calls Run_step() until no events remain - identical to what
	// Simulator->Start_simulation() used to do in one call.
	void Run_to_completion(Simulation_Instance* instance);

	// Writes the same "MQSim_Results" XML + per-flow console report that
	// main.cpp's old collect_results() produced.
	void Write_results(Simulation_Instance* instance, const std::string& output_file_path);

	// Point-in-time mapping-table snapshot for one stream of the running
	// scenario - the data source behind the WASM getState() export. Only
	// valid while `instance` is initialized (between Initialize_scenario()
	// and Finalize_scenario()).
	std::vector<SSD_Components::Mapping_Snapshot_Entry> Get_mapping_table_snapshot(Simulation_Instance* instance, stream_id_type stream_id = 0);

	// Point-in-time state of every block in the device - the data source
	// behind the WASM getState() export's "blocks" field. See Flash_Block_
	// Manager_Base::Get_block_state_snapshot().
	std::vector<SSD_Components::Block_Snapshot_Entry> Get_block_state_snapshot(Simulation_Instance* instance);

	// How many host writes are parked because their plane ran out of free
	// pages - nonzero after the run ends means the device filled up.
	unsigned int Get_writes_waiting_for_free_space(Simulation_Instance* instance);

	// Releases the SSD_Device/Host_System for this one scenario.
	void Finalize_scenario(Simulation_Instance* instance);

	// Releases the parsed workload definitions once no scenario needs them.
	void Unload_workload(Workload_Set* workload);
}

#endif // !MQSIM_INTERFACE_H
