# Changelog — @dsh-sparkles/dsh-sparkles

All notable changes to the `@dsh-sparkles/dsh-sparkles` npm package. Versions
follow Semantic Versioning. The exact tier, plugin inventory, maturity, and
content hashes remain authoritative in each tarball's `dsh-lock.json` and
`release-lock.json`.

## 0.1.12 - 2026-09-02

- Preserve Sina's unknown OHLCV adjustment semantics as an explicit
  `provider_defined` basis through SMA, RSI, ATR, and chart receipt consumers,
  instead of rejecting the valid explicit Sina series or relabeling it as raw.
- Cover the complete explicit `Eastmoney failure -> user-selected Sina history
  -> SMA -> chart` chain through the DSH session bridge and the sibling plain
  Pi binding lanes.

## 0.1.11 - 2026-09-02

- Add the exact reviewed SSE STAR 50 history route to the explicitly selected
  Sina alternative while preserving the strict two-call contract: an
  Eastmoney failure only prompts, and only a later user-approved Sina call can
  change the source.
- Apply the shared process-local one-request-per-two-seconds provider quotas
  and one-attempt policy throughout the installed DSH inventory, and rebuild
  every bundled artifact so the runtime cannot retain stale Eastmoney retry
  behavior.
- Make the DSH agent guidance state the source-change prompt and the successful
  `eastmoney -> sina` transition explicitly.

## 0.1.10 - 2026-09-01

- Consume the shared lazy PDF effect boundary so the DSH server entrypoint also
  registers without initializing PDF.js or native canvas state.
- Pin the exact Bun-compatible `@napi-rs/canvas@1.0.3` runtime used by the
  shared PDF path, and make package verification reject eager canvas globals
  or an entrypoint import that exceeds 15 seconds.

## 0.1.9 - 2026-08-24

- Restore the finance-track `shell.overlay` indicator on DSH 0.1.1-rc.2 by
  adopting the session projection state/wire split, pinning the current host
  peers, and exercising the current command invocation contract in the real
  runtime smoke.
- Pin the exact `@deepseek-ai/dsh@0.1.1-rc.2` host and service peer graph, and
  pin the trusted-publishing workflow to that tested host.

## 0.1.8 - 2026-08-19

- Consume the shared credential-free SSE STAR 50 constituent/composition
  acquisition and explicit CN-supported/HK-US-`track_partial` applicability
  result without introducing a DSH-only finance implementation.
- Expose Tushare configuration only as an optional, user-accepted stock
  identity fallback in the per-agent runtime guidance; never select it first,
  use it for indices, or require it for ordinary market data.
- Project current installation-aware CN/HK/US readiness from each agent's real
  global/scoped tool union instead of retaining stale host-shell gaps.
- Preserve canonical OHLCV `seriesReceipt` entries in the exact invoking DSH
  session so indicators and the inline chart consume short, content-verified
  handoffs. Cross-agent reuse, gap-digest substitution, copied-row recovery,
  and scripted instruction hashes remain rejected.

## 0.1.7 - 2026-08-18

- Consume the shared provider-compatibility fixes, including exact Alpaca
  one-sided quote availability and the current HKEX, SEC, CAPCO, and Twelve
  Data response contracts, through the same compiled finance cores and Pi
  shells used by the DSH bridge.
- Pin and verify the complete DSH service peer graph against
  `@deepseek-ai/dsh@0.1.0-rc.7` while retaining per-agent state ownership,
  persisted-session restoration, browser slots, and the independent DSH
  ProductUseful gate.

## 0.1.6 - 2026-08-18

- Add the responsive keyed `chart_ohlcv` browser card: inline SVG
  candlesticks, volume, supplied indicators/trades/gaps, width-proportional
  layout, pan/zoom/reset controls, and exact text fallback. Each result opens
  at its full returned date range, and stale manual zoom cannot constrain the
  next result.
- Let receipt-driven chart calls omit empty trades, gaps, input omissions, and
  the text fallback row cap; these default to empty lists and 50 rows without
  constraining the requested 1-through-240 bar chart span.
- Apply market-native direction colors: red-up/green-down for Mainland China,
  green-up/red-down for Hong Kong and the United States, and neutral gray for
  flat candles, with a matching per-track legend.
- Complete installed-profile browser discovery, resize, interaction,
  persistence, and visual acceptance for the chart without using images,
  attachments, files, data URLs, or overlays for chart output.
- Reframe the package as Sparkles for DeepSeek Harness, move repository links
  to `github.com/kaiwu/sparkles`, and introduce the sibling
  `@pi-sparkles/pi-sparkles` terminal distribution.
- Keep the clean tarball smoke isolated from npm's automatic host-peer install;
  the real DSH profile supplies and verifies the exact tested `rc.6` peer graph.
- Restore the independent T6 DSH release gate to ProductUseful after completing
  the chart's installed-profile browser acceptance.

## 0.1.5 - 2026-08-17

- Promote the independently verified T6 DSH lane to ProductUseful after
  installed-profile operator acceptance; Pi maturity remains a separate,
  informational release record and does not gate DSH publication.

- Make the finance-track overlay draggable and keyboard-movable, with bounded
  placement and an explicit reset gesture.
- Register Sparkles' required custom/status event vocabulary before DSH cold
  session loading so rc.6 can resume persisted scoped state.
- Add DSH runtime-date and bounded-history guidance, and clarify the one-based
  stock-technicals projection and basis-field rules after auditing a real
  failed-call trajectory.
- Preserve Pi length, value, and item-count bounds as model-visible constraint
  annotations when translating through DSH's narrower tool-schema subset.
- Correct DSH tool rendering to return `ContentBlock[]`, forward real call IDs
  and cancellation, and normalize Pi inline images without forging DSH
  attachment references.
- Isolate concurrent invocations and bind queued messages, custom entries, cwd,
  and lifecycle to the exact DSH agent/session.
- Exclude the Pi-global `watchlist`, `swing_workbench`, and `portfolio` shells;
  mount fresh copies of their existing compiled Gleam cores in each DSH agent
  scope, and verify that state cannot cross agents.
- Restore `finance_track_status` as a per-agent shared-core counterpart,
  contribute its exported routing guidance through DSH `systemPrompt`, and map
  its status updates into a session projection.
- Ship a browser client entry that renders finance track status through DSH's
  `shell.overlay` slot; the installed DSH web server discovers and serves it.
- Cover all 135 T1–T6 ledger components in DSH (131 global-safe shells and four
  scoped counterparts), while retaining explicit global-shell exclusions.
- Add an independent DSH release gate, exact rc.6 service peers,
  stronger bundle/client locks and checksums, and real two-agent ToolRuntime,
  command, prompt, projection, and isolation verification.

- First DeepSeek Harness distribution of the pi-sparkles T1–T6 ledger: the
  read-only finance evidence tools (quotes, OHLCV, calendars, rules,
  fundamentals, SEC filings, portfolio, quant, macro, and tape review)
  registered as native Harness tools behind one Pi-API compatibility facade.
- Pi-specific surfaces are excluded via `dsh/bundle.json`; the TUI
  statusline/track-navigation plugin is the first exclusion, and the bundle
  ships the ledger minus exclusions plus any future DSH-dedicated plugins.
- Commands registered through `ctx.commands`; `sendUserMessage` output becomes
  the command result text.
- Pi JSON Schema translated to the dsh-tools raw JSON-Schema subset; the
  embedded Pi decoders still enforce the full argument contract at call time.
- `dsh.bundle.patch` manifest for `dsh plugin --profile <name> add`; the
  package is provider-free, credential-free, and order-mutation-free.
