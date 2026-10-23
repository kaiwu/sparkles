# pi_gleam

Gleam bindings for authoring extensions for the Pi coding agent.

`pi_gleam` targets JavaScript. Plugin logic stays in Gleam while small
JavaScript FFI modules adapt Pi's objects, callbacks, promises, optional values,
and plain result objects.

The package is under initial development, is not published to Hex yet, and is
tested against Pi `1.4.0`. The name is provisional until its Hex availability
is confirmed.

## Minimal extension

```gleam
import gleam/javascript/promise.{type Promise}
import pi
import pi/context
import pi/ui

pub fn extension(api: pi.ExtensionApi) -> Promise(Nil) {
  pi.register_command(api, "hello", "Say hello", fn(_args, ctx) {
    ui.notify(context.ui(ctx), "Hello from Gleam!", ui.Info)
    promise.resolve(Nil)
  })

  promise.resolve(Nil)
}
```

Gleam emits `extension` as a named ES module export. A builder must compile the
package, create a default-export adapter, and bundle it for Pi. The root
`pi-sparkles` builder implements that contract; Hex itself only distributes the
source package.

## Typed tool example

```gleam
import gleam/dynamic/decode
import gleam/javascript/promise
import gleam/json
import pi/schema
import pi/tool

pub type Input {
  Input(name: String)
}

let parameters =
  tool.parameters(
    schema.object([
      schema.Required("name", schema.string()),
    ]),
    {
      use name <- decode.field("name", decode.string)
      decode.success(Input(name:))
    },
  )

tool.register(
  api,
  "hello",
  "Hello",
  "Greet a person",
  "Greet a person by name",
  parameters,
  tool.DefaultExecution,
  fn(_id, input, _signal, _updates, _ctx) {
    tool.text_result("Hello, " <> input.name <> "!", json.null())
    |> promise.resolve
  },
)
```

`Parameters(a)` pairs Pi's runtime JSON Schema with a Gleam decoder. The raw
arguments are decoded before the typed callback runs. Decode failures reject
the JavaScript promise and are reported by Pi as tool failures.

## Modules and coverage

| Module | Public coverage |
| --- | --- |
| `pi` | opaque runtime types; commands; shortcuts; Boolean/string flags; user/custom messages; session name and labels; active tools; raw tool/command discovery; thinking/model/provider methods; event bus; `exec` |
| `pi/context` | mode, cwd, UI access, trust/idle/abort/pending state, shutdown/compact, prompt/context usage, scoped models, wait/new/fork/tree/switch/reload command operations |
| `pi/event` | constants for Pi 1.4.0 events including `before_agent_start` user/custom runs, `agent_before_settle`, `session_compact_failed`, and `context_with_system`; generic and decoder-backed observe/respond registration; typed lifecycle, tool call, input, turn start, provider response, and tool-execution-start helpers; lifecycle/tool/input result builders |
| `pi/event_bus` | extension-to-extension emit, subscribe, and unsubscribe |
| `pi/session` | read-only session metadata; all, branch, and compacted-context entries; decoder-backed extension custom-state restoration |
| `pi/schema` | primitive, object, record, tuple, array, union, nullable, enum, constraint, metadata, and raw JSON schemas |
| `pi/tool` | schema/decoder parameters; execution modes; text/image content; results; incremental updates; abort checks; rejected failures |
| `pi/ui` | notifications, select/confirm/input, status and working indicators, widgets, editor operations, themes, and expanded-tool state |
| `pi/raw` | dynamic conversion, object construction/access/calls, promise conversion, generic events, raw tools, message/entry renderers, and markdown transformers |

The package promises complete **reachability**, not that every JavaScript shape
is already represented by a dedicated Gleam type. Use typed modules for normal
authoring and `pi/raw` for advanced Pi surfaces while typed coverage evolves.
Raw calls trade compile-time guarantees for immediate access and should be
isolated in a small adapter module with boundary tests.

## Event handling

Use typed helpers when one exists:

```gleam
event.on_tool_call(api, fn(call, ctx) {
  // Return Some(event.block_tool(...)) to block, or None to continue.
})
```

