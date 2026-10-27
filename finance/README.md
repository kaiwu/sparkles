# Finance libraries

This directory contains reusable Gleam libraries for finance plugins and other
applications. They do not import `pi_gleam`, export Pi extensions, or produce
artifacts under `dist/`.

The initial foundations, provider adapters, and early three-track domain
packages are **Experimental**. Their shared `0.1` layer is suitable for
developing plugins in this monorepo; public APIs and wire formats may still
change before stability.

```text
finance_core ─┬─> finance_provenance
              ├─> finance_track
              ├─> finance_evidence <─ finance_provenance + finance_track
              ├─> finance_listing  <─ finance_provenance + finance_track
              ├─> finance_http ─┬─> finance_openfigi
              │                 ├─> finance_sec
              │                 ├─> finance_fred
              │                 ├─> finance_twelve_data
              │                 ├─> finance_equibles
              │                 ├─> finance_capco
              │                 ├─> finance_eastmoney
              │                 ├─> finance_market_alpaca
              │                 └─> finance_testkit
              ├─> finance_table
              ├─> finance_math ────> finance_series
              ├────────────────────> finance_series
              ├────────────────────> finance_ohlcv <─ finance_series + calendar + math
              ├────────────────────> finance_quote
              └─> finance_calendar ─┬─> finance_sec
                                    └─> finance_market_calendar

finance_listing ───────> finance_cn_identity ───────> finance_cn_calendar
                   └───> finance_hk_identity ───────> finance_hk_calendar
finance_market_calendar ────────────────────────────> both calendar packages
finance_market_rules ─────> finance_cn_rules / finance_hk_rules
finance_market_authorities ─> isolated CN/HK setup registries
finance_market_documents ─> finance_cn_documents / finance_hk_documents
                         └─> finance_document_attachment
finance_provider_strategy ─> isolated fallback, 85% coverage, and credibility receipts
finance_authority_snapshot ─> CSRC/SFC text and CNINFO/HKEXnews discovery/binary adapters
finance_authority_pdf ──────> same-artifact finance_pdf inspection composition
finance_market_accounting ─> finance_cn_accounting / finance_hk_accounting
finance_testkit ────────────> finance_cn_testkit / finance_hk_testkit
finance_track_capabilities ─> isolated CN/HK setup shells

finance_core + listing + provenance
              └────────────> finance_strategy (Experimental evidence packet;
                              consumes feature, risk, rule, and execution facts)
finance_core + math + ohlcv + provenance + track
              └────────────> finance_indicators (Experimental calculation and
                              semantic-receipt core)
finance_core + math + provenance + track
              └────────────> finance_risk (Experimental calculation and
                              semantic-receipt core)
finance_core + math + provenance + track
              └────────────> finance_execution (Experimental execution-
                              information and semantic-receipt core)
finance_core + provenance + track
              └────────────> finance_journal (Experimental immutable journal-
                              information and requested-calculation core)
finance_core + calendar + provenance + track
              └────────────> finance_replay (Experimental shared replay,
                              trial, calculation, and reproduction core)
```

The diagram shows dependency direction from foundation to consumer.
`finance_track` depends only on core and JSON; `finance_evidence` composes core,
track, and provenance; `finance_listing` owns only reusable effective-dated
identity primitives. `finance_series` depends on core and math; calendar depends
only on core, while the bounded market-calendar wrapper adds source, licence,
track, version, and coverage metadata. Shared market-rule, document, accounting,
and capability packages provide validation and selection laws; their CN/HK
consumers own market vocabulary and never import one another.
The authority contract validates track-scoped source ownership, official links,
operational access, redistribution, and limitations without embedding any
market's registry in the shared package.
`finance_testkit` depends on core and HTTP. `finance_openfigi`, `finance_sec`,
`finance_fred`, `finance_twelve_data`, `finance_equibles`, `finance_capco`, `finance_eastmoney`, and
`finance_market_alpaca` remain reusable outside Pi and share the HTTP policies
rather than implementing plugin-local fetch stacks. Eastmoney's public-web
adapter is local-analysis-only with unknown latency, service level, and
redistribution; it preserves exact quote scaling and raw daily-bar lexemes
instead of presenting itself as an official or licensed feed. The SEC adapter
also owns lossless XBRL source-number
decoding and composes calendar arithmetic for explicit statement-period shapes,
so every consumer sees the same exact facts and period rules. No core package or core
test may depend on testkit or a provider adapter.

