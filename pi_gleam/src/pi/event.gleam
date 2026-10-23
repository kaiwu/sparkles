import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode.{type Decoder}
import gleam/javascript/array
import gleam/javascript/promise.{type Promise}
import gleam/option.{type Option, None, Some}
import gleam/string
import pi.{type AbortSignal, type Context, type ExtensionApi}
import pi/session

pub const project_trust = "project_trust"

pub const resources_discover = "resources_discover"

pub const session_start = "session_start"

pub const session_info_changed = "session_info_changed"

pub const session_before_switch = "session_before_switch"

pub const session_before_fork = "session_before_fork"

pub const session_before_compact = "session_before_compact"

pub const session_compact = "session_compact"

pub const session_compact_failed = "session_compact_failed"

pub const session_shutdown = "session_shutdown"

pub const session_before_tree = "session_before_tree"

pub const session_tree = "session_tree"

pub const context = "context"

pub const context_with_system = "context_with_system"

pub const before_provider_headers = "before_provider_headers"

pub const before_provider_request = "before_provider_request"

pub const after_provider_response = "after_provider_response"

pub const before_agent_start = "before_agent_start"

pub const agent_start = "agent_start"

pub const agent_end = "agent_end"

pub const agent_before_settle = "agent_before_settle"

pub const agent_settled = "agent_settled"

pub const turn_start = "turn_start"

pub const turn_end = "turn_end"

pub const message_start = "message_start"

pub const message_update = "message_update"

pub const message_end = "message_end"

pub const tool_execution_start = "tool_execution_start"

pub const tool_execution_update = "tool_execution_update"

pub const tool_execution_end = "tool_execution_end"

pub const model_select = "model_select"

pub const thinking_level_select = "thinking_level_select"

pub const tool_call = "tool_call"

pub const tool_result = "tool_result"

pub const user_bash = "user_bash"

pub const input = "input"

pub type Event {
  Event(type_: String, raw: Dynamic)
}

pub type SessionStartReason {
  StartStartup
  StartReload
  StartNew
  StartResume
  StartFork
  StartUnknown(String)
}

pub type SessionShutdownReason {
  ShutdownQuit
  ShutdownReload
  ShutdownNew
  ShutdownResume
  ShutdownFork
  ShutdownUnknown(String)
}

pub type SessionSwitchReason {
  SwitchNew
  SwitchResume
  SwitchUnknown(String)
}

pub type ForkPosition {
  ForkBefore
  ForkAt
  ForkPositionUnknown(String)
}

pub type CompactionReason {
  CompactManual
  CompactThreshold
  CompactOverflow
  CompactUnknown(String)
}

pub type SessionStart {
  SessionStart(
    reason: SessionStartReason,
    previous_session_file: Option(String),
    raw: Dynamic,
  )
}

pub type SessionInfoChanged {
  SessionInfoChanged(name: Option(String), raw: Dynamic)
}

pub type SessionBeforeSwitch {
  SessionBeforeSwitch(
    reason: SessionSwitchReason,
    target_session_file: Option(String),
    raw: Dynamic,
  )
}

pub type SessionBeforeFork {
  SessionBeforeFork(entry_id: String, position: ForkPosition, raw: Dynamic)
}

pub type CompactionPreparation {
  CompactionPreparation(
    first_kept_entry_id: String,
    is_split_turn: Bool,
    tokens_before: Int,
    previous_summary: Option(String),
    raw: Dynamic,
  )
}

pub type SessionBeforeCompact {
  SessionBeforeCompact(
    preparation: CompactionPreparation,
    branch_entries: List(session.Entry),
    custom_instructions: Option(String),
    reason: CompactionReason,
    will_retry: Bool,
    signal: AbortSignal,
    raw: Dynamic,
  )
}

pub type SessionCompact {
  SessionCompact(
    compaction_entry: session.Entry,
    from_extension: Bool,
    reason: CompactionReason,
    will_retry: Bool,
    raw: Dynamic,
  )
}

