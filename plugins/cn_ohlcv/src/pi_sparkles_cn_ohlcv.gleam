import finance_cn_identity/identity
import finance_cn_ohlcv/gap_receipt
import finance_core/adjustment
import finance_core/currency.{type Currency}
import finance_core/decimal
import finance_core/identifier
import finance_core/instrument
import finance_core/market
import finance_core/observation.{type Observation}
import finance_core/source
import finance_core/time
import finance_eastmoney
import finance_eastmoney/history
import finance_eastmoney/query
import finance_eastmoney/request as provider_request
import finance_eastmoney/runtime
import finance_http/response as http_response
import finance_http/transport
import finance_ohlcv
import finance_ohlcv/series_handoff
import finance_provenance/hash
import finance_provenance/identity as provenance_identity
import finance_sina
import finance_sina/history as sina_history
import finance_sina/query as sina_query
import finance_sina/request as sina_request
import finance_sina/runtime as sina_runtime
import finance_track
import finance_track/context as track_context
import finance_track/json as track_json
import gleam/dynamic/decode
import gleam/int
import gleam/javascript/promise.{type Promise}
import gleam/json
import gleam/list
import gleam/option.{None, Some}
import gleam/result
import gleam/string
import pi
import pi/raw
import pi/schema
import pi/tool
import pi_sparkles_cn_ohlcv/effect/environment
import pi_sparkles_cn_ohlcv/normalization

pub type Input {
  Input(
    market: query.Market,
    board: String,
    share_class: String,
    code: String,
    declared_currency: Currency,
    start_date: time.Date,
    end_date: time.Date,
    limit: Int,
    provider: ProviderSelection,
  )
}

pub type ProviderSelection {
  EastmoneySelected
  SinaSelected
}

type EastmoneyProvider {
  Ready(access: finance_eastmoney.Access, runtime: runtime.Runtime)
  InvalidConfiguration(reason: String)
}

type SinaProvider {
  SinaReady(access: finance_sina.Access, runtime: sina_runtime.Runtime)
  SinaInvalidConfiguration(reason: String)
}

type FetchOutcome {
  FetchOutcome(history: history.History, page_receipt: gap_receipt.Page)
}

