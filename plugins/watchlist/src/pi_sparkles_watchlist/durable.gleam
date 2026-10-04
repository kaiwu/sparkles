import finance_calendar/date
import finance_core/decimal
import finance_core/time
import finance_provenance/hash
import finance_provenance/identity
import finance_track
import gleam/dynamic/decode
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{None, Some}
import gleam/order.{Eq, Gt}
import gleam/result
import gleam/string
import pi_sparkles_watchlist/watchlist

pub const maximum_picks = 10

pub const maximum_reviews = 30

pub const minimum_interval = 3_600_000

pub const maximum_interval = 2_592_000_000

pub const maximum_time = 4_102_444_799_999

pub fn admit_save(input: String) -> Result(String, String) {
  use #(request_id, expected_revision, snapshot, expected_hash) <- result.try(
    json.parse(input, save_decoder())
    |> result.map_error(fn(_) { "invalid_save_request" }),
  )
  use _ <- result.try(request_identifier(request_id))
  use _ <- result.try(require(
    expected_revision >= 0 && expected_revision < 500,
    "invalid_store_revision",
  ))
  use _ <- result.try(require(
    string.length(snapshot) <= 1_000_000,
    "snapshot_too_large",
  ))
  use digest <- result.try(sha256(snapshot))
  use _ <- result.try(require(
    digest == expected_hash,
    "snapshot_content_hash_mismatch",
  ))
  use _ <- result.try(watchlist.decode_snapshot(snapshot))
  Ok(
    json.object([
      #("requestId", json.string(request_id)),
      #("expectedRevision", json.int(expected_revision)),
      #("snapshotJson", json.string(snapshot)),
      #("snapshotSha256", json.string(digest)),
    ])
    |> json.to_string,
  )
}

fn save_decoder() -> decode.Decoder(#(String, Int, String, String)) {
  use id <- decode.field("requestId", decode.string)
  use revision <- decode.field("expectedRevision", decode.int)
  use snapshot <- decode.field("snapshotJson", decode.string)
  use digest <- decode.field("snapshotSha256", decode.string)
  decode.success(#(id, revision, snapshot, digest))
}

type Schedule {
  Schedule(
    id: String,
    name: String,
    provider: String,
    share_class: String,
    first_due: Int,
    interval: Int,
    reviews: Int,
    requests: Int,
  )
}

pub fn admit_schedule(
  snapshot: String,
  input: String,
  now: Int,
  immediate: Bool,
) -> Result(String, String) {
  use schedule <- result.try(
    json.parse(input, schedule_decoder(now, immediate))
    |> result.map_error(fn(_) { "invalid_review_request" }),
  )
  use _ <- result.try(request_identifier(schedule.id))
  use _ <- result.try(require(
    schedule.provider == "eastmoney" && schedule.share_class == "a_share",
    "unsupported_selected_source_or_share_class",
  ))
  use _ <- result.try(require(
    schedule.first_due >= 0 && schedule.first_due <= maximum_time,
    "invalid_first_due",
  ))
  use _ <- result.try(require(
    schedule.interval >= minimum_interval
      && schedule.interval <= maximum_interval,
    "invalid_review_interval",
  ))
  use _ <- result.try(require(
    schedule.reviews >= 1 && schedule.reviews <= maximum_reviews,
    "invalid_review_budget",
  ))
  use _ <- result.try(require(
    schedule.requests >= 1 && schedule.requests <= maximum_picks,
    "invalid_request_budget",
  ))
  use _ <- result.try(require(
    schedule.first_due + schedule.interval * schedule.reviews <= maximum_time,
    "review_schedule_out_of_range",
  ))
  use members <- result.try(selected(snapshot, schedule.name))
  use _ <- result.try(require(
    list.length(members) <= maximum_picks,
    "select_at_most_ten_picks",
  ))
  let count =
    members
    |> list.filter(fn(member) {
      watchlist.member_track(member) == finance_track.Cn
    })
    |> list.length
  use _ <- result.try(require(
    count <= schedule.requests,
    "review_request_budget_exceeded",
  ))
  use digest <- result.try(sha256(snapshot))
  Ok(
    json.object([
      #("requestId", json.string(schedule.id)),
      #("watchlist", json.string(schedule.name)),
      #("provider", json.string(schedule.provider)),
      #("snapshotJson", json.string(snapshot)),
      #("snapshotSha256", json.string(digest)),
      #("firstDueUnixMilliseconds", json.int(schedule.first_due)),
      #("intervalMilliseconds", json.int(schedule.interval)),
      #("maximumReviews", json.int(schedule.reviews)),
      #("maximumRequestsPerReview", json.int(schedule.requests)),
      #("identityStatus", json.string("caller_declared_unverified")),
    ])
    |> json.to_string,
  )
}

fn schedule_decoder(now: Int, immediate: Bool) -> decode.Decoder(Schedule) {
  use id <- decode.field("requestId", decode.string)
  use name <- decode.field("watchlist", decode.string)
  use provider <- decode.field("provider", decode.string)
  use share_class <- decode.field("shareClass", decode.string)
  use requests <- decode.field("maximumRequestsPerReview", decode.int)
  case immediate {
    True ->
      decode.success(Schedule(
        id,
        name,
        provider,
        share_class,
        now,
        minimum_interval,
        1,
        requests,
      ))
    False -> {
      use due <- decode.field("firstDueUnixMilliseconds", decode.int)
      use interval <- decode.field("intervalMilliseconds", decode.int)
      use reviews <- decode.field("maximumReviews", decode.int)
      decode.success(Schedule(
        id,
        name,
        provider,
        share_class,
        due,
        interval,
        reviews,
        requests,
      ))
    }
  }
}

pub fn cycle(plan: String, now: Int) -> Result(String, String) {
  use #(snapshot, name, stored_hash) <- result.try(
    json.parse(plan, plan_decoder())
    |> result.map_error(fn(_) { "invalid_stored_review_plan" }),
  )
  use members <- result.try(selected(snapshot, name))
  use _ <- result.try(require(
    now >= 0 && now <= maximum_time,
    "clock_out_of_range",
  ))
  use epoch <- result.try(
    time.date(1970, 1, 1) |> result.map_error(fn(_) { "invalid_epoch" }),
  )
  use local_date <- result.try(
    date.add_days(epoch, { now / 1000 + 8 * 3600 } / 86_400)
    |> result.map_error(fn(_) { "date_out_of_range" }),
  )
  let day = date_text(local_date)
  use digest <- result.try(sha256(snapshot))
  use _ <- result.try(require(
    digest == stored_hash,
    "stored_snapshot_hash_mismatch",
  ))
  Ok(
    json.object([
      #("startedAtUnixMilliseconds", json.int(now)),
      #("asOfDate", json.string(day)),
      #("snapshotSha256", json.string(digest)),
      #(
        "picks",
        json.array(members, fn(member) { pick_plan(member, day, digest) }),
      ),
    ])
    |> json.to_string,
  )
}

