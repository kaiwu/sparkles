import gleam/dynamic/decode
import gleam/option.{None}
import gleeunit
import gleeunit/should
import pi/event
import pi/raw

pub fn main() -> Nil {
  gleeunit.main()
}

pub fn raw_object_test() {
  let value = raw.object([#("name", raw.dynamic("Ada"))])
  let decoder = {
    use name <- decode.field("name", decode.string)
    decode.success(name)
  }

  value
  |> decode.run(decoder)
  |> should.equal(Ok("Ada"))
}

pub fn lifecycle_reason_names_test() {
  event.session_start_reason_name(event.StartReload)
  |> should.equal("reload")

  event.session_shutdown_reason_name(event.ShutdownFork)
  |> should.equal("fork")

  event.session_switch_reason_name(event.SwitchResume)
  |> should.equal("resume")

  event.fork_position_name(event.ForkBefore)
  |> should.equal("before")

  event.compaction_reason_name(event.CompactOverflow)
  |> should.equal("overflow")
}

pub fn future_lifecycle_reason_is_preserved_test() {
  event.session_start_reason_name(event.StartUnknown("future"))
  |> should.equal("future")
}

pub fn before_agent_start_message_type_names_test() {
  event.before_agent_start_message_type_name(event.BeforeAgentStartUser(
    "",
    [],
    None,
    raw.undefined(),
  ))
  |> should.equal("user")

  event.before_agent_start_message_type_name(event.BeforeAgentStartCustom(
    raw.undefined(),
    None,
    raw.undefined(),
  ))
  |> should.equal("custom")
}