pub fn extension(api: pi.ExtensionApi) -> Promise(Nil) {
  let eastmoney = provider()
  let sina = sina_provider()
  tool.register_compact(
    api,
    "cn_stock_ohlcv",
    "CN exact daily OHLCV",
    "Fetch bounded raw mainland daily bars for an exact caller-declared venue, board, share class, code, currency, and provider; an Eastmoney failure only suggests Sina and never calls it; select Sina in a new call only after the user explicitly chooses that CN-only alternative; use OHLCV evidence by default for ordinary buy-now, sell-timing, entry, exit, stop, target, trend, momentum, or volatility questions",
    "For a caller-supplied exact mainland venue and code, select provider eastmoney normally; if it fails, report the suggestion and ask the user before making a separate call with provider sina; never automatically fall back, cross tracks or venues, adjust, synthesize bars, or hide a user-selected provider change",
    tool.parameters(input_schema(), input_decoder()),
    tool.Parallel,
    fn(id, input, signal, _updates, _ctx) {
      case plan(input) {
        Error(_) -> tool.reject("Invalid exact CN OHLCV identity or query")
        Ok(query_plan) ->
          case input.provider {
            SinaSelected ->
              use_sina(
                api,
                sina,
                input,
                id,
                transport.from_abort_signal(raw.dynamic(signal)),
              )
            EastmoneySelected ->
              case eastmoney {
                InvalidConfiguration(reason) ->
                  tool.reject(eastmoney_failure_with_sina_suggestion(reason))
                Ready(access, provider_runtime) -> {
                  use fetched <- promise.await(fetch(
                    provider_runtime,
                    access,
                    query_plan,
                    id,
                    transport.from_abort_signal(raw.dynamic(signal)),
                  ))
                  case fetched {
                    Error(message) ->
                      tool.reject(eastmoney_failure_with_sina_suggestion(
                        message,
                      ))
                    Ok(outcome) -> {
                      let assert Ok(retrieved_at) =
                        time.instant(environment.now_milliseconds())
                      case
                        normalization.batch(
                          query_plan,
                          outcome.history,
                          retrieved_at,
                          input.declared_currency,
                        )
                      {
                        Error(error) ->
                          tool.reject(
                            "Eastmoney rows failed exact CN OHLCV validation: "
                            <> string.inspect(error),
                          )
                        Ok(batch) ->
                          case
                            build_gap_receipt(
                              input,
                              query_plan,
                              batch,
                              outcome.page_receipt,
                              retrieved_at,
                            )
                          {
                            Error(message) -> tool.reject(message)
                            Ok(#(receipt, digest)) ->
                              case
                                history_series_handoff(
                                  input,
                                  outcome.history,
                                  retrieved_at,
                                  receipt,
                                )
                              {
                                Error(message) -> tool.reject(message)
                                Ok(series_value) -> {
                                  pi.append_entry(
                                    api,
                                    series_handoff.event_type,
                                    raw.dynamic(series_handoff.encode(
                                      series_value,
                                    )),
                                  )
                                  let details =
                                    result_json(
                                      input,
                                      query_plan,
                                      outcome.history,
                                      batch,
                                      retrieved_at,
                                      receipt,
                                      digest,
                                      series_value,
                                    )
                                  tool.text_result(
                                    model_content(
                                      render(input, outcome.history, batch),
                                      input,
                                      outcome.history,
                                      retrieved_at,
                                      receipt,
                                      digest,
                                      series_value,
                                    ),
                                    details,
                                  )
                                  |> promise.resolve
                                }
                              }
                          }
                      }
                    }
                  }
                }
              }
          }
      }
    },
  )
  promise.resolve(Nil)
}

fn provider() -> EastmoneyProvider {
  case finance_eastmoney.access(environment.product(), environment.contact()) {
    Error(_) -> InvalidConfiguration("CN OHLCV requires AGENT_CONTACT")
    Ok(access) ->
      case runtime.new(access) {
        Ok(provider_runtime) -> Ready(access, provider_runtime)
        Error(_) ->
          InvalidConfiguration(
            "Eastmoney bounded market-data runtime could not initialize safely",
          )
      }
  }
}

fn sina_provider() -> SinaProvider {
  case finance_sina.access(environment.product(), environment.contact()) {
    Error(_) ->
      SinaInvalidConfiguration("Selected Sina provider requires AGENT_CONTACT")
    Ok(access) ->
      case sina_runtime.new(access) {
        Ok(provider_runtime) -> SinaReady(access, provider_runtime)
        Error(_) ->
          SinaInvalidConfiguration(
            "Selected Sina bounded market-data runtime could not initialize safely",
          )
      }
  }
}

fn plan(input: Input) -> Result(query.HistoryQuery, Nil) {
  case
    normalization.valid_identity(
      input.market,
      input.board,
      input.share_class,
      input.declared_currency,
    )
  {
    False -> Error(Nil)
    True ->
      query.history(
        finance_track.Cn,
        input.market,
        input.code,
        input.start_date,
        input.end_date,
        input.limit,
      )
      |> result.map_error(fn(_) { Nil })
  }
}

fn fetch(provider_runtime, access, plan, id, cancellation) {
  case provider_request.history(access, plan) {
    Error(_) -> promise.resolve(Error("Eastmoney history request was invalid"))
    Ok(request_value) -> {
      use outcome <- promise.await(runtime.send(
        provider_runtime,
        id: id,
        request: request_value,
        cancellation: cancellation,
      ))
      case outcome {
        Error(error) ->
          promise.resolve(Error(
            "Eastmoney history request failed safely: " <> string.inspect(error),
          ))
        Ok(response_value) -> {
          let status = http_response.status(response_value)
          case status >= 200 && status < 300 {
            False ->
              promise.resolve(Error(
                "Eastmoney history request returned HTTP "
                <> int.to_string(status),
              ))
            True ->
              case response_page_receipt(response_value, "Eastmoney") {
                Error(message) -> promise.resolve(Error(message))
                Ok(page_receipt) ->
                  case
                    history.decode(
                      http_response.body(response_value),
                      for: plan,
                    )
                  {
                    Ok(value) ->
                      promise.resolve(Ok(FetchOutcome(value, page_receipt)))
                    Error(_) ->
                      promise.resolve(Error(
                        "Eastmoney returned invalid, mismatched, or over-budget daily bars",
                      ))
                  }
              }
          }
        }
      }
    }
  }
}

fn eastmoney_failure_with_sina_suggestion(primary_failure: String) -> String {
  primary_failure
  <> "; Sina Finance is available only as a suggested CN SSE/SZSE CNY A-share alternative. Sina was not called. Ask the user and, only after the user explicitly chooses Sina, make a new cn_stock_ohlcv call with provider \"sina\""
}

fn use_sina(
  api: pi.ExtensionApi,
  provider: SinaProvider,
  input: Input,
  id: String,
  cancellation: transport.Cancellation,
) -> Promise(tool.ToolResult) {
  case provider {
    SinaInvalidConfiguration(reason) -> tool.reject(reason)
    SinaReady(access, provider_runtime) ->
      case sina_plan(input) {
        Error(message) ->
          tool.reject(
            "Explicitly selected Sina provider is unsupported: " <> message,
          )
        Ok(plan) ->
          case sina_request.history(access, plan) {
            Error(_) -> tool.reject("Selected Sina request was invalid")
            Ok(request_value) -> {
              use outcome <- promise.await(sina_runtime.send(
                provider_runtime,
                id: id <> ":sina-explicit",
                request: request_value,
                cancellation: cancellation,
              ))
              case outcome {
                Error(error) ->
                  tool.reject(
                    "Selected Sina provider failed safely: "
                    <> string.inspect(error),
                  )
                Ok(response_value) ->
                  complete_sina(api, input, plan, response_value)
              }
            }
          }
      }
  }
}

fn sina_plan(input: Input) -> Result(sina_query.HistoryQuery, String) {
  use venue <- result.try(case input.market {
    query.CnSse -> Ok(sina_query.Sse)
    query.CnSzse -> Ok(sina_query.Szse)
    query.CnBse -> Error("Sina BSE symbol mapping is not proved")
    query.Hk -> Error("Sina provider is CN-track only")
  })
  use _ <- result.try(
    case
      input.share_class == "a_share"
      && currency.code(input.declared_currency) == "CNY"
    {
      True -> Ok(Nil)
      False -> Error("Sina provider is proved only for CNY mainland A-shares")
    },
  )
  sina_query.history(
    finance_track.Cn,
    venue,
    input.code,
    input.start_date,
    input.end_date,
    input.limit,
  )
  |> result.map_error(fn(_) { "invalid Sina CN history query" })
}

fn complete_sina(
  api: pi.ExtensionApi,
  input: Input,
  plan: sina_query.HistoryQuery,
  response_value: http_response.Response,
) -> Promise(tool.ToolResult) {
  let status = http_response.status(response_value)
  case status >= 200 && status < 300 {
    False ->
      tool.reject(
        "Selected Sina provider returned HTTP " <> int.to_string(status),
      )
    True ->
      case
        sina_history.decode(http_response.body(response_value), for: plan),
        response_page_receipt(response_value, "Sina")
      {
        Error(_), _ ->
          tool.reject(
            "Selected Sina provider returned invalid, mismatched, unordered, or over-budget daily bars",
          )
        _, Error(message) -> tool.reject(message)
        Ok(provider_value), Ok(page_receipt) -> {
          let assert Ok(retrieved_at) =
            time.instant(environment.now_milliseconds())
          case
            normalization.sina_batch(
              plan,
              provider_value,
              retrieved_at,
              input.declared_currency,
            )
          {
            Error(error) ->
              tool.reject(
                "Sina rows failed exact CN OHLCV validation: "
                <> string.inspect(error),
              )
            Ok(batch) ->
              case
                build_sina_gap_receipt(
                  input,
                  plan,
                  batch,
                  page_receipt,
                  retrieved_at,
                )
              {
                Error(message) -> tool.reject(message)
                Ok(#(receipt, digest)) ->
                  case
                    sina_history_series_handoff(
                      input,
                      provider_value,
                      retrieved_at,
                      receipt,
                    )
                  {
                    Error(message) -> tool.reject(message)
                    Ok(series_value) -> {
                      pi.append_entry(
                        api,
                        series_handoff.event_type,
                        raw.dynamic(series_handoff.encode(series_value)),
                      )
                      tool.text_result(
                        sina_model_content(
                          input,
                          provider_value,
                          batch,
                          retrieved_at,
                          receipt,
                          digest,
                          series_value,
                        ),
                        sina_result_json(
                          input,
                          plan,
                          provider_value,
                          batch,
                          retrieved_at,
                          receipt,
                          digest,
                          series_value,
                        ),
                      )
                      |> promise.resolve
                    }
                  }
              }
          }
        }
      }
  }
}

fn response_page_receipt(
  response: http_response.Response,
  provider: String,
) -> Result(gap_receipt.Page, String) {
  use content_hash <- result.try(
    hash.text(http_response.body(response))
    |> result.map_error(fn(_) {
      provider <> " response content could not be hashed safely"
    }),
  )
  gap_receipt.page(
    1,
    http_response.first_header(response, name: "x-request-id"),
    http_response.byte_length(response),
    content_hash,
  )
  |> result.map_error(fn(_) {
    provider <> " response page receipt was structurally invalid"
  })
}

fn build_gap_receipt(
  input: Input,
  plan: query.HistoryQuery,
  batch: finance_ohlcv.Batch,
  page_receipt: gap_receipt.Page,
  retrieved_at: time.Instant,
) -> Result(#(gap_receipt.Receipt, provenance_identity.Sha256), String) {
  use listing <- result.try(receipt_listing(input, "eastmoney"))
  let bar_dates =
    batch
    |> finance_ohlcv.observations
    |> list.map(fn(observation) {
      observation.value |> finance_ohlcv.session_date
    })
  use receipt <- result.try(
    gap_receipt.new(
      provider: "eastmoney",
      listing: listing,
      start_date: query.history_start(plan),
      end_date: query.history_end(plan),
      limit: query.history_limit(plan),
      source_reference: query.history_source_reference(plan),
      retrieved_at: retrieved_at,
      pagination: receipt_pagination(finance_ohlcv.pagination(batch)),
      pages: [page_receipt],
      bar_dates: bar_dates,
    )
    |> result.map_error(fn(_) {
      "Eastmoney CN gap-assessment receipt was structurally invalid"
    }),
  )
  use digest <- result.try(
    receipt
    |> gap_receipt.canonical_text
    |> hash.text
    |> result.map_error(fn(_) {
      "Eastmoney CN gap-assessment receipt could not be hashed safely"
    }),
  )
  Ok(#(receipt, digest))
}

fn build_sina_gap_receipt(
  input: Input,
  plan: sina_query.HistoryQuery,
  batch: finance_ohlcv.Batch,
  page_receipt: gap_receipt.Page,
  retrieved_at: time.Instant,
) -> Result(#(gap_receipt.Receipt, provenance_identity.Sha256), String) {
  use listing <- result.try(receipt_listing(input, "sina"))
  let bar_dates =
    batch
    |> finance_ohlcv.observations
    |> list.map(fn(observation) {
      observation.value |> finance_ohlcv.session_date
    })
  use receipt <- result.try(
    gap_receipt.new(
      provider: "sina",
      listing: listing,
      start_date: sina_query.history_start(plan),
      end_date: sina_query.history_end(plan),
      limit: sina_query.history_limit(plan),
      source_reference: sina_query.history_source_reference(plan),
      retrieved_at: retrieved_at,
      pagination: receipt_pagination(finance_ohlcv.pagination(batch)),
      pages: [page_receipt],
      bar_dates: bar_dates,
    )
    |> result.map_error(fn(_) {
      "Sina CN gap-assessment receipt was structurally invalid"
    }),
  )
  use digest <- result.try(
    receipt
    |> gap_receipt.canonical_text
    |> hash.text
    |> result.map_error(fn(_) {
      "Sina CN gap-assessment receipt could not be hashed safely"
    }),
  )
  Ok(#(receipt, digest))
}

fn receipt_listing(
  input: Input,
  provider: String,
) -> Result(identity.Listing, String) {
  use instrument_id <- result.try(
    identifier.instrument_id(
      provider <> ":" <> query.market_name(input.market) <> ":" <> input.code,
    )
    |> result.map_error(fn(_) { "Invalid CN receipt instrument identity" }),
  )
  use venue <- result.try(receipt_venue(input.market))
  use board <- result.try(receipt_board(input.market, input.board))
  use share_class <- result.try(receipt_share_class(input.share_class))
  identity.new(
    instrument_id,
    input.code,
    venue,
    board,
    share_class,
    input.declared_currency,
    instrument.UnknownStatus,
  )
  |> result.map_error(fn(_) { "Invalid CN receipt listing identity" })
}

fn receipt_venue(value: query.Market) -> Result(identity.Venue, String) {
  case value {
    query.CnSse -> Ok(identity.Sse)
    query.CnSzse -> Ok(identity.Szse)
    query.CnBse -> Ok(identity.Bse)
    query.Hk -> Error("HK market cannot enter a CN OHLCV receipt")
  }
}

fn receipt_board(
  market: query.Market,
  value: String,
) -> Result(identity.Board, String) {
  case market, value {
    query.CnSse, "main" -> Ok(identity.SseMainBoard)
    query.CnSse, "star" -> Ok(identity.StarMarket)
    query.CnSzse, "main" -> Ok(identity.SzseMainBoard)
    query.CnSzse, "chinext" -> Ok(identity.ChiNext)
    query.CnBse, "beijing" -> Ok(identity.BeijingMarket)
    _, _ -> Error("Invalid CN receipt venue/board identity")
  }
}

fn receipt_share_class(value: String) -> Result(identity.ShareClass, String) {
  case value {
    "a_share" -> Ok(identity.AShare)
    "b_share" -> Ok(identity.BShare)
    _ -> Error("Invalid CN receipt share class")
  }
}

fn receipt_pagination(
  value: finance_ohlcv.Pagination,
) -> gap_receipt.Pagination {
  case value {
    finance_ohlcv.AllPages -> gap_receipt.Complete
    finance_ohlcv.TruncatedByBarBudget(_) -> gap_receipt.TruncatedByBarBudget
    finance_ohlcv.TruncatedByPageBudget(_) -> gap_receipt.TruncatedByBarBudget
  }
}

fn input_schema() -> schema.Schema {
  schema.object([
    schema.Required("venue", schema.string_enum(["sse", "szse", "bse"])),
    schema.Required(
      "board",
      schema.string_enum(["main", "star", "chinext", "beijing"]),
    ),
    schema.Required("shareClass", schema.string_enum(["a_share", "b_share"])),
    schema.Required("code", schema.string() |> schema.with_string_length(6, 6)),
    schema.Required("currency", schema.string_enum(["CNY", "HKD", "USD"])),
    schema.Required(
      "startDate",
      schema.string()
        |> schema.with_string_length(10, 10)
        |> schema.described("Inclusive YYYY-MM-DD start"),
    ),
    schema.Required(
      "endDate",
      schema.string()
        |> schema.with_string_length(10, 10)
        |> schema.described("Inclusive YYYY-MM-DD end"),
    ),
    schema.Optional(
      "limit",
      schema.integer()
        |> schema.with_number_range(1.0, 1000.0)
        |> schema.described("Maximum provider rows; defaults to 250"),
    ),
    schema.Required(
      "provider",
      schema.string_enum(["eastmoney", "sina"])
        |> schema.described(
          "Choose eastmoney normally; choose sina only in a separate call after the user explicitly accepts the suggested CN SSE/SZSE CNY A-share alternative",
        ),
    ),
  ])
}

fn input_decoder() -> decode.Decoder(Input) {
  use venue <- decode.field("venue", decode.string)
  use board <- decode.field("board", decode.string)
  use share_class <- decode.field("shareClass", decode.string)
  use code <- decode.field("code", decode.string)
  use currency_code <- decode.field("currency", decode.string)
  use start <- decode.field("startDate", decode.string)
  use end <- decode.field("endDate", decode.string)
  use limit <- decode.optional_field("limit", 250, decode.int)
  use provider <- decode.field("provider", decode.string)
  let assert Ok(placeholder) = time.date(1970, 1, 1)
  let assert Ok(cny) = currency.from_code("CNY")
  case
    market_from_name(venue),
    currency.from_code(currency_code),
    parse_date(start),
    parse_date(end)
  {
    Ok(market), Ok(declared_currency), Ok(start_date), Ok(end_date) ->
      decode.success(Input(
        market,
        board,
        share_class,
        code,
        declared_currency,
        start_date,
        end_date,
        limit,
        provider_selection(provider),
      ))
    _, _, _, _ ->
      decode.failure(
        Input(
          query.CnSse,
          "main",
          "a_share",
          "600000",
          cny,
          placeholder,
          placeholder,
          250,
          EastmoneySelected,
        ),
        "valid CN OHLCV identity and dates",
      )
  }
}

fn provider_selection(value: String) -> ProviderSelection {
  case value {
    "sina" -> SinaSelected
    _ -> EastmoneySelected
  }
}

fn market_from_name(value: String) -> Result(query.Market, Nil) {
  case value {
    "sse" -> Ok(query.CnSse)
    "szse" -> Ok(query.CnSzse)
    "bse" -> Ok(query.CnBse)
    _ -> Error(Nil)
  }
}

fn parse_date(value: String) -> Result(time.Date, Nil) {
  case string.split(value, "-") {
    [year, month, day] -> {
      use year <- result.try(int.parse(year) |> result.map_error(fn(_) { Nil }))
      use month <- result.try(
        int.parse(month) |> result.map_error(fn(_) { Nil }),
      )
      use day <- result.try(int.parse(day) |> result.map_error(fn(_) { Nil }))
      time.date(year, month, day) |> result.map_error(fn(_) { Nil })
    }
    _ -> Error(Nil)
  }
}

fn result_context(input: Input) -> track_context.Context {
  let assert Ok(zone) = time.timezone("Asia/Shanghai")
  let venue = case input.market {
    query.CnSse -> identity.Sse
    query.CnSzse -> identity.Szse
    query.CnBse -> identity.Bse
    _ -> identity.Sse
  }
  let assert Ok(value) =
    track_context.new(
      track: finance_track.Cn,
      market_scope: "cn_stock_ohlcv",
      venue_mic: Some(identity.venue_mic(venue)),
      board: Some(input.board),
      timezone: Some(zone),
      source_language: "zh-CN",
      providers: ["eastmoney"],
      entitlement: "public_web_local_analysis",
      limitations: limitations(),
    )
  value
}

fn limitations() -> List(String) {
  [
    "vendor_origin_not_exchange_evidence",
    "venue_board_share_class_and_currency_are_caller_declared",
    "provider_date_has_no_source_instant",
    "provider_daily_session_membership_not_independently_verified",
    "provider_volume_unit_not_verified",
    "provider_amount_and_turnover_units_not_normalized",
    "reviewed_cn_calendar_and_status_source_not_composed",
    "missing_sessions_are_not_classified",
    "service_level_and_redistribution_rights_unknown",
    "sina_requires_explicit_user_selection_in_a_separate_call",
    "no_automatic_provider_fallback",
    "no_cross_track_or_venue_provider_substitution",
  ]
}

fn render(
  input: Input,
  provider_value: history.History,
  batch: finance_ohlcv.Batch,
) -> String {
  "CN track | Eastmoney raw daily OHLCV | "
  <> query.market_name(input.market)
  <> " "
  <> history.code(provider_value)
  <> " "
  <> history.name(provider_value)
  <> " | "
  <> int.to_string(list.length(finance_ohlcv.observations(batch)))
  <> " bars | volume unit and calendar gaps unknown | "
  <> pagination_name(finance_ohlcv.pagination(batch))
}

fn model_content(
  summary: String,
  input: Input,
  value: history.History,
  retrieved_at: time.Instant,
  receipt: gap_receipt.Receipt,
  receipt_digest: provenance_identity.Sha256,
  series_value: series_handoff.Handoff,
) -> String {
  summary
  <> "\nComplete bounded daily rows follow as CSV. This exact active-session series is already registered: for sma, rsi, atr, or chart_ohlcv pass only seriesReceipt with the requested calculation/chart fields. Never copy these rows into those installed tools, never use acquisitionReceipt or gapAssessmentReceiptDigest as seriesReceipt, and never manufacture an instructionRef or use a script for the handoff.\n"
  <> "dataSourceChange=none;fallbackPerformed=false;track=cn;provider=eastmoney;venue="
  <> query.market_name(input.market)
  <> ";board="
  <> input.board
  <> ";shareClass="
  <> input.share_class
  <> ";code="
  <> history.code(value)
  <> ";currency="
  <> currency.code(input.declared_currency)
  <> ";frequency=daily;adjustment=raw;retrievedAtUnixMilliseconds="
  <> int.to_string(time.unix_milliseconds(retrieved_at))
  <> ";gapAssessmentReceiptDigest="
  <> provenance_identity.sha256_value(receipt_digest)
  <> ";acquisitionReceipt="
  <> provenance_identity.sha256_value(receipt_digest)
  <> ";seriesReceipt="
  <> series_handoff.receipt(series_value)
  <> ";seriesHandoff=session_bound_v1_use_receipt_for_sma_rsi_atr_chart"
  <> ";sourceReference="
  <> gap_receipt.source_reference(receipt)
  <> "\ndate,open,high,low,close,volume,amount\n"
  <> {
    history.bars(value)
    |> list.map(fn(bar) {
      [
        date_text(history.date(bar)),
        history.open(bar),
        history.high(bar),
        history.low(bar),
        history.close(bar),
        history.volume(bar),
        history.amount(bar),
      ]
      |> string.join(",")
    })
    |> string.join("\n")
  }
}

fn result_json(
  input: Input,
  plan: query.HistoryQuery,
  provider_value: history.History,
  batch: finance_ohlcv.Batch,
  retrieved_at: time.Instant,
  receipt: gap_receipt.Receipt,
  receipt_digest: provenance_identity.Sha256,
  series_value: series_handoff.Handoff,
) -> json.Json {
  json.object(
    list.append(track_json.result_fields(result_context(input)), [
      #("provider", json.string("eastmoney")),
      #("selectedProvider", json.string("eastmoney")),
      #("fallbackPerformed", json.bool(False)),
      #("dataSourceChange", json.null()),
      #(
        "providerAttempts",
        json.array(
          [
            json.object([
              #("provider", json.string("eastmoney")),
              #("outcome", json.string("selected")),
              #("error", json.null()),
            ]),
          ],
          fn(value) { value },
        ),
      ),
      #("route", json.string("direct")),
      #("venue", json.string(query.market_name(input.market))),
      #("board", json.string(input.board)),
      #("shareClass", json.string(input.share_class)),
      #("code", json.string(history.code(provider_value))),
      #("name", json.string(history.name(provider_value))),
      #(
        "identityEvidence",
        json.string("caller_declared_not_provider_verified"),
      ),
      #("startDate", json.string(date_text(query.history_start(plan)))),
      #("endDate", json.string(date_text(query.history_end(plan)))),
      #("interval", json.string("1_day")),
      #("session", json.string(session_name(finance_ohlcv.session(batch)))),
      #("sessionTimezone", json.string("Asia/Shanghai")),
      #("currency", json.string(currency.code(finance_ohlcv.currency(batch)))),
      #(
        "currencyEvidence",
        json.string("caller_declared_not_provider_verified"),
      ),
      #(
        "volumeUnit",
        json.string(volume_unit_name(finance_ohlcv.volume_unit(batch))),
      ),
      #("providerVolumeUnit", json.null()),
      #(
        "adjustment",
        json.string(adjustment_name(finance_ohlcv.adjustment(batch))),
      ),
      #(
        "retrievedAtUnixMilliseconds",
        json.int(time.unix_milliseconds(retrieved_at)),
      ),
      #("pagesFetched", json.int(1)),
      #("pagination", pagination_json(finance_ohlcv.pagination(batch))),
      #(
        "availability",
        json.string(availability_name(finance_ohlcv.availability(batch))),
      ),
      #(
        "duplicatesCollapsed",
        json.int(finance_ohlcv.duplicates_collapsed(batch)),
      ),
      #(
        "calendarCompleteness",
        calendar_json(finance_ohlcv.calendar_assessment(batch)),
      ),
      #(
        "gapAssessmentReceipt",
        gap_assessment_receipt_json(receipt, receipt_digest),
      ),
      #("sourceReference", json.string(gap_receipt.source_reference(receipt))),
      #(
        "acquisitionReceipt",
        json.string(provenance_identity.sha256_value(receipt_digest)),
      ),
      #("seriesReceipt", json.string(series_handoff.receipt(series_value))),
      #(
        "gapStates",
        json.array(
          [
            "market_closure",
            "suspension",
            "provider_omission",
            "unavailable_history",
          ],
          json.string,
        ),
      ),
      #(
        "providerRows",
        json.array(history.bars(provider_value), provider_row_json),
      ),
      #("bars", json.array(finance_ohlcv.observations(batch), bar_json)),
      #("entitlement", json.string("public_web_local_analysis")),
      #("redistribution", json.string("unknown")),
      #("limitations", json.array(limitations(), json.string)),
    ]),
  )
}

