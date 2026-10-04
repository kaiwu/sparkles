import finance_core/identifier
import finance_track
import finance_track/context as track_context
import finance_track/json as track_json
import gleam/dynamic/decode
import gleam/javascript/promise.{type Promise}
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import pi
import pi/context
import pi/event
import pi/raw
import pi/schema
import pi/session
import pi/tool
import pi/ui
import pi_sparkles_watchlist/effect/store
import pi_sparkles_watchlist/watchlist

const event_entry_type = "pi_sparkles_watchlist.event.v1"

pub type AddInput {
  AddInput(watchlist: String, member: watchlist.MemberInput)
}

pub type RemoveInput {
  RemoveInput(watchlist: String, identity: watchlist.IdentityInput)
}

pub type SnapshotInput {
  SnapshotInput(watchlist: Option(String))
}

pub fn extension(api: pi.ExtensionApi) -> Promise(Nil) {
  let runtime = store.new(None)

  event.on_session_start(api, fn(_start, ctx) {
    restore(runtime, ctx)
    promise.resolve(Nil)
  })
  event.on_session_tree(api, fn(_tree, ctx) {
    restore(runtime, ctx)
    promise.resolve(Nil)
  })

  pi.register_command(
    api,
    "watch",
    "Show all saved watchlists or one exact lowercase watchlist name",
    fn(args, ctx) {
      let selected = case string.trim(args) {
        "" -> None
        value -> Some(value)
      }
      case current(runtime) {
        Error(message) -> notify(ctx, message, ui.Error)
        Ok(state) ->
          case watchlist.selected(state, selected) {
            Error(error) ->
              notify(
                ctx,
                "Watchlist snapshot rejected: " <> string.inspect(error),
                ui.Error,
              )
            Ok(values) -> notify(ctx, watchlist.render(state, values), ui.Info)
          }
      }
      promise.resolve(Nil)
    },
  )

  tool.register(
    api,
    "watchlist_add",
    "Add or update watchlist member",
    "Persist one exact track-scoped listing in a named session-branch watchlist; the listing identity remains caller-declared and unverified",
    "Use a namespaced instrumentId such as figi:BBG... and preserve the exact cn, hk, or us track, symbol, and MIC",
    tool.parameters(add_schema(), add_decoder()),
    tool.Sequential,
    fn(_id, input, _signal, _updates, _ctx) {
      case current(runtime) {
        Error(message) -> tool.reject(message)
        Ok(state) ->
          case watchlist.add(state, input.watchlist, input.member) {
            Error(error) -> reject_mutation(error)
            Ok(#(next, change)) -> {
              let member = change_member(change)
              let persisted = next != state
              case persisted {
                True -> {
                  let event =
                    watchlist.event_for_add(next, input.watchlist, member)
                  pi.append_entry(
                    api,
                    event_entry_type,
                    raw.dynamic(watchlist.encode_event(event)),
                  )
                  store.write(runtime, Some(Ok(next)))
                }
                False -> Nil
              }
              tool.text_result(
                mutation_text(change, input.watchlist, next),
                mutation_details(
                  next,
                  input.watchlist,
                  change,
                  persisted,
                  member,
                ),
              )
              |> promise.resolve
            }
          }
      }
    },
  )

  tool.register(
    api,
    "watchlist_remove",
    "Remove watchlist member",
    "Remove only the exact track, namespaced instrument ID, symbol, and MIC key from a named session-branch watchlist",
    "Never remove by symbol alone; repeat the complete stored listing key",
    tool.parameters(remove_schema(), remove_decoder()),
    tool.Sequential,
    fn(_id, input, _signal, _updates, _ctx) {
      case current(runtime) {
        Error(message) -> tool.reject(message)
        Ok(state) ->
          case watchlist.remove(state, input.watchlist, input.identity) {
            Error(error) -> reject_mutation(error)
            Ok(#(next, change)) -> {
              let member = change_member(change)
              let event =
                watchlist.event_for_remove(next, input.watchlist, member)
              pi.append_entry(
                api,
                event_entry_type,
                raw.dynamic(watchlist.encode_event(event)),
              )
              store.write(runtime, Some(Ok(next)))
              tool.text_result(
                mutation_text(change, input.watchlist, next),
                mutation_details(next, input.watchlist, change, True, member),
              )
              |> promise.resolve
            }
          }
      }
    },
  )

  tool.register(
    api,
    "watchlist_snapshot",
    "Export watchlist snapshot",
    "Return a deterministic versioned snapshot of all branch-scoped watchlists or one exact named watchlist without fetching market data",
    "Use the snapshot as user-owned workflow state; every member retains its own cn, hk, or us track",
    tool.parameters(snapshot_schema(), snapshot_decoder()),
    tool.Parallel,
    fn(_id, input, _signal, _updates, _ctx) {
      case current(runtime) {
        Error(message) -> tool.reject(message)
        Ok(state) ->
          case watchlist.selected(state, input.watchlist) {
            Error(error) ->
              tool.reject(
                "Watchlist snapshot rejected: " <> string.inspect(error),
              )
            Ok(values) ->
              case watchlist.snapshot_handoff_json(state, values) {
                Error(message) -> tool.reject(message)
                Ok(details) ->
                  tool.text_result(watchlist.render(state, values), details)
                  |> promise.resolve
              }
          }
      }
    },
  )

  promise.resolve(Nil)
}

