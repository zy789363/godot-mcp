@tool
extends "res://addons/godot_mcp/commands/base_command.gd"


func get_commands() -> Dictionary:
	return {
		"get_mcp_plugin_status": _get_mcp_plugin_status,
		"cleanup_mcp_project_state": _cleanup_mcp_project_state,
	}


func _get_mcp_plugin_status(_params: Dictionary) -> Dictionary:
	if not editor_plugin or not editor_plugin.has_method("get_mcp_plugin_status"):
		return error_internal("MCP plugin status API is unavailable")

	var status: Variant = editor_plugin.call("get_mcp_plugin_status")
	if not status is Dictionary:
		return error_internal("MCP plugin status API returned an invalid response")
	return success(status)


func _cleanup_mcp_project_state(_params: Dictionary) -> Dictionary:
	if not editor_plugin or not editor_plugin.has_method("cleanup_mcp_project_state"):
		return error_internal("MCP plugin cleanup API is unavailable")

	var cleanup_result: Variant = editor_plugin.call("cleanup_mcp_project_state")
	if not cleanup_result is Dictionary:
		return error_internal("MCP plugin cleanup API returned an invalid response")
	return success(cleanup_result)