fn sina_result_context(input: Input) -> track_context.Context {
  let assert Ok(zone) = time.timezone("Asia/Shanghai")
  let venue = case input.market {
    query.CnSse -> identity.Sse
    query.CnSzse -> identity.Szse
    query.CnBse -> identity.Bse
    _ -> identity.Sse
  }
  let assert Ok(value) =
    track_context.new(
      track: finance_track.Cn,
      market_scope: "cn_stock_ohlcv",
      venue_mic: Some(identity.venue_mic(venue)),
      board: Some(input.board),
      timezone: Some(zone),
      source_language: "zh-CN",
      providers: ["sina"],
      entitlement: "public_web_local_analysis",
      limitations: limitations(),
    )
  value
}

fn sina_model_content(
  input: Input,
  value: sina_history.History,
  batch: finance_ohlcv.Batch,
  retrieved_at: time.Instant,
  receipt: gap_receipt.Receipt,
  receipt_digest: provenance_identity.Sha256,
  series_value: series_handoff.Handoff,
) -> String {
  "DATA SOURCE CHANGED BY EXPLICIT USER CHOICE: eastmoney -> sina. No automatic fallback was performed."
  <> "\nCN track | Sina raw daily OHLCV | "
  <> query.market_name(input.market)
  <> " "
  <> sina_history.code(value)
  <> " | "
  <> int.to_string(list.length(finance_ohlcv.observations(batch)))
  <> " bars | amount, volume unit, and calendar gaps unknown | "
  <> pagination_name(finance_ohlcv.pagination(batch))
  <> "\nComplete bounded daily rows follow as CSV. This exact active-session series is already registered: for sma, rsi, atr, or chart_ohlcv pass only seriesReceipt with the requested calculation/chart fields. Never hide or relabel the Sina source.\n"
  <> "dataSourceChange=eastmoney->sina_by_explicit_user_choice;fallbackPerformed=false;selectionMode=explicit_user_choice;track=cn;provider=sina;venue="
  <> query.market_name(input.market)
  <> ";board="
  <> input.board
  <> ";shareClass="
  <> input.share_class
  <> ";code="
  <> sina_history.code(value)
  <> ";currency="
  <> currency.code(input.declared_currency)
  <> ";frequency=daily;adjustment=raw;retrievedAtUnixMilliseconds="
  <> int.to_string(time.unix_milliseconds(retrieved_at))
  <> ";gapAssessmentReceiptDigest="
  <> provenance_identity.sha256_value(receipt_digest)
  <> ";acquisitionReceipt="
  <> provenance_identity.sha256_value(receipt_digest)
  <> ";seriesReceipt="
  <> series_handoff.receipt(series_value)
  <> ";sourceReference="
  <> gap_receipt.source_reference(receipt)
  <> "\ndate,open,high,low,close,volume,amount\n"
  <> {
    sina_history.bars(value)
    |> list.map(fn(bar) {
      [
        date_text(sina_history.date(bar)),
        sina_history.open(bar),
        sina_history.high(bar),
        sina_history.low(bar),
        sina_history.close(bar),
        sina_history.volume(bar),
        "unknown",
      ]
      |> string.join(",")
    })
    |> string.join("\n")
  }
}