pub type SessionShutdown {
  SessionShutdown(
    reason: SessionShutdownReason,
    target_session_file: Option(String),
    raw: Dynamic,
  )
}

pub type TreePreparation {
  TreePreparation(
    target_id: String,
    old_leaf_id: Option(String),
    common_ancestor_id: Option(String),
    entries_to_summarize: List(session.Entry),
    user_wants_summary: Bool,
    custom_instructions: Option(String),
    replace_instructions: Bool,
    label: Option(String),
    raw: Dynamic,
  )
}

pub type SessionBeforeTree {
  SessionBeforeTree(
    preparation: TreePreparation,
    signal: AbortSignal,
    raw: Dynamic,
  )
}

pub type SessionTree {
  SessionTree(
    new_leaf_id: Option(String),
    old_leaf_id: Option(String),
    summary_entry: Option(session.Entry),
    from_extension: Bool,
    raw: Dynamic,
  )
}

pub type ToolCall {
  ToolCall(
    tool_call_id: String,
    tool_name: String,
    input: Dynamic,
    raw: Dynamic,
  )
}

pub type Input {
  Input(
    text: String,
    source: String,
    streaming_behavior: Option(String),
    images: List(Dynamic),
    raw: Dynamic,
  )
}

/// A run started by a user prompt or by `send_message(..., trigger_turn: True)`.
/// Pi 1.2.0 tags this as `messageType`; a missing tag is treated as a user start
/// so 1.0.x hosts keep working.
pub type BeforeAgentStart {
  BeforeAgentStartUser(
    prompt: String,
    images: List(Dynamic),
    system_prompt: Option(String),
    raw: Dynamic,
  )
  BeforeAgentStartCustom(
    message: Dynamic,
    system_prompt: Option(String),
    raw: Dynamic,
  )
}

pub type TurnStart {
  TurnStart(index: Int, timestamp: Int, raw: Dynamic)
}

pub type ProviderResponse {
  ProviderResponse(status: Int, headers: Dynamic, raw: Dynamic)
}

pub type ToolExecution {
  ToolExecution(
    tool_call_id: String,
    tool_name: String,
    args: Dynamic,
    raw: Dynamic,
  )
}

@external(javascript, "./event_ffi.mjs", "observe")
fn do_observe(
  api: ExtensionApi,
  event: String,
  handler: fn(Dynamic, Context) -> Promise(Nil),
) -> Nil

@external(javascript, "./event_ffi.mjs", "respond")
fn do_respond(
  api: ExtensionApi,
  event: String,
  handler: fn(Dynamic, Context) -> Promise(Dynamic),
) -> Nil

@external(javascript, "./event_ffi.mjs", "undefined_value")
fn undefined_value() -> Dynamic

@external(javascript, "./event_ffi.mjs", "reject")
fn reject(message: String) -> Promise(value)

/// Observe any Pi event without changing its result.
pub fn observe(
  api: ExtensionApi,
  event: String,
  handler: fn(Event, Context) -> Promise(Nil),
) -> Nil {
  do_observe(api, event, fn(raw, context) {
    handler(Event(type_: event, raw: raw), context)
  })
}

/// Observe an event through a Gleam dynamic decoder.
pub fn observe_decoded(
  api: ExtensionApi,
  event: String,
  decoder: Decoder(value),
  handler: fn(value, Context) -> Promise(Nil),
) -> Nil {
  do_observe(api, event, fn(raw, context) {
    case decode.run(raw, decoder) {
      Ok(value) -> handler(value, context)
      Error(errors) ->
        reject("Could not decode Pi event: " <> string.inspect(errors))
    }
  })
}

