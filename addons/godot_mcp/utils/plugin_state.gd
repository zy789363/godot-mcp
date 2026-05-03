@tool
extends RefCounted

const MCP_AUTOLOADS: Array[Array] = [
	["autoload/MCPScreenshot", "res://addons/godot_mcp/mcp_screenshot_service.gd"],
	["autoload/MCPInputService", "res://addons/godot_mcp/mcp_input_service.gd"],
	["autoload/MCPGameInspector", "res://addons/godot_mcp/mcp_game_inspector_service.gd"],
]

const MCP_TEMP_FILES: Array[String] = [
	"mcp_debugger_continue",
	"mcp_game_request",
	"mcp_game_response",
	"mcp_input_commands",
	"mcp_screenshot_request",
	"mcp_screenshot.png",
]

const MCP_STATE_CONFIG_PATH := "user://mcp_plugin_state.cfg"
const MCP_BASE_PORT := 6505
const MCP_MAX_PORT := 6514

var websocket_server: Node
var session_injected_autoloads: Array[String] = []


func inject_autoloads() -> void:
	session_injected_autoloads.clear()
	var changed := false
	var records := load_recorded_injected_autoloads()
	for entry: Array in MCP_AUTOLOADS:
		var key: String = entry[0]
		var script: String = entry[1]
		if not ProjectSettings.has_setting(key):
			ProjectSettings.set_setting(key, "*" + script)
			session_injected_autoloads.append(key)
			records[key] = script
			changed = true
	if changed:
		var err := ProjectSettings.save()
		if err != OK:
			push_warning("[MCP] Failed to save injected autoloads: %s" % error_string(err))
		save_recorded_injected_autoloads(records)


func remove_autoloads() -> void:
	var changed := false
	var records := load_recorded_injected_autoloads()
	for key: String in session_injected_autoloads:
		if ProjectSettings.has_setting(key):
			var expected_path := expected_autoload_path(key)
			if normalize_autoload_value(ProjectSettings.get_setting(key)) == expected_path:
				ProjectSettings.clear(key)
				records.erase(key)
				changed = true
			else:
				records.erase(key)
	session_injected_autoloads.clear()
	if changed:
		var err := ProjectSettings.save()
		if err != OK:
			push_warning("[MCP] Failed to remove injected autoloads: %s" % error_string(err))
	save_recorded_injected_autoloads(records)


func get_status() -> Dictionary:
	var records := load_recorded_injected_autoloads()
	var autoloads: Array = []
	for entry: Array in MCP_AUTOLOADS:
		var key: String = entry[0]
		var expected_path: String = entry[1]
		var has_autoload := ProjectSettings.has_setting(key)
		var current_value := ""
		if has_autoload:
			current_value = str(ProjectSettings.get_setting(key))
		autoloads.append({
			"name": autoload_name_from_key(key),
			"setting": key,
			"expected_path": expected_path,
			"configured": has_autoload,
			"current_value": current_value,
			"matches_mcp_runtime": has_autoload and normalize_autoload_value(current_value) == expected_path,
			"injected_this_session": key in session_injected_autoloads,
			"recorded_injected": records.has(key),
		})

	var temp_files: Array = []
	for user_dir: String in get_runtime_user_dirs():
		for filename: String in MCP_TEMP_FILES:
			var path := user_dir.path_join(filename)
			if FileAccess.file_exists(path):
				temp_files.append({
					"name": filename,
					"path": path,
					"directory": user_dir,
				})

	var connected_ports: Array = []
	if websocket_server and websocket_server.has_method("get_connected_ports"):
		connected_ports = websocket_server.get_connected_ports()

	return {
		"project_name": ProjectSettings.get_setting("application/config/name", ""),
		"project_path": ProjectSettings.globalize_path("res://"),
		"user_data_dirs": get_runtime_user_dirs(),
		"state_config_path": ProjectSettings.globalize_path(MCP_STATE_CONFIG_PATH),
		"autoloads": autoloads,
		"injected_autoloads_this_session": session_injected_autoloads.duplicate(),
		"recorded_injected_autoloads": records.keys(),
		"temp_files": temp_files,
		"websocket": {
			"running": websocket_server != null,
			"port_min": MCP_BASE_PORT,
			"port_max": MCP_MAX_PORT,
			"connected_ports": connected_ports,
			"client_count": websocket_server.get_client_count() if websocket_server and websocket_server.has_method("get_client_count") else 0,
		},
	}


