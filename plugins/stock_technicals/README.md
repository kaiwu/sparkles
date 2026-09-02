# pi_sparkles_stock_technicals

Status: **Experimental — Session 17 rank 1 complete** · version: `0.1.0` ·
target: JavaScript/Bun

`stock_technicals` is the first thin Pi shell over the existing
`finance_indicators` functional core. It exposes four neutral calculation
tools—`sma`, `rsi`, `atr`, and `compare_series_returns`—for exact
caller/LLM-supplied observations or a content-verified OHLCV receipt stored on
the active Pi/DSH session. It
fetches no market data and makes no choice about instrument, provider, field,
price basis, formula, period, gap handling, parseable-value handling, rounding,
projection, interpretation, or next operation.

The controlling professional contracts are
[Session 12](../../../trading-course/sessions/12_cg_tech_indicator_calculations_20260807.md)
and
[Session 17](../../../trading-course/sessions/17_product_plugin_portfolio_steering_20260807.md).

## Decision boundary

The LLM chooses every query and supplies every input and policy. The plugin
only decodes the request, faithfully invokes the named deterministic
calculation, and returns requested facts, evidence, calculations, provenance,
unknowns, conflicts, omissions, and available operations.

The tools never choose or emit:

- an indicator, source, provider, track, instrument, field, adjustment basis,
  formula variant, period, gap policy, parseable-value policy, rounding mode,
  precision, summary projection, or comparison;
- correctness, sufficiency, readiness, importance, setup, signal, trend,
  volatility regime, overbought/oversold, candidate, rank, recommendation,
  trade, or next-action conclusions; or
- a fallback, imputation, source merge, cross-track merge, or hidden default.

Runtime decoding, exact arithmetic, content hashing, and reporting why a
requested operation could not run are implementation mechanics. They do not
claim that source data or a professional conclusion is correct.

Every result will include `decisionOwner: "llm"` and
`pluginDecisionFields: []`.

## Professional routine

1. An acquisition tool obtains one exact, single-track input series and stores
   its immutable, content-bound session handoff; an external caller may instead
   supply the complete observations and source context directly.
2. The LLM calls exactly one of `sma`, `rsi`, or `atr`, passing the short
   `seriesReceipt` plus the supported formula and every parameter. It does not
   copy history CSV rows into the tool call.
3. For `projection: "compact"`, the plugin returns the latest calculated
   value, the requested prior calculated value, counts, receipt handles,
   unknown/conflict facts, a `chartHandoffReceipt`, and neutral available
   operations. The complete ordered chart projection is stored on the active
   session rather than copied into the compact model output.
4. When more evidence is useful, the LLM repeats the same request with
   `projection: "intermediate"`. Equal semantic inputs produce the same
   semantic receipt hash; the response additionally exposes the ordered output
   series, intermediate values, and unperformed dates.
5. The LLM alone interprets the values and chooses whether to query another
   formula, change a parameter, inspect another input series, or continue a
   professional workflow.

The calculator owns no mutable series cache. A receipt is a stable content
identifier, not a process-global cache key: Pi persists the exact acquisition
handoff on the active branch and DSH persists the same event on the invoking
agent's session. The shell resolves and rehashes it for every call. Session
replay therefore reconstructs the same input, while another session or agent
cannot access it by ambient process state.

Each successful SMA, RSI, or ATR calculation also appends a versioned,
content-bound indicator chart handoff. `chart_ohlcv` accepts its short
`chartHandoffReceipt` as an `indicatorReceipt`, verifies the stored points, and
checks their source `seriesReceipt`. This avoids an intermediate projection and
large model-authored chart arguments while preserving the calculator/chart
responsibility boundary.

## Tool surface

### `sma`

Calculates only `sma_v1` over `slot_window_v1` for an explicitly named input
field and period. Partial windows and unavailable slots are returned as
unperformed outputs; the tool never substitutes `sma_partial_v1`, skips slots,
or imputes values.

The preferred history path passes `seriesReceipt`; the shell maps its exact
close lexemes to ordered observations. A source receipt whose adjustment
semantics are explicitly `unknown` remains a labeled `provider_defined` basis;
the calculator does not relabel it as raw or adjusted. Direct external inputs may instead pass
ordered `observations` containing a date and exact numeric fact. Both paths
accept at most 2,000 observations per call.

### `rsi`

Calculates only `rsi_wilder_v1` over the supplied ordered price observations.
The first seed is `seed_wilder_first_n`; the first recursive gap policy is
`stop_at_gap_v1`; the zero-gain/zero-loss case is
`zero_zero_unperformed_v1`. All identifiers are required request fields even
though only one value is implemented, so the plugin does not silently select
them.

