import finance_core/time
import finance_http/client
import finance_http/limiter
import finance_http/pool
import finance_http/request
import finance_http/response.{type Response}
import finance_http/retry
import finance_http/scheduler
import finance_http/transport.{type Cancellation, type TransportError}
import finance_openfigi.{type Access, type Endpoint}
import gleam/javascript/promise.{type Promise}
import gleam/result

pub opaque type Runtime {
  Runtime(pool: pool.Pool)
}

pub type InitError {
  InvalidMappingRate(finance_openfigi.LimitError)
  InvalidSearchRate(finance_openfigi.LimitError)
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

/// Construct a runtime from explicit effects for deterministic interpreters.
pub fn new_with(
  access: Access,
  sender: client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
) -> Result(Runtime, InitError) {
  new_configured(access, sender, sleeper, clock, False)
}

fn new_configured(
  access: Access,
  sender: client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
  share_limit: Bool,
) -> Result(Runtime, InitError) {
  let now = clock()
  use mapping_rate <- result.try(
    finance_openfigi.initial_rate_state(access, finance_openfigi.Mapping, now)
    |> result.map_error(InvalidMappingRate),
  )
  use search_rate <- result.try(
    finance_openfigi.initial_rate_state(access, finance_openfigi.Search, now)
    |> result.map_error(InvalidSearchRate),
  )
  let access_name = finance_openfigi.access_name(access)
  let mapping_limiter = case share_limit {
    True ->
      limiter.shared("openfigi:" <> access_name <> ":mapping:v1", mapping_rate)
    False -> limiter.isolated(mapping_rate)
  }
  let search_limiter = case share_limit {
    True ->
      limiter.shared("openfigi:" <> access_name <> ":search:v1", search_rate)
    False -> limiter.isolated(search_rate)
  }
  let policy_client =
    client.new(
      retry_policy(),
      fn(request_value, cancellation) {
        gated_send(
          mapping_limiter,
          search_limiter,
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
    maximum_in_flight: 1,
    maximum_per_origin: 1,
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
  pool.send(
    pool_value,
    id: id,
    request: request_value,
    cancellation: cancellation,
  )
}

fn gated_send(
  mapping_limiter: limiter.Limiter,
  search_limiter: limiter.Limiter,
  request_value: request.Request,
  cancellation: Cancellation,
  sender: client.Sender,
  sleeper: client.Sleeper,
  clock: client.Clock,
) -> Promise(Result(Response, TransportError)) {
  case endpoint(request.path(request_value)) {
    Error(_) -> promise.resolve(Error(transport.InvalidTransportResult))
    Ok(endpoint_value) -> {
      let admission = case endpoint_value {
        finance_openfigi.Mapping -> mapping_limiter
        finance_openfigi.Search -> search_limiter
      }
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

fn endpoint(path: String) -> Result(Endpoint, Nil) {
  case path {
    "/v3/mapping" -> Ok(finance_openfigi.Mapping)
    "/v3/filter" -> Ok(finance_openfigi.Search)
    _ -> Error(Nil)
  }
}

fn retry_policy() -> retry.Policy {
  let assert Ok(maximum_elapsed) = time.duration(12_000)
  let assert Ok(base_delay) = time.duration(500)
  let assert Ok(maximum_delay) = time.duration(4000)
  let assert Ok(policy) =
    retry.policy(
      maximum_attempts: 3,
      maximum_elapsed: maximum_elapsed,
      base_delay: base_delay,
      maximum_delay: maximum_delay,
    )
  policy
}
