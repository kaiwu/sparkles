# Changelog

All notable changes to the `@pi-sparkles/pi-sparkles` npm package are recorded
here. Versions follow Semantic Versioning. The exact selected tier, plugin
inventory, maturity, and content hashes remain authoritative in each tarball's
`release-lock.json` and `aggregate-lock.json`.

## 0.1.9 - 2026-09-01

- Keep PDF.js and its native canvas polyfills out of Pi's extension-import and
  registration path. The parser now loads only when a PDF operation has passed
  its input boundary and actually needs it.
- Replace the monolithic Jiti-facing aggregate with a tiny single entrypoint
  that receives Pi's host-owned TUI helpers and natively imports the separately
  content-locked runtime. Plain Pi 0.84.4 no longer transpiles roughly 694,000
  generated lines before it can register Sparkles.
- Pin `@napi-rs/canvas` to the Bun-compatible `1.0.3` runtime instead of
  accepting PDF.js's floating optional range, which can resolve to a native
  binding that hangs the Bun-compiled Pi host during startup.
- Bound clean-package entrypoint and plain-Pi startup smokes to 15 seconds, and
  fail verification if either host entrypoint eagerly creates PDF canvas
  globals.

## 0.1.8 - 2026-08-19

- Add credential-free official SSE acquisition for the exact reviewed STAR 50
  (`sse` / `000688`) current constituent list and aggregate industry
  composition, with complete 50-member validation, provider order, effective
  dates, request receipts, and explicit HK/US `track_partial` boundaries.
- Keep Tushare's heavily rate- and entitlement-limited `stock_basic` adapter as
  an optional, user-accepted stock-identity fallback only. It is never a first
  route, automatic prerequisite, or index resolver.
- Correct CN/HK feature coverage to measure the actually installed product
  surfaces, and carry the same current readiness calculation through Pi and
  per-agent DSH status projections.
- Register canonical active-session `seriesReceipt` handoffs from CN and HK
  OHLCV producers and from US OHLCV when an exact caller-proven XNYS/XNAS MIC
  is present. Gap/acquisition digests can no longer masquerade as series
  receipts for SMA, RSI, ATR, or charts.
- Tighten sampled index analysis and receipt recovery: avoid quote-plus-history
  double fetches, invented per-stock classifications, copied internal rows,
  scripted hashes, and repeated consumer calls after a missing handoff.

## 0.1.7 - 2026-08-18

- Audit all 45 concrete provider request constructors with bounded live,
  same-request contract, or exact entitlement evidence; keep the unusually
  rate-limited Tushare calls one-shot and credential-redacted.
- Accept HKEXnews' current literal `callback(...)` JSONP wrapper, current SEC
  string CIK and nullable concept-label shapes, and Twelve Data's official
  production-host `demo` credential without generic web-search fallback.
- Preserve Alpaca's closed-session blank-exchange/zero-value no-side sentinel
  as an explicitly unavailable quote side instead of rejecting the response or
  presenting zero as a tradable price. The shared typed snapshot is used by
  both Pi and DSH.
- Keep `pdfjs-dist` external to Pi bundles so CAPCO's production PDF decoder can
  resolve its packaged runtime assets.
- Require controlled provider failures to remain terminal unless the caller
  explicitly requests a distinct fallback, and require every shared product
  change to review both Pi and DSH host legs.

## 0.1.6 - 2026-08-18

- Present Sparkles as one shared finance product with separate host-native npm
  distributions for Pi and DeepSeek Harness, rather than as a Pi-only project.
- Add responsive ordinary-output OHLCV charts: colored terminal Unicode for Pi
  and a keyed inline SVG tool-result card for the DSH browser, with exact
  textual and structured fallbacks retained.
- Render Pi candles with compact one-column eighth-row `▁`…`█` body precision
  and a zero-width vertical wick overlay, sparse price ticks, proportional
  `▁`…`█` volume, and unit-separated lower panes. RSI and ATR can coexist
  without sharing a scale; tiny non-zero volume retains the smallest bar.
  Theme-native CN versus HK/US colors require no embedded ANSI palette or
  Braille glyphs.
- Pass short, active-session OHLCV and indicator receipts into `chart_ohlcv`,
  eliminating model-side copies of dozens of bars or ordered indicator points
  that could truncate the tool arguments before execution.
- Let receipt-driven chart calls omit empty trades, gaps, input omissions, and
  the text fallback row cap; these now default to empty lists and 50 rows,
  independently of the requested 1-through-240 bar chart span.
- Pass session-bound, content-verified OHLCV receipts into SMA, RSI, and ATR so
  the model no longer re-emits hundreds of bars, and restore their compact Pi
  result renderer so successful indicators occupy one collapsed terminal line.
- Keep Pi chart and compact tool-result lines inside a four-column safety
  margin using Unicode-aware visible-width truncation, preventing wide CJK
  summaries from exceeding the terminal viewport.
- Move repository metadata and documentation links to
  `github.com/kaiwu/sparkles` ahead of the repository rename.
- Cross-reference and introduce `@pi-sparkles/pi-sparkles` and
  `@dsh-sparkles/dsh-sparkles` from both generated npm READMEs while preserving
  their independent host lifecycle, presentation, and release gates.
- Restore the independent DSH T6 release gate to ProductUseful after its new
  chart completes installed-profile browser acceptance.

## 0.1.5 - 2026-08-15

- Complete and promote the eleven-proposal T6 day-trader and execution-review
  tier, including the two previously missing plugins and the seven previously
  partial broker, paper, compliance, and reconciliation surfaces.
