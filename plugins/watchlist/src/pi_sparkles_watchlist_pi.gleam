import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/javascript/promise.{type Promise}
import gleam/list
import pi
import pi/event
import pi/schema.{Optional, Required}
import pi/tool
import pi_sparkles_watchlist as legacy
import pi_sparkles_watchlist/durable

pub type Control

@external(javascript, "./pi_sparkles_watchlist/effect/durable_control_ffi.mjs", "new_control")
fn new_control(
  invoke: pi.DurableToolInvoker,
  save: fn(String) -> Result(String, String),
  schedule: fn(String, String, Int, Bool) -> Result(String, String),
  cycle: fn(String, Int) -> Result(String, String),
  project: fn(String, String, String) -> Result(String, String),
  next_due: fn(Int, Int, Int) -> #(Int, Int),
) -> Control

@external(javascript, "./pi_sparkles_watchlist/effect/durable_control_ffi.mjs", "control_call")
fn call(
  control: Control,
  operation: String,
  input: Dynamic,
  signal: pi.AbortSignal,
) -> Promise(tool.ToolResult)

@external(javascript, "./pi_sparkles_watchlist/effect/durable_control_ffi.mjs", "discover")
fn discover(control: Control) -> Promise(Nil)

@external(javascript, "./pi_sparkles_watchlist/effect/durable_control_ffi.mjs", "close")
fn close(control: Control) -> Promise(Nil)

pub fn extension(api: pi.ExtensionApi) -> Promise(Nil) {
  use _ <- promise.await(legacy.extension(api))
  let control =
    new_control(
      pi.durable_tool_invoker(api),
      durable.admit_save,
      durable.admit_schedule,
      durable.cycle,
      durable.project,
      durable.next_due,
    )
  event.observe(api, event.session_start, fn(_, _) { discover(control) })
  event.observe(api, event.session_shutdown, fn(_, _) { close(control) })
  register(
    api,
    control,
    "watchlist_durable",
    "control",
    "Inspect or opt into remembering personal picks across chats with Pi Durable. action=status is read-only; enable requires userAccepted=true after the user accepts the offer. close pauses until reopened; disable also stops automatic reopening, retaining saved data. Optional directory is an exact absolute private path; the default reopens automatically in later Pi chats after acceptance.",
    "When a user discusses their watchlist or personal picks, check watchlist_durable status. If enabled, inspect watchlist_durable_snapshot for saved picks. If disabled, offer once: Shall I remember these picks across chats? Explain that optional CN checks run only while Pi is open. Wait for acceptance before enabling or scheduling; saving alone never starts polling.",
    schema.object([
      Required(
        "action",
        schema.string_enum(["status", "enable", "close", "disable"]),
      ),
      Optional("userAccepted", schema.boolean()),
      Optional("directory", schema.string()),
    ]),
  )
  register(
    api,
    control,
    "watchlist_durable_snapshot",
    "snapshot",
    "Inspect the user-owned saved snapshot and its store revision; return opt-in guidance while disabled",
    "Use saved picks in a new chat without fetching market data",
    schema.object([]),
  )
  register(
    api,
    control,
    "watchlist_durable_save",
    "save",
    "Save the exact watchlist_snapshot content-bound handoff using store revision compare-and-swap and a unique requestId. Does not schedule reviews or change existing pinned schedules",
    "Export watchlist_snapshot first, copy snapshotJson and snapshotSha256 exactly, inspect durable store revision, then save after opt-in",
    schema.object([
      Required("requestId", schema.string()),
      Required("expectedRevision", schema.integer()),
      Required("snapshotJson", schema.string()),
      Required("snapshotSha256", schema.string()),
    ]),
  )
  register(
    api,
    control,
    "watchlist_review_run",
    "run",
    "Run one bounded review of at most ten saved picks through the explicitly selected existing CN Eastmoney a_share quote tool. HK/US picks return track_partial. Failures and interrupted reads remain unknown; no fallback or trading judgment",
    "Require saved picks and the explicit provider/share class/request budget; check every receipt and source limit",
    review_schema(False),
  )
  register(
    api,
    control,
    "watchlist_review_schedule",
    "schedule",
    "After the user requests recurring checks, schedule 1–30 bounded reviews against an immutable saved snapshot. Fixed intervals of 1 hour–30 days, only while Pi owns the local store; restart skips missed intervals after one recovery review. No external notifications",
    "Ask the user to choose timing and count before scheduling; use explicit first due Unix milliseconds, interval, provider and maximum requests",
    review_schema(True),
  )
  register(
    api,
    control,
    "watchlist_review_status",
    "status",
    "Inspect durable tasks, next due time and latest receipts; silence does not prove no change",
    "Report checked, changed, cannot_check and track_partial picks separately",
    schema.object([]),
  )
  register(
    api,
    control,
    "watchlist_review_cancel",
    "cancel",
    "Cancel the exact durable review requestId, including owned source tasks; finished reviews retain their terminal status",
    "Use the requestId returned by run or schedule",
    schema.object([Required("requestId", schema.string())]),
  )
  promise.resolve(Nil)
}

fn register(
  api: pi.ExtensionApi,
  control: Control,
  name: String,
  operation: String,
  description: String,
  hint: String,
  parameters: schema.Schema,
) {
  tool.register(
    api,
    name,
    name,
    description,
    hint,
    tool.parameters(parameters, decode.dynamic),
    tool.Sequential,
    fn(_, input, signal, _, _) { call(control, operation, input, signal) },
  )
}

fn review_schema(recurring: Bool) -> schema.Schema {
  let common = [
    Required("requestId", schema.string()),
    Required("watchlist", schema.string()),
    Required("provider", schema.literal_string("eastmoney")),
    Required("shareClass", schema.literal_string("a_share")),
    Required("maximumRequestsPerReview", schema.integer()),
  ]
  case recurring {
    False -> schema.object(common)
    True ->
      schema.object(
        list.append(common, [
          Required("firstDueUnixMilliseconds", schema.integer()),
          Required("intervalMilliseconds", schema.integer()),
          Required("maximumReviews", schema.integer()),
        ]),
      )
  }
}