/// Handle any result-bearing Pi event. `None` maps to JavaScript `undefined`.
pub fn respond(
  api: ExtensionApi,
  event: String,
  handler: fn(Event, Context) -> Promise(Option(Dynamic)),
) -> Nil {
  do_respond(api, event, fn(raw, context) {
    handler(Event(type_: event, raw: raw), context)
    |> promise.map(fn(result) {
      case result {
        Some(value) -> value
        None -> undefined_value()
      }
    })
  })
}

/// Handle a result-bearing event through a Gleam dynamic decoder.
pub fn respond_decoded(
  api: ExtensionApi,
  event: String,
  decoder: Decoder(value),
  handler: fn(value, Context) -> Promise(Option(Dynamic)),
) -> Nil {
  do_respond(api, event, fn(raw, context) {
    case decode.run(raw, decoder) {
      Ok(value) ->
        handler(value, context)
        |> promise.map(fn(result) {
          case result {
            Some(value) -> value
            None -> undefined_value()
          }
        })
      Error(errors) ->
        reject("Could not decode Pi event: " <> string.inspect(errors))
    }
  })
}

pub fn on_session_start(
  api: ExtensionApi,
  handler: fn(SessionStart, Context) -> Promise(Nil),
) -> Nil {
  observe_decoded(api, session_start, session_start_decoder(), handler)
}

pub fn on_session_info_changed(
  api: ExtensionApi,
  handler: fn(SessionInfoChanged, Context) -> Promise(Nil),
) -> Nil {
  observe_decoded(
    api,
    session_info_changed,
    session_info_changed_decoder(),
    handler,
  )
}

pub fn on_session_before_switch(
  api: ExtensionApi,
  handler: fn(SessionBeforeSwitch, Context) -> Promise(Option(Dynamic)),
) -> Nil {
  respond_decoded(
    api,
    session_before_switch,
    session_before_switch_decoder(),
    handler,
  )
}

pub fn on_session_before_fork(
  api: ExtensionApi,
  handler: fn(SessionBeforeFork, Context) -> Promise(Option(Dynamic)),
) -> Nil {
  respond_decoded(
    api,
    session_before_fork,
    session_before_fork_decoder(),
    handler,
  )
}

pub fn on_session_before_compact(
  api: ExtensionApi,
  handler: fn(SessionBeforeCompact, Context) -> Promise(Option(Dynamic)),
) -> Nil {
  respond_decoded(
    api,
    session_before_compact,
    session_before_compact_decoder(),
    handler,
  )
}

pub fn on_session_compact(
  api: ExtensionApi,
  handler: fn(SessionCompact, Context) -> Promise(Nil),
) -> Nil {
  observe_decoded(api, session_compact, session_compact_decoder(), handler)
}

pub fn on_session_shutdown(
  api: ExtensionApi,
  handler: fn(SessionShutdown, Context) -> Promise(Nil),
) -> Nil {
  observe_decoded(api, session_shutdown, session_shutdown_decoder(), handler)
}

pub fn on_session_before_tree(
  api: ExtensionApi,
  handler: fn(SessionBeforeTree, Context) -> Promise(Option(Dynamic)),
) -> Nil {
  respond_decoded(
    api,
    session_before_tree,
    session_before_tree_decoder(),
    handler,
  )
}

pub fn on_session_tree(
  api: ExtensionApi,
  handler: fn(SessionTree, Context) -> Promise(Nil),
) -> Nil {
  observe_decoded(api, session_tree, session_tree_decoder(), handler)
}

pub fn on_tool_call(
  api: ExtensionApi,
  handler: fn(ToolCall, Context) -> Promise(Option(Dynamic)),
) -> Nil {
  respond_decoded(api, tool_call, tool_call_decoder(), handler)
}

pub fn on_input(
  api: ExtensionApi,
  handler: fn(Input, Context) -> Promise(Option(Dynamic)),
) -> Nil {
  respond_decoded(api, input, input_decoder(), handler)
}

