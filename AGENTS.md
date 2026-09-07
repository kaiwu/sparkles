# Repository Guidelines

## Project Structure & Module Organization

The root is a private Bun task runner, not a Gleam package. The shared Pi binding
lives in `pi_gleam/`. Reusable non-Pi libraries live in `finance/<name>/`, and
loadable extensions live in `plugins/<name>/`. Each package is an independent
Gleam project with its own `gleam.toml`, `src/`, and `README.md`; add `test/`
where the package owns pure laws or focused behavior. Mechanically generated
Pi-only shells may omit package-local tests when their shared core has law tests
and the shells are covered once by tier acceptance, artifact, and Pi-load lanes.
Orchestration lives in `scripts/`; FFI and bundle tests live in `test/binding/`
and `test/artifacts/`. Generated `build/`, `dist/`, `.work/`, and
`manifest.toml` files are ignored. Keep proposals in `ROADMAP.md`; create plugin
directories only when implementation starts.

## Product-Tier Delivery Workflow

[`PRODUCT_TIERS.md`](PRODUCT_TIERS.md) and [`tiers.json`](tiers.json) are the
normative delivery plan. All 135 R1 proposals belong to exactly one role-based
product tier. The active tier and its blocker state in `tiers.json` replace the
old one-plugin active queue.

The only delivery, verification, and promotion unit is a complete tier. Never
select, implement, close out, or promote one plugin as an independent roadmap
item, and never record another “Experimental complete” milestone. Existing
Experimental packages are implementation inventory, not finished products.

For each tier:

1. resolve every genuine external blocker first, with exact exit evidence in
   `R3.md` or the referenced decision record. A missing alternative provider or
   absent production credential is not a blocker when one testable provider,
   public source, user-owned import, fixture, or scripted capability can prove
   the contract;
2. only then move the tier to `building` and implement its entire dependency
   cone inside out: pure finance laws, adapters/capabilities, Pi shells,
   receipt handoffs, lifecycle, and the complete role journey;
3. use focused package tests only as cheap inner-loop diagnostics; they do not
   change ledger status and are not promotion evidence;
4. move the tier to `verifying` only when every proposal is implemented and
   the role-level acceptance lane exists, then run `bun run tier:verify -- Tn`
   exactly once for the tier;
5. promote only the whole tier to `product_useful`. If any required provider
   path, track leg, plugin, handoff, failure/recovery case, or acceptance step is
   partial, the tier remains blocked/building/verifying.

Do not run the full build/binding/artifact/Pi/regression matrix after each
plugin. Do not use provider-neutral packets, fixtures, or isolated passing tests
to claim that a tier or role product is complete. Later tiers consume earlier
ProductUseful tiers through typed Pi-visible receipts, never plugin-to-plugin
source imports.

Product tiers and market tracks are not a Cartesian matrix. Each tier has the
single acceptance profile declared in `tiers.json`; do not create CN/HK/US
copies of its role journey or full verification lane. Shared logic is built
once. Add a track-owned adapter/module only when market semantics genuinely
differ, and keep non-anchor coverage explicitly unsupported or `track_partial`.
Never infer that one anchor journey proves another track.

T6's declared profile is one explicit composed exception to single-track
anchoring, not an acceptance matrix: its one role lane contains mandatory,
separately labelled `cn`, `hk`, and `us` live legs. Shared workflow laws run
once, while Futu feed/rights/identity/sequence/condition/clock/recovery
conformance is proved independently for each track. No successful leg proves or
silently supplies another.

