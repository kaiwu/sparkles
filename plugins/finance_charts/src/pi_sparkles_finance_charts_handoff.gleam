import finance_indicators/chart_handoff
import finance_ohlcv/series_handoff
import gleam/list
import gleam/option.{None, Some}
import gleam/result
import pi.{type Context}
import pi/session
import pi_sparkles_finance_charts/decode

pub fn resolve(
  request: decode.Request,
  context: Context,
) -> Result(decode.Input, String) {
  case request {
    decode.Direct(input) -> Ok(input)
    decode.SessionReceipt(
      receipt,
      maximum_bars,
      indicator_receipts,
      trades,
      gaps,
      input_omissions,
      fallback_maximum_rows,
    ) -> {
      use series <- result.try(resolve_series(context, receipt))
      use selected <- result.try(latest_bars(
        series_handoff.bars(series),
        maximum_bars,
      ))
      use adjustment <- result.try(adjustment(
        series_handoff.adjustment(series),
        series_handoff.provider(series),
      ))
      use indicators <- result.try(resolve_indicators(
        context,
        receipt,
        indicator_receipts,
        selected,
      ))
      Ok(decode.Input(
        decode.ContextInput(
          receipt,
          series_handoff.track(series),
          series_handoff.instrument_id(series),
          series_handoff.mic(series),
          series_handoff.timezone(series),
          series_handoff.source_language(series),
          series_handoff.price_unit(series),
          series_handoff.volume_unit(series),
          adjustment,
          decode.SourceInput(
            series_handoff.provider(series),
            series_handoff.source_reference(series),
            receipt,
            series_handoff.retrieved_at_unix_milliseconds(series),
            series_handoff.source_cutoff_unix_milliseconds(series),
            series_handoff.entitlement(series),
          ),
          series_handoff.limitations(series),
        ),
        list.map(selected, fn(bar) {
          decode.BarInput(
            bar.date,
            "unknown",
            bar.open,
            bar.high,
            bar.low,
            bar.close,
            bar.volume,
          )
        }),
        indicators,
        trades,
        gaps,
        input_omissions,
        fallback_maximum_rows,
      ))
    }
  }
}

fn resolve_series(
  context: Context,
  requested_receipt: String,
) -> Result(series_handoff.Handoff, String) {
  use entries <- result.try(
    session.custom_entries(
      session.manager(context),
      series_handoff.event_type,
      series_handoff.decoder(),
    )
    |> result.map_error(fn(_) {
      "The active Pi session contains an invalid OHLCV series handoff"
    }),
  )
  use value <- result.try(find_series(list.reverse(entries), requested_receipt))
  series_handoff.verify(value)
  |> result.map_error(fn(error) {
    "The requested session-bound OHLCV series could not be verified: "
    <> series_handoff.error_message(error)
  })
}

fn find_series(
  entries: List(session.CustomEntry(series_handoff.Handoff)),
  requested_receipt: String,
) -> Result(series_handoff.Handoff, String) {
  case entries {
    [] ->
      Error(
        "No active-session OHLCV handoff matched seriesReceipt "
        <> requested_receipt,
      )
    [session.CustomEntry(data: Some(value), ..), ..rest] ->
      case series_handoff.receipt(value) == requested_receipt {
        True -> Ok(value)
        False -> find_series(rest, requested_receipt)
      }
    [session.CustomEntry(data: None, ..), ..rest] ->
      find_series(rest, requested_receipt)
  }
}

fn resolve_indicators(
  context: Context,
  series_receipt: String,
  requested_receipts: List(String),
  bars: List(series_handoff.Bar),
) -> Result(List(decode.IndicatorInput), String) {
  use _ <- result.try(case list.length(requested_receipts) <= 4 {
    True -> Ok(Nil)
    False -> Error("A chart accepts at most four indicatorReceipts")
  })
  use entries <- result.try(
    session.custom_entries(
      session.manager(context),
      chart_handoff.event_type,
      chart_handoff.decoder(),
    )
    |> result.map_error(fn(_) {
      "The active Pi session contains an invalid indicator chart handoff"
    }),
  )
  let ordered = list.reverse(entries)
  list.try_map(requested_receipts, fn(receipt) {
    use value <- result.try(find_indicator(ordered, receipt))
    use verified <- result.try(
      chart_handoff.verify(value)
      |> result.map_error(fn(error) {
        "The requested indicator handoff could not be verified: "
        <> chart_handoff.error_message(error)
      }),
    )
    use _ <- result.try(
      case chart_handoff.series_receipt(verified) == series_receipt {
        True -> Ok(Nil)
        False ->
          Error("An indicatorReceipt belongs to a different OHLCV series")
      },
    )
    Ok(indicator_input(verified, bars))
  })
}

fn find_indicator(
  entries: List(session.CustomEntry(chart_handoff.Handoff)),
  requested_receipt: String,
) -> Result(chart_handoff.Handoff, String) {
  case entries {
    [] ->
      Error(
        "No active-session indicator handoff matched indicatorReceipt "
        <> requested_receipt,
      )
    [session.CustomEntry(data: Some(value), ..), ..rest] ->
      case chart_handoff.handoff_receipt(value) == requested_receipt {
        True -> Ok(value)
        False -> find_indicator(rest, requested_receipt)
      }
    [session.CustomEntry(data: None, ..), ..rest] ->
      find_indicator(rest, requested_receipt)
  }
}

fn indicator_input(
  value: chart_handoff.Handoff,
  bars: List(series_handoff.Bar),
) -> decode.IndicatorInput {
  let points =
    chart_handoff.points(value)
    |> list.filter_map(fn(point) {
      let date = case point {
        chart_handoff.Calculated(date, _)
        | chart_handoff.Unperformed(date, _) -> date
      }
      case list.any(bars, fn(bar) { bar.date == date }) {
        False -> Error(Nil)
        True ->
          Ok(case point {
            chart_handoff.Calculated(date, point_value) ->
              decode.Calculated(date, point_value)
            chart_handoff.Unperformed(date, reason) ->
              decode.Unperformed(date, reason)
          })
      }
    })
  decode.IndicatorInput(
    chart_handoff.indicator_id(value),
    chart_handoff.label(value),
    chart_handoff.panel(value),
    chart_handoff.unit(value),
    chart_handoff.warmup_sessions(value),
    chart_handoff.calculation_receipt(value),
    points,
  )
}

fn latest_bars(
  values: List(series_handoff.Bar),
  maximum: Int,
) -> Result(List(series_handoff.Bar), String) {
  case maximum >= 1 && maximum <= 240 {
    False -> Error("maximumBars must be between 1 and 240")
    True -> {
      let count = list.length(values)
      let omitted = case count > maximum {
        True -> count - maximum
        False -> 0
      }
      Ok(list.drop(values, omitted))
    }
  }
}

fn adjustment(
  value: String,
  provider: String,
) -> Result(decode.AdjustmentInput, String) {
  case value {
    "raw" -> Ok(decode.AdjustmentInput("raw", None))
    "unknown" ->
      Ok(decode.AdjustmentInput(
        "provider_defined",
        Some(provider <> "_source_adjustment_semantics_unknown"),
      ))
    other -> Error("Unsupported session-bound OHLCV adjustment " <> other)
  }
}