`finance_strategy` is an Experimental provider-neutral functional core for the
resolved completed-daily-bar `CG-SWING` workflow. It packages versioned
hypothesis data, projects per-input compatibility, round-trips exact evidence
receipts, validates LLM/user plan declarations, and folds
planned-versus-observed structural history. It deliberately emits no setup,
trade, recommendation, or plan-acceptance decision; the LLM owns those. It does
not own feature arithmetic, sizing, market rules, execution, providers, or Pi.

`finance_ohlcv` composes core, calendar arithmetic, exact series/math, and
canonical observations. Its `CG-MARKET-DATA` information contract preserves
known, unknown, not-obtained, conflicting, decode-failure, mechanical-check,
timing, quantity, rights, interrupted-acquisition, and available-operation
facts in a typed packet; none is an aggregate correctness or workflow verdict.
The stricter legacy `Bar`/`Batch` projection retains source lexemes beside
normalized decimals, validates geometry and ordering for requested
calculations, collapses only exact duplicates, and keeps provider pagination
completeness separate from evidence-backed calendar-gap classification. The
Alpaca adapter is its first US acquisition seam; IEX/SIP, credentials,
symbol-as-of identity, raw adjustment, and sourced rights remain explicit.

`finance_indicators` is the Experimental calculation-only core authorized by
the resolved `CG-TECH` contract. Its first slice implements exact SMA, Wilder
RSI, true range, and Wilder ATR with caller-selected input basis, window, gap,
parseable-value, seed/convention, and rounding policies. Canonical request and
semantic-result receipts bind ordered inputs, intermediate values, omissions,
unknowns, conflicts, evidence roots, and explicitly requested projections. It
emits no interpretation, readiness, signal, candidate, recommendation, or next
action; the LLM owns all of those decisions.

`finance_risk` is the Experimental calculation-only core authorized by the
resolved `CG-RISK` contract. Its first long-only completed-daily slice preserves
sourced account, plan, market-rule, scenario, position, and cost fact states;
calculates only explicitly requested planned/gap loss, budget, quantity-bound,
grid, intersection, heat, remaining-budget, and cost expressions; and binds
them into non-self-referential request and semantic receipts. It has no policy
defaults and emits no selected quantity, plan status, recommendation,
authorization, or next operation; the LLM owns all such decisions.

`finance_execution` is the Experimental information/calculation core authorized
by the resolved execution-information slice of `CG-DAY`. It keeps desired
instructions separate from sourced broker capabilities, runs only explicitly
selected visible-depth or daily-bar scenario models, preserves ordered
lifecycle and fill leaves, calculates requested fill/cost/benchmark/latency
expressions, and emits content-bound receipts. It has no broker encoding or
fallback choice, fill prediction, correctness/sufficiency judgment, workflow
decision, ambient effect, or mutation authority; the LLM owns every decision.

`finance_journal` is the Experimental information core authorized by the
resolved journal-information slice of `CG-PSYCHOLOGY`. It preserves exact
attribution, open declaration vocabulary, explicit information states,
immutable corrections/redactions, point-in-time replay, partial checklist
answers, caller-selected privacy projections, requested plan-observation
comparisons and realized net P&L, compact context, and content-bound receipts.
It performs no storage or Pi effect and never infers psychology, grades process,
judges correctness/sufficiency, explains performance, changes risk, recommends,
or chooses a next operation; the LLM owns all such decisions.

`finance_replay` is the Experimental provider-neutral core authorized by the
resolved shared-replay slice of `CG-QUANT`. It binds exact universe, dataset,
feature, strategy, risk, execution, partition, trial, event, checkpoint,
calculation, comparison, context, and reproduction receipts; folds only the
caller-supplied event order; exposes unknown-time ambiguity; and provides a
bounded local scripted interpreter. It never selects a research input or
policy, chooses among branches or trials, judges correctness/sufficiency,
labels edge/significance/robustness/deployability, or chooses a next operation;
the LLM owns every such decision.

