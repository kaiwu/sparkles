// Source for the DSH browser half. The bundler wraps this factory in DSH's
// closure module protocol and ships it as client.js beside the host plugin.

export function dshClientFactorySource(packageName) {
  return `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageName)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var React = require("react");
var TRACK_STATUS_KEY = "finance-track";
var OVERLAY_PADDING = 8;
function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}
function overlayBounds(node) {
  var parent = node.offsetParent;
  if (parent && typeof parent.getBoundingClientRect === "function") {
    var rect = parent.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}
function clampedPosition(node, left, top, bounds) {
  var rect = node.getBoundingClientRect();
  return {
    left: clamp(left, OVERLAY_PADDING, bounds.width - rect.width - OVERLAY_PADDING),
    top: clamp(top, OVERLAY_PADDING, bounds.height - rect.height - OVERLAY_PADDING)
  };
}
function currentSessionId(state) {
  var sessions = Object.values(state && state.byId ? state.byId : {});
  for (var i = 0; i < sessions.length; i += 1) {
    var session = sessions[i];
    if (session && session.retainedBy && (session.retainedBy.mainView || 0) > 0) {
      return session.id;
    }
  }
  return undefined;
}
function trackStatusText(state) {
  var current = currentSessionId(state);
  if (current === undefined) return undefined;
  var snapshot = state.projectionsBySession && state.projectionsBySession[current];
  var view = snapshot && snapshot.values && snapshot.values.piSparklesStatus;
  if (view && view.values && typeof view.values[TRACK_STATUS_KEY] === "string") {
    return view.values[TRACK_STATUS_KEY];
  }
  var summary = state.byId[current];
  var legacy = summary && summary.projectionValues && summary.projectionValues.piSparklesStatus;
  return legacy && legacy.values && typeof legacy.values[TRACK_STATUS_KEY] === "string"
    ? legacy.values[TRACK_STATUS_KEY]
    : undefined;
}
function FinanceTrackOverlay(props) {
  var text = props.useSessions(trackStatusText);
  var positionState = React.useState(null);
  var position = positionState[0];
  var setPosition = positionState[1];
  var draggingState = React.useState(false);
  var dragging = draggingState[0];
  var setDragging = draggingState[1];
  var drag = React.useRef(null);
  if (typeof text !== "string" || text.length === 0) return null;
  function onPointerDown(event) {
    if (event.button !== 0) return;
    var node = event.currentTarget;
    var rect = node.getBoundingClientRect();
    var bounds = overlayBounds(node);
    drag.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      left: rect.left - bounds.left,
      top: rect.top - bounds.top,
      bounds: bounds
    };
    if (typeof node.setPointerCapture === "function") {
      node.setPointerCapture(event.pointerId);
    }
    setDragging(true);
    event.preventDefault();
  }
  function onPointerMove(event) {
    var active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    var node = event.currentTarget;
    setPosition(clampedPosition(
      node,
      active.left + event.clientX - active.clientX,
      active.top + event.clientY - active.clientY,
      active.bounds
    ));
    event.preventDefault();
  }
  function finishPointer(event) {
    var active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    var node = event.currentTarget;
    if (
      typeof node.hasPointerCapture === "function" &&
      node.hasPointerCapture(event.pointerId) &&
      typeof node.releasePointerCapture === "function"
    ) {
      node.releasePointerCapture(event.pointerId);
    }
  }
  function losePointer(event) {
    var active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  }
  function onKeyDown(event) {
    if (event.key === "Home") {
      setPosition(null);
      event.preventDefault();
      return;
    }
    var delta = event.shiftKey ? 32 : 8;
    var dx = event.key === "ArrowLeft" ? -delta : event.key === "ArrowRight" ? delta : 0;
    var dy = event.key === "ArrowUp" ? -delta : event.key === "ArrowDown" ? delta : 0;
    if (dx === 0 && dy === 0) return;
    var node = event.currentTarget;
    var rect = node.getBoundingClientRect();
    var bounds = overlayBounds(node);
    setPosition(clampedPosition(
      node,
      rect.left - bounds.left + dx,
      rect.top - bounds.top + dy,
      bounds
    ));
    event.preventDefault();
  }
  var style = {
    position: "absolute",
    right: "16px",
    bottom: "16px",
    maxWidth: "calc(100vw - 32px)",
    padding: "6px 10px",
    borderRadius: "999px",
    border: "1px solid var(--dsw-alias-border-l2)",
    background: "var(--dsw-alias-bg-base)",
    color: "var(--dsw-alias-text-primary)",
    boxShadow: "0 4px 18px rgba(0, 0, 0, 0.16)",
    fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)",
    fontSize: "12px",
    lineHeight: "18px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    cursor: dragging ? "grabbing" : "grab",
    touchAction: "none",
    userSelect: "none"
  };
  if (position !== null) {
    style.left = position.left + "px";
    style.top = position.top + "px";
    style.right = "auto";
    style.bottom = "auto";
  }
  return React.createElement("div", {
    role: "status",
    "aria-label": "Active finance track. Drag or use arrow keys to move; press Home to reset.",
    "data-dsh-sparkles-overlay": "finance-track",
    "data-dragging": dragging ? "true" : "false",
    tabIndex: 0,
    title: "Drag to move · Arrow keys move · Double-click or Home resets",
    onPointerDown: onPointerDown,
    onPointerMove: onPointerMove,
    onPointerUp: finishPointer,
    onPointerCancel: finishPointer,
    onLostPointerCapture: losePointer,
    onDoubleClick: function () { setPosition(null); },
    onKeyDown: onKeyDown,
    style: style
  }, text);
}
var CHART_META_SCHEMA = "pi-sparkles/dsh-finance-chart-meta";
var CHART_PRICE_GUTTER = 72;
var CHART_UP_COLOR = "#20b486";
var CHART_DOWN_COLOR = "#ef5b5b";
var CHART_FLAT_COLOR = "#94a3b8";
function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function chartModel(block) {
  var meta = block && block.kind === "tool-result" ? block.meta : null;
  if (!record(meta) || meta.schema !== CHART_META_SCHEMA || meta.schemaVersion !== 1 || meta.valid !== true) {
    return null;
  }
  var chart = meta.chart;
  if (!record(chart) || !Array.isArray(chart.bars) || chart.bars.length === 0) return null;
  var bars = [];
  for (var index = 0; index < chart.bars.length; index += 1) {
    var source = chart.bars[index];
    var open = Number(source && source.open);
    var high = Number(source && source.high);
    var low = Number(source && source.low);
    var close = Number(source && source.close);
    var volume = Number(source && source.volume);
    if (
      !source || typeof source.date !== "string" ||
      !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) ||
      !Number.isFinite(close) || !Number.isFinite(volume)
    ) return null;
    bars.push(Object.assign({}, source, { open: open, high: high, low: low, close: close, volume: volume }));
  }
  return Object.assign({}, chart, { bars: bars });
}
function blockText(block) {
  if (!block || !Array.isArray(block.content)) return "";
  return block.content
    .filter(function (item) { return item && item.type === "text" && typeof item.text === "string"; })
    .map(function (item) { return item.text; })
    .join("\\n");
}
function chartNumber(value) {
  var absolute = Math.abs(value);
  if (absolute !== 0 && (absolute >= 10000000 || absolute < 0.0001)) return value.toExponential(2);
  return value.toFixed(absolute >= 1000 ? 0 : absolute >= 10 ? 2 : 4);
}
function chartDirectionPalette(track) {
  if (track === "cn") {
    return {
      up: CHART_DOWN_COLOR,
      down: CHART_UP_COLOR,
      legend: "red up · green down · gray flat"
    };
  }
  return {
    up: CHART_UP_COLOR,
    down: CHART_DOWN_COLOR,
    legend: "green up · red down · gray flat"
  };
}
function DshFinanceChart(props) {
  var block = props.block;
  var model = chartModel(block);
  var ref = React.useRef(null);
  var manualState = React.useState(null);
  var manual = manualState[0];
  var setManual = manualState[1];
  if (block && block.kind !== "tool-result") {
    return React.createElement("div", {
      role: "status",
      "data-dsh-sparkles-chart": "running",
      style: { padding: "8px 10px", color: "var(--dsw-alias-text-secondary)" }
    }, "Rendering OHLCV chart…");
  }
  if (model === null) {
    return React.createElement("div", {
      role: "group",
      "data-dsh-sparkles-chart": "fallback",
      style: { padding: "8px 10px", whiteSpace: "pre-wrap", fontFamily: "var(--dsw-font-mono, ui-monospace, monospace)" }
    }, blockText(block) || "Chart metadata is unavailable.");
  }
  var rangeKey = JSON.stringify([model.instrumentId, model.bars.length, model.bars[0].date, model.bars[model.bars.length - 1].date]);
  var activeManual = manual !== null && manual.rangeKey === rangeKey ? manual : null;
  var count = activeManual === null ? model.bars.length : Math.max(1, Math.min(model.bars.length, activeManual.count));
  var end = activeManual === null ? model.bars.length : Math.max(count, Math.min(model.bars.length, activeManual.end));
  var start = Math.max(0, end - count);
  var visible = model.bars.slice(start, end);
  var directionPalette = chartDirectionPalette(model.track);
  var svgWidth = 900;
  var priceTop = 18;
  var priceBottom = 190;
  var volumeTop = 210;
  var volumeBottom = 260;
  var priceValues = [];
  visible.forEach(function (bar) { priceValues.push(bar.low, bar.high); });
  var visibleDates = new Map(visible.map(function (bar, index) { return [bar.date, index]; }));
  var overlaySeries = (model.indicators || []).filter(function (indicator) { return indicator && indicator.panel === "price_overlay"; });
  var lowerSeries = (model.indicators || []).filter(function (indicator) { return indicator && indicator.panel === "lower_panel"; });
  overlaySeries.forEach(function (indicator) {
    (indicator.points || []).forEach(function (point) {
      var value = Number(point && point.value);
      if (point && point.state === "calculated" && visibleDates.has(point.date) && Number.isFinite(value)) priceValues.push(value);
    });
  });
  var minimum = Math.min.apply(Math, priceValues);
  var maximum = Math.max.apply(Math, priceValues);
  function x(index) { return CHART_PRICE_GUTTER + (index + 0.5) * (svgWidth - CHART_PRICE_GUTTER - 8) / visible.length; }
  function y(value) {
    if (maximum === minimum) return (priceTop + priceBottom) / 2;
    return priceTop + (maximum - value) * (priceBottom - priceTop) / (maximum - minimum);
  }
  var candleWidth = Math.max(2, Math.min(12, (svgWidth - CHART_PRICE_GUTTER) / visible.length * 0.62));
  var maximumVolume = Math.max.apply(Math, [0].concat(visible.map(function (bar) { return bar.volume; })));
  var svgChildren = [];
  for (var grid = 0; grid < 5; grid += 1) {
    var gridY = priceTop + grid * (priceBottom - priceTop) / 4;
    var gridValue = maximum - grid * (maximum - minimum) / 4;
    svgChildren.push(React.createElement("line", { key: "grid-" + grid, x1: CHART_PRICE_GUTTER, x2: svgWidth - 8, y1: gridY, y2: gridY, stroke: "var(--dsw-alias-border-l2)", strokeWidth: 1 }));
    svgChildren.push(React.createElement("text", { key: "label-" + grid, x: CHART_PRICE_GUTTER - 6, y: gridY + 4, textAnchor: "end", fill: "var(--dsw-alias-text-secondary)", fontSize: 11 }, chartNumber(gridValue)));
  }
  visible.forEach(function (bar, index) {
    var center = x(index);
    var up = bar.close > bar.open;
    var flat = bar.close === bar.open;
    var color = flat ? CHART_FLAT_COLOR : up ? directionPalette.up : directionPalette.down;
    var bodyTop = Math.min(y(bar.open), y(bar.close));
    var bodyHeight = Math.max(1, Math.abs(y(bar.open) - y(bar.close)));
    var volumeHeight = maximumVolume === 0 ? 0 : Math.max(1, bar.volume / maximumVolume * (volumeBottom - volumeTop));
    svgChildren.push(React.createElement("line", { key: "wick-" + index, x1: center, x2: center, y1: y(bar.high), y2: y(bar.low), stroke: color, strokeWidth: 1 }));
    svgChildren.push(React.createElement("rect", { key: "body-" + index, x: center - candleWidth / 2, y: bodyTop, width: candleWidth, height: bodyHeight, fill: color }));
    svgChildren.push(React.createElement("rect", { key: "volume-" + index, x: center - candleWidth / 2, y: volumeBottom - volumeHeight, width: candleWidth, height: volumeHeight, fill: bar.sessionType === "half_day" ? "#8b5cf6" : "#486581", opacity: 0.8 }));
  });
  var indicatorColors = ["#59a5ff", "#f5b942", "#a855f7", "#14b8a6"];
  overlaySeries.forEach(function (indicator, seriesIndex) {
    var points = [];
    (indicator.points || []).forEach(function (point) {
      var index = visibleDates.get(point && point.date);
      var value = Number(point && point.value);
      if (point && point.state === "calculated" && index !== undefined && Number.isFinite(value)) points.push(x(index) + "," + y(value));
    });
    if (points.length > 0) svgChildren.push(React.createElement("polyline", { key: "indicator-" + seriesIndex, points: points.join(" "), fill: "none", stroke: indicatorColors[seriesIndex % indicatorColors.length], strokeWidth: 1.5 }));
  });
  var lowerGroupMap = new Map();
  lowerSeries.forEach(function (indicator, seriesIndex) {
    var unit = typeof indicator.unit === "string" ? indicator.unit : "unknown";
    if (!lowerGroupMap.has(unit)) lowerGroupMap.set(unit, { unit: unit, series: [], values: [] });
    var group = lowerGroupMap.get(unit);
    group.series.push({ indicator: indicator, seriesIndex: seriesIndex });
    (indicator.points || []).forEach(function (point) {
      var value = Number(point && point.value);
      if (point && point.state === "calculated" && visibleDates.has(point.date) && Number.isFinite(value)) group.values.push(value);
    });
  });
  var lowerGroups = Array.from(lowerGroupMap.values()).filter(function (group) { return group.values.length > 0; });
  var hasLower = lowerGroups.length > 0;
  lowerGroups.forEach(function (group, groupIndex) {
    var lowerTop = 280 + groupIndex * 72;
    var lowerBottom = lowerTop + 60;
    var lowerMinimum = Math.min.apply(Math, group.values);
    var lowerMaximum = Math.max.apply(Math, group.values);
    function lowerY(value) {
      if (lowerMaximum === lowerMinimum) return (lowerTop + lowerBottom) / 2;
      return lowerTop + (lowerMaximum - value) * (lowerBottom - lowerTop) / (lowerMaximum - lowerMinimum);
    }
    svgChildren.push(React.createElement("line", { key: "lower-top-" + groupIndex, x1: CHART_PRICE_GUTTER, x2: svgWidth - 8, y1: lowerTop, y2: lowerTop, stroke: "var(--dsw-alias-border-l2)", strokeWidth: 1 }));
    svgChildren.push(React.createElement("line", { key: "lower-bottom-" + groupIndex, x1: CHART_PRICE_GUTTER, x2: svgWidth - 8, y1: lowerBottom, y2: lowerBottom, stroke: "var(--dsw-alias-border-l2)", strokeWidth: 1 }));
    svgChildren.push(React.createElement("text", { key: "lower-max-" + groupIndex, x: CHART_PRICE_GUTTER - 6, y: lowerTop + 4, textAnchor: "end", fill: "var(--dsw-alias-text-secondary)", fontSize: 11 }, chartNumber(lowerMaximum)));
    svgChildren.push(React.createElement("text", { key: "lower-min-" + groupIndex, x: CHART_PRICE_GUTTER - 6, y: lowerBottom + 4, textAnchor: "end", fill: "var(--dsw-alias-text-secondary)", fontSize: 11 }, chartNumber(lowerMinimum)));
    svgChildren.push(React.createElement("text", { key: "lower-unit-" + groupIndex, x: svgWidth - 8, y: lowerTop + 12, textAnchor: "end", fill: "var(--dsw-alias-text-secondary)", fontSize: 11 }, group.unit));
    group.series.forEach(function (entry, groupSeriesIndex) {
      var indicator = entry.indicator;
      var points = [];
      (indicator.points || []).forEach(function (point) {
        var index = visibleDates.get(point && point.date);
        var value = Number(point && point.value);
        if (point && point.state === "calculated" && index !== undefined && Number.isFinite(value)) points.push(x(index) + "," + lowerY(value));
      });
      if (points.length > 0) svgChildren.push(React.createElement("polyline", { key: "lower-indicator-" + groupIndex + "-" + groupSeriesIndex, points: points.join(" "), fill: "none", stroke: indicatorColors[(entry.seriesIndex + overlaySeries.length) % indicatorColors.length], strokeWidth: 1.5 }));
    });
  });
  (model.trades || []).forEach(function (trade, tradeIndex) {
    var index = visibleDates.get(trade && trade.date);
    var price = Number(trade && trade.price);
    if (index === undefined || !Number.isFinite(price)) return;
    svgChildren.push(React.createElement("text", { key: "trade-" + tradeIndex, x: x(index), y: y(price) - 5, textAnchor: "middle", fill: trade.side === "buy" ? "#59a5ff" : "#f5b942", fontSize: 12, fontWeight: 700 }, trade.side === "buy" ? "B" : "S"));
  });
  (model.gaps || []).forEach(function (gap, gapIndex) {
    if (!gap || typeof gap.date !== "string" || gap.date < visible[0].date || gap.date > visible[visible.length - 1].date) return;
    var index = visible.findIndex(function (bar) { return bar.date >= gap.date; });
    if (index < 0) return;
    svgChildren.push(React.createElement("line", { key: "gap-" + gapIndex, x1: x(index), x2: x(index), y1: priceTop, y2: volumeBottom, stroke: "#f97316", strokeDasharray: "3 3", strokeWidth: 1.5 }));
  });
  var first = visible[0].date;
  var last = visible[visible.length - 1].date;
  function setView(nextEnd, nextCount) {
    var boundedCount = Math.max(1, Math.min(model.bars.length, nextCount));
    setManual({ rangeKey: rangeKey, count: boundedCount, end: Math.max(boundedCount, Math.min(model.bars.length, nextEnd)) });
  }
  var controls = React.createElement("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap" } },
    React.createElement("button", { type: "button", onClick: function () { setView(end - Math.max(1, Math.floor(count / 3)), count); }, disabled: start === 0, title: "Earlier bars" }, "←"),
    React.createElement("button", { type: "button", onClick: function () { setView(end + Math.max(1, Math.floor(count / 3)), count); }, disabled: end === model.bars.length, title: "Later bars" }, "→"),
    React.createElement("button", { type: "button", onClick: function () { setView(end, Math.max(1, Math.floor(count * 0.7))); }, disabled: count === 1, title: "Show fewer bars" }, "+"),
    React.createElement("button", { type: "button", onClick: function () { setView(end, Math.min(model.bars.length, Math.ceil(count * 1.4))); }, disabled: count === model.bars.length, title: "Show more bars" }, "−"),
    React.createElement("button", { type: "button", onClick: function () { setManual(null); }, disabled: activeManual === null }, "Reset")
  );
  var exactText = blockText(block);
  return React.createElement("section", {
    ref: ref,
    role: "figure",
    "aria-label": "OHLCV chart for " + model.instrumentId + " from " + first + " through " + last,
    "data-dsh-sparkles-chart": "inline",
    "data-visible-bars": String(visible.length),
    style: { margin: "4px 0", padding: "10px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-text-primary)", overflow: "hidden" }
  },
    React.createElement("header", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
      React.createElement("div", null,
        React.createElement("strong", null, model.instrumentId + " · " + model.track + "/" + model.mic),
        React.createElement("div", { style: { color: "var(--dsw-alias-text-secondary)", fontSize: "12px" } }, first + " – " + last + " · " + visible.length + "/" + model.bars.length + " bars · " + start + " earlier hidden")
      ),
      controls
    ),
    React.createElement("svg", { viewBox: "0 0 " + svgWidth + " " + (hasLower ? 356 + (lowerGroups.length - 1) * 72 : 276), width: "100%", height: hasLower ? String(356 + (lowerGroups.length - 1) * 72) : "276", preserveAspectRatio: "none", role: "img", "aria-hidden": "true", style: { display: "block", minWidth: 0 } }, svgChildren),
    React.createElement("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap", color: "var(--dsw-alias-text-secondary)", fontSize: "11px" } },
      React.createElement("span", null, directionPalette.legend + " · purple half-day volume"),
      React.createElement("span", null, "B/S supplied trade · dashed supplied gap"),
      React.createElement("span", null, model.priceUnit + " · " + model.volumeUnit),
      lowerGroups.length === 0 ? null : React.createElement("span", null, lowerGroups.map(function (group) { return group.unit; }).join(" · "))
    ),
    exactText === "" ? null : React.createElement("details", { style: { marginTop: "8px" } },
      React.createElement("summary", null, "Exact table output"),
      React.createElement("pre", { style: { overflowX: "auto", whiteSpace: "pre", fontSize: "11px" } }, exactText)
    )
  );
}
var inject = ["slots", "sessions"];
function apply(ctx) {
  ctx.slots.inject("shell.overlay", function () {
    return ctx.slots.register({
      name: "shell.overlay",
      id: "pi-sparkles-finance-track",
      order: 100,
      label: "Pi Sparkles finance track"
    }, FinanceTrackOverlay);
  });
  ctx.slots.inject("tool.call.toolview", function () {
    return ctx.slots.register({
      name: "tool.call.toolview",
      key: "chart_ohlcv",
      order: 100,
      label: "Pi Sparkles inline OHLCV chart"
    }, DshFinanceChart);
  });
}
module.exports = { inject: inject, apply: apply };
return module.exports; } });\n`;
}