The LLM selects the exact input projection—normally `close`, but the plugin
does not infer or enforce a professional field preference.

### `atr`

Calculates only `atr_wilder_v1` from ordered high/low/close fact triples. The
first true-range convention is `tr_first_hl_v1`, the seed is
`seed_wilder_tr_mean_v1`, and the recursive gap policy is `stop_at_gap_v1`.
Each identifier is explicit in the request and result. True range,
high-minus-low, high-minus-previous-close, and low-minus-previous-close remain
visible in intermediate output.

### `compare_series_returns`

Verifies one content-bound `cn`, `hk`, or `us` multi-series acquisition handoff
and calculates latest-session, five-session, and requested-window relative
returns. It makes no network request and does not choose the provider,
universe, identities, or series. Its mechanical ordering covers only the exact
receipt-bound inputs and is not a market-completeness claim or recommendation.

## Shared immutable request

The three indicator tools accept exactly one input mode. The normal host path
uses `seriesReceipt` plus `calculation` and `projection`, omitting `context` and
`observations`/`bars`. The shell resolves only a matching, content-verified
OHLCV handoff on the active session. An external series with no host handoff
instead supplies the following complete context and observations; there are no
ambient defaults:

- optional `instructionRef`: a retained caller/LLM SHA-256 reference when one
  already exists. Ordinary history-to-indicator handoffs omit it; the plugin
  deterministically derives and labels a reference from the canonical request,
  so the LLM must not run a script merely to create this field;
- `track`: exactly `cn`, `hk`, or `us`;
- `instrumentId`, `mic`, `timezone`, and inclusive `dateStart`/`dateEnd`;
- `sourceProvider`, `sourceReference`, `acquisitionReceipt`, and the source's
  `retrievalTimeUnixMilliseconds`;
- optional `sourceCutoffUnixMilliseconds` when the caller has one;
- `inputField` and an explicit known or unknown `inputUnit` fact;
- an explicit input basis: raw, split-adjusted, dividend-adjusted,
  total-return, provider-defined, or an LLM-requested projection, with the
  applicable label, instruction reference, and factor evidence roots. Raw,
  split-adjusted, dividend-adjusted, and total-return inputs omit `label` and
  `instructionRef` entirely rather than sending nulls; provider-defined uses a
  label only, while an LLM projection requires both;
- raw-basis `evidenceRoots` copied from an upstream history handoff are accepted
  and promoted to context evidence rather than rejected or treated as adjustment
  factors;
- retained alternatives, gap facts, and evidence roots, including explicit
  empty lists;
- one named formula variant, period, window, and applicable seed/gap/true-range
  conventions;
- `parseablePolicy`: include or exclude exact parseable values that carry
  failed mechanical checks;
- `roundingMode`, `outputScale`, `intermediateScale`, and the first supported
  `per_step` rounding policy. Matching `policy`, `outputScale`, and
  `intermediateScale` aliases repeated beside the canonical `rounding` object
  are accepted for LLM handoff compatibility; a conflict fails closed;
- `projection`: `compact` or `intermediate`, plus a one-based `priorOffset`
  from one to 2,000 (`1` selects the newest calculated value; zero is invalid);
  and
- one to 2,000 ascending, non-duplicated dated input observations.

Each numeric fact preserves one of these states:

- known exact source lexeme;
- parseable exact lexeme with named failed mechanical checks;
- unknown with reason;
- not obtained with reason;
- decode failure with exact raw text and reason; or
- conflicting alternatives, each retaining its exact lexeme and source
  reference.

The shell validates that the request can be represented by the existing core.
It reports malformed or unsupported requests without substituting another
operation. It does not decide whether a parseable value, unknown unit, gap, or
conflict is professionally acceptable.

## Result projections

Both projections return a versioned plugin result with:

- calculation/formula identifiers and every explicit policy identifier;
- track, instrument, MIC, input field, input unit, and adjustment basis;
- request-receipt and semantic-receipt SHA-256 handles;
- input, calculated-output, unperformed-output, unknown, conflict,
  decode-failure, and failed-mechanical-check counts;
- the first calculated date when one exists;
- neutral available operations;
- `decisionOwner: "llm"` and an empty `pluginDecisionFields` list; and
- limitations that distinguish faithful calculation/content binding from
  source correctness or provider authentication.

`compact` additionally returns only the explicitly requested latest and prior
calculated values. It omits the full receipt envelopes—which duplicate bounded
inputs and outputs—from the model-visible response while retaining their exact
content-hash handles. It does not add change, percentage change, crossover, or
other derived relations. The concise first content line is the default TUI
render; a second structured content line supplies these exact values to the LLM
rather than hiding them only in Pi's retained `details` object.

