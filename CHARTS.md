# OHLCV chart design

## Scope and invariants

`chart_ohlcv` is a view over exact completed-daily OHLCV evidence. The normal
host path resolves a content-verified `seriesReceipt` from the active session;
external callers may instead provide the complete context and bars. It does
not fetch data, select a provider, infer missing sessions,
calculate indicators, aggregate bars, rank securities, or make a trading
decision. The existing Gleam decoder and pure domain validation remain the
controlling contract for both hosts. Exact decimal strings, receipts, market
identity, source context, omissions, and the structured fallback remain in the
tool result; host renderers may convert decimal strings to finite JavaScript
numbers only for screen coordinates.

The two renderers are deliberately host-exclusive:

- Pi renders a colored Unicode chart in the normal inline tool-result component.
- DeepSeek Harness (DSH) renders interactive browser charts in a floating
  vertical stack above the finance status bar.

DSH uses its native `shell.overlay`; Pi retains its terminal result component.
Neither creates image blocks, attachments, data URLs, temporary chart files or
downloads. Both retain exact text and structured evidence in ordinary results.

## Shared result contract

Successful validation returns ordinary text content and
`pi-sparkles/finance-chart-result` structured details. The details retain all
validated bars and supplied annotations, even when a renderer shows only a
suffix. The result also declares a renderer-neutral presentation policy:

- presentation kind: `responsive_ohlcv_view`;
- time order: ascending input order;
- initial range anchor: latest bar;
- span rule: available plot width divided by a fixed host slot width;
- no downsampling, interpolation, bar aggregation, or inferred gaps;
- explicitly supplied gap records are the only gap annotations;
- exact structured details are controlling, not screen coordinates.

The text content is the durable LLM and accessibility fallback. It includes a
summary plus the bounded `finance_table` rendering; truncating that table never
truncates `details.bars`.

History tools persist a versioned OHLCV handoff on the active session. SMA,
RSI, and ATR persist separate content-bound chart handoffs containing their
ordered outputs. A normal chart request therefore contains only
`seriesReceipt`, `maximumBars`, and up to four `indicatorReceipts`. Empty trade,
gap, and omission annotations may be omitted. The text fallback row cap may
also be omitted and defaults to 50; it is independent of `maximumBars`. The
chart shell resolves and rehashes those entries, checks that every indicator
belongs to the same series, and never asks the model to copy bars or points.
Direct caller-supplied arrays remain available only for external evidence that
has no active-session handoff.

## Pi terminal renderer

Pi registers a custom `renderResult` component through the shared Gleam
binding. Pi calls the component's `render(width)` method with the current tool
result width and rerenders it when terminal layout changes. The renderer never
reads ambient `stdout.columns`, so split panes and nested layouts receive the
correct width.

For a usable chart, the component first reserves a four-column safety margin
for Pi's surrounding tool-result layout, then reserves a price-axis gutter and
assigns one terminal column per bar. The visible capacity is:

```text
max(1, floor(width - safety_margin - axis_gutter))
```

The initial visible range is the latest contiguous suffix with that capacity.
A wider component therefore shows a monotonic superset extending earlier in
time. It never changes the interval or synthesizes observations. The header
always reports the exact visible start/end dates, `shown/total`, and the count
of earlier hidden bars.

The compact chart uses one-column terminal geometry: `│` wicks, proportional
`▁` through `█` candle bodies at eighth-row precision, and `━` for an exact
doji. This retains small open/close differences that would collapse when both
endpoints quantize to the same whole row. A zero-width Unicode vertical overlay
keeps the wick connected through fractional body cells without widening the
chart or switching to Braille. Price labels appear only at five
useful ticks instead of on every row. Volume occupies an independent three-row panel and uses all 24
linear eighth-row heights from `▁` through `█`; zero remains blank, while the
smallest nonzero projection is `▁`, never a dot, circle, or underscore. Price
overlays never erase candle bodies. Lower
indicators are grouped into independent panes by exact unit, so RSI and ATR do
not share a scale. `B`/`S` mark trades and `┊` marks supplied gaps. Pi's active
theme supplies every color; no raw ANSI palette is embedded. Mainland China
maps rising/falling candles and volume to red/green, while Hong Kong and the
United States map them to green/red. Half-day volume and buy markers use the
accent role, and sell/gap markers use the warning role. The hosts retain their
own presentation implementations.

Price and volume coordinates are display projections only. If the available
width cannot safely hold an axis and a bar, the component emits a one-line
summary instead. Expanded mode adds the exact text/table fallback below the
responsive chart. Every emitted line is Unicode-visible-width clipped inside
the safety margin.

Cancellation is checked before validation. Rendering itself is synchronous and
bounded by the validated limits (240 bars, four indicators, 240 trades, and
240 gaps).

