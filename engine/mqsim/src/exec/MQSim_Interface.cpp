#include "MQSim_Interface.h"
#include <iostream>
#include <fstream>
#include <cstring>
#include "../ssd/SSD_Defs.h"
#include "../ssd/FTL.h"
#include "../sim/Engine.h"
#include "../utils/rapidxml/rapidxml.hpp"
#include "../utils/DistributionTypes.h"

using namespace std;

namespace MQSim_Interface
{
	Workload_Set* Load_workload(const std::string& ssd_config_file_path,
	                             const std::string& workload_defs_file_path)
	{
		Execution_Parameter_Set* exec_params = new Execution_Parameter_Set;

		// --- read_configuration_parameters (unchanged from main.cpp) ---
		{
			ifstream ssd_config_file;
			ssd_config_file.open(ssd_config_file_path.c_str());

			if (!ssd_config_file) {
				PRINT_MESSAGE("The specified SSD configuration file does not exist.")
				PRINT_MESSAGE("Using MQSim's default configuration.")
				PRINT_MESSAGE("Writing the default configuration parameters to the expected configuration file.")

				Utils::XmlWriter xmlwriter;
				xmlwriter.Open(ssd_config_file_path.c_str());
				exec_params->XML_serialize(xmlwriter);
				xmlwriter.Close();
				PRINT_MESSAGE("[====================] Done!\n")
			} else {
				string line((std::istreambuf_iterator<char>(ssd_config_file)),
					std::istreambuf_iterator<char>());
				ssd_config_file >> line;
				if (line.compare("USE_INTERNAL_PARAMS") != 0) {
					rapidxml::xml_document<> doc;
					char* temp_string = new char[line.length() + 1];
					strcpy(temp_string, line.c_str());
					doc.parse<0>(temp_string);
					rapidxml::xml_node<> *mqsim_config = doc.first_node("Execution_Parameter_Set");
					if (mqsim_config != NULL) {
						exec_params = new Execution_Parameter_Set;
						exec_params->XML_deserialize(mqsim_config);
					} else {
						PRINT_MESSAGE("Error in the SSD configuration file!")
						PRINT_MESSAGE("Using MQSim's default configuration.")
					}
				} else {
					PRINT_MESSAGE("Using MQSim's default configuration.");
					PRINT_MESSAGE("Writing the default configuration parameters to the expected configuration file.");

					Utils::XmlWriter xmlwriter;
					xmlwriter.Open(ssd_config_file_path.c_str());
					exec_params->XML_serialize(xmlwriter);
					xmlwriter.Close();
					PRINT_MESSAGE("[====================] Done!\n")
				}
			}

			ssd_config_file.close();
		}

		// --- read_workload_definitions (unchanged from main.cpp) ---
		std::vector<std::vector<IO_Flow_Parameter_Set*>*>* io_scenarios = new std::vector<std::vector<IO_Flow_Parameter_Set*>*>;
		{
			ifstream workload_defs_file;
			workload_defs_file.open(workload_defs_file_path.c_str());
			bool use_default_workloads = true;
			if (!workload_defs_file) {
				PRINT_MESSAGE("The specified workload definition file does not exist!");
				PRINT_MESSAGE("Using MQSim's default workload definitions.");
				PRINT_MESSAGE("Writing the default workload definitions to the expected workload definition file.");
				PRINT_MESSAGE("[====================] Done!\n");
			} else {
				string line((std::istreambuf_iterator<char>(workload_defs_file)), std::istreambuf_iterator<char>());
				if (line.compare("USE_INTERNAL_PARAMS") != 0) {
					rapidxml::xml_document<> doc;
					char* temp_string = new char[line.length() + 1];
					strcpy(temp_string, line.c_str());
					doc.parse<0>(temp_string);
					rapidxml::xml_node<> *mqsim_io_scenarios = doc.first_node("MQSim_IO_Scenarios");
					if (mqsim_io_scenarios != NULL) {
						for (auto xml_io_scenario = mqsim_io_scenarios->first_node("IO_Scenario"); xml_io_scenario; xml_io_scenario = xml_io_scenario->next_sibling("IO_Scenario")) {
							std::vector<IO_Flow_Parameter_Set*>* scenario_definition = new std::vector<IO_Flow_Parameter_Set*>;
							for (auto flow_def = xml_io_scenario->first_node(); flow_def; flow_def = flow_def->next_sibling()) {
								IO_Flow_Parameter_Set* flow;
								if (strcmp(flow_def->name(), "IO_Flow_Parameter_Set_Synthetic") == 0) {
									flow = new IO_Flow_Parameter_Set_Synthetic;
									((IO_Flow_Parameter_Set_Synthetic*)flow)->XML_deserialize(flow_def);
								} else if (strcmp(flow_def->name(), "IO_Flow_Parameter_Set_Trace_Based") == 0) {
									flow = new IO_Flow_Parameter_Set_Trace_Based;
									((IO_Flow_Parameter_Set_Trace_Based*)flow)->XML_deserialize(flow_def);
								}
								scenario_definition->push_back(flow);
							}
							io_scenarios->push_back(scenario_definition);
							use_default_workloads = false;
						}
					} else {
						PRINT_MESSAGE("Error in the workload definition file!");
						PRINT_MESSAGE("Using MQSim's default workload definitions.");
						PRINT_MESSAGE("Writing the default workload definitions to the expected workload definition file.");
						PRINT_MESSAGE("[====================] Done!\n");
					}
				}
			}

			if (use_default_workloads) {
				std::vector<IO_Flow_Parameter_Set*>* scenario_definition = new std::vector<IO_Flow_Parameter_Set*>;
				IO_Flow_Parameter_Set_Synthetic* io_flow_1 = new IO_Flow_Parameter_Set_Synthetic;
				io_flow_1->Device_Level_Data_Caching_Mode = SSD_Components::Caching_Mode::WRITE_CACHE;
				io_flow_1->Type = Flow_Type::SYNTHETIC;
				io_flow_1->Priority_Class = IO_Flow_Priority_Class::HIGH;
				io_flow_1->Channel_No = 8;
				io_flow_1->Channel_IDs = new flash_channel_ID_type[8];
				io_flow_1->Channel_IDs[0] = 0; io_flow_1->Channel_IDs[1] = 1; io_flow_1->Channel_IDs[2] = 2; io_flow_1->Channel_IDs[3] = 3;
				io_flow_1->Channel_IDs[4] = 4; io_flow_1->Channel_IDs[5] = 5; io_flow_1->Channel_IDs[6] = 6; io_flow_1->Channel_IDs[7] = 7;
				io_flow_1->Chip_No = 4;
				io_flow_1->Chip_IDs = new flash_chip_ID_type[4];
				io_flow_1->Chip_IDs[0] = 0; io_flow_1->Chip_IDs[1] = 1; io_flow_1->Chip_IDs[2] = 2; io_flow_1->Chip_IDs[3] = 3;
				io_flow_1->Die_No = 2;
				io_flow_1->Die_IDs = new flash_die_ID_type[2];
				io_flow_1->Die_IDs[0] = 0; io_flow_1->Die_IDs[1] = 1;
				io_flow_1->Plane_No = 2;
				io_flow_1->Plane_IDs = new flash_plane_ID_type[2];
				io_flow_1->Plane_IDs[0] = 0; io_flow_1->Plane_IDs[1] = 1;
				io_flow_1->Initial_Occupancy_Percentage = 50;
				io_flow_1->Working_Set_Percentage = 85;
				io_flow_1->Synthetic_Generator_Type = Utils::Request_Generator_Type::QUEUE_DEPTH;
				io_flow_1->Read_Percentage = 100;
				io_flow_1->Address_Distribution = Utils::Address_Distribution_Type::RANDOM_UNIFORM;
				io_flow_1->Percentage_of_Hot_Region = 0;
				io_flow_1->Generated_Aligned_Addresses = true;
				io_flow_1->Address_Alignment_Unit = 16;
				io_flow_1->Request_Size_Distribution = Utils::Request_Size_Distribution_Type::FIXED;
				io_flow_1->Average_Request_Size = 8;
				io_flow_1->Variance_Request_Size = 0;
				io_flow_1->Seed = 12344;
				io_flow_1->Average_No_of_Reqs_in_Queue = 2;
				io_flow_1->Bandwidth = 262144;
				io_flow_1->Stop_Time = 1000000000;
				io_flow_1->Total_Requests_To_Generate = 0;
				scenario_definition->push_back(io_flow_1);

				IO_Flow_Parameter_Set_Synthetic* io_flow_2 = new IO_Flow_Parameter_Set_Synthetic;
				io_flow_2->Device_Level_Data_Caching_Mode = SSD_Components::Caching_Mode::WRITE_CACHE;
				io_flow_2->Type = Flow_Type::SYNTHETIC;
				io_flow_2->Priority_Class = IO_Flow_Priority_Class::HIGH;
				io_flow_2->Channel_No = 8;
				io_flow_2->Channel_IDs = new flash_channel_ID_type[8];
				io_flow_2->Channel_IDs[0] = 0; io_flow_2->Channel_IDs[1] = 1; io_flow_2->Channel_IDs[2] = 2; io_flow_2->Channel_IDs[3] = 3;
				io_flow_2->Channel_IDs[4] = 4; io_flow_2->Channel_IDs[5] = 5; io_flow_2->Channel_IDs[6] = 6; io_flow_2->Channel_IDs[7] = 7;
				io_flow_2->Chip_No = 4;
				io_flow_2->Chip_IDs = new flash_chip_ID_type[4];
				io_flow_2->Chip_IDs[0] = 0; io_flow_2->Chip_IDs[1] = 1; io_flow_2->Chip_IDs[2] = 2; io_flow_2->Chip_IDs[3] = 3;
				io_flow_2->Die_No = 2;
				io_flow_2->Die_IDs = new flash_die_ID_type[2];
				io_flow_2->Die_IDs[0] = 0; io_flow_2->Die_IDs[1] = 1;
				io_flow_2->Plane_No = 2;
				io_flow_2->Plane_IDs = new flash_plane_ID_type[2];
				io_flow_2->Plane_IDs[0] = 0; io_flow_2->Plane_IDs[1] = 1;
				io_flow_2->Initial_Occupancy_Percentage = 50;
				io_flow_2->Working_Set_Percentage = 85;
				io_flow_2->Synthetic_Generator_Type = Utils::Request_Generator_Type::QUEUE_DEPTH;
				io_flow_2->Read_Percentage = 100;
				io_flow_2->Address_Distribution = Utils::Address_Distribution_Type::RANDOM_UNIFORM;
				io_flow_2->Percentage_of_Hot_Region = 0;
				io_flow_2->Generated_Aligned_Addresses = true;
				io_flow_2->Address_Alignment_Unit = 16;
				io_flow_2->Request_Size_Distribution = Utils::Request_Size_Distribution_Type::FIXED;
				io_flow_2->Average_Request_Size = 8;
				io_flow_2->Variance_Request_Size = 0;
				io_flow_2->Seed = 6533;
				io_flow_2->Average_No_of_Reqs_in_Queue = 2;
				io_flow_2->Bandwidth = 131072;
				io_flow_2->Stop_Time = 1000000000;
				io_flow_2->Total_Requests_To_Generate = 0;
				scenario_definition->push_back(io_flow_2);

				io_scenarios->push_back(scenario_definition);

				PRINT_MESSAGE("Writing default workload parameters to the expected input file.")

				Utils::XmlWriter xmlwriter;
				string tmp;
				xmlwriter.Open(workload_defs_file_path.c_str());
				tmp = "MQSim_IO_Scenarios";
				xmlwriter.Write_open_tag(tmp);
				tmp = "IO_Scenario";
				xmlwriter.Write_open_tag(tmp);

				io_flow_1->XML_serialize(xmlwriter);
				io_flow_2->XML_serialize(xmlwriter);

				xmlwriter.Write_close_tag();
				xmlwriter.Write_close_tag();
				xmlwriter.Close();
			}
			workload_defs_file.close();
		}

		// exec_params->Host_Configuration.Input_file_path informs Host_System
		// where to resolve relative trace file paths (e.g. "traces/foo.trace")
		// - same as main.cpp always computed it.
		exec_params->Host_Configuration.Input_file_path =
			workload_defs_file_path.substr(0, workload_defs_file_path.find_last_of("."));

		Workload_Set* workload = new Workload_Set;
		workload->Exec_params = exec_params;
		workload->Io_scenarios = io_scenarios;
		return workload;
	}

