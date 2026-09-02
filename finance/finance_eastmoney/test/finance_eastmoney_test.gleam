import finance_core/decimal
import finance_core/time
import finance_eastmoney
import finance_eastmoney/fundamentals
import finance_eastmoney/history
import finance_eastmoney/movers
import finance_eastmoney/overview
import finance_eastmoney/query
import finance_eastmoney/quote
import finance_eastmoney/request as provider_request
import finance_eastmoney/runtime
import finance_http/request
import finance_http/response as http_response
import finance_http/transport
import finance_track
import gleam/javascript/promise
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import gleeunit
import gleeunit/should

pub fn main() -> Nil {
  gleeunit.main()
}

pub fn track_and_exact_code_are_part_of_the_query_contract_test() {
  query.quote(finance_track.Cn, query.Hk, "00700")
  |> should.equal(Error(query.TrackMarketMismatch))
  query.quote(finance_track.Hk, query.Hk, "700")
  |> should.equal(Error(query.InvalidCode))
  query.quote(finance_track.Hk, query.Hk, "00700") |> should.be_ok
}

pub fn requests_are_caller_identified_bounded_and_unadjusted_test() {
  let access = access()
  let assert Ok(quote_plan) =
    query.quote(finance_track.Cn, query.CnBse, "920079")
  let assert Ok(quote_request) = provider_request.quote(access, quote_plan)
  request.origin(quote_request) |> should.equal(provider_request.quote_origin)
  request.maximum_response_bytes(quote_request) |> should.equal(100_000)
  request.headers(quote_request)
  |> list.contains(request.Header(
    "user-agent",
    "pi-sparkles-test test@example.test",
    request.Public,
  ))
  |> should.be_true

  let assert Ok(history_plan) =
    query.history(
      finance_track.Hk,
      query.Hk,
      "00700",
      civil(2026, 8, 1),
      civil(2026, 8, 5),
      10,
    )
  let assert Ok(history_request) =
    provider_request.history(access, history_plan)
  request.maximum_response_bytes(history_request) |> should.equal(2_000_000)
  request.query(history_request)
  |> list.contains(request.QueryParameter("fqt", "0", request.Public))
  |> should.be_true
  request.query(history_request)
  |> list.contains(request.QueryParameter("secid", "116.00700", request.Public))
  |> should.be_true
  query.history_source_reference(history_plan)
  |> should.equal(
    "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=116.00700&klt=101&fqt=0&beg=20260801&end=20260805&lmt=10",
  )
}

pub fn runtime_paces_history_at_one_request_per_two_seconds_test() {
  let access = access()
  let request_value = runtime_history_request(access)
  let now = instant(1000)
  let assert Ok(provider_runtime) =
    runtime.new_with(
      access,
      fn(_, _) { promise.resolve(Ok(http_ok())) },
      fn(wait, _) {
        time.duration_milliseconds(wait) |> should.equal(2000)
        promise.resolve(False)
      },
      fn() { now },
    )
  use first <- promise.await(runtime.send(
    provider_runtime,
    "eastmoney-history-1",
    request_value,
    transport.new_cancellation(),
  ))
  use second <- promise.await(runtime.send(
    provider_runtime,
    "eastmoney-history-2",
    request_value,
    transport.new_cancellation(),
  ))
  first |> should.be_ok
  second |> should.be_error
  promise.resolve(Nil)
}

pub fn runtime_does_not_retry_eastmoney_network_failures_test() {
  let access = access()
  let assert Ok(provider_runtime) =
    runtime.new_with(
      access,
      fn(_, _) { promise.resolve(Error(transport.NetworkFailure)) },
      fn(_, _) {
        should.fail()
        promise.resolve(False)
      },
      fn() { instant(1000) },
    )
  use outcome <- promise.await(runtime.send(
    provider_runtime,
    "eastmoney-one-attempt",
    runtime_history_request(access),
    transport.new_cancellation(),
  ))
  string.inspect(outcome)
  |> string.contains("attempts: 1")
  |> should.be_true
  promise.resolve(Nil)
}

