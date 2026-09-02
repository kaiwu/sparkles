# Provider Call Inventory

This is the exhaustive inventory of concrete third-party request constructors
under `finance/*/src/**/request.gleam`. Generic `finance_http`, cache,
provenance, and caller-supplied import transports are not providers. The Futu
T6 probes are listed separately because they are temporary acceptance lanes,
not normal `finance_http` adapters.

Status is from the bounded, read-only live audit on 2026-08-19, plus the
bounded Sina CN endpoint review on 2026-09-02. `decoded` means
the built production plugin and its real decoder accepted the response.
`contract` means the exact live response satisfied the package's bounded media
or tabular-envelope contract but was not replayed through a product tool.
`auth only` means the exact production host/path was reached and rejected the
missing credential, so response conformance remains unproved. A provider HTTP
success is not counted as decoded when the shipped product normalization then
rejects a current provider value.

## Overall result

| Coverage class | Calls | Meaning |
| --- | ---: | --- |
| Live production-decoded | 33 | Exact request and production decoder passed. |
| Live response-contract | 7 | Exact public response passed media/signature/size checks. |
| Live Tushare schema | 4 | Exact production body returned code 0, exact fields, and valid row widths; calls were not repeated through plugins because of the provider's unusually restrictive rate limits. |
| Entitlement-blocked | 4 | The supplied free Tushare token is valid but provider code `40203` denies these APIs. |
| **Total concrete calls** | **48** | Every call was either live-validated or reached an exact, named credential/entitlement boundary. |

## Concrete calls

