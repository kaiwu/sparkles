import finance_core/identifier
import finance_core/market
import finance_core/observation
import finance_core/observation_json
import finance_core/source
import finance_core/time.{type Instant}
import finance_equibles/request as equibles_request
import finance_equibles/response as equibles_response
import finance_provenance/identity.{type Sha256}
import finance_track
import finance_track/context as track_context
import finance_track/json as track_json
import finance_twelve_data/request as provider_request
import finance_twelve_data/response.{type Profile, type Statistics}
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string

const provider = "Twelve Data"

pub type Vendor {
  TwelveData
  Equibles
}

pub type Input {
  Input(symbol: String, mic: String, vendor: Vendor)
}

pub type Receipt {
  Receipt(
    endpoint: String,
    response_byte_length: Int,
    content_sha256: Sha256,
    api_credits_used: Option(String),
    api_credits_left: Option(String),
    api_credits_request: Option(String),
  )
}

pub type Capture {
  Capture(
    profile: Profile,
    profile_receipt: Receipt,
    statistics: Statistics,
    statistics_receipt: Receipt,
    retrieved_at: Instant,
  )
}

pub type Output {
  Output(summary: String, details: json.Json)
}

pub type EquiblesReceipt {
  EquiblesReceipt(
    endpoint: String,
    response_byte_length: Int,
    content_sha256: Sha256,
    rate_limit: Option(String),
    rate_remaining: Option(String),
    rate_reset: Option(String),
  )
}

pub type EquiblesCapture {
  EquiblesCapture(
    listing: equibles_response.Listing,
    listing_receipt: EquiblesReceipt,
    shares: equibles_response.Shares,
    shares_receipt: EquiblesReceipt,
    retrieved_at: Instant,
  )
}

pub type Error {
  InvalidSymbol
  UnsupportedMic
  UnsupportedVendor
  VendorMismatch
  EquiblesListingMismatch
  InvalidReceipt
  RequestedListingMismatch
  CrossResponseIdentityMismatch
  InvalidSource(source.SourceError)
  InvalidMic(identifier.IdentifierError)
  InvalidTimezone(time.TimeError)
  InvalidTrackContext(track_context.ContextError)
}

pub fn input(symbol: String, mic: String) -> Result(Input, Error) {
  selected_input(symbol, mic, "twelve_data")
}

pub fn selected_input(
  symbol: String,
  mic: String,
  vendor: String,
) -> Result(Input, Error) {
  use vendor <- result.try(vendor_from_name(vendor))
  case valid_symbol(symbol), supported_mic(mic) {
    False, _ -> Error(InvalidSymbol)
    _, False -> Error(UnsupportedMic)
    True, True -> Ok(Input(symbol, mic, vendor))
  }
}

pub fn assemble(input: Input, capture: Capture) -> Result(Output, Error) {
  case input.vendor {
    Equibles -> Error(VendorMismatch)
    TwelveData -> assemble_twelve_data(input, capture)
  }
}