fn sina_result_json(
  input: Input,
  plan: sina_query.HistoryQuery,
  provider_value: sina_history.History,
  batch: finance_ohlcv.Batch,
  retrieved_at: time.Instant,
  receipt: gap_receipt.Receipt,
  receipt_digest: provenance_identity.Sha256,
  series_value: series_handoff.Handoff,
) -> json.Json {
  json.object(
    list.append(track_json.result_fields(sina_result_context(input)), [
      #("provider", json.string("sina")),
      #("selectedProvider", json.string("sina")),
      #("selectionMode", json.string("explicit_user_choice")),
      #("fallbackPerformed", json.bool(False)),
      #(
        "dataSourceChange",
        json.string("eastmoney->sina_by_explicit_user_choice"),
      ),
      #(
        "providerAttempts",
        json.array(
          [
            json.object([
              #("provider", json.string("sina")),
              #("outcome", json.string("selected")),
              #("error", json.null()),
            ]),
          ],
          fn(value) { value },
        ),
      ),
      #("route", json.string("explicit_alternative")),
      #("venue", json.string(query.market_name(input.market))),
      #("board", json.string(input.board)),
      #("shareClass", json.string(input.share_class)),
      #("code", json.string(sina_history.code(provider_value))),
      #("name", json.null()),
      #(
        "identityEvidence",
        json.string("caller_declared_response_does_not_echo_identity"),
      ),
      #("startDate", json.string(date_text(sina_query.history_start(plan)))),
      #("endDate", json.string(date_text(sina_query.history_end(plan)))),
      #("interval", json.string("1_day")),
      #("session", json.string(session_name(finance_ohlcv.session(batch)))),
      #("sessionTimezone", json.string("Asia/Shanghai")),
      #("currency", json.string(currency.code(finance_ohlcv.currency(batch)))),
      #(
        "currencyEvidence",
        json.string("caller_declared_not_provider_verified"),
      ),
      #(
        "volumeUnit",
        json.string(volume_unit_name(finance_ohlcv.volume_unit(batch))),
      ),
      #("providerVolumeUnit", json.null()),
      #("amountUnit", json.null()),
      #(
        "adjustment",
        json.string(adjustment_name(finance_ohlcv.adjustment(batch))),
      ),
      #(
        "retrievedAtUnixMilliseconds",
        json.int(time.unix_milliseconds(retrieved_at)),
      ),
      #("pagesFetched", json.int(1)),
      #("pagination", pagination_json(finance_ohlcv.pagination(batch))),
      #(
        "availability",
        json.string(availability_name(finance_ohlcv.availability(batch))),
      ),
      #(
        "duplicatesCollapsed",
        json.int(finance_ohlcv.duplicates_collapsed(batch)),
      ),
      #(
        "calendarCompleteness",
        calendar_json(finance_ohlcv.calendar_assessment(batch)),
      ),
      #(
        "gapAssessmentReceipt",
        gap_assessment_receipt_json(receipt, receipt_digest),
      ),
      #("sourceReference", json.string(gap_receipt.source_reference(receipt))),
      #(
        "acquisitionReceipt",
        json.string(provenance_identity.sha256_value(receipt_digest)),
      ),
      #("seriesReceipt", json.string(series_handoff.receipt(series_value))),
      #(
        "providerRows",
        json.array(sina_history.bars(provider_value), sina_provider_row_json),
      ),
      #("bars", json.array(finance_ohlcv.observations(batch), bar_json)),
      #("entitlement", json.string("public_web_local_analysis")),
      #("redistribution", json.string("unknown")),
      #("limitations", json.array(limitations(), json.string)),
    ]),
  )
}

