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
import finance_sec.{type Access}
import gleam/javascript/promise.{type Promise}
import gleam/result

pub opaque type Runtime {
  Runtime(pool: pool.Pool)
}

pub type InitError {
  InvalidRate(rate_limit.RateLimitError)
  InvalidPool(scheduler.SchedulerError)
}

pub fn new(access: Access) -> Result(Runtime, InitError) {
  new_configured(
    access,
    transport.send,
    client.cancellable_sleep,
    client.system_clock,
    True,
  )
}

pub fn new_with(
  access: Access,
  sender: client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
) -> Result(Runtime, InitError) {
  new_configured(access, sender, sleeper, clock, False)
}

fn new_configured(
  _access: Access,
  sender: client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
  share_limit: Bool,
) -> Result(Runtime, InitError) {
  let now = clock()
  let assert Ok(window) = time.duration(1000)
  let assert Ok(reset_at) = time.instant(time.unix_milliseconds(now) + 1000)
  use state <- result.try(
    rate_limit.new(limit: 8, remaining: 8, reset_at:, window:)
    |> result.map_error(InvalidRate),
  )
  let admission = case share_limit {
    True -> limiter.shared("sec:https://data.sec.gov:8-per-1000ms:v1", state)
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
    maximum_waiting: 100,
  )
  |> result.map(Runtime)
  |> result.map_error(InvalidPool)
}

pub fn send(
  runtime: Runtime,
  id id: String,
  request request_value: request.Request,
  cancellation cancellation: Cancellation,
) -> Promise(Result(Response, pool.PoolError)) {
  let Runtime(pool_value) = runtime
  pool.send(pool_value, id:, request: request_value, cancellation:)
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
    Error(e) -> promise.resolve(Error(e))
    Ok(Nil) -> sender(req, cancel)
  }
}

fn retry_policy() -> retry.Policy {
  let assert Ok(elapsed) = time.duration(15_000)
  let assert Ok(base) = time.duration(500)
  let assert Ok(max) = time.duration(4000)
  let assert Ok(value) =
    retry.policy(
      maximum_attempts: 3,
      maximum_elapsed: elapsed,
      base_delay: base,
      maximum_delay: max,
    )
  value
}