	Simulation_Instance* Initialize_scenario(Workload_Set* workload, int scenario_number)
	{
		Execution_Parameter_Set* exec_params = workload->Exec_params;
		std::vector<IO_Flow_Parameter_Set*>* scenario_flows = workload->Io_scenarios->at(scenario_number - 1);

		// The simulator should always be reset before starting a new scenario.
		Simulator->Reset();

		exec_params->Host_Configuration.IO_Flow_Definitions.clear();
		for (auto flow_def = scenario_flows->begin(); flow_def != scenario_flows->end(); flow_def++) {
			exec_params->Host_Configuration.IO_Flow_Definitions.push_back(*flow_def);
		}

		SSD_Device* ssd = new SSD_Device(&exec_params->SSD_Device_Configuration, &exec_params->Host_Configuration.IO_Flow_Definitions);
		Host_System* host = new Host_System(&exec_params->Host_Configuration, exec_params->SSD_Device_Configuration.Enabled_Preconditioning, ssd->Host_interface);
		host->Attach_ssd_device(ssd);

		Simulator->Setup_simulation();

		Simulation_Instance* instance = new Simulation_Instance;
		instance->Ssd = ssd;
		instance->Host = host;
		instance->Scenario_number = scenario_number;
		instance->Scenario_count = (int)workload->Io_scenarios->size();
		return instance;
	}

