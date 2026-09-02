import finance_core/time
import finance_http/request
import finance_sina.{type Access}
import finance_sina/query.{type HistoryQuery}
import gleam/int
import gleam/option.{None}
import gleam/result

pub const origin = "https://money.finance.sina.com.cn"

pub const history_path = "/quotes_service/api/json_v2.php/CN_MarketData.getKLineData"

pub type RequestError {
  InvalidHttp(request.RequestError)
  InvalidAccess(finance_sina.AccessError)
}

pub fn history(
  access: Access,
  plan: HistoryQuery,
) -> Result(request.Request, RequestError) {
  let assert Ok(timeout) = time.duration(15_000)
  use base <- result.try(
    request.new(request.Get, origin, history_path, None)
    |> result.map_error(InvalidHttp),
  )
  use bounded <- result.try(
    request.with_limits(base, timeout, 1_000_000)
    |> result.map_error(InvalidHttp),
  )
  use accepted <- result.try(public_header(
    bounded,
    "Accept",
    "application/json",
  ))
  use value <- result.try(public_query(
    accepted,
    "symbol",
    query.history_symbol(plan),
  ))
  use value <- result.try(public_query(value, "scale", "240"))
  use value <- result.try(public_query(value, "ma", "no"))
  use value <- result.try(public_query(
    value,
    "datalen",
    int.to_string(query.history_limit(plan)),
  ))
  finance_sina.authorize(access, value) |> result.map_error(InvalidAccess)
}

fn public_header(
  value: request.Request,
  name: String,
  header: String,
) -> Result(request.Request, RequestError) {
  request.with_header(value, name, header, request.Public)
  |> result.map_error(InvalidHttp)
}

fn public_query(
  value: request.Request,
  name: String,
  parameter: String,
) -> Result(request.Request, RequestError) {
  request.with_query(value, name, parameter, request.Public)
  |> result.map_error(InvalidHttp)
}
