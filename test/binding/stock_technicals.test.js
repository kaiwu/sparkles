import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const artifact = resolve(
  import.meta.dir,
  "../../dist/stock_technicals/index.js",
);

async function harness() {
  const tools = new Map();
  tools.appendedEntries = [];
  const api = {
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    appendEntry(customType, data) {
      tools.appendedEntries.push({ customType, data });
    },
  };
  const module = await import(
    `${artifact}?stock-technicals=${Date.now()}-${Math.random()}`
  );
  await module.default(api);
  return tools;
}

const hash = (digit) => digit.repeat(64);
const known = (raw) => ({ state: "known", raw });

function context({
  track = "cn",
  instrumentId = "CNE000000001",
  mic = "XSHG",
  timezone = "Asia/Shanghai",
  inputField = "close",
  unit = "CNY",
  instructionRef = hash("1"),
} = {}) {
  return {
    ...(instructionRef === null ? {} : { instructionRef }),
    track,
    instrumentId,
    mic,
    timezone,
    dateStart: "2026-02-01",
    dateEnd: "2026-02-28",
    source: {
      provider: "fixture-provider",
      sourceReference: "fixture://exact-bars",
      acquisitionReceipt: hash("2"),
      retrievalTimeUnixMilliseconds: 1_770_000_000_000,
    },
    inputField,
    inputUnit: { state: "known", label: unit },
    basis: { kind: "raw", evidenceRoots: [] },
    retainedAlternatives: [],
    gapFacts: [],
    evidenceRoots: [hash("3")],
  };
}

const rounding = (outputScale, intermediateScale) => ({
  mode: "half_up",
  policy: "per_step",
  outputScale,
  intermediateScale,
});

function smaInput(projection) {
  return {
    context: context(),
    calculation: {
      formulaVariant: "sma_v1",
      period: 3,
      windowVariant: "slot_window_v1",
      parseablePolicy: "exclude_parseable_with_checks",
      rounding: rounding(2, 6),
    },
    projection: { kind: projection, priorOffset: 1 },
    observations: [
      ["2026-02-18", "10.85"],
      ["2026-02-19", "10.92"],
      ["2026-02-20", "10.95"],
      ["2026-02-24", "10.88"],
      ["2026-02-25", "10.91"],
    ].map(([date, raw]) => ({ date, value: known(raw) })),
  };
}

function rsiInput() {
  return {
    context: context({
      track: "us",
      instrumentId: "US-A",
      mic: "XNAS",
      timezone: "America/New_York",
      unit: "USD",
    }),
    calculation: {
      formulaVariant: "rsi_wilder_v1",
      period: 5,
      windowVariant: "slot_window_v1",
      seedVariant: "seed_wilder_first_n",
      gapPolicy: "stop_at_gap_v1",
      zeroZeroConvention: "zero_zero_unperformed_v1",
      parseablePolicy: "exclude_parseable_with_checks",
      rounding: rounding(4, 8),
    },
    projection: { kind: "compact", priorOffset: 1 },
    observations: [
      ["2026-02-02", "44.34"],
      ["2026-02-03", "44.09"],
      ["2026-02-04", "44.15"],
      ["2026-02-05", "43.61"],
      ["2026-02-06", "44.33"],
      ["2026-02-09", "44.83"],
      ["2026-02-10", "45.10"],
    ].map(([date, raw]) => ({ date, value: known(raw) })),
  };
}

function atrInput() {
  const bar = (date, high, low, close) => ({
    date,
    high: known(high),
    low: known(low),
    close: known(close),
  });
  return {
    context: context({
      track: "hk",
      instrumentId: "HK-700",
      mic: "XHKG",
      timezone: "Asia/Hong_Kong",
      inputField: "ohlc",
      unit: "HKD",
    }),
    calculation: {
      formulaVariant: "atr_wilder_v1",
      period: 3,
      windowVariant: "slot_window_v1",
      seedVariant: "seed_wilder_tr_mean_v1",
      firstTrueRange: "tr_first_hl_v1",
      gapPolicy: "stop_at_gap_v1",
      parseablePolicy: "exclude_parseable_with_checks",
      rounding: rounding(4, 4),
    },
    projection: { kind: "intermediate", priorOffset: 1 },
    bars: [
      bar("2026-02-02", "10.50", "9.80", "10.20"),
      bar("2026-02-03", "10.80", "10.10", "10.60"),
      bar("2026-02-04", "11.00", "10.40", "10.80"),
      bar("2026-02-05", "10.90", "10.30", "10.50"),
    ],
  };
}

