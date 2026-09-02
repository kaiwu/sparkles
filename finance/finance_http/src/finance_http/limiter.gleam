import finance_core/time
import finance_http/client
import finance_http/rate_limit
import finance_http/transport
import gleam/javascript/promise.{type Promise}

type Cell(value)

/// A process-local admission owner. Production provider runtimes use a named
/// shared cell so independently loaded Pi and DSH shells cannot each spend the
/// same provider quota. Injected test runtimes use an isolated cell.
pub opaque type Limiter {
  Limiter(cell: Cell(rate_limit.State))
}

pub fn isolated(state: rate_limit.State) -> Limiter {
  Limiter(new_cell(state))
}

/// Share one quota state across independently bundled copies of finance_http.
///
/// The scope must include the provider authority and the selected rate-policy
/// version. It must never contain a credential or caller-owned secret.
pub fn shared(scope scope: String, state state: rate_limit.State) -> Limiter {
  Limiter(shared_cell(scope, state))
}

pub fn admit(
  limiter: Limiter,
  cancellation: transport.Cancellation,
  sleeper: client.Sleeper,
  clock: client.Clock,
) -> Promise(Result(Nil, transport.TransportError)) {
  case transport.is_cancelled(cancellation) {
    True -> promise.resolve(Error(transport.Cancelled))
    False -> {
      let Limiter(cell) = limiter
      let now = clock()
      case rate_limit.acquire(read_cell(cell), now) {
        Error(_) -> promise.resolve(Error(transport.InvalidTransportResult))
        Ok(#(next, rate_limit.Permit)) -> {
          write_cell(cell, next)
          promise.resolve(Ok(Nil))
        }
        Ok(#(_, rate_limit.WaitUntil(reset))) -> {
          let milliseconds =
            time.unix_milliseconds(reset) - time.unix_milliseconds(now)
          case time.duration(milliseconds) {
            Error(_) -> promise.resolve(Error(transport.InvalidTransportResult))
            Ok(wait) -> {
              use completed <- promise.await(sleeper(wait, cancellation))
              case completed {
                False -> promise.resolve(Error(transport.Cancelled))
                True -> admit(limiter, cancellation, sleeper, clock)
              }
            }
          }
        }
      }
    }
  }
}

@external(javascript, "./limiter_ffi.mjs", "new_cell")
fn new_cell(value: value) -> Cell(value)

@external(javascript, "./limiter_ffi.mjs", "shared_cell")
fn shared_cell(scope: String, value: value) -> Cell(value)

@external(javascript, "./limiter_ffi.mjs", "read_cell")
fn read_cell(cell: Cell(value)) -> value

@external(javascript, "./limiter_ffi.mjs", "write_cell")
fn write_cell(cell: Cell(value), value: value) -> Nil
