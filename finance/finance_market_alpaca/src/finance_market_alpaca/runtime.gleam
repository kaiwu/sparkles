import finance_core/time
import finance_http/client
import finance_http/limiter
import finance_http/pool
import finance_http/rate_limit
import finance_http/request
import finance_http/response.{type Response}
import finance_http/retry
import finance_http/scheduler
import finance_http/transport.{type Cancellation, type TransportError}
import finance_market_alpaca/query
import finance_market_alpaca/request as provider_request
import gleam/javascript/promise.{type Promise}
import gleam/result

pub opaque type Runtime {
  Runtime(pool: pool.Pool)
}

pub type InitError {
  InvalidRate(rate_limit.RateLimitError)
  InvalidPool(scheduler.SchedulerError)
}

pub type SendError {
  UnexpectedTarget
  RequestFailed(pool.PoolError)
}

pub fn new() -> Result(Runtime, InitError) {
  new_configured(
    transport.send,
    client.cancellable_sleep,
    client.system_clock,
    True,
  )
}

pub fn new_with(
  sender: client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
) -> Result(Runtime, InitError) {
  new_configured(sender, sleeper, clock, False)
}

fn new_configured(
  sender: client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
  share_limit: Bool,
) -> Result(Runtime, InitError) {
  let now = clock()
  let assert Ok(window) = time.duration(60_000)
  let assert Ok(reset_at) = time.instant(time.unix_milliseconds(now) + 60_000)
  use state <- result.try(
    rate_limit.new(limit: 180, remaining: 180, reset_at:, window:)
    |> result.map_error(InvalidRate),
  )
  let admission = case share_limit {
    True -> limiter.shared("alpaca:all-authorities:180-per-60000ms:v1", state)
    False -> limiter.isolated(state)
  }
  let policy_client =
    client.new(
      retry_policy(),
      fn(req, cancel) {
        gated_send(admission, req, cancel, sender, sleeper, clock)
      },
      sleeper,
      clock,
    )
  pool.new(
    policy_client,
    maximum_in_flight: 2,
    maximum_per_origin: 2,
    maximum_waiting: 20,
  )
  |> result.map(Runtime)
  |> result.map_error(InvalidPool)
}

pub fn send(
  runtime: Runtime,
  id id: String,
  request request_value: request.Request,
  cancellation cancellation: Cancellation,
) -> Promise(Result(Response, SendError)) {
  case
    {
      request.origin(request_value) == provider_request.origin
      && {
        request.path(request_value) == provider_request.bars_path
        || request.path(request_value) == provider_request.latest_quotes_path
        || request.path(request_value)
        == provider_request.corporate_actions_path
        || request.path(request_value) == provider_request.news_path
      }
    }
    || {
      {
        request.origin(request_value) == query.trading_origin(query.Paper)
        || request.origin(request_value) == query.trading_origin(query.Live)
      }
      && request.path(request_value) == provider_request.assets_path
    }
  {
    False -> promise.resolve(Error(UnexpectedTarget))
    True -> {
      let Runtime(pool_value) = runtime
      use outcome <- promise.await(pool.send(
        pool_value,
        id: id,
        request: request_value,
        cancellation: cancellation,
      ))
      promise.resolve(outcome |> result.map_error(RequestFailed))
    }
  }
}

fn gated_send(
  admission: limiter.Limiter,
  req: request.Request,
  cancel: Cancellation,
  sender: client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
) -> Promise(Result(Response, TransportError)) {
  use admitted <- promise.await(limiter.admit(admission, cancel, sleeper, clock))
  case admitted {
    Error(error) -> promise.resolve(Error(error))
    Ok(Nil) -> sender(req, cancel)
  }
}

fn retry_policy() -> retry.Policy {
  let assert Ok(elapsed) = time.duration(20_000)
  let assert Ok(base) = time.duration(250)
  let assert Ok(maximum) = time.duration(2000)
  let assert Ok(value) =
    retry.policy(
      maximum_attempts: 3,
      maximum_elapsed: elapsed,
      base_delay: base,
      maximum_delay: maximum,
    )
  value
}
