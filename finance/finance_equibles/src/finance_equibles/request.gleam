import finance_core/time
import finance_equibles.{type Access}
import finance_http/request
import gleam/list
import gleam/option.{None}
import gleam/result
import gleam/string

pub const origin = "https://api.equibles.com"

pub const screener_path = "/v1/screener/stocks"

pub type RequestError {
  InvalidSymbol
  InvalidHttp(request.RequestError)
  InvalidAccess(finance_equibles.AccessError)
}

pub fn screener(
  access: Access,
  symbol: String,
) -> Result(request.Request, RequestError) {
  use _ <- result.try(validate_symbol(symbol))
  use value <- result.try(prepare(access, screener_path, 200_000))
  use value <- result.try(
    request.with_query(value, "tickers", symbol, request.Public)
    |> result.map_error(InvalidHttp),
  )
  request.with_query(value, "limit", "1", request.Public)
  |> result.map_error(InvalidHttp)
}

pub fn ownership_summary(
  access: Access,
  symbol: String,
) -> Result(request.Request, RequestError) {
  use _ <- result.try(validate_symbol(symbol))
  prepare(access, ownership_path(symbol), 500_000)
}

pub fn ownership_path(symbol: String) -> String {
  "/v1/stocks/" <> symbol <> "/ownership-summary"
}

fn prepare(
  access: Access,
  path: String,
  maximum_response_bytes: Int,
) -> Result(request.Request, RequestError) {
  let assert Ok(timeout) = time.duration(15_000)
  use value <- result.try(
    request.new(request.Get, origin, path, None)
    |> result.map_error(InvalidHttp),
  )
  use value <- result.try(
    request.with_limits(value, timeout, maximum_response_bytes)
    |> result.map_error(InvalidHttp),
  )
  use value <- result.try(
    request.with_header(value, "Accept", "application/json", request.Public)
    |> result.map_error(InvalidHttp),
  )
  finance_equibles.authorize(access, value)
  |> result.map_error(InvalidAccess)
}

fn validate_symbol(value: String) -> Result(Nil, RequestError) {
  case valid_symbol(value) {
    True -> Ok(Nil)
    False -> Error(InvalidSymbol)
  }
}

fn valid_symbol(value: String) -> Bool {
  value != ""
  && string.length(value) <= 20
  && string.uppercase(value) == value
  && {
    value
    |> string.to_graphemes
    |> list.all(fn(character) {
      string.contains("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-", character)
    })
  }
}
