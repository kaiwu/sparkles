import finance_core/currency
import finance_core/time
import finance_eastmoney/history
import finance_eastmoney/query
import finance_ohlcv
import finance_sina/history as sina_history
import finance_sina/query as sina_query
import finance_track
import gleam/list
import gleeunit
import gleeunit/should
import pi_sparkles_cn_ohlcv/normalization

pub fn main() -> Nil {
  gleeunit.main()
}

pub fn exact_date_only_eastmoney_rows_normalize_without_unit_inference_test() {
  let assert Ok(plan) =
    query.history(
      finance_track.Cn,
      query.CnSse,
      "600519",
      civil(2024, 8, 1),
      civil(2024, 8, 5),
      10,
    )
  let assert Ok(provider_value) = history.decode(fixture(), for: plan)
  let assert Ok(cny) = currency.from_code("CNY")
  let assert Ok(retrieved) = time.instant(1_800_000_000_000)
  let assert Ok(batch) =
    normalization.batch(plan, provider_value, retrieved, cny)
  finance_ohlcv.volume_unit(batch)
  |> should.equal(finance_ohlcv.UnknownVolumeUnit)
  finance_ohlcv.observations(batch) |> list.length |> should.equal(2)
  let assert [first, ..] = finance_ohlcv.observations(batch)
  finance_ohlcv.raw(finance_ohlcv.open(first.value))
  |> should.equal("1350.6000")
  finance_ohlcv.time_basis(first.value)
  |> should.equal(finance_ohlcv.SessionDateAnchor)
}

pub fn declared_cn_identity_combinations_fail_closed_test() {
  let assert Ok(cny) = currency.from_code("CNY")
  let assert Ok(usd) = currency.from_code("USD")
  normalization.valid_identity(query.CnSse, "main", "a_share", cny)
  |> should.be_true
  normalization.valid_identity(query.CnSse, "main", "b_share", usd)
  |> should.be_true
  normalization.valid_identity(query.CnBse, "beijing", "b_share", cny)
  |> should.be_false
  normalization.valid_identity(query.CnSzse, "chinext", "a_share", usd)
  |> should.be_false
}

pub fn explicitly_selected_sina_rows_preserve_source_and_unknown_amount_test() {
  let assert Ok(plan) =
    sina_query.history(
      finance_track.Cn,
      sina_query.Sse,
      "600519",
      civil(2024, 8, 1),
      civil(2024, 8, 5),
      10,
    )
  let assert Ok(provider_value) = sina_history.decode(sina_fixture(), for: plan)
  let assert Ok(cny) = currency.from_code("CNY")
  let assert Ok(retrieved) = time.instant(1_800_000_000_000)
  let assert Ok(batch) =
    normalization.sina_batch(plan, provider_value, retrieved, cny)
  finance_ohlcv.volume_unit(batch)
  |> should.equal(finance_ohlcv.UnknownVolumeUnit)
  finance_ohlcv.observations(batch) |> list.length |> should.equal(2)
  let assert [first, ..] = finance_ohlcv.observations(batch)
  finance_ohlcv.raw(finance_ohlcv.open(first.value))
  |> should.equal("1350.6000")
}

fn fixture() -> String {
  "{\"rc\":0,\"data\":{\"code\":\"600519\",\"name\":\"贵州茅台\",\"klines\":[\"2024-08-01,1350.6000,1358.98,1363.35,1346.00,36147,4898665275.00,1.28,0.62,8.38,0.29\",\"2024-08-02,1358.98,1328.36,1360.00,1320.00,37450,5004070406.00,2.94,-2.25,-30.62,0.30\"]}}"
}

fn sina_fixture() -> String {
  "[{\"day\":\"2024-08-01\",\"open\":\"1350.6000\",\"high\":\"1363.35\",\"low\":\"1346.00\",\"close\":\"1358.98\",\"volume\":\"36147\"},{\"day\":\"2024-08-02\",\"open\":\"1358.98\",\"high\":\"1360.00\",\"low\":\"1320.00\",\"close\":\"1328.36\",\"volume\":\"37450\"}]"
}

fn civil(year: Int, month: Int, day: Int) -> time.Date {
  let assert Ok(value) = time.date(year, month, day)
  value
}
