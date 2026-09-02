import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const originalFetch = globalThis.fetch;
const requests = [];

const cnFixture =
  '{"rc":0,"data":{"code":"600519","name":"贵州茅台","klines":["2024-08-01,1350.6000,1358.98,1363.35,1346.00,36147,4898665275.00,1.28,0.62,8.38,0.29","2024-08-02,1358.98,1328.36,1360.00,1320.00,37450,5004070406.00,2.94,-2.25,-30.62,0.30"]}}';

const hkFixture =
  '{"rc":0,"data":{"code":"00700","name":"腾讯控股","klines":["2024-08-01,370.200,372.400,375.000,368.600,15432100,5743210000.00,1.72,0.59,2.20,0.25","2024-08-02,372.400,368.800,373.600,367.000,17654300,6521000000.00,1.77,-0.97,-3.60,0.29"]}}';

const sinaFixture =
  '[{"day":"2024-08-01","open":"1350.6000","high":"1363.35","low":"1346.00","close":"1358.98","volume":"36147"},{"day":"2024-08-02","open":"1358.98","high":"1360.00","low":"1320.00","close":"1328.36","volume":"37450"}]';

beforeEach(() => {
  requests.length = 0;
  process.env.AGENT_CONTACT = "market-data@example.test";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({ url, headers });
    const body = url.searchParams.get("secid")?.startsWith("116.")
      ? hkFixture
      : cnFixture;
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.AGENT_CONTACT;
});

async function harness(name) {
  const tools = new Map();
  tools.sessionEntries = [];
  const api = {
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    appendEntry(customType, data) {
      tools.sessionEntries.push({
        type: "custom",
        id: `session-entry-${tools.sessionEntries.length + 1}`,
        parentId: null,
        timestamp: "2026-08-19T00:00:00.000Z",
        customType,
        data,
      });
    },
  };
  const artifact = resolve(import.meta.dir, `../../dist/${name}/index.js`);
  const module = await import(`${artifact}?ohlcv=${Date.now()}-${Math.random()}`);
  await module.default(api);
  return tools;
}

async function execute(tool, input, executionContext = { hasUI: false, ui: {} }) {
  return tool.execute(
    "eastmoney-ohlcv-query",
    input,
    new AbortController().signal,
    undefined,
    executionContext,
  );
}

