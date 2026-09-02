import { describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const artifact = resolve(import.meta.dir, "../../dist/finance_charts/index.js");

async function harness() {
  const tools = new Map();
  const api = {
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
  };
  const module = await import(
    `${artifact}?finance-charts=${Date.now()}-${Math.random()}`
  );
  await module.default(api);
  return tools;
}

const hash = (digit) => digit.repeat(64);

function input() {
  return {
    context: {
      instructionRef: hash("1"),
      track: "us",
      instrumentId: "US-AAPL",
      mic: "XNAS",
      timezone: "America/New_York",
      sourceLanguage: "en-US",
      priceUnit: "USD",
      volumeUnit: "shares",
      adjustment: { kind: "raw", label: null },
      source: {
        provider: "fixture-provider",
        sourceReference: "fixture://daily-bars",
        acquisitionReceipt: hash("2"),
        retrievedAtUnixMilliseconds: 1_800_000_000_000,
        sourceCutoffUnixMilliseconds: 1_799_999_000_000,
        entitlement: "fixture_local_analysis",
      },
      limitations: ["fixture_only"],
    },
    series: [
      {
        date: "2026-02-02",
        sessionType: "regular",
        open: "10.00",
        high: "11.00",
        low: "9.00",
        close: "10.50",
        volume: "100",
      },
      {
        date: "2026-02-03",
        sessionType: "regular",
        open: "10.50",
        high: "12.00",
        low: "10.00",
        close: "11.50",
        volume: "150",
      },
      {
        date: "2026-02-04",
        sessionType: "half_day",
        open: "11.50",
        high: "12.00",
        low: "10.50",
        close: "10.75",
        volume: "80",
      },
    ],
    indicators: [
      {
        indicatorId: "sma_2",
        label: "SMA 2",
        panel: "price_overlay",
        unit: "USD",
        warmupSessions: 1,
        calculationReceipt: hash("3"),
        points: [
          { state: "unperformed", date: "2026-02-02", reason: "warmup" },
          { state: "calculated", date: "2026-02-03", value: "11.00" },
          { state: "calculated", date: "2026-02-04", value: "11.125" },
        ],
      },
      {
        indicatorId: "rsi_2",
        label: "RSI 2",
        panel: "lower_panel",
        unit: "ratio_0_100",
        warmupSessions: 1,
        calculationReceipt: hash("4"),
        points: [
          { state: "unperformed", date: "2026-02-02", reason: "warmup" },
          { state: "calculated", date: "2026-02-03", value: "75" },
          { state: "calculated", date: "2026-02-04", value: "40" },
        ],
      },
    ],
    trades: [
      {
        tradeId: "matched",
        date: "2026-02-03",
        side: "buy",
        price: "10.75",
        quantity: "5",
        status: "simulated",
        evidenceReceipt: hash("5"),
      },
      {
        tradeId: "outside",
        date: "2026-02-06",
        side: "sell",
        price: "11.25",
        quantity: "5",
        status: "proposed",
        evidenceReceipt: hash("6"),
      },
    ],
    gaps: [
      {
        date: "2026-02-05",
        state: "market_closure",
        reason: "published closure",
        evidenceRoots: [hash("7")],
      },
    ],
    inputOmissions: ["trade costs not supplied"],
    fallbackMaximumRows: 2,
  };
}

async function execute(
  tool,
  value,
  executionContext = { hasUI: false, ui: {} },
) {
  return tool.execute(
    "finance-chart-query",
    value,
    new AbortController().signal,
    undefined,
    executionContext,
  );
}

function receiptFixture({
  adjustment = "raw",
  provider = "fixture-provider",
} = {}) {
  const direct = input();
  const sourceReference = direct.context.source.sourceReference;
  const retrievedAt = direct.context.source.retrievedAtUnixMilliseconds;
  const rows = direct.series.map((bar) =>
    [bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume, "0"].join(","),
  ).join("\n");
  const receipt = createHash("sha256").update(
    `${sourceReference}\nretrievedAtUnixMilliseconds=${retrievedAt}\ndate,open,high,low,close,volume,amount\n${rows}`,
  ).digest("hex");
  const series = {
    schema: "pi-sparkles/ohlcv-series-handoff",
    schemaVersion: 1,
    track: direct.context.track,
    instrumentId: direct.context.instrumentId,
    mic: direct.context.mic,
    timezone: direct.context.timezone,
    sourceLanguage: direct.context.sourceLanguage,
    priceUnit: direct.context.priceUnit,
    volumeUnit: direct.context.volumeUnit,
    adjustment,
    provider,
    sourceReference,
    acquisitionReceipt: receipt,
    retrievedAtUnixMilliseconds: retrievedAt,
    sourceCutoffUnixMilliseconds:
      direct.context.source.sourceCutoffUnixMilliseconds,
    entitlement: direct.context.source.entitlement,
    limitations: direct.context.limitations,
    bars: direct.series.map((bar) => ({ ...bar, amount: "0" })),
  };
  const calculationReceipt = hash("3");
  const indicatorPayload = {
    schema: "pi-sparkles/indicator-chart-handoff-payload",
    schemaVersion: 1,
    seriesReceipt: receipt,
    calculationReceipt,
    indicatorId: "sma_2",
    label: "SMA 2",
    panel: "price_overlay",
    unit: "USD",
    warmupSessions: 1,
    points: direct.indicators[0].points,
  };
  const indicatorReceipt = createHash("sha256")
    .update(JSON.stringify(indicatorPayload))
    .digest("hex");
  const indicator = {
    schema: "pi-sparkles/indicator-chart-handoff",
    schemaVersion: 1,
    handoffReceipt: indicatorReceipt,
    seriesReceipt: receipt,
    calculationReceipt,
    indicatorId: indicatorPayload.indicatorId,
    label: indicatorPayload.label,
    panel: indicatorPayload.panel,
    unit: indicatorPayload.unit,
    warmupSessions: indicatorPayload.warmupSessions,
    points: indicatorPayload.points,
  };
  const entries = [
    {
      type: "custom",
      id: "series-entry",
      parentId: null,
      timestamp: "2026-02-04T12:00:00.000Z",
      customType: "pi_sparkles_finance_ohlcv.series_handoff.v1",
      data: series,
    },
    {
      type: "custom",
      id: "indicator-entry",
      parentId: "series-entry",
      timestamp: "2026-02-04T12:00:01.000Z",
      customType: "pi_sparkles_finance_indicators.chart_handoff.v1",
      data: indicator,
    },
  ];
  return {
    receipt,
    indicatorReceipt,
    executionContext: {
      hasUI: false,
      ui: {},
      sessionManager: { getBranch: () => entries },
    },
  };
}

describe("finance charts bundled boundary", () => {
  test("documents conditional adjustment and identifier-only context fields", async () => {
    const tools = await harness();
    const context = tools.get("chart_ohlcv").parameters.properties.context;

    expect(
      context.properties.adjustment.properties.label.description.toLowerCase(),
    ).toContain("use null for raw");
    expect(context.properties.adjustment.properties.kind.enum).toContain(
      "provider_defined",
    );
    expect(context.properties.source.properties.entitlement.description).toContain(
      "lowercase entitlement identifier",
    );
    expect(context.properties.limitations.items.description).toContain(
      "lowercase limitation identifier",
    );
  });

  test("registers one chart tool and returns only exact text plus structured details", async () => {
    const tools = await harness();
    expect([...tools.keys()]).toEqual(["chart_ohlcv"]);

    const first = await execute(tools.get("chart_ohlcv"), input());
    expect(first.content.map((part) => part.type)).toEqual(["text"]);
    expect(first.content[0].text).toContain(
      "| Date | Session | Open | High | Low | Close | Volume |",
    );
    expect(first.content[0].text).toContain("active host renders this result inline");
  });

  test("resolves unknown-basis active-session receipts without inventing an adjustment", async () => {
    const tools = await harness();
    const fixture = receiptFixture({ adjustment: "unknown", provider: "sina" });
    const request = {
      seriesReceipt: fixture.receipt,
      maximumBars: 2,
      indicatorReceipts: [fixture.indicatorReceipt],
    };
    expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThan(400);

    const required = tools.get("chart_ohlcv").parameters.required ?? [];
    expect(required).not.toContain("trades");
    expect(required).not.toContain("gaps");
    expect(required).not.toContain("inputOmissions");
    expect(required).not.toContain("fallbackMaximumRows");

    const result = await execute(
      tools.get("chart_ohlcv"),
      request,
      fixture.executionContext,
    );
    expect(result.details.bars.map((bar) => bar.date)).toEqual([
      "2026-02-03",
      "2026-02-04",
    ]);
    expect(result.details.indicators).toHaveLength(1);
    expect(result.details.indicators[0]).toMatchObject({
      indicatorId: "sma_2",
      calculationReceipt: hash("3"),
    });
    expect(result.details.inputOmissions).toEqual([]);
    expect(result.details.trades).toEqual([]);
    expect(result.details.gaps).toEqual([]);
    expect(result.details.structuredFallback.omittedRows).toBe(0);
    expect(result.details.adjustment).toEqual({
      kind: "provider_defined",
      label: "sina_source_adjustment_semantics_unknown",
    });
  });

  test("retains exact decimals and mandatory structured fallback", async () => {
    const tools = await harness();
    const result = await execute(tools.get("chart_ohlcv"), input());

    expect(result.details).toMatchObject({
      schema: "pi-sparkles/finance-chart-result",
      schemaVersion: 2,
      track: "us",
      instrumentId: "US-AAPL",
      mic: "XNAS",
      priceUnit: "USD",
      volumeUnit: "shares",
      structuredFallback: {
        format: "finance_table_v1",
        omittedRows: 1,
        allExactRowsRetainedInDetails: true,
      },
      presentation: {
        kind: "responsive_ohlcv_view",
        interval: "completed_daily",
        initialRangeAnchor: "latest_bar",
        spanPolicy: {
          kind: "available_plot_width_per_host_slot",
          selection: "latest_contiguous_suffix",
          downsampling: false,
          aggregation: false,
          interpolation: false,
          inferredGaps: false,
        },
      },
      decisionOwner: "llm",
      pluginDecisionFields: [],
    });
    expect(result.details.bars).toHaveLength(3);
    expect(result.details.bars[0]).toMatchObject({
      open: "10.00",
      high: "11.00",
      low: "9.00",
      close: "10.50",
      volume: "100",
    });
    expect(result.details.structuredFallback.table.rows).toHaveLength(2);
  });

  test("renders a width-bounded latest suffix as inline terminal Unicode", async () => {
    const tools = await harness();
    const definition = tools.get("chart_ohlcv");
    const value = input();
    value.series = Array.from({ length: 30 }, (_, index) => ({
      date: `2026-01-${String(index + 1).padStart(2, "0")}`,
      sessionType: "regular",
      open: String(100 + index),
      high: String(102 + index),
      low: String(99 + index),
      close: String(101 + index),
      volume: String(1000 + index * 10),
    }));
    value.indicators = [];
    value.trades = [];
    value.gaps = [];
    const result = await execute(definition, value);

    expect(typeof definition.renderResult).toBe("function");
    const narrow = definition.renderResult(
      result,
      { expanded: false },
      {},
      { lastComponent: null },
    );
    const narrowLines = narrow.render(40);
    expect(narrowLines[1]).toContain("2026-01-05..2026-01-30");
    expect(narrowLines[2]).toContain("26/30 bars");
    expect(narrowLines[2]).toContain("4 earlier hidden");
    expect(narrowLines.every((line) => visibleWidth(line) <= 36)).toBeTrue();
    expect(narrowLines.join("\n")).toContain("legend ▁…█ rise");
    expect(narrowLines.join("\n")).toContain("│");
    expect(narrowLines.join("\n")).toMatch(/[▁▂▃▄▅▆▇█━│]/u);
    expect(narrowLines.join("\n")).not.toMatch(/[\u2801-\u28ff]/u);

    const wide = definition.renderResult(
      result,
      { expanded: false },
      {},
      { lastComponent: narrow },
    );
    const wideLines = wide.render(80);
    expect(wide).toBe(narrow);
    expect(wideLines[1]).toContain("2026-01-01..2026-01-30");
    expect(wideLines[2]).toContain("30/30 bars");
    expect(wideLines.every((line) => visibleWidth(line) <= 76)).toBeTrue();
    expect(wideLines.join("\n")).not.toContain("\u001b[");
  });

  test("renders volume with proportional eighth-row heights", async () => {
    const tools = await harness();
    const definition = tools.get("chart_ohlcv");
    const value = input();
    value.series[0].volume = "1";
    value.series[1].volume = "500";
    value.series[2].volume = "1000";
    value.indicators = [];
    value.trades = [];
    value.gaps = [];
    const result = await execute(definition, value);
    const component = definition.renderResult(
      result,
      { expanded: false },
      {},
      { lastComponent: null },
    );
    const lines = component.render(80);
    const volumeStart = lines.findIndex((line) => line.includes("VOL"));
    const volumeRows = lines.slice(volumeStart, volumeStart + 3);
    const glyphUnits = new Map([
      [" ", 0],
      ["▁", 1],
      ["▂", 2],
      ["▃", 3],
      ["▄", 4],
      ["▅", 5],
      ["▆", 6],
      ["▇", 7],
      ["█", 8],
    ]);
    const renderedUnits = [0, 1, 2].map((column) =>
      volumeRows.reduce(
        (total, row) => total + glyphUnits.get(Array.from(row)[10 + column]),
        0,
      )
    );

    expect(volumeStart).toBeGreaterThan(0);
    expect(renderedUnits).toEqual([1, 12, 24]);
    expect(volumeRows.join("\n")).not.toMatch(/[·●_]/u);
  });

  test("renders candle bodies with proportional eighth-row heights", async () => {
    const tools = await harness();
    const definition = tools.get("chart_ohlcv");
    const value = input();
    value.series = [
      {
        date: "2026-08-12",
        sessionType: "regular",
        open: "2.000",
        high: "2.390",
        low: "1.635",
        close: "2.000",
        volume: "28899076",
      },
      {
        date: "2026-08-13",
        sessionType: "regular",
        open: "1.856",
        high: "1.881",
        low: "1.809",
        close: "1.812",
        volume: "40287224",
      },
      {
        date: "2026-08-14",
        sessionType: "regular",
        open: "1.832",
        high: "1.837",
        low: "1.785",
        close: "1.814",
        volume: "31499191",
      },
      {
        date: "2026-08-17",
        sessionType: "regular",
        open: "1.812",
        high: "1.888",
        low: "1.811",
        close: "1.888",
        volume: "42269337",
      },
    ];
    value.indicators = [];
    value.trades = [];
    value.gaps = [];
    const result = await execute(definition, value);
    const component = definition.renderResult(
      result,
      { expanded: false },
      {},
      { lastComponent: null },
    );
    const priceRows = component.render(80).slice(3, 13);
    const glyphUnits = new Map([
      [" ", 0],
      ["│", 0],
      ["━", 0],
      ["▁", 1],
      ["▂", 2],
      ["▃", 3],
      ["▄", 4],
      ["▅", 5],
      ["▆", 6],
      ["▇", 7],
      ["█", 8],
    ]);
    const renderedUnits = [1, 2, 3].map((column) =>
      priceRows.reduce(
        (total, row) =>
          total + glyphUnits.get(Array.from(row.replaceAll("\u20d2", ""))[10 + column]),
        0,
      )
    );

    expect(renderedUnits).toEqual([4, 2, 7]);
    expect(priceRows.join("\n")).toContain("\u20d2");
    expect(visibleWidth(`▄\u20d2`)).toBe(1);
  });

  test("renders RSI and ATR in independent exact-unit lower panes", async () => {
    const tools = await harness();
    const definition = tools.get("chart_ohlcv");
    const value = input();
    value.indicators.push({
      indicatorId: "atr_2",
      label: "ATR 2",
      panel: "lower_panel",
      unit: "USD",
      warmupSessions: 1,
      calculationReceipt: hash("8"),
      points: [
        { state: "unperformed", date: "2026-02-02", reason: "warmup" },
        { state: "calculated", date: "2026-02-03", value: "0.5" },
        { state: "calculated", date: "2026-02-04", value: "0.6" },
      ],
    });
    const result = await execute(definition, value);
    const component = definition.renderResult(
      result,
      { expanded: false },
      {},
      { lastComponent: null },
    );
    const rendered = component.render(100).join("\n");

    expect(result.details.indicators).toHaveLength(3);
    expect(rendered).toContain("ratio_0_100  ─ RSI 2");
    expect(rendered).toContain("USD  ─ ATR 2");
  });

  test("expanded Pi output keeps the exact text fallback inline", async () => {
    const tools = await harness();
    const definition = tools.get("chart_ohlcv");
    const result = await execute(definition, input());
    const component = definition.renderResult(
      result,
      { expanded: true },
      {},
      { lastComponent: null },
    );
    const rendered = component.render(100).join("\n");
    expect(rendered).toContain("legend ▁…█ rise");
    expect(rendered).toMatch(/[╱╲─]/u);
    expect(rendered).toContain("┤");
    expect(rendered).toContain("| Date | Session | Open | High | Low | Close | Volume |");
  });

  test("colors CN opposite to HK and US through the active Pi theme", async () => {
    const tools = await harness();
    const definition = tools.get("chart_ohlcv");
    const base = await execute(definition, input());
    base.details.bars = [base.details.bars[0], base.details.bars[2]];
    base.details.indicators = [];
    base.details.trades = [];
    base.details.gaps = [];

    for (const { track, upTone, downTone } of [
      { track: "cn", upTone: "error", downTone: "success" },
      { track: "hk", upTone: "success", downTone: "error" },
      { track: "us", upTone: "success", downTone: "error" },
    ]) {
      const calls = [];
      const theme = {
        fg(tone, text) {
          calls.push({ tone, text });
          const code = tone === "error" ? 31 : tone === "success" ? 32 : 36;
          return `\u001b[${code}m${text}\u001b[39m`;
        },
      };
      const result = structuredClone(base);
      result.details.track = track;
      const component = definition.renderResult(
        result,
        { expanded: false },
        theme,
        { lastComponent: null },
      );
      const rendered = component.render(80);

      expect(calls.some(({ tone, text }) =>
        tone === upTone && /[▁▂▃▄▅▆▇█━│]/u.test(text),
      )).toBeTrue();
      expect(calls.some(({ tone, text }) =>
        tone === downTone && /[▁▂▃▄▅▆▇█━│]/u.test(text),
      )).toBeTrue();
      expect(rendered.some((line) => line.includes("\u001b["))).toBeTrue();
      expect(rendered.every((line) => visibleWidth(line) <= 76)).toBeTrue();
    }
  });

  test("reserves a TUI margin and clips CJK text by visible terminal width", async () => {
    const tools = await harness();
    const definition = tools.get("chart_ohlcv");
    const result = await execute(definition, input());
    result.details.instrumentId = "CN-588000-科创50ETF华夏";
    const component = definition.renderResult(
      result,
      { expanded: true },
      {},
      { lastComponent: null },
    );

    const lines = component.render(116);
    expect(lines.every((line) => visibleWidth(line) <= 112)).toBeTrue();
  });

  test("discloses warm-up, gaps, omissions, and unmatched marker dates", async () => {
    const tools = await harness();
    const result = await execute(tools.get("chart_ohlcv"), input());

    expect(result.details.indicators[0].points[0]).toEqual({
      state: "unperformed",
      date: "2026-02-02",
      reason: "warmup",
      rendered: false,
      renderOmission: "unperformed",
    });
    expect(result.details.trades[0]).toMatchObject({ rendered: true });
    expect(result.details.trades[1]).toMatchObject({
      rendered: false,
      renderOmission: "no_matching_bar_date",
    });
    expect(result.details.gaps[0]).toMatchObject({
      date: "2026-02-05",
      state: "market_closure",
      reason: "published closure",
    });
    expect(result.details.inputOmissions).toEqual(["trade costs not supplied"]);
  });

  test("rejects market and OHLC mismatches instead of guessing", async () => {
    const tools = await harness();
    const wrongMarket = input();
    wrongMarket.context.mic = "XHKG";
    await expect(execute(tools.get("chart_ohlcv"), wrongMarket)).rejects.toThrow(
      /no fallback was used/,
    );

    const wrongBar = input();
    wrongBar.series[1].high = "9";
    await expect(execute(tools.get("chart_ohlcv"), wrongBar)).rejects.toThrow(
      /OHLC ordering/,
    );
  });

  test("honors cancellation before bounded validation work", async () => {
    const tools = await harness();
    const controller = new AbortController();
    controller.abort();

    await expect(
      tools.get("chart_ohlcv").execute(
        "cancelled-finance-chart",
        input(),
        controller.signal,
        undefined,
        { hasUI: false, ui: {} },
      ),
    ).rejects.toThrow(/cancelled before work began/);
  });
});