Only ProductUseful inventory may become a releasable plain Pi distribution. Use
`bun run tier:package -- Tn` to build the normal package containing that tier
and its ProductUseful dependency closure; its manifest loads each version-locked
extension separately. The prior release boundary is explicitly selected by
`bun run aggregate:build -- T5` and contains exact T1-through-T5 inventory.
T6 is the current release/default aggregate target and means the complete
cumulative T1-through-T6 inventory. It is releasable only while its ledger is
ProductUseful with no omissions, partials, or blockers. Aggregation may combine only
compiled initialization and distribution; it must not introduce plugin source
imports, weaken tier maturity, imply promotion, add broker order mutation, or
change receipt/track/provider authority. Duplicate named registrations must
fail before reaching Pi. Reference/demo `extra_packages` are excluded. The
generated lock, checksums, configuration inventory, and applicable
ProductUseful or blocked-preview gate are mandatory.
`bun run npm:pack -- T5|T6` turns the selected aggregate into the stable
`@pi-sparkles/pi-sparkles` npm package. It must pack only a whitelisted,
content-locked inventory, include the licence and third-party notices, declare
exact runtime assets and the Pi-required host peers, contain no lifecycle
scripts or credential values, install into a clean npm prefix, load in plain Pi
without provider credentials, and refuse publication unless the selected aggregate is releasable. T6 may produce
a private npm-format preview while blocked; the same target becomes publishable
only after it is complete and ProductUseful. Packaging and verification never
publish. Registry publication remains a separate explicit, authenticated action
over the exact verified tarball.
`bun run tier:install -- Tn` must delegate to plain Pi's package installer and
must never edit Pi settings, persist credentials, or publish externally itself.

Provider breadth does not create another product matrix and is not a pre-build
gate. Define canonical provider ports and conformance laws once, implement at
least one testable adapter for the tier, and keep the plugin ready for several
mainstream adapters without redesigning its domain or Pi API. Each concrete
adapter declares exact environment variables or injected capabilities and
requires explicit selection; never silently share credentials, cross tracks,
or fall back to another provider. Credentials are caller-owned runtime or
opt-in-test inputs, never product files, fixtures, defaults, logs, receipts, or
persisted plugin state. Deterministic tests use rights-safe fixtures and
scripted transports. Test each additional adapter with focused conformance and
decoder coverage; do not duplicate the complete role journey per provider.

Record unknown service level, entitlement, licence, redistribution, correction,
or completeness facts honestly in adapter results. Such limitations restrict
claims and distribution; they block a tier only when no lawful/testable input
path can support the tier's anchor journey. Real-time day-trader behavior is the
current external exception because daily fixtures cannot prove live sequence,
gap/reset, correction, or latency behavior.

Tier scope may cross many package boundaries, but every touched plugin must
remain coherent and buildable at every handoff or commit checkpoint. Update
coordinated producers/consumers atomically and run
`bun run tier:checkpoint -- Tn`. Do not expose incomplete public tools, commands,
events, manifests, placeholder successes, `todo`/panic paths, silently empty
adapters, or README claims. Unfinished work remains private compilable code or
explicit tier backlog. This checkpoint is an integrity rule, not plugin-level
delivery or promotion.

## Independent npm Version Selection (Mandatory)

Pi (`@pi-sparkles/pi-sparkles`) and DSH (`@dsh-sparkles/dsh-sparkles`) are
separate npm packages with independent version sequences. Releasing either
must not automatically bump, publish, retag, or require a release of the other.
There is no shared release counter; each increments from its own published history.
Never assume either package's next version from the other package, a
repository/global tag, the DSH host version,
a local manifest, a packed tarball, or a locally installed manual-test candidate.
A local candidate does not consume an npm version. A request for the "next
release" requires fresh registry evidence for the selected package; it is not
permission to increment whichever local version happens to be present.

Before editing a release version, run `bun run npm:release:preflight -- pi`
or `bun run npm:release:preflight -- dsh`. Read that exact package's published
versions and dist-tags, and compare its local candidate with its own published
baseline. Pi's version source is root `package.json`; DSH's is
`dsh/bundle.json` → `dsh_release.version`. Required host versions are separate
compatibility metadata, never package release counters.

State the selected package name, observed published baseline, local candidate
and whether it is published, exact proposed version, and reason before doing
the bump. If the user already specified a version, validate it; otherwise choose
the smallest appropriate SemVer increment from that channel's published history.
Reuse an unpublished candidate when it is the intended next release. Do not
increment it merely because it was built, tested, installed, or reboot-tested.
A skipped patch or minor/major change requires an explicit recorded reason.
Registry errors or conflicting evidence must stop version selection; never guess.

