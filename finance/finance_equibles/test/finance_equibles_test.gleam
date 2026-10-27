import finance_core/time
import finance_equibles
import finance_equibles/request
import finance_equibles/response
import finance_equibles/runtime
import finance_http/request as http_request
import finance_http/response as http_response
import finance_http/transport
import gleam/javascript/promise
import gleam/list
import gleam/option.{None, Some}
import gleeunit
import gleeunit/should

pub fn main() -> Nil {
  gleeunit.main()
}

pub fn access_rejects_other_provider_keys_and_sends_a_bearer_header_test() {
  finance_equibles.access("demo")
  |> should.equal(Error(finance_equibles.InvalidApiKey))
  finance_equibles.access("test-api-key-123")
  |> should.equal(Error(finance_equibles.InvalidApiKey))
  finance_equibles.access("eq_ short")
  |> should.equal(Error(finance_equibles.InvalidApiKey))
  let assert Ok(access) = finance_equibles.access("eq_test_key")
  let assert Ok(value) = request.screener(access, "AAPL")
  http_request.origin(value) |> should.equal("https://api.equibles.com")
  http_request.path(value) |> should.equal("/v1/screener/stocks")
  http_request.query(value)
  |> should.equal([
    http_request.QueryParameter("tickers", "AAPL", http_request.Public),
    http_request.QueryParameter("limit", "1", http_request.Public),
  ])
  http_request.headers(value)
  |> should.equal([
    http_request.Header("accept", "application/json", http_request.Public),
    http_request.Header(
      "authorization",
      "Bearer eq_test_key",
      http_request.Secret,
    ),
  ])
  let assert Ok(shares) = request.ownership_summary(access, "BRK-B")
  http_request.path(shares)
  |> should.equal("/v1/stocks/BRK-B/ownership-summary")
  http_request.query(shares) |> should.equal([])
}

pub fn request_rejects_noncanonical_symbols_test() {
  let assert Ok(access) = finance_equibles.access("eq_test_key")
  request.screener(access, "aapl")
  |> should.equal(Error(request.InvalidSymbol))
  request.ownership_summary(access, "")
  |> should.equal(Error(request.InvalidSymbol))
}

pub fn screener_fixture_keeps_one_us_listing_and_exact_number_lexemes_test() {
  let fixture =
    "{\"totalCount\":1,\"count\":1,\"notFound\":[],\"data\":[{\"ticker\":\"AAPL\",\"name\":\"Apple Inc.\",\"market\":\"US\",\"currency\":\"USD\",\"sector\":\"Technology\",\"industry\":\"Consumer Electronics\",\"marketCap\":5024411287552.0,\"price\":343.91,\"squeezeScore\":1}]}"
  let assert Ok(value) = response.decode_screener(fixture, "AAPL")
  value.ticker |> should.equal("AAPL")
  value.market |> should.equal("US")
  value.sector |> should.equal(Some("Technology"))
  value.market_cap |> should.equal(Some("5024411287552.0"))
  value.price |> should.equal(Some("343.91"))
}

pub fn screener_rejects_missing_non_us_and_ambiguous_rows_test() {
  response.decode_screener("{\"notFound\":[\"AAPL\"],\"data\":[]}", "AAPL")
  |> should.equal(Error(response.NotFound))
  response.decode_screener(
    "{\"notFound\":null,\"data\":[{\"ticker\":\"AAPL\",\"name\":\"Apple Inc.\",\"market\":\"US\",\"currency\":\"USD\",\"sector\":null,\"industry\":null,\"marketCap\":1,\"price\":1}]}",
    "AAPL",
  )
  |> should.equal(
    Ok(response.Listing(
      "AAPL",
      "Apple Inc.",
      "US",
      "USD",
      None,
      None,
      Some("1"),
      Some("1"),
    )),
  )
  response.decode_screener(
    "{\"notFound\":[],\"data\":[{\"ticker\":\"0700\",\"name\":\"Tencent\",\"market\":\"HK\",\"currency\":\"HKD\",\"sector\":null,\"industry\":null,\"marketCap\":1,\"price\":1}]}",
    "0700",
  )
  |> should.equal(Error(response.MarketNotUs))
  response.decode_screener(
    "{\"notFound\":[],\"data\":[{\"ticker\":\"AAPL\",\"name\":\"Apple Inc.\",\"market\":\"US\",\"currency\":\"USD\",\"sector\":null,\"industry\":null,\"marketCap\":1,\"price\":1},{\"ticker\":\"AAPL\",\"name\":\"Apple Inc.\",\"market\":\"US\",\"currency\":\"USD\",\"sector\":null,\"industry\":null,\"marketCap\":1,\"price\":1}]}",
    "AAPL",
  )
  |> should.equal(Error(response.Ambiguous))
}