`finance_quote` is the smaller provider-neutral latest-quote contract. It
preserves exact price and size lexemes, market codes, source time, currency, and
canonical observation metadata, while refusing to infer consolidation,
freshness, session, or the provider's changing size semantics. The Alpaca
adapter supplies an explicitly selected IEX/SIP acquisition seam for it.

`finance_cn_testkit` and `finance_hk_testkit` are outward market-owned test
packages, not provider-neutral foundations. Each composes the base seeded
testkit and its own identity/calendar/rules/documents/accounting packages; an
architecture gate prevents either from importing the sibling market package.

## Functional architecture

All packages follow the repository's `FUNCTIONAL_DESIGN.md` standard. This is a
release gate, not a stylistic preference:

- domain values are immutable and created through validating constructors;
- parsing, normalization, finance rules, calculations, rendering, retry
  decisions, cache policy, and workflow transitions are pure functions;
- expected failure is an exhaustive `Result`, not a throw or sentinel value;
- clocks, randomness, HTTP, storage, hashing FFI, and file access are explicit
  capabilities interpreted at package boundaries;
- stateful policies expose pure reducers from previous state plus event to next
  state plus effects;
- deterministic production interpreters and scripted test interpreters obey the
  same contracts;
- tests cover laws, round trips, idempotence, invariants, and event sequences in
  addition to individual examples.

An effectful package such as `finance_http` is not exempt: network execution is
the shell, while request normalization, retry classification, delay choice,
rate-limit evolution, cache decisions, cassette matching, and error redaction
remain pure and independently testable.

The F0 Pi extensions and the
`sec_edgar`/`sec_xbrl`/`stock_fundamentals` F1 slices are now Experimental.
The isolated `us_quote`, `us_ohlcv`, `cn_ohlcv`, and `hk_ohlcv` slices are Experimental
over `finance_ohlcv`. US composes `finance_market_alpaca`; CN/HK independently
compose `finance_eastmoney`. Missing-session classification remains unavailable
until each shell composes its reviewed market calendar/status contract, and the
Eastmoney slices preserve date-only anchors and unknown provider volume units.
The US quote slice preserves bid/ask exchange, condition, tape, exact price and
size tokens, and unknown freshness/latency/size-unit semantics.
`stock_research_report` is a Pi plugin rather than a finance package. Its pure
domain module validates bounded copied Alpaca/SEC receipts and renders stable
source roots; its shell only registers the compositor and queues the explicit
agent workflow. It does not introduce another HTTP or provider dependency.
`watchlist` is likewise a Pi workflow plugin, not a provider or finance
foundation. It composes `finance_listing` keys and `finance_track`, keeps each
member's track explicit, and persists only bounded user-authored events in the
active Pi branch; it contributes no market-source coverage.
The SEC foundation also supplies pure exact-period filing resolution, strict
source-retaining Q4 subtraction, and comparable direct-fact trend validation;
provider I/O and Pi rendering remain outside those derivation laws.
`stock_fundamentals` composes those proven candidates with local `finance_math`
formula trees for free cash flow, net margin, and diluted EPS, retaining every
input instead of embedding arithmetic in its effect shell. Its growth and TTM
compositions additionally validate explicit calendar gaps, exact direct-quarter
continuity, and an annual-shaped complete TTM window. The complementary TTM
bridge retains and validates annual, current-YTD, and prior-YTD sources.
Mixed-quarter TTM uses an explicit direct/derived sum type and expands derived
Q4 observations into their direct annual and YTD formula leaves.
Named multi-input metrics may select each SEC accession independently, then
apply the pure same-period and same-filing proof before formula evaluation.
`finance_fred` validates the caller's per-user API key, exact series/range/as-of
query, raw-level response semantics, strict complete-range bound, exact source
lexemes, and point-in-time envelope echoes. It has no search, transformation,
release-calendar, forecast, interpretation, or Pi layer.
`finance_twelve_data` validates the caller's per-user API key and exact US
symbol/MIC query, sends the same scope to both profile and statistics endpoints,
preserves exact count lexemes and nulls, serializes the two credit-bearing
requests, and performs no retry, MIC relabelling, fallback, or profile judgment.
`finance_equibles` is a separate US listing snapshot adapter. It validates an
`eq_`-prefixed bearer key, requests one screener row and a matching
ownership summary, and preserves exact count lexemes. The caller MIC stays
unconfirmed, and the decoded snapshot stays in Equibles types.
`finance_capco` fixes one reviewed public CAPCO result page and its 2025-H2 PDF,
requires the exact response length and SHA-256 before bounded PDF.js extraction,
and parses only the requested six-digit stock-code row. It keeps the guideline
effective date, half-year result label, publication date, and retrieval instant
separate; publishes only the source's 门类, 大类, and manufacturing 次类; and
does not infer MIC, per-company validity, 中类, cross-taxonomy mappings, or
redistribution permission.