Run the explicit preflight with `--base` and `--version`, the selected host's
verification/install/manual-check steps, then repeat the preflight with
`--artifact` immediately before publishing. Preserve its JSON evidence with the
verified tarball. CI requires `pi-v<version>` or `dsh-v<version>` and publishes
one explicitly selected package per invocation. There is no default or `all`
release lane. A request for both requires two independent version decisions and
gates. Website versions must come from each package's confirmed publication.
See [NPM_RELEASE.md](NPM_RELEASE.md) for the complete procedure.

A shared core Gleam fix may require releasing both packages in one coordinated
batch. Inspect its impact and verify both host legs. When both releases are in
scope, choose each next version from its own npm history, update both independent
version sources/changelogs, and complete both release gates and requested manual
checks before publishing. The same reviewed commit may carry two channel tags
with different versions. Publish two separately verified tarballs through two
channel-specific invocations; never substitute one shared version or infer that
one successful publication completes the other. Retain separate evidence and
report each package's publication status, including any partial batch failure.

The 2026-09-07 DSH release should have reused the unpublished `0.1.11`
candidate after published DSH `0.1.10`; publishing `0.1.12` was a numbering
mistake. Leave the published `0.1.12` and its dist-tag unchanged; do not backfill
`0.1.11` or renumber either channel to hide the mistake. Future decisions must
inspect the registry again, without preassigning another version here.

## Pi and DSH Host Lanes

Pi and DeepSeek Harness (DSH) are separate host and release lanes over the same
product inventory. The tier ledger and ProductUseful status govern Pi only;
`dsh/bundle.json` owns an independent DSH maturity gate. A passing Pi tier,
aggregate, or package must never imply that DSH is releasable, and a DSH build
or test must never change `tiers.json` or promote a tier.

For every bug report, diagnosis, behavior change, or regression involving
shared product inventory, always inspect both the plain Pi leg and the DSH leg.
First classify whether the cause is in the host-neutral core/shared Pi shell or
in a host adapter, then add or run proportionate checks for both hosts. A pass,
failure, or live observation in one host never proves the other host's result;
do not call an issue Pi-only or DSH-only without evidence from both legs.

Classify every loadable component into exactly one DSH ownership mode:

- A host-compatible, stateless Pi shell stays in `plugins/<name>/` and may be
  mounted once in the DSH process through `dsh/pi-api.mjs`.
- A Pi shell with mutable session state, session-tree behavior, or agent-owned
  UI must remain in `exclude_pi` for the DSH global lane and enter `scoped_pi`
  only when DSH creates a fresh extension/API instance in `agent.ctx`. Never
  share its mutable cell, registrations, invocation context, or restored state
  between agents.
- A genuinely DSH-only server surface lives in `dsh/plugins/<name>.mjs` and is
  named by `extra_dsh`. A DSH browser surface is packaged as a `dsh.client`
  entry. Neither may enter Pi manifests, Pi aggregation, or Pi load tests.

Share functional cores, typed contracts, decoders, provider ports, receipts,
and model-facing policy whenever their semantics are host-neutral. Keep Pi and
DSH registration, lifecycle, session, and presentation code as thin sibling
shells. Do not import a Pi shell into a DSH-only module or duplicate finance
business logic in JavaScript merely to make a host counterpart. An
`extra_dsh` entry resolves only under `dsh/plugins/`; a `scoped_pi` entry must
also be globally excluded so it cannot be mounted twice.

Audit every Pi host effect used by a bundled plugin against `dsh/pi-api.mjs`.
Map a capability only when DSH has an equivalent contract and bind it to the
exact invoking agent/session. Otherwise fail explicitly or isolate the plugin;
never return a placeholder success. Provider networking continues through
`finance_http` and explicit capabilities. Do not add plugin-local fetch stacks
or assume a Pi-provided fetch API exists in DSH; verify the shared interpreter
under DSH's supported Node runtime.

