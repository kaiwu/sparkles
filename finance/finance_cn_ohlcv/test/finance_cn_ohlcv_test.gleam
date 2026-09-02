import finance_cn_identity/identity as cn_identity
import finance_cn_ohlcv
import finance_cn_ohlcv/assessment
import finance_cn_ohlcv/gap_receipt
import finance_core/currency
import finance_core/identifier
import finance_core/instrument
import finance_core/time
import finance_listing/effective
import finance_ohlcv
import finance_ohlcv/gap_assessment
import finance_provenance/hash
import finance_provenance/identity as provenance_identity
import gleam/list
import gleam/option.{None}
import gleam/string
import gleeunit
import gleeunit/should

pub fn main() -> Nil {
  gleeunit.main()
}

pub fn package_is_experimental_test() {
  finance_cn_ohlcv.status() |> should.equal(finance_cn_ohlcv.Experimental)
}

pub fn cn_calendar_classifies_closure_suspension_and_omission_test() {
  let listing_receipt = listing_receipt(civil(2026, 1, 1))
  let assert Ok(suspended) =
    gap_assessment.status_receipt(
      civil(2026, 6, 22),
      gap_assessment.Suspended,
      "authority:sse-halt:600519:2026-06-22",
    )
  let assert Ok(trading) =
    gap_assessment.status_receipt(
      civil(2026, 6, 23),
      gap_assessment.Trading,
      "authority:sse-status:600519:2026-06-23",
    )
  let assert Ok(value) =
    assessment.assess(
      cn_identity.Sse,
      listing_receipt,
      civil(2026, 6, 18),
      civil(2026, 6, 24),
      [civil(2026, 6, 18), civil(2026, 6, 24)],
      [suspended, trading],
      complete_provider(),
    )
  let classification = assessment.classification(value)
  gap_assessment.assessed_date_count(classification) |> should.equal(7)
  let gaps = gap_assessment.gaps(classification)
  let assert [dragon_boat, saturday, sunday, suspension, omission] = gaps
  gap_assessment.gap_state(dragon_boat)
  |> should.equal(finance_ohlcv.MarketClosure)
  gap_assessment.gap_state(saturday)
  |> should.equal(finance_ohlcv.MarketClosure)
  gap_assessment.gap_state(sunday)
  |> should.equal(finance_ohlcv.MarketClosure)
  gap_assessment.gap_state(suspension)
  |> should.equal(finance_ohlcv.Suspension)
  gap_assessment.gap_state(omission)
  |> should.equal(finance_ohlcv.ProviderOmission)
  gap_assessment.gap_evidence(omission) |> list.length |> should.equal(4)
}

pub fn incomplete_or_unexplained_cn_receipts_fail_closed_test() {
  let assert Ok(incomplete) =
    gap_assessment.provider_receipt(
      "eastmoney",
      source_reference(),
      [],
      gap_assessment.Incomplete("truncated_by_bar_budget"),
    )
  assessment.assess(
    cn_identity.Sse,
    listing_receipt(civil(2026, 1, 1)),
    civil(2026, 6, 22),
    civil(2026, 6, 22),
    [],
    [],
    incomplete,
  )
  |> should.equal(
    Error(
      assessment.InvalidAssessment(gap_assessment.IncompleteProviderCoverage(
        "truncated_by_bar_budget",
      )),
    ),
  )

  assessment.assess(
    cn_identity.Sse,
    listing_receipt(civil(2026, 1, 1)),
    civil(2026, 6, 22),
    civil(2026, 6, 22),
    [],
    [],
    complete_provider(),
  )
  |> should.equal(
    Error(
      assessment.InvalidAssessment(
        gap_assessment.MissingStatusReceipt(civil(2026, 6, 22)),
      ),
    ),
  )
}

pub fn cn_canonical_receipt_binds_market_identity_page_and_bar_dates_test() {
  let first =
    gap_projection(
      [civil(2026, 6, 18), civil(2026, 6, 24)],
      string.repeat("a", 64),
    )
  let changed = gap_projection([civil(2026, 6, 18)], string.repeat("b", 64))
  let assert Ok(first_digest) = first |> gap_receipt.canonical_text |> hash.text
  let assert Ok(changed_digest) =
    changed |> gap_receipt.canonical_text |> hash.text
  first_digest |> should.not_equal(changed_digest)
  gap_receipt.venue(first) |> should.equal(cn_identity.Sse)
  gap_receipt.pagination(first) |> should.equal(gap_receipt.Complete)
}

pub fn cn_receipt_binds_explicit_supported_provider_test() {
  let assert Ok(hash_value) = provenance_identity.sha256(string.repeat("c", 64))
  let assert Ok(page) = gap_receipt.page(1, None, 500, hash_value)
  let receipt = fn(provider) {
    gap_receipt.new(
      provider: provider,
      listing: listing(),
      start_date: civil(2026, 6, 18),
      end_date: civil(2026, 6, 24),
      limit: 250,
      source_reference: source_reference(),
      retrieved_at: instant(1_775_000_000_000),
      pagination: gap_receipt.Complete,
      pages: [page],
      bar_dates: [civil(2026, 6, 18)],
    )
  }
  let assert Ok(sina) = receipt("sina")
  gap_receipt.provider(sina) |> should.equal("sina")
  receipt("automatic") |> should.equal(Error(gap_receipt.InvalidProvider))
}

fn listing_receipt(starts: time.Date) -> assessment.ListingReceipt {
  let listing = listing()
  let assert Ok(interval) = effective.new(starts, None)
  let assert Ok(value) =
    assessment.listing_receipt(
      listing,
      interval,
      "authority:listing:600519:XSHG:2026",
    )
  value
}

fn listing() -> cn_identity.Listing {
  let assert Ok(instrument_id) = identifier.instrument_id("cninfo:10002602")
  let assert Ok(cny) = currency.from_code("CNY")
  let assert Ok(value) =
    cn_identity.new(
      instrument_id,
      "600519",
      cn_identity.Sse,
      cn_identity.SseMainBoard,
      cn_identity.AShare,
      cny,
      instrument.UnknownStatus,
    )
  value
}

fn complete_provider() -> gap_assessment.ProviderReceipt {
  let assert Ok(value) =
    gap_assessment.provider_receipt(
      "eastmoney",
      source_reference(),
      [],
      gap_assessment.Complete,
    )
  value
}

fn gap_projection(
  bar_dates: List(time.Date),
  content_hash: String,
) -> gap_receipt.Receipt {
  let assert Ok(hash_value) = provenance_identity.sha256(content_hash)
  let assert Ok(page) = gap_receipt.page(1, None, 500, hash_value)
  let assert Ok(value) =
    gap_receipt.new(
      provider: "eastmoney",
      listing: listing(),
      start_date: civil(2026, 6, 18),
      end_date: civil(2026, 6, 24),
      limit: 250,
      source_reference: source_reference(),
      retrieved_at: instant(1_775_000_000_000),
      pagination: gap_receipt.Complete,
      pages: [page],
      bar_dates: bar_dates,
    )
  value
}

fn source_reference() -> String {
  "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&klt=101&fqt=0&beg=20260618&end=20260624&lmt=250"
}

fn civil(year: Int, month: Int, day: Int) -> time.Date {
  let assert Ok(value) = time.date(year, month, day)
  value
}

fn instant(milliseconds: Int) -> time.Instant {
  let assert Ok(value) = time.instant(milliseconds)
  value
}