## DSH browser renderer

DSH does not invoke or emulate Pi's TUI renderer. The DSH tool bridge
recognizes the exact chart-result schema and uses DSH's native
`output.presentationMeta` hook to persist a JSON-safe chart projection in the
settled `tool/result` event. Other tools are unchanged. Pi-only image blocks are
not produced and are not translated to DSH attachments.

The registered `piSparklesCharts` session projection folds settled `tool/result`
and `tool/ptc-dispatch` metadata independently of the transcript's disclosure or
virtualization state. It retains the latest 12 charts, each under the existing
512 KiB metadata budget, with a stable call identity. The browser reads only the
main-view session's projection. Replay reconstructs the stack from the log;
one session cannot supply another session's live charts.

The existing finance `shell.overlay` owns one bottom/right anchored group:
chart cards in chronological order above the status bar. Cards use normal
vertical flex flow and measure 1.5 times the status-bar width, capped to the
available screen width. They use a gap and no absolute positioning. The status
bar is the floor. Hiding a middle card closes its gap, moving cards above down while
those below remain in place. The bar's pointer and keyboard drag controls move
the entire group; chart pan/zoom and visibility controls do not initiate a drag.
Tall stacks scroll within the available space above the bar.

Each card has a Hide button. The Charts control above the bar exposes a
separate checkbox for each retained chart, including hidden ones. Visibility
is browser-local, keyed by session and call identity, and resets on page reload.
The keyed `tool.call.toolview` contribution retains the exact text output and
points to the floating panel; collapsing it cannot hide a floating chart. Older
results beyond the 12-card panel budget retain their exact transcript output.
The compact tool notice is shown only when the exact call is in the projection.
If an older running server lacks that projection, or the call is outside the
retained history, the tool view keeps a real inline chart and exact fallback.
Restart the DSH server after package updates; refreshing the browser alone does
not reload server plugins or projections.

The card opens each result at its full returned range, so replacing a 60-bar
result with a 240-bar result immediately expands the x-axis to all 240 bars.
The SVG scales responsively with its container. Pointer/keyboard pan or zoom
may select a smaller contiguous window for detail; a Reset control restores the
full returned range. Manual view state is bound to the result's instrument and
date range, so it cannot leak into a later result. A renderer failure leaves
the exact textual tool output available.

The browser view uses semantic HTML/SVG owned by the DSH client entrypoint. It
shows candlesticks, volume, supplied price overlays, trade markers, and explicit
gap annotations. Lower indicators are stacked into independent SVG panes by
exact unit, leaving the existing single-pane layout unchanged when all lower
series share a unit. Tool-result metadata is byte-bounded, schema checked, and
contains no credentials beyond the already-approved structured result fields.

Direction colors follow the chart's validated market track in both hosts. Mainland China
(`cn`) uses red for an up candle and green for a down candle. Hong Kong (`hk`)
and the United States (`us`) use green for an up candle and red for a down
candle. Flat candles remain neutral gray, and each host's inline legend is
generated from the same track palette as its marks.

## Lifecycle, packaging, and compatibility

The Pi distribution owns the terminal renderer. The DSH distribution owns the
adapter metadata hook and browser client entrypoint and declares the
exact `@deepseek-ai/dsh-client-ui-tool` peer/injection used for the keyed slot.
Chart delivery does not change `tiers.json` or imply DSH maturity from Pi tier
status. Any material DSH client change requires the independent DSH focused
tests, installed runtime smoke, and visual browser QA before the DSH release
gate can return to ProductUseful.

The structured schema is versioned. A client must reject an unknown schema or
non-finite projection input and allow the normal textual result to render.
Forward-compatible additions may add annotation kinds; changing exact evidence
semantics, span anchoring, or truncation behavior requires a schema-version
change.

## Verification matrix

Pure Gleam tests prove validation, exact-value retention, market isolation,
chronology, gaps, omissions, and deterministic structured results. Pi binding
tests prove no image output, custom component registration, width-bounded
Unicode, CN/HK/US theme palettes, monotonic visible capacity, latest-suffix
anchoring, expanded fallback, and cancellation. DSH tests prove presentation metadata is added only for the exact
chart schema, keyed slot registration, full-range initial rendering, result-bound
pan/zoom state, malformed-metadata fallback, vertical stacking with a fixed floor,
middle-card removal, individual hide/show, session isolation, and client
discovery/package locking, including independent RSI/ATR panes. Installed DSH
verification executes a representative chart call, drives the registered
projection with native and nested result events, and proves fresh-session
replay. Local DSH visual review, the 1.5× width adjustment and the 2026-10-18
release instruction complete this floating panel's manual acceptance.
