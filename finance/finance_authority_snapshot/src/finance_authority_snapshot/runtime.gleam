import finance_core/time
import finance_http/binary_client
import finance_http/binary_pool
import finance_http/binary_response
import finance_http/client
import finance_http/limiter
import finance_http/pool
import finance_http/rate_limit
import finance_http/request
import finance_http/response.{type Response}
import finance_http/retry
import finance_http/scheduler
import finance_http/transport.{type Cancellation, type TransportError}
import gleam/int
import gleam/javascript/promise.{type Promise}
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string

pub opaque type Policy {
  Policy(
    origin: String,
    allowed_paths: List(String),
    admissions_per_window: Int,
    window: time.Duration,
    maximum_in_flight: Int,
    maximum_waiting: Int,
    retry_policy: retry.Policy,
  )
}

pub opaque type Runtime {
  Runtime(policy: Policy, pool: pool.Pool)
}

pub opaque type BinaryRuntime {
  BinaryRuntime(policy: Policy, pool: binary_pool.Pool)
}

pub type PolicyError {
  InvalidOrigin
  EmptyPathAllowlist
  InvalidPath(path: String)
  DuplicatePath(path: String)
  InvalidAdmissions
  InvalidWindow
  InvalidMaximumInFlight
  InvalidMaximumWaiting
  InvalidRetry(retry.PolicyError)
}

pub type InitError {
  InvalidRate(rate_limit.RateLimitError)
  InvalidPool(scheduler.SchedulerError)
}

pub fn policy(
  origin origin_value: String,
  allowed_paths allowed_path_values: List(String),
  admissions_per_window admissions: Int,
  window window_value: time.Duration,
  maximum_in_flight in_flight: Int,
  maximum_waiting waiting: Int,
  maximum_attempts attempts: Int,
  maximum_elapsed elapsed: time.Duration,
  base_delay base: time.Duration,
  maximum_delay delay: time.Duration,
) -> Result(Policy, PolicyError) {
  case
    valid_origin(origin_value),
    allowed_path_values,
    first_invalid_path(allowed_path_values),
    first_duplicate(allowed_path_values),
    admissions > 0,
    time.duration_milliseconds(window_value) > 0,
    in_flight > 0,
    waiting > 0
  {
    False, _, _, _, _, _, _, _ -> Error(InvalidOrigin)
    _, [], _, _, _, _, _, _ -> Error(EmptyPathAllowlist)
    _, _, Some(path), _, _, _, _, _ -> Error(InvalidPath(path))
    _, _, _, Some(path), _, _, _, _ -> Error(DuplicatePath(path))
    _, _, _, _, False, _, _, _ -> Error(InvalidAdmissions)
    _, _, _, _, _, False, _, _ -> Error(InvalidWindow)
    _, _, _, _, _, _, False, _ -> Error(InvalidMaximumInFlight)
    _, _, _, _, _, _, _, False -> Error(InvalidMaximumWaiting)
    True, [_, ..], None, None, True, True, True, True ->
      retry.policy(
        maximum_attempts: attempts,
        maximum_elapsed: elapsed,
        base_delay: base,
        maximum_delay: delay,
      )
      |> result.map(fn(retry_value) {
        Policy(
          origin_value,
          allowed_path_values,
          admissions,
          window_value,
          in_flight,
          waiting,
          retry_value,
        )
      })
      |> result.map_error(InvalidRetry)
  }
}

pub fn new(value: Policy) -> Result(Runtime, InitError) {
  new_configured(
    value,
    transport.send,
    client.cancellable_sleep,
    client.system_clock,
    True,
  )
}

pub fn new_binary(value: Policy) -> Result(BinaryRuntime, InitError) {
  new_binary_configured(
    value,
    transport.send_binary,
    client.cancellable_sleep,
    client.system_clock,
    True,
  )
}

pub fn new_with(
  value: Policy,
  sender: client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
) -> Result(Runtime, InitError) {
  new_configured(value, sender, sleeper, clock, False)
}

fn new_configured(
  value: Policy,
  sender: client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
  share_limit: Bool,
) -> Result(Runtime, InitError) {
  let now = clock()
  let reset_milliseconds =
    time.unix_milliseconds(now) + time.duration_milliseconds(value.window)
  use reset_at <- result.try(
    time.instant(reset_milliseconds)
    |> result.map_error(fn(_) { InvalidRate(rate_limit.ResetOverflow) }),
  )
  use state <- result.try(
    rate_limit.new(
      limit: value.admissions_per_window,
      remaining: value.admissions_per_window,
      reset_at: reset_at,
      window: value.window,
    )
    |> result.map_error(InvalidRate),
  )
  let admission = case share_limit {
    True -> limiter.shared(rate_scope(value), state)
    False -> limiter.isolated(state)
  }
  let policy_client =
    client.new(
      value.retry_policy,
      fn(request_value, cancellation) {
        gated_send(
          value,
          admission,
          request_value,
          cancellation,
          sender,
          sleeper,
          clock,
        )
      },
      sleeper,
      clock,
    )
  pool.new(
    policy_client,
    maximum_in_flight: value.maximum_in_flight,
    maximum_per_origin: value.maximum_in_flight,
    maximum_waiting: value.maximum_waiting,
  )
  |> result.map(fn(pool_value) { Runtime(value, pool_value) })
  |> result.map_error(InvalidPool)
}