fn plan_decoder() -> decode.Decoder(#(String, String, String)) {
  use snapshot <- decode.field("snapshotJson", decode.string)
  use name <- decode.field("watchlist", decode.string)
  use digest <- decode.field("snapshotSha256", decode.string)
  decode.success(#(snapshot, name, digest))
}

fn selected(
  snapshot: String,
  name: String,
) -> Result(List(watchlist.Member), String) {
  use state <- result.try(watchlist.decode_snapshot(snapshot))
  use values <- result.try(
    watchlist.selected(state, Some(name))
    |> result.map_error(fn(_) { "saved_watchlist_not_found" }),
  )
  Ok(values |> list.flat_map(watchlist.watchlist_members))
}

fn pick_plan(
  member: watchlist.Member,
  day: String,
  digest: String,
) -> json.Json {
  let common = [
    #("key", json.string(watchlist.member_key(member))),
    #("track", json.string(finance_track.name(watchlist.member_track(member)))),
    #("mic", json.string(watchlist.member_mic(member))),
    #("symbol", json.string(watchlist.member_symbol(member))),
    #("instrumentId", json.string(watchlist.member_instrument_id(member))),
    #("asOfDate", json.string(day)),
  ]
  let source = case watchlist.member_track(member) {
    finance_track.Cn -> [
      #("status", json.string("planned")),
      #("tool", json.string("cn_stock_quote")),
      #(
        "args",
        json.object([
          #("track", json.string("cn")),
          #("provider", json.string("eastmoney")),
          #("venue", json.string(venue(watchlist.member_mic(member)))),
          #("code", json.string(watchlist.member_symbol(member))),
          #("shareClass", json.string("a_share")),
          #(
            "identityEvidenceId",
            json.string("caller_watchlist_snapshot:" <> digest),
          ),
          #("asOfDate", json.string(day)),
        ]),
      ),
    ]
    _ -> [
      #("status", json.string("track_partial")),
      #("tool", json.null()),
      #("args", json.null()),
    ]
  }
  json.object(list.append(common, source))
}

