import finance_core/adjustment
import finance_core/currency.{type Currency}
import finance_core/market
import finance_core/source
import finance_core/time.{type Instant}
import finance_eastmoney/history
import finance_eastmoney/query.{type HistoryQuery, type Market}
import finance_ohlcv
import finance_sina/history as sina_history
import finance_sina/query as sina_query
import gleam/int
import gleam/list
import gleam/option.{None}
import gleam/result

pub type NormalizationError {
  InvalidSource(source.SourceError)
  InvalidOpen(index: Int)
  InvalidHigh(index: Int)
  InvalidLow(index: Int)
  InvalidClose(index: Int)
  InvalidVolume(index: Int)
  InvalidBar(index: Int, reason: finance_ohlcv.BarError)
  InvalidBatch(finance_ohlcv.BatchError)
}

pub fn valid_identity(
  market: Market,
  board: String,
  share_class: String,
  currency: Currency,
) -> Bool {
  let currency_code = currency.code(currency)
  case market, board, share_class, currency_code {
    query.CnSse, "main", "a_share", "CNY"
    | query.CnSse, "star", "a_share", "CNY"
    | query.CnSzse, "main", "a_share", "CNY"
    | query.CnSzse, "chinext", "a_share", "CNY"
    | query.CnBse, "beijing", "a_share", "CNY"
    | query.CnSse, "main", "b_share", "USD"
    | query.CnSzse, "main", "b_share", "HKD"
    -> True
    _, _, _, _ -> False
  }
}

pub fn batch(
  plan: HistoryQuery,
  value: history.History,
  retrieved_at: Instant,
  declared_currency: Currency,
) -> Result(finance_ohlcv.Batch, NormalizationError) {
  use normalized <- result.try(normalize_bars(history.bars(value), 0, []))
  use source_ref <- result.try(
    source.new(
      "eastmoney",
      query.history_source_reference(plan),
      source.Other("public_web_rights_unknown"),
    )
    |> result.map_error(InvalidSource),
  )
  let assert Ok(zone) = time.timezone("Asia/Shanghai")
  let assert Ok(provider_day) =
    market.other_session("eastmoney_klt_101_provider_aggregation")
  finance_ohlcv.batch(
    normalized,
    retrieved_at: retrieved_at,
    timezone: zone,
    currency: declared_currency,
    volume_unit: finance_ohlcv.UnknownVolumeUnit,
    adjustment: adjustment.Raw,
    session: provider_day,
    source: source_ref,
    expected_provider: "eastmoney",
    pagination: pagination(plan, history.bars(value)),
    calendar: finance_ohlcv.CalendarNotAssessed(
      "reviewed_cn_calendar_and_status_source_not_composed",
    ),
  )
  |> result.map_error(InvalidBatch)
}

pub fn sina_batch(
  plan: sina_query.HistoryQuery,
  value: sina_history.History,
  retrieved_at: Instant,
  declared_currency: Currency,
) -> Result(finance_ohlcv.Batch, NormalizationError) {
  use normalized <- result.try(
    normalize_sina_bars(sina_history.bars(value), 0, []),
  )
  use source_ref <- result.try(
    source.new(
      "sina",
      sina_query.history_source_reference(plan),
      source.Other("public_web_rights_unknown"),
    )
    |> result.map_error(InvalidSource),
  )
  let assert Ok(zone) = time.timezone("Asia/Shanghai")
  let assert Ok(provider_day) =
    market.other_session("sina_scale_240_provider_aggregation")
  finance_ohlcv.batch(
    normalized,
    retrieved_at: retrieved_at,
    timezone: zone,
    currency: declared_currency,
    volume_unit: finance_ohlcv.UnknownVolumeUnit,
    adjustment: adjustment.Raw,
    session: provider_day,
    source: source_ref,
    expected_provider: "sina",
    pagination: case sina_history.provider_window_truncated(value) {
      True -> finance_ohlcv.TruncatedByBarBudget(sina_query.history_limit(plan))
      False -> finance_ohlcv.AllPages
    },
    calendar: finance_ohlcv.CalendarNotAssessed(
      "reviewed_cn_calendar_and_status_source_not_composed",
    ),
  )
  |> result.map_error(InvalidBatch)
}