func cleanup_project_state() -> Dictionary:
	var records := load_recorded_injected_autoloads()
	var removed_autoloads: Array = []
	var skipped_autoloads: Array = []
	var autoloads_changed := false

	for entry: Array in MCP_AUTOLOADS:
		var key: String = entry[0]
		var expected_path: String = entry[1]
		var name := autoload_name_from_key(key)
		var recorded := records.has(key) or key in session_injected_autoloads

		if not ProjectSettings.has_setting(key):
			skipped_autoloads.append({
				"name": name,
				"setting": key,
				"reason": "missing",
				"recorded_injected": recorded,
			})
			records.erase(key)
			continue

		var current_value := str(ProjectSettings.get_setting(key))
		if normalize_autoload_value(current_value) != expected_path:
			skipped_autoloads.append({
				"name": name,
				"setting": key,
				"reason": "value_mismatch",
				"current_value": current_value,
				"expected_path": expected_path,
				"recorded_injected": recorded,
			})
			if recorded:
				records.erase(key)
			continue

		ProjectSettings.clear(key)
		records.erase(key)
		session_injected_autoloads.erase(key)
		autoloads_changed = true
		removed_autoloads.append({
			"name": name,
			"setting": key,
			"old_value": current_value,
			"reason": "recorded_injected" if recorded else "matches_mcp_runtime_script",
		})

	var save_error := OK
	if autoloads_changed:
		save_error = ProjectSettings.save()
		if save_error != OK:
			push_warning("[MCP] Failed to save project settings during cleanup: %s" % error_string(save_error))

	save_recorded_injected_autoloads(records)
	var temp_result := cleanup_temp_files()

	return {
		"project_path": ProjectSettings.globalize_path("res://"),
		"autoloads_removed": removed_autoloads,
		"autoloads_skipped": skipped_autoloads,
		"temp_files_removed": temp_result.get("removed", []),
		"temp_files_skipped": temp_result.get("skipped", []),
		"checked_user_data_dirs": temp_result.get("directories", []),
		"project_settings_saved": save_error == OK,
		"project_settings_save_error": "" if save_error == OK else error_string(save_error),
	}


func cleanup_temp_files() -> Dictionary:
	var removed: Array = []
	var skipped: Array = []
	var dirs := get_runtime_user_dirs()

	for user_dir: String in dirs:
		for filename: String in MCP_TEMP_FILES:
			var path := user_dir.path_join(filename)
			if not FileAccess.file_exists(path):
				continue
			var err := DirAccess.remove_absolute(path)
			if err == OK:
				removed.append({
					"name": filename,
					"path": path,
					"directory": user_dir,
				})
			else:
				skipped.append({
					"name": filename,
					"path": path,
					"directory": user_dir,
					"error": error_string(err),
				})

	return {
		"removed": removed,
		"skipped": skipped,
		"directories": dirs,
	}


func load_recorded_injected_autoloads() -> Dictionary:
	var records := {}
	var cfg := ConfigFile.new()
	if cfg.load(MCP_STATE_CONFIG_PATH) != OK:
		return records
	if not cfg.has_section("injected_autoloads"):
		return records
	for key: String in cfg.get_section_keys("injected_autoloads"):
		records[key] = str(cfg.get_value("injected_autoloads", key, ""))
	return records


func save_recorded_injected_autoloads(records: Dictionary) -> void:
	var cfg := ConfigFile.new()
	for key: String in records:
		cfg.set_value("injected_autoloads", key, records[key])
	cfg.set_value("metadata", "updated_at", Time.get_datetime_string_from_system())
	var err := cfg.save(MCP_STATE_CONFIG_PATH)
	if err != OK:
		push_warning("[MCP] Failed to save MCP plugin state: %s" % error_string(err))


func autoload_name_from_key(key: String) -> String:
	if key.begins_with("autoload/"):
		return key.substr("autoload/".length())
	return key


func expected_autoload_path(key: String) -> String:
	for entry: Array in MCP_AUTOLOADS:
		if entry[0] == key:
			return entry[1]
	return ""


func normalize_autoload_value(value: Variant) -> String:
	var text := str(value)
	if text.begins_with("*"):
		return text.substr(1)
	return text


func get_runtime_user_dirs() -> Array[String]:
	var dirs: Array[String] = []
	append_unique_path(dirs, OS.get_user_data_dir())
	append_unique_path(dirs, get_game_user_dir())
	return dirs


func append_unique_path(paths: Array[String], path: String) -> void:
	if path.is_empty():
		return
	if not (path in paths):
		paths.append(path)


func get_game_user_dir() -> String:
	var cached_dir := OS.get_user_data_dir()
	var cfg := ConfigFile.new()
	var err := cfg.load(ProjectSettings.globalize_path("res://project.godot"))
	if err != OK:
		return cached_dir
	if cfg.get_value("application", "config/use_custom_user_dir", false):
		return cached_dir
	var disk_name = cfg.get_value("application", "config/name", "")
	if typeof(disk_name) != TYPE_STRING or (disk_name as String).is_empty():
		return cached_dir
	var sanitized := (disk_name as String).xml_unescape().validate_filename().replace(".", "_")
	if sanitized.is_empty():
		return cached_dir
	var base_dir := cached_dir.get_base_dir()
	return base_dir.path_join(sanitized)