pub fn on_before_agent_start(
  api: ExtensionApi,
  handler: fn(BeforeAgentStart, Context) -> Promise(Option(Dynamic)),
) -> Nil {
  respond_decoded(
    api,
    before_agent_start,
    before_agent_start_decoder(),
    handler,
  )
}

pub fn on_turn_start(
  api: ExtensionApi,
  handler: fn(TurnStart, Context) -> Promise(Nil),
) -> Nil {
  observe_decoded(api, turn_start, turn_start_decoder(), handler)
}

pub fn on_after_provider_response(
  api: ExtensionApi,
  handler: fn(ProviderResponse, Context) -> Promise(Nil),
) -> Nil {
  observe_decoded(
    api,
    after_provider_response,
    provider_response_decoder(),
    handler,
  )
}

pub fn on_tool_execution_start(
  api: ExtensionApi,
  handler: fn(ToolExecution, Context) -> Promise(Nil),
) -> Nil {
  observe_decoded(api, tool_execution_start, tool_execution_decoder(), handler)
}

@external(javascript, "./event_ffi.mjs", "project_trust_result")
fn do_project_trust_result(trusted: String, remember: Bool) -> Dynamic

pub fn project_trust_result(trusted: String, remember: Bool) -> Dynamic {
  do_project_trust_result(trusted, remember)
}

@external(javascript, "./event_ffi.mjs", "resource_paths")
fn resource_paths_arrays(
  skills: array.Array(String),
  prompts: array.Array(String),
  themes: array.Array(String),
) -> Dynamic

pub fn resource_paths(
  skills: List(String),
  prompts: List(String),
  themes: List(String),
) -> Dynamic {
  resource_paths_arrays(
    array.from_list(skills),
    array.from_list(prompts),
    array.from_list(themes),
  )
}

@external(javascript, "./event_ffi.mjs", "cancel")
pub fn cancel() -> Dynamic

@external(javascript, "./event_ffi.mjs", "skip_conversation_restore")
pub fn skip_conversation_restore() -> Dynamic

@external(javascript, "./event_ffi.mjs", "custom_compaction")
pub fn custom_compaction(
  summary: String,
  first_kept_entry_id: String,
  tokens_before: Int,
) -> Dynamic

@external(javascript, "./event_ffi.mjs", "custom_compaction_with_details")
pub fn custom_compaction_with_details(
  summary: String,
  first_kept_entry_id: String,
  tokens_before: Int,
  details: Dynamic,
) -> Dynamic

@external(javascript, "./event_ffi.mjs", "tree_summary")
pub fn tree_summary(summary: String) -> Dynamic

@external(javascript, "./event_ffi.mjs", "tree_summary_with_details")
pub fn tree_summary_with_details(summary: String, details: Dynamic) -> Dynamic

@external(javascript, "./event_ffi.mjs", "block_tool")
pub fn block_tool(reason: String) -> Dynamic

@external(javascript, "./event_ffi.mjs", "continue_input")
pub fn continue_input() -> Dynamic

@external(javascript, "./event_ffi.mjs", "transform_input")
pub fn transform_input(text: String) -> Dynamic

@external(javascript, "./event_ffi.mjs", "handled_input")
pub fn handled_input() -> Dynamic

@external(javascript, "./event_ffi.mjs", "system_prompt")
pub fn system_prompt(value: String) -> Dynamic

@external(javascript, "./event_ffi.mjs", "replace_payload")
pub fn replace_payload(value: Dynamic) -> Dynamic

@external(javascript, "./event_ffi.mjs", "replace_messages")
fn replace_messages_array(messages: array.Array(Dynamic)) -> Dynamic

pub fn replace_messages(messages: List(Dynamic)) -> Dynamic {
  messages |> array.from_list |> replace_messages_array
}

@external(javascript, "./event_ffi.mjs", "event_signal")
pub fn signal(raw: Dynamic) -> AbortSignal