fn sina_history_series_handoff(
  input: Input,
  value: sina_history.History,
  retrieved_at: time.Instant,
  receipt: gap_receipt.Receipt,
) -> Result(series_handoff.Handoff, String) {
  use mic <- result.try(case input.market {
    query.CnSse -> Ok("XSHG")
    query.CnSzse -> Ok("XSHE")
    query.CnBse -> Error("Sina provider does not support BSE")
    query.Hk -> Error("Sina provider is CN-track only")
  })
  let bars =
    sina_history.bars(value)
    |> list.map(fn(bar) {
      series_handoff.Bar(
        date: date_text(sina_history.date(bar)),
        open: sina_history.open(bar),
        high: sina_history.high(bar),
        low: sina_history.low(bar),
        close: sina_history.close(bar),
        volume: sina_history.volume(bar),
        amount: "unknown",
      )
    })
  series_handoff.new(
    track: "cn",
    instrument_id: sina_history.code(value),
    mic: mic,
    timezone: "Asia/Shanghai",
    source_language: "zh-CN",
    price_unit: currency.code(input.declared_currency),
    volume_unit: "provider_defined_unknown",
    adjustment: "raw",
    provider: "sina",
    source_reference: gap_receipt.source_reference(receipt),
    retrieved_at_unix_milliseconds: time.unix_milliseconds(retrieved_at),
    source_cutoff_unix_milliseconds: None,
    entitlement: "public_web_local_analysis",
    limitations: limitations(),
    bars: bars,
  )
  |> result.map_error(fn(error) {
    "Sina CN OHLCV series handoff could not be created: "
    <> series_handoff.error_message(error)
  })
}