fn assemble_twelve_data(
  input: Input,
  capture: Capture,
) -> Result(Output, Error) {
  use Nil <- result.try(validate_receipt(
    capture.profile_receipt,
    provider_request.profile_path,
  ))
  use Nil <- result.try(validate_receipt(
    capture.statistics_receipt,
    provider_request.statistics_path,
  ))
  use Nil <- result.try(validate_identity(input, capture))
  use mic <- result.try(
    identifier.mic(input.mic) |> result.map_error(InvalidMic),
  )
  use timezone <- result.try(
    time.timezone(capture.statistics.exchange_timezone)
    |> result.map_error(InvalidTimezone),
  )
  use context <- result.try(
    track_context.new(
      track: finance_track.Us,
      market_scope: "us_twelve_data_company_profile",
      venue_mic: Some(mic),
      board: None,
      timezone: Some(timezone),
      source_language: "en-US",
      providers: [provider],
      entitlement: "caller_twelve_data_subscription",
      limitations: [
        "provider_listing_snapshot_not_exchange_identity_proof",
        "field_effective_dates_not_supplied",
        "classification_taxonomy_not_named",
        "no_cross_listing_fallback",
        "no_profile_to_dossier_judgment",
      ],
    )
    |> result.map_error(InvalidTrackContext),
  )
  use profile_source <- result.try(
    source.new(
      provider,
      source_reference(provider_request.profile_path, input),
      source.LicensedVendor,
    )
    |> result.map_error(InvalidSource),
  )
  use statistics_source <- result.try(
    source.new(
      provider,
      source_reference(provider_request.statistics_path, input),
      source.LicensedVendor,
    )
    |> result.map_error(InvalidSource),
  )
  let profile_observation =
    observation.Observation(
      value: capture.profile,
      as_of: capture.retrieved_at,
      retrieved_at: capture.retrieved_at,
      timezone: None,
      source: profile_source,
      evidence_id: Some(identity.sha256_value(
        capture.profile_receipt.content_sha256,
      )),
      freshness: observation.UnknownFreshness,
      entitlement: observation.UnknownEntitlement,
      quality: observation.Reported,
      unit: None,
      adjustment: None,
      session: None,
    )
  let statistics_observation =
    observation.Observation(
      value: capture.statistics,
      as_of: capture.retrieved_at,
      retrieved_at: capture.retrieved_at,
      timezone: Some(timezone),
      source: statistics_source,
      evidence_id: Some(identity.sha256_value(
        capture.statistics_receipt.content_sha256,
      )),
      freshness: observation.UnknownFreshness,
      entitlement: observation.UnknownEntitlement,
      quality: case
        capture.statistics.shares_outstanding,
        capture.statistics.float_shares
      {
        None, None -> observation.Missing(observation.Unavailable)
        _, _ -> observation.Reported
      },
      unit: Some(market.Shares),
      adjustment: None,
      session: None,
    )
  let fields = [
    #("schema", json.string("pi-sparkles/company-profile-result")),
    #("schemaVersion", json.int(1)),
    #("operation", json.string("company_profile")),
    #(
      "listing",
      json.object([
        #("symbol", json.string(input.symbol)),
        #("mic", json.string(input.mic)),
        #("exchange", json.string(capture.profile.exchange)),
        #(
          "identityState",
          json.string("exact_provider_match_not_exchange_authority_proof"),
        ),
      ]),
    ),
    #("profile", observation_json.to_json(profile_observation, profile_json)),
    #(
      "shares",
      observation_json.to_json(statistics_observation, statistics_json),
    ),
    #(
      "source",
      json.object([
        #("provider", json.string(provider)),
        #("api", json.string("REST profile and statistics")),
        #(
          "retrievedAtUnixMs",
          capture.retrieved_at
            |> time.unix_milliseconds
            |> int.to_string
            |> json.string,
        ),
        #("profile", receipt_json(capture.profile_receipt)),
        #("statistics", receipt_json(capture.statistics_receipt)),
        #(
          "receiptState",
          json.string(
            "sha256_response_content_bound_not_provider_signature_or_origin_authentication",
          ),
        ),
        #("termsReference", json.string("https://twelvedata.com/terms")),
      ]),
    ),
    #(
      "scope",
      json.object([
        #("providerSnapshotAsOf", json.string("retrieval_time_only")),
        #("fieldEffectiveAt", json.null()),
        #("classificationTaxonomy", json.null()),
        #("classificationEffectiveAt", json.null()),
        #("chiefExecutiveEffectiveAt", json.null()),
        #("sharesMeasurementAt", json.null()),
        #("sharesBasis", json.string("provider_stock_statistics_fields")),
        #(
          "nullMeaning",
          json.string("provider_did_not_supply_field_in_response"),
        ),
        #("crossListingFallback", json.null()),
        #("issuerAuthorityProof", json.null()),
        #("exchangeAuthorityProof", json.null()),
        #("qualityRating", json.null()),
        #("investmentJudgment", json.null()),
      ]),
    ),
    #("decisionOwner", json.string("llm")),
    #("pluginDecisionFields", json.array([], json.string)),
  ]
  Ok(Output(
    summary(input, capture),
    json.object(list.append(fields, track_json.result_fields(context))),
  ))
}