fn session_start_decoder() -> Decoder(SessionStart) {
  use reason <- decode.field("reason", decode.string)
  use previous_session_file <- decode.optional_field(
    "previousSessionFile",
    None,
    decode.map(decode.string, Some),
  )
  use raw <- decode.then(decode.dynamic)
  decode.success(SessionStart(
    reason: session_start_reason(reason),
    previous_session_file:,
    raw:,
  ))
}

fn session_info_changed_decoder() -> Decoder(SessionInfoChanged) {
  use name <- decode.field("name", decode.optional(decode.string))
  use raw <- decode.then(decode.dynamic)
  decode.success(SessionInfoChanged(name:, raw:))
}

fn session_before_switch_decoder() -> Decoder(SessionBeforeSwitch) {
  use reason <- decode.field("reason", decode.string)
  use target_session_file <- decode.optional_field(
    "targetSessionFile",
    None,
    decode.map(decode.string, Some),
  )
  use raw <- decode.then(decode.dynamic)
  decode.success(SessionBeforeSwitch(
    reason: session_switch_reason(reason),
    target_session_file:,
    raw:,
  ))
}

fn session_before_fork_decoder() -> Decoder(SessionBeforeFork) {
  use entry_id <- decode.field("entryId", decode.string)
  use position <- decode.field("position", decode.string)
  use raw <- decode.then(decode.dynamic)
  decode.success(SessionBeforeFork(
    entry_id:,
    position: fork_position(position),
    raw:,
  ))
}

fn compaction_preparation_decoder() -> Decoder(CompactionPreparation) {
  use first_kept_entry_id <- decode.field("firstKeptEntryId", decode.string)
  use is_split_turn <- decode.field("isSplitTurn", decode.bool)
  use tokens_before <- decode.field("tokensBefore", decode.int)
  use previous_summary <- decode.optional_field(
    "previousSummary",
    None,
    decode.map(decode.string, Some),
  )
  use raw <- decode.then(decode.dynamic)
  decode.success(CompactionPreparation(
    first_kept_entry_id:,
    is_split_turn:,
    tokens_before:,
    previous_summary:,
    raw:,
  ))
}

fn session_before_compact_decoder() -> Decoder(SessionBeforeCompact) {
  use preparation <- decode.field(
    "preparation",
    compaction_preparation_decoder(),
  )
  use branch_entries <- decode.field(
    "branchEntries",
    decode.list(of: session.entry_decoder()),
  )
  use custom_instructions <- decode.optional_field(
    "customInstructions",
    None,
    decode.map(decode.string, Some),
  )
  use reason <- decode.field("reason", decode.string)
  use will_retry <- decode.field("willRetry", decode.bool)
  use _signal <- decode.field("signal", decode.dynamic)
  use raw <- decode.then(decode.dynamic)
  decode.success(SessionBeforeCompact(
    preparation:,
    branch_entries:,
    custom_instructions:,
    reason: compaction_reason(reason),
    will_retry:,
    signal: signal(raw),
    raw:,
  ))
}

fn session_compact_decoder() -> Decoder(SessionCompact) {
  use compaction_entry <- decode.field(
    "compactionEntry",
    session.entry_decoder(),
  )
  use from_extension <- decode.field("fromExtension", decode.bool)
  use reason <- decode.field("reason", decode.string)
  use will_retry <- decode.field("willRetry", decode.bool)
  use raw <- decode.then(decode.dynamic)
  decode.success(SessionCompact(
    compaction_entry:,
    from_extension:,
    reason: compaction_reason(reason),
    will_retry:,
    raw:,
  ))
}

fn session_shutdown_decoder() -> Decoder(SessionShutdown) {
  use reason <- decode.field("reason", decode.string)
  use target_session_file <- decode.optional_field(
    "targetSessionFile",
    None,
    decode.map(decode.string, Some),
  )
  use raw <- decode.then(decode.dynamic)
  decode.success(SessionShutdown(
    reason: session_shutdown_reason(reason),
    target_session_file:,
    raw:,
  ))
}