For another event, either supply a decoder with `observe_decoded` or
`respond_decoded`, or use `observe`/`respond` and inspect its raw `Dynamic`
value. Result builders construct Pi's required plain JavaScript shapes. `None`
from a responder becomes JavaScript `undefined`.

## Lifecycle and persistent state

Pi replaces the extension runtime during `/reload`, `/new`, `/resume`, and
`/fork`. The old instance receives `session_shutdown`; the new instance then
receives `session_start` with a fresh context. A plugin must not retain a
context or session manager across that boundary.

Use `pi.append_entry` to persist extension-owned state and restore it from the
new callback context:

```gleam
import gleam/dynamic/decode
import gleam/javascript/promise
import pi/event
import pi/session

event.on_session_start(api, fn(start, ctx) {
  let _restored =
    session.latest_custom_entry(
      session.manager(ctx),
      "my_plugin.state",
      decode.int,
    )

  // Rebuild session-scoped state from `restored`. A matching malformed entry
  // is an Error and must not be silently treated as an empty session.
  promise.resolve(Nil)
})

event.on_session_shutdown(api, fn(shutdown, _ctx) {
  // Close resources idempotently. Do not append replacement-session state
  // after cleanup has begun.
  promise.resolve(Nil)
})
```

`pi/session` exposes all persisted entries, the active branch, and the active
compaction-aware context entries. Entry-specific host fields remain available
through each entry's `raw` value. Custom state is decoded with a caller-supplied
decoder before it reaches plugin logic.

Typed lifecycle helpers cover session start, metadata changes, switch/fork
decisions, compaction, tree navigation, and shutdown. Unknown future reason
strings remain observable through explicit `Unknown` constructors. Custom
compaction and branch-summary builders create the plain JavaScript result
objects required by Pi.

See `plugins/lifecycle` for an executable restoration and idempotent-cleanup
example, including boundary fixtures for every session replacement reason.

## Remaining typed binding work

The Pi `0.83.0` audit found no extension API object that is unreachable: an
extension can use `pi/raw` for every current `ExtensionAPI` and context method.
That is different from complete typed coverage. Pi currently publishes 33
extension events; all event names are exposed, but only 14 have dedicated typed
helpers. The remaining work is therefore typed modeling, runtime decoding, and
contract tests rather than a prerequisite for starting ordinary plugins.

### Recommended next slice

The first finance plugins should drive a focused Phase 4A:

1. type `project_trust` with its deliberately restricted context and type
   `resources_discover` with its files and system-prompt additions;
2. add shared text, image, message, token-usage, and tool-result records;
3. type `before_agent_start` and `tool_result`, including their replacement
   result shapes;
4. add `ExecOptions` for working directory, timeout, and cancellation;
5. replace raw tool, command, model, theme, and provider inspection values with
   decoded records; and
6. support Pi's complete user/custom-message content forms instead of only the
   current convenience strings.

That slice enables setup, guardrail, source-ledger, and research-orchestration
plugins without first modeling the whole TUI.

### Event and message backlog

- Startup and resources: restricted `project_trust` decisions and typed
  `resources_discover` results.
- Agent lifecycle: context preparation, provider request/body/header mutation,
  agent start/end/settled, turn end, message start/update/end, tool execution
  update/end, model/thinking selection, user shell commands, and tool results.
- Shared payloads: assistant/user/tool messages, text and image blocks, usage,
  stop reasons, provider errors, and complete compaction payloads.
- Rich sends: every `sendMessage` and `sendUserMessage` content form, delivery
  mode, and attribution field supported by Pi.

Generic decoded responders remain the migration path for these events. A new
typed helper is complete only when its input and output shapes have Bun boundary
fixtures for valid, optional, malformed, callback, and promise behavior.

### Tools, commands, and sessions

- Tools still need typed prompt guidelines, constrained sampling,
  `prepareArguments`, shell rendering, result-details types, and renderers.
- `exec` still needs typed cwd, timeout, and `AbortSignal` options.
- Command contexts still need structured cancellation, system-prompt options,
  complete `newSession` setup/parent options, `withSession`, and full tree
  navigation options.
