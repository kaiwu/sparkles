# cn_market_data

Experimental isolated `cn` Pi plugin exposing `cn_market_movers`,
`cn_raw_vendor_quote`, and `cn_raw_vendor_history` over the shared
`finance_eastmoney` adapter, plus one exact explicitly selected
`finance_sina` STAR 50 history route. The raw
vendor names deliberately remain distinct from the ProductUseful provider-port
tools `cn_stock_quote` and `cn_stock_history`.

The tools require an exact `sse`, `szse`, or `bse` choice, a six-digit code, and
an explicit/defaulted `instrumentKind`. Current quote is listed-security only;
reviewed benchmark and sector-index codes reject from the quote path locally
without I/O and direct users to `cn_market_overview` or `cn_sector_series`.
Daily history accepts a reviewed benchmark only with
`instrumentKind=benchmark_index` and a pinned CSI sector only with
`instrumentKind=sector_index`; unreviewed index identities reject locally.
The reviewed benchmark registry includes SSE STAR 50 / 科创50 (`000688`), while
current-market requests for it belong to the single-batch `cn_market_overview`
route.
Eastmoney does not prove security kind, share class, currency, or index
authority. History is daily, raw, and unadjusted
(`fqt=0`) and preserves exact numeric response lexemes.

`cn_raw_vendor_history` requires an explicit `provider`. `eastmoney` is the
normal selection. If Eastmoney fails for the exact reviewed SSE STAR 50 index
(`venue=sse`, `code=000688`, `instrumentKind=benchmark_index`), the error says
that Sina is available, says that Sina was not called, and requires the caller
to ask the user. Only after the user explicitly accepts may a new call repeat
the exact identity, date window, and limit with `provider=sina`. That second
call contacts Sina only and visibly reports
`dataSourceChange=eastmoney->sina_by_explicit_user_choice` and
`fallbackPerformed=false`. No automatic fallback exists. Other benchmark and
sector histories remain Eastmoney-only. The Sina response does not echo the
index identity, price unit, amount, adjustment, calendar, or volume unit, so
the reviewed registry binds the identity, prices are labelled index points,
and the remaining facts stay unknown.

Results visibly report the selected vendor origin, direct or explicit-alternative route, provider
timestamp/retrieval time, local-analysis entitlement, unknown latency/service
level/redistribution rights, unverified volume semantics, and every limitation.
They are not exchange observations and do not silently use AKShare as origin,
though the contract follows the same endpoints used by its Eastmoney functions.

Set the shared non-secret `AGENT_CONTACT`; the plugin supplies its product
label. Normal tests never make live requests.

`cn_raw_vendor_history` emits every bounded daily OHLCV row in model-visible
tool content as well as structured result details; the count-only first line is
only a compact display summary. Its result contains declarative evidence
boundaries rather than instructions to the model, and each receipt digest is
emitted once. For current history, `endDate` must not be in the future and the
one-to-1,000 `limit` must cover the expected daily sessions in the inclusive
window; callers should narrow the window or raise the limit before calling,
not probe the provider with mismatched ranges. Current overall-market requests belong to the batched
`cn_market_overview` acquisition route.
Broad industry-sector comparisons compose `cn_sector_series` with
`compare_series_returns`; callers should not guess 申万 or Eastmoney board codes
through the single-series history tool.

`cn_market_movers` performs one non-retrying provider request for one exact
Eastmoney listing-category filter and preserves the provider's descending
`f3` order and exact numeric lexemes. It does not create its own ranking,
resolve exact venue/security identity, prove a complete A-share universe,
calculate indicators, analyze the returned names, or recommend trades. The
page receipt reports one logical request and one transport attempt.
General list analysis should compare the returned observations directly and
stop. It must not automatically fan out per-row classification, identity, or
market-data calls. Provider amount, volume, and capitalization lexemes retain
unknown currency, unit, and scale, so consumers must not convert them to
thousands/millions/billions or Chinese `wan`/`yi` display units. A cluster of
provider percentages is not dated price-limit or board evidence.
Price-like lexemes also have unknown currency and must not be labelled as CNY,
RMB, yuan, or a currency-denominated price band.
The provider filter does not verify security kind, so rows remain
provider-filtered CN listing-category observations rather than authenticated
A-share instruments. `last` is not promoted to an official close while market
session state and latency remain unknown.

Cross-track review: HK remains `track_partial` until a reviewed HK
provider-ranked universe filter and conformance fixture exist. US remains
`track_partial`; Alpaca's existing asset-master acquisition is not a current
market-movers endpoint. Neither track silently consumes the CN page.

## T1 provider-port migration

The current implementation is the Eastmoney adapter evidence, not the final
provider-selection architecture. During T1, the canonical CN quote/history
port moves behind explicit adapter selection. Eastmoney remains the first
adapter and Tushare Pro supplies the second conformance proof using caller-owned
`TUSHARE_TOKEN` from the runtime or opt-in-test environment. The plugin-facing
identity, observation, receipt, error and cancellation contract remains stable;
provider-specific fields and limitations remain visible. No credential is
bundled or persisted, and no adapter silently falls back to another provider.
