# finance_charts

Status: **Experimental** · version: `0.1.0` · target: JavaScript/Bun

`pi_sparkles_finance_charts` renders one bounded, responsive colored Unicode
terminal view from exact active-session OHLCV and indicator receipts, or from
complete caller-supplied bars and points when no receipt exists. The same
result always includes a compact `finance_table`
Markdown fallback and every exact input row in structured details.

## First slice

`chart_ohlcv` accepts 1–240 completed-daily bars, up to four indicator series,
and up to 240 trade markers. Price overlays must use the price unit. Lower-panel
indicators with unlike exact units render in separate panes. Warm-up and unperformed indicator
points, market gaps, unmatched trade dates, source cutoff, adjustment basis,
entitlement, and fallback omissions remain visible.

The plugin validates exact `cn`/`hk`/`us` track, MIC, and timezone combinations;
strictly increasing unique Gregorian dates; exact decimal lexemes; OHLC and
non-negative volume invariants; receipt hashes; units; indicator dates; and
trade identifiers. It performs no fetching, indicator calculation, adjustment,
interpolation, ranking, signal interpretation, or trade decision.
Entitlement and limitation values are canonical lowercase identifiers containing
only `a-z`, `0-9`, and underscore. A `raw`, `split_adjusted`,
`dividend_adjusted`, or `total_return_adjusted` basis uses a null adjustment
label. `provider_adjusted` and `provider_defined` require an exact provider
basis label; `provider_defined` preserves a source whose adjustment semantics
remain unknown and does not imply that its bars are raw or adjusted.

The normal Pi call passes `seriesReceipt`, `maximumBars`, and optional
`indicatorReceipts` returned as `chartHandoffReceipt` by SMA, RSI, or ATR. The
shell resolves only matching entries on the active session, rehashes their
content, and proves every indicator belongs to the selected OHLCV series. The
model does not copy bars or ordered indicator points into `chart_ohlcv`, which
keeps a 60- or 240-session chart request small enough to execute reliably.
Empty `trades`, `gaps`, and `inputOmissions` may be omitted;
`fallbackMaximumRows` also may be omitted and defaults to 50 independently of
`maximumBars`.

## Rendering boundary

Pure Gleam code validates inputs and produces renderer-neutral structured
details. Pi's effect shell registers a native result component whose
`render(width)` method selects the latest contiguous suffix at one terminal
column per bar. Widening the pane reveals earlier bars; it never downsamples,
aggregates, interpolates, changes interval, or infers gaps.

The Unicode chart is ordinary inline tool output, not an overlay, image, file,
or attachment. It uses Pi's active theme for track-aware candle colors,
one-column `│` wicks and eighth-row `▁`…`█` candle bodies with a connected
zero-width vertical overlay, five useful price ticks, proportional
three-row `▁`…`█` volume across 24 eighth-row heights, and unit-separated lower-indicator panes. Exact decimal strings and source
facts in structured details remain controlling; terminal coordinates are not
a new observation, analytics result, or evidence claim. DSH consumes the same
validated result but owns a separate inline browser renderer described in
[`../../CHARTS.md`](../../CHARTS.md).

## Verification

Twelve pure domain tests cover track, chronology, OHLC, units, gaps, omissions,
warm-up, unmatched trades, flat ranges, cutoff, and deterministic structured
behavior. Bundled scenarios verify text-only results, exact details,
width-bounded/latest-suffix Unicode, proportional low volume, independent RSI/ATR
panes, CN/HK/US theme palettes, expanded fallback, failures, and cancellation.
The current focused package and binding lanes pass; tier maturity
still follows the normative tier gate rather than this package-level evidence.