fn restore(
  runtime: store.Store(Option(Result(watchlist.State, String))),
  ctx: pi.Context,
) -> Nil {
  let restored =
    session.custom_entries(
      session.manager(ctx),
      event_entry_type,
      decode.string,
    )
  case restored {
    Error(_) ->
      lock(runtime, ctx, "Watchlist event entries could not be decoded")
    Ok(entries) ->
      case payloads(entries, []) {
        Error(message) -> lock(runtime, ctx, message)
        Ok(events) ->
          case watchlist.replay(events) {
            Error(error) ->
              lock(
                runtime,
                ctx,
                "Watchlist event replay failed: " <> string.inspect(error),
              )
            Ok(state) -> store.write(runtime, Some(Ok(state)))
          }
      }
  }
}

fn payloads(
  entries: List(session.CustomEntry(String)),
  reversed: List(String),
) -> Result(List(String), String) {
  case entries {
    [] -> Ok(list.reverse(reversed))
    [entry, ..rest] ->
      case entry.data {
        None -> Error("Watchlist event entry has no payload")
        Some(value) -> payloads(rest, [value, ..reversed])
      }
  }
}

fn lock(
  runtime: store.Store(Option(Result(watchlist.State, String))),
  ctx: pi.Context,
  message: String,
) -> Nil {
  store.write(runtime, Some(Error(message)))
  notify(
    ctx,
    message <> "; watchlist mutations are disabled on this branch",
    ui.Error,
  )
}

fn current(
  runtime: store.Store(Option(Result(watchlist.State, String))),
) -> Result(watchlist.State, String) {
  case store.read(runtime) {
    None -> Error("Watchlist state is not initialized for this session")
    Some(Error(message)) ->
      Error(message <> "; watchlist mutations are disabled on this branch")
    Some(Ok(state)) -> Ok(state)
  }
}

fn reject_mutation(error: watchlist.Error) -> Promise(value) {
  tool.reject("Watchlist mutation rejected: " <> string.inspect(error))
}

fn change_member(change: watchlist.Change) -> watchlist.Member {
  case change {
    watchlist.Added(member)
    | watchlist.Updated(member)
    | watchlist.Unchanged(member)
    | watchlist.Removed(member) -> member
  }
}

fn change_name(change: watchlist.Change) -> String {
  case change {
    watchlist.Added(_) -> "added"
    watchlist.Updated(_) -> "updated"
    watchlist.Unchanged(_) -> "unchanged"
    watchlist.Removed(_) -> "removed"
  }
}

fn mutation_text(
  change: watchlist.Change,
  list_name: String,
  state: watchlist.State,
) -> String {
  let member = change_member(change)
  "Watchlist "
  <> list_name
  <> " "
  <> change_name(change)
  <> " "
  <> finance_track.name(watchlist.member_track(member))
  <> ":"
  <> watchlist.member_mic(member)
  <> ":"
  <> watchlist.member_symbol(member)
  <> " revision="
  <> string.inspect(watchlist.revision(state))
}

fn mutation_details(
  state: watchlist.State,
  list_name: String,
  change: watchlist.Change,
  persisted: Bool,
  member: watchlist.Member,
) -> json.Json {
  let context = result_context(member)
  json.object(
    list.append(track_json.result_fields(context), [
      #("action", json.string(change_name(change))),
      #("persisted", json.bool(persisted)),
      #("watchlist", json.string(list_name)),
      #("revision", json.int(watchlist.revision(state))),
      #("member", member_json(member)),
      #("persistence", json.string("session_branch_versioned_event_log")),
      #("identityStatus", json.string("caller_declared_unverified")),
    ]),
  )
}