pub fn cn_overview_request_and_decoder_are_bounded_exact_and_identity_checked_test() {
  let access = access()
  let assert Ok(plan) = query.cn_overview(finance_track.Cn)
  let assert Ok(provider_request_value) =
    provider_request.cn_overview(access, plan)
  request.path(provider_request_value)
  |> should.equal(provider_request.cn_overview_path)
  request.maximum_response_bytes(provider_request_value)
  |> should.equal(200_000)
  request.query(provider_request_value)
  |> list.contains(request.QueryParameter(
    "secids",
    "1.000001,0.399001,0.399006,1.000300,1.000688",
    request.Public,
  ))
  |> should.be_true

  let assert Ok(value) = overview.decode(cn_overview_fixture(), for: plan)
  overview.benchmarks(value) |> list.length |> should.equal(5)
  let assert [sse, szse, chinext, csi300, star50] = overview.benchmarks(value)
  overview.code(sse) |> should.equal("000001")
  overview.last(sse) |> should.equal(overview.Observed("3927.18"))
  overview.change_percent(sse) |> should.equal(overview.Observed("0.01"))
  overview.provider_reported_amount(sse)
  |> should.equal(overview.Observed("990371924237.7"))
  overview.advanced(sse) |> should.equal(overview.Observed("1012"))
  overview.code(szse) |> should.equal("399001")
  overview.change(szse) |> should.equal(overview.Observed("64.87"))
  overview.code(chinext) |> should.equal("399006")
  overview.code(csi300) |> should.equal("000300")
  overview.code(star50) |> should.equal("000688")
  overview.name(star50) |> should.equal("科创50")

  overview.decode(
    string.replace(
      cn_overview_fixture(),
      "\"f12\":\"399006\"",
      "\"f12\":\"399007\"",
    ),
    for: plan,
  )
  |> should.be_error
}

pub fn cn_sector_profile_separates_financials_and_real_estate_test() {
  let indices = query.cn_sector_indices()
  indices |> list.length |> should.equal(11)
  let codes = indices |> list.map(query.cn_sector_code)
  codes |> list.contains("000934") |> should.be_false
  codes |> list.contains("000974") |> should.be_true
  codes |> list.contains("399965") |> should.be_true

  let assert [_, _, _, _, _, _, financials, real_estate, ..] = indices
  query.cn_sector_label(financials) |> should.equal("financials")
  query.cn_sector_market(financials) |> should.equal(query.CnSse)
  query.cn_sector_label(real_estate) |> should.equal("real_estate")
  query.cn_sector_market(real_estate) |> should.equal(query.CnSzse)

  let assert Ok(plan) =
    query.cn_sector_history(
      real_estate,
      civil(2026, 7, 1),
      civil(2026, 8, 14),
      64,
    )
  let assert Ok(request_value) = provider_request.history(access(), plan)
  request.query(request_value)
  |> list.contains(request.QueryParameter("secid", "0.399965", request.Public))
  |> should.be_true
}

pub fn cn_movers_request_and_decoder_preserve_provider_order_and_lexemes_test() {
  let assert Ok(plan) = query.cn_movers(finance_track.Cn, 2)
  let assert Ok(request_value) = provider_request.cn_movers(access(), plan)
  request.path(request_value) |> should.equal(provider_request.cn_movers_path)
  request.maximum_response_bytes(request_value) |> should.equal(250_000)
  request.query(request_value)
  |> list.contains(request.QueryParameter("fid", "f3", request.Public))
  |> should.be_true
  request.query(request_value)
  |> list.contains(request.QueryParameter("po", "1", request.Public))
  |> should.be_true
  request.query(request_value)
  |> list.contains(request.QueryParameter(
    "fs",
    "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048",
    request.Public,
  ))
  |> should.be_true

  let assert Ok(value) = movers.decode(cn_movers_fixture(), for: plan)
  movers.provider_total(value) |> should.equal(3)
  let assert [first, second] = movers.rows(value)
  movers.code(first) |> should.equal("688001")
  movers.change_percent(first) |> should.equal(movers.Observed("19.9876"))
  movers.code(second) |> should.equal("300001")
  movers.provider_market_id(second) |> should.equal("0")

  movers.decode(
    string.replace(cn_movers_fixture(), "19.9876", "9.5"),
    for: plan,
  )
  |> should.be_error
}