| Provider | Request constructor / endpoint | Current live status | Credential or same-request test environment |
| --- | --- | --- | --- |
| CAPCO | `classification_pdf` — reviewed classification PDF | decoded | Public production URL; no sandbox or key. |
| CNINFO | `security_master` — `/new/data/szse_stock.json` | decoded | Public production URL; `AGENT_CONTACT` identifies the operator but is not a provider key. |
| CNINFO | `announcements` — `/new/hisAnnouncement/query` | decoded | Public production URL. |
| CNINFO | `document` — exact repository PDF | contract | Public production URL; PDF media, signature, and bound passed. |
| CSRC | `snapshot(MarketMonthly)` | contract | Public production URL; no sandbox or key. |
| CSRC | `snapshot(MarketWeekly)` | contract | Public production URL; no sandbox or key. |
| CSRC | `snapshot(ConsultationFeedback)` | contract | Public production URL; no sandbox or key. |
| Eastmoney | `quote` — `/api/qt/stock/get` | decoded for separately labelled `cn` and `hk` legs | Public production URL; no sandbox or key. |
| Eastmoney | `cn_overview` — `/api/qt/ulist.np/get` | decoded | Public production URL. |
| Eastmoney | `cn_movers` — `/api/qt/clist/get` | decoded | Public production URL. |
| Eastmoney | `history` — `/api/qt/stock/kline/get` | decoded for separately labelled `cn` and `hk` legs; operationally unavailable with connection-level failures on 2026-09-01/02 | Public production URL. The failures exposed no HTTP `Retry-After` or reset time, so a ban-lift time is unknown. Production shells now share one request/two seconds and make no automatic retry. |
| Eastmoney | `cn_income_statement` — `/api/data/v1/get` | decoded | Public production URL. |
| Eastmoney | `hk_income_context` — `/securities/api/data/v1/get` | decoded | Public production URL. |
| Eastmoney | `hk_income_statement` — `/securities/api/data/v1/get` | decoded | Public production URL. |
| FRED | `metadata` — `/fred/series` | decoded, HTTP 200 | Supplied mode-0600 `/tmp/fred` caller token; exact production request and shipped `macro_fred` decoder passed. The runner received only `FRED_API_KEY` and did not read the file. |
| FRED | `observations` — `/fred/series/observations` | decoded, HTTP 200 | Same credentialed production-tool invocation; exact point-in-time bounds, response cap, and decoder passed. |
| HKEX | `full_list` — `ListOfSecurities.xlsx` | decoded | Public production URL; no sandbox or key. |
| HKEX | `recent_listings` | decoded | Public production URL. |
| HKEX | `board_meetings(MainBoard)` | decoded | Public production URL. |
| HKEX | `board_meetings(Gem)` | decoded | Public production URL. |
| HKEX | `document` — exact HKEXnews PDF | contract | Public production URL; PDF media, signature, and bound passed. |
| HKEX | `security_prefix` — `/search/prefix.do` | decoded | Public production URL. The provider currently requires the literal JSONP wrapper `callback(...)`. |
| HKEX | `titles` — `/search/titlesearch.xhtml` | decoded | Public production URL. |
| Alpaca | `daily_bars` — `/v2/stocks/bars` | decoded, HTTP 200 | Supplied mode-0600 `/tmp/alpaca` caller key pair; one exact IEX request passed through the shipped `us_ohlcv` decoder. The runner received environment variables only and did not read the file. |
| Alpaca | `latest_quote` — `/v2/stocks/quotes/latest` | decoded, HTTP 200 | The current closed-session IEX response used ask exchange `" "`, ask price `0`, and ask size `0`. The shared Pi/DSH quote snapshot preserved that exact no-ask sentinel, returned the ask as unavailable rather than tradable zero, and passed one reviewed post-fix live recheck. |
| Alpaca | `asset_universe` — paper `/v2/assets` | decoded, HTTP 200 | The supplied Trading API credentials passed on the explicit paper host. The same credentials returned HTTP 401 on the separately selected live host; full live-broker onboarding is not required for the paper catalogue contract. |
| Alpaca | `corporate_actions` — `/v1/corporate-actions` | decoded, HTTP 200 | Same caller-owned key pair; one bounded request passed through the shipped `stock_corporate_actions` decoder. |
| Alpaca | `news` — `/v1beta1/news` | decoded, HTTP 200 | Same caller-owned key pair; one bounded request passed through the shipped `finance_news` decoder. |
| OpenFIGI | `mapping` — `/v3/mapping` | decoded | Anonymous calls are officially supported on the exact production API at a lower rate limit; no key needed. |
| OpenFIGI | `search` — `/v3/filter` | decoded | Same anonymous production API. |
| SEC | `company_tickers` | decoded | Public production API; a real `AGENT_CONTACT` is required by repository access policy, not as a provider credential. |
| SEC | `submissions` | decoded | Public production API. Live SEC now emits the submission CIK as a zero-padded string; both documented numeric and current string shapes are accepted. |
| SEC | `company_facts` | decoded | Public production API. Provider-null concept labels/descriptions remain empty/unknown rather than invalidating unrelated facts. |
| SEC | `company_concept` | decoded | Public production API. |
| SFC | `press_releases` — RSS | contract | Public production URL; XML media and byte bound passed. |
| Sina Finance | `history` — `/quotes_service/api/json_v2.php/CN_MarketData.getKLineData` | contract, current CN exact-string OHLCV rows and exact SSE STAR 50 `sh000688` rows observed through 2026-09-02; shipped decoder fixture- and live-tool-tested | Public production URL. Separate, explicitly user-selected CN SSE/SZSE A-share alternative and exact reviewed SSE STAR 50 (`000688`) history alternative only; it is never called automatically after Eastmoney failure. Response does not echo identity or amount. One request/two seconds, one in flight, no retry. |
| SSE | `constituents` — `/commonSoaQuery.do` | decoded, 50 rows | Public production URL; the shipped `cn_index_constituents` decoder accepted the complete `000688` manifest published 2026-08-19. No credential or Tushare fallback. |
| SSE | `industry_composition` — `/commonSoaQuery.do` | decoded, 6 rows | Public production URL; the shipped `cn_index_industry_composition` decoder accepted aggregate sector counts covering all 50 members and exact weight lexemes effective 2026-08-18. |
| Tushare | `stock_basic` | live schema, 1 row | Supplied mode-0600 `/tmp/tushare` free token; exact production request, no retry. |
| Tushare | `daily` | live schema, 2 rows | Same free token. |
| Tushare | `namechange` | live schema, 4 rows | Same free token. |
| Tushare | `dividend` | live schema, 96 rows | Same free token. |
| Tushare | `forecast` | entitlement-blocked, code `40203` | The free token is valid but lacks this API permission; Tushare offers no keyless same-request sandbox. |
| Tushare | `express` | entitlement-blocked, code `40203` | Same account entitlement boundary. |
| Tushare | `disclosure_date` | entitlement-blocked, code `40203` | Same account entitlement boundary. |
| Tushare | `announcements` (`anns_d`) | entitlement-blocked, code `40203` | Same account entitlement boundary. |
| Twelve Data | `profile` — `/profile` | decoded with official `demo` key | The literal `demo` credential works on the exact production host/path for documented trial symbol `AAPL`. |
| Twelve Data | `statistics` — `/statistics` | decoded with official `demo` key | Same production request and full decoder passed. This proves trial-symbol compatibility, not general plan entitlement. |

