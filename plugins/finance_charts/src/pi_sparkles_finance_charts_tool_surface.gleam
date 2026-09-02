import gleam/javascript/promise.{type Promise}
import pi
import pi/schema
import pi/tool
import pi_sparkles_finance_charts/decode
import pi_sparkles_finance_charts/domain
import pi_sparkles_finance_charts_handoff as handoff

pub fn prompt_snippet() -> String {
  "After history returns seriesReceipt, pass seriesReceipt, maximumBars, and any indicatorReceipts; omit context, series, and indicators and never copy OHLCV rows or indicator points into this call. Omit trades, gaps, and inputOmissions when none are supplied. Omit fallbackMaximumRows unless a shorter text fallback is required; it defaults to 50, is limited to 1 through 50, and is unrelated to maximumBars. Use direct context plus series plus indicators only for external data with no active-session receipts"
}

pub fn parameters() -> tool.Parameters(decode.Request) {
  tool.parameters(chart_schema(), decode.chart_ohlcv())
}

pub fn execute(
  _id: String,
  input: decode.Request,
  signal: pi.AbortSignal,
  _updates: pi.UpdateSink,
  context: pi.Context,
) -> Promise(tool.ToolResult) {
  case tool.is_cancelled(signal) {
    True ->
      tool.reject("Finance-chart rendering was cancelled before work began")
    False ->
      case handoff.resolve(input, context) {
        Error(message) -> tool.reject(message)
        Ok(resolved) ->
          case domain.run(resolved) {
            Ok(value) ->
              tool.result([tool.text(value.fallback)], value.details, False)
              |> promise.resolve
            Error(error) -> tool.reject(domain.error_message(error))
          }
      }
  }
}

fn chart_schema() -> schema.Schema {
  schema.object([
    schema.Optional(
      "seriesReceipt",
      hash_schema()
        |> schema.described(
          "Exact seriesReceipt returned by a history tool in this active host session. When present, omit context, series, and indicators",
        ),
    ),
    schema.Optional(
      "maximumBars",
      schema.integer()
        |> schema.with_number_range(1.0, 240.0)
        |> schema.described(
          "Maximum latest completed-daily bars to retain from the session receipt",
        ),
    ),
    schema.Optional(
      "indicatorReceipts",
      schema.array(hash_schema())
        |> schema.with_array_length(0, 4)
        |> schema.described(
          "Optional chartHandoffReceipt values returned by sma, rsi, or atr in this active host session; never copy their ordered points",
        ),
    ),
    schema.Optional("context", context_schema()),
    schema.Optional(
      "series",
      schema.array(bar_schema()) |> schema.with_array_length(1, 240),
    ),
    schema.Optional(
      "indicators",
      schema.array(indicator_schema()) |> schema.with_array_length(0, 4),
    ),
    schema.Optional(
      "trades",
      schema.array(trade_schema())
        |> schema.with_array_length(0, 240)
        |> schema.described("Optional explicit trade markers; omit when none"),
    ),
    schema.Optional(
      "gaps",
      schema.array(gap_schema())
        |> schema.with_array_length(0, 240)
        |> schema.described("Optional explicit gap markers; omit when none"),
    ),
    schema.Optional(
      "inputOmissions",
      schema.array(bounded_string(1, 1000))
        |> schema.with_array_length(0, 240)
        |> schema.described("Optional explicit input omissions; omit when none"),
    ),
    schema.Optional(
      "fallbackMaximumRows",
      schema.integer()
        |> schema.with_number_range(1.0, 50.0)
        |> schema.described(
          "Optional text-table row cap from 1 through 50; defaults to 50 and is unrelated to maximumBars",
        ),
    ),
  ])
}

fn context_schema() -> schema.Schema {
  schema.object([
    schema.Required("instructionRef", hash_schema()),
    schema.Required("track", schema.string_enum(["cn", "hk", "us"])),
    schema.Required("instrumentId", bounded_string(1, 200)),
    schema.Required(
      "mic",
      schema.string_enum(["XSHG", "XSHE", "XBSE", "XHKG", "XNYS", "XNAS"]),
    ),
    schema.Required("timezone", bounded_string(1, 100)),
    schema.Required("sourceLanguage", bounded_string(1, 35)),
    schema.Required("priceUnit", bounded_string(1, 100)),
    schema.Required("volumeUnit", bounded_string(1, 100)),
    schema.Required("adjustment", adjustment_schema()),
    schema.Required("source", source_schema()),
    schema.Required(
      "limitations",
      schema.array(identifier_string(
        "A unique lowercase limitation identifier using only a-z, 0-9, and underscore",
      ))
        |> schema.with_array_length(0, 100),
    ),
  ])
}

