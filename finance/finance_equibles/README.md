# finance_equibles

`finance_equibles` is an **Experimental**, Pi-independent adapter for two
read-only Equibles endpoints. It uses `finance_http` for bounded, cancellable
transport and keeps the caller's API key in a secret `Authorization: Bearer`
header. The key is never placed in a query string.

Equibles does not publish Twelve Data's `/profile` and `/statistics` pair.
This adapter does not translate those responses. It requests the Equibles
surfaces that actually carry a US listing snapshot:

| Endpoint | Response bound | Purpose |
| --- | ---: | --- |
| `GET /v1/screener/stocks?tickers={symbol}&limit=1` | 200 KB | One exact ticker row: name, ISO market, currency, sector, industry, market cap, and price |
| `GET /v1/stocks/{ticker}/ownership-summary` | 500 KB | Entity-wide common shares outstanding on the provider's current split basis |

The screener call is one ticker, not a market screen. A missing row, a non-US
`market`, or more than one row fails closed. The caller-supplied MIC is not
sent, because these routes do not accept or return one. Share counts stay
exact source lexemes. Fractional or negative share counts fail decoding.
Null share counts stay absent. Provider JSON containing the internal numeric
marker is rejected; an object cannot impersonate an exact source number.

Requests are serialized at one per second and are not retried. Equibles counts
each successful REST call against a daily MCP+REST allowance that resets at
00:00 UTC. Failed HTTP responses do not consume that allowance, but a retry of
a request that might succeed would. HTTP 429 stops the call. The local
one-per-second gate is not the provider's daily counter.

Free-plan access includes these two endpoints. Intraday quotes, option chains,
and the newest session's daily bars before four hours after the close are
plan-gated and are not requested here. Sector and industry names are the
provider's screener taxonomy without a version. Shares outstanding are
entity-wide, not a class float. CEO, employees, website, description, and
exchange MIC are not on these responses.

The raw `percentUnavailableReason` is retained. In particular, a foreign
private issuer can report ordinary shares instead of the US-listed ADR unit.
Neither a null reason nor an exact ticker match proves that the count uses
the listing's units; the adapter performs no ADR conversion.

The credential is the caller's `eq_`-prefixed Equibles key. Access,
redistribution, and entitlement remain the caller's Equibles plan.

## Sources

- <https://equibles.com/docs/api>
- <https://equibles.com/docs/authentication>
- <https://equibles.com/docs/rate-limits>
- <https://equibles.com/docs/api/errors>
- <https://equibles.com/docs/api/endpoints/securities>
- <https://api.equibles.com/openapi/v1.json>

Tests use provider-shaped local fixtures and scripted transport only. They make
no live requests and consume no daily allowance.
Live checks require explicit `--check equibles.screener_and_ownership`
selection in `bun run test:live:providers`, even when the key is configured.