DSH agent creation is composition-only. Instantiate scoped shells on
`agent/created`, restore them on the real `agent/session-start`, and release
them on `agent/disposed`. DSH append-only forks/resumes are distinct sessions;
do not synthesize Pi `session_tree` navigation. Custom entries, queued
messages, cwd, cancellation, notifications, and tool execution must always use
the invoking agent carried through async-local context. Persistence must be
proved by dispose/resume tests in addition to simultaneous-agent isolation.

Keep presentation host-native. Pi terminal widgets and statuslines stay in the
Pi lane. DSH status UI uses typed session events, a registered session
projection, and a browser client slot; the finance track status belongs in
`shell.overlay`. A DSH client reads the current session projection and must not
depend on process-global state. Pi inline base64 images are not DSH attachment
blocks: preserve safe text/structured output or implement an explicit DSH
attachment/client renderer instead of forging compatibility.

The generated DSH package must pin its tested DSH service peers, declare exact
server and client entrypoints, include a content lock and checksum inventory,
install in a clean prefix/profile, and load through the installed DSH CLI.
`exclude_pi`, `scoped_pi`, and `extra_dsh` are reviewed manifest boundaries,
not convenience lists. DSH remains a private preview until its own complete
role-level acceptance lane is declared ProductUseful; packaging and
verification never publish.

## Architecture & Distribution

Plugin root modules export
`extension(api: pi.ExtensionApi) -> Promise(Nil)`. Bun generates Pi's required
default-export adapter and `dist/<plugin>/index.js`. Hex distributes Gleam and
FFI source; users must build it before Pi can load it. Put typed APIs in
`pi_gleam` and isolate unsupported surfaces behind `pi/raw`.

Use the functional-core/effect-shell rules in `FUNCTIONAL_DESIGN.md`. Domain
modules operate on immutable Gleam values and must not import Pi, promises, or
FFI. Decode at the shell, run pure total transitions, then interpret typed
effects. Pass clocks, transport, storage, randomness, and entitlements as
explicit capabilities. Keep unavoidable mutable cells generic and put no
business logic in JavaScript.

Build user workflows by composing orthogonal plugin/tool responsibilities, not
by adding query-shaped monopoly tools. Provider acquisition copies one exact,
bounded source surface and returns typed Pi-visible facts and receipts;
identity/normalization validates those facts; reusable calculation tools
consume explicit facts or receipt-bound inputs without network access; and the
LLM/workflow layer combines their results and owns interpretation. No single
tool may silently choose a provider or universe, discover/fetch inputs,
normalize identities, calculate/rank, and issue a judgment merely because one
prompt mentions all of those steps. Reuse an existing acquisition, identity,
calendar, rules, series, indicator, screener, or receipt surface instead of
duplicating its work inside a convenience endpoint.

Bounded batch acquisition is permitted only as transport optimization for one
homogeneous, explicitly scoped source operation. It must expose the exact
request count, identities, provider order, per-item failures/omissions, limits,
and receipts, and it must not absorb downstream calculations or interpretation.
A workflow composes only the evidence needed by the user's requested analysis;
it must not fan a single-item network tool across every row merely because more
enrichment is possible. Check each downstream tool's identity, credential,
entitlement, and input preconditions before calling it. If they are absent,
retain the fact as unknown. A failed optional enrichment is terminal for that
enrichment unless the user requested a distinct fallback path; do not cascade
through alternate tools, query modes, providers, or tracks to manufacture the
missing fact. Prefer one reviewed homogeneous batch adapter when repeated
source acquisition is genuinely required, but do not invent a batch by issuing
unbounded parallel single-item calls.
A provider-ranked page may preserve the provider's order as an observed fact;
it is not a plugin-owned score, recommendation, or proof of complete-market
ranking. Cross-tool handoffs use explicit typed values or content-bound
Pi-visible receipts rather than ambient mutable state, plugin-to-plugin source
imports, model-reconstructed hidden context, or an opaque aggregate result.
Role acceptance should exercise the composed handoff and its failure cases;
one successful all-in-one tool call is not evidence that the underlying
capabilities remain reusable or independently trustworthy.

