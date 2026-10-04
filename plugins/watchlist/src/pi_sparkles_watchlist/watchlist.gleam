import finance_core/identifier
import finance_listing/listing
import finance_provenance/hash
import finance_provenance/identity
import finance_track.{type Track}
import gleam/dynamic/decode
import gleam/json.{type Json}
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/order.{type Order}
import gleam/result
import gleam/string

pub const schema_version = 1

const maximum_watchlists = 20

const maximum_members_per_watchlist = 200

const maximum_total_members = 1000

const maximum_revision = 10_000

pub type MemberInput {
  MemberInput(
    track: Track,
    instrument_id: String,
    symbol: String,
    mic: String,
    note: Option(String),
    thesis_link: Option(String),
    tags: List(String),
  )
}

pub type IdentityInput {
  IdentityInput(
    track: Track,
    instrument_id: String,
    symbol: String,
    mic: String,
  )
}

pub opaque type Member {
  Member(
    key: listing.Key,
    note: Option(String),
    thesis_link: Option(String),
    tags: List(String),
  )
}

pub opaque type Named {
  Named(name: String, members: List(Member))
}

pub opaque type State {
  State(revision: Int, watchlists: List(Named))
}

pub type Change {
  Added(member: Member)
  Updated(member: Member)
  Unchanged(member: Member)
  Removed(member: Member)
}

pub type MutationEvent {
  AddEvent(revision: Int, watchlist: String, member: MemberInput)
  RemoveEvent(revision: Int, watchlist: String, identity: IdentityInput)
}

pub type Error {
  InvalidWatchlistName
  InvalidInstrumentId
  InvalidSymbol
  InvalidMic
  TrackMicMismatch(track: String, mic: String)
  InvalidTrackSymbol(track: String, symbol: String)
  InvalidNote
  InvalidThesisLink
  InvalidTag(tag: String)
  DuplicateTag(tag: String)
  TooManyWatchlists
  TooManyMembers(watchlist: String)
  TooManyTotalMembers
  RevisionExhausted
  WatchlistNotFound(name: String)
  MemberNotFound(key: String)
}

pub type ReplayError {
  InvalidEventJson
  NonContiguousRevision(expected: Int, received: Int)
  InvalidEvent(Error)
  EventDidNotMutate
}

pub fn empty() -> State {
  State(0, [])
}

pub fn revision(state: State) -> Int {
  state.revision
}

pub fn watchlists(state: State) -> List(Named) {
  state.watchlists
}

pub fn watchlist_name(value: Named) -> String {
  value.name
}

pub fn watchlist_members(value: Named) -> List(Member) {
  value.members
}

pub fn member_track(value: Member) -> Track {
  value.key |> listing.track
}

pub fn member_instrument_id(value: Member) -> String {
  value.key |> listing.instrument_id |> identifier.instrument_id_value
}

pub fn member_symbol(value: Member) -> String {
  value.key |> listing.symbol |> identifier.symbol_value
}

pub fn member_mic(value: Member) -> String {
  value.key |> listing.mic |> identifier.mic_value
}

pub fn member_note(value: Member) -> Option(String) {
  value.note
}

pub fn member_thesis_link(value: Member) -> Option(String) {
  value.thesis_link
}

pub fn member_tags(value: Member) -> List(String) {
  value.tags
}

pub fn member_key(value: Member) -> String {
  identity_key(
    member_track(value),
    member_instrument_id(value),
    member_symbol(value),
    member_mic(value),
  )
}

pub fn total_members(state: State) -> Int {
  state.watchlists
  |> list.fold(0, fn(total, named) { total + list.length(named.members) })
}

pub fn add(
  state: State,
  watchlist watchlist_name: String,
  member input: MemberInput,
) -> Result(#(State, Change), Error) {
  use _ <- result.try(validate_watchlist_name(watchlist_name))
  use member <- result.try(build_member(input))
  use #(watchlists, change) <- result.try(add_to_watchlists(
    state,
    watchlist_name,
    member,
  ))
  case change {
    Unchanged(_) -> Ok(#(state, change))
    _ -> next_state(state, watchlists, change)
  }
}

