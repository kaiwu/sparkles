import finance_http/request
import gleam/result
import gleam/string

pub type Status {
  Experimental
}

pub opaque type Access {
  Access(user_agent: String)
}

pub type AccessError {
  InvalidProduct
  InvalidContact
  InvalidHeader(request.RequestError)
}

pub fn status() -> Status {
  Experimental
}

pub fn access(product: String, contact: String) -> Result(Access, AccessError) {
  case valid_identity(product), valid_identity(contact) {
    False, _ -> Error(InvalidProduct)
    _, False -> Error(InvalidContact)
    True, True -> Ok(Access(product <> " " <> contact))
  }
}

pub fn authorize(
  access: Access,
  request_value: request.Request,
) -> Result(request.Request, AccessError) {
  let Access(user_agent) = access
  request.with_header(
    request_value,
    name: "User-Agent",
    value: user_agent,
    sensitivity: request.Public,
  )
  |> result.map_error(InvalidHeader)
}

fn valid_identity(value: String) -> Bool {
  value != ""
  && string.trim(value) == value
  && string.length(value) <= 200
  && !string.contains(value, "\r")
  && !string.contains(value, "\n")
}