The normal non-metered audit is `bun run test:live:providers`. A focused
recheck is `bun run test:live:providers -- --check provider.operation`.
`bun run test:live:sec` retains the deeper seven-request SEC compatibility
lane. Neither command is part of normal tests, tier verification, packaging, or
publication.

All production provider transports enter `finance_http/limiter` directly or
through `finance_authority_snapshot`. The process-local quota is shared across
independently loaded Pi and DSH shells; injected test runtimes remain isolated.
The architecture lane fails any concrete transport that calls
`finance_http/transport.send` without the shared limiter. This does not claim
cross-process coordination or immunity from undocumented provider quotas.

## CN/HK Sina alternative applicability

| Track | Status | Exact behavior |
| --- | --- | --- |
| `cn` | supported for SSE/SZSE CNY A-shares and exact reviewed SSE STAR 50 history | Eastmoney remains the normal selection. Its failure suggests Sina and explicitly says Sina was not called. Only after the user chooses Sina may a new call supply `provider: "sina"`; that call contacts only Sina and reports `dataSourceChange: "eastmoney->sina_by_explicit_user_choice"`, `fallbackPerformed: false`, and one Sina attempt. |
| `hk` | `track_partial`, not exposed | Sina's official HK history surface observed during review ended in 2019. It is not accepted as a current OHLCV alternative. |
| `us` | unsupported | No Sina alternative is selected or implied. |

## Current-index acquisition track applicability

| Track | Status | Missing or controlling evidence |
| --- | --- | --- |
| `cn` | supported | Exact official SSE `000688` current membership and aggregate industry composition only. |
| `hk` | `track_partial` | No reviewed exact index/administrator contract, complete-membership decoder, effective-date/correction contract, or licence/redistribution decision. |
| `us` | `track_partial` | No selected exact benchmark/administrator contract, complete-membership acquisition/decoder, listing/correction contract, or licence/redistribution decision. |

HK and US authority candidates were reviewed, but no provider call is listed or
implied until its exact request and shipped decoder exist. CN evidence is never
relabelled or substituted across tracks.

## Futu temporary live acceptance calls

Futu is not one of the 47 normal request constructors. Its OpenD transaction-
ticker and rights baselines predate this audit and are recorded in `FUTU.md`.
On 2026-08-18 a newly started OpenD was confirmed listening on
`127.0.0.1:11111`. The first bounded localhost WebSocket initialization was
rejected before a provider request because login was not ready. After the
operator explicitly confirmed login, one human-reviewed all-track rights
recheck passed: XSHG and XSHE returned Level 1, while XHKG and the generic US
surface returned Level 2. It made exactly one protocol-1005 rights request and
zero subscription, history, snapshot, trade, retry, or reconnect calls. The
bridge was stopped immediately and OpenD was left caller-owned. Futu's official
paper environment simulates trading; it does not replace quote-feed identity,
rights, ticker sequence, unsubscribe, or recovery conformance.

| Lane | Status / exact prerequisite |
| --- | --- |
| US ticker | Prior baseline passed for separately labelled XNAS and XNYS regular-session legs and one XNAS extended-hours leg; not repeated merely to collect more events. |
| CN ticker | Prior baselines passed separately for XSHG and XSHE; XBSE remains unsupported. |
| HK ticker | Prior XHKG baseline passed. |
| US rights | US Level 2 was returned by the prior all-track protocol-1005 baseline; the narrower standalone lane was not needed. |
| Track rights | Prior all-track baseline and 2026-08-18 current-session recheck passed: XSHG/XSHE Level 1, XHKG/generic-US Level 2. |
| Web API OAuth | Blocked: interactive caller consent for exact `quote:read`. |
| Direct ticker HTTP | Blocked: valid short-lived quote token from that OAuth lane. |
| Direct ticker WebSocket | Blocked: valid short-lived quote token and explicit WebSocket confirmation. |