Later plugins should be selected
only after their provider adapters have endpoint, authentication, entitlement,
licence, pacing, pagination, and cache designs comparable to
`finance_openfigi`, `finance_sec`, `finance_fred`, `finance_twelve_data`, and
`finance_capco`.

## Completed 0.1 foundation

The base supports provider-neutral exact values and observation envelopes;
closed `cn`/`hk`/`us` market-track identity and versioned result context;
typed evidence compatibility and explicit cross-track validation;
track/MIC-scoped listings with effective aliases and relationships;
source-labelled effective rules that fail on missing or conflicting regimes;
original-document/version/translation identity, strict versioned lossless wire
codecs, bounded attachment acceptance, and lossless accounting values with
executable ambiguity-preserving mappings;
safe cancellable HTTP with retry, rate, queue, cache, and cassette policies;
track-isolated provider priority with exact semantic fallback and per-family
85% union-coverage assessments that retain critical gaps and source groups;
separate equal-weight source-control credibility receipts whose percentage is
evidence maturity rather than truth probability;
arbitrary exact formula trees plus bounded approximate analytics; ordered,
missing-aware and as-of-aligned series with exact returns, OHLCV, paths, and
portfolio attribution; market sessions, business days, day counts, joint
calendars, and coupon schedules; canonical evidence manifests with bounded
verification; unit-aware bounded Markdown/CSV/JSON tables; and deterministic
synthetic/conformance test tools.

The first market-owned layers add separate CN and HK identity, calendar, rules,
document, accounting, and seeded scenario packages over those primitives.
CNINFO and HKEXnews now have bounded public local-analysis security/disclosure
discovery contracts and isolated Pi shells; they preserve candidate identity,
exact document paths, truncation, and rights limitations. Isolated calendar
shells compose source-reviewed, coverage-bounded 2026 SSE/SZSE/BSE and HKEX
schedules, including HK half-days. Authoritative venue security masters,
later-year/exceptional calendar refresh, broader rule regimes, production
market-data rights, PDF statement decoding, and accounting mappings remain open
source-evidence and rights work. Narrow official profiles cover established
normal mainland CNY equities from 2026-07-06 and applicable HKD equity spread
bands from 2026-08-03; HK board lots remain issuer-specific caller evidence.
Shared Eastmoney quote/history and exact vendor income-statement decoding backs
isolated CN/HK shells with bounded mocked contracts. The statement slice keeps
raw tokens and labels, visible track-owned mappings, and exact net-margin source
leaves; it remains distinct from official filing/document semantics.
The shared capability policy powers isolated `cn_setup`/`hk_setup` Pi shells
and prevents sibling or SEC tools from satisfying a track requirement.

“Foundation complete” does not mean “every named financial model is built in.”
Provider adapters, accounting taxonomy mappings, maintained calendar data,
curve construction, optimizers, option models, order execution, and live data
entitlements remain separate packages or plugin work. The generic primitives
are deliberately sufficient for those layers without putting provider or
business policy into the foundations.