Whenever one track gains or changes a capability, review `cn`, `hk`, and `us`
before closing the batch. Put genuinely shared laws and calculations in one
provider-neutral implementation, then add only the track-owned adapters whose
market semantics and provider contracts are actually proved. For every other
track, either reuse the shared contract through an exact adapter or record an
explicit unsupported or `track_partial` result with the missing evidence; do
not leave track applicability implicit, copy market-specific assumptions, or
infer that the changed track proves another. This applicability review is not
a demand for three acceptance journeys or a provider-by-track matrix.

The finance foundations include `finance_archive`, `finance_core`, `finance_track`,
`finance_evidence`, `finance_listing`, `finance_market_calendar`,
`finance_market_authorities`, `finance_market_rules`, `finance_market_documents`,
`finance_document_attachment`, `finance_market_accounting`,
`finance_track_capabilities`, `finance_cache_contract`,
`finance_provenance`, `finance_http`, `finance_math`, `finance_series`,
`finance_calendar`, `finance_ohlcv`, `finance_indicators`, `finance_risk`,
`finance_execution`, `finance_tape`, `finance_journal`, `finance_replay`,
`finance_cn_ohlcv`, `finance_hk_ohlcv`, `finance_us_ohlcv`, `finance_table`, and
`finance_testkit`.
They are Experimental independent Gleam packages, not Pi plugins. Keep their dependency
graph acyclic: core imports no finance package; track and other provider-neutral
packages may build inward on core; evidence composes canonical observations,
provenance, and track contexts; series may compose core, math, and calendar;
testkit may support core and HTTP. Finance packages must never import
`pi_gleam`.

The only user-visible market track identifiers are `cn` (mainland China), `hk`
(Hong Kong), and `us` (United States). Use `finance_track` for the shared
validated result context. Global and cross-market workflows retain separately
labelled track legs; they are not additional tracks. Market-specific tool
results must expose their track, and no provider or identity resolver may
silently move a request between tracks.

`finance_track_status` owns the session's visible active navigation track.
Switching among `cn`, `hk`, and `us` updates status and emits the shared track
event, but must never relabel observations, substitute a provider/calendar, or
share market-owned persisted state. Currency and timezone in the statusline are
interaction defaults; source observations remain controlling.

Market-owned CN/HK packages compose the shared engines but remain isolated:
identity selects exact track/MIC/board scope; calendars are source/version/
licence/coverage bounded; rules select exact listing, board, share class,
security/status, and effective date; documents retain original language plus
correction/translation lineage; accounting retains exact numeric lexemes,
reported scale, statement scope, audit/restatement state, and duplicates.
Attachment retrieval must pass exact media allowlists, byte/page/redirect
budgets, cancellation, and content-hash checks. Arbitrary archives and OCR fail
closed. The only reviewed archive effect is `finance_archive`'s in-memory,
exact-entry UTF-8 ZIP contract with explicit byte/count/decompression budgets,
safe-name/encryption/ZIP64/compression rejection, cancellation, and CRC/length
checks; it permits no filesystem extraction, recursion, or nested archives.
Unknown or conflicting rules and mappings fail closed. A `cn_*` plugin must not
import `finance_hk_*`, `finance_us_*`, or SEC market domains, and an `hk_*`
plugin must not import `finance_cn_*`, `finance_us_*`, or SEC market domains.
US market-owned packages likewise remain isolated from CN/HK domains;
`finance_us_calendar` owns exact NYSE/XNYS and Nasdaq/XNAS calendar scope rather
than treating either venue as a global or provider-derived default, and
`finance_us_rules` owns exact listing/venue/effective-date rule scope without
turning caller declarations into verified identity or security status.
`finance_us_ohlcv` owns the US-only calendar/listing/status/provider-receipt join;
it must reject incomplete or conflicting evidence and must not authenticate
caller-supplied receipts by assertion. Its canonical gap projection may bind
page-content hashes and copied fields, but a matching digest must not be
presented as a provider signature, authority proof, or origin authentication.
`finance_cn_ohlcv` owns the corresponding mainland-only join over exact
SSE/SZSE/BSE identity and reviewed calendar scope. It must not import US/HK
market domains or treat Eastmoney vendor origin as exchange evidence. Shared
canonical acquisition receipts and gap classification live in `finance_ohlcv`;
market-owned packages supply exact identity, calendar, and source-plan laws.
`finance_hk_ohlcv` owns the XHKG/HKEX counterpart and must retain published
half-day schedule evidence without treating a daily row as proof of intraday
completeness. It must not import CN/US market domains or turn Eastmoney into
HKEX evidence.