- Add independently labelled CN, HK, and US bounded transaction-tape capability
  review, shared sequence/gap/reset/correction workflow laws, named local
  possible-fill simulation, compound compliance evaluation, non-executable
  handoff, and content-bound external receipt reconciliation.
- Make provider dependencies explicit: Futu OpenD, Alpaca, IBKR, their SDKs or
  gateways, credentials, login state, entitlements, and live certification stay
  caller-owned and are never bundled or silently selected.
- Release the cumulative T1-through-T6 all-in-one package with all 135 ledger
  plugins behind one Pi entrypoint and no broker order-mutation authority.
- Remove the legacy per-plugin Pi loader permanently. Development, tier
  acceptance, clean-install, and release verification load the T6 all-in-one
  entrypoint once and reject earlier-tier or per-plugin load targets.

## 0.1.4 - 2026-08-14

- Compose broad CN sector analysis from a bounded `cn_sector_series`
  acquisition receipt and the provider-neutral `compare_series_returns`
  calculator instead of one query-shaped acquisition/calculation tool.
- Add one bounded Eastmoney provider-ranked CN movers page with exact lexemes,
  source order, request/attempt receipts, and explicit HK/US `track_partial`
  boundaries; forbid automatic per-row enrichment and fallback cascades.
- Strengthen Pi routing and repository composition rules around orthogonal
  tools, exact preconditions, explicit provider/track authority, typed receipt
  handoffs, and unknown-preserving optional enrichment.
- Correct Tushare HTTP-200 provider-error decoding when `data` is absent or
  null; surface quota/permission code `40203` safely across symbol, alias,
  quote, history, corporate-action, and earnings tools without retry or
  fallback, and reject duplicate `stock_basic` identities.
- Align the npm release gate with the releasable T5 aggregate while T6 remains
  a private blocked preview.

## 0.1.3 - 2026-08-14

- Publish the complete 124-plugin ProductUseful T1-through-T5 aggregate under
  the stable `@pi-sparkles/pi-sparkles` package identity.
- Replace the npm README's internal tier terminology with a user-facing
  introduction, supported market coverage, primary data sources, example
  questions, minimal environment setup, optional provider credentials, track
  selection, and explicit read-only boundaries.
- Make T6 the guarded default for aggregate and npm-package preparation while
  retaining an explicit T5 build for the published 0.1.2 product boundary.
- Record omitted proposals, partial implementations, open blockers, maturity,
  and publish eligibility directly in generated aggregate and npm manifests.
- Prepare a private same-source T6 preview containing the exact present plugin
  inventory, while preserving the publish refusal until T6 is complete and
  ProductUseful.
- Add private transaction-tape and bounded-stream laws, local possible-fill
  simulation, evidence-first compliance evaluation, and exact-hash caller-owned
  receipt review to the T6 development inventory without exposing order
  mutation or making OpenD a deliverable.

## 0.1.2 - 2026-08-13

- Use `AGENT_CONTACT` as the single caller-owned operator identity across CN,
  HK, US, Eastmoney, CNINFO, SEC, Alpaca, and other provider adapters; remove
  redundant provider-specific contact and user-agent configuration.
- Route ordinary current-data questions such as whether to buy now or when to
  sell through quote, bounded OHLCV/history, and relevant SMA/RSI/ATR evidence
  by default, without requiring users to ask explicitly for tool evidence.
- Avoid unnecessary symbol search and CNINFO discovery when a familiar name or
  exact active-track identity is already sufficient.
- Keep raw vendor OHLCV details compact in the terminal while exposing complete
  numeric rows to the model, and return compact model-visible indicator values
  without a second projection request.
- Derive ordinary indicator instruction references internally, normalize raw
  basis evidence handoffs, accept compatible rounding aliases, and shorten
  validation failures that previously blocked the model.
- Speed up exact SMA/RSI/ATR calculations with BigInt-backed decimal coefficient
  arithmetic and a rolling SMA window; verify CN/HK/US results against an
  independent decimal oracle.
- Make the stable release workflow build and verify the complete T1-through-T5
  all-in-one extension instead of treating individual plugins as release units.

## 0.1.1 - 2026-08-13

- Fix aggregate startup by giving the legacy raw CN Eastmoney quote/history
  tools names distinct from the ProductUseful provider-port tools.
- Rename the backtest reproduction export so it no longer collides with the
  provenance source-manifest export.
- Restore plain-Pi loading of the complete T1-through-T5 npm entrypoint.
- Emit complete bounded CN, HK, and US daily OHLCV rows in model-visible tool
  content, not only in renderer/session details, so agents can construct
  SMA/RSI/ATR inputs while Pi keeps collapsed results to one summary line.
- Clarify that known exact CN codes, including already-identified ETFs, can use
  the raw Eastmoney history path without Tushare or CNINFO configuration.

## 0.1.0 - 2026-08-12

- Add the first single-entry all-in-one Pi extension package.
- Support an explicit T1-through-T5 or T1-through-T6 aggregate build target.
- Make the current ProductUseful T1-through-T5 artifact publishable.
- Keep the current blocked T6 artifact private and publish-ineligible while
  still allowing local npm-format packing and inspection.
- Add deterministic inventory, checksums, credential-name-only configuration,
  duplicate-registration protection, and a broker order-mutation prohibition.
- Preserve the Pi-required host peer declarations in the published manifest.
- Add a clean tarball installation, exact runtime-dependency, default-export,
  and plain-Pi load gate to the trusted publication workflow.
