import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const AXIS_WIDTH = 10;
const SLOT_WIDTH = 1;
const PRICE_ROWS = 10;
const PRICE_SUBROW_UNITS = 8;
const VOLUME_ROWS = 3;
const MIN_CHART_WIDTH = AXIS_WIDTH + SLOT_WIDTH;
const CONTENT_MARGIN = 4;
const INDICATOR_TONES = ["accent", "warning", "thinkingText", "success"];
const WICK_OVERLAY = "\u20d2";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chartDetails(result) {
  const details = result?.details;
  return isRecord(details) &&
    details.schema === "pi-sparkles/finance-chart-result" &&
    details.schemaVersion === 2 &&
    Array.isArray(details.bars)
    ? details
    : null;
}

function resultText(result) {
  return Array.isArray(result?.content)
    ? result.content
        .filter((item) => item?.type === "text" && typeof item.text === "string")
        .map((item) => item.text)
        .join("\n")
    : "";
}

function clip(text, width) {
  if (width <= 0) return "";
  const value = String(text);
  if (visibleWidth(value) <= width) return value;
  const truncated = truncateToWidth(value, width, "");
  return value.includes("\u001b") ? truncated : truncated.replace(/\u001b\[0m$/, "");
}

function contentWidth(width) {
  const available = Number.isInteger(width) && width > 0 ? width : 80;
  return Math.max(1, available - CONTENT_MARGIN);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function axisLabel(value) {
  if (!Number.isFinite(value)) return "?";
  const absolute = Math.abs(value);
  const text =
    absolute !== 0 && (absolute >= 1e7 || absolute < 1e-4)
      ? value.toExponential(2)
      : value.toFixed(absolute >= 1000 ? 0 : absolute >= 10 ? 2 : 4);
  return text.length <= AXIS_WIDTH - 2
    ? text
    : value.toExponential(1).slice(0, AXIS_WIDTH - 2);
}

function rowFor(value, minimum, maximum, rows) {
  if (maximum === minimum) return Math.floor((rows - 1) / 2);
  return Math.max(
    0,
    Math.min(rows - 1, Math.round(((maximum - value) / (maximum - minimum)) * (rows - 1))),
  );
}

const LOWER_BLOCK_GLYPHS = [null, "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function volumeGlyph(cellRow, units, rows) {
  const unitsBelow = (rows - cellRow - 1) * 8;
  const filled = Math.max(0, Math.min(8, units - unitsBelow));
  return LOWER_BLOCK_GLYPHS[filled];
}

function candleBodyUnits(open, close, minimum, maximum) {
  if (open === close || maximum === minimum) return 0;
  return Math.max(
    1,
    Math.round(
      (Math.abs(close - open) / (maximum - minimum)) *
      (PRICE_ROWS - 1) * PRICE_SUBROW_UNITS,
    ),
  );
}

function putCandleBody(matrix, column, bottomRow, units, tone) {
  let remaining = units;
  for (let row = bottomRow; row >= 0 && remaining > 0; row -= 1) {
    const filled = Math.min(PRICE_SUBROW_UNITS, remaining);
    put(
      matrix,
      row,
      column,
      `${LOWER_BLOCK_GLYPHS[filled]}${WICK_OVERLAY}`,
      tone,
      3,
    );
    remaining -= filled;
  }
}

function cells(rows, columns) {
  return Array.from({ length: rows }, () => Array(columns).fill(null));
}

function put(matrix, row, column, glyph, tone = null, priority = 0) {
  if (
    row < 0 ||
    row >= matrix.length ||
    column < 0 ||
    column >= matrix[row].length ||
    (matrix[row][column] !== null && matrix[row][column].priority > priority)
  ) {
    return;
  }
  matrix[row][column] = { glyph, tone, priority };
}

function paint(theme, tone, text) {
  if (text === "" || tone === null || typeof theme?.fg !== "function") return text;
  return theme.fg(tone, text);
}

function renderCells(row, theme) {
  let rendered = "";
  let run = "";
  let tone = null;
  function flush() {
    rendered += paint(theme, tone, run);
    run = "";
  }
  for (const cell of row) {
    const nextTone = cell?.tone ?? null;
    if (nextTone !== tone) {
      flush();
      tone = nextTone;
    }
    run += cell?.glyph ?? " ";
  }
  flush();
  return rendered;
}

function directionPalette(track) {
  return track === "cn"
    ? { up: "error", down: "success", flat: "muted" }
    : { up: "success", down: "error", flat: "muted" };
}

function directionTone(bar, palette) {
  return bar.close > bar.open
    ? palette.up
    : bar.close < bar.open
      ? palette.down
      : palette.flat;
}

function indicatorTone(seriesIndex) {
  return INDICATOR_TONES[seriesIndex % INDICATOR_TONES.length];
}

function trendGlyph(previous, current) {
  if (previous === undefined || current.column - previous.column > 1) return "•";
  if (current.row === previous.row) return "─";
  return current.row < previous.row ? "╱" : "╲";
}

function axisTick(row, rows) {
  const ticks = new Set([
    0,
    Math.round((rows - 1) * 0.25),
    Math.round((rows - 1) * 0.5),
    Math.round((rows - 1) * 0.75),
    rows - 1,
  ]);
  return ticks.has(row);
}

function numericBars(bars) {
  const parsed = [];
  for (const bar of bars) {
    const open = finite(bar?.open);
    const high = finite(bar?.high);
    const low = finite(bar?.low);
    const close = finite(bar?.close);
    const volume = finite(bar?.volume);
    if (
      typeof bar?.date !== "string" ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      return null;
    }
    parsed.push({ ...bar, open, high, low, close, volume });
  }
  return parsed;
}

function visibleSlice(details, width) {
  const capacity = Math.max(1, Math.floor((width - AXIS_WIDTH) / SLOT_WIDTH));
  const start = Math.max(0, details.bars.length - capacity);
  return { start, bars: details.bars.slice(start), capacity };
}

function matchingPoints(details, panel, dates) {
  const points = [];
  for (const [seriesIndex, indicator] of (details.indicators ?? []).entries()) {
    if (indicator?.panel !== panel || !Array.isArray(indicator.points)) continue;
    for (const point of indicator.points) {
      if (point?.state !== "calculated" || !dates.has(point.date)) continue;
      const value = finite(point.value);
      if (value !== null) points.push({ ...point, value, seriesIndex });
    }
  }
  return points;
}

function priceChart(details, visible, plotWidth, theme, palette) {
  const matrix = cells(PRICE_ROWS, plotWidth);
  const dates = new Map(visible.map((bar, index) => [bar.date, index]));
  const overlays = matchingPoints(details, "price_overlay", dates);
  const priceValues = visible.flatMap((bar) => [bar.low, bar.high]);
  for (const point of overlays) priceValues.push(point.value);
  const minimum = Math.min(...priceValues);
  const maximum = Math.max(...priceValues);

  const previousBySeries = new Map();
  for (const point of overlays) {
    const position = {
      column: dates.get(point.date),
      row: rowFor(point.value, minimum, maximum, PRICE_ROWS),
    };
    put(
      matrix,
      position.row,
      position.column,
      trendGlyph(previousBySeries.get(point.seriesIndex), position),
      indicatorTone(point.seriesIndex),
      2,
    );
    previousBySeries.set(point.seriesIndex, position);
  }

  for (const [index, bar] of visible.entries()) {
    const x = index;
    const tone = directionTone(bar, palette);
    const high = rowFor(bar.high, minimum, maximum, PRICE_ROWS);
    const low = rowFor(bar.low, minimum, maximum, PRICE_ROWS);
    const open = rowFor(bar.open, minimum, maximum, PRICE_ROWS);
    const close = rowFor(bar.close, minimum, maximum, PRICE_ROWS);
    for (let row = Math.min(high, low); row <= Math.max(high, low); row += 1) {
      put(matrix, row, x, "│", tone, 1);
    }
    if (bar.close === bar.open) {
      put(matrix, open, x, `━${WICK_OVERLAY}`, tone, 3);
    } else {
      putCandleBody(
        matrix,
        x,
        Math.max(open, close),
        candleBodyUnits(bar.open, bar.close, minimum, maximum),
        tone,
      );
    }
  }
  for (const trade of details.trades ?? []) {
    const index = dates.get(trade?.date);
    const price = finite(trade?.price);
    if (index === undefined || price === null) continue;
    put(matrix, rowFor(price, minimum, maximum, PRICE_ROWS), index,
      trade.side === "buy" ? "B" : "S", trade.side === "buy" ? "accent" : "warning", 5);
  }

  return matrix.map((row, index) => {
    const value = maximum - ((maximum - minimum) * index) / (PRICE_ROWS - 1);
    const tick = axisTick(index, PRICE_ROWS);
    const label = tick ? axisLabel(value).padStart(AXIS_WIDTH - 2) : " ".repeat(AXIS_WIDTH - 2);
    return `${paint(theme, "dim", label)} ${paint(theme, "borderMuted", tick ? "┤" : " ")}${renderCells(row, theme)}`;
  });
}

function volumeChart(visible, plotWidth, theme, palette) {
  const matrix = cells(VOLUME_ROWS, plotWidth);
  const maximum = Math.max(0, ...visible.map((bar) => bar.volume));
  for (const [index, bar] of visible.entries()) {
    const units = maximum === 0 || bar.volume === 0
      ? 0
      : Math.max(1, Math.round((bar.volume / maximum) * VOLUME_ROWS * 8));
    const tone = bar.sessionType === "half_day"
      ? "accent"
      : directionTone(bar, palette);
    for (let row = 0; row < VOLUME_ROWS; row += 1) {
      const glyph = volumeGlyph(row, units, VOLUME_ROWS);
      if (glyph !== null) {
        put(matrix, row, index, glyph, tone, 1);
      }
    }
  }
  return matrix.map((row, index) =>
    `${paint(theme, "dim", index === 0 ? "VOL".padStart(AXIS_WIDTH - 2) : " ".repeat(AXIS_WIDTH - 2))}  ${renderCells(row, theme)}`,
  );
}

function lowerCharts(details, visible, plotWidth, theme) {
  const dates = new Map(visible.map((bar, index) => [bar.date, index]));
  const groups = new Map();
  for (const [seriesIndex, indicator] of (details.indicators ?? []).entries()) {
    if (indicator?.panel !== "lower_panel" || !Array.isArray(indicator.points)) continue;
    const unit = typeof indicator.unit === "string" ? indicator.unit : "unknown";
    if (!groups.has(unit)) groups.set(unit, { unit, series: [], points: [] });
    const group = groups.get(unit);
    group.series.push({
      label: typeof indicator.label === "string" ? indicator.label : indicator.indicatorId,
      seriesIndex,
    });
    for (const point of indicator.points) {
      if (point?.state !== "calculated" || !dates.has(point.date)) continue;
      const value = finite(point.value);
      if (value !== null) group.points.push({ ...point, value, seriesIndex });
    }
  }
  const lines = [];
  for (const group of groups.values()) {
    if (group.points.length === 0) continue;
    lines.push(lowerChart(group, dates, plotWidth, theme));
  }
  return lines.flat();
}

function lowerChart(group, dates, plotWidth, theme) {
  const rows = 4;
  const matrix = cells(rows, plotWidth);
  const minimum = Math.min(...group.points.map((point) => point.value));
  const maximum = Math.max(...group.points.map((point) => point.value));
  const previousBySeries = new Map();
  for (const point of group.points) {
    const position = {
      column: dates.get(point.date),
      row: rowFor(point.value, minimum, maximum, rows),
    };
    const tone = indicatorTone(point.seriesIndex);
    put(
      matrix,
      position.row,
      position.column,
      trendGlyph(previousBySeries.get(point.seriesIndex), position),
      tone,
      2,
    );
    previousBySeries.set(point.seriesIndex, position);
  }
  const legend = group.series.map((series) =>
    paint(theme, indicatorTone(series.seriesIndex), `─ ${series.label}`),
  ).join("  ");
  return [
    `${paint(theme, "dim", group.unit)}  ${legend}`,
    ...matrix.map((row, index) => {
      const value = maximum - ((maximum - minimum) * index) / (rows - 1);
      const tick = axisTick(index, rows);
      const label = tick
        ? axisLabel(value).padStart(AXIS_WIDTH - 2)
        : " ".repeat(AXIS_WIDTH - 2);
      return `${paint(theme, "dim", label)} ${paint(theme, "borderMuted", tick ? "┤" : " ")}${renderCells(row, theme)}`;
    }),
  ];
}

function gapLine(details, visible, plotWidth, theme) {
  const gaps = details.gaps ?? [];
  if (gaps.length === 0 || visible.length === 0) return [];
  const row = cells(1, plotWidth)[0];
  const first = visible[0].date;
  const last = visible.at(-1).date;
  for (const gap of gaps) {
    if (typeof gap?.date !== "string" || gap.date < first || gap.date > last) continue;
    let index = visible.findIndex((bar) => bar.date >= gap.date);
    if (index < 0) index = visible.length - 1;
    put([row], 0, index, "┊", "warning", 1);
  }
  return row.some((cell) => cell !== null)
    ? [`${paint(theme, "dim", "GAP".padStart(AXIS_WIDTH - 2))}  ${renderCells(row, theme)}`]
    : [];
}

function summaryLines(details, visible, hidden, theme) {
  const first = visible[0]?.date ?? "?";
  const last = visible.at(-1)?.date ?? "?";
  return [
    paint(theme, "accent", `OHLCV ${details.track}/${details.mic} ${details.instrumentId}`),
    paint(theme, "dim", `${first}..${last}`),
    paint(
      theme,
      "dim",
      `${visible.length}/${details.bars.length} bars · ${hidden} earlier hidden`,
    ),
  ];
}

function legendLines(theme, palette) {
  return [
    [
      "legend ",
      paint(theme, palette.up, "▁…█ rise"),
      "  ",
      paint(theme, palette.down, "▁…█ fall"),
      "  ",
      paint(theme, palette.flat, "█ flat"),
      "  ",
      paint(theme, "muted", "│ wick ▁…█ volume"),
    ].join(""),
    [
      "       ",
      paint(theme, "accent", "─╱╲ indicator"),
      "  ",
      paint(theme, "accent", "B"),
      "/",
      paint(theme, "warning", "S"),
      " trades  ",
      paint(theme, "warning", "┊ supplied gap"),
    ].join(""),
  ];
}

function renderChart(result, width, theme) {
  const details = chartDetails(result);
  if (details === null || details.bars.length === 0) return null;
  const safeWidth = contentWidth(width);
  if (safeWidth < MIN_CHART_WIDTH) {
    return [clip(`OHLCV ${details.track}/${details.mic} ${details.instrumentId} | ${details.bars.length} bars`, safeWidth)];
  }
  const selected = visibleSlice(details, safeWidth);
  const visible = numericBars(selected.bars);
  if (visible === null || visible.length === 0) return null;
  const plotWidth = visible.length * SLOT_WIDTH;
  const palette = directionPalette(details.track);
  const lines = [
    ...summaryLines(details, visible, selected.start, theme),
    ...priceChart(details, visible, plotWidth, theme, palette),
    "",
    ...volumeChart(visible, plotWidth, theme, palette),
    ...lowerCharts(details, visible, plotWidth, theme),
    ...gapLine(details, visible, plotWidth, theme),
    ...legendLines(theme, palette),
  ];
  return lines.map((line) => clip(line, safeWidth));
}

class FinanceChartResult {
  constructor() {
    this.result = null;
    this.expanded = false;
    this.theme = null;
  }

  setResult(result, expanded, theme) {
    if (this.result !== result || this.expanded !== expanded || this.theme !== theme) {
      this.invalidate();
    }
    this.result = result;
    this.expanded = expanded;
    this.theme = theme;
  }

  invalidate() {
    this.cachedLines = undefined;
  }

  render(width) {
    if (this.cachedLines === undefined || this.cachedWidth !== width) {
      this.cachedLines = Object.freeze(this.renderLines(width));
      this.cachedWidth = width;
    }
    return this.cachedLines;
  }

  renderLines(width) {
    const chart = renderChart(this.result, width, this.theme);
    const text = resultText(this.result);
    const safeWidth = contentWidth(width);
    if (chart === null) {
      return text === "" ? [clip("Chart result unavailable", safeWidth)] : text.split("\n").map((line) => clip(line, safeWidth));
    }
    if (!this.expanded || text === "") return chart;
    return [...chart, "", ...text.split("\n")].map((line) => clip(line, safeWidth));
  }
}

export function render_result(result, expanded, theme, lastComponent) {
  const component = lastComponent instanceof FinanceChartResult
    ? lastComponent
    : new FinanceChartResult();
  component.setResult(result, expanded === true, theme);
  return component;
}