pub fn error_message(value: Error) -> String {
  case value {
    InvalidSymbol ->
      "company_profile requires an uppercase 1-20 character US symbol"
    UnsupportedMic ->
      "company_profile supports exact XNYS, XNAS, XNGS, XNCM, or XNMS MIC only"
    UnsupportedVendor ->
      "company_profile provider must be twelve_data or equibles"
    VendorMismatch ->
      "company_profile provider did not match the captured source"
    EquiblesListingMismatch ->
      "Equibles snapshot did not match the exact requested US ticker"
    InvalidReceipt -> "company_profile source receipt was invalid"
    RequestedListingMismatch ->
      "Twelve Data profile did not match the exact requested symbol and MIC"
    CrossResponseIdentityMismatch ->
      "Twelve Data profile and statistics identities did not match exactly"
    InvalidSource(_) -> "company_profile source reference was invalid"
    InvalidMic(_) -> "company_profile returned an invalid MIC"
    InvalidTimezone(_) ->
      "company_profile statistics returned an invalid exchange timezone"
    InvalidTrackContext(_) ->
      "company_profile could not construct the exact US track context"
  }
}

fn validate_identity(input: Input, capture: Capture) -> Result(Nil, Error) {
  case
    capture.profile.symbol == input.symbol
    && capture.profile.mic == input.mic
    && capture.profile.name != ""
    && capture.profile.exchange != "",
    capture.statistics.symbol == capture.profile.symbol
    && capture.statistics.mic == capture.profile.mic
    && capture.statistics.name == capture.profile.name
    && capture.statistics.exchange == capture.profile.exchange
  {
    False, _ -> Error(RequestedListingMismatch)
    _, False -> Error(CrossResponseIdentityMismatch)
    True, True -> Ok(Nil)
  }
}

fn validate_receipt(value: Receipt, endpoint: String) -> Result(Nil, Error) {
  case value.endpoint == endpoint && value.response_byte_length >= 0 {
    True -> Ok(Nil)
    False -> Error(InvalidReceipt)
  }
}

fn vendor_from_name(value: String) -> Result(Vendor, Error) {
  case value {
    "twelve_data" -> Ok(TwelveData)
    "equibles" -> Ok(Equibles)
    _ -> Error(UnsupportedVendor)
  }
}

fn valid_symbol(value: String) -> Bool {
  value != ""
  && string.length(value) <= 20
  && string.uppercase(value) == value
  && {
    value
    |> string.to_graphemes
    |> list.all(fn(character) {
      string.contains("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-", character)
    })
  }
}

fn supported_mic(value: String) -> Bool {
  list.contains(["XNYS", "XNAS", "XNGS", "XNCM", "XNMS"], value)
}

fn source_reference(endpoint: String, input: Input) -> String {
  "https://api.twelvedata.com"
  <> endpoint
  <> "?symbol="
  <> input.symbol
  <> "&mic_code="
  <> input.mic
  <> "&country=US"
}

fn receipt_json(value: Receipt) -> json.Json {
  json.object([
    #("endpoint", json.string(value.endpoint)),
    #("responseByteLength", json.int(value.response_byte_length)),
    #("contentSha256", json.string(identity.sha256_value(value.content_sha256))),
    #("apiCreditsUsed", json.nullable(value.api_credits_used, json.string)),
    #("apiCreditsLeft", json.nullable(value.api_credits_left, json.string)),
    #(
      "apiCreditsRequest",
      json.nullable(value.api_credits_request, json.string),
    ),
  ])
}

