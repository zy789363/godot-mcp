@tool
extends EditorPlugin

const PluginState = preload("res://addons/godot_mcp/utils/plugin_state.gd")

const _MCP_AUTOLOADS: Array[Array] = [
	["autoload/MCPScreenshot", "res://addons/godot_mcp/mcp_screenshot_service.gd"],
	["autoload/MCPInputService", "res://addons/godot_mcp/mcp_input_service.gd"],
	["autoload/MCPGameInspector", "res://addons/godot_mcp/mcp_game_inspector_service.gd"],
]

const _MCP_TEMP_FILES: Array[String] = [
	"mcp_debugger_continue",
	"mcp_game_request",
	"mcp_game_response",
	"mcp_input_commands",
	"mcp_screenshot_request",
	"mcp_screenshot.png",
]
const _MCP_STATE_CONFIG_PATH := "user://mcp_plugin_state.cfg"
const _MCP_BASE_PORT := 6505
const _MCP_MAX_PORT := 6514

var websocket_server: Node
var command_router: Node
var status_panel: Control
var plugin_state
var auto_dismiss_dialogs: bool = false
# Track which autoloads THIS session injected (vs project-owned)
var _session_injected_autoloads: Array[String] = []

func _enter_tree() -> void:
	# Create command router
	command_router = preload("res://addons/godot_mcp/command_router.gd").new()
	command_router.name = "MCPCommandRouter"
	command_router.editor_plugin = self
	add_child(command_router)

	# Create WebSocket server
	websocket_server = preload("res://addons/godot_mcp/websocket_server.gd").new()
	websocket_server.name = "MCPWebSocketServer"
	websocket_server.command_router = command_router
	add_child(websocket_server)

	plugin_state = PluginState.new()
	plugin_state.websocket_server = websocket_server

	# Create status panel
	var panel_scene: PackedScene = preload("res://addons/godot_mcp/ui/status_panel.tscn")
	status_panel = panel_scene.instantiate()
	add_control_to_bottom_panel(status_panel, "MCP MyPro")
	status_panel.call_deferred("setup", websocket_server, command_router)

	# Inject MCP autoloads into project settings
	plugin_state.inject_autoloads()

	websocket_server.start_server()
	var cfg := ConfigFile.new()
	var ver := "unknown"
	if cfg.load("res://addons/godot_mcp/plugin.cfg") == OK:
		ver = cfg.get_value("plugin", "version", "unknown")
	print("[MCP] Godot MCP MyPro v%s started (ports 6505-6514)" % ver)


func _exit_tree() -> void:
	# Remove MCP autoloads and clean up temp files
	if plugin_state:
		plugin_state.remove_autoloads()
		plugin_state.cleanup_temp_files()

	if websocket_server:
		websocket_server.stop_server()

	if status_panel:
		remove_control_from_bottom_panel(status_panel)
		status_panel.queue_free()

	if command_router:
		command_router.queue_free()

	if websocket_server:
		websocket_server.queue_free()

	print("[MCP] Godot MCP MyPro stopped")


func _inject_autoloads() -> void:
	_session_injected_autoloads.clear()
	var changed := false
	var records := _load_recorded_injected_autoloads()
	for entry: Array in _MCP_AUTOLOADS:
		var key: String = entry[0]
		var script: String = entry[1]
		if not ProjectSettings.has_setting(key):
			ProjectSettings.set_setting(key, "*" + script)
			_session_injected_autoloads.append(key)
			records[key] = script
			changed = true
	if changed:
		var err := ProjectSettings.save()
		if err != OK:
			push_warning("[MCP] Failed to save injected autoloads: %s" % error_string(err))
		_save_recorded_injected_autoloads(records)


func _remove_autoloads() -> void:
	# Only remove autoloads that THIS session injected.
	# Pre-existing project-owned autoloads are preserved.
	var changed := false
	var records := _load_recorded_injected_autoloads()
	for key: String in _session_injected_autoloads:
		if ProjectSettings.has_setting(key):
			var expected_path := _expected_autoload_path(key)
			if _normalize_autoload_value(ProjectSettings.get_setting(key)) == expected_path:
				ProjectSettings.clear(key)
				records.erase(key)
				changed = true
			else:
				records.erase(key)
	_session_injected_autoloads.clear()
	if changed:
		var err := ProjectSettings.save()
		if err != OK:
			push_warning("[MCP] Failed to remove injected autoloads: %s" % error_string(err))
	_save_recorded_injected_autoloads(records)


func get_mcp_plugin_status() -> Dictionary:
	return _get_plugin_state().get_status()


func cleanup_mcp_project_state() -> Dictionary:
	return _get_plugin_state().cleanup_project_state()