pub fn quote_decoder_uses_integer_scale_and_preserves_hk_precision_test() {
  let assert Ok(cn_plan) = query.quote(finance_track.Cn, query.CnSse, "600519")
  let assert Ok(cn) = quote.decode(cn_quote_fixture(), for: cn_plan)
  quote.last(cn) |> should.equal("1306.45")
  quote.price_limit_up(cn) |> should.equal(Some("1461.20"))

  let assert Ok(hk_plan) = query.quote(finance_track.Hk, query.Hk, "00700")
  let assert Ok(hk) = quote.decode(hk_quote_fixture(), for: hk_plan)
  quote.last(hk) |> should.equal("492.200")
  quote.price_limit_up(hk) |> should.equal(None)

  quote.decode(cn_quote_fixture(), for: hk_plan) |> should.be_error
}

pub fn history_decoder_preserves_exact_lexemes_and_bounds_test() {
  let assert Ok(plan) =
    query.history(
      finance_track.Cn,
      query.CnSse,
      "600519",
      civil(2026, 8, 1),
      civil(2026, 8, 5),
      3,
    )
  let assert Ok(value) = history.decode(history_fixture(), for: plan)
  history.bars(value) |> list.length |> should.equal(3)
  let assert [first, ..] = history.bars(value)
  history.open(first) |> should.equal("1350.60")
  history.amount(first) |> should.equal("4898665275.00")

  let assert Ok(short_plan) =
    query.history(
      finance_track.Cn,
      query.CnSse,
      "600519",
      civil(2026, 8, 1),
      civil(2026, 8, 5),
      2,
    )
  history.decode(history_fixture(), for: short_plan)
  |> should.equal(Error(history.TooManyBars(2, 3)))
}

pub fn cn_income_decoder_preserves_tokens_mappings_and_formula_leaves_test() {
  let assert Ok(plan) =
    query.income_statement(
      finance_track.Cn,
      query.CnSse,
      "600519",
      civil(2024, 12, 31),
    )
  let assert Ok(value) =
    fundamentals.decode_cn_income(
      cn_income_fixture(),
      for: plan,
      declared_currency: "CNY",
    )
  fundamentals.report_start(value) |> should.equal(None)
  fundamentals.currency_evidence(value)
  |> should.equal(fundamentals.CallerDeclared)
  let assert Ok(revenue) = fundamentals.resolve(value, fundamentals.Revenue)
  revenue.fact.raw_value |> should.equal("174144069958.2500")
  revenue.mapping.accepted_line_codes
  |> should.equal(["TOTAL_OPERATE_INCOME"])

  let assert Ok(derived) = fundamentals.net_margin(value, scale: 6)
  derived.calculation.input_names
  |> should.equal(["net_income_attributable_to_parent", "revenue"])
  decimal.to_string(derived.calculation.value) |> should.equal("49.515408")
}

pub fn hk_income_decoder_strictly_joins_context_and_preserves_tokens_test() {
  let assert Ok(plan) =
    query.income_statement(
      finance_track.Hk,
      query.Hk,
      "00700",
      civil(2024, 12, 31),
    )
  let assert Ok(context) =
    fundamentals.decode_hk_context(hk_context_fixture(), for: plan)
  let assert Ok(value) =
    fundamentals.decode_hk_income(
      hk_income_fixture(),
      for: plan,
      context: context,
    )
  fundamentals.report_start(value) |> should.equal(Some("2024-01-01"))
  fundamentals.reported_currency(value) |> should.equal("人民币")
  fundamentals.normalized_currency(value) |> should.equal(Some("CNY"))
  let assert Ok(revenue) = fundamentals.resolve(value, fundamentals.Revenue)
  revenue.fact.raw_value |> should.equal("652498000000.00")
  revenue.fact.original_label |> should.equal("营业额")

  let assert Ok(derived) = fundamentals.net_margin(value, scale: 6)
  decimal.to_string(derived.calculation.value) |> should.equal("29.74308")
}

