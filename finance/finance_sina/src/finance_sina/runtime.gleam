import finance_authority_snapshot/runtime as bounded_runtime
import finance_core/time
import finance_http/pool
import finance_http/request
import finance_http/response.{type Response}
import finance_http/transport.{type Cancellation}
import finance_sina/request as provider_request
import gleam/javascript/promise.{type Promise}

pub type Runtime =
  bounded_runtime.Runtime

pub type InitError =
  bounded_runtime.InitError

pub type SendError =
  pool.PoolError

pub fn new(_access) -> Result(Runtime, InitError) {
  bounded_runtime.new(policy())
}

pub fn new_with(sender, sleeper, clock) -> Result(Runtime, InitError) {
  bounded_runtime.new_with(policy(), sender, sleeper, clock)
}

pub fn send(
  runtime: Runtime,
  id id: String,
  request request_value: request.Request,
  cancellation cancellation: Cancellation,
) -> Promise(Result(Response, SendError)) {
  bounded_runtime.send(runtime, id, request_value, cancellation)
}

fn policy() -> bounded_runtime.Policy {
  let assert Ok(window) = time.duration(2000)
  let assert Ok(maximum_elapsed) = time.duration(15_000)
  let assert Ok(base_delay) = time.duration(500)
  let assert Ok(maximum_delay) = time.duration(2000)
  let assert Ok(value) =
    bounded_runtime.policy(
      origin: provider_request.origin,
      allowed_paths: [provider_request.history_path],
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