pub fn remove(
  state: State,
  watchlist watchlist_name: String,
  identity identity_input: IdentityInput,
) -> Result(#(State, Change), Error) {
  use _ <- result.try(validate_watchlist_name(watchlist_name))
  use key <- result.try(build_key(identity_input))
  use #(watchlists, removed) <- result.try(remove_from_watchlists(
    state.watchlists,
    watchlist_name,
    listing_key(key),
  ))
  next_state(state, watchlists, Removed(removed))
}

pub fn selected(
  state: State,
  watchlist name: Option(String),
) -> Result(List(Named), Error) {
  case name {
    None -> Ok(state.watchlists)
    Some(name) -> {
      use _ <- result.try(validate_watchlist_name(name))
      case find_watchlist(state.watchlists, name) {
        Some(value) -> Ok([value])
        None -> Error(WatchlistNotFound(name))
      }
    }
  }
}

pub fn event_for_add(
  state: State,
  watchlist: String,
  member: Member,
) -> MutationEvent {
  AddEvent(state.revision, watchlist, member_input(member))
}

pub fn event_for_remove(
  state: State,
  watchlist: String,
  member: Member,
) -> MutationEvent {
  RemoveEvent(state.revision, watchlist, identity_input(member))
}

pub fn encode_event(event: MutationEvent) -> String {
  event |> event_json |> json.to_string
}

pub fn decode_event(input: String) -> Result(MutationEvent, ReplayError) {
  input
  |> json.parse(event_decoder())
  |> result.map_error(fn(_) { InvalidEventJson })
}

pub fn replay(encoded_events: List(String)) -> Result(State, ReplayError) {
  replay_events(encoded_events, empty())
}

pub fn snapshot_json(state: State, selected_watchlists: List(Named)) -> Json {
  json.object(snapshot_fields(state, selected_watchlists))
}

fn snapshot_fields(
  state: State,
  selected_watchlists: List(Named),
) -> List(#(String, Json)) {
  [
    #("schemaVersion", json.int(schema_version)),
    #("revision", json.int(state.revision)),
    #("persistence", json.string("session_branch_versioned_event_log")),
    #("identityStatus", json.string("caller_declared_unverified")),
    #("durability", json.string("resume_and_inherited_forks")),
    #("crossSessionPersistence", json.string("not_provided")),
    #("maximumWatchlists", json.int(maximum_watchlists)),
    #("maximumMembersPerWatchlist", json.int(maximum_members_per_watchlist)),
    #("maximumTotalMembers", json.int(maximum_total_members)),
    #("maximumRevision", json.int(maximum_revision)),
    #("watchlists", json.array(selected_watchlists, named_json)),
  ]
}

pub fn snapshot_handoff_json(
  state: State,
  selected_watchlists: List(Named),
) -> Result(Json, String) {
  let encoded = encode_snapshot(state, selected_watchlists)
  use digest <- result.try(
    hash.text(encoded) |> result.map_error(fn(_) { "snapshot_hash_failed" }),
  )
  Ok(
    json.object(
      list.append(snapshot_fields(state, selected_watchlists), [
        #("snapshotJson", json.string(encoded)),
        #("snapshotSha256", json.string(identity.sha256_value(digest))),
        #(
          "snapshotIntegrity",
          json.string("content_bound_not_identity_authenticated"),
        ),
      ]),
    ),
  )
}

pub fn encode_snapshot(
  state: State,
  selected_watchlists: List(Named),
) -> String {
  state |> snapshot_json(selected_watchlists) |> json.to_string
}

/// Admit a complete exported snapshot using the same identity and bounds laws
/// as ordinary mutations. Duplicate names/keys are rejected, never merged.
pub fn decode_snapshot(input: String) -> Result(State, String) {
  use #(version, revision, values) <- result.try(
    json.parse(input, snapshot_decoder())
    |> result.map_error(fn(_) { "invalid_watchlist_snapshot" }),
  )
  case
    version == schema_version && revision >= 0 && revision <= maximum_revision
  {
    False -> Error("invalid_watchlist_snapshot_version_or_revision")
    True -> {
      use state <- result.try(snapshot_named(values, empty()))
      Ok(State(revision, state.watchlists))
    }
  }
}