pub fn new_binary_with(
  value: Policy,
  sender: binary_client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
) -> Result(BinaryRuntime, InitError) {
  new_binary_configured(value, sender, sleeper, clock, False)
}

fn new_binary_configured(
  value: Policy,
  sender: binary_client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
  share_limit: Bool,
) -> Result(BinaryRuntime, InitError) {
  let now = clock()
  let reset_milliseconds =
    time.unix_milliseconds(now) + time.duration_milliseconds(value.window)
  use reset_at <- result.try(
    time.instant(reset_milliseconds)
    |> result.map_error(fn(_) { InvalidRate(rate_limit.ResetOverflow) }),
  )
  use state <- result.try(
    rate_limit.new(
      limit: value.admissions_per_window,
      remaining: value.admissions_per_window,
      reset_at: reset_at,
      window: value.window,
    )
    |> result.map_error(InvalidRate),
  )
  let admission = case share_limit {
    True -> limiter.shared(rate_scope(value), state)
    False -> limiter.isolated(state)
  }
  let policy_client =
    binary_client.new(
      value.retry_policy,
      fn(request_value, cancellation) {
        gated_send_binary(
          value,
          admission,
          request_value,
          cancellation,
          sender,
          sleeper,
          clock,
        )
      },
      sleeper,
      clock,
    )
  binary_pool.new(
    policy_client,
    maximum_in_flight: value.maximum_in_flight,
    maximum_per_origin: value.maximum_in_flight,
    maximum_waiting: value.maximum_waiting,
  )
  |> result.map(fn(pool_value) { BinaryRuntime(value, pool_value) })
  |> result.map_error(InvalidPool)
}

pub fn send(
  runtime: Runtime,
  id id: String,
  request request_value: request.Request,
  cancellation cancellation: Cancellation,
) -> Promise(Result(Response, pool.PoolError)) {
  pool.send(runtime.pool, id:, request: request_value, cancellation:)
}

pub fn send_binary(
  runtime: BinaryRuntime,
  id id: String,
  request request_value: request.Request,
  cancellation cancellation: Cancellation,
) -> Promise(Result(binary_response.Response, binary_pool.PoolError)) {
  binary_pool.send(runtime.pool, id:, request: request_value, cancellation:)
}

pub fn origin(value: Policy) -> String {
  value.origin
}

pub fn allowed_paths(value: Policy) -> List(String) {
  value.allowed_paths
}

fn gated_send(
  policy: Policy,
  admission: limiter.Limiter,
  request_value: request.Request,
  cancellation: Cancellation,
  sender: client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
) -> Promise(Result(Response, TransportError)) {
  case
    request.origin(request_value) == policy.origin,
    list.contains(policy.allowed_paths, request.path(request_value))
  {
    False, _ | _, False ->
      promise.resolve(Error(transport.InvalidTransportResult))
    True, True -> {
      use admitted <- promise.await(limiter.admit(
        admission,
        cancellation,
        sleeper,
        clock,
      ))
      case admitted {
        Error(error) -> promise.resolve(Error(error))
        Ok(Nil) -> sender(request_value, cancellation)
      }
    }
  }
}

fn gated_send_binary(
  policy: Policy,
  admission: limiter.Limiter,
  request_value: request.Request,
  cancellation: Cancellation,
  sender: binary_client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
) -> Promise(Result(binary_response.Response, TransportError)) {
  case
    request.origin(request_value) == policy.origin,
    list.contains(policy.allowed_paths, request.path(request_value))
  {
    False, _ | _, False ->
      promise.resolve(Error(transport.InvalidTransportResult))
    True, True -> {
      use admitted <- promise.await(limiter.admit(
        admission,
        cancellation,
        sleeper,
        clock,
      ))
      case admitted {
        Error(error) -> promise.resolve(Error(error))
        Ok(Nil) -> sender(request_value, cancellation)
      }
    }
  }
}

fn rate_scope(value: Policy) -> String {
  "authority:"
  <> value.origin
  <> ":"
  <> int.to_string(value.admissions_per_window)
  <> ":"
  <> int.to_string(time.duration_milliseconds(value.window))
}

fn first_invalid_path(values: List(String)) -> Option(String) {
  case values {
    [] -> None
    [first, ..rest] ->
      case valid_path(first) {
        True -> first_invalid_path(rest)
        False -> Some(first)
      }
  }
}

fn first_duplicate(values: List(String)) -> Option(String) {
  case values {
    [] -> None
    [first, ..rest] ->
      case list.contains(rest, first) {
        True -> Some(first)
        False -> first_duplicate(rest)
      }
  }
}

fn valid_origin(value: String) -> Bool {
  case value {
    "https://" <> authority ->
      authority != ""
      && !string.contains(authority, "/")
      && !string.contains(authority, "?")
      && !string.contains(authority, "#")
      && !string.contains(authority, "@")
      && !string.contains(authority, "\\")
      && !string.contains(authority, "\r")
      && !string.contains(authority, "\n")
      && !string.contains(authority, "\t")
      && !string.contains(authority, " ")
      && string.trim(authority) == authority
    _ -> False
  }
}

fn valid_path(value: String) -> Bool {
  string.starts_with(value, "/")
  && !string.starts_with(value, "//")
  && !string.contains(value, "\\")
  && !string.contains(value, "?")
  && !string.contains(value, "#")
  && !string.contains(value, "\r")
  && !string.contains(value, "\n")
  && !string.contains(value, "\u{0}")
}
