import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/javascript/array
import gleam/javascript/promise.{type Promise}
import gleam/option.{type Option, None, Some}
import gleam/result

/// The extension API object passed to a Pi extension factory.
pub type ExtensionApi

/// Explicit capability for the optional Pi Durable shell. This invokes an
/// already registered tool and captures its custom entries in that task;
/// it does not add a provider, fetch implementation, or financial policy.
pub type DurableToolInvoker

@external(javascript, "./durable_bridge_ffi.mjs", "create_invoker")
pub fn durable_tool_invoker(api: ExtensionApi) -> DurableToolInvoker

/// Context supplied to event and tool callbacks.
pub type Context

/// Context supplied to command callbacks. At runtime this is an extension
/// context with additional session replacement and reload methods.
pub type CommandContext =
  Context

/// Pi's mode-specific UI surface.
pub type Ui

/// A JavaScript AbortSignal owned by Pi.
pub type AbortSignal

/// Pi's optional tool-update callback.
pub type UpdateSink

/// Pi's shared inter-extension event bus.
pub type EventBus

/// Pi's read-only session manager for the active callback context.
pub type SessionManager

/// An untyped JavaScript value for APIs not yet given a typed wrapper.
pub type JsValue =
  Dynamic

pub type FlagValue {
  BooleanFlag(Bool)
  StringFlag(String)
}

pub type Delivery {
  Steer
  FollowUp
  NextTurn
}

pub type QueueDelivery {
  QueueSteer
  QueueFollowUp
}

pub type ExecResult {
  ExecResult(stdout: String, stderr: String, code: Int, killed: Bool)
}

/// Register a slash command.
@external(javascript, "./pi_ffi.mjs", "register_command")
pub fn register_command(
  api: ExtensionApi,
  name: String,
  description: String,
  handler: fn(String, CommandContext) -> Promise(Nil),
) -> Nil

/// Register a keyboard shortcut.
@external(javascript, "./pi_ffi.mjs", "register_shortcut")
pub fn register_shortcut(
  api: ExtensionApi,
  shortcut: String,
  description: String,
  handler: fn(Context) -> Promise(Nil),
) -> Nil

@external(javascript, "./pi_ffi.mjs", "register_boolean_flag")
pub fn register_boolean_flag(
  api: ExtensionApi,
  name: String,
  description: String,
  default: Bool,
) -> Nil

@external(javascript, "./pi_ffi.mjs", "register_string_flag")
pub fn register_string_flag(
  api: ExtensionApi,
  name: String,
  description: String,
  default: String,
) -> Nil

@external(javascript, "./pi_ffi.mjs", "get_flag")
fn get_flag_value(api: ExtensionApi, name: String) -> Dynamic

pub fn get_flag(api: ExtensionApi, name: String) -> Option(FlagValue) {
  let value = get_flag_value(api, name)
  case decode.run(value, decode.bool), decode.run(value, decode.string) {
    Ok(value), _ -> Some(BooleanFlag(value))
    _, Ok(value) -> Some(StringFlag(value))
    _, _ -> None
  }
}

@external(javascript, "./pi_ffi.mjs", "send_user_message")
fn do_send_user_message(
  api: ExtensionApi,
  content: String,
  delivery: String,
) -> Nil

pub fn send_user_message(
  api: ExtensionApi,
  content: String,
  delivery: QueueDelivery,
) -> Nil {
  do_send_user_message(api, content, queue_delivery_name(delivery))
}

@external(javascript, "./pi_ffi.mjs", "send_message")
fn do_send_message(
  api: ExtensionApi,
  custom_type: String,
  content: String,
  display: Bool,
  trigger_turn: Bool,
  delivery: String,
) -> Nil

pub fn send_message(
  api: ExtensionApi,
  custom_type: String,
  content: String,
  display: Bool,
  trigger_turn: Bool,
  delivery: Delivery,
) -> Nil {
  do_send_message(
    api,
    custom_type,
    content,
    display,
    trigger_turn,
    delivery_name(delivery),
  )
}

@external(javascript, "./pi_ffi.mjs", "append_entry")
pub fn append_entry(
  api: ExtensionApi,
  custom_type: String,
  data: Dynamic,
) -> Nil

