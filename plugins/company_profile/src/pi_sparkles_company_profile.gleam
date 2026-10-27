import finance_core/time
import finance_equibles
import finance_equibles/request as equibles_request
import finance_equibles/response as equibles_response
import finance_equibles/runtime as equibles_runtime
import finance_http/client
import finance_http/pool
import finance_http/response as http_response
import finance_http/transport
import finance_provenance/hash
import finance_provenance/identity.{type Sha256}
import finance_twelve_data
import finance_twelve_data/request as provider_request
import finance_twelve_data/response as provider_response
import finance_twelve_data/runtime
import gleam/dynamic/decode
import gleam/int
import gleam/javascript/promise.{type Promise}
import gleam/json
import gleam/option.{None, Some}
import gleam/result
import gleam/string
import pi
import pi/raw
import pi/schema
import pi/tool
import pi_sparkles_company_profile/domain
import pi_sparkles_company_profile/effect/environment

type Hosts {
  Hosts(
    twelve: Result(runtime.Runtime, Nil),
    equibles: Result(equibles_runtime.Runtime, Nil),
  )
}

pub fn extension(api: pi.ExtensionApi) -> Promise(Nil) {
  let hosts = hosts()
  tool.register(
    api,
    "company_profile",
    "Exact US company snapshot",
    "Retrieve one exact US listing snapshot from the explicitly selected provider. twelve_data reads Twelve Data profile and MIC-matched statistics. equibles reads one Equibles screener row and ownership summary, does not confirm the caller MIC, and is US-listing only. No fallback, identity relabelling, quality scoring, or investment judgment",
    "Default provider is twelve_data and requires TWELVE_DATA_API_KEY. Pass provider equibles to use EQUIBLES_API_KEY. The providers are not interchangeable and never fall back to each other",
    tool.parameters(input_schema(), input_decoder()),
    tool.Parallel,
    fn(id, input, signal, _updates, _ctx) {
      let cancellation = transport.from_abort_signal(raw.dynamic(signal))
      case input.vendor {
        domain.TwelveData -> fetch_twelve(hosts, input, id, cancellation)
        domain.Equibles -> fetch_equibles(hosts, input, id, cancellation)
      }
    },
  )
  promise.resolve(Nil)
}

fn hosts() -> Hosts {
  Hosts(
    twelve: runtime.new() |> result.map_error(fn(_) { Nil }),
    equibles: equibles_runtime.new() |> result.map_error(fn(_) { Nil }),
  )
}

fn fetch_twelve(
  hosts: Hosts,
  input: domain.Input,
  id: String,
  cancellation: transport.Cancellation,
) -> Promise(tool.ToolResult) {
  case finance_twelve_data.access(environment.api_key()) {
    Error(_) ->
      tool.reject(
        "company_profile requires the caller's TWELVE_DATA_API_KEY with Twelve Data profile and statistics access",
      )
    Ok(access) ->
      case hosts.twelve {
        Error(_) ->
          tool.reject(
            "Twelve Data company profile runtime could not initialize safely",
          )
        Ok(provider_runtime) -> {
          use capture <- promise.await(fetch(
            provider_runtime,
            access,
            input,
            id,
            cancellation,
          ))
          case capture {
            Error(message) -> tool.reject(message)
            Ok(value) ->
              case domain.assemble(input, value) {
                Error(error) -> tool.reject(domain.error_message(error))
                Ok(output) ->
                  tool.text_result(output.summary, output.details)
                  |> promise.resolve
              }
          }
        }
      }
  }
}

fn fetch_equibles(
  hosts: Hosts,
  input: domain.Input,
  id: String,
  cancellation: transport.Cancellation,
) -> Promise(tool.ToolResult) {
  case finance_equibles.access(environment.equibles_api_key()) {
    Error(_) ->
      tool.reject(
        "company_profile requires the caller's EQUIBLES_API_KEY with Equibles screener and ownership-summary access",
      )
    Ok(access) ->
      case hosts.equibles {
        Error(_) ->
          tool.reject(
            "Equibles company snapshot runtime could not initialize safely",
          )
        Ok(provider_runtime) -> {
          use capture <- promise.await(fetch_equibles_snapshot(
            provider_runtime,
            access,
            input,
            id,
            cancellation,
          ))
          case capture {
            Error(message) -> tool.reject(message)
            Ok(value) ->
              case domain.assemble_equibles(input, value) {
                Error(error) -> tool.reject(domain.error_message(error))
                Ok(output) ->
                  tool.text_result(output.summary, output.details)
                  |> promise.resolve
              }
          }
        }
      }
  }
}