pub fn shares_fixture_preserves_large_exact_counts_and_nulls_test() {
  let fixture =
    "{\"ticker\":\"AAPL\",\"exactListing\":false,\"reportDate\":\"2026-09-30\",\"sharesOutstanding\":9007199254740993,\"percentUnavailableReason\":null}"
  let assert Ok(value) = response.decode_shares(fixture, "AAPL")
  value.exact_listing |> should.be_false
  value.shares_outstanding |> should.equal(Some("9007199254740993"))
  value.institutional_report_date |> should.equal(Some("2026-09-30"))
  value.percent_unavailable_reason |> should.equal(None)
  response.decode_shares(
    "{\"ticker\":\"AAPL\",\"exactListing\":false,\"reportDate\":null,\"sharesOutstanding\":null}",
    "AAPL",
  )
  |> should.equal(Ok(response.Shares("AAPL", False, None, None, None)))
  response.decode_shares(
    "{\"ticker\":\"AAPL\",\"exactListing\":false,\"reportDate\":null,\"sharesOutstanding\":1.5}",
    "AAPL",
  )
  |> should.equal(Error(response.Malformed))
  response.decode_shares(
    "{\"ticker\":\"MSFT\",\"exactListing\":false,\"reportDate\":null,\"sharesOutstanding\":1}",
    "AAPL",
  )
  |> should.equal(Error(response.TickerMismatch))
}

pub fn shares_preserve_provider_unit_limitations_without_interpreting_prose_test() {
  let fixture =
    "{\"ticker\":\"TSM\",\"exactListing\":false,\"sharesOutstanding\":9007199254740993,\"percentUnavailableReason\":\"Foreign private issuer: count is in ordinary shares, not ADRs.\"}"
  let assert Ok(value) = response.decode_shares(fixture, "TSM")
  value.shares_outstanding |> should.equal(Some("9007199254740993"))
  value.percent_unavailable_reason
  |> should.equal(Some(
    "Foreign private issuer: count is in ordinary shares, not ADRs.",
  ))
  response.decode_shares(
    "{\"ticker\":\"TSM\",\"exactListing\":false,\"sharesOutstanding\":null,\"percentUnavailableReason\":42}",
    "TSM",
  )
  |> should.equal(Error(response.Malformed))
}

pub fn numeric_fields_reject_wire_objects_using_the_internal_marker_test() {
  [
    "{\"__finance_equibles_number__\":\"9007199254740993\"}",
    "{\"__finance_equibles_number__\":1}",
    "{\"__finance_equibles_number__\":null}",
    "{\"__finance_equibles_number__\":{\"__finance_equibles_number__\":\"1\"}}",
    "{\"__finance_equibles_number__\":\"1\",\"extra\":true}",
  ]
  |> list.each(fn(value) {
    response.decode_shares(
      "{\"ticker\":\"AAPL\",\"exactListing\":false,\"sharesOutstanding\":"
        <> value
        <> "}",
      "AAPL",
    )
    |> should.equal(Error(response.Malformed))
    response.decode_screener(
      "{\"data\":[{\"ticker\":\"AAPL\",\"name\":\"Apple\",\"market\":\"US\",\"currency\":\"USD\",\"marketCap\":"
        <> value
        <> "}]}",
      "AAPL",
    )
    |> should.equal(Error(response.Malformed))
  })
}

pub fn runtime_serializes_requests_and_does_not_retry_test() {
  let assert Ok(access) = finance_equibles.access("eq_test_key")
  let assert Ok(request_value) = request.screener(access, "AAPL")
  let assert Ok(now) = time.instant(1000)
  let assert Ok(provider_runtime) =
    runtime.new_with(
      fn(_, _) { promise.resolve(Ok(http_ok())) },
      fn(wait, _) {
        time.duration_milliseconds(wait) |> should.equal(1000)
        promise.resolve(False)
      },
      fn() { now },
    )
  use first <- promise.await(runtime.send(
    provider_runtime,
    "equibles-1",
    request_value,
    transport.new_cancellation(),
  ))
  use second <- promise.await(runtime.send(
    provider_runtime,
    "equibles-2",
    request_value,
    transport.new_cancellation(),
  ))
  first |> should.be_ok
  second |> should.be_error
  promise.resolve(Nil)
}

fn http_ok() -> http_response.Response {
  let assert Ok(elapsed) = time.duration(1)
  let assert Ok(value) = http_response.new(200, [], "{}", 2, elapsed)
  value
}