fn profile_json(value: Profile) -> json.Json {
  json.object([
    #("symbol", json.string(value.symbol)),
    #("name", json.string(value.name)),
    #("exchange", json.string(value.exchange)),
    #("mic", json.string(value.mic)),
    #("sector", json.nullable(value.sector, json.string)),
    #("industry", json.nullable(value.industry, json.string)),
    #("employeesRaw", json.nullable(value.employees, json.string)),
    #("website", json.nullable(value.website, json.string)),
    #("description", json.nullable(value.description, json.string)),
    #("securityType", json.nullable(value.security_type, json.string)),
    #("chiefExecutive", json.nullable(value.chief_executive, json.string)),
    #("address", json.nullable(value.address, json.string)),
    #("address2", json.nullable(value.address_2, json.string)),
    #("city", json.nullable(value.city, json.string)),
    #("postalCode", json.nullable(value.postal_code, json.string)),
    #("state", json.nullable(value.state, json.string)),
    #("country", json.nullable(value.country, json.string)),
    #("phone", json.nullable(value.phone, json.string)),
  ])
}

fn statistics_json(value: Statistics) -> json.Json {
  json.object([
    #("symbol", json.string(value.symbol)),
    #("name", json.string(value.name)),
    #("exchange", json.string(value.exchange)),
    #("mic", json.string(value.mic)),
    #("currency", json.string(value.currency)),
    #("exchangeTimezone", json.string(value.exchange_timezone)),
    #("outstanding", share_json(value.shares_outstanding, "shares_outstanding")),
    #("float", share_json(value.float_shares, "float_shares")),
  ])
}

fn share_json(value: Option(String), provider_field: String) -> json.Json {
  case value {
    None ->
      json.object([
        #("state", json.string("not_supplied")),
        #("providerField", json.string(provider_field)),
        #("rawValue", json.null()),
        #("unit", json.string("shares")),
      ])
    Some(raw) ->
      json.object([
        #("state", json.string("observed")),
        #("providerField", json.string(provider_field)),
        #("rawValue", json.string(raw)),
        #("unit", json.string("shares")),
      ])
  }
}

fn summary(input: Input, capture: Capture) -> String {
  let shares = case capture.statistics.shares_outstanding {
    None -> "shares outstanding not supplied"
    Some(raw) -> raw <> " provider-reported shares outstanding"
  }
  "Twelve Data profile for "
  <> input.symbol
  <> " at "
  <> input.mic
  <> ": "
  <> capture.profile.name
  <> ", "
  <> shares
  <> ". Snapshot retrieval time is not a field effective date; no quality or investment judgment is made."
}

pub fn assemble_equibles(
  input: Input,
  capture: EquiblesCapture,
) -> Result(Output, Error) {
  case input.vendor {
    TwelveData -> Error(VendorMismatch)
    Equibles -> assemble_equibles_capture(input, capture)
  }
}