func _get_plugin_state():
	if not plugin_state:
		plugin_state = PluginState.new()
	plugin_state.websocket_server = websocket_server
	return plugin_state


func _load_recorded_injected_autoloads() -> Dictionary:
	var records := {}
	var cfg := ConfigFile.new()
	if cfg.load(_MCP_STATE_CONFIG_PATH) != OK:
		return records
	if not cfg.has_section("injected_autoloads"):
		return records
	for key: String in cfg.get_section_keys("injected_autoloads"):
		records[key] = str(cfg.get_value("injected_autoloads", key, ""))
	return records


func _save_recorded_injected_autoloads(records: Dictionary) -> void:
	var cfg := ConfigFile.new()
	for key: String in records:
		cfg.set_value("injected_autoloads", key, records[key])
	cfg.set_value("metadata", "updated_at", Time.get_datetime_string_from_system())
	var err := cfg.save(_MCP_STATE_CONFIG_PATH)
	if err != OK:
		push_warning("[MCP] Failed to save MCP plugin state: %s" % error_string(err))


func _autoload_name_from_key(key: String) -> String:
	if key.begins_with("autoload/"):
		return key.substr("autoload/".length())
	return key


func _expected_autoload_path(key: String) -> String:
	for entry: Array in _MCP_AUTOLOADS:
		if entry[0] == key:
			return entry[1]
	return ""


func _normalize_autoload_value(value: Variant) -> String:
	var text := str(value)
	if text.begins_with("*"):
		return text.substr(1)
	return text


var _dialog_check_timer: float = 0.0
const _DIALOG_CHECK_INTERVAL: float = 0.5  # Check every 0.5 seconds

func _process(delta: float) -> void:
	# Check if game inspector requested debugger continue
	var flag_path := OS.get_user_data_dir() + "/mcp_debugger_continue"
	if FileAccess.file_exists(flag_path):
		DirAccess.remove_absolute(flag_path)
		_try_debugger_continue()

	# Periodically check for blocking editor dialogs (only when enabled by AI)
	if auto_dismiss_dialogs:
		_dialog_check_timer += delta
		if _dialog_check_timer >= _DIALOG_CHECK_INTERVAL:
			_dialog_check_timer = 0.0
			_auto_dismiss_dialogs()


func _try_debugger_continue() -> void:
	# Last resort: find and press the debugger Continue button to unstick the game
	var base: Node = EditorInterface.get_base_control()
	var continue_btn := _find_debugger_continue_button(base)
	if continue_btn and continue_btn.visible and not continue_btn.disabled:
		continue_btn.emit_signal("pressed")
		push_warning("[MCP] Auto-pressed debugger Continue button")
	else:
		push_warning("[MCP] Could not find debugger Continue button")


func _find_debugger_continue_button(node: Node) -> Button:
	# Search for the Continue button in ScriptEditorDebugger
	if node is Button:
		var btn: Button = node
		if btn.tooltip_text.contains("Continue") or btn.text == "Continue":
			return btn
	for child in node.get_children():
		var found: Button = _find_debugger_continue_button(child)
		if found:
			return found
	return null


func _auto_dismiss_dialogs() -> void:
	var base: Node = EditorInterface.get_base_control()
	if not base:
		return
	_find_and_dismiss_dialogs(base)


func _find_and_dismiss_dialogs(node: Node) -> void:
	if node is AcceptDialog and node.visible:
		var dialog: AcceptDialog = node
		# Never dismiss file dialogs or non-modal popups
		if dialog is FileDialog:
			return
		if not dialog.exclusive:
			return
		# Get dialog title/text for logging
		var title := dialog.title
		var text := dialog.dialog_text
		# Accept the dialog (presses OK / confirms)
		dialog.get_ok_button().emit_signal("pressed")
		push_warning("[MCP] Auto-dismissed editor dialog: '%s' — %s" % [title, text])
		return  # One dialog per check cycle to avoid side effects

	for child in node.get_children():
		# Only search visible Windows to keep the scan lightweight
		if child is Window and not child.visible:
			continue
		_find_and_dismiss_dialogs(child)


func _cleanup_temp_files() -> Dictionary:
	var removed: Array = []
	var skipped: Array = []
	var dirs := _get_runtime_user_dirs()

	for user_dir: String in dirs:
		for filename: String in _MCP_TEMP_FILES:
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


func _get_runtime_user_dirs() -> Array[String]:
	var dirs: Array[String] = []
	_append_unique_path(dirs, OS.get_user_data_dir())
	_append_unique_path(dirs, _get_game_user_dir())
	return dirs


func _append_unique_path(paths: Array[String], path: String) -> void:
	if path.is_empty():
		return
	if not (path in paths):
		paths.append(path)


func _get_game_user_dir() -> String:
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