fn history_series_handoff(
  input: Input,
  value: history.History,
  retrieved_at: time.Instant,
  receipt: gap_receipt.Receipt,
) -> Result(series_handoff.Handoff, String) {
  use mic <- result.try(case input.market {
    query.CnSse -> Ok("XSHG")
    query.CnSzse -> Ok("XSHE")
    query.CnBse -> Ok("XBSE")
    query.Hk -> Error("HK market cannot enter a CN OHLCV series handoff")
  })
  let bars =
    history.bars(value)
    |> list.map(fn(bar) {
      series_handoff.Bar(
        date: date_text(history.date(bar)),
        open: history.open(bar),
        high: history.high(bar),
        low: history.low(bar),
        close: history.close(bar),
        volume: history.volume(bar),
        amount: history.amount(bar),
      )
    })
  series_handoff.new(
    track: "cn",
    instrument_id: history.code(value),
    mic: mic,
    timezone: "Asia/Shanghai",
    source_language: "zh-CN",
    price_unit: currency.code(input.declared_currency),
    volume_unit: "provider_defined_unknown",
    adjustment: "raw",
    provider: "eastmoney",
    source_reference: gap_receipt.source_reference(receipt),
    retrieved_at_unix_milliseconds: time.unix_milliseconds(retrieved_at),
    source_cutoff_unix_milliseconds: None,
    entitlement: "public_web_local_analysis",
    limitations: limitations(),
    bars: bars,
  )
  |> result.map_error(fn(error) {
    "CN OHLCV series handoff could not be created: "
    <> series_handoff.error_message(error)
  })
}

