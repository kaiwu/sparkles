# Sparkles for DeepSeek Harness

This directory owns the DeepSeek Harness lane of
[Sparkles](https://github.com/kaiwu/sparkles). It builds the
`@dsh-sparkles/dsh-sparkles` Cordis package from compatible compiled Pi effect
shells without changing the Pi builder, aggregate, tier ledger, or maturity.
Shared finance behavior stays in the existing pure Gleam/domain modules; only
host effects are adapted. Pi users install the sibling
[`@pi-sparkles/pi-sparkles`](https://www.npmjs.com/package/@pi-sparkles/pi-sparkles)
package instead.

- `scripts/dsh-bundle.js` builds the bundle (`bun run dsh:bundle`).
- `scripts/dsh-npm-package.js` builds the separate npm release.
- `scripts/dsh-verify.js` validates schemas and executes the generated bundle
  through the installed DSH runtime (`bun run dsh:verify`).
- `dsh/bundle.json` owns DSH release status, global Pi-shell exclusions,
  per-agent shared-core counterparts, reasons, and DSH-native entries.
- `dsh/pi-api.mjs` maps the supported Pi effect surface to DSH.
- `dsh/plugins/` contains DSH-native Cordis shells and remains separate from
  Pi `plugins/`.
- `dsh/client.js` generates the DSH browser half that occupies
  `shell.overlay` for track status and keyed `tool.call.toolview` for inline
  OHLCV output.

## Inventory and release boundary

The effective inventory is `global-safe Pi shells + per-agent Pi counterparts
+ DSH-native host surfaces`. The T6 preview covers all 135 ledger
components: 131 mount globally and four use fresh DSH agent scopes. The four
original Pi shells remain excluded from the global lane, with normative
reasons in `bundle.json`:

- `finance_track_status`: the same compiled Gleam state/readiness/tool core is
  mounted per agent; DSH contributes its prompt through `systemPrompt` and
  renders status through a session projection and `shell.overlay`.
- `swing_workbench` and `watchlist`: their Pi shells use session-tree lifecycle
  and therefore receive a fresh extension instance per agent.
- `portfolio`: its non-durable imported snapshot cell is likewise per agent.

Loading those state shells once at DSH process scope would mix independent
agents. `scoped_pi` keeps the existing compiled functional cores but changes
their ownership boundary. An `extra_dsh` entry resolves only to
`dsh/plugins/<name>.mjs`; it can never silently pull a Pi plugin into the
DSH-only lane.

DSH maturity is independent from Pi maturity. Its complete role-level lane and
installed-profile discovery, resize/interaction, persistence, and visual
acceptance for the inline OHLCV card are complete. `dsh_release.status` is
`product_useful` for T6, so the T6 DSH package is releasable. T5 remains outside
that selected boundary. Pi maturity is recorded for provenance only and cannot
promote the DSH release. Conversely, DSH verification never edits `tiers.json`
or Pi package metadata.

## Host mapping

| Pi surface | DSH behavior |
| --- | --- |
| tools | Registered with `ctx.tools`; actual DSH call ID, signal, and agent are forwarded. Pi results are normalized to canonical JSON and `output.render` returns `ContentBlock[]`. |
| commands | Registered with `ctx.commands`; Pi UI notifications become command result text. |
| queued user messages | Routed to the invoking agent's `followup` or `steer` inbox. |
| custom entries/session reads | Stored in and projected from the invoking DSH agent's session log. |
| session lifecycle | Pi start/shutdown hooks follow `agent/session-start` and `agent/disposed`. |
| stateful Pi shells | Instantiated once in each `agent.ctx`; registrations and mutable cells disappear with that scope. |
| Pi session-tree hooks | Registered for compatibility but not synthetically fired; DSH forks/resumes as a distinct session and restores on real session-start. |
| Pi statusline | `setStatus`/`clearStatus` append whole-value DSH status events; `finance_track_overlay` folds them into `piSparklesStatus`. |
| browser status | The package's `dsh.client` entry registers the draggable, keyboard-movable `pi-sparkles-finance-track` badge in `shell.overlay`; double-click or Home resets its position. |
| browser charts | `chart_ohlcv` adds bounded `output.presentationMeta`; the package client registers a keyed `tool.call.toolview` card that renders responsive SVG inline in the transcript. |
| persisted event vocabulary | The generated entry contributes `pi-sparkles/custom` and `pi-sparkles/status` to DSH's exported process-wide catalog before a cold session load, so required Sparkles state is readable after restart. |
| finance routing prompt | Exported once by the Gleam track module and contributed as an agent-scoped DSH system-prompt section. DSH reports whether the heavily limited Tushare stock-identity fallback is configured, without exposing the token; it is never the first route or automatic, requires user acceptance after the primary path is unavailable, and does not cover indices. CN/HK OHLCV producers register their exact canonical `seriesReceipt` in the invoking session for indicator/chart consumers; US does so only with caller-proven `XNYS`/`XNAS`, otherwise reporting `track_partial`. Acquisition/gap digests are never substitutes, and a missing handoff stops that enrichment rather than triggering row copies, scripts, or repeated consumer calls. |
| flags | Defaults may be overridden by bundle `config.flags` or `PI_SPARKLES_FLAG_<NAME>`. |
| unsupported Pi effects | Fail explicitly; they never return placeholder success. |

Charts do not use either host's image or attachment path. Pi owns a colored
Unicode TUI result component; DSH persists bounded chart metadata and owns an inline SVG
tool-result card. Both keep the exact text fallback in the ordinary tool
output. See [`../CHARTS.md`](../CHARTS.md).

Provider HTTP does not depend on a Pi fetch helper. The shared
`finance_http` transport uses standard `globalThis.fetch`, AbortSignal,
redirect rejection, response budgets, and timeouts, which are available in the
pinned Node 22.19+ host. Provider credentials come only from the DSH process
environment. Some adapters initialize at plugin boot, so restart DSH after
changing variables.

## Build and verify

```sh
bun run dsh:bundle
bun run dsh:verify
bun run dsh:npm:preview:verify
dsh plugin --profile <name> add ./dist/dsh/dsh-sparkles
dsh --profile <name> --dump-config
```

`bun test test/dsh test/workflow/dsh_npm_package.test.js` covers the adapter,
parallel invocation isolation, per-agent state ownership, lifecycle/session
mapping, overlay component/projection, inline chart metadata/card, release gate, locks,
and npm inventory. `bun run dsh:verify` currently uses DSH 0.1.1-rc.2
implementation to create two real agent scopes, expose all 246 effective tools,
verify the shared prompt and track projection, and prove that a watchlist
mutation cannot leak to the second agent.

The generated package declares the exact `@deepseek-ai/dsh@0.1.1-rc.2` host
peer, pins its tested DSH service peers to the same version, and pins
`pdfjs-dist` plus its Bun-compatible `@napi-rs/canvas` polyfill. PDF runtime
state is initialized only by a PDF operation, never while the DSH entrypoint
registers. The package requires Node 22.19+, carries exact locks/checksums, and
contains no lifecycle scripts or credential values. The release install gate
requires that exact host version.
