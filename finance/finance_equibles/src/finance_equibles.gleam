import finance_http/request
import gleam/list
import gleam/result
import gleam/string

pub opaque type Access {
  Access(api_key: String)
}

pub type AccessError {
  InvalidApiKey
  InvalidRequest(request.RequestError)
}

/// Keep the caller's Equibles credential opaque and out of result values.
/// Keys are the provider's `eq_` credentials. Other providers' keys are rejected
/// before a request is built.
pub fn access(api_key: String) -> Result(Access, AccessError) {
  case
    string.starts_with(api_key, "eq_")
    && string.length(api_key) >= 8
    && string.length(api_key) <= 200
    && string.trim(api_key) == api_key
    && {
      api_key
      |> string.to_graphemes
      |> list.all(fn(character) { !string.contains(" \t\r\n", character) })
    }
  {
    True -> Ok(Access(api_key))
    False -> Error(InvalidApiKey)
  }
}

/// Send the key as a Bearer header. Equibles also accepts a query parameter;
/// that form is not used because it leaks into URLs and logs.
pub fn authorize(
  access: Access,
  request_value: request.Request,
) -> Result(request.Request, AccessError) {
  let Access(api_key) = access
  request.with_header(
    request_value,
    name: "Authorization",
    value: "Bearer " <> api_key,
    sensitivity: request.Secret,
  )
  |> result.map_error(InvalidRequest)
}