fn gap_assessment_receipt_json(
  value: gap_receipt.Receipt,
  digest: provenance_identity.Sha256,
) -> json.Json {
  json.object([
    #("schema", json.string(gap_receipt.schema_name)),
    #("schemaVersion", json.int(gap_receipt.schema_version)),
    #("digestAlgorithm", json.string(gap_receipt.digest_algorithm)),
    #("digest", json.string(provenance_identity.sha256_value(digest))),
    #("provider", json.string(gap_receipt.provider(value))),
    #("venue", json.string(gap_receipt.venue_name(gap_receipt.venue(value)))),
    #("board", json.string(gap_receipt.board_name(gap_receipt.board(value)))),
    #(
      "shareClass",
      json.string(gap_receipt.share_class_name(gap_receipt.share_class(value))),
    ),
    #("currency", json.string(value |> gap_receipt.currency |> currency.code)),
    #("code", json.string(gap_receipt.code(value))),
    #("startDate", json.string(date_text(gap_receipt.start_date(value)))),
    #("endDate", json.string(date_text(gap_receipt.end_date(value)))),
    #("limit", json.int(gap_receipt.limit(value))),
    #("sourceReference", json.string(gap_receipt.source_reference(value))),
    #(
      "retrievedAtUnixMilliseconds",
      json.int(time.unix_milliseconds(gap_receipt.retrieved_at(value))),
    ),
    #(
      "pagination",
      json.string(gap_receipt.pagination_name(gap_receipt.pagination(value))),
    ),
    #("pages", json.array(gap_receipt.pages(value), receipt_page_json)),
    #(
      "barDates",
      json.array(gap_receipt.bar_dates(value), fn(value) {
        value |> date_text |> json.string
      }),
    ),
    #(
      "integrity",
      json.object([
        #("state", json.string("sha256_content_bound")),
        #("scope", json.string("canonical_cn_gap_projection_v1")),
        #("providerAuthenticated", json.bool(False)),
      ]),
    ),
  ])
}

fn receipt_page_json(value: gap_receipt.Page) -> json.Json {
  json.object([
    #("sequence", json.int(gap_receipt.page_sequence(value))),
    #(
      "requestId",
      json.nullable(gap_receipt.page_request_id(value), json.string),
    ),
    #("byteLength", json.int(gap_receipt.page_byte_length(value))),
    #(
      "contentSha256",
      value
        |> gap_receipt.page_content_sha256
        |> provenance_identity.sha256_value
        |> json.string,
    ),
  ])
}

fn provider_row_json(value: history.Bar) -> json.Json {
  json.object([
    #("date", json.string(date_text(history.date(value)))),
    #("open", json.string(history.open(value))),
    #("close", json.string(history.close(value))),
    #("high", json.string(history.high(value))),
    #("low", json.string(history.low(value))),
    #("volume", json.string(history.volume(value))),
    #("amount", json.string(history.amount(value))),
    #("amplitudePercent", json.string(history.amplitude_percent(value))),
    #("changePercent", json.string(history.change_percent(value))),
    #("change", json.string(history.change(value))),
    #("turnoverPercent", json.string(history.turnover_percent(value))),
  ])
}