fn snapshot_decoder() -> decode.Decoder(
  #(Int, Int, List(#(String, List(MemberInput)))),
) {
  use version <- decode.field("schemaVersion", decode.int)
  use revision <- decode.field("revision", decode.int)
  use values <- decode.field("watchlists", decode.list(named_decoder()))
  decode.success(#(version, revision, values))
}

fn named_decoder() -> decode.Decoder(#(String, List(MemberInput))) {
  use name <- decode.field("name", decode.string)
  use members <- decode.field("members", decode.list(member_input_decoder()))
  decode.success(#(name, members))
}

fn snapshot_named(
  values: List(#(String, List(MemberInput))),
  state: State,
) -> Result(State, String) {
  case values {
    [] -> Ok(state)
    [#(name, members), ..rest] -> {
      use _ <- result.try(
        validate_watchlist_name(name)
        |> result.map_error(fn(_) { "invalid_watchlist_name" }),
      )
      case find_watchlist(state.watchlists, name), members {
        Some(_), _ -> Error("duplicate_watchlist_name")
        _, [] -> Error("empty_watchlist_snapshot_member_list")
        None, _ -> {
          use next <- result.try(snapshot_members(members, name, state))
          snapshot_named(rest, next)
        }
      }
    }
  }
}

fn snapshot_members(
  values: List(MemberInput),
  name: String,
  state: State,
) -> Result(State, String) {
  case values {
    [] -> Ok(state)
    [member, ..rest] -> {
      use built <- result.try(
        build_member(member)
        |> result.map_error(fn(_) { "invalid_watchlist_member" }),
      )
      case
        find_watchlist(state.watchlists, name)
        |> option.then(fn(named) {
          find_member(named.members, member_key(built))
        })
      {
        Some(_) -> Error("duplicate_watchlist_member")
        None -> {
          use #(next, _) <- result.try(
            add(state, name, member)
            |> result.map_error(fn(_) { "watchlist_snapshot_bounds_exceeded" }),
          )
          snapshot_members(rest, name, next)
        }
      }
    }
  }
}

pub fn render(state: State, selected_watchlists: List(Named)) -> String {
  let header =
    "Watchlists revision="
    <> int_string(state.revision)
    <> " persistence=session_branch_versioned_event_log"
  case selected_watchlists {
    [] -> header <> "\n(empty)"
    values ->
      header
      <> "\n"
      <> {
        values
        |> list.map(render_named)
        |> string.join("\n")
      }
  }
}

fn next_state(
  state: State,
  watchlists: List(Named),
  change: Change,
) -> Result(#(State, Change), Error) {
  case state.revision >= maximum_revision {
    True -> Error(RevisionExhausted)
    False ->
      Ok(#(
        State(state.revision + 1, list.sort(watchlists, by: compare_named)),
        change,
      ))
  }
}

fn add_to_watchlists(
  state: State,
  name: String,
  member: Member,
) -> Result(#(List(Named), Change), Error) {
  case find_watchlist(state.watchlists, name) {
    None ->
      case list.length(state.watchlists) >= maximum_watchlists {
        True -> Error(TooManyWatchlists)
        False ->
          case total_members(state) >= maximum_total_members {
            True -> Error(TooManyTotalMembers)
            False ->
              Ok(#([Named(name, [member]), ..state.watchlists], Added(member)))
          }
      }
    Some(named) -> {
      let existing = find_member(named.members, member_key(member))
      case existing {
        Some(current) ->
          case same_member(current, member) {
            True -> Ok(#(state.watchlists, Unchanged(current)))
            False ->
              Ok(#(
                replace_watchlist(
                  state.watchlists,
                  Named(name, replace_member(named.members, member)),
                ),
                Updated(member),
              ))
          }
        None ->
          case
            list.length(named.members) >= maximum_members_per_watchlist,
            total_members(state) >= maximum_total_members
          {
            True, _ -> Error(TooManyMembers(name))
            _, True -> Error(TooManyTotalMembers)
            False, False ->
              Ok(#(
                replace_watchlist(
                  state.watchlists,
                  Named(
                    name,
                    list.sort([member, ..named.members], by: compare_member),
                  ),
                ),
                Added(member),
              ))
          }
      }
    }
  }
}

fn remove_from_watchlists(
  watchlists: List(Named),
  name: String,
  key: String,
) -> Result(#(List(Named), Member), Error) {
  case watchlists {
    [] -> Error(WatchlistNotFound(name))
    [named, ..rest] ->
      case named.name == name {
        False -> {
          use #(remaining, removed) <- result.try(remove_from_watchlists(
            rest,
            name,
            key,
          ))
          Ok(#([named, ..remaining], removed))
        }
        True ->
          case remove_member(named.members, key) {
            Error(_) -> Error(MemberNotFound(key))
            Ok(#(remaining, removed)) -> {
              let next = case remaining {
                [] -> rest
                _ -> [Named(name, remaining), ..rest]
              }
              Ok(#(next, removed))
            }
          }
      }
  }
}

fn remove_member(
  members: List(Member),
  key: String,
) -> Result(#(List(Member), Member), Nil) {
  case members {
    [] -> Error(Nil)
    [member, ..rest] ->
      case member_key(member) == key {
        True -> Ok(#(rest, member))
        False -> {
          use #(remaining, removed) <- result.try(remove_member(rest, key))
          Ok(#([member, ..remaining], removed))
        }
      }
  }
}

fn build_member(input: MemberInput) -> Result(Member, Error) {
  let MemberInput(track, instrument_id, symbol, mic, note, thesis_link, tags) =
    input
  use key <- result.try(
    build_key(IdentityInput(track, instrument_id, symbol, mic)),
  )
  use _ <- result.try(validate_optional_text(note, 500, InvalidNote))
  use _ <- result.try(validate_thesis_link(thesis_link))
  use tags <- result.try(validate_tags(tags, []))
  Ok(Member(key, note, thesis_link, list.sort(tags, by: string.compare)))
}

fn build_key(input: IdentityInput) -> Result(listing.Key, Error) {
  let IdentityInput(track, instrument_id_value, symbol_value, mic_value) = input
  use _ <- result.try(validate_instrument_id(instrument_id_value))
  use instrument_id <- result.try(
    identifier.instrument_id(instrument_id_value)
    |> result.map_error(fn(_) { InvalidInstrumentId }),
  )
  use symbol <- result.try(
    identifier.symbol(symbol_value)
    |> result.map_error(fn(_) { InvalidSymbol }),
  )
  use mic <- result.try(
    identifier.mic(mic_value)
    |> result.map_error(fn(_) { InvalidMic }),
  )
  case
    identifier.symbol_value(symbol) == symbol_value,
    identifier.mic_value(mic) == mic_value,
    string.length(symbol_value) <= 32
  {
    False, _, _ -> Error(InvalidSymbol)
    _, False, _ -> Error(InvalidMic)
    _, _, False -> Error(InvalidSymbol)
    True, True, True -> {
      use _ <- result.try(validate_track_identity(
        track,
        symbol_value,
        mic_value,
      ))
      Ok(listing.new(track, instrument_id, symbol, mic))
    }
  }
}

fn validate_track_identity(
  track: Track,
  symbol: String,
  mic: String,
) -> Result(Nil, Error) {
  let #(allowed_mics, symbol_valid) = case track {
    finance_track.Cn -> #(["XSHG", "XSHE", "XBSE"], exact_digits(symbol, 6))
    finance_track.Hk -> #(["XHKG"], exact_digits(symbol, 5))
    finance_track.Us -> #(
      [
        "ARCX",
        "BATS",
        "BATY",
        "EDGA",
        "EDGX",
        "IEXG",
        "LTSE",
        "MEMX",
        "XASE",
        "XCHI",
        "XCIS",
        "XNAS",
        "XNCM",
        "XNGS",
        "XNMS",
        "XNYS",
        "XPHL",
      ],
      True,
    )
  }
  case list.contains(allowed_mics, mic), symbol_valid {
    False, _ -> Error(TrackMicMismatch(finance_track.name(track), mic))
    _, False -> Error(InvalidTrackSymbol(finance_track.name(track), symbol))
    True, True -> Ok(Nil)
  }
}

fn validate_watchlist_name(value: String) -> Result(Nil, Error) {
  case valid_key(value, 40) {
    True -> Ok(Nil)
    False -> Error(InvalidWatchlistName)
  }
}

fn validate_instrument_id(value: String) -> Result(Nil, Error) {
  let valid =
    string.length(value) <= 200
    && string.contains(value, ":")
    && !string.starts_with(value, ":")
    && !string.ends_with(value, ":")
    && {
      value
      |> string.to_graphemes
      |> list.all(fn(character) {
        string.contains(
          "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-/",
          character,
        )
      })
    }
  case valid {
    True -> Ok(Nil)
    False -> Error(InvalidInstrumentId)
  }
}

fn validate_optional_text(
  value: Option(String),
  maximum: Int,
  error: Error,
) -> Result(Nil, Error) {
  case value {
    None -> Ok(Nil)
    Some(value) ->
      case
        value != ""
        && string.trim(value) == value
        && string.length(value) <= maximum
        && !string.contains(value, "\u{0000}")
        && !string.contains(value, "\n")
        && !string.contains(value, "\r")
      {
        True -> Ok(Nil)
        False -> Error(error)
      }
  }
}

fn validate_thesis_link(value: Option(String)) -> Result(Nil, Error) {
  case value {
    None -> Ok(Nil)
    Some(value) ->
      case
        string.starts_with(value, "https://")
        && string.length(value) <= 1000
        && !has_whitespace(value)
      {
        True -> Ok(Nil)
        False -> Error(InvalidThesisLink)
      }
  }
}

fn validate_tags(
  tags: List(String),
  seen: List(String),
) -> Result(List(String), Error) {
  case tags {
    [] -> Ok(list.reverse(seen))
    [tag, ..rest] ->
      case
        list.length(seen) >= 20,
        valid_key(tag, 32),
        list.contains(seen, tag)
      {
        True, _, _ -> Error(InvalidTag(tag))
        _, False, _ -> Error(InvalidTag(tag))
        _, _, True -> Error(DuplicateTag(tag))
        False, True, False -> validate_tags(rest, [tag, ..seen])
      }
  }
}

fn valid_key(value: String, maximum: Int) -> Bool {
  value != ""
  && string.length(value) <= maximum
  && {
    value
    |> string.to_graphemes
    |> list.all(fn(character) {
      string.contains("abcdefghijklmnopqrstuvwxyz0123456789_-", character)
    })
  }
}

fn has_whitespace(value: String) -> Bool {
  value
  |> string.to_graphemes
  |> list.any(fn(character) { string.trim(character) != character })
}

fn exact_digits(value: String, length: Int) -> Bool {
  string.length(value) == length
  && {
    value
    |> string.to_graphemes
    |> list.all(fn(character) { string.contains("0123456789", character) })
  }
}

fn find_watchlist(values: List(Named), name: String) -> Option(Named) {
  case values {
    [] -> None
    [value, ..rest] ->
      case value.name == name {
        True -> Some(value)
        False -> find_watchlist(rest, name)
      }
  }
}

fn find_member(values: List(Member), key: String) -> Option(Member) {
  case values {
    [] -> None
    [value, ..rest] ->
      case member_key(value) == key {
        True -> Some(value)
        False -> find_member(rest, key)
      }
  }
}

fn replace_watchlist(values: List(Named), replacement: Named) -> List(Named) {
  values
  |> list.map(fn(value) {
    case value.name == replacement.name {
      True -> replacement
      False -> value
    }
  })
  |> list.sort(by: compare_named)
}

fn replace_member(values: List(Member), replacement: Member) -> List(Member) {
  values
  |> list.map(fn(value) {
    case member_key(value) == member_key(replacement) {
      True -> replacement
      False -> value
    }
  })
  |> list.sort(by: compare_member)
}

fn same_member(left: Member, right: Member) -> Bool {
  member_key(left) == member_key(right)
  && left.note == right.note
  && left.thesis_link == right.thesis_link
  && left.tags == right.tags
}

fn compare_named(left: Named, right: Named) -> Order {
  string.compare(left.name, right.name)
}

fn compare_member(left: Member, right: Member) -> Order {
  string.compare(member_key(left), member_key(right))
}

fn identity_key(
  track: Track,
  instrument_id: String,
  symbol: String,
  mic: String,
) -> String {
  finance_track.name(track)
  <> "|"
  <> mic
  <> "|"
  <> symbol
  <> "|"
  <> instrument_id
}

fn listing_key(value: listing.Key) -> String {
  identity_key(
    listing.track(value),
    value |> listing.instrument_id |> identifier.instrument_id_value,
    value |> listing.symbol |> identifier.symbol_value,
    value |> listing.mic |> identifier.mic_value,
  )
}

fn member_input(value: Member) -> MemberInput {
  MemberInput(
    member_track(value),
    member_instrument_id(value),
    member_symbol(value),
    member_mic(value),
    value.note,
    value.thesis_link,
    value.tags,
  )
}

fn identity_input(value: Member) -> IdentityInput {
  IdentityInput(
    member_track(value),
    member_instrument_id(value),
    member_symbol(value),
    member_mic(value),
  )
}

fn replay_events(
  encoded_events: List(String),
  state: State,
) -> Result(State, ReplayError) {
  case encoded_events {
    [] -> Ok(state)
    [encoded, ..rest] -> {
      use event <- result.try(decode_event(encoded))
      let received = event_revision(event)
      let expected = state.revision + 1
      case received == expected {
        False -> Error(NonContiguousRevision(expected, received))
        True -> {
          use next <- result.try(apply_event(state, event))
          replay_events(rest, next)
        }
      }
    }
  }
}

fn apply_event(
  state: State,
  event: MutationEvent,
) -> Result(State, ReplayError) {
  case event {
    AddEvent(_, name, input) -> {
      use #(next, change) <- result.try(
        add(state, name, input) |> result.map_error(InvalidEvent),
      )
      case change {
        Unchanged(_) -> Error(EventDidNotMutate)
        _ -> Ok(next)
      }
    }
    RemoveEvent(_, name, identity) -> {
      use #(next, _) <- result.try(
        remove(state, name, identity) |> result.map_error(InvalidEvent),
      )
      Ok(next)
    }
  }
}

