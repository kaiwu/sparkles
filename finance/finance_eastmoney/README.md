# finance_eastmoney

Status: **Experimental** · version: `0.1.0` · target: JavaScript/Bun

A bounded, caller-identified adapter for Eastmoney's public web quote, daily
K-line, and narrow CN/HK income-statement endpoints. It is a vendor-origin
local-analysis source, not an exchange, regulator, official filing repository,
licensed production feed, or proof of redistribution permission.

The adapter is intentionally narrow:

- explicit `cn_sse`, `cn_szse`, `cn_bse`, or `hk` market plus exact code;
- current/delayed quote prices decoded from provider integers and their exact
  decimal scale, without converting through binary floating point;
- raw, unadjusted daily bars only, with every comma-separated numeric source
  lexeme preserved;
- an exact pinned 11-index CSI 800 level-one sector query profile that keeps
  financials (`000974`) and real estate (`399965`) separate and excludes the
  legacy combined `000934`; CSI remains the index/classification authority and
  Eastmoney only the price vendor;
- one bounded, non-retrying mainland provider-ranked movers page that preserves
  exact numeric lexemes and returned `f3` order for one explicit provider
  filter without claiming authoritative universe completeness, venue identity,
  analysis, or recommendation;
- inclusive date range and maximum 1,000-bar response budget;
- a mainland wide-row income slice retaining exact source tokens for
  `TOTAL_OPERATE_INCOME` and `PARENT_NETPROFIT`, with caller-declared
  presentation currency and unknown report start/standard/scope/audit/version;
- an HK report-context plus standardized-line slice that strictly proves code,
  name, organization, report end, start, fiscal year, and row coherence before
  exposing provider currency/accounting standard/report type and exact amounts;
- executable, market-owned single-code mappings for revenue and parent/
  shareholder-attributable net income, plus exact source-retaining net margin;
- exact code-response matching, 15-second/byte bounds, cancellation, one
  request per two seconds per host across independently loaded Pi/DSH shells,
  one in flight, bounded queues, no automatic retry, and caller `User-Agent`;
- no code-prefix venue inference, adjustment equivalence, realtime claim,
  entitlement upgrade, or stale fallback.

The contract follows the same underlying endpoints used by AKShare's market
functions, its `stock_report_em` mainland statement module, and its
`stock_finance_hk_em` HK statement module. Our adapter calls Eastmoney directly
so provenance remains `Eastmoney`, rather than being flattened to the wrapper
library. Public visibility does not establish production stability, official
filing identity, correction history, service levels, licence, or redistribution
rights.

JSON numeric tokens are captured from the runtime's `JSON.parse` reviver source
context before typed decoding, using the same exact-token strategy as
`finance_sec`. A runtime without that standardized source context fails the
decoder instead of converting financial values through binary floating point.
CN and HK request plans have separate allowlisted origins; HK retrieval uses two
separately admitted requests and rejects an incoherent join. No pagination,
silent fallback, cache,
generated report, or silent alternative mapping is hidden in this slice.

Normal tests use fixed response strings and injected transports only. Live
research probes are manual, bounded, read-only, caller-identified, and never
part of `bun run test`.
