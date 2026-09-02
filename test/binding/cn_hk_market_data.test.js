import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const artifacts = {
  cn: resolve(import.meta.dir, "../../dist/cn_market_data/index.js"),
  hk: resolve(import.meta.dir, "../../dist/hk_market_data/index.js"),
};

const originalFetch = globalThis.fetch;
const requests = [];

function quoteFixture(code) {
  if (code === "00700") {
    return {
      rc: 0,
      data: {
        f43: 492200,
        f44: 497800,
        f45: 482200,
        f46: 493400,
        f47: 25662478,
        f57: "00700",
        f58: "腾讯控股",
        f59: 3,
        f60: 487600,
        f86: 1785917339,
      },
    };
  }
  return {
    rc: 0,
    data: {
      f43: 1516,
      f44: 1531,
      f45: 1460,
      f46: 1477,
      f47: 100327,
      f51: 1921,
      f52: 1035,
      f57: "920079",
      f58: "乔路铭",
      f59: 2,
      f60: 1478,
      f86: 1785915322,
    },
  };
}

function historyFixture(code) {
  return {
    rc: 0,
    data: {
      code,
      name: code === "00700" ? "腾讯控股" : "乔路铭",
      klines: [
        "2026-08-03,14.77,14.91,15.20,14.60,90000,1350000.00,4.06,0.95,0.14,1.23",
        "2026-08-04,14.91,15.16,15.31,14.80,100327,1516000.00,3.42,1.68,0.25,1.37",
      ],
    },
  };
}

function sinaStar50Fixture() {
  return [
    {
      day: "2026-08-03",
      open: "1000.10",
      high: "1012.30",
      low: "998.20",
      close: "1008.50",
      volume: "123456789",
    },
    {
      day: "2026-08-04",
      open: "1008.50",
      high: "1020.40",
      low: "1003.60",
      close: "1018.20",
      volume: "135791357",
    },
  ];
}

function moversFixture() {
  return {
    rc: 0,
    data: {
      total: 3,
      diff: [
        {
          f2: 18.21,
          f3: 19.9876,
          f4: 3.03,
          f5: 100001,
          f6: 1821000.25,
          f8: 6.5,
          f12: "688001",
          f13: 1,
          f14: "测试甲",
          f15: 18.21,
          f16: 15.01,
          f17: 15.18,
          f18: 15.18,
          f20: 1821000000,
          f21: 910500000,
        },
        {
          f2: 12.34,
          f3: 10.001,
          f4: 1.12,
          f5: 200002,
          f6: 2468000,
          f8: 3.25,
          f12: "300001",
          f13: 0,
          f14: "测试乙",
          f15: 12.5,
          f16: 11.2,
          f17: 11.3,
          f18: 11.22,
          f20: 1234000000,
          f21: 617000000,
        },
      ],
    },
  };
}