fn assemble_equibles_capture(
  input: Input,
  capture: EquiblesCapture,
) -> Result(Output, Error) {
  use Nil <- result.try(validate_equibles_receipt(
    capture.listing_receipt,
    equibles_request.screener_path,
  ))
  use Nil <- result.try(validate_equibles_receipt(
    capture.shares_receipt,
    equibles_request.ownership_path(input.symbol),
  ))
  use Nil <- result.try(
    case
      capture.listing.ticker == input.symbol
      && capture.listing.market == "US"
      && capture.listing.name != ""
      && capture.shares.ticker == input.symbol
    {
      True -> Ok(Nil)
      False -> Error(EquiblesListingMismatch)
    },
  )
  use context <- result.try(
    track_context.new(
      track: finance_track.Us,
      market_scope: "us_equibles_company_snapshot",
      venue_mic: None,
      board: None,
      timezone: None,
      source_language: "en-US",
      providers: ["Equibles"],
      entitlement: "caller_equibles_plan",
      limitations: [
        "provider_listing_snapshot_not_exchange_identity_proof",
        "caller_mic_not_confirmed_by_provider",
        "field_effective_dates_not_supplied",
        "classification_taxonomy_not_named",
        "no_cross_listing_fallback",
        "no_profile_to_dossier_judgment",
        "float_shares_not_supplied",
        "share_count_not_confirmed_in_listing_units",
        "contact_and_ceo_not_supplied",
        "us_listing_only",
      ],
    )
    |> result.map_error(InvalidTrackContext),
  )
  use listing_source <- result.try(
    source.new(
      "Equibles",
      equibles_reference(equibles_request.screener_path, input.symbol),
      source.LicensedVendor,
    )
    |> result.map_error(InvalidSource),
  )
  use shares_source <- result.try(
    source.new(
      "Equibles",
      equibles_reference(
        equibles_request.ownership_path(input.symbol),
        input.symbol,
      ),
      source.LicensedVendor,
    )
    |> result.map_error(InvalidSource),
  )
  let listing_observation =
    observation.Observation(
      value: capture.listing,
      as_of: capture.retrieved_at,
      retrieved_at: capture.retrieved_at,
      timezone: None,
      source: listing_source,
      evidence_id: Some(identity.sha256_value(
        capture.listing_receipt.content_sha256,
      )),
      freshness: observation.UnknownFreshness,
      entitlement: observation.UnknownEntitlement,
      quality: observation.Reported,
      unit: None,
      adjustment: None,
      session: None,
    )
  let shares_observation =
    observation.Observation(
      value: capture.shares,
      as_of: capture.retrieved_at,
      retrieved_at: capture.retrieved_at,
      timezone: None,
      source: shares_source,
      evidence_id: Some(identity.sha256_value(
        capture.shares_receipt.content_sha256,
      )),
      freshness: observation.UnknownFreshness,
      entitlement: observation.UnknownEntitlement,
      quality: case capture.shares.shares_outstanding {
        None -> observation.Missing(observation.Unavailable)
        Some(_) -> observation.Reported
      },
      unit: Some(market.Shares),
      adjustment: None,
      session: None,
    )
  let fields = [
    #("schema", json.string("pi-sparkles/company-profile-result")),
    #("schemaVersion", json.int(1)),
    #("operation", json.string("company_profile")),
    #(
      "listing",
      json.object([
        #("symbol", json.string(input.symbol)),
        #("requestedMic", json.string(input.mic)),
        #("market", json.string(capture.listing.market)),
        #("currency", json.string(capture.listing.currency)),
        #("micConfirmation", json.string("not_supplied_by_provider")),
        #("identityState", json.string("exact_ticker_match_mic_not_confirmed")),
      ]),
    ),
    #(
      "profile",
      observation_json.to_json(listing_observation, equibles_listing_json),
    ),
    #(
      "shares",
      observation_json.to_json(shares_observation, equibles_shares_json),
    ),
    #(
      "source",
      json.object([
        #("provider", json.string("Equibles")),
        #("api", json.string("REST screener and ownership-summary")),
        #(
          "retrievedAtUnixMs",
          capture.retrieved_at
            |> time.unix_milliseconds
            |> int.to_string
            |> json.string,
        ),
        #("screener", equibles_receipt_json(capture.listing_receipt)),
        #("ownership", equibles_receipt_json(capture.shares_receipt)),
        #(
          "receiptState",
          json.string(
            "sha256_response_content_bound_not_provider_signature_or_origin_authentication",
          ),
        ),
        #("termsReference", json.string("https://equibles.com/docs/api")),
      ]),
    ),
    #(
      "scope",
      json.object([
        #("providerSnapshotAsOf", json.string("retrieval_time_only")),
        #("fieldEffectiveAt", json.null()),
        #("classificationTaxonomy", json.null()),
        #("sharesMeasurementAt", json.null()),
        #(
          "sharesBasis",
          json.string(
            "equibles_entity_wide_common_shares_on_current_split_basis",
          ),
        ),
        #("sharesListingUnitCompatibility", json.string("not_established")),
        #(
          "institutionalReportDate",
          json.nullable(capture.shares.institutional_report_date, json.string),
        ),
        #(
          "nullMeaning",
          json.string("provider_did_not_supply_field_in_response"),
        ),
        #("exchangeAuthorityProof", json.null()),
        #("issuerAuthorityProof", json.null()),
        #("qualityRating", json.null()),
        #("investmentJudgment", json.null()),
      ]),
    ),
    #("decisionOwner", json.string("llm")),
    #("pluginDecisionFields", json.array([], json.string)),
  ]
  Ok(Output(
    equibles_summary(input, capture),
    json.object(list.append(fields, track_json.result_fields(context))),
  ))
}

