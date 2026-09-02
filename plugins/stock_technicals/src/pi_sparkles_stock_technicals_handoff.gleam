import finance_ohlcv/series_handoff
import gleam/list
import gleam/option.{None, Some}
import gleam/result
import pi.{type Context}
import pi/session
import pi_sparkles_stock_technicals/decode

pub fn resolve_sma(
  request: decode.SmaRequest,
  context: Context,
) -> Result(decode.SmaInput, String) {
  case request {
    decode.DirectSma(input) -> Ok(input)
    decode.ReceiptSma(
      receipt,
      formula,
      period,
      window,
      parseable,
      rounding,
      projection,
    ) -> {
      use value <- result.try(resolve(context, receipt))
      use source_context <- result.try(stock_context(value, "close"))
      let observations =
        series_handoff.bars(value)
        |> list.map(fn(bar) {
          decode.ObservationInput(bar.date, known(bar.close))
        })
      Ok(decode.SmaInput(
        source_context,
        formula,
        period,
        window,
        parseable,
        rounding,
        projection,
        observations,
      ))
    }
  }
}

pub fn resolve_rsi(
  request: decode.RsiRequest,
  context: Context,
) -> Result(decode.RsiInput, String) {
  case request {
    decode.DirectRsi(input) -> Ok(input)
    decode.ReceiptRsi(
      receipt,
      formula,
      period,
      window,
      seed,
      gap,
      zero_zero,
      parseable,
      rounding,
      projection,
    ) -> {
      use value <- result.try(resolve(context, receipt))
      use source_context <- result.try(stock_context(value, "close"))
      let observations =
        series_handoff.bars(value)
        |> list.map(fn(bar) {
          decode.ObservationInput(bar.date, known(bar.close))
        })
      Ok(decode.RsiInput(
        source_context,
        formula,
        period,
        window,
        seed,
        gap,
        zero_zero,
        parseable,
        rounding,
        projection,
        observations,
      ))
    }
  }
}

pub fn resolve_atr(
  request: decode.AtrRequest,
  context: Context,
) -> Result(decode.AtrInput, String) {
  case request {
    decode.DirectAtr(input) -> Ok(input)
    decode.ReceiptAtr(
      receipt,
      formula,
      period,
      window,
      seed,
      first_true_range,
      gap,
      parseable,
      rounding,
      projection,
    ) -> {
      use value <- result.try(resolve(context, receipt))
      use source_context <- result.try(stock_context(value, "high_low_close"))
      let bars =
        series_handoff.bars(value)
        |> list.map(fn(bar) {
          decode.BarInput(
            bar.date,
            known(bar.high),
            known(bar.low),
            known(bar.close),
          )
        })
      Ok(decode.AtrInput(
        source_context,
        formula,
        period,
        window,
        seed,
        first_true_range,
        gap,
        parseable,
        rounding,
        projection,
        bars,
      ))
    }
  }
}

fn resolve(
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
      "The active session contains an invalid OHLCV series handoff"
    }),
  )
  use value <- result.try(find_latest(list.reverse(entries), requested_receipt))
  series_handoff.verify(value)
  |> result.map_error(fn(error) {
    "The requested session-bound OHLCV series could not be verified: "
    <> series_handoff.error_message(error)
  })
}

fn find_latest(
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
        False -> find_latest(rest, requested_receipt)
      }
    [session.CustomEntry(data: None, ..), ..rest] ->
      find_latest(rest, requested_receipt)
  }
}

fn stock_context(
  value: series_handoff.Handoff,
  input_field: String,
) -> Result(decode.ContextInput, String) {
  use dates <- result.try(date_range(series_handoff.bars(value)))
  let #(date_start, date_end) = dates
  use basis <- result.try(case series_handoff.adjustment(value) {
    "raw" -> Ok(decode.BasisInput("raw", None, None, []))
    "unknown" ->
      Ok(
        decode.BasisInput(
          "provider_defined",
          Some(
            series_handoff.provider(value)
            <> "_source_adjustment_semantics_unknown",
          ),
          None,
          [],
        ),
      )
    other -> Error("Unsupported session-bound OHLCV adjustment " <> other)
  })
  let receipt = series_handoff.receipt(value)
  Ok(
    decode.ContextInput(
      None,
      series_handoff.track(value),
      series_handoff.instrument_id(value),
      series_handoff.mic(value),
      series_handoff.timezone(value),
      date_start,
      date_end,
      decode.SourceInput(
        series_handoff.provider(value),
        series_handoff.source_reference(value),
        receipt,
        series_handoff.retrieved_at_unix_milliseconds(value),
        series_handoff.source_cutoff_unix_milliseconds(value),
      ),
      input_field,
      decode.UnitInput("known", Some(series_handoff.price_unit(value)), None),
      basis,
      [],
      [],
      [receipt],
    ),
  )
}

fn date_range(
  values: List(series_handoff.Bar),
) -> Result(#(String, String), String) {
  case values {
    [] -> Error("The session-bound OHLCV series contained no bars")
    [first, ..rest] -> Ok(#(first.date, last_date(rest, first.date)))
  }
}

fn last_date(values: List(series_handoff.Bar), previous: String) -> String {
  case values {
    [] -> previous
    [value, ..rest] -> last_date(rest, value.date)
  }
}

fn known(value: String) -> decode.FactInput {
  decode.FactInput("known", Some(value), None, [], [])
}
