# DSH-dedicated plugins — roadmap

DSH runs in a browser web app and one process may host several agents. The DSH
lane therefore separates global-safe Pi shells, per-agent shared-core
counterparts, and genuinely DSH-only host surfaces.

## Implemented counterparts

All four formerly missing ledger components are now present in the DSH T6
inventory without entering the global Pi-shell lane:

- `finance_track_status` mounts its existing compiled Gleam state, readiness,
  tools, commands, persistence, and routing-prompt core once per DSH agent.
  Pi `setStatus` writes a whole-value `pi-sparkles/status` session event;
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

The real-runtime lane creates two installed-DSH agent scopes, checks the 246
effective tools, commands and shared routing prompt, switches the track through
the DSH command runtime, reads the overlay projection, and proves a watchlist
mutation in one agent leaves the other at revision zero. The installed DSH web
server also discovers and serves the package browser entry after
`@deepseek-ai/dsh-client-ui-layout` and `@deepseek-ai/dsh-client-ui-tool`.

The previously accepted counterpart inventory remains complete. The new chart
client surface has passed its installed-profile browser acceptance, restoring
the independent T6 DSH release gate to `product_useful`. This does not alter or
inherit Pi tier maturity; the two hosts retain separate verification,
packaging, and publication decisions.

## Implemented — browser finance charts

`finance_charts` remains a stateless global-safe shell with shared Gleam
validation and exact text/details. It now emits no Pi image. The DSH bridge adds
bounded, schema-versioned presentation metadata only to `chart_ohlcv`, and the
browser client renders it inline without an overlay or attachment.

### Server half

- The shared pure result declares a renderer-neutral responsive span policy.
- DSH `output.presentationMeta` retains the browser-required bars and supplied
  annotations under a 512 KiB budget while the normal output retains exact
  text and numeric rows.
- No interpolation, implicit provider acquisition, duplicate-period coercion,
  or plugin-to-plugin source imports.

### Client half

- A keyed `tool.call.toolview` renderer owns only `chart_ohlcv`.
- Browser-native inline SVG opens at the full returned range and supports
  earlier/later pan, zoom, and full-range reset from persisted result metadata.

Client discovery through an installed DSH profile, resize/interaction checks,
session replay, and visual browser QA are complete. The feature does not change
Pi maturity.
