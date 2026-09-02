import finance_authority_snapshot/runtime as bounded_runtime
import finance_core/time
import finance_eastmoney.{type Access}
import finance_eastmoney/request as provider_request
import finance_http/client
import finance_http/pool
import finance_http/request
import finance_http/response.{type Response}
import finance_http/transport.{type Cancellation}
import gleam/javascript/promise.{type Promise}
import gleam/result

pub opaque type Runtime {
  Runtime(
    quote: bounded_runtime.Runtime,
    cn_overview: bounded_runtime.Runtime,
    cn_movers: bounded_runtime.Runtime,
    history: bounded_runtime.Runtime,
    cn_fundamentals: bounded_runtime.Runtime,
    hk_fundamentals: bounded_runtime.Runtime,
  )
}

pub type InitError {
  InvalidQuoteRuntime(bounded_runtime.InitError)
  InvalidCnOverviewRuntime(bounded_runtime.InitError)
  InvalidCnMoversRuntime(bounded_runtime.InitError)
  InvalidHistoryRuntime(bounded_runtime.InitError)
  InvalidCnFundamentalsRuntime(bounded_runtime.InitError)
  InvalidHkFundamentalsRuntime(bounded_runtime.InitError)
}

pub type SendError {
  UnexpectedOrigin
  RequestFailed(pool.PoolError)
}

pub fn new(_access: Access) -> Result(Runtime, InitError) {
  use quote <- result.try(
    bounded_runtime.new(policy(
      provider_request.quote_origin,
      provider_request.quote_path,
    ))
    |> result.map_error(InvalidQuoteRuntime),
  )
  use cn_overview <- result.try(
    bounded_runtime.new(policy(
      provider_request.quote_origin,
      provider_request.cn_overview_path,
    ))
    |> result.map_error(InvalidCnOverviewRuntime),
  )
  use cn_movers <- result.try(
    bounded_runtime.new(one_shot_policy(
      provider_request.quote_origin,
      provider_request.cn_movers_path,
    ))
    |> result.map_error(InvalidCnMoversRuntime),
  )
  use history <- result.try(
    bounded_runtime.new(policy(
      provider_request.history_origin,
      provider_request.history_path,
    ))
    |> result.map_error(InvalidHistoryRuntime),
  )
  use cn_fundamentals <- result.try(
    bounded_runtime.new(policy(
      provider_request.cn_fundamentals_origin,
      provider_request.cn_fundamentals_path,
    ))
    |> result.map_error(InvalidCnFundamentalsRuntime),
  )
  use hk_fundamentals <- result.try(
    bounded_runtime.new(policy(
      provider_request.hk_fundamentals_origin,
      provider_request.hk_fundamentals_path,
    ))
    |> result.map_error(InvalidHkFundamentalsRuntime),
  )
  Ok(Runtime(
    quote,
    cn_overview,
    cn_movers,
    history,
    cn_fundamentals,
    hk_fundamentals,
  ))
}

pub fn new_with(
  _access: Access,
  sender: client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
) -> Result(Runtime, InitError) {
  use quote <- result.try(
    bounded_runtime.new_with(
      policy(provider_request.quote_origin, provider_request.quote_path),
      sender,
      sleeper,
      clock,
    )
    |> result.map_error(InvalidQuoteRuntime),
  )
  use cn_overview <- result.try(
    bounded_runtime.new_with(
      policy(provider_request.quote_origin, provider_request.cn_overview_path),
      sender,
      sleeper,
      clock,
    )
    |> result.map_error(InvalidCnOverviewRuntime),
  )
  use cn_movers <- result.try(
    bounded_runtime.new_with(
      one_shot_policy(
        provider_request.quote_origin,
        provider_request.cn_movers_path,
      ),
      sender,
      sleeper,
      clock,
    )
    |> result.map_error(InvalidCnMoversRuntime),
  )
  use history <- result.try(
    bounded_runtime.new_with(
      policy(provider_request.history_origin, provider_request.history_path),
      sender,
      sleeper,
      clock,
    )
    |> result.map_error(InvalidHistoryRuntime),
  )
  use cn_fundamentals <- result.try(
    bounded_runtime.new_with(
      policy(
        provider_request.cn_fundamentals_origin,
        provider_request.cn_fundamentals_path,
      ),
      sender,
      sleeper,
      clock,
    )
    |> result.map_error(InvalidCnFundamentalsRuntime),
  )
  use hk_fundamentals <- result.try(
    bounded_runtime.new_with(
      policy(
        provider_request.hk_fundamentals_origin,
        provider_request.hk_fundamentals_path,
      ),
      sender,
      sleeper,
      clock,
    )
    |> result.map_error(InvalidHkFundamentalsRuntime),
  )
  Ok(Runtime(
    quote,
    cn_overview,
    cn_movers,
    history,
    cn_fundamentals,
    hk_fundamentals,
  ))
}

pub fn send(
  runtime: Runtime,
  id id: String,
  request request_value: request.Request,
  cancellation cancellation: Cancellation,
) -> Promise(Result(Response, SendError)) {
  let selected = case
    request.origin(request_value),
    request.path(request_value)
  {
    origin, path
      if origin == provider_request.quote_origin
      && path == provider_request.quote_path
    -> Ok(runtime.quote)
    origin, path
      if origin == provider_request.quote_origin
      && path == provider_request.cn_overview_path
    -> Ok(runtime.cn_overview)
    origin, path
      if origin == provider_request.quote_origin
      && path == provider_request.cn_movers_path
    -> Ok(runtime.cn_movers)
    origin, _ if origin == provider_request.history_origin -> Ok(runtime.history)
    origin, _ if origin == provider_request.cn_fundamentals_origin ->
      Ok(runtime.cn_fundamentals)
    origin, _ if origin == provider_request.hk_fundamentals_origin ->
      Ok(runtime.hk_fundamentals)
    _, _ -> Error(UnexpectedOrigin)
  }
  case selected {
    Error(error) -> promise.resolve(Error(error))
    Ok(inner) -> {
      use outcome <- promise.await(bounded_runtime.send(
        inner,
        id,
        request_value,
        cancellation,
      ))
      promise.resolve(outcome |> result.map_error(RequestFailed))
    }
  }
}

fn policy(origin: String, path: String) -> bounded_runtime.Policy {
  let assert Ok(window) = time.duration(2000)
  let assert Ok(maximum_elapsed) = time.duration(15_000)
  let assert Ok(base_delay) = time.duration(500)
  let assert Ok(maximum_delay) = time.duration(2000)
  let assert Ok(value) =
    bounded_runtime.policy(
      origin: origin,
      allowed_paths: [path],
      admissions_per_window: 1,
      window: window,
      maximum_in_flight: 1,
      maximum_waiting: 20,
      maximum_attempts: 1,
      maximum_elapsed: maximum_elapsed,
      base_delay: base_delay,
      maximum_delay: maximum_delay,
    )
  value
}

fn one_shot_policy(origin: String, path: String) -> bounded_runtime.Policy {
  let assert Ok(window) = time.duration(2000)
  let assert Ok(maximum_elapsed) = time.duration(15_000)
  let assert Ok(base_delay) = time.duration(500)
  let assert Ok(maximum_delay) = time.duration(2000)
  let assert Ok(value) =
    bounded_runtime.policy(
      origin: origin,
      allowed_paths: [path],
      admissions_per_window: 1,
      window: window,
      maximum_in_flight: 1,
      maximum_waiting: 20,
      maximum_attempts: 1,
      maximum_elapsed: maximum_elapsed,
      base_delay: base_delay,
      maximum_delay: maximum_delay,
    )
  value
}