fn validate_equibles_receipt(
  value: EquiblesReceipt,
  endpoint: String,
) -> Result(Nil, Error) {
  case value.endpoint == endpoint && value.response_byte_length >= 0 {
    True -> Ok(Nil)
    False -> Error(InvalidReceipt)
  }
}

fn equibles_reference(endpoint: String, symbol: String) -> String {
  "https://api.equibles.com" <> endpoint <> " ticker=" <> symbol
}

fn equibles_receipt_json(value: EquiblesReceipt) -> json.Json {
  json.object([
    #("endpoint", json.string(value.endpoint)),
    #("responseByteLength", json.int(value.response_byte_length)),
    #("contentSha256", json.string(identity.sha256_value(value.content_sha256))),
    #("rateLimit", json.nullable(value.rate_limit, json.string)),
    #("rateRemaining", json.nullable(value.rate_remaining, json.string)),
    #("rateReset", json.nullable(value.rate_reset, json.string)),
  ])
}

fn equibles_listing_json(value: equibles_response.Listing) -> json.Json {
  json.object([
    #("ticker", json.string(value.ticker)),
    #("name", json.string(value.name)),
    #("market", json.string(value.market)),
    #("currency", json.string(value.currency)),
    #("sector", json.nullable(value.sector, json.string)),
    #("industry", json.nullable(value.industry, json.string)),
    #("marketCapRaw", json.nullable(value.market_cap, json.string)),
    #("priceRaw", json.nullable(value.price, json.string)),
  ])
}

fn equibles_shares_json(value: equibles_response.Shares) -> json.Json {
  json.object([
    #("ticker", json.string(value.ticker)),
    #("exactListing", json.bool(value.exact_listing)),
    #("outstanding", share_json(value.shares_outstanding, "sharesOutstanding")),
    #("float", share_json(None, "not_on_equibles_ownership_summary")),
    #(
      "percentUnavailableReason",
      json.nullable(value.percent_unavailable_reason, json.string),
    ),
    #(
      "institutionalReportDate",
      json.nullable(value.institutional_report_date, json.string),
    ),
  ])
}

fn equibles_summary(input: Input, capture: EquiblesCapture) -> String {
  let shares = case capture.shares.shares_outstanding {
    None -> "shares outstanding not supplied"
    Some(raw) -> raw <> " provider-reported entity-wide common shares"
  }
  let caveat = case capture.shares.percent_unavailable_reason {
    None -> ""
    Some(reason) -> " Provider percentage limitation: " <> reason <> "."
  }
  "Equibles snapshot for "
  <> input.symbol
  <> " at caller MIC "
  <> input.mic
  <> ": "
  <> capture.listing.name
  <> ", market "
  <> capture.listing.market
  <> ", "
  <> shares
  <> ". The share count is not confirmed in the requested listing's units; foreign issuers may report ordinary shares rather than US-listed ADRs."
  <> caveat
  <> " Equibles did not confirm the MIC. Snapshot retrieval time is not a field effective date; no quality or investment judgment is made."
}