- Session inspection still needs the complete entry union, session header,
  lookup and label APIs, tree data, and per-entry message/compaction fields.
  Current entries intentionally retain their raw host value for these fields.
- Model/provider work includes typed model and scoped-model records, the model
  registry and authentication state, provider configuration, and OAuth flows.

### UI, renderers, and module exports

- Dialog cancellation/timeouts, raw terminal input, working-indicator state,
  component widgets, custom header/footer, autocomplete, custom editors, and
  typed theme results remain raw.
- Message, tool-result, and markdown renderer contracts need dedicated typed
  wrappers and output builders.
- Schema coverage should grow with real provider payloads, especially reusable
  constrained numeric/string helpers and documented JSON-schema compatibility.
- Pi also exports utilities outside `ExtensionAPI`: session discovery helpers,
  built-in tool factories, remote-operation and truncation helpers, TUI
  components/editors, themes, keybindings, and autocomplete. A plugin can reach
  these only through its own JavaScript FFI today; `pi/raw` wraps runtime
  objects, not arbitrary module-level imports.

### Known type-safety edges

The following current APIs are usable but should not be mistaken for verified
typed boundaries:

- Generic event registration types every callback context as the full
  `Context`; Pi intentionally gives `project_trust` a smaller context. Do not
  call ordinary context methods from that event until its restricted wrapper
  exists.
- Pi may omit a tool's abort signal and update callback. Current opaque callback
  parameters tolerate `undefined` in FFI helpers, but their Gleam signatures do
  not yet express optionality.
- `get_all_tools`, `get_commands`, `get_scoped_models`, `get_all_themes`, theme
  setters, and provider configuration return unchecked dynamic values or
  arrays.
- Session and navigation wrappers expose only the stable subset audited for
  Phase 2; preserve and isolate the raw entry/context when advanced fields are
  needed.

Typed breadth should be added demand-first. Each addition must record the Pi
version studied and keep `pi/raw` available so newer host fields remain
observable between binding releases.

## Design rules

- Pi-owned objects are opaque types; plugin-owned data uses normal Gleam types.
- Typed tools and typed events decode external values at runtime.
- The binding is the effect boundary. Plugin domain modules should not import
  `pi`, promises, or JavaScript FFI; a thin root adapter decodes host values,
  invokes pure domain functions, and interprets their typed decisions.
- Pi callbacks may share one isolated store containing an immutable Gleam state
  value. Business transitions belong in pure Gleam functions, never the store's
  mutable FFI.
- `Option` is used for JavaScript optional values where a typed wrapper exists.
- Tool errors become rejected promises rather than successful error-looking
  content.
- Tool and event results are built in FFI so Gleam constructors never leak into
  Pi.
- UI-dependent code must check `context.has_ui` and define non-TUI behavior.
- The raw layer is explicit and remains available across Pi API additions.

See the repository's `FUNCTIONAL_DESIGN.md` for capability injection, effects
as data, state reducers, composition, and law-oriented testing rules.

## Package and build model

A plugin's publishable `gleam.toml` should eventually use a normal Hex
constraint:

```toml
[dependencies]
pi_gleam = ">= 0.1.0 and < 1.0.0"
```

Local reference plugins currently use a path dependency because `pi_gleam` has
not been published. Gleam will not publish that manifest, by design. The binding
must be released first; then plugins can publish source to Hex and consumers can
build those sources into Pi artifacts with Gleam and Bun.

The package's own `gleam export hex-tarball` succeeds and includes its Gleam and
JavaScript FFI sources. No compiled Pi extension belongs in this Hex package.

## Compatibility policy

The initial code is tested against Pi `0.83.0`. Every typed addition should have
a JavaScript boundary contract test and record the Pi version whose API was
studied. Pi additions remain accessible through `pi/raw`; breaking Pi changes
may require a new binding release.

See `plugins/hello` for command/tool registration, `plugins/safety_gate` for a
typed result-bearing event with asynchronous UI and a non-UI fail-safe, and
`plugins/lifecycle` for persistent state and lifecycle-safe cleanup.