/// Project an exact source receipt. Failures never become 'no change'.
pub fn project(
  pick_json: String,
  outcome_json: String,
  previous_json: String,
) -> Result(String, String) {
  use #(key, track, mic, symbol, day, status) <- result.try(
    json.parse(pick_json, pick_decoder())
    |> result.map_error(fn(_) { "invalid_pick_plan" }),
  )
  let base = [
    #("key", json.string(key)),
    #("track", json.string(track)),
    #("mic", json.string(mic)),
    #("symbol", json.string(symbol)),
    #("identityStatus", json.string("caller_declared_unverified")),
    #("decisionOwner", json.string("llm")),
  ]
  case status {
    "track_partial" ->
      Ok(
        json.object(
          list.append(base, [
            #("status", json.string("track_partial")),
            #(
              "reason",
              json.string("scheduled_source_adapter_not_proved_for_this_track"),
            ),
            #("change", json.string("unknown")),
          ]),
        )
        |> json.to_string,
      )
    "planned" -> {
      use state <- result.try(
        json.parse(outcome_json, outcome_state_decoder())
        |> result.map_error(fn(_) { "invalid_source_outcome" }),
      )
      case state {
        "obtained" ->
          project_quote(
            base,
            key,
            mic,
            symbol,
            day,
            outcome_json,
            previous_json,
          )
        "interrupted" | "failed" | "unavailable" ->
          Ok(
            json.object(
              list.append(base, [
                #("status", json.string("cannot_check")),
                #("reason", json.string(state)),
                #("change", json.string("unknown")),
              ]),
            )
            |> json.to_string,
          )
        _ -> Error("invalid_source_outcome_state")
      }
    }
    _ -> Error("invalid_pick_status")
  }
}

