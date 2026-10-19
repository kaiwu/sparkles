import { describe, expect, test } from "bun:test";
import { dshClientFactorySource } from "../../dsh/client.js";
import { chartProjection, MAX_FLOATING_CHARTS } from "../../dsh/chart-projection.mjs";

function fakeReact() {
  const hooks = [];
  let cursor = 0;
  return {
    begin() {
      cursor = 0;
    },
    createElement(type, props, ...children) {
      return {
        type,
        props: props ?? {},
        children,
      };
    },
    useRef(value) {
      const index = cursor++;
      if (hooks[index] === undefined) hooks[index] = { current: value };
      return hooks[index];
    },
    useState(value) {
      const index = cursor++;
      if (hooks[index] === undefined) hooks[index] = value;
      return [
        hooks[index],
        (next) => {
          hooks[index] = typeof next === "function" ? next(hooks[index]) : next;
        },
      ];
    },
    useEffect(effect) {
      effect();
    },
  };
}

function loadChartComponent(React) {
  let loaded;
  const window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {}
      disconnect() {}
    },
    __ModuleLoader__: {
      load(definition) {
        loaded = definition.factory((name) => {
          if (name === "react") return React;
          throw new Error(`unexpected client module: ${name}`);
        });
      },
    },
  };
  new Function("window", dshClientFactorySource("@fixture/chart-client"))(window);
  const registered = new Map();
  loaded.apply({
    slots: {
      inject(_name, callback) {
        callback();
      },
      register(definition, component) {
        registered.set(`${definition.name}:${definition.key ?? ""}`, {
          definition,
          component,
        });
        return () => {};
      },
    },
  });
  const entry = registered.get("tool.call.toolview:chart_ohlcv");
  const fallback = entry.component({ block: chartBlock(1), useSessions: () => null });
  return { ...entry, component: fallback.type, toolComponent: entry.component,
    overlay: registered.get("shell.overlay:").component };
}

function chartBlock(count = 100, track = "us") {
  return {
    kind: "tool-result",
    content: [{ type: "text", text: "exact chart fallback" }],
    meta: {
      schema: "pi-sparkles/dsh-finance-chart-meta",
      schemaVersion: 1,
      valid: true,
      chart: {
        track,
        instrumentId: "US-AAPL",
        mic: "XNAS",
        timezone: "America/New_York",
        priceUnit: "USD",
        volumeUnit: "shares",
        adjustment: { kind: "raw", label: null },
        presentation: { kind: "responsive_ohlcv_view" },
        bars: Array.from({ length: count }, (_, index) => ({
          date: `D${String(index + 1).padStart(3, "0")}`,
          sessionType: "regular",
          open: String(100 + index),
          high: String(102 + index),
          low: String(99 + index),
          close: String(101 + index),
          volume: String(1000 + index * 10),
        })),
        indicators: [],
        trades: [],
        gaps: [],
        inputOmissions: [],
      },
    },
  };
}

function textContent(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join(" ");
  return textContent(node.children);
}

function findByKey(node, key) {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  if (!Array.isArray(node) && node.props?.key === key) return node;
  const children = Array.isArray(node) ? node : node.children;
  if (!Array.isArray(children)) return findByKey(children, key);
  for (const child of children) {
    const match = findByKey(child, key);
    if (match !== undefined) return match;
  }
  return undefined;
}

function findByTitle(node, title) {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  if (!Array.isArray(node) && node.props?.title === title) return node;
  const children = Array.isArray(node) ? node : node.children;
  if (!Array.isArray(children)) return findByTitle(children, title);
  for (const child of children) {
    const match = findByTitle(child, title);
    if (match !== undefined) return match;
  }
  return undefined;
}

function findByProp(node, key, value) {
  if (node === null || node === undefined || typeof node !== "object") return undefined;
  if (!Array.isArray(node) && node.props?.[key] === value) return node;
  for (const child of (Array.isArray(node) ? node : node.children) ?? []) {
    const found = findByProp(child, key, value);
    if (found) return found;
  }
}

function sessionState(sessionId, charts) {
  return {
    byId: { [sessionId]: { id: sessionId, retainedBy: { mainView: 1 } } },
    projectionsBySession: { [sessionId]: { values: {
      piSparklesStatus: { values: { "finance-track": "US · USD" } },
      piSparklesCharts: { sessionId, charts, omittedCharts: 0 },
    } } },
  };
}