	bool Run_step(Simulation_Instance* /*instance*/)
	{
		return Simulator->Run_next_event_group();
	}

	void Run_to_completion(Simulation_Instance* instance)
	{
		while (Run_step(instance)) {
		}
	}

	void Write_results(Simulation_Instance* instance, const std::string& output_file_path)
	{
		Utils::XmlWriter xmlwriter;
		xmlwriter.Open(output_file_path.c_str());

		std::string tmp("MQSim_Results");
		xmlwriter.Write_open_tag(tmp);

		instance->Host->Report_results_in_XML("", xmlwriter);
		instance->Ssd->Report_results_in_XML("", xmlwriter);

		xmlwriter.Write_close_tag();

		std::vector<Host_Components::IO_Flow_Base*> io_flows = instance->Host->Get_io_flows();
		for (unsigned int stream_id = 0; stream_id < io_flows.size(); stream_id++) {
			cout << "Flow " << io_flows[stream_id]->ID() << " - total requests generated: " << io_flows[stream_id]->Get_generated_request_count()
				<< " total requests serviced:" << io_flows[stream_id]->Get_serviced_request_count() << endl;
			cout << "                   - device response time: " << io_flows[stream_id]->Get_device_response_time() << " (us)"
				<< " end-to-end request delay:" << io_flows[stream_id]->Get_end_to_end_request_delay() << " (us)" << endl;
		}
	}