function receiptDigest(receipt) {
  const canonical = {
    schema: receipt.schema,
    schema_version: receipt.schemaVersion,
    track: receipt.venue === "hk" ? "hk" : "cn",
    provider: receipt.provider,
    venue: receipt.venue,
    board: receipt.board,
    share_class: receipt.shareClass,
    currency: receipt.currency,
    code: receipt.code,
    start_date: receipt.startDate,
    end_date: receipt.endDate,
    limit: String(receipt.limit),
    source_reference: receipt.sourceReference,
    retrieved_at_unix_ms: String(receipt.retrievedAtUnixMilliseconds),
    pagination: receipt.pagination,
    pages: receipt.pages.map((page) => ({
      sequence: page.sequence,
      request_id: page.requestId,
      byte_length: String(page.byteLength),
      content_sha256: page.contentSha256,
    })),
    bar_dates: receipt.barDates,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

describe("CN/HK Eastmoney OHLCV boundaries", () => {
  test("normalizes exact CN rows without inventing timestamps or volume units", async () => {
    const tools = await harness("cn_ohlcv");
    expect([...tools.keys()]).toEqual(["cn_stock_ohlcv"]);

    const result = await execute(tools.get("cn_stock_ohlcv"), {
      provider: "eastmoney",
      venue: "sse",
      board: "main",
      shareClass: "a_share",
      code: "600519",
      currency: "CNY",
      startDate: "2024-08-01",
      endDate: "2024-08-02",
      limit: 3,
    });

    expect(result.details.track).toBe("cn");
    expect(result.details.trackContext.marketScope).toBe("cn_stock_ohlcv");
    expect(result.details.trackContext.venueMic).toBe("XSHG");
    expect(result.details.trackContext.board).toBe("main");
    expect(result.details.trackContext.timezone).toBe("Asia/Shanghai");
    expect(result.details.provider).toBe("eastmoney");
    expect(result.details.shareClass).toBe("a_share");
    expect(result.details.currency).toBe("CNY");
    expect(result.details.currencyEvidence).toBe(
      "caller_declared_not_provider_verified",
    );
    expect(result.details.volumeUnit).toBe("unknown");
    expect(result.details.providerVolumeUnit).toBeNull();
    expect(result.details.adjustment).toBe("raw");
    expect(result.details.session).toBe(
      "eastmoney_klt_101_provider_aggregation",
    );
    expect(result.details.pagination.state).toBe("complete");
    expect(result.details.calendarCompleteness.state).toBe(
      "calendar_not_assessed",
    );
    expect(result.details.bars).toHaveLength(2);
    expect(result.details.bars[0].asOfBasis).toBe("session_date_anchor");
    expect(result.details.bars[0].providerDate).toBe("2024-08-01");
    expect(result.details.bars[0].raw.open).toBe("1350.6000");
    expect(result.details.bars[0].normalized.open).toBe("1350.6");
    expect(result.details.providerRows[0].amount).toBe("4898665275.00");
    expect(result.content[0].text).toContain(
      "Complete bounded daily rows follow as CSV",
    );
    expect(result.content[0].text).toContain("pass only seriesReceipt");
    expect(result.content[0].text).toContain(
      "never manufacture an instructionRef or use a script",
    );
    expect(result.content[0].text).toContain(
      "2024-08-01,1350.6000,1363.35,1346.00,1358.98,36147,4898665275.00",
    );

    const receipt = result.details.gapAssessmentReceipt;
    expect(receipt).toMatchObject({
      schema: "pi-sparkles/cn-ohlcv-gap-receipt",
      schemaVersion: 1,
      digestAlgorithm: "sha256",
      provider: "eastmoney",
      venue: "sse",
      board: "main",
      shareClass: "a_share",
      currency: "CNY",
      code: "600519",
      startDate: "2024-08-01",
      endDate: "2024-08-02",
      limit: 3,
      pagination: "complete",
      barDates: ["2024-08-01", "2024-08-02"],
      integrity: {
        state: "sha256_content_bound",
        scope: "canonical_cn_gap_projection_v1",
        providerAuthenticated: false,
      },
    });
    expect(receipt.sourceReference).toBe(
      "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.600519&klt=101&fqt=0&beg=20240801&end=20240802&lmt=3",
    );
    expect(result.details.sourceReference).toBe(receipt.sourceReference);
    expect(result.content[0].text).toContain(
      `sourceReference=${receipt.sourceReference}`,
    );
    expect(receipt.pages).toEqual([
      {
        sequence: 1,
        requestId: null,
        byteLength: Buffer.byteLength(cnFixture),
        contentSha256: createHash("sha256").update(cnFixture).digest("hex"),
      },
    ]);
    expect(receipt.digest).toBe(receiptDigest(receipt));
    expect(result.details.seriesReceipt).toMatch(/^[0-9a-f]{64}$/);
    expect(result.details.seriesReceipt).not.toBe(result.details.acquisitionReceipt);
    expect(result.content[0].text).toContain(
      `seriesReceipt=${result.details.seriesReceipt}`,
    );
    expect(tools.sessionEntries).toHaveLength(1);
    expect(tools.sessionEntries[0]).toMatchObject({
      customType: "pi_sparkles_finance_ohlcv.series_handoff.v1",
      data: {
        schema: "pi-sparkles/ohlcv-series-handoff",
        schemaVersion: 1,
        track: "cn",
        instrumentId: "600519",
        mic: "XSHG",
        acquisitionReceipt: result.details.seriesReceipt,
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url.hostname).toBe("push2his.eastmoney.com");
    expect(requests[0].url.pathname).toBe("/api/qt/stock/kline/get");
    expect(requests[0].url.searchParams.get("secid")).toBe("1.600519");
    expect(requests[0].url.searchParams.get("klt")).toBe("101");
    expect(requests[0].url.searchParams.get("fqt")).toBe("0");
    expect(requests[0].url.searchParams.get("beg")).toBe("20240801");
    expect(requests[0].url.searchParams.get("end")).toBe("20240802");
    expect(requests[0].url.searchParams.get("lmt")).toBe("3");
    expect(requests[0].headers.get("user-agent")).toContain(
      "market-data@example.test",
    );

    const crashRegression = structuredClone(result);
    crashRegression.content[0].text =
      "CN track | Eastmoney raw daily OHLCV | cn_sse 588000 科创50ETF华夏 | 210 bars | volume unit and calendar gaps unknown | complete\nexact rows";
    const coloredTheme = {
      fg: (_color, text) => `\u001b[38;2;128;128;128m${text}\u001b[39m`,
    };
    const crashLines = tools
      .get("cn_stock_ohlcv")
      .renderResult(
        crashRegression,
        { expanded: false, isPartial: false },
        coloredTheme,
        {},
      )
      .render(116);
    expect(crashLines.every((line) => visibleWidth(line) <= 112)).toBeTrue();
    expect(crashLines[0]).toContain("科创50ETF华夏");
  });

  test("uses only Sina after explicit user selection and states the source change", async () => {
    const tools = await harness("cn_ohlcv");
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, headers: new Headers(init?.headers) });
      if (url.hostname === "money.finance.sina.com.cn") {
        return new Response(sinaFixture, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected provider ${url.hostname}`);
    };

    const result = await execute(tools.get("cn_stock_ohlcv"), {
      provider: "sina",
      venue: "sse",
      board: "main",
      shareClass: "a_share",
      code: "600519",
      currency: "CNY",
      startDate: "2024-08-01",
      endDate: "2024-08-02",
      limit: 3,
    });

    expect(requests.map(({ url }) => url.hostname)).toEqual([
      "money.finance.sina.com.cn",
    ]);
    expect(result.details).toMatchObject({
      provider: "sina",
      selectedProvider: "sina",
      selectionMode: "explicit_user_choice",
      fallbackPerformed: false,
      dataSourceChange: "eastmoney->sina_by_explicit_user_choice",
      route: "explicit_alternative",
      amountUnit: null,
    });
    expect(result.details.providerAttempts).toEqual([{
      provider: "sina",
      outcome: "selected",
      error: null,
    }]);
    expect(result.details.providerRows[0].amount).toBeNull();
    expect(result.details.gapAssessmentReceipt.provider).toBe("sina");
    expect(result.details.gapAssessmentReceipt.digest).toBe(
      receiptDigest(result.details.gapAssessmentReceipt),
    );
    expect(result.details.sourceReference).toContain(
      "CN_MarketData.getKLineData?symbol=sh600519&scale=240&ma=no&datalen=3",
    );
    expect(result.content[0].text).toContain(
      "DATA SOURCE CHANGED BY EXPLICIT USER CHOICE: eastmoney -> sina",
    );
    expect(result.content[0].text).toContain("No automatic fallback was performed");
    expect(result.content[0].text).toContain("fallbackPerformed=false");
    expect(tools.sessionEntries).toHaveLength(1);
    expect(tools.sessionEntries[0].data).toMatchObject({
      provider: "sina",
      track: "cn",
      mic: "XSHG",
    });
  });

  test("Eastmoney failure only suggests Sina and never calls it", async () => {
    const tools = await harness("cn_ohlcv");
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, headers: new Headers(init?.headers) });
      throw new TypeError("simulated connection reset");
    };

    let failure;
    try {
      await execute(tools.get("cn_stock_ohlcv"), {
        provider: "eastmoney",
        venue: "sse",
        board: "main",
        shareClass: "a_share",
        code: "600519",
        currency: "CNY",
        startDate: "2024-08-01",
        endDate: "2024-08-02",
        limit: 3,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("Sina was not called");
    expect(failure.message).toContain(
      "only after the user explicitly chooses Sina",
    );
    expect(requests.map(({ url }) => url.hostname)).toEqual([
      "push2his.eastmoney.com",
    ]);
  });

  test("keeps HK currency caller-declared and exposes an exhausted row budget", async () => {
    const tools = await harness("hk_ohlcv");
    expect([...tools.keys()]).toEqual(["hk_stock_ohlcv"]);

    const result = await execute(tools.get("hk_stock_ohlcv"), {
      board: "main",
      shareClass: "ordinary_share",
      code: "00700",
      currency: "CNY",
      startDate: "2024-08-01",
      endDate: "2024-08-02",
      limit: 2,
    });

    expect(result.details.track).toBe("hk");
    expect(result.details.trackContext.marketScope).toBe("hk_stock_ohlcv");
    expect(result.details.trackContext.venueMic).toBe("XHKG");
    expect(result.details.trackContext.timezone).toBe("Asia/Hong_Kong");
    expect(result.details.currency).toBe("CNY");
    expect(result.details.volumeUnit).toBe("unknown");
    expect(result.details.pagination.state).toBe(
      "truncated_by_bar_budget",
    );
    expect(result.details.pagination.continuationTokenAvailable).toBe(false);
    expect(result.details.bars[0].raw.close).toBe("372.400");
    expect(result.details.bars[0].normalized.close).toBe("372.4");
    expect(result.details.providerRows[0].turnoverPercent).toBe("0.25");
    expect(result.content[0].text).toContain(
      "Complete bounded daily rows follow as CSV",
    );
    expect(result.content[0].text).toContain("pass only seriesReceipt");
    expect(result.content[0].text).toContain(
      "never manufacture an instructionRef or use a script",
    );
    expect(result.content[0].text).toContain(
      "2024-08-01,370.200,375.000,368.600,372.400,15432100,5743210000.00",
    );
    expect(typeof tools.get("hk_stock_ohlcv").renderResult).toBe("function");
    const theme = { fg: (_color, text) => text };
    const collapsed = tools
      .get("hk_stock_ohlcv")
      .renderResult(
        result,
        { expanded: false, isPartial: false },
        theme,
        {},
      )
      .render(500)
      .join("\n");
    expect(collapsed).toContain("2 bars");
    expect(collapsed).not.toContain("date,open,high,low,close");

    const narrowLines = tools
      .get("hk_stock_ohlcv")
      .renderResult(
        result,
        { expanded: false, isPartial: false },
        theme,
        {},
      )
      .render(116);
    expect(narrowLines.every((line) => visibleWidth(line) <= 112)).toBeTrue();
    expect(narrowLines[0]).toContain("腾讯控股");

    const receipt = result.details.gapAssessmentReceipt;
    expect(receipt).toMatchObject({
      schema: "pi-sparkles/hk-ohlcv-gap-receipt",
      schemaVersion: 1,
      digestAlgorithm: "sha256",
      provider: "eastmoney",
      venue: "hk",
      board: "main",
      shareClass: "ordinary_share",
      currency: "CNY",
      code: "00700",
      startDate: "2024-08-01",
      endDate: "2024-08-02",
      limit: 2,
      pagination: "truncated_by_bar_budget",
      barDates: ["2024-08-01", "2024-08-02"],
      integrity: {
        state: "sha256_content_bound",
        scope: "canonical_hk_gap_projection_v1",
        providerAuthenticated: false,
      },
    });
    expect(receipt.sourceReference).toBe(
      "https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=116.00700&klt=101&fqt=0&beg=20240801&end=20240802&lmt=2",
    );
    expect(receipt.pages).toEqual([
      {
        sequence: 1,
        requestId: null,
        byteLength: Buffer.byteLength(hkFixture),
        contentSha256: createHash("sha256").update(hkFixture).digest("hex"),
      },
    ]);
    expect(receipt.digest).toBe(receiptDigest(receipt));
    expect(result.details.seriesReceipt).toMatch(/^[0-9a-f]{64}$/);
    expect(result.details.seriesReceipt).not.toBe(result.details.acquisitionReceipt);
    expect(result.content[0].text).toContain(
      `seriesReceipt=${result.details.seriesReceipt}`,
    );
    expect(tools.sessionEntries).toHaveLength(1);
    expect(tools.sessionEntries[0]).toMatchObject({
      customType: "pi_sparkles_finance_ohlcv.series_handoff.v1",
      data: {
        schema: "pi-sparkles/ohlcv-series-handoff",
        schemaVersion: 1,
        track: "hk",
        instrumentId: "00700",
        mic: "XHKG",
        acquisitionReceipt: result.details.seriesReceipt,
      },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url.searchParams.get("secid")).toBe("116.00700");
  });

  test("rejects incoherent CN board, share-class, and currency declarations before I/O", async () => {
    const tools = await harness("cn_ohlcv");
    await expect(
      execute(tools.get("cn_stock_ohlcv"), {
        provider: "eastmoney",
        venue: "bse",
        board: "beijing",
        shareClass: "b_share",
        code: "920079",
        currency: "CNY",
        startDate: "2024-08-01",
        endDate: "2024-08-02",
      }),
    ).rejects.toThrow("Invalid exact CN OHLCV identity or query");
    expect(requests).toHaveLength(0);
  });
});