fn member_json(member: watchlist.Member) -> json.Json {
  json.object([
    #(
      "track",
      member |> watchlist.member_track |> finance_track.name |> json.string,
    ),
    #("instrumentId", member |> watchlist.member_instrument_id |> json.string),
    #("symbol", member |> watchlist.member_symbol |> json.string),
    #("mic", member |> watchlist.member_mic |> json.string),
    #("note", json.nullable(watchlist.member_note(member), json.string)),
    #(
      "thesisLink",
      json.nullable(watchlist.member_thesis_link(member), json.string),
    ),
    #("tags", json.array(watchlist.member_tags(member), json.string)),
  ])
}

fn result_context(member: watchlist.Member) -> track_context.Context {
  let track = watchlist.member_track(member)
  let assert Ok(mic) = identifier.mic(watchlist.member_mic(member))
  let assert Ok(value) =
    track_context.new(
      track: track,
      market_scope: finance_track.name(track) <> "_watchlist",
      venue_mic: Some(mic),
      board: None,
      timezone: None,
      source_language: "und",
      providers: ["user_input"],
      entitlement: "user_owned",
      limitations: [
        "caller_declared_identity_unverified",
        "session_branch_persistence",
      ],
    )
  value
}

fn add_schema() -> schema.Schema {
  schema.object([
    schema.Required("watchlist", bounded_string(1, 40)),
    schema.Required("track", schema.string_enum(["cn", "hk", "us"])),
    schema.Required("instrumentId", bounded_string(3, 200)),
    schema.Required("symbol", bounded_string(1, 32)),
    schema.Required("mic", bounded_string(4, 4)),
    schema.Optional("note", schema.nullable(bounded_string(1, 500))),
    schema.Optional("thesisLink", schema.nullable(bounded_string(8, 1000))),
    schema.Optional(
      "tags",
      schema.array(bounded_string(1, 32)) |> schema.with_array_length(0, 20),
    ),
  ])
}

fn remove_schema() -> schema.Schema {
  schema.object([
    schema.Required("watchlist", bounded_string(1, 40)),
    schema.Required("track", schema.string_enum(["cn", "hk", "us"])),
    schema.Required("instrumentId", bounded_string(3, 200)),
    schema.Required("symbol", bounded_string(1, 32)),
    schema.Required("mic", bounded_string(4, 4)),
  ])
}

fn snapshot_schema() -> schema.Schema {
  schema.object([
    schema.Optional("watchlist", schema.nullable(bounded_string(1, 40))),
  ])
}

fn bounded_string(minimum: Int, maximum: Int) -> schema.Schema {
  schema.string() |> schema.with_string_length(minimum, maximum)
}

fn add_decoder() -> decode.Decoder(AddInput) {
  use watchlist_name <- decode.field("watchlist", decode.string)
  use track <- decode.field("track", track_decoder())
  use instrument_id <- decode.field("instrumentId", decode.string)
  use symbol <- decode.field("symbol", decode.string)
  use mic <- decode.field("mic", decode.string)
  use note <- optional_string("note")
  use thesis_link <- optional_string("thesisLink")
  use tags <- decode.optional_field("tags", [], decode.list(of: decode.string))
  decode.success(AddInput(
    watchlist_name,
    watchlist.MemberInput(
      track,
      instrument_id,
      symbol,
      mic,
      note,
      thesis_link,
      tags,
    ),
  ))
}

fn remove_decoder() -> decode.Decoder(RemoveInput) {
  use watchlist_name <- decode.field("watchlist", decode.string)
  use track <- decode.field("track", track_decoder())
  use instrument_id <- decode.field("instrumentId", decode.string)
  use symbol <- decode.field("symbol", decode.string)
  use mic <- decode.field("mic", decode.string)
  decode.success(RemoveInput(
    watchlist_name,
    watchlist.IdentityInput(track, instrument_id, symbol, mic),
  ))
}

fn snapshot_decoder() -> decode.Decoder(SnapshotInput) {
  use name <- optional_string("watchlist")
  decode.success(SnapshotInput(name))
}

fn optional_string(
  name: String,
  next: fn(Option(String)) -> decode.Decoder(value),
) -> decode.Decoder(value) {
  decode.optional_field(name, None, decode.optional(decode.string), next)
}

fn track_decoder() -> decode.Decoder(finance_track.Track) {
  decode.string
  |> decode.then(fn(value) {
    case finance_track.from_name(value) {
      Ok(track) -> decode.success(track)
      Error(_) -> decode.failure(finance_track.Us, "cn, hk, or us track")
    }
  })
}

fn notify(ctx: pi.Context, message: String, kind: ui.Notification) -> Nil {
  case context.has_ui(ctx) {
    True -> ui.notify(context.ui(ctx), message, kind)
    False -> Nil
  }
}