fn fetch(
  provider_runtime: runtime.Runtime,
  access: finance_twelve_data.Access,
  input: domain.Input,
  id: String,
  cancellation: transport.Cancellation,
) -> Promise(Result(domain.Capture, String)) {
  case provider_request.profile(access, input.symbol, input.mic) {
    Error(_) ->
      promise.resolve(Error("Twelve Data profile request was invalid"))
    Ok(request_value) -> {
      use sent <- promise.await(runtime.send(
        provider_runtime,
        id: id <> ":profile",
        request: request_value,
        cancellation: cancellation,
      ))
      case checked_response(sent, "profile") {
        Error(message) -> promise.resolve(Error(message))
        Ok(response) -> {
          let body = http_response.body(response)
          case provider_response.decode_profile(body), hash.text(body) {
            Error(_), _ ->
              promise.resolve(Error(
                "Twelve Data returned an invalid profile response",
              ))
            _, Error(_) ->
              promise.resolve(Error(
                "Twelve Data profile response could not be content-bound",
              ))
            Ok(profile), Ok(content_hash) ->
              case profile.symbol == input.symbol && profile.mic == input.mic {
                False ->
                  promise.resolve(Error(
                    "Twelve Data profile did not match the exact requested symbol and MIC",
                  ))
                True ->
                  fetch_statistics(
                    provider_runtime,
                    access,
                    input,
                    id,
                    cancellation,
                    profile,
                    receipt(
                      provider_request.profile_path,
                      response,
                      content_hash,
                    ),
                  )
              }
          }
        }
      }
    }
  }
}

fn fetch_statistics(
  provider_runtime: runtime.Runtime,
  access: finance_twelve_data.Access,
  input: domain.Input,
  id: String,
  cancellation: transport.Cancellation,
  profile: provider_response.Profile,
  profile_receipt: domain.Receipt,
) -> Promise(Result(domain.Capture, String)) {
  case provider_request.statistics(access, input.symbol, input.mic) {
    Error(_) ->
      promise.resolve(Error("Twelve Data statistics request was invalid"))
    Ok(request_value) -> {
      use sent <- promise.await(runtime.send(
        provider_runtime,
        id: id <> ":statistics",
        request: request_value,
        cancellation: cancellation,
      ))
      case checked_response(sent, "statistics") {
        Error(message) -> promise.resolve(Error(message))
        Ok(response) -> {
          let body = http_response.body(response)
          case provider_response.decode_statistics(body), hash.text(body) {
            Error(_), _ ->
              promise.resolve(Error(
                "Twelve Data returned an invalid statistics response",
              ))
            _, Error(_) ->
              promise.resolve(Error(
                "Twelve Data statistics response could not be content-bound",
              ))
            Ok(statistics), Ok(content_hash) ->
              case time.instant(environment.now_milliseconds()) {
                Error(_) ->
                  promise.resolve(Error(
                    "company_profile retrieval clock was invalid",
                  ))
                Ok(retrieved_at) ->
                  promise.resolve(
                    Ok(domain.Capture(
                      profile,
                      profile_receipt,
                      statistics,
                      receipt(
                        provider_request.statistics_path,
                        response,
                        content_hash,
                      ),
                      retrieved_at,
                    )),
                  )
              }
          }
        }
      }
    }
  }
}

