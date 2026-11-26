import finance_core/time
import finance_http/client
import finance_http/retry_after
import gleam/dict
import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode
import gleam/int
import gleam/javascript/promise.{type Promise}
import gleam/list
import gleam/option.{None, Some}
import gleam/result
import gleam/string
import pi
import pi/context
import pi/event
import pi/ui
import pi_sparkles_finance_track_status as track

const flag = "finance-model-diagnostics"

pub fn extension(api: pi.ExtensionApi) -> Promise(Nil) {
  pi.register_boolean_flag(
    api,
    flag,
    "Show model-provider HTTP errors and Retry-After in the Pi UI",
    False,
  )
  event.on_after_provider_response(api, fn(response, ctx) {
    case
      response.status >= 400 && response.status <= 599 && context.has_ui(ctx)
    {
      True ->
        case pi.get_flag(api, flag) {
          Some(pi.BooleanFlag(True)) ->
            ui.notify(
              context.ui(ctx),
              message(response.status, response.headers, client.system_clock()),
              ui.Warning,
            )
          _ -> Nil
        }
      False -> Nil
    }
    promise.resolve(Nil)
  })
  track.extension(api)
}

fn message(status: Int, headers: Dynamic, now: time.Instant) -> String {
  let prefix = "Model provider returned HTTP " <> int.to_string(status)
  let values =
    decode.run(headers, decode.dict(decode.string, decode.dynamic))
    |> result.map(dict.to_list)
    |> result.unwrap([])
    |> list.filter(fn(header) { string.lowercase(header.0) == "retry-after" })
  let delay = case values {
    [#(_, raw)] ->
      decode.run(raw, decode.string)
      |> option.from_result
      |> option.then(retry_after.parse(_, now))
    _ -> None
  }
  case delay {
    None -> prefix
    Some(duration) ->
      prefix
      <> " · Retry-After: "
      <> int.to_string({ time.duration_milliseconds(duration) + 999 } / 1000)
      <> "s"
  }
}
