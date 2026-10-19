# DSH-dedicated plugins — roadmap

DSH runs in a browser web app and one process may host several agents. The DSH
lane therefore separates global-safe Pi shells, per-agent shared-core
counterparts, and genuinely DSH-only host surfaces.

## Implemented counterparts

All four formerly missing ledger components are now present in the DSH T6
inventory without entering the global Pi-shell lane:

- `finance_track_status` mounts its existing compiled Gleam state, readiness,
  tools, commands, persistence, and routing-prompt core once per DSH agent.
  Pi `setStatus` writes a whole-value `plugin:pi-sparkles/status` record;
  `finance_track_overlay` folds it into the `piSparklesStatus` projection.
- The package browser half declares `dsh.client` and registers the
  `pi-sparkles-finance-track` component in DSH's root `shell.overlay` slot.
  It reads only the current session summary projection and renders no ambient
  process state.
- `watchlist`, `swing_workbench`, and `portfolio` each receive a new compiled
  extension instance in `agent.ctx`. Their existing Gleam/domain cores remain
  the single functional implementation; only ownership of the effect shell
  changes.
- DSH does not navigate a Pi-style branch tree inside one live session.
  Session-tree hooks are accepted but never synthetically fired; fresh and
  resumed agents restore from their own append-only session logs during the
  real `agent/created` lifecycle (`source` distinguishes resume from startup).

The bundle manifest records the separation explicitly:

- `exclude_pi`: shells forbidden at process-global DSH scope;
- `scoped_pi`: excluded ledger shells re-instantiated per agent;
- `extra_dsh`: DSH-native Cordis surfaces under `dsh/plugins/`.

The real-runtime lane creates two installed-DSH agent scopes, checks the 253
effective tools, commands and shared routing prompt, switches the track through
the DSH command runtime, reads the overlay projection, and proves a watchlist
mutation in one agent leaves the other at revision zero. The installed DSH web
server also discovers and serves the package browser entry after
`@deepseek-ai/dsh-client-ui-layout` and `@deepseek-ai/dsh-client-ui-tool`.

The counterpart inventory and native review role lane are complete. The floating
chart panel has passed local browser review and the 1.5× width adjustment;
the independent T6 DSH release gate is `product_useful`. This does not alter Pi
tier maturity; the hosts retain separate verification and publication decisions.

## Implemented — browser finance charts

`finance_charts` remains a stateless global-safe shell with shared Gleam
validation and exact text/details. It now emits no Pi image. The DSH bridge adds
bounded, schema-versioned presentation metadata only to `chart_ohlcv`, and the
browser client renders it in the finance status overlay without an attachment.

### Server half

- The shared pure result declares a renderer-neutral responsive span policy.
- DSH `output.presentationMeta` retains the browser-required bars and supplied
  annotations under a 512 KiB budget while the normal output retains exact
  text and numeric rows.
- No interpolation, implicit provider acquisition, duplicate-period coercion,
  or plugin-to-plugin source imports.

### Client half

- A keyed `tool.call.toolview` retains exact chart output in the transcript.
- The `piSparklesCharts` projection replays native and nested results into a
  stack of at most 12 SVG cards above the status bar, independent of tool
  disclosure state. Dragging the bar moves the group; per-card Hide and
  individual checkboxes close gaps above the fixed floor and restore cards.
- Browser-native SVG opens at the full returned range and supports
  earlier/later pan, zoom, and full-range reset from persisted result metadata.

Installed-profile discovery, session replay and browser interaction checks
are automated. Local DSH visual review is accepted by the 2026-10-18 release
instruction. The feature does not change Pi maturity.

## Implemented — durable selected-pick reviews

`watchlist_reviews` is a DSH-only server surface over the existing pure Gleam
watchlist review laws. Seven native tools manage consent, exact saved snapshots,
bounded one-off and recurring reviews, history and cancellation. Session-owned
storage retains source intent, outcomes, receipts and progress atomically;
restart never refetches an interrupted attempt. An exclusive writer lease
prevents competing host processes. The current-session projection feeds the
finance badge; ordinary tool output exposes facts and complete receipt lookup.
The installed-host role lane includes mixed-track labels, policy denial,
isolation, storage reopen and a hard-killed source call. Pi Durable remains a
separate host adapter over the same laws. No tier or release version is changed.