@external(javascript, "./pi_ffi.mjs", "set_session_name")
pub fn set_session_name(api: ExtensionApi, name: String) -> Nil

@external(javascript, "./pi_ffi.mjs", "get_session_name")
fn get_session_name_value(api: ExtensionApi) -> Dynamic

pub fn get_session_name(api: ExtensionApi) -> Option(String) {
  get_session_name_value(api)
  |> decode.run(decode.optional(decode.string))
  |> result.unwrap(None)
}

@external(javascript, "./pi_ffi.mjs", "set_label")
pub fn set_label(api: ExtensionApi, entry_id: String, label: String) -> Nil

@external(javascript, "./pi_ffi.mjs", "clear_label")
pub fn clear_label(api: ExtensionApi, entry_id: String) -> Nil

@external(javascript, "./pi_ffi.mjs", "get_active_tools")
fn get_active_tools_array(api: ExtensionApi) -> array.Array(String)

pub fn get_active_tools(api: ExtensionApi) -> List(String) {
  api |> get_active_tools_array |> array.to_list
}

@external(javascript, "./pi_ffi.mjs", "set_active_tools")
fn set_active_tools_array(api: ExtensionApi, names: array.Array(String)) -> Nil

pub fn set_active_tools(api: ExtensionApi, names: List(String)) -> Nil {
  set_active_tools_array(api, array.from_list(names))
}

@external(javascript, "./pi_ffi.mjs", "get_all_tools")
pub fn get_all_tools(api: ExtensionApi) -> array.Array(Dynamic)

@external(javascript, "./pi_ffi.mjs", "get_commands")
pub fn get_commands(api: ExtensionApi) -> array.Array(Dynamic)

@external(javascript, "./pi_ffi.mjs", "get_thinking_level")
pub fn get_thinking_level(api: ExtensionApi) -> String

@external(javascript, "./pi_ffi.mjs", "set_thinking_level")
pub fn set_thinking_level(api: ExtensionApi, level: String) -> Nil

@external(javascript, "./pi_ffi.mjs", "set_model")
pub fn set_model(api: ExtensionApi, model: Dynamic) -> Promise(Bool)

@external(javascript, "./pi_ffi.mjs", "events")
pub fn events(api: ExtensionApi) -> EventBus

@external(javascript, "./pi_ffi.mjs", "register_provider")
pub fn register_provider(
  api: ExtensionApi,
  name: String,
  config: Dynamic,
) -> Nil

@external(javascript, "./pi_ffi.mjs", "unregister_provider")
pub fn unregister_provider(api: ExtensionApi, name: String) -> Nil

@external(javascript, "./pi_ffi.mjs", "exec")
fn exec_raw(
  api: ExtensionApi,
  command: String,
  args: array.Array(String),
) -> Promise(Dynamic)

@external(javascript, "./pi_ffi.mjs", "exec_stdout")
fn exec_stdout(result: Dynamic) -> String

@external(javascript, "./pi_ffi.mjs", "exec_stderr")
fn exec_stderr(result: Dynamic) -> String

@external(javascript, "./pi_ffi.mjs", "exec_code")
fn exec_code(result: Dynamic) -> Int

@external(javascript, "./pi_ffi.mjs", "exec_killed")
fn exec_killed(result: Dynamic) -> Bool

pub fn exec(
  api: ExtensionApi,
  command: String,
  args: List(String),
) -> Promise(ExecResult) {
  api
  |> exec_raw(command, array.from_list(args))
  |> promise.map(fn(value) {
    ExecResult(
      stdout: exec_stdout(value),
      stderr: exec_stderr(value),
      code: exec_code(value),
      killed: exec_killed(value),
    )
  })
}

fn delivery_name(delivery: Delivery) -> String {
  case delivery {
    Steer -> "steer"
    FollowUp -> "followUp"
    NextTurn -> "nextTurn"
  }
}

fn queue_delivery_name(delivery: QueueDelivery) -> String {
  case delivery {
    QueueSteer -> "steer"
    QueueFollowUp -> "followUp"
  }
}