fn fetch_equibles_snapshot(
  provider_runtime: equibles_runtime.Runtime,
  access: finance_equibles.Access,
  input: domain.Input,
  id: String,
  cancellation: transport.Cancellation,
) -> Promise(Result(domain.EquiblesCapture, String)) {
  case equibles_request.screener(access, input.symbol) {
    Error(_) -> promise.resolve(Error("Equibles screener request was invalid"))
    Ok(request_value) -> {
      use sent <- promise.await(equibles_runtime.send(
        provider_runtime,
        id: id <> ":screener",
        request: request_value,
        cancellation: cancellation,
      ))
      case checked_equibles(sent, "screener") {
        Error(message) -> promise.resolve(Error(message))
        Ok(response) -> {
          let body = http_response.body(response)
          case
            equibles_response.decode_screener(body, input.symbol),
            hash.text(body)
          {
            Error(error), _ ->
              promise.resolve(Error(equibles_decode_message(error, "screener")))
            _, Error(_) ->
              promise.resolve(Error(
                "Equibles screener response could not be content-bound",
              ))
            Ok(listing), Ok(content_hash) ->
              fetch_equibles_ownership(
                provider_runtime,
                access,
                input,
                id,
                cancellation,
                listing,
                equibles_receipt(
                  equibles_request.screener_path,
                  response,
                  content_hash,
                ),
              )
          }
        }
      }
    }
  }
}

fn fetch_equibles_ownership(
  provider_runtime: equibles_runtime.Runtime,
  access: finance_equibles.Access,
  input: domain.Input,
  id: String,
  cancellation: transport.Cancellation,
  listing: equibles_response.Listing,
  listing_receipt: domain.EquiblesReceipt,
) -> Promise(Result(domain.EquiblesCapture, String)) {
  case equibles_request.ownership_summary(access, input.symbol) {
    Error(_) ->
      promise.resolve(Error("Equibles ownership-summary request was invalid"))
    Ok(request_value) -> {
      use sent <- promise.await(equibles_runtime.send(
        provider_runtime,
        id: id <> ":ownership",
        request: request_value,
        cancellation: cancellation,
      ))
      case checked_equibles(sent, "ownership-summary") {
        Error(message) -> promise.resolve(Error(message))
        Ok(response) -> {
          let body = http_response.body(response)
          case
            equibles_response.decode_shares(body, input.symbol),
            hash.text(body)
          {
            Error(error), _ ->
              promise.resolve(
                Error(equibles_decode_message(error, "ownership-summary")),
              )
            _, Error(_) ->
              promise.resolve(Error(
                "Equibles ownership-summary response could not be content-bound",
              ))
            Ok(shares), Ok(content_hash) ->
              case time.instant(environment.now_milliseconds()) {
                Error(_) ->
                  promise.resolve(Error(
                    "company_profile retrieval clock was invalid",
                  ))
                Ok(retrieved_at) ->
                  promise.resolve(
                    Ok(domain.EquiblesCapture(
                      listing,
                      listing_receipt,
                      shares,
                      equibles_receipt(
                        equibles_request.ownership_path(input.symbol),
                        response,
                        content_hash,
                      ),
                      retrieved_at,
                    )),
                  )
              }
          }
        }
      }
    }
  }
}

fn equibles_decode_message(
  error: equibles_response.SnapshotError,
  label: String,
) -> String {
  case error {
    equibles_response.Malformed ->
      "Equibles returned an invalid " <> label <> " response"
    equibles_response.NotFound
    | equibles_response.Ambiguous
    | equibles_response.TickerMismatch
    | equibles_response.MarketNotUs ->
      case label {
        "screener" -> "Equibles screener did not return the exact US listing"
        _ -> "Equibles ownership summary did not match the requested ticker"
      }
  }
}

fn checked_response(
  outcome: Result(http_response.Response, runtime.SendError),
  label: String,
) -> Result(http_response.Response, String) {
  case outcome {
    Error(runtime.RequestFailed(pool.RequestFailed(client.RetryStopped(
      _,
      _,
      client.StatusFailure(http_response.SafeSummary(status, _, _)),
    )))) -> provider_status_error(label, status)
    Error(error) ->
      Error(
        "Twelve Data "
        <> label
        <> " request failed safely: "
        <> string.inspect(error),
      )
    Ok(value) -> {
      let status = http_response.status(value)
      case status >= 200 && status < 300 {
        True -> Ok(value)
        False -> provider_status_error(label, status)
      }
    }
  }
}