`intermediate` additionally returns every ordered calculated or unperformed
output exposed by `finance_indicators`, including exact intermediate values and
missing operands, plus the copyable canonical request and semantic receipt
envelopes. It is bounded by the input limit and never silently truncates.

If no calculated value exists, the corresponding compact slot is an explicit
`not_applicable` fact. A prior offset is counted over calculated outputs, not
civil dates or unavailable output slots, and that rule is visible in the
result.

## Architecture

```text
untrusted Pi/DSH parameters
          │
          ▼
typed boundary decoder
          │
          ├── short receipt ──► active-session handoff decode + SHA-256 verify
          │
          ▼
pure stock_technicals request preparation/rendering
          │
          ▼
finance_indicators SMA / Wilder RSI / Wilder ATR
          │
          ▼
Pi text + structured result
```

- `pi_sparkles_stock_technicals.gleam` is the thin Pi/Promise registration
  shell.
- `pi_sparkles_stock_technicals/decode.gleam` decodes untrusted tool values
  into immutable boundary values.
- `pi_sparkles_stock_technicals/handoff.gleam` resolves only the invoking
  session's versioned OHLCV entry, verifies its canonical receipt, and projects
  exact close or high/low/close facts into the existing typed request.
- `pi_sparkles_stock_technicals/domain.gleam` converts those values into exact
  `finance_indicators` requests/inputs, invokes the pure calculation, and
  renders deterministic projections.
- The domain and indicator core perform no network, filesystem, environment,
  clock, randomness, storage, entitlement, or mutable-cache effects. The thin
  host shell has one read-only active-session lookup for receipt input.
- The package imports the provider-neutral `finance_indicators` core and never
  imports track-owned CN, HK, or US packages. A call carries exactly one
  explicit track leg.

## Lifecycle, scorecard, and stop point

The package moved from **Designing** to **Experimental** on 2026-08-07 after
the verification below passed.

| Scorecard field | Experimental slice |
| --- | --- |
| `professional_tasks_enabled` | Request exact SMA, Wilder RSI, and Wilder ATR facts with compact/intermediate inspection |
| `personas_served` | Shared: day, swing, investor, and quant workflow lenses |
| `provider_backed` | False; consumes caller/LLM-supplied exact observations and source receipts |
| `track_coverage` | Explicit `cn`, `hk`, and `us`, one independently labelled leg per call |
| `shell_depth` | Thin |
| `durable_state` | False; deterministic stateless replay by immutable request |
| `effect_risk` | None beyond Pi result delivery |
| `source_dependency` | None; no acquisition or provider selection |
| `gate_dependency` | Resolved (`CG-TECH`, Sessions 12 and 17) |
| `last_tutor_run` | None for this shell; Session 17 explicitly says a real tutor run is not warranted |

The first slice stops after the three stateless tools, one formula/window/seed/
recursive-gap/rounding-policy path per indicator, and compact plus intermediate
projections. It does not add EMA/MACD, Bollinger, KD, VWAP, volume relations,
support/resistance, trend/regime, pattern detection, crossovers, imputation,
batching, caching, persistent handles, provider acquisition, charts, screens,
alerts, or trade planning.

Later technical depth requires a concrete Session 17 trigger, such as multiple
professional workflows needing the same missing calculation or the LLM
receiving too much raw material. A general wish for more variants or repeated
correctness verification is not a trigger.

## Verification evidence

Six focused pure tests cover:

- explicit policy decoding with no defaults or unsupported fallback;
- SMA compact latest/prior projection and intermediate sums;
- Wilder RSI seed, recursive values, and warm-up omissions;
- Wilder ATR seed, recursive values, and true-range components;
- unknown, conflict, decode-failure, and failed-check preservation;
- ascending-date/range/input-bound failures;
- deterministic request and semantic receipt hashes;
- compact/intermediate hash identity for equal semantic requests; and
- absence of interpretation, rank, recommendation, correctness, readiness,
  and plugin-next-action fields.

Two bundled boundary scenarios exercise all three tools, both projections,
missing-policy rejection, and the compact→intermediate professional interaction
while proving equal semantic receipt handles. Artifact export registration,
warnings-as-errors builds, architecture/redaction checks, and installed-Pi smoke
loading pass. The full `bun run test` repository regression passed on
2026-08-07, including 112 binding/artifact tests and the unchanged
177-assertion swing acceptance lane.

Session 17 does not require a real tutor-LLM run for this thin calculation shell
because it adds neither a new professional workflow nor a three-plugin handoff,
provider adapter, persistent effect, or external mutation.
