import finance_track
import gleam/json
import gleam/option.{None}
import gleam/string
import gleeunit/should
import pi_sparkles_watchlist/durable
import pi_sparkles_watchlist/watchlist

fn saved() {
  let cn =
    watchlist.MemberInput(
      finance_track.Cn,
      "cninfo:600000",
      "600000",
      "XSHG",
      None,
      None,
      [],
    )
  let hk =
    watchlist.MemberInput(
      finance_track.Hk,
      "hkex:00700",
      "00700",
      "XHKG",
      None,
      None,
      [],
    )
  let us =
    watchlist.MemberInput(
      finance_track.Us,
      "figi:BBG000B9XRY4",
      "AAPL",
      "XNAS",
      None,
      None,
      [],
    )
  let assert Ok(#(one, _)) = watchlist.add(watchlist.empty(), "core", cn)
  let assert Ok(#(two, _)) = watchlist.add(one, "core", hk)
  let assert Ok(#(three, _)) = watchlist.add(two, "core", us)
  let assert Ok(values) = watchlist.selected(three, None)
  watchlist.encode_snapshot(three, values)
}

fn request(interval: Int, requests: Int) {
  json.object([
    #("requestId", json.string("review-1")),
    #("watchlist", json.string("core")),
    #("provider", json.string("eastmoney")),
    #("shareClass", json.string("a_share")),
    #("firstDueUnixMilliseconds", json.int(0)),
    #("intervalMilliseconds", json.int(interval)),
    #("maximumReviews", json.int(2)),
    #("maximumRequestsPerReview", json.int(requests)),
  ])
  |> json.to_string
}

pub fn saved_snapshot_reuses_exact_listing_laws_test() {
  saved() |> watchlist.decode_snapshot |> should.be_ok
  saved()
  |> string.replace("XSHG", "XNAS")
  |> watchlist.decode_snapshot
  |> should.be_error
  saved()
  |> string.replace("\"schemaVersion\":1", "\"schemaVersion\":2")
  |> watchlist.decode_snapshot
  |> should.be_error
}

pub fn review_bounds_and_track_labels_test() {
  let assert Ok(plan) =
    durable.admit_schedule(
      saved(),
      request(durable.minimum_interval, 1),
      0,
      False,
    )
  let assert Ok(cycle) = durable.cycle(plan, 0)
  cycle |> string.contains("\"tool\":\"cn_stock_quote\"") |> should.be_true
  cycle |> string.contains("\"track\":\"hk\"") |> should.be_true
  cycle |> string.contains("\"track\":\"us\"") |> should.be_true
  cycle |> string.contains("\"status\":\"track_partial\"") |> should.be_true
  cycle |> string.contains("1970-01-01") |> should.be_true
  durable.admit_schedule(saved(), request(1000, 1), 0, False)
  |> should.equal(Error("invalid_review_interval"))
  durable.admit_schedule(
    saved(),
    request(durable.minimum_interval, 0),
    0,
    False,
  )
  |> should.equal(Error("invalid_request_budget"))
}

pub fn request_ids_cannot_pollute_admission_object_test() {
  let input =
    request(durable.minimum_interval, 1)
    |> string.replace("review-1", "bad/request")
  durable.admit_schedule(saved(), input, 0, False)
  |> should.equal(Error("invalid_request_id"))
}

pub fn overdue_intervals_skip_without_burst_test() {
  durable.next_due(1000, durable.minimum_interval, 1000)
  |> should.equal(#(3_601_000, 0))
  durable.next_due(1000, durable.minimum_interval, 10_801_000)
  |> should.equal(#(14_401_000, 3))
}

pub fn interrupted_source_is_unknown_test() {
  let pick =
    "{\"key\":\"cn|XSHG|600000|cninfo:600000\",\"track\":\"cn\",\"mic\":\"XSHG\",\"symbol\":\"600000\",\"asOfDate\":\"2026-10-04\",\"status\":\"planned\"}"
  let assert Ok(fact) =
    durable.project(pick, "{\"state\":\"interrupted\"}", "null")
  fact |> string.contains("\"status\":\"cannot_check\"") |> should.be_true
  fact |> string.contains("\"change\":\"unknown\"") |> should.be_true
}

pub fn decimal_comparison_requires_coherent_source_receipts_test() {
  let pick =
    "{\"key\":\"cn|XSHG|600000|cninfo:600000\",\"track\":\"cn\",\"mic\":\"XSHG\",\"symbol\":\"600000\",\"asOfDate\":\"2026-10-04\",\"status\":\"planned\"}"
  let receipt =
    "{\"state\":\"obtained\",\"result\":{\"details\":{\"schema\":\"pi-sparkles/cn-stock-quote-result\",\"schemaVersion\":1,\"track\":\"cn\",\"selectedProvider\":\"eastmoney\",\"fallbackPerformed\":false,\"listing\":{\"code\":\"600000\",\"venueMic\":\"XSHG\",\"shareClass\":\"a_share\"},\"asOfDate\":\"2026-10-04\",\"prices\":{\"lastOrClose\":\"10.00\",\"currency\":\"CNY\"},\"acquisitionReceipt\":{\"contentSha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\"},\"retrievedAtUnixMilliseconds\":1,\"providerTimestamp\":\"fixture\",\"source\":{\"provider\":\"eastmoney\",\"entitlement\":\"unknown\",\"redistribution\":\"unknown\"},\"freshness\":\"unknown\"}}}"
  let prior =
    "{\"key\":\"cn|XSHG|600000|cninfo:600000\",\"status\":\"checked\",\"currency\":\"CNY\",\"lastOrClose\":\"10\",\"sourceReceipt\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"}"
  let assert Ok(unchanged) = durable.project(pick, receipt, prior)
  unchanged |> string.contains("price_unchanged") |> should.be_true
  let assert Ok(changed) =
    durable.project(pick, string.replace(receipt, "10.00", "10.01"), prior)
  changed |> string.contains("price_changed") |> should.be_true
  durable.project(pick, string.replace(receipt, "XSHG", "XSHE"), prior)
  |> should.be_error
  durable.project(
    pick,
    string.replace(
      receipt,
      "\"fallbackPerformed\":false",
      "\"fallbackPerformed\":true",
    ),
    prior,
  )
  |> should.be_error
  durable.project(pick, string.replace(receipt, "10.00", "0"), prior)
  |> should.be_error
}