	std::vector<SSD_Components::Mapping_Snapshot_Entry> Get_mapping_table_snapshot(Simulation_Instance* instance, stream_id_type stream_id)
	{
		// Firmware is always an FTL* and Address_Mapping_Unit is always an
		// Address_Mapping_Unit_Page_Level* in this codebase - Hybrid mapping
		// (the only other Address_Mapping_Unit_Base subclass) is an empty
		// stub that nothing constructs (see the MQSim overview doc's
		// accuracy notes).
		SSD_Components::FTL* ftl = static_cast<SSD_Components::FTL*>(instance->Ssd->Firmware);
		SSD_Components::Address_Mapping_Unit_Page_Level* amu =
			static_cast<SSD_Components::Address_Mapping_Unit_Page_Level*>(ftl->Address_Mapping_Unit);
		return amu->Get_mapping_table_snapshot(stream_id);
	}

	std::vector<SSD_Components::Block_Snapshot_Entry> Get_block_state_snapshot(Simulation_Instance* instance)
	{
		SSD_Components::FTL* ftl = static_cast<SSD_Components::FTL*>(instance->Ssd->Firmware);
		return ftl->BlockManager->Get_block_state_snapshot();
	}

	unsigned int Get_writes_waiting_for_free_space(Simulation_Instance* instance)
	{
		SSD_Components::FTL* ftl = static_cast<SSD_Components::FTL*>(instance->Ssd->Firmware);
		return static_cast<SSD_Components::Address_Mapping_Unit_Page_Level*>(ftl->Address_Mapping_Unit)->Count_writes_waiting_for_free_space();
	}

	unsigned long Get_host_requests_serviced(Simulation_Instance* instance)
	{
		unsigned long total = 0;
		for (auto flow : instance->Host->Get_io_flows()) {
			total += flow->Get_serviced_request_count();
		}
		return total;
	}

	std::vector<unsigned int> Get_free_block_counts(Simulation_Instance* instance)
	{
		SSD_Components::FTL* ftl = static_cast<SSD_Components::FTL*>(instance->Ssd->Firmware);
		return static_cast<SSD_Components::Address_Mapping_Unit_Page_Level*>(ftl->Address_Mapping_Unit)->Get_free_block_counts();
	}

	unsigned int Get_gc_threshold_blocks(Simulation_Instance* instance)
	{
		SSD_Components::FTL* ftl = static_cast<SSD_Components::FTL*>(instance->Ssd->Firmware);
		return ftl->GC_and_WL_Unit->Get_gc_threshold_blocks();
	}

	void Finalize_scenario(Simulation_Instance* instance)
	{
		delete instance->Host;
		delete instance->Ssd;
		delete instance;
	}

	void Unload_workload(Workload_Set* workload)
	{
		delete workload->Io_scenarios;
		delete workload->Exec_params;
		delete workload;
	}
}
