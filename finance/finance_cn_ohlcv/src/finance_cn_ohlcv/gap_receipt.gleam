import finance_cn_identity/identity as cn_identity
import finance_core/currency.{type Currency}
import finance_core/time.{type Date, type Instant}
import finance_ohlcv/acquisition_receipt
import finance_provenance/identity.{type Sha256}
import finance_track
import gleam/int
import gleam/option.{type Option}
import gleam/result

pub const schema_name = "pi-sparkles/cn-ohlcv-gap-receipt"

pub const schema_version = 1

pub const digest_algorithm = acquisition_receipt.digest_algorithm

pub type Pagination {
  Complete
  TruncatedByBarBudget
}

pub type Page =
  acquisition_receipt.Page

pub opaque type Receipt {
  Receipt(
    canonical: acquisition_receipt.Receipt,
    listing: cn_identity.Listing,
    start_date: Date,
    end_date: Date,
    limit: Int,
    pagination: Pagination,
  )
}

pub type ReceiptError {
  InvalidProvider
  InvalidLimit
  InvalidCanonicalReceipt(acquisition_receipt.ReceiptError)
}

pub fn page(
  sequence sequence_value: Int,
  request_id request_id_value: Option(String),
  byte_length byte_length_value: Int,
  content_sha256 content_hash: Sha256,
) -> Result(Page, ReceiptError) {
  acquisition_receipt.page(
    sequence_value,
    request_id_value,
    byte_length_value,
    content_hash,
  )
  |> result.map_error(InvalidCanonicalReceipt)
}

pub fn new(
  provider provider_value: String,
  listing listing_value: cn_identity.Listing,
  start_date start: Date,
  end_date end: Date,
  limit limit_value: Int,
  source_reference source_value: String,
  retrieved_at retrieved: Instant,
  pagination pagination_value: Pagination,
  pages page_values: List(Page),
  bar_dates dates: List(Date),
) -> Result(Receipt, ReceiptError) {
  use _ <- result.try(case provider_value {
    "eastmoney" | "sina" -> Ok(Nil)
    _ -> Error(InvalidProvider)
  })
  use _ <- result.try(case limit_value >= 1 && limit_value <= 1000 {
    True -> Ok(Nil)
    False -> Error(InvalidLimit)
  })
  use fields <- result.try(identity_fields(
    listing_value,
    start,
    end,
    limit_value,
  ))
  use canonical <- result.try(
    acquisition_receipt.new(
      schema: schema_name,
      schema_version: schema_version,
      track: finance_track.Cn,
      provider: provider_value,
      identity: fields,
      source_reference: source_value,
      retrieved_at: retrieved,
      pagination: shared_pagination(pagination_value),
      pages: page_values,
      range_start: start,
      range_end: end,
      bar_dates: dates,
    )
    |> result.map_error(InvalidCanonicalReceipt),
  )
  Ok(Receipt(
    canonical,
    listing_value,
    start,
    end,
    limit_value,
    pagination_value,
  ))
}

pub fn canonical_text(value: Receipt) -> String {
  value.canonical |> acquisition_receipt.canonical_text
}

pub fn provider(value: Receipt) -> String {
  value.canonical |> acquisition_receipt.provider
}

pub fn listing(value: Receipt) -> cn_identity.Listing {
  value.listing
}

pub fn venue(value: Receipt) -> cn_identity.Venue {
  value.listing |> cn_identity.venue
}

pub fn board(value: Receipt) -> cn_identity.Board {
  value.listing |> cn_identity.board
}

pub fn share_class(value: Receipt) -> cn_identity.ShareClass {
  value.listing |> cn_identity.share_class
}

pub fn currency(value: Receipt) -> Currency {
  value.listing |> cn_identity.currency
}

pub fn code(value: Receipt) -> String {
  value.listing |> cn_identity.code
}

pub fn start_date(value: Receipt) -> Date {
  value.start_date
}

pub fn end_date(value: Receipt) -> Date {
  value.end_date
}