fn checked_equibles(
  outcome: Result(http_response.Response, equibles_runtime.SendError),
  label: String,
) -> Result(http_response.Response, String) {
  case outcome {
    Error(equibles_runtime.RequestFailed(pool.RequestFailed(client.RetryStopped(
      _,
      _,
      client.StatusFailure(http_response.SafeSummary(status, _, _)),
    )))) -> equibles_status_error(label, status)
    Error(error) ->
      Error(
        "Equibles "
        <> label
        <> " request failed safely: "
        <> string.inspect(error),
      )
    Ok(value) -> {
      let status = http_response.status(value)
      case status >= 200 && status < 300 {
        True -> Ok(value)
        False -> equibles_status_error(label, status)
      }
    }
  }
}

fn provider_status_error(label: String, status: Int) -> Result(value, String) {
  case status {
    400 | 404 ->
      Error(
        "Twelve Data rejected or could not resolve the exact listing (HTTP "
        <> int.to_string(status)
        <> ")",
      )
    401 -> Error("Twelve Data rejected TWELVE_DATA_API_KEY (HTTP 401)")
    403 ->
      Error(
        "Twelve Data subscription does not permit the requested endpoint (HTTP 403)",
      )
    429 ->
      Error(
        "Twelve Data API credit limit was reached (HTTP 429); no automatic retry was made",
      )
    _ ->
      Error(
        "Twelve Data "
        <> label
        <> " request returned HTTP "
        <> int.to_string(status),
      )
  }
}

fn equibles_status_error(label: String, status: Int) -> Result(value, String) {
  case status {
    401 -> Error("Equibles rejected EQUIBLES_API_KEY (HTTP 401)")
    403 ->
      Error("Equibles plan does not permit the requested endpoint (HTTP 403)")
    404 -> Error("Equibles could not resolve the exact listing (HTTP 404)")
    429 ->
      Error(
        "Equibles daily request limit was reached (HTTP 429); no automatic retry was made",
      )
    _ ->
      Error(
        "Equibles "
        <> label
        <> " request returned HTTP "
        <> int.to_string(status),
      )
  }
}

fn receipt(
  endpoint: String,
  response: http_response.Response,
  content_hash: Sha256,
) -> domain.Receipt {
  domain.Receipt(
    endpoint,
    http_response.byte_length(response),
    content_hash,
    http_response.first_header(response, name: "api-credits-used"),
    http_response.first_header(response, name: "api-credits-left"),
    http_response.first_header(response, name: "api-credits-request"),
  )
}

fn equibles_receipt(
  endpoint: String,
  response: http_response.Response,
  content_hash: Sha256,
) -> domain.EquiblesReceipt {
  domain.EquiblesReceipt(
    endpoint,
    http_response.byte_length(response),
    content_hash,
    http_response.first_header(response, name: "x-ratelimit-limit"),
    http_response.first_header(response, name: "x-ratelimit-remaining"),
    http_response.first_header(response, name: "x-ratelimit-reset"),
  )
}

fn input_schema() -> schema.Schema {
  schema.object([
    schema.Required(
      "symbol",
      schema.string()
        |> schema.with_string_length(1, 20)
        |> schema.described("Exact uppercase US listing symbol"),
    ),
    schema.Required(
      "mic",
      schema.string_enum(["XNYS", "XNAS", "XNGS", "XNCM", "XNMS"])
        |> schema.described(
          "Caller MIC. Twelve Data must echo it. Equibles does not accept or confirm it",
        ),
    ),
    schema.Optional(
      "provider",
      schema.string_enum(["twelve_data", "equibles"])
        |> schema.described(
          "Explicit provider. Defaults to twelve_data. equibles uses EQUIBLES_API_KEY and does not fall back to Twelve Data",
        )
        |> schema.with_default(json.string("twelve_data")),
    ),
  ])
}

fn input_decoder() -> decode.Decoder(domain.Input) {
  use symbol <- decode.field("symbol", decode.string)
  use mic <- decode.field("mic", decode.string)
  use provider <- decode.optional_field(
    "provider",
    None,
    decode.optional(decode.string),
  )
  let vendor = case provider {
    Some(name) -> name
    None -> "twelve_data"
  }
  case domain.selected_input(symbol, mic, vendor) {
    Ok(input) -> decode.success(input)
    Error(error) -> {
      let assert Ok(fallback) = domain.input("AAPL", "XNGS")
      decode.failure(fallback, domain.error_message(error))
    }
  }
}