fn tree_preparation_decoder() -> Decoder(TreePreparation) {
  use target_id <- decode.field("targetId", decode.string)
  use old_leaf_id <- decode.field("oldLeafId", decode.optional(decode.string))
  use common_ancestor_id <- decode.field(
    "commonAncestorId",
    decode.optional(decode.string),
  )
  use entries_to_summarize <- decode.field(
    "entriesToSummarize",
    decode.list(of: session.entry_decoder()),
  )
  use user_wants_summary <- decode.field("userWantsSummary", decode.bool)
  use custom_instructions <- decode.optional_field(
    "customInstructions",
    None,
    decode.map(decode.string, Some),
  )
  use replace_instructions <- decode.optional_field(
    "replaceInstructions",
    False,
    decode.bool,
  )
  use label <- decode.optional_field(
    "label",
    None,
    decode.map(decode.string, Some),
  )
  use raw <- decode.then(decode.dynamic)
  decode.success(TreePreparation(
    target_id:,
    old_leaf_id:,
    common_ancestor_id:,
    entries_to_summarize:,
    user_wants_summary:,
    custom_instructions:,
    replace_instructions:,
    label:,
    raw:,
  ))
}

fn session_before_tree_decoder() -> Decoder(SessionBeforeTree) {
  use preparation <- decode.field("preparation", tree_preparation_decoder())
  use _signal <- decode.field("signal", decode.dynamic)
  use raw <- decode.then(decode.dynamic)
  decode.success(SessionBeforeTree(preparation:, signal: signal(raw), raw:))
}

fn session_tree_decoder() -> Decoder(SessionTree) {
  use new_leaf_id <- decode.field("newLeafId", decode.optional(decode.string))
  use old_leaf_id <- decode.field("oldLeafId", decode.optional(decode.string))
  use summary_entry <- decode.optional_field(
    "summaryEntry",
    None,
    decode.map(session.entry_decoder(), Some),
  )
  use from_extension <- decode.optional_field(
    "fromExtension",
    False,
    decode.bool,
  )
  use raw <- decode.then(decode.dynamic)
  decode.success(SessionTree(
    new_leaf_id:,
    old_leaf_id:,
    summary_entry:,
    from_extension:,
    raw:,
  ))
}

pub fn session_start_reason_name(reason: SessionStartReason) -> String {
  case reason {
    StartStartup -> "startup"
    StartReload -> "reload"
    StartNew -> "new"
    StartResume -> "resume"
    StartFork -> "fork"
    StartUnknown(value) -> value
  }
}

pub fn session_shutdown_reason_name(reason: SessionShutdownReason) -> String {
  case reason {
    ShutdownQuit -> "quit"
    ShutdownReload -> "reload"
    ShutdownNew -> "new"
    ShutdownResume -> "resume"
    ShutdownFork -> "fork"
    ShutdownUnknown(value) -> value
  }
}

pub fn session_switch_reason_name(reason: SessionSwitchReason) -> String {
  case reason {
    SwitchNew -> "new"
    SwitchResume -> "resume"
    SwitchUnknown(value) -> value
  }
}

pub fn fork_position_name(position: ForkPosition) -> String {
  case position {
    ForkBefore -> "before"
    ForkAt -> "at"
    ForkPositionUnknown(value) -> value
  }
}

pub fn compaction_reason_name(reason: CompactionReason) -> String {
  case reason {
    CompactManual -> "manual"
    CompactThreshold -> "threshold"
    CompactOverflow -> "overflow"
    CompactUnknown(value) -> value
  }
}

pub fn before_agent_start_message_type_name(event: BeforeAgentStart) -> String {
  case event {
    BeforeAgentStartUser(..) -> "user"
    BeforeAgentStartCustom(..) -> "custom"
  }
}