async function execute(tool, input, executionContext = { hasUI: false, ui: {} }) {
  return tool.execute(
    "stock-technicals-query",
    input,
    new AbortController().signal,
    undefined,
    executionContext,
  );
}

function receiptFixture({
  adjustment = "raw",
  provider = "fixture-provider",
} = {}) {
  const sourceReference = "fixture://session-bound-bars";
  const retrievedAtUnixMilliseconds = 1_770_000_000_000;
  const bars = [
    ["2026-02-18", "10.50", "11.00", "10.00", "10.85", "100", "1085"],
    ["2026-02-19", "10.85", "11.10", "10.70", "10.92", "110", "1201"],
    ["2026-02-20", "10.92", "11.20", "10.80", "10.95", "120", "1314"],
    ["2026-02-24", "10.95", "11.05", "10.70", "10.88", "130", "1414"],
    ["2026-02-25", "10.88", "11.10", "10.80", "10.91", "140", "1527"],
  ];
  const rows = bars.map((row) => row.join(",")).join("\n");
  const canonical = `${sourceReference}\nretrievedAtUnixMilliseconds=${retrievedAtUnixMilliseconds}\ndate,open,high,low,close,volume,amount\n${rows}`;
  const receipt = createHash("sha256").update(canonical).digest("hex");
  const data = {
    schema: "pi-sparkles/ohlcv-series-handoff",
    schemaVersion: 1,
    track: "cn",
    instrumentId: "588000",
    mic: "XSHG",
    timezone: "Asia/Shanghai",
    sourceLanguage: "zh-CN",
    priceUnit: "CNY",
    volumeUnit: "provider_defined_unknown",
    adjustment,
    provider,
    sourceReference,
    acquisitionReceipt: receipt,
    retrievedAtUnixMilliseconds,
    sourceCutoffUnixMilliseconds: null,
    entitlement: "fixture_local_analysis",
    limitations: ["fixture_only"],
    bars: bars.map(([date, open, high, low, close, volume, amount]) => ({
      date,
      open,
      high,
      low,
      close,
      volume,
      amount,
    })),
  };
  const entry = {
    type: "custom",
    id: "session-entry-1",
    parentId: null,
    timestamp: "2026-02-25T12:00:00.000Z",
    customType: "pi_sparkles_finance_ohlcv.series_handoff.v1",
    data,
  };
  return {
    receipt,
    executionContext: {
      hasUI: false,
      ui: {},
      sessionManager: { getBranch: () => [entry] },
    },
  };
}

