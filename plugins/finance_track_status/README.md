# pi_sparkles_finance_track_status

Experimental Pi extension providing a persistent, visible active-finance-track
statusline and explicit switching among exactly `cn`, `hk`, and `us`.

The TUI statusline renders:

```text
CN · CNY · Asia/Shanghai · src:65% · feat:80%
```

`src` and `feat` are deliberately separate:

- `src` is the equal-weight evidence-maturity score for the track's versioned
  canonical source stack. A verified criterion contributes 100%, a partial
  criterion 50%, and a missing criterion 0%. It is **not** the probability that
  a source statement is true, and a critical criterion must be fully verified
  before the source stack is operationally credible.
- `feat` is the installed end-user feature coverage reported by
  `finance_provider_strategy/coverage`. It is computed from active tools for
  the selected track only. A US tool can never increase CN or HK coverage.

The compact percentage is only navigation telemetry. `finance_track_status`
returns the denominator, basis-point score, readiness state, every source
criterion and evidence note, contributing source groups, covered requirements,
missing requirements, and critical gaps. Consumers should use those structured
receipts—not the display number—for decisions.

The version-1 feature denominator has ten equally weighted requirements:
navigation context, source registry, security identity, market calendar,
effective rules, quotes/history, disclosure discovery, raw fundamentals,
normalized fundamentals, and reproducible derivations. Navigation is supplied
by this plugin; all other credit requires a matching installed track surface.
The operational target is 85%, with source registry and security identity
remaining critical. The current released aggregate reports CN at 80% (missing
raw and normalized fundamentals) and HK at 70% (also missing a reproducible
derivation). The shared `finance_sources` registry counts for each explicitly
labelled track, and CN's released `cn_financial_metrics` counts as its exact
derivation surface. The excluded Experimental `cn_fundamentals` and
`hk_fundamentals` support shells can still make a full-repository development
load reach 100%, but they do not inflate an installed release. Current US
reports 100% when its independently installed source, identity, NYSE/Nasdaq
calendar, effective-rule, paired quote/history, disclosure, raw/normalized
fundamental, and derivation surfaces are active. This is workflow breadth, not
data completeness, comprehensive OHLCV gap coverage, broad rule coverage, or
source-credibility parity. The separate US gap compositor can classify only
fully evidenced copied 2026 receipts and changes no feature score. Removing any
required track-owned tool immediately reopens the corresponding structured gap.

The interaction defaults are CN/CNY/`Asia/Shanghai`,
HK/HKD/`Asia/Hong_Kong`, and US/USD/`America/New_York`. They are navigation and
reporting defaults only; switching never relabels an observation, changes a
provider, converts currency, substitutes a calendar, or moves persisted state
between market plugins.

## Interface

- `--finance-track=cn|hk|us` selects the initial track; invalid values fail safe
  to `us`.
- `AGENT_CONTACT=<label>` supplies the shared operator identity used by provider
  adapters. Status tools report only whether it is validly configured and never
  expose the value to the model or session log.
- `/finance-track` shows status; `/finance-track cn` switches strictly.
- `/cn-track`, `/hk-track`, and `/us-track` are explicit shortcuts.
- `finance_track_status` gives headless agents the same structured state.
- `finance_track_switch` performs a typed sequential switch.

The pre-agent routing policy sends today's broad Shanghai/Shenzhen overview,
including SSE STAR 50 / 科创50 (`000688`), to `cn_market_overview` once, current CN provider-ranked movers requests to
`cn_market_movers` once, and broad CN industry/板块 trend requests through the
composed `cn_sector_series` then `compare_series_returns` handoff. It forbids
generic web search in the same first acquisition step, current STAR 50 history
probing, benchmark/sector code guessing, and duplicate short/long history windows, and keeps price-relative sector comparisons
separate from unavailable fund-flow, constituent-breadth, causal-rotation,
theme, stabilization, top, and reversal claims.

Current STAR 50 constituent-list requests route separately to
`cn_index_constituents` exactly once with `sse` / `000688`. This is a
credential-free official SSE acquisition, so the agent neither asks the user
to supply the list nor reaches for Tushare or generic web. A composition-analysis
request additionally calls `cn_index_industry_composition` once for the SSE's
aggregate sector member counts and exact weight lexemes. The responses retain
the SSE publication date, all 50 member identities in provider order, one
content-bound receipt per request, and explicit scope limitations without
per-stock classification fan-out or historical-membership reconstruction.
The prompt and tool receipts also expose the completed applicability review:
`cn` is supported only for exact `sse` / `000688`, while `hk` and `us` are
`track_partial` pending reviewed authority-bound membership, timing/correction,
and licence/redistribution contracts. No CN result is relabelled or substituted
for either track.

Current constituent-performance sampling uses the smallest disclosed sample
needed, skips a quote-first/history-second double fetch, and never invents
per-stock industry membership from an aggregate composition table. Across
tracks, history/OHLCV consumers use only an exact returned `seriesReceipt` from
the active session. Acquisition and gap digests are not receipt substitutes; a
missing handoff ends that enrichment instead of triggering repeated indicator
calls, copied-row direct mode, or a scripted `instructionRef`.

For a name-only instrument, the same policy forbids reconstructing venue/code
from model memory and selects identity discovery only when an installed tool's
instrument scope and provider prerequisites are satisfied. Tushare
`cn_stock_symbol_search` is a heavily rate- and entitlement-limited fallback
stock-listing adapter. It is never the first route or selected automatically.
An applicable credential-free installed path is preferred; Tushare may be
offered or called only after that path is unavailable and the user explicitly
requests or accepts the fallback. It does not cover benchmark or sector indices;
an identity with no applicable configured path remains explicitly unresolved.

The policy also records that provider-ranked movers acquisition is currently
`track_partial` for HK and US; it never relabels or substitutes the CN page for
another track. The return calculator itself remains shared across all three
tracks when a track-owned acquisition supplies its exact receipt-bound inputs.
For a general movers-list analysis, the policy stops after descriptive
comparison of the acquired rows. Optional identity, classification, history,
indicator, disclosure, or fundamental tools are composed only for a requested
dimension whose credential and exact-input preconditions are already met. It
forbids per-row fallback cascades, treating unresolved numeric fields as
convertible amounts, and inferring price limits, board regimes, or abnormal
activity from percentage/code patterns.

Track choices persist as extension-owned custom entries on the active session
branch. Resumed/forked branches restore their own latest choice; a new session
uses the configured initial track. Malformed state falls back visibly. Every
change emits `pi-sparkles.finance.track.changed` with only the strict track ID
so sibling plugins can refresh without sharing a mutable store.

The status tool returns the standard top-level `track` and versioned
`trackContext` plus effective currency/timezone, contact-configuration validity,
and persistence scope. It also returns `sourceCredibility` and
`featureCoverage` receipts plus their display percentages. Headless mode has no
UI statusline but remains fully operable through tools.

## Pi model diagnostics

Start Pi with `--finance-model-diagnostics` to show a warning for each model-provider
HTTP error that Pi reports. When Retry-After supplies seconds or an HTTP date,
the warning includes the requested delay in seconds. The diagnostic displays the
status and parsed delay only. It is off by default. Market-data requests continue
to use their own provider receipts and HTTP policies.
