@external(javascript, "./environment_ffi.mjs", "read_api_key")
pub fn api_key() -> String

@external(javascript, "./environment_ffi.mjs", "read_equibles_api_key")
pub fn equibles_api_key() -> String

@external(javascript, "./environment_ffi.mjs", "read_now_milliseconds")
pub fn now_milliseconds() -> Int