fn adjustment_schema() -> schema.Schema {
  schema.object([
    schema.Required(
      "kind",
      schema.string_enum([
        "raw",
        "split_adjusted",
        "dividend_adjusted",
        "total_return_adjusted",
        "provider_adjusted",
        "provider_defined",
      ]),
    ),
    schema.Required(
      "label",
      schema.nullable(bounded_string(1, 500))
        |> schema.described(
          "Use a non-null exact provider basis label for provider_adjusted or provider_defined; provider_defined preserves an exact provider basis whose adjustment semantics may remain unknown. Use null for raw, split_adjusted, dividend_adjusted, and total_return_adjusted",
        ),
    ),
  ])
}

fn source_schema() -> schema.Schema {
  schema.object([
    schema.Required("provider", bounded_string(1, 200)),
    schema.Required("sourceReference", bounded_string(1, 4000)),
    schema.Required("acquisitionReceipt", hash_schema()),
    schema.Required("retrievedAtUnixMilliseconds", schema.integer()),
    schema.Required(
      "sourceCutoffUnixMilliseconds",
      schema.nullable(schema.integer()),
    ),
    schema.Required(
      "entitlement",
      identifier_string(
        "A lowercase entitlement identifier using only a-z, 0-9, and underscore",
      ),
    ),
  ])
}

fn bar_schema() -> schema.Schema {
  schema.object([
    schema.Required("date", date_schema()),
    schema.Required(
      "sessionType",
      schema.string_enum(["regular", "half_day", "unknown"]),
    ),
    schema.Required("open", decimal_schema()),
    schema.Required("high", decimal_schema()),
    schema.Required("low", decimal_schema()),
    schema.Required("close", decimal_schema()),
    schema.Required("volume", decimal_schema()),
  ])
}

fn indicator_schema() -> schema.Schema {
  schema.object([
    schema.Required("indicatorId", bounded_string(1, 100)),
    schema.Required("label", bounded_string(1, 80)),
    schema.Required(
      "panel",
      schema.string_enum(["price_overlay", "lower_panel"]),
    ),
    schema.Required("unit", bounded_string(1, 100)),
    schema.Required(
      "warmupSessions",
      schema.integer() |> schema.with_number_range(0.0, 239.0),
    ),
    schema.Required("calculationReceipt", hash_schema()),
    schema.Required(
      "points",
      schema.array(indicator_point_schema())
        |> schema.with_array_length(1, 240),
    ),
  ])
}

fn indicator_point_schema() -> schema.Schema {
  schema.one_of([
    schema.object([
      schema.Required("state", schema.literal_string("calculated")),
      schema.Required("date", date_schema()),
      schema.Required("value", decimal_schema()),
    ]),
    schema.object([
      schema.Required("state", schema.literal_string("unperformed")),
      schema.Required("date", date_schema()),
      schema.Required("reason", bounded_string(1, 1000)),
    ]),
  ])
}

fn trade_schema() -> schema.Schema {
  schema.object([
    schema.Required("tradeId", bounded_string(1, 100)),
    schema.Required("date", date_schema()),
    schema.Required("side", schema.string_enum(["buy", "sell"])),
    schema.Required("price", decimal_schema()),
    schema.Required("quantity", decimal_schema()),
    schema.Required(
      "status",
      schema.string_enum(["proposed", "simulated", "observed"]),
    ),
    schema.Required("evidenceReceipt", hash_schema()),
  ])
}

fn gap_schema() -> schema.Schema {
  schema.object([
    schema.Required("date", date_schema()),
    schema.Required(
      "state",
      schema.string_enum([
        "market_closure",
        "suspension",
        "provider_omission",
        "unavailable_history",
        "unknown",
      ]),
    ),
    schema.Required("reason", bounded_string(1, 1000)),
    schema.Required(
      "evidenceRoots",
      schema.array(hash_schema()) |> schema.with_array_length(0, 20),
    ),
  ])
}

fn date_schema() -> schema.Schema {
  schema.string() |> schema.with_string_length(10, 10)
}

fn decimal_schema() -> schema.Schema {
  schema.string() |> schema.with_string_length(1, 200)
}

fn hash_schema() -> schema.Schema {
  schema.string() |> schema.with_string_length(64, 64)
}

fn bounded_string(minimum: Int, maximum: Int) -> schema.Schema {
  schema.string() |> schema.with_string_length(minimum, maximum)
}

fn identifier_string(description: String) -> schema.Schema {
  bounded_string(1, 200) |> schema.described(description)
}