describe("DSH floating chart stack", () => {
  test("projects completed native and PTC charts from the log, with replay, deduplication and bounded retention", () => {
    const projection = chartProjection();
    let state = projection.init({ id: "s1" });
    const event = (id) => ({ type: "tool/result", data: {
      message: { toolCallId: id, isError: false }, meta: chartBlock(3).meta,
    } });
    const events = [event("native"), { type: "tool/ptc-dispatch", data: {
      subCallId: "nested", name: "chart_ohlcv", isError: false, meta: chartBlock(5, "cn").meta,
    } }];
    for (const item of events) state = projection.apply(state, item);
    expect(state.charts.map((chart) => chart.id)).toEqual(["native", "nested"]);
    const replayed = JSON.parse(JSON.stringify(events)).reduce(projection.apply, projection.init({ id: "s1" }));
    expect(replayed).toEqual(state);
    expect(projection.wire.viewSchema.parse(projection.wire.view(state))).toEqual(state);
    state = projection.apply(state, event("native"));
    expect(state.charts.map((chart) => chart.id)).toEqual(["native", "nested"]);
    for (let i = 0; i < MAX_FLOATING_CHARTS; i++) state = projection.apply(state, event(`more-${i}`));
    expect(state.charts).toHaveLength(MAX_FLOATING_CHARTS);
    expect(state.omittedCharts).toBe(2);
    expect(state.charts.at(-1).id).toBe(`more-${MAX_FLOATING_CHARTS - 1}`);
    const failed = event("failed"); failed.data.message.isError = true;
    expect(projection.apply(state, failed)).toBe(state);
    const invalid = event("invalid"); invalid.data.meta.schemaVersion = 99;
    expect(projection.apply(state, invalid)).toBe(state);
    const oversized = event("oversized"); oversized.data.meta.chart.inputOmissions = ["x".repeat(600_000)];
    expect(projection.apply(state, oversized)).toBe(state);
  });

  test("stacks above a fixed floor, closes a middle gap, restores it individually and isolates session toggles", () => {
    const React = fakeReact();
    const { overlay } = loadChartComponent(React);
    const charts = ["above", "middle", "below"].map((id) => ({ id, meta: chartBlock(3).meta }));
    const render = (id = "s1", collection = charts) => {
      React.begin();
      return overlay({ useSessions: (selector) => selector(sessionState(id, collection)) });
    };
    const stack = (node) => findByProp(node, "data-dsh-sparkles-chart-stack", "true");
    const ids = (node) => stack(node)?.children[0].map((chart) => chart.props.chartId) ?? [];
    let node = render();
    expect(ids(node)).toEqual(["above", "middle", "below"]);
    expect(node.props.style).toMatchObject({ position: "absolute", bottom: "16px", right: "16px", flexDirection: "column" });
    expect(stack(node).props.style).toMatchObject({ display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto" });
    expect(node.children.at(-1).props["data-dsh-sparkles-chart-floor"]).toBe("true");
    const originalBelowKey = stack(node).children[0][2].props.key;
    stack(node).children[0][1].props.onHide();
    node = render();
    expect(ids(node)).toEqual(["above", "below"]);
    expect(stack(node).children[0][1].props.key).toBe(originalBelowKey);
    expect(node.props.style.bottom).toBe("16px");
    const checkbox = findByKey(node, "middle").children[0];
    expect(checkbox.props.checked).toBeFalse();
    checkbox.props.onChange();
    node = render();
    expect(ids(node)).toEqual(["above", "middle", "below"]);
    stack(node).children[0][1].props.onHide();
    expect(ids(render("s2"))).toEqual(["above", "middle", "below"]);
    expect(ids(render())).toEqual(["above", "below"]);
    node = render();
    for (const chart of stack(node).children[0]) chart.props.onHide();
    node = render();
    expect(stack(node)).toBeUndefined();
    expect(textContent(node)).toContain("Charts 0/3");
    expect(findByProp(node, "data-dsh-sparkles-drag-handle", "true")).toBeDefined();
    findByKey(node, "middle").children[0].props.onChange();
    expect(ids(render())).toEqual(["middle"]);
  });

  test("dragging the status bar moves one chart group and keeps its floor after removing a chart", () => {
    const React = fakeReact();
    const { overlay } = loadChartComponent(React);
    const state = sessionState("s1", ["above", "middle", "below"].map((id) => ({ id, meta: chartBlock(3).meta })));
    const render = () => { React.begin(); return overlay({ useSessions: (selector) => selector(state) }); };
    let node = render();
    const handle = findByProp(node, "data-dsh-sparkles-drag-handle", "true");
    const panel = {
      offsetParent: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 900 }) },
      getBoundingClientRect: () => ({ left: 364, top: 284, width: 900, height: 600 }),
    };
    node.props.ref.current = panel;
    const event = { button: 0, pointerId: 1, clientX: 900, clientY: 875, currentTarget: {}, preventDefault() {} };
    handle.props.onPointerDown(event);
    handle.props.onPointerMove({ ...event, clientX: 800, clientY: 775 });
    handle.props.onPointerUp(event);
    node = render();
    expect(node.props.style).toMatchObject({ right: "116px", bottom: "116px" });
    findByProp(node, "data-dsh-sparkles-chart-stack", "true").children[0][1].props.onHide();
    node = render();
    expect(node.props.style).toMatchObject({ right: "116px", bottom: "116px" });
    findByProp(node, "data-dsh-sparkles-drag-handle", "true").props.onDoubleClick();
    node = render();
    expect(node.props.style).toMatchObject({ right: "16px", bottom: "16px" });
  });

  test("ignores charts from another session and retains text without a second inline chart", () => {
    const React = fakeReact();
    const entry = loadChartComponent(React);
    const state = sessionState("s1", [{ id: "one", meta: chartBlock(3).meta }]);
    state.projectionsBySession.s1.values.piSparklesCharts.sessionId = "other";
    React.begin();
    const node = entry.overlay({ useSessions: (selector) => selector(state) });
    expect(findByProp(node, "data-dsh-sparkles-chart-stack", "true")).toBeUndefined();
    const inlineReact = fakeReact();
    const inline = loadChartComponent(inlineReact);
    inlineReact.begin();
    const output = inline.toolComponent({ block: chartBlock(3), callId: "one",
      useSessions: (selector) => selector(sessionState("s1", [{ id: "one", meta: chartBlock(3).meta }])) });
    expect(output.props["data-dsh-sparkles-chart"]).toBe("tool-output");
    expect(textContent(output)).toContain("exact chart fallback");
    expect(textContent(output)).toContain("above the finance status bar");
  });

  test("keeps an inline chart when an old server has no floating projection or the exact call is not retained", () => {
    const React = fakeReact();
    const entry = loadChartComponent(React);
    const state = sessionState("s1", []);
    delete state.projectionsBySession.s1.values.piSparklesCharts;
    const missing = entry.toolComponent({ block: chartBlock(3), callId: "missing",
      useSessions: (selector) => selector(state) });
    expect(missing.type).toBe(entry.component);
    expect(missing.props.notice).toContain("restart DSH");
    React.begin();
    const fallback = missing.type(missing.props);
    expect(fallback.props["data-dsh-sparkles-chart"]).toBe("inline");
    expect(fallback.children.some((child) => child?.type === "svg")).toBeTrue();
    expect(textContent(fallback)).not.toContain("Chart available above");
    const expired = entry.toolComponent({ block: chartBlock(3), callId: "expired",
      useSessions: (selector) => selector(sessionState("s1", [{ id: "different", meta: chartBlock(3).meta }])) });
    expect(expired.type).toBe(entry.component);
    expect(expired.props.notice).toContain("not in the floating panel");
  });
});

