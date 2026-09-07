import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { assertRawSubset } from "../../dsh/schema-translate.mjs";
import {
  createPiApi,
  DSH_CUSTOM_EVENT,
  DSH_STATUS_EVENT,
  financeChartPresentationMeta,
} from "../../dsh/pi-api.mjs";
import { createPlugin } from "../../dsh/plugin.mjs";
import { dshClientFactorySource } from "../../dsh/client.js";
import {
  STATUS_PROJECTION_KEY,
  statusProjection,
} from "../../dsh/plugins/finance_track_overlay.mjs";

function fakeCtx({ guardInjectedServices = false } = {}) {
  const tools = [];
  const commands = [];
  const promptSections = [];
  const listeners = new Map();
  const services = {
    tools: {
      register(definition) {
        tools.push(definition);
      },
    },
    commands: {
      register(definition) {
        commands.push(definition);
      },
    },
    logger: { info() {}, warn() {} },
    systemPrompt: {
      section(value) {
        promptSections.push(value);
        return () => {};
      },
    },
  };
  const context = {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },
    async plugin(extension, config) {
      if (typeof extension === "function") await extension(this, config);
      else await extension.apply(this, config);
    },
    async __emit(event, payload) {
      for (const handler of listeners.get(event) ?? []) await handler(payload);
    },
    get(name) {
      return services[name];
    },
    __tools: tools,
    __commands: commands,
    __promptSections: promptSections,
  };
  if (guardInjectedServices) {
    for (const name of Object.keys(services)) {
      Object.defineProperty(context, name, {
        get() {
          throw new Error(`cannot get property "${name}" without inject`);
        },
      });
    }
  } else {
    Object.assign(context, services);
  }
  return context;
}

function fakeAgent(id = "agent-1") {
  const events = [];
  const followups = [];
  const steers = [];
  return {
    id,
    session: {
      id: `session-${id}`,
      header: { cwd: `/work/${id}` },
      snapshotEvents: () => Object.freeze([...events]),
      append(type, data) {
        const event = { type, data, seq: events.length, time: Date.now() };
        events.push(event);
        return event;
      },
    },
    followup(message) {
      followups.push(message);
    },
    steer(message) {
      steers.push(message);
    },
    __followups: followups,
    __steers: steers,
  };
}

function toolRunContext(agent = fakeAgent(), callId = "call-1") {
  return {
    agent,
    callId,
    signal: new AbortController().signal,
    concludeTurn() {},
  };
}