pub fn fundamental_requests_are_bounded_and_track_specific_test() {
  let access = access()
  let assert Ok(cn_plan) =
    query.income_statement(
      finance_track.Cn,
      query.CnBse,
      "920079",
      civil(2025, 12, 31),
    )
  let assert Ok(cn_request) =
    provider_request.cn_income_statement(access, cn_plan)
  request.origin(cn_request)
  |> should.equal(provider_request.cn_fundamentals_origin)
  request.maximum_response_bytes(cn_request) |> should.equal(250_000)
  request.query(cn_request)
  |> list.contains(request.QueryParameter(
    "filter",
    "(SECURITY_CODE=\"920079\")(REPORT_DATE='2025-12-31')",
    request.Public,
  ))
  |> should.be_true

  let assert Ok(hk_plan) =
    query.income_statement(
      finance_track.Hk,
      query.Hk,
      "00700",
      civil(2024, 12, 31),
    )
  let assert Ok(hk_request) =
    provider_request.hk_income_statement(access, hk_plan)
  request.origin(hk_request)
  |> should.equal(provider_request.hk_fundamentals_origin)
  request.maximum_response_bytes(hk_request) |> should.equal(350_000)
}

fn access() -> finance_eastmoney.Access {
  let assert Ok(value) =
    finance_eastmoney.access("pi-sparkles-test", "test@example.test")
  value
}

fn civil(year: Int, month: Int, day: Int) -> time.Date {
  let assert Ok(value) = time.date(year, month, day)
  value
}

fn runtime_history_request(
  access: finance_eastmoney.Access,
) -> request.Request {
  let assert Ok(plan) =
    query.history(
      finance_track.Cn,
      query.CnSse,
      "600519",
      civil(2026, 8, 1),
      civil(2026, 8, 5),
      10,
    )
  let assert Ok(value) = provider_request.history(access, plan)
  value
}

fn instant(milliseconds: Int) -> time.Instant {
  let assert Ok(value) = time.instant(milliseconds)
  value
}

fn http_ok() -> http_response.Response {
  let assert Ok(elapsed) = time.duration(1)
  let assert Ok(value) = http_response.new(200, [], "{}", 2, elapsed)
  value
}

fn cn_quote_fixture() -> String {
  "{\"rc\":0,\"data\":{\"f43\":130645,\"f44\":133380,\"f45\":130350,\"f46\":132836,\"f47\":42689,\"f51\":146120,\"f52\":119552,\"f57\":\"600519\",\"f58\":\"贵州茅台\",\"f59\":2,\"f60\":132836,\"f86\":1785917510}}"
}

fn hk_quote_fixture() -> String {
  "{\"rc\":0,\"data\":{\"f43\":492200,\"f44\":497800,\"f45\":482200,\"f46\":493400,\"f47\":25662478,\"f57\":\"00700\",\"f58\":\"腾讯控股\",\"f59\":3,\"f60\":487600,\"f86\":1785917339}}"
}

fn history_fixture() -> String {
  "{\"rc\":0,\"data\":{\"code\":\"600519\",\"market\":1,\"name\":\"贵州茅台\",\"decimal\":2,\"klines\":[\"2026-08-03,1350.60,1358.98,1363.35,1346.00,36147,4898665275.00,1.28,0.62,8.38,0.29\",\"2026-08-04,1350.06,1328.36,1350.94,1328.36,37450,5004070406.00,1.66,-2.25,-30.62,0.30\",\"2026-08-05,1328.36,1306.45,1333.80,1303.50,42689,5600615349.00,2.28,-1.65,-21.91,0.34\"]}}"
}

fn cn_overview_fixture() -> String {
  "{\"rc\":0,\"data\":{\"total\":5,\"diff\":[{\"f2\":392718,\"f3\":1,\"f4\":22,\"f5\":499525613,\"f6\":990371924237.7,\"f12\":\"000001\",\"f13\":1,\"f14\":\"上证指数\",\"f15\":393264,\"f16\":390370,\"f17\":393002,\"f18\":392696,\"f104\":1012,\"f105\":1254,\"f106\":85},{\"f2\":1435431,\"f3\":45,\"f4\":6487,\"f5\":642557319,\"f6\":1152471301164.9692,\"f12\":\"399001\",\"f13\":0,\"f14\":\"深证成指\",\"f15\":1438418,\"f16\":1420399,\"f17\":1433541,\"f18\":1428944,\"f104\":1338,\"f105\":1499,\"f106\":95},{\"f2\":362630,\"f3\":112,\"f4\":4026,\"f5\":199294854,\"f6\":556471146251.9,\"f12\":\"399006\",\"f13\":0,\"f14\":\"创业板指\",\"f15\":363303,\"f16\":357861,\"f17\":361019,\"f18\":358604,\"f104\":753,\"f105\":612,\"f106\":36},{\"f2\":466588,\"f3\":4,\"f4\":193,\"f5\":178430696,\"f6\":549769606284.4,\"f12\":\"000300\",\"f13\":1,\"f14\":\"沪深300\",\"f15\":467671,\"f16\":463713,\"f17\":467298,\"f18\":466395,\"f104\":108,\"f105\":186,\"f106\":6},{\"f2\":123456,\"f3\":-607,\"f4\":-7970,\"f5\":100000000,\"f6\":250000000000,\"f12\":\"000688\",\"f13\":1,\"f14\":\"科创50\",\"f15\":131426,\"f16\":122000,\"f17\":130000,\"f18\":131426,\"f104\":12,\"f105\":38,\"f106\":0}]}}"
}