Provider adapters such as `finance_openfigi`, `finance_sec`, and
`finance_tushare` are also independent finance
packages but sit outside the provider-neutral foundation. They may compose core
and HTTP, must keep credentials opaque, and must expose validated request plans,
fixture-tested decoders, explicit pacing/entitlement/licence policy, bounded
execution, cancellation, and pagination budgets without importing Pi.

Use `finance_core.Observation(a)` as the canonical provider-to-plugin envelope.
Preserve source, as-of/retrieval time, freshness, unit, adjustment, quality, and
entitlement rather than flattening them into display strings. Keep unknown facts
unknown. Use math and series for calculations, calendar for market-time
semantics, provenance for evidence graphs, table for rendering, and testkit for
deterministic interpreters. Provider adapters use `finance_http`; do not add
plugin-local fetch, retry, rate-limit, cache, or redaction stacks.

The initial real-plugin batch is `plugins/finance_setup/`,
`plugins/cn_setup/`, `plugins/hk_setup/`, `plugins/finance_guardrails/`, and
`plugins/finance_symbols/`; the first F1
slices are `plugins/sec_edgar/` and `plugins/sec_xbrl/`, and the first normalized
SEC consumer is `plugins/stock_fundamentals/`. Treat these root
modules as Pi/Promise effect shells and keep configuration, policy, decoding,
normalization, and resolution in pure namespaced modules. Provider network code
must have bounded responses, cancellation, rate-limit behavior, fixture-tested
decoding, and source/licence documentation.

SEC XBRL numeric JSON tokens must remain exact source strings until an explicit
decimal/metric layer converts them. Preserve taxonomy, tag, unit, start/end,
accession, fiscal period, form/amendment, filed date, frame, and duplicates.
Company-facts covers only non-custom taxonomy facts applying to the whole
entity; do not present it as complete filing or segment coverage.

Fundamental mappings must be executable data with accepted tags, unit kind,
period kind, and method visible to callers. Statement-period classification uses
inclusive Gregorian durations and exact end dates; do not treat `fy`/`fp` as a
comparative fact's economic period. Alternative tags, amendments, comparative
repetitions, and duplicates remain an explicit identifier resolution. Filing
precedence defaults to preserve-all; latest, original-only, amendment-only, and
exact-accession behavior must be an explicit caller policy.

SEC derivations consume resolved candidates, never raw candidate lists. Q4 may
subtract only additive duration metrics after proving identical metric, exact
unit, taxonomy/tag, fiscal start, and annual/nine-month shapes; retain both
source candidates in the result and prove the residual is quarter-shaped.
Comparable trends require unique points with
one metric, unit, taxonomy/tag, and period class, then sort by exact end date and
reject duplicates. Never interpolate, coerce alternative tags, or choose a
restatement inside a derivation. Keep these laws in pure Gleam modules so
downstream formulas can compose and test them without Pi or HTTP.

Multi-input SEC formulas live in pure plugin domain modules and compose
`finance_math`; do not reimplement decimal arithmetic in the Pi shell. Resolve
every named input independently, require uniqueness, then prove exact period and
filing-context coherence before calculation. Formula results must expose the
expression tree, ordered input names, declared output unit, rounding/scale and
accounting assumptions, plus every complete source candidate. Zero denominators,
wrong units, cross-filing combinations, and unsupported metrics are errors, not
missing values or coercions.
Per-input accession overrides may replace the base filing policy for selection,
but must never bypass the subsequent same-filing proof. Report each effective
source policy alongside its named candidate.

