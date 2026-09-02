import finance_core/time
import finance_http/request as http_request
import finance_http/response as http_response
import finance_http/transport
import finance_sina
import finance_sina/history
import finance_sina/query
import finance_sina/request
import finance_sina/runtime
import finance_track
import gleam/javascript/promise
import gleam/list
import gleeunit
import gleeunit/should

pub fn main() -> Nil {
  gleeunit.main()
}

pub fn cn_history_is_bounded_caller_identified_and_exact_test() {
  let assert Ok(access) =
    finance_sina.access("pi-sparkles/0.1", "ops@example.com")
  let plan = plan(5)
  let assert Ok(value) = request.history(access, plan)
  http_request.origin(value) |> should.equal(request.origin)
  http_request.path(value) |> should.equal(request.history_path)
  http_request.safe_key(value)
  |> should.equal(
    "GET https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?datalen=5&ma=no&scale=240&symbol=sh600519",
  )
}

pub fn current_rows_decode_as_exact_strings_and_filter_the_range_test() {
  let assert Ok(value) = history.decode(fixture(), for: plan(5))
  history.code(value) |> should.equal("600519")
  history.provider_window_truncated(value) |> should.be_true
  history.bars(value) |> list.length |> should.equal(3)
  let assert [first, ..] = history.bars(value)
  history.open(first) |> should.equal("1480.000")
  history.volume(first) |> should.equal("3237049")
}

pub fn reviewed_star50_uses_exact_sse_symbol_and_source_reference_test() {
  let assert Ok(value) =
    query.history(
      finance_track.Cn,
      query.Sse,
      "000688",
      date(2026, 8, 28),
      date(2026, 9, 1),
      5,
    )
  query.history_symbol(value) |> should.equal("sh000688")
  query.history_source_reference(value)
  |> should.equal(
    "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sh000688&scale=240&ma=no&datalen=5",
  )
}

pub fn malformed_duplicate_and_out_of_range_rows_fail_closed_test() {
  history.decode(
    "[{\"day\":\"2026-09-01\",\"open\":\"bad\",\"high\":\"1\",\"low\":\"1\",\"close\":\"1\",\"volume\":\"1\"}]",
    for: plan(5),
  )
  |> should.equal(Error(history.InvalidBar(0)))
  history.decode(
    "[{\"day\":\"2026-08-29\",\"open\":\"1\",\"high\":\"1\",\"low\":\"1\",\"close\":\"1\",\"volume\":\"1\"},{\"day\":\"2026-08-29\",\"open\":\"1\",\"high\":\"1\",\"low\":\"1\",\"close\":\"1\",\"volume\":\"1\"}]",
    for: plan(5),
  )
  |> should.equal(Error(history.RowsNotStrictlyAscending(1)))
}

pub fn runtime_enforces_two_second_quota_and_no_retry_test() {
  let now = instant(1000)
  let assert Ok(access) =
    finance_sina.access("pi-sparkles/0.1", "ops@example.com")
  let assert Ok(request_value) = request.history(access, plan(5))
  let assert Ok(provider_runtime) =
    runtime.new_with(
      fn(_, _) { promise.resolve(Ok(http_ok())) },
      fn(wait, _) {
        time.duration_milliseconds(wait) |> should.equal(2000)
        promise.resolve(False)
      },
      fn() { now },
    )
  use first <- promise.await(runtime.send(
    provider_runtime,
    "sina-1",
    request_value,
    transport.new_cancellation(),
  ))
  use second <- promise.await(runtime.send(
    provider_runtime,
    "sina-2",
    request_value,
    transport.new_cancellation(),
  ))
  first |> should.be_ok
  second |> should.be_error
  promise.resolve(Nil)
}

fn plan(limit: Int) -> query.HistoryQuery {
  let assert Ok(value) =
    query.history(
      finance_track.Cn,
      query.Sse,
      "600519",
      date(2026, 8, 28),
      date(2026, 9, 1),
      limit,
    )
  value
}

fn fixture() -> String {
  "[{\"day\":\"2026-08-27\",\"open\":\"1472.000\",\"high\":\"1488.000\",\"low\":\"1468.000\",\"close\":\"1479.000\",\"volume\":\"3000000\"},{\"day\":\"2026-08-28\",\"open\":\"1480.000\",\"high\":\"1499.990\",\"low\":\"1478.000\",\"close\":\"1490.000\",\"volume\":\"3237049\"},{\"day\":\"2026-08-31\",\"open\":\"1490.000\",\"high\":\"1501.000\",\"low\":\"1483.000\",\"close\":\"1498.000\",\"volume\":\"2800000\"},{\"day\":\"2026-09-01\",\"open\":\"1498.000\",\"high\":\"1510.000\",\"low\":\"1495.000\",\"close\":\"1505.000\",\"volume\":\"2900000\"},{\"day\":\"2026-09-02\",\"open\":\"1505.000\",\"high\":\"1512.000\",\"low\":\"1499.000\",\"close\":\"1500.000\",\"volume\":\"3000000\"}]"
}

fn date(year: Int, month: Int, day: Int) -> time.Date {
  let assert Ok(value) = time.date(year, month, day)
  value
}

fn instant(milliseconds: Int) -> time.Instant {
  let assert Ok(value) = time.instant(milliseconds)
  value
}

fn http_ok() -> http_response.Response {
  let assert Ok(value) = http_response.new(200, [], "[]", 2, duration(1))
  value
}

fn duration(milliseconds: Int) -> time.Duration {
  let assert Ok(value) = time.duration(milliseconds)
  value
}