fn event_revision(event: MutationEvent) -> Int {
  case event {
    AddEvent(revision, _, _) | RemoveEvent(revision, _, _) -> revision
  }
}

fn event_json(event: MutationEvent) -> Json {
  case event {
    AddEvent(revision, name, member) ->
      json.object([
        #("schemaVersion", json.int(schema_version)),
        #("revision", json.int(revision)),
        #("action", json.string("add")),
        #("watchlist", json.string(name)),
        #("member", member_input_json(member)),
      ])
    RemoveEvent(revision, name, identity) ->
      json.object([
        #("schemaVersion", json.int(schema_version)),
        #("revision", json.int(revision)),
        #("action", json.string("remove")),
        #("watchlist", json.string(name)),
        #("identity", identity_input_json(identity)),
      ])
  }
}

fn event_decoder() -> decode.Decoder(MutationEvent) {
  use version <- decode.field("schemaVersion", decode.int)
  use revision <- decode.field("revision", decode.int)
  use action <- decode.field("action", decode.string)
  case
    version == schema_version && revision > 0 && revision <= maximum_revision
  {
    False ->
      decode.failure(
        AddEvent(1, "invalid", placeholder_member()),
        "watchlist event v1",
      )
    True ->
      case action {
        "add" -> {
          use name <- decode.field("watchlist", decode.string)
          use member <- decode.field("member", member_input_decoder())
          decode.success(AddEvent(revision, name, member))
        }
        "remove" -> {
          use name <- decode.field("watchlist", decode.string)
          use identity <- decode.field("identity", identity_input_decoder())
          decode.success(RemoveEvent(revision, name, identity))
        }
        _ ->
          decode.failure(
            AddEvent(1, "invalid", placeholder_member()),
            "known watchlist action",
          )
      }
  }
}