fn pick_decoder() -> decode.Decoder(
  #(String, String, String, String, String, String),
) {
  use key <- decode.field("key", decode.string)
  use track <- decode.field("track", decode.string)
  use mic <- decode.field("mic", decode.string)
  use symbol <- decode.field("symbol", decode.string)
  use day <- decode.field("asOfDate", decode.string)
  use status <- decode.field("status", decode.string)
  decode.success(#(key, track, mic, symbol, day, status))
}

type Quote {
  Quote(
    schema: String,
    version: Int,
    fallback: Bool,
    source_provider: String,
    share_class: String,
    track: String,
    provider: String,
    code: String,
    mic: String,
    day: String,
    price: String,
    currency: String,
    receipt: String,
    retrieved: Int,
    timestamp: String,
    entitlement: String,
    redistribution: String,
    freshness: String,
  )
}

fn outcome_state_decoder() -> decode.Decoder(String) {
  use state <- decode.field("state", decode.string)
  decode.success(state)
}

fn outcome_quote_decoder() -> decode.Decoder(Quote) {
  use quote <- decode.subfield(["result", "details"], quote_decoder())
  decode.success(quote)
}

fn quote_decoder() -> decode.Decoder(Quote) {
  use schema <- decode.field("schema", decode.string)
  use version <- decode.field("schemaVersion", decode.int)
  use fallback <- decode.field("fallbackPerformed", decode.bool)
  use source_provider <- decode.subfield(["source", "provider"], decode.string)
  use share_class <- decode.subfield(["listing", "shareClass"], decode.string)
  use track <- decode.field("track", decode.string)
  use provider <- decode.field("selectedProvider", decode.string)
  use code <- decode.subfield(["listing", "code"], decode.string)
  use mic <- decode.subfield(["listing", "venueMic"], decode.string)
  use day <- decode.field("asOfDate", decode.string)
  use price <- decode.subfield(["prices", "lastOrClose"], decode.string)
  use currency <- decode.subfield(["prices", "currency"], decode.string)
  use receipt <- decode.subfield(
    ["acquisitionReceipt", "contentSha256"],
    decode.string,
  )
  use retrieved <- decode.field("retrievedAtUnixMilliseconds", decode.int)
  use timestamp <- decode.field("providerTimestamp", decode.string)
  use entitlement <- decode.subfield(["source", "entitlement"], decode.string)
  use redistribution <- decode.subfield(
    ["source", "redistribution"],
    decode.string,
  )
  use freshness <- decode.field("freshness", decode.string)
  decode.success(Quote(
    schema,
    version,
    fallback,
    source_provider,
    share_class,
    track,
    provider,
    code,
    mic,
    day,
    price,
    currency,
    receipt,
    retrieved,
    timestamp,
    entitlement,
    redistribution,
    freshness,
  ))
}

fn project_quote(
  base: List(#(String, json.Json)),
  key: String,
  mic: String,
  symbol: String,
  day: String,
  outcome: String,
  previous: String,
) -> Result(String, String) {
  use quote <- result.try(
    json.parse(outcome, outcome_quote_decoder())
    |> result.map_error(fn(_) { "invalid_source_receipt" }),
  )
  use _ <- result.try(require(
    quote.schema == "pi-sparkles/cn-stock-quote-result"
      && quote.version == 1
      && !quote.fallback
      && quote.source_provider == "eastmoney"
      && quote.share_class == "a_share"
      && quote.track == "cn"
      && quote.provider == "eastmoney"
      && quote.code == symbol
      && quote.mic == mic
      && quote.day == day
      && quote.currency == "CNY",
    "source_receipt_scope_mismatch",
  ))
  use _ <- result.try(
    identity.sha256(quote.receipt)
    |> result.map_error(fn(_) { "invalid_source_receipt_digest" }),
  )
  use price <- result.try(
    decimal.parse(quote.price)
    |> result.map_error(fn(_) { "invalid_price_lexeme" }),
  )
  use _ <- result.try(require(
    decimal.compare(price, decimal.zero()) == Gt,
    "invalid_price",
  ))
  use _ <- result.try(require(
    quote.retrieved >= 0 && quote.retrieved <= maximum_time,
    "invalid_retrieval_time",
  ))
  let change = case json.parse(previous, previous_decoder()) {
    Ok(#(prior_key, prior_status, prior_price, prior_receipt, currency))
      if prior_key == key
      && prior_status == "checked"
      && currency == quote.currency
    ->
      case decimal.parse(prior_price), identity.sha256(prior_receipt) {
        Ok(prior), Ok(_) ->
          case decimal.compare(price, prior) {
            Eq -> "price_unchanged"
            _ -> "price_changed"
          }
        _, _ -> "unknown"
      }
    _ -> "no_comparable_prior_observation"
  }
  Ok(
    json.object(
      list.append(base, [
        #("status", json.string("checked")),
        #("change", json.string(change)),
        #("lastOrClose", json.string(quote.price)),
        #("currency", json.string(quote.currency)),
        #("sourceReceipt", json.string(quote.receipt)),
        #(
          "priorSourceReceipt",
          json.nullable(previous_receipt(previous, key), json.string),
        ),
        #("provider", json.string(quote.provider)),
        #("providerTimestamp", json.string(quote.timestamp)),
        #("retrievedAtUnixMilliseconds", json.int(quote.retrieved)),
        #("asOfDate", json.string(quote.day)),
        #("entitlement", json.string(quote.entitlement)),
        #("redistribution", json.string(quote.redistribution)),
        #("freshness", json.string(quote.freshness)),
        #("integrity", json.string("content_bound_not_provider_authenticated")),
      ]),
    )
    |> json.to_string,
  )
}

fn previous_decoder() -> decode.Decoder(
  #(String, String, String, String, String),
) {
  use key <- decode.field("key", decode.string)
  use status <- decode.field("status", decode.string)
  use price <- decode.field("lastOrClose", decode.string)
  use receipt <- decode.field("sourceReceipt", decode.string)
  use currency <- decode.field("currency", decode.string)
  decode.success(#(key, status, price, receipt, currency))
}

fn previous_receipt(previous: String, key: String) {
  case json.parse(previous, previous_decoder()) {
    Ok(#(prior_key, "checked", _, receipt, "CNY")) if prior_key == key ->
      case identity.sha256(receipt) {
        Ok(_) -> Some(receipt)
        Error(_) -> None
      }
    _ -> None
  }
}

pub fn next_due(due: Int, interval: Int, now: Int) -> #(Int, Int) {
  let elapsed = case now > due {
    True -> { now - due } / interval
    False -> 0
  }
  #(due + { elapsed + 1 } * interval, elapsed)
}

fn request_identifier(value: String) -> Result(Nil, String) {
  require(
    value != "__proto__"
      && value != "constructor"
      && value != "prototype"
      && string.length(value) >= 1
      && string.length(value) <= 80
      && string.to_graphemes(value)
    |> list.all(fn(char) {
      string.contains(
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-",
        char,
      )
    }),
    "invalid_request_id",
  )
}

fn require(condition: Bool, message: String) -> Result(Nil, String) {
  case condition {
    True -> Ok(Nil)
    False -> Error(message)
  }
}

fn sha256(value: String) -> Result(String, String) {
  hash.text(value)
  |> result.map(identity.sha256_value)
  |> result.map_error(fn(_) { "hash_failed" })
}

fn venue(mic: String) -> String {
  case mic {
    "XSHG" -> "sse"
    "XSHE" -> "szse"
    "XBSE" -> "bse"
    _ -> "unsupported"
  }
}

fn date_text(value: time.Date) -> String {
  let #(year, month, day) = time.date_parts(value)
  int.to_string(year) <> "-" <> pad(month) <> "-" <> pad(day)
}

fn pad(value: Int) -> String {
  case value < 10 {
    True -> "0" <> int.to_string(value)
    False -> int.to_string(value)
  }
}
