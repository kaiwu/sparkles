# Sparkles for DeepSeek Harness

This directory owns the DeepSeek Harness lane of
[Sparkles](https://github.com/kaiwu/sparkles). It builds the
`@dsh-sparkles/dsh-sparkles` Cordis package from compatible compiled Pi effect
shells without changing the Pi builder, aggregate, tier ledger, or maturity.
Shared finance behavior stays in the existing pure Gleam/domain modules; only
host effects are adapted. Pi users install the sibling
[`@pi-sparkles/pi-sparkles`](https://www.npmjs.com/package/@pi-sparkles/pi-sparkles)
package instead.

The current npm release is **0.1.17**, published independently from Pi 0.1.15.
It includes explicitly selected Equibles US company snapshots through
`company_profile` with caller-owned `EQUIBLES_API_KEY`, plus the shared nil-safe
prompt decoder. The source preserves unconfirmed MIC and share-unit compatibility,
including ordinary-share versus ADR limitations. It never falls back to Twelve Data.

Requires **DSH 0.2.1-rc.2**, with exact host and service peers, including
`dsh-working-directory`. Other host versions require a separate compatibility
review. Session receipts use `snapshotEvents()`, including after resume.
New custom entries and status updates use the exported `appendPluginRecord`
API as `plugin:pi-sparkles/custom` and `plugin:pi-sparkles/status`. DSH marks
these records `ignorable`, snapshots their JSON data, and retains them across
resume and forks without adding them to its event catalog. Only the two old
required `pi-sparkles/*` types remain in the compatibility catalog, so existing
logs still open. Plugin records are experimental and migrations retain them
on a best-effort basis; missing receipts remain explicit failures.

The installed host still cannot migrate **v0** logs that already contain
`pi-sparkles/status` or `pi-sparkles/custom` events: the v0-to-v1 edge uses a
frozen first-party inventory and refuses unknown historical types even when
ignorable. Rewrite those logs before opening them:

```sh
bun run dsh:migrate:v0-sparkles -- --dry-run
bun run dsh:migrate:v0-sparkles -- --apply
```

The rewrite keeps event sequence numbers and replaces Sparkles rows with
`feedback/record` placeholders. Conversation history can load; overlay status
and old session receipts in those v0 logs are not restored. Originals are
copied beside the log as `*.pre-dsh-0.1.5`.

- `scripts/dsh-bundle.js` builds the bundle (`bun run dsh:bundle`).
- `scripts/dsh-npm-package.js` builds the separate npm release.
- `scripts/dsh-verify.js` validates schemas and executes the generated bundle
  through the installed DSH runtime (`bun run dsh:verify`).
- `dsh/bundle.json` owns DSH release status, global Pi-shell exclusions,
  per-agent shared-core counterparts, reasons, and DSH-native entries.
- `dsh/pi-api.mjs` maps the supported Pi effect surface to DSH.
- `dsh/plugins/` contains DSH-native Cordis shells and remains separate from
  Pi `plugins/`.
- `dsh/watchlist-reviews.mjs` interprets shared review laws over DSH storage,
  with a DSH-native registration shell in `dsh/plugins/watchlist_reviews.mjs`.
- `scripts/dsh-watchlist-role.mjs` proves its installed-host role and hard-crash recovery.
- `dsh/client.js` generates the DSH browser half that occupies
  `shell.overlay` for track status and stacked floating OHLCV charts, with
  keyed `tool.call.toolview` retaining the exact text output.

## Release version selection

DSH's npm version comes only from `dsh/bundle.json` and its own published
`@dsh-sparkles/dsh-sparkles` history. Never derive the next version from Pi,
the DSH host, or an already built/installed local candidate. Inspect with
`bun run npm:release:preflight -- dsh` before changing a version, and follow
[the mandatory release procedure](../NPM_RELEASE.md#version-selection-and-publication-both-channels).
Reuse an unpublished candidate after successful manual checks; those checks
are not another release. CI requires explicit DSH baseline/version inputs and
a `dsh-v<version>` tag, and publishes only DSH.

## Inventory and release boundary

The effective inventory is `global-safe Pi shells + per-agent Pi counterparts
+ DSH-native host surfaces`. The T6 package covers all 135 ledger
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

DSH maturity is independent from Pi maturity. T6 is `product_useful` after its
installed-host role lane, clean package/profile installation, session replay,
hard-crash recovery and browser checks. The local floating panel was reviewed
in DSH, including the 1.5× width adjustment; the 2026-10-18 release instruction
accepts that reviewed candidate. T5 remains outside the selected T6 boundary.
Pi maturity is recorded for provenance only and cannot
promote the DSH release. Conversely, DSH verification never edits `tiers.json`
or Pi package metadata.

## Recurring pick reviews

The seven durable watchlist tools are available through a DSH-native sibling.
After the user accepts remembering picks, enable `watchlist_durable`, save an
exact `watchlist_snapshot` handoff, and choose either `watchlist_review_run` or
`watchlist_review_schedule`. Recurring reviews require an explicit interval,
first due instant, count, provider and request budget. Saving starts no polling.
Read status/history with `watchlist_review_status` and stop an exact job with
`watchlist_review_cancel`. The finance badge shows review readiness, active
jobs and pause/off state from this session's projection.

Records are owned by the original session; resume restores them, while another
chat or fork imports picks only through the explicit snapshot handoff. The
runner uses DSH storage and timers without waking a model. It retains pinned
picks and complete source receipts, deduplicates request identities, skips
missed intervals, and reuses a completed acquisition after restart. A persisted
in-flight attempt becomes unknown and is never refetched under its old identity.
Active reviews participate in session archive admission; an explicit
stop-activity archive cancels them without restarting on unarchive.
Source calls retain DSH policy enforcement; denied, missing or PTC-collapsed
source tools yield `cannot_check`, never a fallback. CN uses Eastmoney `a_share`;
HK/US remain `track_partial`.

The default OS writer lease is `$DSH_HOME/sparkles_reviews/owner.sqlite`, with
`DSH_HOME` defaulting to `~/.dsh`. A host override may set
`config.dsh.watchlist_reviews.lockDirectory` to a private absolute directory;
all hosts sharing the storage route must use the same lease. The lock is host
infrastructure and creates no saved picks or provider activity before opt-in.
The host routes the `sparkles_watchlist_reviews` domain through `storageDomain`.
See [bounds, storage and receipt semantics](../plugins/watchlist/README.md#dsh-durable-reviews).

The installed-host role lane uses fresh storage and scripted source tools,
checks policy denial and session isolation, reopens the store, and kills a
separate Node process during acquisition. Recovery must reuse the completed
source, mark the interrupted one unknown and issue no repeat requests. It is
part of `bun run dsh:verify` and the clean npm installation gate. These checks
make no live-provider or model-execution claim.

## Host mapping

| Pi surface | DSH behavior |
| --- | --- |
| tools | Registered with `ctx.tools`; actual DSH call ID, signal, and agent are forwarded. Pi results are normalized to canonical JSON and `output.render` returns `ContentBlock[]`. |
| commands | Registered with `ctx.commands`; Pi UI notifications become command result text. |
| queued user messages | Routed to the invoking agent's `followup` or `steer` inbox. |
| custom entries/session reads | Stored in and projected from the invoking DSH agent's session log. |
| session lifecycle | Pi start/shutdown hooks follow serial `agent/created` (with `source` and initialization cancellation) and `agent/disposed`. Initialization and restore failures reject creation. |
| stateful Pi shells | Instantiated once in each `agent.ctx`; registrations and mutable cells disappear with that scope. |
| Pi session-tree hooks | Registered for compatibility but not synthetically fired; DSH forks/resumes as a distinct session and restores on `agent/created`. |
| Pi statusline | `setStatus`/`clearStatus` append whole-value ignorable status records; `finance_track_overlay` folds old and new records into `piSparklesStatus`. |
| browser status | The package's `dsh.client` entry registers the draggable, keyboard-movable `pi-sparkles-finance-track` badge in `shell.overlay`; double-click or Home resets its position. |
| browser charts | `chart_ohlcv` adds bounded `output.presentationMeta`; a session projection replays native/nested results into stacked SVG cards above the draggable status bar. Keyed tool output retains exact text. |
| persisted event vocabulary | New `plugin:pi-sparkles/*` records need no catalog mutation. The entry retains catalog support for the two legacy required event types before cold loading. |
| working directory | Invocation context reads the current session's `workingDirectory.get(session)` value, including after a change or resume; the immutable session header remains original-project metadata. |
| finance routing prompt | Exported once by the Gleam track module and contributed as an agent-scoped DSH system-prompt section. DSH reports whether the heavily limited Tushare stock-identity fallback is configured, without exposing the token; it is never the first route or automatic, requires user acceptance after the primary path is unavailable, and does not cover indices. CN/HK OHLCV producers register their exact canonical `seriesReceipt` in the invoking session for indicator/chart consumers; US does so only with caller-proven `XNYS`/`XNAS`, otherwise reporting `track_partial`. Acquisition/gap digests are never substitutes, and a missing handoff stops that enrichment rather than triggering row copies, scripts, or repeated consumer calls. |
| flags | Defaults may be overridden by bundle `config.flags` or `PI_SPARKLES_FLAG_<NAME>`. |
| unsupported Pi effects | Fail explicitly; they never return placeholder success. |

Charts do not use either host's image or attachment path. Pi owns a colored
Unicode TUI result component. DSH projects settled native/PTC chart metadata
into `piSparklesCharts` and renders SVG cards above the finance status bar.
Drag the bar to move the complete stack. Chart width follows 1.5 times the
measured status-bar width, capped to the available screen width. The bar stays
the floor when a middle card is hidden: cards above move down and cards below
keep their positions.
Use each card's Hide button or its checkbox under Charts to toggle it. Visibility
is local to the browser component and separately remembered for each session
until page reload. The latest 12 charts are available in the panel; older exact
outputs stay in the transcript. Tall stacks scroll above the bar without card
overlap. Both hosts keep exact text in ordinary tool output. See [`../CHARTS.md`](../CHARTS.md).
After a package update, restart the DSH server as well as refreshing the browser.
The tool view keeps an inline chart until its exact call is available in the
floating projection, including when the server is still running old code.

Provider HTTP does not depend on a Pi fetch helper. The shared
`finance_http` transport uses standard `globalThis.fetch`, AbortSignal,
redirect rejection, response budgets, and timeouts, which are available in the
pinned Node 22.19+ within 22.x, or Node 24+ host. Provider credentials come only from the DSH process
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
mapping, overlay component/projection, floating chart stacking/toggles and replay, release gate, locks,
and npm inventory. `bun run dsh:verify` currently uses DSH 0.2.1-rc.2
implementation to create two real agent scopes, expose all 253 effective tools,
verify the shared prompt and track projection, and prove that a watchlist
mutation cannot leak to the second agent. It also verifies CN/HK/US receipt
consumers, cross-agent rejection, and OHLCV/indicator restoration in a fresh
Session instance after dispose/resume. These fixtures prove shared handoff
behavior, not provider or live-market conformance.

The npm install smoke installs the exact tarball into a clean prefix/profile,
boots that profile through the installed DSH CLI, checks authenticated page
and client asset loading, then runs the receipt/runtime checks under Node
against that installed package. Asset checks are structural, not visual QA.

The generated package declares the exact `@deepseek-ai/dsh@0.2.1-rc.2` host
peer, pins its tested DSH service peers to the same version, and pins
`pdfjs-dist` plus its Bun-compatible `@napi-rs/canvas` polyfill. PDF runtime
state is initialized only by a PDF operation, never while the DSH entrypoint
registers. Its Node range matches DSH (`^22.19.0 || >=24.0.0`). It carries exact
locks/checksums and contains no lifecycle scripts or credential values. The release install gate
requires that exact host version.

## Contract review — 2026-10-18

Compared installed DSH `0.2.1-rc.2` with source commit
`687f282e8625c6b8d11ff58211a90524be2e4317` (`dsh-v0.2.1-rc.2`), against the
previous `dsh-v0.2.0-rc.2` contract. All changes below belong to the DSH adapter
and distribution lane. The shared finance cores, Pi shells, provider selection,
receipt authority, and `cn`/`hk`/`us` applicability stay the same.

| Surface | Gap or reviewed change | Disposition |
| --- | --- | --- |
| Host, peers, Node | Old host pins; Node 23 was incorrectly admitted by our engine range | Pin every used DSH peer to `0.2.1-rc.2`, add the working-directory peer, and match the host engine range. Verify installed peer versions individually. |
| Persistence | New `appendPluginRecord` / `pluginRecordOf` exports replace the need for new required third-party events | Write ignorable `plugin:pi-sparkles/*` records; read both generations in log order. Keep the legacy-only catalog bridge and explicit v0 migration tool. Reopen new records without adding their names to the catalog. |
| Cwd | DSH now supports durable directory changes; `session.header.cwd` is the original project | Read the invoking session's working-directory service. Check independent agents and dispose/resume after a real directory change. |
| Creation | Serial `agent/created` still owns initialization and carries an optional signal; asynchronous scoped failures were previously swallowed | Await initialization, propagate restore errors and the host signal, and reject failed or cancelled startup. No synthetic `agent/session-start` event. |
| Tools and schemas | PTC supports nested presentation metadata; `both` presentation mode was removed; schema subset remains compatible | Keep the shared schema bridge and canonical text/value output. Sparkles does not configure host presentation mode. Prove matching chart metadata on native and nested calls for all three track labels. |
| Commands and prompts | Commands remain compatible; prompt contexts gain required/literal refresh support | Keep the named agent-scoped routing section and invocation-bound commands. No new host prompt context is needed for the finance policy. |
| Projections and browser | Projection disposers are now adoptable; slots retain root `useSessions` and phase-tagged tool `block` props | Keep the pure projection, `shell.overlay`, and keyed `tool.call.toolview`. Test old/new status folds, chart rendering, installed client discovery, and authenticated asset serving. |
| Ownership and networking | No new finance or provider contract is implied by the host update | Preserve 131 global shells, four fresh scoped shells, and the DSH-native overlay and review runner. Keep shared bounded `finance_http` transport. |

Validation uses the focused DSH tests, the real installed DSH runtime under Bun
and Node, a clean npm-prefix/profile install and authenticated web asset smoke,
plus cumulative T1-through-T6 Pi load and durable reopen. Chromium checks cover
stacking, the fixed floor, hide/show, dragging, 1.5× status-bar sizing and narrow
screens; the local DSH visual review is accepted by the release instruction.
DSH 0.1.16 advances its own published 0.1.15 baseline. Pi remains at 0.1.13;
verification never publishes either package.