fn cn_movers_fixture() -> String {
  "{\"rc\":0,\"data\":{\"total\":3,\"diff\":[{\"f2\":18.21,\"f3\":19.9876,\"f4\":3.03,\"f5\":100001,\"f6\":1821000.25,\"f8\":6.5,\"f12\":\"688001\",\"f13\":1,\"f14\":\"测试甲\",\"f15\":18.21,\"f16\":15.01,\"f17\":15.18,\"f18\":15.18,\"f20\":1821000000,\"f21\":910500000},{\"f2\":12.34,\"f3\":10.001,\"f4\":1.12,\"f5\":200002,\"f6\":2468000,\"f8\":3.25,\"f12\":\"300001\",\"f13\":0,\"f14\":\"测试乙\",\"f15\":12.5,\"f16\":11.2,\"f17\":11.3,\"f18\":11.22,\"f20\":1234000000,\"f21\":617000000}]}}"
}

fn cn_income_fixture() -> String {
  "{\"success\":true,\"result\":{\"data\":[{\"SECURITY_CODE\":\"600519\",\"SECURITY_NAME_ABBR\":\"贵州茅台\",\"ORG_CODE\":\"10002602\",\"DATE_TYPE_CODE\":\"001\",\"REPORT_TYPE_CODE\":\"001\",\"DATA_STATE\":\"2\",\"NOTICE_DATE\":\"2025-04-03 00:00:00\",\"REPORT_DATE\":\"2024-12-31 00:00:00\",\"PARENT_NETPROFIT\":86228146421.62,\"TOTAL_OPERATE_INCOME\":174144069958.2500}]}}"
}

fn hk_context_fixture() -> String {
  "{\"success\":true,\"result\":{\"data\":[{\"REPORT_LIST\":[{\"SECURITY_CODE\":\"00700\",\"SECURITY_NAME_ABBR\":\"腾讯控股\",\"START_DATE\":\"2024-01-01 00:00:00\",\"REPORT_DATE\":\"2024-12-31 00:00:00\",\"FISCAL_YEAR\":\"12-31\",\"CURRENCY\":\"人民币\",\"ACCOUNT_STANDARD\":\"国际会计准则\",\"REPORT_TYPE\":\"年报\"}]}]}}"
}

fn hk_income_fixture() -> String {
  "{\"success\":true,\"result\":{\"data\":[{\"SECURITY_CODE\":\"00700\",\"SECURITY_NAME_ABBR\":\"腾讯控股\",\"ORG_CODE\":\"10009066\",\"REPORT_DATE\":\"2024-12-31 00:00:00\",\"DATE_TYPE_CODE\":\"001\",\"FISCAL_YEAR\":\"12-31\",\"START_DATE\":\"2024-01-01 00:00:00\",\"STD_ITEM_CODE\":\"004001001\",\"STD_ITEM_NAME\":\"营业额\",\"AMOUNT\":652498000000.00},{\"SECURITY_CODE\":\"00700\",\"SECURITY_NAME_ABBR\":\"腾讯控股\",\"ORG_CODE\":\"10009066\",\"REPORT_DATE\":\"2024-12-31 00:00:00\",\"DATE_TYPE_CODE\":\"001\",\"FISCAL_YEAR\":\"12-31\",\"START_DATE\":\"2024-01-01 00:00:00\",\"STD_ITEM_CODE\":\"004025002\",\"STD_ITEM_NAME\":\"股东应占溢利\",\"AMOUNT\":194073000000}]}}"
}