fn sina_provider_row_json(value: sina_history.Bar) -> json.Json {
  json.object([
    #("date", json.string(date_text(sina_history.date(value)))),
    #("open", json.string(sina_history.open(value))),
    #("close", json.string(sina_history.close(value))),
    #("high", json.string(sina_history.high(value))),
    #("low", json.string(sina_history.low(value))),
    #("volume", json.string(sina_history.volume(value))),
    #("amount", json.null()),
    #("providerFields", json.object([])),
  ])
}

fn bar_json(value: Observation(finance_ohlcv.Bar)) -> json.Json {
  let bar = value.value
  json.object([
    #("providerDate", json.string(finance_ohlcv.source_timestamp(bar))),
    #("asOfBasis", json.string(time_basis_name(finance_ohlcv.time_basis(bar)))),
    #("asOfUnixMilliseconds", json.int(time.unix_milliseconds(value.as_of))),
    #("sessionDate", json.string(date_text(finance_ohlcv.session_date(bar)))),
    #(
      "retrievedAtUnixMilliseconds",
      json.int(time.unix_milliseconds(value.retrieved_at)),
    ),
    #(
      "source",
      json.object([
        #("provider", json.string(source.provider(value.source))),
        #("reference", json.string(source.reference(value.source))),
      ]),
    ),
    #(
      "raw",
      json.object([
        #("open", json.string(finance_ohlcv.raw(finance_ohlcv.open(bar)))),
        #("high", json.string(finance_ohlcv.raw(finance_ohlcv.high(bar)))),
        #("low", json.string(finance_ohlcv.raw(finance_ohlcv.low(bar)))),
        #("close", json.string(finance_ohlcv.raw(finance_ohlcv.close(bar)))),
        #("volume", json.string(finance_ohlcv.raw(finance_ohlcv.volume(bar)))),
        #("tradeCount", json.null()),
        #("vwap", json.null()),
      ]),
    ),
    #(
      "normalized",
      json.object([
        #("open", decimal_json(finance_ohlcv.open(bar))),
        #("high", decimal_json(finance_ohlcv.high(bar))),
        #("low", decimal_json(finance_ohlcv.low(bar))),
        #("close", decimal_json(finance_ohlcv.close(bar))),
        #("volume", decimal_json(finance_ohlcv.volume(bar))),
        #("tradeCount", json.null()),
        #("vwap", json.null()),
      ]),
    ),
  ])
}

fn pagination_json(value: finance_ohlcv.Pagination) -> json.Json {
  json.object([
    #("state", json.string(pagination_name(value))),
    #("continuationTokenAvailable", json.bool(False)),
    #("maximumPages", case value {
      finance_ohlcv.TruncatedByPageBudget(maximum) -> json.int(maximum)
      _ -> json.null()
    }),
    #("maximumBars", case value {
      finance_ohlcv.TruncatedByBarBudget(maximum) -> json.int(maximum)
      _ -> json.null()
    }),
  ])
}

fn pagination_name(value: finance_ohlcv.Pagination) -> String {
  case value {
    finance_ohlcv.AllPages -> "complete"
    finance_ohlcv.TruncatedByPageBudget(_) -> "truncated_by_page_budget"
    finance_ohlcv.TruncatedByBarBudget(_) -> "truncated_by_bar_budget"
  }
}

fn calendar_json(value: finance_ohlcv.CalendarAssessment) -> json.Json {
  case value {
    finance_ohlcv.CalendarNotAssessed(reason) ->
      json.object([
        #("state", json.string("calendar_not_assessed")),
        #("reason", json.string(reason)),
        #("gaps", json.array([], fn(value) { value })),
      ])
    finance_ohlcv.CalendarAssessed(gaps) ->
      json.object([
        #("state", json.string("calendar_assessed")),
        #("reason", json.null()),
        #("gaps", json.array(gaps, gap_json)),
      ])
  }
}

fn gap_json(value: finance_ohlcv.Gap) -> json.Json {
  let finance_ohlcv.Gap(session_date, state, evidence) = value
  json.object([
    #("sessionDate", json.string(date_text(session_date))),
    #("state", json.string(gap_name(state))),
    #("evidenceReference", json.nullable(evidence, json.string)),
  ])
}

fn gap_name(value: finance_ohlcv.GapState) -> String {
  case value {
    finance_ohlcv.MarketClosure -> "market_closure"
    finance_ohlcv.Suspension -> "suspension"
    finance_ohlcv.ProviderOmission -> "provider_omission"
    finance_ohlcv.UnavailableHistory -> "unavailable_history"
  }
}

fn availability_name(value: finance_ohlcv.Availability) -> String {
  case value {
    finance_ohlcv.BarsReturned -> "bars_returned"
    finance_ohlcv.NoBarsReturned -> "no_bars_returned_unclassified"
  }
}

fn time_basis_name(value: finance_ohlcv.TimeBasis) -> String {
  case value {
    finance_ohlcv.SourceInstant -> "source_instant"
    finance_ohlcv.SessionDateAnchor -> "session_date_anchor"
  }
}

fn volume_unit_name(value: finance_ohlcv.VolumeUnit) -> String {
  case value {
    finance_ohlcv.Shares -> "shares"
    finance_ohlcv.UnknownVolumeUnit -> "unknown"
  }
}

fn adjustment_name(value: adjustment.Adjustment) -> String {
  case value {
    adjustment.Raw -> "raw"
    adjustment.SplitAdjusted -> "split_adjusted"
    adjustment.DividendAdjusted -> "dividend_adjusted"
    adjustment.TotalReturnAdjusted -> "total_return_adjusted"
    adjustment.ProviderAdjusted(_) -> "provider_adjusted"
  }
}

fn session_name(value: market.Session) -> String {
  case value {
    market.PreMarket -> "pre_market"
    market.Regular -> "regular"
    market.AfterHours -> "after_hours"
    market.Auction -> "auction"
    market.Closed -> "closed"
    market.OtherSession(label) -> market.label(label)
  }
}

fn decimal_json(value: finance_ohlcv.ExactValue) -> json.Json {
  value |> finance_ohlcv.normalized |> decimal.to_string |> json.string
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