describe("pi-api facade", () => {
  test("registerTool bridges parameters and output through the DSH contract", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx });
    let seen = null;
    api.registerTool({
      name: "stock_quote",
      label: "Quote",
      description: "Inspect one quote",
      promptSnippet: "Supply every fact explicitly",
      parameters: {
        type: "object",
        properties: { ticker: { type: "string" }, limit: { type: "integer", minimum: 1 } },
        required: ["ticker"],
        additionalProperties: false,
      },
      executionMode: "parallel",
      execute: async (toolCallId, input, signal, updates, context) => {
        seen = { toolCallId, input, hasSignal: signal !== undefined, context };
        return { content: [{ type: "text", text: `quote for ${input.ticker}` }], details: { x: 1 } };
      },
    });

    expect(ctx.__tools).toHaveLength(1);
    const tool = ctx.__tools[0];
    expect(tool.name).toBe("stock_quote");
    expect(tool.parameters).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        ticker: { type: "string" },
        limit: {
          type: "integer",
          description: "Call constraints: value >= 1.",
        },
      },
      required: ["ticker"],
    });
    expect(tool.isConcurrencySafe).toBeTypeOf("function");
    expect(assertRawSubset(tool.output.schema)).toEqual([]);
    expect(tool.description).toContain("Supply every fact explicitly");
    expect(
      tool.output.render(
        { ticker: "AAPL" },
        { content: [{ type: "text", text: "hi" }] },
      ),
    ).toEqual([{ type: "text", text: "hi" }]);

    const value = await tool.execute(
      { ticker: "AAPL" },
      toolRunContext(fakeAgent(), "quote-call-1"),
    );
    expect(value.content[0].text).toBe("quote for AAPL");
    expect(seen.input).toEqual({ ticker: "AAPL" });
    expect(seen.toolCallId).toBe("quote-call-1");
    expect(seen.hasSignal).toBeTrue();
    expect(seen.context.cwd).toBe("/work/agent-1");
  });

  test("tool rejection propagates as a thrown error", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx });
    api.registerTool({
      name: "bad_tool",
      description: "fails",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        throw new Error("nope");
      },
    });
    await expect(
      ctx.__tools[0].execute({}, toolRunContext()),
    ).rejects.toThrow("nope");
  });

  test("chart tool alone projects bounded DSH browser metadata", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx });
    api.registerTool({
      name: "chart_ohlcv",
      description: "chart",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({
        content: [{ type: "text", text: "exact fallback" }],
        details: {
          schema: "pi-sparkles/finance-chart-result",
          schemaVersion: 2,
          track: "us",
          instrumentId: "US-AAPL",
          mic: "XNAS",
          timezone: "America/New_York",
          priceUnit: "USD",
          volumeUnit: "shares",
          adjustment: { kind: "raw", label: null },
          presentation: { kind: "responsive_ohlcv_view" },
          bars: [{
            date: "2026-02-02",
            sessionType: "regular",
            open: "10.00",
            high: "11.00",
            low: "9.00",
            close: "10.50",
            volume: "100",
          }],
          indicators: [],
          trades: [],
          gaps: [],
          inputOmissions: [],
        },
      }),
    });
    expect(ctx.__tools[0].output.presentationMeta).toBeTypeOf("function");
    const value = await ctx.__tools[0].execute({}, toolRunContext());
    expect(ctx.__tools[0].output.presentationMeta({}, value)).toEqual(
      financeChartPresentationMeta(value),
    );
    expect(financeChartPresentationMeta(value)).toMatchObject({
      schema: "pi-sparkles/dsh-finance-chart-meta",
      schemaVersion: 1,
      valid: true,
      chart: {
        instrumentId: "US-AAPL",
        bars: [{ open: "10.00", close: "10.50" }],
      },
    });
    const oversized = structuredClone(value);
    oversized.details.indicators = Array.from({ length: 4 }, (_, series) => ({
      indicatorId: `large-${series}`,
      label: `Large ${series}`,
      panel: "lower_panel",
      unit: "ratio",
      points: Array.from({ length: 240 }, (_, index) => ({
        state: "unperformed",
        date: `D${index}`,
        reason: "x".repeat(1000),
      })),
    }));
    const bounded = financeChartPresentationMeta(oversized);
    expect(bounded).toMatchObject({
      valid: true,
      annotationsTruncated: true,
      chart: { indicators: [], bars: [{ close: "10.50" }] },
    });
    expect(Buffer.byteLength(JSON.stringify(bounded), "utf8")).toBeLessThanOrEqual(
      512 * 1024,
    );

    const ordinaryCtx = fakeCtx();
    createPiApi({ ctx: ordinaryCtx }).registerTool({
      name: "ordinary",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
    });
    expect(ordinaryCtx.__tools[0].output.presentationMeta).toBeUndefined();
  });

  test("registerCommand maps Pi handlers to the DSH CommandResult contract", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx });
    api.registerCommand("finance-track", {
      description: "switch track",
      handler: async (_args, context) => {
        context.ui.notify("switched to cn", "info");
      },
    });

    expect(ctx.__commands).toHaveLength(1);
    const command = ctx.__commands[0];
    expect(command.name).toBe("finance-track");
    expect(command.description).toBe("switch track");

    const result = await command.handler({
      agent: fakeAgent(),
      rawInput: "cn",
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ kind: "success", text: "switched to cn" });
  });

  test("command handler errors become error results", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx });
    api.registerCommand("boom", {
      description: "throws",
      handler: async () => {
        throw new Error("broken");
      },
    });
    const result = await ctx.__commands[0].handler({
      agent: fakeAgent(),
      rawInput: "",
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ kind: "error", text: "broken" });
  });

  test("flags: registered default, config override, env override", () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx, config: { flags: { "finance-track": "hk" } } });
    api.registerFlag("finance-track", { description: "track", type: "string", default: "us" });
    expect(api.getFlag("finance-track")).toBe("hk");

    const api2 = createPiApi({ ctx });
    api2.registerFlag("finance-track", { description: "track", type: "string", default: "us" });
    expect(api2.getFlag("finance-track")).toBe("us");

    const previous = process.env.PI_SPARKLES_FLAG_FINANCE_TRACK;
    process.env.PI_SPARKLES_FLAG_FINANCE_TRACK = "cn";
    try {
      expect(api2.getFlag("finance-track")).toBe("cn");
    } finally {
      if (previous === undefined) delete process.env.PI_SPARKLES_FLAG_FINANCE_TRACK;
      else process.env.PI_SPARKLES_FLAG_FINANCE_TRACK = previous;
    }
  });

  test("appendEntry uses the invoking DSH session; getActiveTools lists tools", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx });
    api.registerTool({
      name: "alpha",
      description: "first",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
    });
    expect(api.getActiveTools()).toEqual(["alpha"]);

    const agent = fakeAgent();
    let captured;
    api.registerCommand("probe", {
      description: "probe",
      handler: async (_, commandContext) => {
        api.appendEntry("finance_cache.receipt", { track: "cn" });
        captured = commandContext;
      },
    });
    await ctx.__commands.at(-1).handler({
      agent,
      rawInput: "",
      signal: new AbortController().signal,
    });
    const entries = captured.sessionManager.getBranch();
    expect(entries).toHaveLength(1);
    expect(entries[0].customType).toBe("finance_cache.receipt");
    expect(entries[0].data).toEqual({ track: "cn" });
    expect(entries[0].type).toBe("custom");
    expect(agent.session.snapshotEvents()[0].type).toBe("pi-sparkles/custom");
    expect(captured.cwd).toBe("/work/agent-1");
    expect(captured.sessionManager.getLeafId()).toBe("dsh:session-agent-1:0");
    agent.session.append(DSH_CUSTOM_EVENT, { customType: "later", data: {} });
    expect(captured.sessionManager.getEntries()).toHaveLength(2);
    expect(captured.sessionManager.getLeafId()).toBe("dsh:session-agent-1:1");
    expect(entries).toHaveLength(1);
  });

  test("rejects an incompatible session API instead of reporting missing receipts", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx });
    api.registerTool({
      name: "read-session",
      parameters: { type: "object", properties: {} },
      execute: async (_id, _args, _signal, _update, context) => {
        context.sessionManager.getBranch();
      },
    });
    const agent = fakeAgent();
    delete agent.session.snapshotEvents;
    agent.session.events = [];
    await expect(ctx.__tools[0].execute({}, toolRunContext(agent)))
      .rejects.toThrow("requires DSH 0.1.2-rc.1 session.snapshotEvents()");
  });

  test("session-bound OHLCV receipts feed short indicator calls without crossing DSH agents", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx });
    const artifact = resolve(import.meta.dir, "../../dist/stock_technicals/index.js");
    const extension = await import(
      `${artifact}?dsh-series-receipt=${Date.now()}-${Math.random()}`
    );
    await extension.default(api);
    const sma = ctx.__tools.find((tool) => tool.name === "sma");
    expect(sma).toBeDefined();

    const sourceReference = "fixture://dsh/session-bars";
    const retrievedAtUnixMilliseconds = 1_770_000_000_000;
    const rows = [
      ["2026-02-18", "10.50", "11.00", "10.00", "10.85", "100", "1085"],
      ["2026-02-19", "10.85", "11.10", "10.70", "10.92", "110", "1201"],
      ["2026-02-20", "10.92", "11.20", "10.80", "10.95", "120", "1314"],
      ["2026-02-24", "10.95", "11.05", "10.70", "10.88", "130", "1414"],
      ["2026-02-25", "10.88", "11.10", "10.80", "10.91", "140", "1527"],
    ];
    const canonical = `${sourceReference}\nretrievedAtUnixMilliseconds=${retrievedAtUnixMilliseconds}\ndate,open,high,low,close,volume,amount\n${rows.map((row) => row.join(",")).join("\n")}`;
    const receipt = createHash("sha256").update(canonical).digest("hex");
    const owner = fakeAgent("receipt-owner");
    owner.session.append(DSH_CUSTOM_EVENT, {
      customType: "pi_sparkles_finance_ohlcv.series_handoff.v1",
      data: {
        schema: "pi-sparkles/ohlcv-series-handoff",
        schemaVersion: 1,
        track: "cn",
        instrumentId: "588000",
        mic: "XSHG",
        timezone: "Asia/Shanghai",
        sourceLanguage: "zh-CN",
        priceUnit: "CNY",
        volumeUnit: "provider_defined_unknown",
        adjustment: "raw",
        provider: "fixture-provider",
        sourceReference,
        acquisitionReceipt: receipt,
        retrievedAtUnixMilliseconds,
        sourceCutoffUnixMilliseconds: null,
        entitlement: "fixture_local_analysis",
        limitations: ["fixture_only"],
        bars: rows.map(([date, open, high, low, close, volume, amount]) => ({
          date,
          open,
          high,
          low,
          close,
          volume,
          amount,
        })),
      },
    });
    const args = {
      seriesReceipt: receipt,
      calculation: {
        formulaVariant: "sma_v1",
        period: 3,
        windowVariant: "slot_window_v1",
        parseablePolicy: "exclude_parseable_with_checks",
        rounding: {
          mode: "half_up",
          policy: "per_step",
          outputScale: 2,
          intermediateScale: 6,
        },
      },
      projection: { kind: "compact", priorOffset: 1 },
    };

    const value = await sma.execute(args, toolRunContext(owner, "receipt-sma"));
    expect(value.details.latestValue.output).toMatchObject({
      date: "2026-02-25",
      value: "10.91",
      unit: "CNY",
    });
    expect(Buffer.byteLength(JSON.stringify(args))).toBeLessThan(512);
    await expect(
      sma.execute(args, toolRunContext(fakeAgent("other"), "other-sma")),
    ).rejects.toThrow("No active-session OHLCV handoff matched seriesReceipt");
  });

  test("CN OHLCV producer registers the exact DSH receipt consumed by SMA and chart", async () => {
    const originalFetch = globalThis.fetch;
    const originalContact = process.env.AGENT_CONTACT;
    process.env.AGENT_CONTACT = "dsh-series@example.test";
    globalThis.fetch = async () => new Response(
      '{"rc":0,"data":{"code":"600519","name":"贵州茅台","klines":["2024-08-01,1350.6000,1358.98,1363.35,1346.00,36147,4898665275.00,1.28,0.62,8.38,0.29","2024-08-02,1358.98,1328.36,1360.00,1320.00,37450,5004070406.00,2.94,-2.25,-30.62,0.30"]}}',
      { status: 200, headers: { "content-type": "application/json" } },
    );

    try {
      const ctx = fakeCtx();
      const api = createPiApi({ ctx });
      for (const name of ["cn_ohlcv", "stock_technicals", "finance_charts"]) {
        const artifact = resolve(import.meta.dir, `../../dist/${name}/index.js`);
        const extension = await import(
          `${artifact}?dsh-producer-series=${Date.now()}-${Math.random()}`
        );
        await extension.default(api);
      }

      const owner = fakeAgent("producer-owner");
      const tool = (name) => ctx.__tools.find((definition) => definition.name === name);
      const history = await tool("cn_stock_ohlcv").execute({
        provider: "eastmoney",
        venue: "sse",
        board: "main",
        shareClass: "a_share",
        code: "600519",
        currency: "CNY",
        startDate: "2024-08-01",
        endDate: "2024-08-02",
        limit: 2,
      }, toolRunContext(owner, "cn-history"));

      expect(history.details.seriesReceipt).toMatch(/^[0-9a-f]{64}$/);
      expect(history.details.seriesReceipt).not.toBe(
        history.details.acquisitionReceipt,
      );
      expect(owner.session.snapshotEvents()).toHaveLength(1);
      expect(owner.session.snapshotEvents()[0]).toMatchObject({
        type: DSH_CUSTOM_EVENT,
        data: {
          customType: "pi_sparkles_finance_ohlcv.series_handoff.v1",
          data: {
            track: "cn",
            instrumentId: "600519",
            mic: "XSHG",
            acquisitionReceipt: history.details.seriesReceipt,
          },
        },
      });

      const smaArgs = {
        seriesReceipt: history.details.seriesReceipt,
        calculation: {
          formulaVariant: "sma_v1",
          period: 2,
          windowVariant: "slot_window_v1",
          parseablePolicy: "exclude_parseable_with_checks",
          rounding: {
            mode: "half_up",
            policy: "per_step",
            outputScale: 2,
            intermediateScale: 6,
          },
        },
        projection: { kind: "compact", priorOffset: 1 },
      };
      const sma = await tool("sma").execute(
        smaArgs,
        toolRunContext(owner, "cn-sma"),
      );
      expect(sma.details.latestValue.state).toBe("known");
      expect(sma.details.chartHandoffReceipt).toMatch(/^[0-9a-f]{64}$/);

      const chartArgs = {
        seriesReceipt: history.details.seriesReceipt,
        maximumBars: 2,
        indicatorReceipts: [sma.details.chartHandoffReceipt],
      };
      const chartTool = tool("chart_ohlcv");
      const chart = await chartTool.execute(
        chartArgs,
        toolRunContext(owner, "cn-chart"),
      );
      expect(chart.details.bars).toHaveLength(2);
      expect(chart.details.indicators).toHaveLength(1);
      expect(chartTool.output.presentationMeta(chartArgs, chart)).toMatchObject({
        valid: true,
        chart: { instrumentId: "600519", mic: "XSHG" },
      });
      expect(Buffer.byteLength(JSON.stringify(chartArgs))).toBeLessThan(400);

      await expect(
        tool("sma").execute(
          smaArgs,
          toolRunContext(fakeAgent("producer-other"), "other-cn-sma"),
        ),
      ).rejects.toThrow("No active-session OHLCV handoff matched seriesReceipt");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalContact === undefined) delete process.env.AGENT_CONTACT;
      else process.env.AGENT_CONTACT = originalContact;
    }
  });

  test("CN OHLCV uses Sina only after explicit user selection in DSH", async () => {
    const originalFetch = globalThis.fetch;
    const originalContact = process.env.AGENT_CONTACT;
    process.env.AGENT_CONTACT = "dsh-sina-explicit@example.test";
    const hosts = [];
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      if (url.hostname !== "money.finance.sina.com.cn") {
        throw new Error(`unexpected provider ${url.hostname}`);
      }
      return new Response(
        '[{"day":"2024-08-01","open":"1350.6000","high":"1363.35","low":"1346.00","close":"1358.98","volume":"36147"},{"day":"2024-08-02","open":"1358.98","high":"1360.00","low":"1320.00","close":"1328.36","volume":"37450"}]',
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    try {
      const ctx = fakeCtx();
      const api = createPiApi({ ctx });
      const artifact = resolve(import.meta.dir, "../../dist/cn_ohlcv/index.js");
      const extension = await import(
        `${artifact}?dsh-sina-explicit=${Date.now()}-${Math.random()}`
      );
      await extension.default(api);
      const owner = fakeAgent("sina-explicit-owner");
      const history = await ctx.__tools[0].execute({
        provider: "sina",
        venue: "sse",
        board: "main",
        shareClass: "a_share",
        code: "600519",
        currency: "CNY",
        startDate: "2024-08-01",
        endDate: "2024-08-02",
        limit: 3,
      }, toolRunContext(owner, "cn-sina-explicit"));

      expect(hosts).toEqual(["money.finance.sina.com.cn"]);
      expect(history.details).toMatchObject({
        selectedProvider: "sina",
        selectionMode: "explicit_user_choice",
        fallbackPerformed: false,
        dataSourceChange: "eastmoney->sina_by_explicit_user_choice",
      });
      expect(history.content[0].text).toContain(
        "DATA SOURCE CHANGED BY EXPLICIT USER CHOICE: eastmoney -> sina",
      );
      expect(history.content[0].text).toContain(
        "No automatic fallback was performed",
      );
      expect(owner.session.snapshotEvents()[0].data.data).toMatchObject({
        provider: "sina",
        track: "cn",
        mic: "XSHG",
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalContact === undefined) delete process.env.AGENT_CONTACT;
      else process.env.AGENT_CONTACT = originalContact;
    }
  });

  test("CN STAR 50 DSH route prompts after Eastmoney failure and uses Sina only in a separate explicit call", async () => {
    const originalFetch = globalThis.fetch;
    const originalContact = process.env.AGENT_CONTACT;
    process.env.AGENT_CONTACT = "dsh-star50-sina@example.test";
    const hosts = [];
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      hosts.push(url.hostname);
      if (url.hostname === "push2his.eastmoney.com") {
        return new Response("provider unavailable", { status: 503 });
      }
      if (url.hostname === "money.finance.sina.com.cn") {
        return new Response(
          '[{"day":"2026-08-03","open":"1000.10","high":"1012.30","low":"998.20","close":"1008.50","volume":"123456789"},{"day":"2026-08-04","open":"1008.50","high":"1020.40","low":"1003.60","close":"1018.20","volume":"135791357"}]',
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected provider ${url.hostname}`);
    };

    try {
      const ctx = fakeCtx();
      const api = createPiApi({ ctx });
      for (const name of ["cn_market_data", "stock_technicals", "finance_charts"]) {
        const artifact = resolve(import.meta.dir, `../../dist/${name}/index.js`);
        const extension = await import(
          `${artifact}?dsh-star50-sina=${Date.now()}-${Math.random()}`
        );
        await extension.default(api);
      }
      const tool = (name) => ctx.__tools.find(
        (definition) => definition.name === name,
      );
      const historyTool = ctx.__tools.find(
        (definition) => definition.name === "cn_raw_vendor_history",
      );
      const owner = fakeAgent("star50-sina-owner");
      const baseInput = {
        venue: "sse",
        code: "000688",
        instrumentKind: "benchmark_index",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        limit: 10,
      };

      let failure;
      try {
        await historyTool.execute(
          { provider: "eastmoney", ...baseInput },
          toolRunContext(owner, "star50-eastmoney"),
        );
      } catch (error) {
        failure = error;
      }
      expect(hosts).toEqual(["push2his.eastmoney.com"]);
      expect(failure).toMatchObject({
        code: "provider_history_failed_sina_available",
        details: {
          failedProvider: "eastmoney",
          suggestedProvider: "sina",
          sinaCalled: false,
          automaticFallbackAllowed: false,
          requiresExplicitUserChoice: true,
        },
      });
      expect(failure.message).toContain("Sina was not called");
      expect(owner.session.snapshotEvents()).toHaveLength(0);

      const history = await historyTool.execute(
        { provider: "sina", ...baseInput },
        toolRunContext(owner, "star50-sina-explicit"),
      );
      expect(hosts).toEqual([
        "push2his.eastmoney.com",
        "money.finance.sina.com.cn",
      ]);
      expect(history.details).toMatchObject({
        selectedProvider: "sina",
        selectionMode: "explicit_user_choice",
        fallbackPerformed: false,
        dataSourceChange: "eastmoney->sina_by_explicit_user_choice",
        code: "000688",
      });
      expect(history.content[0].text).toContain(
        "DATA SOURCE CHANGED BY EXPLICIT USER CHOICE: eastmoney -> sina",
      );
      expect(owner.session.snapshotEvents()[0].data.data).toMatchObject({
        provider: "sina",
        track: "cn",
        instrumentId: "000688",
        mic: "XSHG",
        adjustment: "unknown",
      });

      const sma = await tool("sma").execute({
        seriesReceipt: history.details.seriesReceipt,
        calculation: {
          formulaVariant: "sma_v1",
          period: 2,
          windowVariant: "slot_window_v1",
          parseablePolicy: "exclude_parseable_with_checks",
          rounding: {
            mode: "half_up",
            policy: "per_step",
            outputScale: 2,
            intermediateScale: 6,
          },
        },
        projection: { kind: "compact", priorOffset: 1 },
      }, toolRunContext(owner, "star50-sina-sma"));
      expect(sma.details.latestValue.state).toBe("known");
      expect(sma.details.adjustmentBasis).toEqual({
        kind: "provider_defined",
        label: "sina_source_adjustment_semantics_unknown",
        evidenceRoots: [],
      });

      const chart = await tool("chart_ohlcv").execute({
        seriesReceipt: history.details.seriesReceipt,
        maximumBars: 2,
        indicatorReceipts: [sma.details.chartHandoffReceipt],
      }, toolRunContext(owner, "star50-sina-chart"));
      expect(chart.details.bars).toHaveLength(2);
      expect(chart.details.indicators).toHaveLength(1);
      expect(chart.details.adjustment).toEqual({
        kind: "provider_defined",
        label: "sina_source_adjustment_semantics_unknown",
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalContact === undefined) delete process.env.AGENT_CONTACT;
      else process.env.AGENT_CONTACT = originalContact;
    }
  });

  test("scoped status UI writes whole-value DSH session events", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({
      ctx,
      scopedState: true,
      activeTools: () => ["global_tool"],
    });
    api.registerTool({
      name: "scoped_tool",
      description: "scoped",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
    });
    expect(api.getActiveTools()).toEqual(["global_tool", "scoped_tool"]);
    api.registerCommand("status-probe", {
      description: "status",
      handler: async (_args, context) => {
        context.ui.setStatus("finance-track", "CN · CNY");
        context.ui.clearStatus("finance-track");
      },
    });
    const agent = fakeAgent("status");
    await ctx.__commands[0].handler({
      agent,
      rawInput: "",
      signal: new AbortController().signal,
    });
    expect(agent.session.snapshotEvents().map((event) => event.type)).toEqual([
      "pi-sparkles/status",
      "pi-sparkles/status",
    ]);
    expect(agent.session.snapshotEvents().map((event) => event.data)).toEqual([
      { key: "finance-track", text: "CN · CNY" },
      { key: "finance-track", text: null },
    ]);
  });

  test("sendUserMessage queues on the exact invocation agent", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx });
    api.registerCommand("queue", {
      description: "queue work",
      handler: async () => {
        api.sendUserMessage("later", { deliverAs: "followUp" });
        api.sendUserMessage("now", { deliverAs: "steer" });
      },
    });
    const agent = fakeAgent("queue-agent");
    const result = await ctx.__commands[0].handler({
      agent,
      rawInput: "",
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ kind: "success" });
    expect(agent.__followups[0]).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "later" }],
      source: { kind: "plugin", plugin: "dsh-sparkles" },
    });
    expect(agent.__steers[0].content[0].text).toBe("now");
  });

  test("parallel tool notifications remain invocation-local", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx });
    let releaseFirst;
    const firstPaused = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    api.registerTool({
      name: "parallel_probe",
      description: "parallel",
      parameters: { type: "object", properties: {}, additionalProperties: true },
      executionMode: "parallel",
      execute: async (_id, input, _signal, _updates, context) => {
        context.ui.notify(input.label, "info");
        if (input.wait) await firstPaused;
        return { content: [{ type: "text", text: input.label }], details: {} };
      },
    });
    const first = ctx.__tools[0].execute(
      { label: "first", wait: true },
      toolRunContext(fakeAgent("first"), "first-call"),
    );
    const second = await ctx.__tools[0].execute(
      { label: "second", wait: false },
      toolRunContext(fakeAgent("second"), "second-call"),
    );
    releaseFirst();
    const firstResult = await first;
    expect(second.content.map((block) => block.text)).toEqual(["second", "second"]);
    expect(firstResult.content.map((block) => block.text)).toEqual(["first", "first"]);
  });

  test("Pi inline images are omitted instead of forged as DSH image blocks", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx });
    api.registerTool({
      name: "chart",
      description: "chart",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({
        content: [
          { type: "text", text: "chart rows" },
          { type: "image", data: "ZmFrZQ==", mimeType: "image/png" },
        ],
        details: { points: [1, 2] },
      }),
    });
    const result = await ctx.__tools[0].execute({}, toolRunContext());
    expect(result).toEqual({
      content: [{ type: "text", text: "chart rows" }],
      details: { points: [1, 2] },
    });
  });

  test("Pi terminate results conclude the DSH turn without leaking schema fields", async () => {
    const ctx = fakeCtx();
    const api = createPiApi({ ctx });
    api.registerTool({
      name: "terminal",
      description: "terminal",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({
        content: [{ type: "text", text: "done" }],
        details: {},
        terminate: true,
      }),
    });
    let concluded = false;
    const run = toolRunContext();
    run.concludeTurn = () => {
      concluded = true;
    };
    const result = await ctx.__tools[0].execute({}, run);
    expect(concluded).toBeTrue();
    expect(result.terminate).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "done" }]);
  });

  test("createPlugin guards duplicate named registrations", async () => {
    const ctx = fakeCtx();
    const extension = (name) => (api) => {
      api.registerTool({
        name,
        description: "dup",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
      });
      return Promise.resolve(undefined);
    };
    const plugin = createPlugin(
      [["first", extension("same_tool")], ["second", extension("same_tool")]],
      [],
      "dsh-sparkles",
      [],
      new Set(),
    );
    await expect(plugin.apply(ctx, {})).rejects.toThrow(/Registration collision for registerTool 'same_tool'/);
  });

  test("createPlugin follows DSH agent session lifecycle", async () => {
    const ctx = fakeCtx();
    const started = [];
    const knownSessionEventTypes = new Set(["turn/start"]);
    const extension = (api) => {
      api.on("session_start", () => started.push("started"));
      api.registerTool({
        name: "only",
        description: "only tool",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
      });
      return Promise.resolve(undefined);
    };
    const plugin = createPlugin(
      [["only", extension]],
      [],
      "dsh-sparkles",
      [],
      knownSessionEventTypes,
    );
    expect(plugin.inject).toEqual(["tools", "commands", "agents", "systemPrompt"]);
    await plugin.apply(ctx, {});
    expect(knownSessionEventTypes).toEqual(
      new Set(["turn/start", DSH_CUSTOM_EVENT, DSH_STATUS_EVENT]),
    );
    expect(ctx.__tools).toHaveLength(1);
    expect(started).toEqual([]);
    await ctx.__emit("agent/session-start", {
      agent: fakeAgent(),
      source: "startup",
    });
    expect(started).toEqual(["started"]);
  });

  test("scoped Pi counterparts get isolated registrations, state, lifecycle, and prompt", async () => {
    const root = fakeCtx();
    const starts = [];
    const extension = (api) => {
      let count = 0;
      api.on("before_agent_start", () => Promise.resolve({ systemPrompt: "shared" }));
      api.on("session_tree", () => Promise.resolve());
      api.on("session_start", (_event, context) => {
        count += 1;
        starts.push(context.sessionManager.getSessionId());
        context.ui.setStatus("finance-track", `count:${count}`);
        return Promise.resolve();
      });
      api.registerTool({
        name: "scoped_counter",
        description: "counter",
        parameters: { type: "object", properties: {}, additionalProperties: false },
        execute: async () => ({
          content: [{ type: "text", text: String(count) }],
          details: { count },
        }),
      });
      return Promise.resolve();
    };
    const plugin = createPlugin(
      [],
      [],
      "dsh-sparkles",
      [["state", extension, { systemPrompt: "shared", promptName: "shared-state" }]],
      new Set(),
    );
    await plugin.apply(root, {});

    const first = fakeAgent("first");
    first.ctx = fakeCtx({ guardInjectedServices: true });
    const second = fakeAgent("second");
    second.ctx = fakeCtx({ guardInjectedServices: true });
    await root.__emit("agent/created", { agent: first });
    await root.__emit("agent/created", { agent: second });
    expect(root.__tools).toHaveLength(0);
    expect(first.ctx.__tools.map((tool) => tool.name)).toEqual(["scoped_counter"]);
    expect(second.ctx.__tools.map((tool) => tool.name)).toEqual(["scoped_counter"]);
    expect(first.ctx.__promptSections).toHaveLength(1);
    expect(first.ctx.__promptSections[0]).toMatchObject({
      name: "shared-state",
      order: 99,
    });
    expect(first.ctx.__promptSections[0].text).toMatch(
      /^shared\nDSH runtime date: \d{4}-\d{2}-\d{2}\./,
    );
    expect(first.ctx.__promptSections[0].text).toContain(
      "never invoke a shell merely to discover today's date",
    );

    await root.__emit("agent/session-start", { agent: first, source: "startup" });
    await root.__emit("agent/session-start", { agent: second, source: "resume" });
    expect(starts).toEqual(["session-first", "session-second"]);
    expect(first.session.snapshotEvents().at(-1).data.text).toBe("count:1");
    expect(second.session.snapshotEvents().at(-1).data.text).toBe("count:1");
    const firstResult = await first.ctx.__tools[0].execute(
      {},
      toolRunContext(first, "first-counter"),
    );
    const secondResult = await second.ctx.__tools[0].execute(
      {},
      toolRunContext(second, "second-counter"),
    );
    expect(firstResult.details.count).toBe(1);
    expect(secondResult.details.count).toBe(1);
  });

  test("status projection folds updates and the client registers shell.overlay", () => {
    const projection = statusProjection();
    expect(projection.key).toBe(STATUS_PROJECTION_KEY);
    let state = projection.init();
    state = projection.apply(state, {
      type: "pi-sparkles/status",
      data: { key: "finance-track", text: "HK · HKD" },
    });
    expect(projection.stateSchema.parse(state)).toEqual({
      "finance-track": "HK · HKD",
    });
    expect(projection.wire.viewSchema.parse(projection.wire.view(state))).toEqual({
      values: { "finance-track": "HK · HKD" },
    });
    expect(projection.schema).toBeUndefined();
    expect(projection.view).toBeUndefined();
    const unchanged = projection.apply(state, { type: "turn/start", data: {} });
    expect(unchanged).toBe(state);

    let loaded;
    const stateUpdates = [];
    const window = {
      innerWidth: 1280,
      innerHeight: 720,
      __ModuleLoader__: {
        load(definition) {
          loaded = definition.factory((name) => {
            if (name === "react") {
              return {
                createElement(type, props, ...children) {
                  return {
                    type,
                    props,
                    child: children.length <= 1 ? children[0] : children,
                  };
                },
                useRef(value) {
                  return { current: value };
                },
                useState(value) {
                  return [value, (next) => stateUpdates.push(next)];
                },
              };
            }
            throw new Error(`unexpected client module: ${name}`);
          });
        },
      },
    };
    new Function("window", dshClientFactorySource("@fixture/dsh"))(window);
    const registered = new Map();
    const injected = [];
    loaded.apply({
      slots: {
        inject(name, callback) {
          injected.push(name);
          callback();
        },
        register(definition, component) {
          registered.set(definition.name, { definition, component });
          return () => {};
        },
      },
    });
    expect(injected).toEqual(["shell.overlay", "tool.call.toolview"]);
    const overlay = registered.get("shell.overlay");
    expect(overlay.definition).toMatchObject({
      name: "shell.overlay",
      id: "pi-sparkles-finance-track",
    });
    expect(registered.get("tool.call.toolview").definition).toMatchObject({
      name: "tool.call.toolview",
      key: "chart_ohlcv",
    });
    const rendered = overlay.component({
      useSessions: (selector) => selector({
        current: "s1",
        byId: {
          s1: {
            projectionValues: {
              piSparklesStatus: { values: { "finance-track": "US · USD" } },
            },
          },
        },
      }),
    });
    expect(rendered).toMatchObject({
      type: "div",
      props: {
        role: "status",
        tabIndex: 0,
        "data-dsh-sparkles-overlay": "finance-track",
        style: { cursor: "grab", touchAction: "none" },
      },
      child: "US · USD",
    });
    let captured = false;
    const overlayNode = {
      offsetParent: {
        getBoundingClientRect: () => ({ left: 100, top: 50, width: 1000, height: 700 }),
      },
      getBoundingClientRect: () => ({ left: 900, top: 700, width: 200, height: 30 }),
      setPointerCapture(pointerId) {
        expect(pointerId).toBe(7);
        captured = true;
      },
      hasPointerCapture: () => captured,
      releasePointerCapture(pointerId) {
        expect(pointerId).toBe(7);
        captured = false;
      },
    };
    let prevented = 0;
    rendered.props.onPointerDown({
      button: 0,
      pointerId: 7,
      clientX: 900,
      clientY: 700,
      currentTarget: overlayNode,
      preventDefault: () => prevented += 1,
    });
    rendered.props.onPointerMove({
      pointerId: 7,
      clientX: 650,
      clientY: 500,
      currentTarget: overlayNode,
      preventDefault: () => prevented += 1,
    });
    expect(stateUpdates).toContainEqual({ left: 550, top: 450 });
    rendered.props.onPointerUp({ pointerId: 7, currentTarget: overlayNode });
    expect(captured).toBe(false);
    expect(prevented).toBe(2);
    rendered.props.onDoubleClick();
    expect(stateUpdates.at(-1)).toBeNull();
  });

  test("unsupported Pi host effects fail explicitly", () => {
    const api = createPiApi({ ctx: fakeCtx() });
    expect(() => api.registerShortcut("x", {})).toThrow(
      "Pi API registerShortcut is not supported",
    );
    expect(() => api.on("before_agent_start", () => {})).toThrow(
      "Pi API on('before_agent_start') is not supported",
    );
    expect(() => api.appendEntry("outside", {})).toThrow(
      "requires an active DSH agent/session invocation",
    );
  });
});