Multi-period formulas consume an already validated comparable trend. Growth
must declare and validate the calendar gap between every adjacent end date;
never label skipped observations quarter-over-quarter or year-over-year. Direct
TTM requires exactly four additive quarter facts with `next.start` equal to the
day after `previous.end`, and the complete span must independently classify as
annual; do not fill gaps, average weighted-share facts, or mix derived quarters
unless a later typed constructor explicitly models that source variant. Retain
both candidates for every growth edge and all four candidates for every TTM sum.

An annual/YTD TTM bridge is `annual + current_ytd - prior_ytd`. Require an
additive metric; identical unit and taxonomy/tag; annual and prior-YTD fiscal
starts to match; current YTD to begin the day after annual end; comparable YTD
classes and a year-over-year end gap; and an annual-shaped resulting window.
Resolve and retain all three sources independently. This bridge does not imply
that derived and directly reported quarter values are interchangeable.

Represent quarter provenance as an explicit `DirectQuarter | DerivedQuarter`
sum type. Any downstream composition must revalidate derived Q4 from its annual
and nine-month candidates, label the variant in output, and expand its formula
to direct source leaves rather than treating the derived decimal as a provider
fact. Mixed-quarter TTM still requires exact continuity, one metric/unit/tag,
and an annual-shaped complete window.

## Build, Test, and Development Commands

- `bun run tier:audit`: validate exhaustive tier ownership and show blocker,
  implementation-inventory, and remaining counts.
- `bun run tier:show -- T1`: inspect one tier's exact proposals, blockers,
  dependencies, outcome, and acceptance lane.
- `bun run tier:checkpoint -- T1`: format and warnings-as-errors build every
  currently touched Gleam package, and run each focused test suite that exists,
  as one atomic tier working set; it never changes maturity.
- `bun run tier:verify -- T1`: run the only promotion gate; it refuses open
  blockers, missing implementations/dependencies, wrong status, or a missing
  role-level acceptance lane before running the expensive matrix.
- `bun run tier:package -- T1`: build and content-lock one plain Pi package for
  a ProductUseful tier and all its ProductUseful tier dependencies.
- `bun run tier:install -- T1 [--scope user|project]`: verify/build the tier
  package and delegate its local-path installation to the installed Pi CLI.
- `bun run aggregate:build -- T5|T6`: bundle the selected ledger inventory
  behind one Pi entrypoint without changing tier maturity.
- `bun run npm:pack -- T5|T6`: prepare and verify the selected aggregate as the
  stable all-in-one npm package; it never publishes.
- `bun run dsh:bundle [-- T5|T6]`: build the independent DSH all-in-one bundle;
  `--no-build` verifies that all required compiled inputs already exist.
- `bun test test/dsh test/workflow/dsh_npm_package.test.js`: run the focused DSH
  adapter, scoped-state, overlay, bundle-lock, and npm-inventory tests.
- `bun run dsh:verify`: load the generated bundle through the installed DSH
  services and exercise schemas, tools, commands, prompts, projections,
  isolation, and persisted-session resume.
- `bun run dsh:npm:preview:verify`: pack the private DSH preview, install it into
  a clean npm prefix/profile, and run the real-runtime smoke without publishing.
- `bun run dsh:npm:release:verify`: run only after the independent DSH release
  status is ProductUseful; it remains a verification gate and never publishes.
- `bun run check`, `bun run build [-- hello]`, and
  `bun run test:unit [-- hello]`: inner-loop diagnostics only; a package-level
  pass never changes delivery status.
- `bun run test:architecture`, `bun run test:ffi`, `bun run test:artifacts`,
  `bun run test:aggregate:pi`, and `bun run test`:
  diagnostic/manual commands used by the tier gate. Pi load verification always
  loads the cumulative T1-through-T6 all-in-one aggregate entrypoint; an earlier
  tier target or per-plugin Pi-load lane is forbidden.
- `bun run clean`: remove generated outputs.

## Coding Style & Naming Conventions

Run `gleam format`; use snake_case modules and functions. Plugin packages follow
`pi_sparkles_<name>` and directories use the short name, such as
`plugins/safety_gate/`. JavaScript is ESM with two spaces, semicolons, and small
FFI functions. Decode external values at typed boundaries; FFI annotations are
not runtime validation.