describe("DSH floating finance chart client", () => {
  test("registers the exact keyed tool view and opens each result at its full returned range", () => {
    const React = fakeReact();
    const entry = loadChartComponent(React);
    expect(entry.definition).toMatchObject({
      name: "tool.call.toolview",
      key: "chart_ohlcv",
      label: "Pi Sparkles chart output",
    });

    React.begin();
    let rendered = entry.component({ floating: true, block: chartBlock() });
    expect(rendered.type).toBe("section");
    expect(rendered.props).toMatchObject({
      role: "figure",
      "data-dsh-sparkles-chart": "floating",
      "data-visible-bars": "100",
    });
    expect(rendered.props["aria-label"]).toContain("D001 through D100");
    expect(textContent(rendered)).toContain("100/100 bars");
    expect(textContent(rendered)).toContain("Exact table output");

    findByTitle(rendered, "Show fewer bars").props.onClick();
    React.begin();
    rendered = entry.component({ floating: true, block: chartBlock() });
    expect(rendered.props["data-visible-bars"]).toBe("70");
    expect(rendered.props["aria-label"]).toContain("D031 through D100");

    React.begin();
    rendered = entry.component({ floating: true, block: chartBlock(240) });
    expect(rendered.props["data-visible-bars"]).toBe("240");
    expect(rendered.props["aria-label"]).toContain("D001 through D240");
    expect(textContent(rendered)).toContain("240/240 bars");
  });

  test("keeps malformed metadata inline as ordinary text output", () => {
    const React = fakeReact();
    const entry = loadChartComponent(React);
    React.begin();
    const rendered = entry.component({
      block: {
        kind: "tool-result",
        content: [{ type: "text", text: "safe exact fallback" }],
        meta: { schema: "unknown" },
      },
    });
    expect(rendered.props["data-dsh-sparkles-chart"]).toBe("fallback");
    expect(textContent(rendered)).toContain("safe exact fallback");
  });

  test("uses Mainland red-up/green-down and Hong Kong/US green-up/red-down", () => {
    const cases = [
      {
        track: "cn",
        up: "#ef5b5b",
        down: "#20b486",
        legend: "red up · green down · gray flat",
      },
      {
        track: "hk",
        up: "#20b486",
        down: "#ef5b5b",
        legend: "green up · red down · gray flat",
      },
      {
        track: "us",
        up: "#20b486",
        down: "#ef5b5b",
        legend: "green up · red down · gray flat",
      },
    ];

    for (const { track, up, down, legend } of cases) {
      const React = fakeReact();
      const entry = loadChartComponent(React);
      const block = chartBlock(3, track);
      block.meta.chart.bars[1].close = "99";
      block.meta.chart.bars[2].close = block.meta.chart.bars[2].open;

      React.begin();
      const rendered = entry.component({ floating: true, block });

      expect(findByKey(rendered, "body-0")?.props.fill).toBe(up);
      expect(findByKey(rendered, "wick-0")?.props.stroke).toBe(up);
      expect(findByKey(rendered, "body-1")?.props.fill).toBe(down);
      expect(findByKey(rendered, "wick-1")?.props.stroke).toBe(down);
      expect(findByKey(rendered, "body-2")?.props.fill).toBe("#94a3b8");
      expect(textContent(rendered)).toContain(legend);
    }
  });

  test("renders RSI and ATR in separate exact-unit lower panes", () => {
    const React = fakeReact();
    const entry = loadChartComponent(React);
    const block = chartBlock(3, "cn");
    block.meta.chart.indicators = [
      {
        indicatorId: "rsi_2",
        label: "RSI 2",
        panel: "lower_panel",
        unit: "dimensionless_0_100",
        points: block.meta.chart.bars.map((bar, index) => ({
          state: "calculated",
          date: bar.date,
          value: String(40 + index * 5),
        })),
      },
      {
        indicatorId: "atr_2",
        label: "ATR 2",
        panel: "lower_panel",
        unit: "CNY",
        points: block.meta.chart.bars.map((bar, index) => ({
          state: "calculated",
          date: bar.date,
          value: String(0.5 + index * 0.1),
        })),
      },
    ];

    React.begin();
    const rendered = entry.component({ floating: true, block });
    const svg = rendered.children.find((child) => child?.type === "svg");

    expect(svg.props.height).toBe("428");
    expect(findByKey(rendered, "lower-indicator-0-0")?.type).toBe("polyline");
    expect(findByKey(rendered, "lower-indicator-1-0")?.type).toBe("polyline");
    expect(textContent(findByKey(rendered, "lower-unit-0"))).toContain("dimensionless_0_100");
    expect(textContent(findByKey(rendered, "lower-unit-1"))).toContain("CNY");
  });
});