describe("stock technicals bundled boundary", () => {
  test("advertises one-based projections and omission-only basis fields", async () => {
    const tools = await harness();
    const parameters = tools.get("sma").parameters;
    const basis = parameters.properties.context.properties.basis;
    const projection = parameters.properties.projection;

    expect(basis.description).toContain(
      "omit those properties entirely, never send null",
    );
    expect(basis.properties.label.type).toBe("string");
    expect(basis.properties.label.anyOf).toBeUndefined();
    expect(basis.properties.instructionRef.type).toBe("string");
    expect(projection.description).toContain(
      "use 1 for the newest calculated value and never 0",
    );
  });

  test("supports compact then intermediate evidence queries without making a decision", async () => {
    const tools = await harness();
    expect([...tools.keys()]).toEqual([
      "sma",
      "rsi",
      "atr",
      "compare_series_returns",
    ]);
    for (const name of ["sma", "rsi", "atr"]) {
      expect(tools.get(name).description).toContain(
        "instead of writing or executing calculation code",
      );
      expect(tools.get(name).promptSnippet).toContain(
        "pass only seriesReceipt plus calculation and projection",
      );
      expect(tools.get(name).promptSnippet.toLowerCase()).toContain(
        "omit instructionRef unless a real retained hash already exists".toLowerCase(),
      );
      const calculation =
        tools.get(name).parameters.properties.calculation.properties;
      expect(calculation.policy).toBeDefined();
      expect(calculation.outputScale).toBeDefined();
      expect(calculation.intermediateScale).toBeDefined();
    }

    const compact = await execute(tools.get("sma"), smaInput("compact"));
    expect(compact.details.instructionRefOrigin).toBe("caller_supplied");
    expect(compact.details.projection).toBe("compact");
    expect(compact.details.latestValue.output).toMatchObject({
      date: "2026-02-25",
      value: "10.91",
      unit: "CNY",
    });
    expect(compact.details.priorValue.output).toMatchObject({
      date: "2026-02-24",
      value: "10.92",
    });
    expect(compact.details.orderedOutputs).toBeUndefined();
    expect(compact.details.semanticReceiptJson).toBeUndefined();
    expect(compact.details.requestReceiptJson).toBeUndefined();
    expect(compact.details.receiptPayloads).toEqual({
      state: "omitted",
      reason:
        "compact_projection_returns_content_hash_handles_without_duplicating_full_inputs_and_outputs",
    });
    expect(compact.content[0].text.split("\n")[0]).toContain(
      "calculated 3, unperformed 2",
    );
    const compactModelData = JSON.parse(
      compact.content[0].text.split("\nMODEL_DATA ")[1],
    );
    expect(compactModelData.latestValue.output.value).toBe("10.91");
    expect(compactModelData.priorValue.output.value).toBe("10.92");
    expect(compact.content[0].text).not.toContain("semanticReceiptJson");

    const drilldown = await execute(
      tools.get("sma"),
      smaInput("intermediate"),
    );
    expect(drilldown.details.semanticReceiptHandle).toBe(
      compact.details.semanticReceiptHandle,
    );
    expect(drilldown.details.semanticReceiptJson).toBeString();
    expect(drilldown.details.requestReceiptJson).toBeString();
    expect(drilldown.content[0].text).toContain('"orderedOutputs"');
    expect(drilldown.details.orderedOutputs).toHaveLength(5);
    expect(drilldown.details.orderedOutputs.at(-1)).toMatchObject({
      state: "calculated",
      intermediateValues: [
        { name: "sum", value: "32.74" },
        { name: "count", value: "3" },
      ],
    });
    expect(drilldown.details.decisionOwner).toBe("llm");
    expect(drilldown.details.pluginDecisionFields).toEqual([]);
    expect(JSON.stringify(drilldown.details)).not.toMatch(
      /"(signal|rank|recommended|correct|ready|nextAction)"/,
    );
  });

  test("preserves unknown provider adjustment semantics across all receipt indicators in Pi", async () => {
    const tools = await harness();
    const fixture = receiptFixture({ adjustment: "unknown", provider: "sina" });
    const common = {
      seriesReceipt: fixture.receipt,
      projection: { kind: "compact", priorOffset: 1 },
    };
    const sma = await execute(
      tools.get("sma"),
      {
        ...common,
        calculation: {
          formulaVariant: "sma_v1",
          period: 3,
          windowVariant: "slot_window_v1",
          parseablePolicy: "exclude_parseable_with_checks",
          rounding: rounding(2, 6),
        },
      },
      fixture.executionContext,
    );
    const rsi = await execute(
      tools.get("rsi"),
      {
        ...common,
        calculation: {
          formulaVariant: "rsi_wilder_v1",
          period: 3,
          windowVariant: "slot_window_v1",
          seedVariant: "seed_wilder_first_n",
          gapPolicy: "stop_at_gap_v1",
          zeroZeroConvention: "zero_zero_unperformed_v1",
          parseablePolicy: "exclude_parseable_with_checks",
          rounding: rounding(4, 8),
        },
      },
      fixture.executionContext,
    );
    const atr = await execute(
      tools.get("atr"),
      {
        ...common,
        calculation: {
          formulaVariant: "atr_wilder_v1",
          period: 3,
          windowVariant: "slot_window_v1",
          seedVariant: "seed_wilder_tr_mean_v1",
          firstTrueRange: "tr_first_hl_v1",
          gapPolicy: "stop_at_gap_v1",
          parseablePolicy: "exclude_parseable_with_checks",
          rounding: rounding(4, 8),
        },
      },
      fixture.executionContext,
    );

    expect(sma.details.latestValue.output).toMatchObject({
      date: "2026-02-25",
      value: "10.91",
      unit: "CNY",
    });
    expect(rsi.details.latestValue.state).toBe("known");
    expect(atr.details.latestValue.state).toBe("known");
    for (const result of [sma, rsi, atr]) {
      expect(result.details.adjustmentBasis).toEqual({
        kind: "provider_defined",
        label: "sina_source_adjustment_semantics_unknown",
        evidenceRoots: [],
      });
    }
    expect(tools.appendedEntries).toHaveLength(3);
    for (const [index, result] of [sma, rsi, atr].entries()) {
      const entry = tools.appendedEntries[index];
      expect(entry.customType).toBe(
        "pi_sparkles_finance_indicators.chart_handoff.v1",
      );
      expect(entry.data.handoffReceipt).toBe(result.details.chartHandoffReceipt);
      expect(entry.data.seriesReceipt).toBe(fixture.receipt);
      expect(entry.data.points).toHaveLength(5);
    }
    for (const [name, result] of [
      ["sma", sma],
      ["rsi", rsi],
      ["atr", atr],
    ]) {
      expect(typeof tools.get(name).renderResult).toBe("function");
      const rendered = tools
        .get(name)
        .renderResult(
          result,
          { expanded: false },
          { fg: (_color, text) => text },
          {},
        )
        .render(80);
      expect(rendered).toHaveLength(1);
      expect(rendered[0]).not.toContain("MODEL_DATA");
      expect(Buffer.byteLength(JSON.stringify({
        seriesReceipt: fixture.receipt,
        calculation: name,
        projection: common.projection,
      }))).toBeLessThan(256);
    }
  });

  test("accepts matching redundant rounding fields and rejects conflicts", async () => {
    const tools = await harness();
    const compatible = smaInput("compact");
    Object.assign(compatible.calculation, {
      policy: "per_step",
      outputScale: 2,
      intermediateScale: 6,
    });

    const result = await execute(tools.get("sma"), compatible);
    expect(result.details.latestValue.state).toBe("known");

    const conflicting = smaInput("compact");
    conflicting.calculation.outputScale = 4;
    await expect(execute(tools.get("sma"), conflicting)).rejects.toThrow(
      "Invalid parameters for tool sma",
    );
  });

  test("keeps a bounded large SMA request fast and its compact result small", async () => {
    const tools = await harness();
    const observations = Array.from({ length: 1_000 }, (_, index) => ({
      date: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10),
      value: known((100 + (index % 17) / 10).toFixed(2)),
    }));
    const input = smaInput("compact");
    input.context.dateStart = observations[0].date;
    input.context.dateEnd = observations.at(-1).date;
    input.calculation.period = 60;
    input.observations = observations;

    const started = performance.now();
    const result = await execute(tools.get("sma"), input);
    const duration = performance.now() - started;

    expect(result.details.latestValue.state).toBe("known");
    expect(duration).toBeLessThan(5_000);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(10_000);
  });

  test("derives a deterministic instruction reference without LLM-side hashing", async () => {
    const tools = await harness();
    const input = smaInput("compact");
    input.context = context({ instructionRef: null });

    const first = await execute(tools.get("sma"), input);
    const second = await execute(tools.get("sma"), input);

    expect(first.details.instructionRef).toMatch(/^[0-9a-f]{64}$/);
    expect(first.details.instructionRefOrigin).toBe(
      "derived_from_canonical_request",
    );
    expect(second.details.instructionRef).toBe(first.details.instructionRef);
  });

  test("promotes raw-basis roots to context evidence instead of blocking", async () => {
    const tools = await harness();
    const input = smaInput("compact");
    input.context.evidenceRoots = [];
    input.context.basis.evidenceRoots = [hash("3")];

    const result = await execute(tools.get("sma"), input);

    expect(result.details.adjustmentBasis).toEqual({ kind: "raw" });
    expect(result.details.evidenceRoots).toEqual([hash("3")]);
    expect(result.details.latestValue.state).toBe("known");
  });

  test("runs the explicit Wilder RSI and ATR paths and rejects missing policies", async () => {
    const tools = await harness();
    const rsi = await execute(tools.get("rsi"), rsiInput());
    expect(rsi.details.latestValue.output.value).toBe("67.1859");
    expect(rsi.details.policies).toMatchObject({
      seedVariant: "seed_wilder_first_n",
      gapPolicy: "stop_at_gap_v1",
      zeroZeroConvention: "zero_zero_unperformed_v1",
    });

    const atr = await execute(tools.get("atr"), atrInput());
    expect(atr.details.latestValue.output.value).toBe("0.6445");
    expect(atr.details.orderedOutputs.at(-1).intermediateValues).toContainEqual(
      { name: "true_range", value: "0.6" },
    );
    expect(atr.details.policies.firstTrueRange).toBe("tr_first_hl_v1");

    const missingGapPolicy = rsiInput();
    delete missingGapPolicy.calculation.gapPolicy;
    await expect(
      execute(tools.get("rsi"), missingGapPolicy),
    ).rejects.toThrow("Invalid parameters for tool rsi");
  });
});