## Testing Guidelines

Use gleeunit for pure logic. Name Gleam tests `*_test.gleam` and Bun tests
`*.test.js`. New binding wrappers need Bun contract tests for applicable shapes,
promises, options, failures, and callbacks. Finance libraries need deterministic
unit tests, laws/invariants, transition-sequence tests, and FFI contracts where
applicable. Plugins additionally need artifact and Pi-load coverage. Run focused
tests while building, but do not run or cite the full promotion matrix for an
individual plugin. At the completed tier boundary, change the tier to
`verifying` and run `bun run tier:verify -- Tn` once before ProductUseful
promotion.
DSH counterparts additionally require focused bridge tests and a real installed
DSH smoke. Stateful shells must prove two-agent isolation and dispose/resume
restoration. Browser surfaces must prove client discovery, exact slot
registration, projection-driven rendering, and web asset loading; perform
visual browser QA when a browser instance is available. These DSH diagnostics
do not substitute for either the Pi tier gate or the independent DSH role lane.
Provider plugin unit tests use fixtures or scripted transports, never live
network calls, real sleeps, ambient credentials, or mutable shared caches.
[`PROVIDER_CALLS.md`](PROVIDER_CALLS.md) must enumerate every concrete provider
operation and record exact pass/fail/credential/entitlement status. The
explicit `bun run test:live:providers` command is the bounded, read-only,
non-retrying lane for the non-metered current-request and decoder checks; the
normal SEC live lane remains `bun run test:live:sec`. Both must redact secrets
and must never treat an authentication rejection, fixture, alternate host, or
different endpoint as response conformance. Metered or unusually rate-limited
providers require an explicit provider selection and caller-owned credential
file; stop that provider leg on the first quota or rate-limit response. The
temporary `bun run probe:live:futu:us`,
`bun run probe:live:futu:cn`, `bun run probe:live:futu:hk` ticker,
`bun run probe:live:futu:us:rights`, and `bun run probe:live:futu:rights`
entitlement lanes, plus the one-shot
`bun run probe:live:futu:webapi:oauth` direct-API authorization lane, are also
allowed while
`T6-INTRADAY-PROVIDERS` remains open. They are Bun-only, quote/global-read-only,
hard-budgeted, non-retrying, and excluded from `bun run test`, tier gates,
packaging, installation, and plugin load. OpenD lanes are localhost-only and
reconnect-disabled. The OAuth lane registers only the documented localhost
public client, requires PKCE and interactive caller consent, accepts only an
exact `quote:read` grant, stores one short-lived access token in a fixed
mode-0600 `/tmp` file, and discards refresh and registration credentials. The
ticker lane permits exactly one fixed Futu direct
`/api/v1.0/quote/{symbol}/rt-ticker?num=10` request for one reviewed track/MIC
anchor, with no retry or redirect and no stock-quote, bid/offer, order-book,
trade, or account endpoint. It preserves int64 sequence lexemes internally and
emits only redacted aggregates. The temporary direct WebSocket lane permits
one reviewed HK/XHKG connection, OAuth auth, one `ticker` subscription, and
one exact `ticker` unsubscribe with no reconnect or retry; quote, order-book,
K-line, trade, and account fields are forbidden. The
ticker lane is one-symbol/one-subtype; the rights lane is exactly one protocol
1005 request with quote-right flag 4 and an output allowlist. All live lanes
must remain opt-in, read-only, caller-identified, host/method allowlisted, and
request-budgeted.

## Commit & Pull Request Guidelines

History has no established convention beyond the initial empty commit. Use
short, imperative subjects such as `Add typed quote schema`, and separate
unrelated changes. Pull requests should explain behavior, packages, provider/API
assumptions, tests, and compatibility impact; link the roadmap item or issue.
Add screenshots only for interactive TUI changes.

## Security & Configuration

Pi and DSH extensions execute with full user permissions. Never commit or emit
secrets. Finance plugins must report source, freshness, units, and data
entitlement, and keep read-only, paper, and live-trading capabilities separate.