fn member_input_decoder() -> decode.Decoder(MemberInput) {
  use track <- decode.field("track", track_decoder())
  use instrument_id <- decode.field("instrumentId", decode.string)
  use symbol <- decode.field("symbol", decode.string)
  use mic <- decode.field("mic", decode.string)
  use note <- decode.field("note", decode.optional(decode.string))
  use thesis_link <- decode.field("thesisLink", decode.optional(decode.string))
  use tags <- decode.field("tags", decode.list(of: decode.string))
  decode.success(MemberInput(
    track,
    instrument_id,
    symbol,
    mic,
    note,
    thesis_link,
    tags,
  ))
}

fn identity_input_decoder() -> decode.Decoder(IdentityInput) {
  use track <- decode.field("track", track_decoder())
  use instrument_id <- decode.field("instrumentId", decode.string)
  use symbol <- decode.field("symbol", decode.string)
  use mic <- decode.field("mic", decode.string)
  decode.success(IdentityInput(track, instrument_id, symbol, mic))
}

fn track_decoder() -> decode.Decoder(Track) {
  decode.string
  |> decode.then(fn(value) {
    case finance_track.from_name(value) {
      Ok(track) -> decode.success(track)
      Error(_) -> decode.failure(finance_track.Us, "cn, hk, or us track")
    }
  })
}

