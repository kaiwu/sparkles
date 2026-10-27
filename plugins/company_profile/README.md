# company_profile

Tier coverage: **ProductUseful T2** · package behavior is promoted and verified only through the complete tier

`company_profile` is an **Experimental**, read-only US source plugin. It
registers one tool, `company_profile`. The caller selects the provider. The
default is `twelve_data`. `equibles` is a separate adapter. The tool never
falls back from one provider to the other, never shares credentials, and never
treats one provider's response as the other's.

The caller supplies one uppercase symbol and one exact MIC. The supported MICs
are `XNYS`, `XNAS`, and the Nasdaq segment MICs `XNGS`, `XNCM`, and `XNMS`.

## Twelve Data

With `provider` omitted or set to `twelve_data`, the tool calls the current
Twelve Data `/profile` and `/statistics` endpoints. It sends the symbol and
MIC on both requests, validates the profile before spending the statistics
endpoint's higher API-credit cost, then requires symbol, MIC, name, and
exchange to agree across both responses. It never falls back to another
listing or rewrites a segment MIC into `XNAS`.

Returned raw facts include:

- provider listing name, exchange, MIC, security type, description, sector,
  industry, employee count, website, contact fields, and CEO;
- exact source lexemes for shares outstanding and float shares;
- a canonical `us` track context and two canonical observation envelopes;
- response byte lengths, SHA-256 content bindings, and available Twelve Data
  API-credit headers.

Twelve Data supplies current snapshots rather than field-level effective dates.
The result therefore states that classification taxonomy/version, description
effective date, CEO appointment date, and share measurement date are unknown.
Its provider identity match is not exchange or issuer authority proof. It makes
no quality rating, peer selection, dossier sufficiency decision, or investment
judgment.

## Equibles

With `provider` set to `equibles`, the tool calls Equibles
`GET /v1/screener/stocks?tickers={symbol}&limit=1` and, only after that row is
the one requested US ticker, `GET /v1/stocks/{ticker}/ownership-summary`.
Equibles does not accept or return a MIC. The result echoes the caller MIC as
`requestedMic` and records `micConfirmation: not_supplied_by_provider`. It
does not copy that MIC into the track venue. A missing row, a non-US `market`,
more than one row, or a ticker mismatch fails closed before the ownership
call. Mainland China and Hong Kong listings are unsupported on this tool.

The screener contributes name, ISO market, currency, sector, industry, market
cap, and price. Ownership contributes entity-wide common shares outstanding on
the provider's current split basis, plus the 13F `reportDate` as
`institutionalReportDate`. Float, CEO, employees, website, description,
exchange name, and exchange timezone are not on these endpoints and stay
unknown. Screener scores are ignored. `exactListing: false` is a valid common
share row.

The result preserves `shares.value.percentUnavailableReason` verbatim and
sets `scope.sharesListingUnitCompatibility` to `not_established`. A foreign
issuer's entity-wide count may be in ordinary shares rather than the units of
its US-listed ADR. A null reason does not prove compatibility; no share-count
conversion or combination with the listing price is performed.

## Configuration

Set `TWELVE_DATA_API_KEY` or `EQUIBLES_API_KEY` to the caller's own credential
for the selected provider. A missing key rejects only that provider. Keys are
read when the tool runs. Pi and DSH both load this shell, so DSH uses the same
call-time environment variables.

Current Twelve Data documentation prices `/profile` at 10 API credits and
requires Grow individual or Venture business access or above. `/statistics`
costs 50 credits and requires Pro individual or Venture business access or
above. The provider's literal `demo` key may be used with its documented
`AAPL` trial symbol to validate these same production paths and decoders, but
it does not establish broader symbol or plan entitlement. Requests are
serialized and are not automatically retried.

`EQUIBLES_API_KEY` must be the caller's `eq_`-prefixed key. It is sent only as
`Authorization: Bearer`. Equibles counts each successful REST call against a
daily allowance shared with its MCP surface. This adapter makes one attempt.
HTTP 429 stops the call. The free plan covers the two endpoints above. It does
not confirm exchange identity.

All tests use local provider-shaped fixtures. The normal test suite makes no
live requests and consumes no Twelve Data credits or Equibles allowance.
