import { capture_entry } from "./durable_bridge_ffi.mjs";

export function register_command(api, name, description, handler) {
  api.registerCommand(name, { description, handler });
}

export function register_shortcut(api, shortcut, description, handler) {
  api.registerShortcut(shortcut, { description, handler });
}

export function register_boolean_flag(api, name, description, defaultValue) {
  api.registerFlag(name, { description, type: "boolean", default: defaultValue });
}

export function register_string_flag(api, name, description, defaultValue) {
  api.registerFlag(name, { description, type: "string", default: defaultValue });
}

export function get_flag(api, name) {
  return api.getFlag(name);
}

export function send_user_message(api, content, delivery) {
  api.sendUserMessage(content, { deliverAs: delivery });
}

export function send_message(api, customType, content, display, triggerTurn, delivery) {
  api.sendMessage(
    { customType, content, display },
    { triggerTurn, deliverAs: delivery },
  );
}

export function append_entry(api, customType, data) {
  if (capture_entry(api, customType, data)) return;
  api.appendEntry(customType, data);
}

export function set_session_name(api, name) {
  api.setSessionName(name);
}

export function get_session_name(api) {
  return api.getSessionName();
}

export function set_label(api, entryId, label) {
  api.setLabel(entryId, label);
}

export function clear_label(api, entryId) {
  api.setLabel(entryId, undefined);
}

export function get_active_tools(api) {
  return api.getActiveTools();
}

export function set_active_tools(api, names) {
  api.setActiveTools(names);
}

export function get_all_tools(api) {
  return api.getAllTools();
}

export function get_commands(api) {
  return api.getCommands();
}

export function get_thinking_level(api) {
  return api.getThinkingLevel();
}

export function set_thinking_level(api, level) {
  api.setThinkingLevel(level);
}

export function set_model(api, model) {
  return api.setModel(model);
}

export function events(api) {
  return api.events;
}

export function register_provider(api, name, config) {
  api.registerProvider(name, config);
}

export function unregister_provider(api, name) {
  api.unregisterProvider(name);
}

export function exec(api, command, args) {
  return api.exec(command, args);
}

export function exec_stdout(result) {
  return result.stdout;
}

export function exec_stderr(result) {
  return result.stderr;
}

export function exec_code(result) {
  return result.code;
}

export function exec_killed(result) {
  return result.killed;
}
