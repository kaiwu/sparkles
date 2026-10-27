import finance_core/decimal
import gleam/dynamic/decode
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/order

pub type Listing {
  Listing(
    ticker: String,
    name: String,
    market: String,
    currency: String,
    sector: Option(String),
    industry: Option(String),
    market_cap: Option(String),
    price: Option(String),
  )
}

pub type Shares {
  Shares(
    ticker: String,
    exact_listing: Bool,
    shares_outstanding: Option(String),
    institutional_report_date: Option(String),
    percent_unavailable_reason: Option(String),
  )
}

pub type SnapshotError {
  Malformed
  NotFound
  Ambiguous
  TickerMismatch
  MarketNotUs
}

pub fn decode_screener(
  body: String,
  ticker: String,
) -> Result(Listing, SnapshotError) {
  case body |> normalize_numbers |> json.parse(screener_decoder()) {
    Error(_) -> Error(Malformed)
    Ok(envelope) -> exact_us_listing(envelope, ticker)
  }
}

pub fn decode_shares(
  body: String,
  ticker: String,
) -> Result(Shares, SnapshotError) {
  case body |> normalize_numbers |> json.parse(shares_decoder()) {
    Error(_) -> Error(Malformed)
    Ok(shares) ->
      case shares.ticker == ticker {
        True -> Ok(shares)
        False -> Error(TickerMismatch)
      }
  }
}

type ScreenerEnvelope {
  ScreenerEnvelope(not_found: List(String), rows: List(Listing))
}

fn exact_us_listing(
  envelope: ScreenerEnvelope,
  ticker: String,
) -> Result(Listing, SnapshotError) {
  case
    list.contains(envelope.not_found, ticker),
    envelope.not_found,
    envelope.rows
  {
    True, _, _ -> Error(NotFound)
    _, [_, ..], _ -> Error(Ambiguous)
    _, _, [] -> Error(NotFound)
    _, _, [_, _, ..] -> Error(Ambiguous)
    _, _, [row] ->
      case row.ticker == ticker, row.market == "US", row.name != "" {
        False, _, _ -> Error(TickerMismatch)
        _, False, _ -> Error(MarketNotUs)
        _, _, False -> Error(Malformed)
        True, True, True -> Ok(row)
      }
  }
}

fn screener_decoder() -> decode.Decoder(ScreenerEnvelope) {
  use not_found <- decode.optional_field("notFound", [], {
    use values <- decode.then(decode.optional(decode.list(of: decode.string)))
    case values {
      None -> decode.success([])
      Some(rows) -> decode.success(rows)
    }
  })
  use rows <- decode.field("data", decode.list(of: listing_decoder()))
  decode.success(ScreenerEnvelope(not_found:, rows:))
}

fn listing_decoder() -> decode.Decoder(Listing) {
  use ticker <- decode.field("ticker", decode.string)
  use name <- decode.field("name", decode.string)
  use market <- decode.field("market", decode.string)
  use currency <- decode.field("currency", decode.string)
  use sector <- optional_string("sector")
  use industry <- optional_string("industry")
  use market_cap <- optional_number("marketCap")
  use price <- optional_number("price")
  decode.success(Listing(
    ticker,
    name,
    market,
    currency,
    sector,
    industry,
    market_cap,
    price,
  ))
}

fn shares_decoder() -> decode.Decoder(Shares) {
  use ticker <- decode.field("ticker", decode.string)
  use exact_listing <- decode.field("exactListing", decode.bool)
  use shares_outstanding <- optional_count("sharesOutstanding")
  use institutional_report_date <- optional_string("reportDate")
  use percent_unavailable_reason <- optional_string("percentUnavailableReason")
  decode.success(Shares(
    ticker,
    exact_listing,
    shares_outstanding,
    institutional_report_date,
    percent_unavailable_reason,
  ))
}

fn optional_string(
  name: String,
  next: fn(Option(String)) -> decode.Decoder(value),
) -> decode.Decoder(value) {
  decode.optional_field(name, None, decode.optional(decode.string), next)
}

fn optional_number(
  name: String,
  next: fn(Option(String)) -> decode.Decoder(value),
) -> decode.Decoder(value) {
  decode.optional_field(
    name,
    None,
    decode.optional(non_negative_number_decoder()),
    next,
  )
}

fn optional_count(
  name: String,
  next: fn(Option(String)) -> decode.Decoder(value),
) -> decode.Decoder(value) {
  decode.optional_field(
    name,
    None,
    decode.optional(non_negative_integer_decoder()),
    next,
  )
}

fn non_negative_number_decoder() -> decode.Decoder(String) {
  exact_number_decoder()
  |> decode.then(fn(raw) {
    case decimal.parse(raw) {
      Error(_) -> decode.failure("0", "non-negative source number")
      Ok(value) ->
        case decimal.compare(value, decimal.zero()) != order.Lt {
          True -> decode.success(raw)
          False -> decode.failure("0", "non-negative source number")
        }
    }
  })
}

fn non_negative_integer_decoder() -> decode.Decoder(String) {
  non_negative_number_decoder()
  |> decode.then(fn(raw) {
    case decimal.parse(raw) {
      Error(_) -> decode.failure("0", "non-negative integer source number")
      Ok(value) ->
        case decimal.scale(value) == 0 {
          True -> decode.success(raw)
          False -> decode.failure("0", "non-negative integer source number")
        }
    }
  })
}

fn exact_number_decoder() -> decode.Decoder(String) {
  decode.at(["__finance_equibles_number__"], decode.string)
}

@external(javascript, "./response_ffi.mjs", "normalize_numbers")
fn normalize_numbers(source: String) -> String