fn normalize_bars(
  values: List(history.Bar),
  index: Int,
  reversed: List(finance_ohlcv.Bar),
) -> Result(List(finance_ohlcv.Bar), NormalizationError) {
  case values {
    [] -> Ok(list.reverse(reversed))
    [value, ..rest] -> {
      use open <- result.try(
        finance_ohlcv.exact(history.open(value))
        |> result.map_error(fn(_) { InvalidOpen(index) }),
      )
      use high <- result.try(
        finance_ohlcv.exact(history.high(value))
        |> result.map_error(fn(_) { InvalidHigh(index) }),
      )
      use low <- result.try(
        finance_ohlcv.exact(history.low(value))
        |> result.map_error(fn(_) { InvalidLow(index) }),
      )
      use close <- result.try(
        finance_ohlcv.exact(history.close(value))
        |> result.map_error(fn(_) { InvalidClose(index) }),
      )
      use volume <- result.try(
        finance_ohlcv.exact(history.volume(value))
        |> result.map_error(fn(_) { InvalidVolume(index) }),
      )
      use normalized <- result.try(
        finance_ohlcv.date_bar(
          date_text(history.date(value)),
          history.date(value),
          open,
          high,
          low,
          close,
          volume,
          None,
          None,
        )
        |> result.map_error(fn(reason) { InvalidBar(index, reason) }),
      )
      normalize_bars(rest, index + 1, [normalized, ..reversed])
    }
  }
}

fn normalize_sina_bars(
  values: List(sina_history.Bar),
  index: Int,
  reversed: List(finance_ohlcv.Bar),
) -> Result(List(finance_ohlcv.Bar), NormalizationError) {
  case values {
    [] -> Ok(list.reverse(reversed))
    [value, ..rest] -> {
      use open <- result.try(
        finance_ohlcv.exact(sina_history.open(value))
        |> result.map_error(fn(_) { InvalidOpen(index) }),
      )
      use high <- result.try(
        finance_ohlcv.exact(sina_history.high(value))
        |> result.map_error(fn(_) { InvalidHigh(index) }),
      )
      use low <- result.try(
        finance_ohlcv.exact(sina_history.low(value))
        |> result.map_error(fn(_) { InvalidLow(index) }),
      )
      use close <- result.try(
        finance_ohlcv.exact(sina_history.close(value))
        |> result.map_error(fn(_) { InvalidClose(index) }),
      )
      use volume <- result.try(
        finance_ohlcv.exact(sina_history.volume(value))
        |> result.map_error(fn(_) { InvalidVolume(index) }),
      )
      use normalized <- result.try(
        finance_ohlcv.date_bar(
          date_text(sina_history.date(value)),
          sina_history.date(value),
          open,
          high,
          low,
          close,
          volume,
          None,
          None,
        )
        |> result.map_error(fn(reason) { InvalidBar(index, reason) }),
      )
      normalize_sina_bars(rest, index + 1, [normalized, ..reversed])
    }
  }
}

fn pagination(
  plan: HistoryQuery,
  values: List(history.Bar),
) -> finance_ohlcv.Pagination {
  case list.length(values) >= query.history_limit(plan) {
    True -> finance_ohlcv.TruncatedByBarBudget(query.history_limit(plan))
    False -> finance_ohlcv.AllPages
  }
}

fn date_text(value: time.Date) -> String {
  let #(year, month, day) = time.date_parts(value)
  int.to_string(year) <> "-" <> two_digits(month) <> "-" <> two_digits(day)
}

fn two_digits(value: Int) -> String {
  case value < 10 {
    True -> "0" <> int.to_string(value)
    False -> int.to_string(value)
  }
}