fn placeholder_member() -> MemberInput {
  MemberInput(
    finance_track.Us,
    "invalid:value",
    "INVALID",
    "XNAS",
    None,
    None,
    [],
  )
}

fn named_json(value: Named) -> Json {
  json.object([
    #("name", json.string(value.name)),
    #("memberCount", json.int(list.length(value.members))),
    #("members", json.array(value.members, member_json)),
  ])
}

fn member_json(value: Member) -> Json {
  member_input_json(member_input(value))
}

fn member_input_json(value: MemberInput) -> Json {
  let MemberInput(track, instrument_id, symbol, mic, note, thesis_link, tags) =
    value
  json.object([
    #("track", json.string(finance_track.name(track))),
    #("instrumentId", json.string(instrument_id)),
    #("symbol", json.string(symbol)),
    #("mic", json.string(mic)),
    #("note", json.nullable(note, json.string)),
    #("thesisLink", json.nullable(thesis_link, json.string)),
    #("tags", json.array(tags, json.string)),
    #("identityStatus", json.string("caller_declared_unverified")),
  ])
}

fn identity_input_json(value: IdentityInput) -> Json {
  let IdentityInput(track, instrument_id, symbol, mic) = value
  json.object([
    #("track", json.string(finance_track.name(track))),
    #("instrumentId", json.string(instrument_id)),
    #("symbol", json.string(symbol)),
    #("mic", json.string(mic)),
  ])
}

fn render_named(value: Named) -> String {
  let header =
    value.name <> " (" <> int_string(list.length(value.members)) <> ")"
  case value.members {
    [] -> header
    members ->
      header
      <> "\n"
      <> {
        members
        |> list.map(fn(member) {
          "- "
          <> finance_track.name(member_track(member))
          <> ":"
          <> member_mic(member)
          <> ":"
          <> member_symbol(member)
          <> " ["
          <> member_instrument_id(member)
          <> "] tags="
          <> string.join(member_tags(member), ",")
        })
        |> string.join("\n")
      }
  }
}

fn int_string(value: Int) -> String {
  value |> string.inspect
}