beforeEach(() => {
  requests.length = 0;
  process.env.AGENT_CONTACT = "market-data@example.test";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({ url, headers });
    if (url.hostname === "money.finance.sina.com.cn") {
      return new Response(JSON.stringify(sinaStar50Fixture()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const code = url.searchParams.get("secid")?.split(".").at(-1);
    const body = url.pathname.endsWith("/clist/get")
      ? moversFixture()
      : url.pathname.endsWith("/stock/get")
        ? quoteFixture(code)
        : historyFixture(code);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.AGENT_CONTACT;
});

async function harness(track) {
  const tools = new Map();
  const sessionEntries = [];
  const api = {
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    appendEntry(customType, data) {
      sessionEntries.push({ customType, data });
    },
  };
  const module = await import(
    `${artifacts[track]}?market-data=${Date.now()}-${Math.random()}`
  );
  await module.default(api);
  tools.sessionEntries = sessionEntries;
  return tools;
}

async function execute(tool, input) {
  return tool.execute(
    "market-data-query",
    input,
    new AbortController().signal,
    undefined,
    { hasUI: false, ui: {} },
  );
}

describe("isolated CN/HK Eastmoney market-data boundaries", () => {
  test("CN preserves explicit BSE identity, source scaling, and raw bars", async () => {
    const tools = await harness("cn");
    expect([...tools.keys()].sort()).toEqual([
      "cn_market_movers",
      "cn_raw_vendor_history",
      "cn_raw_vendor_quote",
    ]);
    expect(tools.get("cn_raw_vendor_history").description).toContain(
      "reviewed CSI sector index",
    );
    const historyProperties = tools.get("cn_raw_vendor_history").parameters.properties;
    expect(historyProperties.endDate.description).toContain(
      "never send a future date",
    );
    expect(historyProperties.limit.description).toContain(
      "must cover the requested window's expected sessions",
    );
    expect(tools.get("cn_raw_vendor_quote").description).toContain(
      "reviewed benchmark and sector indices are rejected locally",
    );

    const quote = await execute(tools.get("cn_raw_vendor_quote"), {
      venue: "bse",
      code: "920079",
    });
    expect(quote.details.track).toBe("cn");
    expect(quote.details.instrumentKind).toBe("listed_security");
    expect(quote.details.trackContext.venueMic).toBe("XBSE");
    expect(quote.details.market).toBe("cn_bse");
    expect(quote.details.last).toBe("15.16");
    expect(quote.details.priceLimitUp).toBe("19.21");
    expect(quote.details.declaredCurrency).toBe("CNY");
    expect(quote.details.latency).toBe("unknown");
    expect(quote.details.redistribution).toBe("unknown");
    expect(quote.details.retrievedAtUnixMilliseconds).toBeGreaterThan(0);

    const history = await execute(tools.get("cn_raw_vendor_history"), {
      provider: "eastmoney",
      venue: "bse",
      code: "920079",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      limit: 10,
    });
    expect(history.details.track).toBe("cn");
    expect(history.details.instrumentKind).toBe("listed_security");
    expect(history.details.adjustment).toBe("raw_unadjusted_fqt_0");
    expect(history.details.bars[0].amount).toBe("1350000.00");
    expect(history.details.bars[1].close).toBe("15.16");
    expect(history.details.sourceReference).toBe(
      "eastmoney:cn:cn_bse:920079:2026-08-01:2026-08-05:raw_unadjusted_fqt_0",
    );
    expect(history.details.acquisitionReceipt).toMatchObject({
      scope: "bounded_raw_daily_csv_v1",
      providerAuthenticated: false,
    });
    expect(history.details.acquisitionReceipt.canonicalSha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(history.content[0].text).toContain(
      "Complete bounded daily rows follow as CSV",
    );
    expect(history.content[0].text).toContain(
      "do not establish intraday ordering, market breadth, fund flow, or sector rotation",
    );
    expect(history.content[0].text).not.toContain("call the installed Pi tools");
    expect(history.content[0].text).not.toContain("TUSHARE_TOKEN");
    expect(history.content[0].text).toContain(
      `sourceReference=${history.details.sourceReference}`,
    );
    expect(history.content[0].text).toContain(
      `acquisitionReceiptCanonicalSha256=${history.details.acquisitionReceipt.canonicalSha256}`,
    );
    expect(history.content[0].text).toContain(
      `seriesReceipt=${history.details.acquisitionReceipt.canonicalSha256}`,
    );
    expect(tools.sessionEntries).toHaveLength(1);
    expect(tools.sessionEntries[0]).toMatchObject({
      customType: "pi_sparkles_finance_ohlcv.series_handoff.v1",
      data: {
        schema: "pi-sparkles/ohlcv-series-handoff",
        schemaVersion: 1,
        track: "cn",
        instrumentId: "920079",
        mic: "XBSE",
        acquisitionReceipt:
          history.details.acquisitionReceipt.canonicalSha256,
      },
    });
    expect(history.content[0].text).toContain(
      "2026-08-04,14.91,15.31,14.80,15.16,100327,1516000.00",
    );
    expect(typeof tools.get("cn_raw_vendor_history").renderResult).toBe(
      "function",
    );
    const theme = { fg: (_color, text) => text };
    const collapsed = tools
      .get("cn_raw_vendor_history")
      .renderResult(
        history,
        { expanded: false, isPartial: false },
        theme,
        {},
      )
      .render(500)
      .join("\n");
    expect(collapsed).toContain("2 bars");
    expect(collapsed).not.toContain("date,open,high,low,close");
    const expanded = tools
      .get("cn_raw_vendor_history")
      .renderResult(
        history,
        { expanded: true, isPartial: false },
        theme,
        {},
      )
      .render(500)
      .join("\n");
    expect(expanded).toContain("date,open,high,low,close,volume,amount");
    expect(requests[0].url.searchParams.get("secid")).toBe("0.920079");
    expect(requests[0].headers.get("user-agent")).toContain(
      "market-data@example.test",
    );
  });

  test("CN movers preserves one provider-ranked page without turning it into analysis", async () => {
    const tools = await harness("cn");
    const result = await execute(tools.get("cn_market_movers"), { limit: 2 });

    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe("/api/qt/clist/get");
    expect(requests[0].url.searchParams.get("fid")).toBe("f3");
    expect(requests[0].url.searchParams.get("po")).toBe("1");
    expect(requests[0].url.searchParams.get("pz")).toBe("2");
    expect(result.details).toMatchObject({
      track: "cn",
      provider: "eastmoney",
      requestedLimit: 2,
      providerReportedTotal: 3,
      returnedRows: 2,
      providerOrder: {
        preserved: true,
        validatedNonIncreasing: true,
        pluginCreatedRanking: false,
      },
      acquisitionReceipt: {
        logicalProviderRequestCount: 1,
        transportAttemptCount: 1,
        retryAllowed: false,
      },
      identityResolutionPerformed: false,
      securityKindVerified: false,
      calculationPerformed: false,
      recommendationPerformed: false,
      numericInterpretation: {
        rawProviderLexemesOnly: true,
        currency: "unknown",
        amountUnit: "unknown",
        volumeUnit: "unknown",
        marketCapitalizationUnit: "unknown",
        scale: "unknown",
        priceCurrencyLabelAllowed: false,
        lastIsOfficialClose: false,
        marketSessionState: "unknown",
        amountAndCapitalizationConversionAllowed: false,
        priceLimitInferenceAllowed: false,
      },
      trackApplicabilityReview: {
        cn: "supported_by_this_exact_adapter",
        hk: { status: "track_partial" },
        us: { status: "track_partial" },
      },
    });
    expect(result.details.rows).toHaveLength(2);
    expect(tools.get("cn_market_movers").promptSnippet).toContain(
      "do not automatically fan out per-row enrichment",
    );
    expect(tools.get("cn_market_movers").promptSnippet).toContain(
      "convert unresolved amount or capitalization fields",
    );
    expect(tools.get("cn_market_movers").promptSnippet).toContain(
      "append CNY/RMB/yuan to price-like fields",
    );
    expect(tools.get("cn_market_movers").promptSnippet).toContain(
      "provider-filtered CN listing-category rows, not verified A-share instruments",
    );
    expect(tools.get("cn_market_movers").promptSnippet).toContain(
      "latest lexeme as an official close",
    );
    expect(result.details.rows[0]).toMatchObject({
      providerPosition: 1,
      code: "688001",
      changePercent: {
        state: "observed_provider_lexeme",
        raw: "19.9876",
      },
    });
    expect(result.content[0].text).toContain("MODEL_DATA");
    expect(result.content[0].text).toContain("completeness");
  });

  test("CN movers does not retry a failed provider page", async () => {
    globalThis.fetch = async (input, init) => {
      requests.push({ url: new URL(String(input)), headers: new Headers(init?.headers) });
      return new Response("provider unavailable", { status: 503 });
    };
    const tools = await harness("cn");

    await expect(
      execute(tools.get("cn_market_movers"), { limit: 10 }),
    ).rejects.toThrow("without retry");
    expect(requests).toHaveLength(1);
  });

  test("rejects mismatched reviewed benchmark and sector identities before accidental I/O", async () => {
    const tools = await harness("cn");
    expect(requests).toHaveLength(0);

    try {
      await execute(tools.get("cn_raw_vendor_quote"), {
        venue: "sse",
        code: "000001",
      });
      throw new Error("expected quote rejection");
    } catch (error) {
      expect(error.code).toBe("unsupported_instrument_kind");
      expect(error.details).toMatchObject({
        track: "cn",
        instrumentCode: "000001",
        instrumentKind: "benchmark_index",
        recommendedTool: "cn_market_overview",
      });
    }
    expect(requests).toHaveLength(0);

    await expect(
      execute(tools.get("cn_raw_vendor_history"), {
        provider: "eastmoney",
        venue: "szse",
        code: "399001",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        limit: 10,
      }),
    ).rejects.toMatchObject({ code: "instrument_kind_mismatch" });
    expect(requests).toHaveLength(0);

    const history = await execute(tools.get("cn_raw_vendor_history"), {
      provider: "eastmoney",
      venue: "szse",
      code: "399001",
      instrumentKind: "benchmark_index",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      limit: 10,
    });
    expect(history.details.instrumentKind).toBe("benchmark_index");
    expect(requests).toHaveLength(1);

    const star50 = await execute(tools.get("cn_raw_vendor_history"), {
      provider: "eastmoney",
      venue: "sse",
      code: "000688",
      instrumentKind: "benchmark_index",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      limit: 10,
    });
    expect(star50.details).toMatchObject({
      track: "cn",
      code: "000688",
      instrumentKind: "benchmark_index",
    });
    expect(requests).toHaveLength(2);

    await expect(
      execute(tools.get("cn_raw_vendor_quote"), {
        venue: "sse",
        code: "000928",
      }),
    ).rejects.toMatchObject({
      code: "unsupported_instrument_kind",
      details: {
        instrumentKind: "sector_index",
        recommendedTool: "cn_sector_series",
      },
    });
    await expect(
      execute(tools.get("cn_raw_vendor_history"), {
        provider: "eastmoney",
        venue: "sse",
        code: "000928",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
      }),
    ).rejects.toMatchObject({
      code: "instrument_kind_mismatch",
      details: {
        instrumentKind: "sector_index",
        recommendedTool: "cn_sector_series",
      },
    });
    await expect(
      execute(tools.get("cn_raw_vendor_history"), {
        provider: "eastmoney",
        venue: "sse",
        code: "801780",
        instrumentKind: "sector_index",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
      }),
    ).rejects.toMatchObject({ code: "unsupported_sector_identity" });
    expect(requests).toHaveLength(2);

    const sector = await execute(tools.get("cn_raw_vendor_history"), {
      provider: "eastmoney",
      venue: "sse",
      code: "000928",
      instrumentKind: "sector_index",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      limit: 10,
    });
    expect(sector.details.instrumentKind).toBe("sector_index");
    expect(requests).toHaveLength(3);
  });

  test("STAR 50 Eastmoney failure only prompts Sina, then an explicit Sina call states the source change", async () => {
    const tools = await harness("cn");
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, headers: new Headers(init?.headers) });
      if (url.hostname !== "push2his.eastmoney.com") {
        throw new Error(`unexpected provider ${url.hostname}`);
      }
      return new Response("provider unavailable", { status: 503 });
    };

    let failure;
    try {
      await execute(tools.get("cn_raw_vendor_history"), {
        provider: "eastmoney",
        venue: "sse",
        code: "000688",
        instrumentKind: "benchmark_index",
        startDate: "2026-08-01",
        endDate: "2026-08-05",
        limit: 10,
      });
    } catch (error) {
      failure = error;
    }
    expect(requests.map(({ url }) => url.hostname)).toEqual([
      "push2his.eastmoney.com",
    ]);
    expect(failure).toMatchObject({
      code: "provider_history_failed_sina_available",
      details: {
        failedProvider: "eastmoney",
        suggestedProvider: "sina",
        sinaCalled: false,
        automaticFallbackAllowed: false,
        requiresExplicitUserChoice: true,
        recommendedTool: "cn_raw_vendor_history",
      },
    });
    expect(failure.message).toContain("Sina was not called");
    expect(failure.message).toContain("only after the user explicitly chooses Sina");
    expect(tools.sessionEntries).toHaveLength(0);

    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, headers: new Headers(init?.headers) });
      if (url.hostname !== "money.finance.sina.com.cn") {
        throw new Error(`unexpected provider ${url.hostname}`);
      }
      return new Response(JSON.stringify(sinaStar50Fixture()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const result = await execute(tools.get("cn_raw_vendor_history"), {
      provider: "sina",
      venue: "sse",
      code: "000688",
      instrumentKind: "benchmark_index",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      limit: 10,
    });

    expect(requests.map(({ url }) => url.hostname)).toEqual([
      "push2his.eastmoney.com",
      "money.finance.sina.com.cn",
    ]);
    expect(result.details).toMatchObject({
      provider: "sina",
      selectedProvider: "sina",
      selectionMode: "explicit_user_choice",
      fallbackPerformed: false,
      dataSourceChange: "eastmoney->sina_by_explicit_user_choice",
      route: "explicit_alternative",
      code: "000688",
      instrumentKind: "benchmark_index",
      priceUnit: "index_points",
      declaredCurrency: null,
      amountUnit: null,
    });
    expect(result.details.providerAttempts).toEqual([{
      provider: "sina",
      outcome: "selected",
      error: null,
    }]);
    expect(result.details.sourceReference).toContain("symbol=sh000688");
    expect(result.details.bars[0].amount).toBeNull();
    expect(result.content[0].text).toContain(
      "DATA SOURCE CHANGED BY EXPLICIT USER CHOICE: eastmoney -> sina",
    );
    expect(result.content[0].text).toContain(
      "No automatic fallback was performed",
    );
    expect(tools.sessionEntries).toHaveLength(1);
    expect(tools.sessionEntries[0]).toMatchObject({
      customType: "pi_sparkles_finance_ohlcv.series_handoff.v1",
      data: {
        track: "cn",
        provider: "sina",
        instrumentId: "000688",
        mic: "XSHG",
      },
    });
  });

  test("HK never assumes currency and retains its five-digit market ID", async () => {
    const tools = await harness("hk");
    expect([...tools.keys()].sort()).toEqual([
      "hk_stock_history",
      "hk_stock_quote",
    ]);

    const quote = await execute(tools.get("hk_stock_quote"), {
      code: "00700",
      currency: "HKD",
    });
    expect(quote.details.track).toBe("hk");
    expect(quote.details.trackContext.venueMic).toBe("XHKG");
    expect(quote.details.last).toBe("492.200");
    expect(quote.details.declaredCurrency).toBe("HKD");
    expect(quote.details.currencyEvidence).toBe(
      "caller_declared_not_provider_verified",
    );
    expect(quote.details.priceLimitUp).toBeNull();
    expect(requests[0].url.searchParams.get("secid")).toBe("116.00700");

    const history = await execute(tools.get("hk_stock_history"), {
      code: "00700",
      currency: "HKD",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      limit: 10,
    });
    expect(history.details.track).toBe("hk");
    expect(history.details.currencyEvidence).toBe(
      "caller_declared_not_provider_verified",
    );
    expect(history.details.bars).toHaveLength(2);
    expect(history.details.sourceReference).toBe(
      "eastmoney:hk:XHKG:00700:2026-08-01:2026-08-05:raw_unadjusted_fqt_0",
    );
    expect(history.details.acquisitionReceipt.canonicalSha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(history.content[0].text).toContain(
      "Complete bounded daily rows follow as CSV",
    );
    expect(history.content[0].text).toContain(
      "do not establish intraday ordering, market breadth, fund flow, or sector rotation",
    );
    expect(history.content[0].text).not.toContain("call the installed Pi tools");
    expect(history.content[0].text).toContain(
      "2026-08-04,14.91,15.31,14.80,15.16,100327,1516000.00",
    );
    expect(history.content[0].text).toContain(
      `seriesReceipt=${history.details.acquisitionReceipt.canonicalSha256}`,
    );
    expect(tools.sessionEntries.at(-1)).toMatchObject({
      customType: "pi_sparkles_finance_ohlcv.series_handoff.v1",
      data: {
        track: "hk",
        instrumentId: "00700",
        mic: "XHKG",
        priceUnit: "HKD",
        acquisitionReceipt:
          history.details.acquisitionReceipt.canonicalSha256,
      },
    });
    expect(typeof tools.get("hk_stock_history").renderResult).toBe("function");
    const theme = { fg: (_color, text) => text };
    const collapsed = tools
      .get("hk_stock_history")
      .renderResult(
        history,
        { expanded: false, isPartial: false },
        theme,
        {},
      )
      .render(500)
      .join("\n");
    expect(collapsed).toContain("2 bars");
    expect(collapsed).not.toContain("date,open,high,low,close");
    const expanded = tools
      .get("hk_stock_history")
      .renderResult(
        history,
        { expanded: true, isPartial: false },
        theme,
        {},
      )
      .render(500)
      .join("\n");
    expect(expanded).toContain("date,open,high,low,close,volume,amount");
  });
});