pub fn limit(value: Receipt) -> Int {
  value.limit
}

pub fn source_reference(value: Receipt) -> String {
  value.canonical |> acquisition_receipt.source_reference
}

pub fn retrieved_at(value: Receipt) -> Instant {
  value.canonical |> acquisition_receipt.retrieved_at
}

pub fn pagination(value: Receipt) -> Pagination {
  value.pagination
}

pub fn pages(value: Receipt) -> List(Page) {
  value.canonical |> acquisition_receipt.pages
}

pub fn bar_dates(value: Receipt) -> List(Date) {
  value.canonical |> acquisition_receipt.bar_dates
}

pub fn request_ids(value: Receipt) -> List(String) {
  value.canonical |> acquisition_receipt.request_ids
}

pub fn page_sequence(value: Page) -> Int {
  value |> acquisition_receipt.page_sequence
}

pub fn page_request_id(value: Page) -> Option(String) {
  value |> acquisition_receipt.page_request_id
}

pub fn page_byte_length(value: Page) -> Int {
  value |> acquisition_receipt.page_byte_length
}

pub fn page_content_sha256(value: Page) -> Sha256 {
  value |> acquisition_receipt.page_content_sha256
}

pub fn pagination_name(value: Pagination) -> String {
  value |> shared_pagination |> acquisition_receipt.pagination_name
}

pub fn venue_name(value: cn_identity.Venue) -> String {
  case value {
    cn_identity.Sse -> "sse"
    cn_identity.Szse -> "szse"
    cn_identity.Bse -> "bse"
  }
}

pub fn board_name(value: cn_identity.Board) -> String {
  case value {
    cn_identity.SseMainBoard | cn_identity.SzseMainBoard -> "main"
    cn_identity.StarMarket -> "star"
    cn_identity.ChiNext -> "chinext"
    cn_identity.BeijingMarket -> "beijing"
  }
}

pub fn share_class_name(value: cn_identity.ShareClass) -> String {
  case value {
    cn_identity.AShare -> "a_share"
    cn_identity.BShare -> "b_share"
    cn_identity.Cdr -> "cdr"
  }
}

fn identity_fields(
  listing: cn_identity.Listing,
  start: Date,
  end: Date,
  limit: Int,
) -> Result(List(acquisition_receipt.IdentityField), ReceiptError) {
  use venue <- result.try(field("venue", venue_name(cn_identity.venue(listing))))
  use board <- result.try(field("board", board_name(cn_identity.board(listing))))
  use share_class <- result.try(field(
    "share_class",
    share_class_name(cn_identity.share_class(listing)),
  ))
  use currency <- result.try(field(
    "currency",
    listing |> cn_identity.currency |> currency.code,
  ))
  use code <- result.try(field("code", cn_identity.code(listing)))
  use start_date <- result.try(field("start_date", date_text(start)))
  use end_date <- result.try(field("end_date", date_text(end)))
  use limit_field <- result.try(field("limit", int.to_string(limit)))
  Ok([
    venue,
    board,
    share_class,
    currency,
    code,
    start_date,
    end_date,
    limit_field,
  ])
}

fn field(
  name: String,
  value: String,
) -> Result(acquisition_receipt.IdentityField, ReceiptError) {
  acquisition_receipt.identity_field(name, value)
  |> result.map_error(InvalidCanonicalReceipt)
}

fn shared_pagination(value: Pagination) -> acquisition_receipt.Pagination {
  case value {
    Complete -> acquisition_receipt.Complete
    TruncatedByBarBudget -> acquisition_receipt.TruncatedByBarBudget
  }
}

fn date_text(value: Date) -> String {
  let #(year, month, day) = time.date_parts(value)
  int.to_string(year) <> "-" <> two_digits(month) <> "-" <> two_digits(day)
}

fn two_digits(value: Int) -> String {
  case value < 10 {
    True -> "0" <> int.to_string(value)
    False -> int.to_string(value)
  }
}