fn session_start_reason(value: String) -> SessionStartReason {
  case value {
    "startup" -> StartStartup
    "reload" -> StartReload
    "new" -> StartNew
    "resume" -> StartResume
    "fork" -> StartFork
    value -> StartUnknown(value)
  }
}

fn session_shutdown_reason(value: String) -> SessionShutdownReason {
  case value {
    "quit" -> ShutdownQuit
    "reload" -> ShutdownReload
    "new" -> ShutdownNew
    "resume" -> ShutdownResume
    "fork" -> ShutdownFork
    value -> ShutdownUnknown(value)
  }
}

fn session_switch_reason(value: String) -> SessionSwitchReason {
  case value {
    "new" -> SwitchNew
    "resume" -> SwitchResume
    value -> SwitchUnknown(value)
  }
}

fn fork_position(value: String) -> ForkPosition {
  case value {
    "before" -> ForkBefore
    "at" -> ForkAt
    value -> ForkPositionUnknown(value)
  }
}

fn compaction_reason(value: String) -> CompactionReason {
  case value {
    "manual" -> CompactManual
    "threshold" -> CompactThreshold
    "overflow" -> CompactOverflow
    value -> CompactUnknown(value)
  }
}

fn tool_call_decoder() -> Decoder(ToolCall) {
  use tool_call_id <- decode.field("toolCallId", decode.string)
  use tool_name <- decode.field("toolName", decode.string)
  use input <- decode.field("input", decode.dynamic)
  use raw <- decode.then(decode.dynamic)
  decode.success(ToolCall(tool_call_id:, tool_name:, input:, raw:))
}

fn input_decoder() -> Decoder(Input) {
  use text <- decode.field("text", decode.string)
  use source <- decode.field("source", decode.string)
  use streaming_behavior <- decode.optional_field(
    "streamingBehavior",
    None,
    decode.map(decode.string, Some),
  )
  use images <- decode.optional_field(
    "images",
    [],
    decode.list(of: decode.dynamic),
  )
  use raw <- decode.then(decode.dynamic)
  decode.success(Input(text:, source:, streaming_behavior:, images:, raw:))
}

fn before_agent_start_decoder() -> Decoder(BeforeAgentStart) {
  use raw <- decode.then(decode.dynamic)
  use message_type <- decode.optional_field(
    "messageType",
    "user",
    decode.string,
  )
  use system_prompt <- decode.optional_field(
    "systemPrompt",
    None,
    decode.map(decode.string, Some),
  )
  case message_type {
    "custom" -> {
      use message <- decode.field("message", decode.dynamic)
      decode.success(BeforeAgentStartCustom(message:, system_prompt:, raw:))
    }
    _ -> {
      use prompt <- decode.optional_field("prompt", "", decode.string)
      use images <- decode.optional_field(
        "images",
        [],
        decode.list(of: decode.dynamic),
      )
      decode.success(BeforeAgentStartUser(
        prompt:,
        images:,
        system_prompt:,
        raw:,
      ))
    }
  }
}

fn turn_start_decoder() -> Decoder(TurnStart) {
  use index <- decode.field("turnIndex", decode.int)
  use timestamp <- decode.field("timestamp", decode.int)
  use raw <- decode.then(decode.dynamic)
  decode.success(TurnStart(index:, timestamp:, raw:))
}

fn provider_response_decoder() -> Decoder(ProviderResponse) {
  use status <- decode.field("status", decode.int)
  use headers <- decode.field("headers", decode.dynamic)
  use raw <- decode.then(decode.dynamic)
  decode.success(ProviderResponse(status:, headers:, raw:))
}

fn tool_execution_decoder() -> Decoder(ToolExecution) {
  use tool_call_id <- decode.field("toolCallId", decode.string)
  use tool_name <- decode.field("toolName", decode.string)
  use args <- decode.field("args", decode.dynamic)
  use raw <- decode.then(decode.dynamic)
  decode.success(ToolExecution(tool_call_id:, tool_name:, args:, raw:))
}
