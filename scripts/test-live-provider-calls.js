import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "./build.js";
import { DIST_DIR, ROOT } from "./modules.js";

const toolTimeoutMs = 30_000;
const directTimeoutMs = 20_000;
const allowedMethods = new Set(["GET", "POST"]);
const secretQueryNames = new Set(["api_key", "apikey", "token"]);
const pluginNames = [
  "company_profile",
  "cn_disclosures",
  "cn_fundamentals",
  "cn_market_data",
  "cn_market_snapshot",
  "cn_stock_indices",
  "cn_stock_sector_concept",
  "finance_news",
  "finance_symbols",
  "hk_disclosures",
  "hk_fundamentals",
  "hk_market_data",
  "macro_fred",
  "stock_corporate_actions",
  "stock_earnings_calendar",
  "stock_screener",
  "us_ohlcv",
  "us_quote",
];

const pluginChecks = [
  pluginCheck(
    "capco.classification_pdf",
    "CAPCO",
    "cn_stock_sector_concept",
    "cn_industry_classification",
    { track: "cn", resultPeriod: "2025-H2", listingCode: "000001" },
    [request("GET", "sp.capco.org.cn", "/file/202604/hangyefenlei/2025xiaban/2025xiabangupiaodaima.pdf")],
  ),
  pluginCheck(
    "cninfo.security_master",
    "CNINFO",
    "cn_disclosures",
    "cn_security_search",
    { code: "000001" },
    [request("GET", "www.cninfo.com.cn", "/new/data/szse_stock.json")],
  ),
  pluginCheck(
    "cninfo.announcements",
    "CNINFO",
    "cn_disclosures",
    "cn_disclosure_search",
    {
      code: "000001",
      startDate: "2024-01-01",
      endDate: "2024-12-31",
      category: "annual",
      pageSize: 3,
    },
    [
      request("GET", "www.cninfo.com.cn", "/new/data/szse_stock.json"),
      request("POST", "www.cninfo.com.cn", "/new/hisAnnouncement/query"),
    ],
  ),
  pluginCheck(
    "eastmoney.quote.cn",
    "Eastmoney",
    "cn_market_data",
    "cn_raw_vendor_quote",
    { venue: "sse", code: "600519" },
    [request("GET", "push2.eastmoney.com", "/api/qt/stock/get")],
  ),
  pluginCheck(
    "eastmoney.quote.hk",
    "Eastmoney",
    "hk_market_data",
    "hk_stock_quote",
    { code: "00700", currency: "HKD" },
    [request("GET", "push2.eastmoney.com", "/api/qt/stock/get")],
  ),
  pluginCheck(
    "eastmoney.cn_overview",
    "Eastmoney",
    "cn_market_snapshot",
    "cn_market_overview",
    {},
    [request("GET", "push2.eastmoney.com", "/api/qt/ulist.np/get")],
  ),
  pluginCheck(
    "eastmoney.cn_movers",
    "Eastmoney",
    "cn_market_data",
    "cn_market_movers",
    { limit: 2 },
    [request("GET", "push2.eastmoney.com", "/api/qt/clist/get")],
  ),
  pluginCheck(
    "sse.constituents",
    "SSE",
    "cn_stock_indices",
    "cn_index_constituents",
    { venue: "sse", code: "000688" },
    [request("GET", "query.sse.com.cn", "/commonSoaQuery.do")],
  ),
  pluginCheck(
    "sse.industry_composition",
    "SSE",
    "cn_stock_indices",
    "cn_index_industry_composition",
    { venue: "sse", code: "000688" },
    [request("GET", "query.sse.com.cn", "/commonSoaQuery.do")],
  ),
  pluginCheck(
    "eastmoney.history.cn",
    "Eastmoney",
    "cn_market_data",
    "cn_raw_vendor_history",
    {
      provider: "eastmoney",
      venue: "sse",
      code: "600519",
      startDate: "2024-08-01",
      endDate: "2024-08-02",
      limit: 10,
    },
    [request("GET", "push2his.eastmoney.com", "/api/qt/stock/kline/get")],
  ),
  pluginCheck(
    "sina.history.cn.star50",
    "Sina Finance",
    "cn_market_data",
    "cn_raw_vendor_history",
    {
      provider: "sina",
      venue: "sse",
      code: "000688",
      instrumentKind: "benchmark_index",
      startDate: "2026-08-25",
      endDate: "2026-09-02",
      limit: 10,
    },
    [request("GET", "money.finance.sina.com.cn", "/quotes_service/api/json_v2.php/CN_MarketData.getKLineData")],
  ),
  pluginCheck(
    "eastmoney.history.hk",
    "Eastmoney",
    "hk_market_data",
    "hk_stock_history",
    {
      code: "00700",
      currency: "HKD",
      startDate: "2024-08-01",
      endDate: "2024-08-02",
      limit: 10,
    },
    [request("GET", "push2his.eastmoney.com", "/api/qt/stock/kline/get")],
  ),
  pluginCheck(
    "eastmoney.cn_income_statement",
    "Eastmoney",
    "cn_fundamentals",
    "cn_financial_statement",
    {
      venue: "sse",
      code: "600519",
      reportDate: "2024-12-31",
      currency: "CNY",
    },
    [request("GET", "datacenter-web.eastmoney.com", "/api/data/v1/get")],
  ),
  pluginCheck(
    "eastmoney.hk_income_join",
    "Eastmoney",
    "hk_fundamentals",
    "hk_financial_statement",
    { code: "00700", reportDate: "2024-12-31" },
    [
      request("GET", "datacenter.eastmoney.com", "/securities/api/data/v1/get"),
      request("GET", "datacenter.eastmoney.com", "/securities/api/data/v1/get"),
    ],
  ),
  pluginCheck(
    "hkex.security_prefix",
    "HKEX",
    "hk_disclosures",
    "hk_security_search",
    { code: "00700" },
    [request("GET", "www1.hkexnews.hk", "/search/prefix.do")],
  ),
  pluginCheck(
    "hkex.full_list",
    "HKEX",
    "hk_disclosures",
    "hk_security_profile",
    { code: "00700" },
    [request("GET", "www.hkex.com.hk", "/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx")],
  ),
  pluginCheck(
    "hkex.recent_listings",
    "HKEX",
    "hk_disclosures",
    "hk_recent_listing_event",
    { code: "00700" },
    [request("GET", "www.hkex.com.hk", "/Services/Trading/Securities/Trading-News/Newly-Listed-Securities")],
  ),
  pluginCheck(
    "hkex.title_search",
    "HKEX",
    "hk_disclosures",
    "hk_disclosure_search",
    { code: "00700", limit: 3 },
    [
      request("GET", "www1.hkexnews.hk", "/search/prefix.do"),
      request("GET", "www1.hkexnews.hk", "/search/titlesearch.xhtml"),
    ],
  ),
  pluginCheck(
    "hkex.board_meetings.main",
    "HKEX",
    "stock_earnings_calendar",
    "earnings_calendar",
    {
      track: "hk",
      venue: "XHKG",
      board: "main",
      code: "00700",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    },
    [request("GET", "www3.hkexnews.hk", "/reports/bmn/ebmn.htm")],
  ),
  pluginCheck(
    "hkex.board_meetings.gem",
    "HKEX",
    "stock_earnings_calendar",
    "earnings_calendar",
    {
      track: "hk",
      venue: "XHKG",
      board: "gem",
      code: "08291",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    },
    [request("GET", "www3.hkexnews.hk", "/reports/bmn/ebmngem.htm")],
  ),
  pluginCheck(
    "openfigi.mapping",
    "OpenFIGI",
    "finance_symbols",
    "security_resolve",
    { idType: "TICKER", idValue: "IBM", micCode: "XNYS" },
    [request("POST", "api.openfigi.com", "/v3/mapping")],
  ),
  pluginCheck(
    "openfigi.filter",
    "OpenFIGI",
    "finance_symbols",
    "security_search",
    { query: "IBM", micCode: "XNYS" },
    [request("POST", "api.openfigi.com", "/v3/filter")],
  ),
  pluginCheck(
    "twelve_data.profile_and_statistics",
    "Twelve Data",
    "company_profile",
    "company_profile",
    { symbol: "AAPL", mic: "XNGS" },
    [
      request("GET", "api.twelvedata.com", "/profile"),
      request("GET", "api.twelvedata.com", "/statistics"),
    ],
    {
      environment: { TWELVE_DATA_API_KEY: "demo" },
      passStatus: "passed_demo",
    },
  ),
  pluginCheck(
    "fred.metadata_and_observations",
    "FRED",
    "macro_fred",
    "fred_series",
    {
      seriesId: "CPIAUCSL",
      observationStart: "2025-01-01",
      observationEnd: "2025-12-31",
      asOfDate: "2026-01-15",
      maximumObservations: 24,
    },
    [
      request("GET", "api.stlouisfed.org", "/fred/series"),
      request("GET", "api.stlouisfed.org", "/fred/series/observations"),
    ],
    { requiresEnvironment: "FRED_API_KEY" },
  ),
  pluginCheck(
    "alpaca.daily_bars",
    "Alpaca",
    "us_ohlcv",
    "us_stock_ohlcv",
    {
      symbol: "AAPL",
      startDate: "2024-08-01",
      endDate: "2024-08-05",
      asOf: "2024-08-06",
      feed: "iex",
      pageSize: 10,
      maxPages: 1,
      maxBars: 10,
    },
    [request("GET", "data.alpaca.markets", "/v2/stocks/bars")],
    {
      requiresEnvironment: [
        "ALPACA_API_KEY_ID",
        "ALPACA_API_SECRET_KEY",
      ],
    },
  ),
  pluginCheck(
    "alpaca.latest_quote",
    "Alpaca",
    "us_quote",
    "us_stock_quote",
    { symbol: "AAPL", feed: "iex" },
    [request("GET", "data.alpaca.markets", "/v2/stocks/quotes/latest")],
    {
      requiresEnvironment: [
        "ALPACA_API_KEY_ID",
        "ALPACA_API_SECRET_KEY",
      ],
    },
  ),
  pluginCheck(
    "alpaca.asset_universe.paper",
    "Alpaca",
    "stock_screener",
    "stock_universe",
    {
      environment: "paper",
      status: "active",
      exchange: "NASDAQ",
      maximumAssets: 20_000,
    },
    [request("GET", "paper-api.alpaca.markets", "/v2/assets")],
    {
      requiresEnvironment: [
        "ALPACA_API_KEY_ID",
        "ALPACA_API_SECRET_KEY",
      ],
    },
  ),
  pluginCheck(
    "alpaca.corporate_actions",
    "Alpaca",
    "stock_corporate_actions",
    "corporate_actions",
    {
      track: "us",
      venue: "XNAS",
      symbol: "AAPL",
      cusip: "037833100",
      startDate: "2024-08-01",
      endDate: "2024-08-31",
      types: [
        "cash_dividend",
        "stock_dividend",
        "forward_split",
        "reverse_split",
        "name_change",
      ],
      dataQuality: "all",
      pageSize: 10,
      maximumPages: 1,
      maximumActions: 10,
    },
    [request("GET", "data.alpaca.markets", "/v1/corporate-actions")],
    {
      requiresEnvironment: [
        "ALPACA_API_KEY_ID",
        "ALPACA_API_SECRET_KEY",
      ],
    },
  ),
  pluginCheck(
    "alpaca.news",
    "Alpaca",
    "finance_news",
    "finance_news",
    {
      track: "us",
      venue: "XNAS",
      symbol: "AAPL",
      startAt: "2026-07-01T00:00:00Z",
      endAt: "2026-07-02T00:00:00Z",
      pageSize: 2,
      maximumPages: 1,
      maximumArticles: 2,
    },
    [request("GET", "data.alpaca.markets", "/v1beta1/news")],
    {
      requiresEnvironment: [
        "ALPACA_API_KEY_ID",
        "ALPACA_API_SECRET_KEY",
      ],
    },
  ),
];

const directChecks = [
  directSinaHistory("sina.history.cn", "sh600519"),
  directDocument(
    "cninfo.document",
    "CNINFO",
    "https://static.cninfo.com.cn/finalpage/2026-03-21/1225022887.PDF",
  ),
  ...[
    ["csrc.market_monthly", "/csrc/c100120/common_list.shtml"],
    ["csrc.market_weekly", "/csrc/c100119/common_list.shtml"],
    ["csrc.consultation_feedback", "/csrc/c100114/common_list.shtml"],
  ].map(([id, path]) =>
    directText(id, "CSRC", `https://www.csrc.gov.cn${path}`, ["text/html", "application/xhtml+xml"]),
  ),
  directDocument(
    "hkex.document",
    "HKEX",
    "https://www1.hkexnews.hk/listedco/listconews/sehk/2026/0709/2026070900827.pdf",
  ),
  directText(
    "sfc.press_releases",
    "SFC",
    "https://www.sfc.hk/en/RSS-Feeds/Press-releases",
    ["application/rss+xml", "application/xml", "text/xml"],
  ),
];

function directSinaHistory(id, symbol) {
  const url =
    `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=5`;
  return direct(id, "Sina Finance", url, async (response) => {
    const body = await boundedText(response, 1_000_000);
    const rows = JSON.parse(body);
    invariant(Array.isArray(rows) && rows.length > 0 && rows.length <= 5, `${id} returned an invalid row budget`);
    for (const row of rows) {
      invariant(row && typeof row === "object", `${id} returned a non-object row`);
      for (const field of ["day", "open", "high", "low", "close", "volume"]) {
        invariant(typeof row[field] === "string" && row[field].length > 0, `${id} returned invalid ${field}`);
      }
    }
    return { responseBytes: Buffer.byteLength(body), rows: rows.length, decoderValidated: false };
  });
}

if (import.meta.main) {
  await main().catch((error) => {
    console.error(JSON.stringify({
      schemaVersion: 1,
      kind: "live_provider_call_audit",
      status: "failed",
      error: safeError(error),
    }, null, 2));
    process.exitCode = 1;
  });
}

async function main() {
  requireContact();
  const startedAt = new Date().toISOString();
  const results = [];
  const checkId = selectedCheckId(process.argv.slice(2));
  const allChecks = [...pluginChecks, ...directChecks];
  const requestedCheck = allChecks.find((check) => check.id === checkId);
  const missingForRequested = missingEnvironment(requestedCheck);
  if (missingForRequested) {
    throw new Error(
      `${requestedCheck.id} requires ${missingForRequested}`,
    );
  }
  const selectedChecks = allChecks
    .filter((check) => !missingEnvironment(check))
    .filter((check) => checkId === null || check.id === checkId);
  invariant(selectedChecks.length > 0, `unknown provider check ${checkId}`);
  const selectedPlugins = new Set(
    selectedChecks.map((check) => check.plugin).filter(Boolean),
  );
  for (const plugin of pluginNames) {
    if (checkId === null || selectedPlugins.has(plugin)) await build(plugin);
  }

  for (const check of selectedChecks) {
    results.push(await runCheck(check));
  }
  if (checkId === null) results.push(...await runCredentialProbes());

  const summary = countStatuses(results);
  const output = {
    schemaVersion: 1,
    kind: "live_provider_call_audit",
    status: summary.failed === 0 ? "completed" : "failed",
    startedAt,
    finishedAt: new Date().toISOString(),
    summary,
    results,
  };
  console.log(JSON.stringify(output, null, 2));
  if (summary.failed > 0) process.exitCode = 1;
}

function pluginCheck(
  id,
  provider,
  plugin,
  tool,
  input,
  expectedRequests,
  options = {},
) {
  return {
    id,
    provider,
    plugin,
    expectedRequests,
    passStatus: options.passStatus,
    requiresEnvironment: options.requiresEnvironment,
    async execute() {
      const restore = setEnvironment(options.environment ?? {});
      try {
        const tools = await loadPlugin(plugin, id);
        const result = await executeTool(tools, tool, input);
        invariant(result && typeof result === "object", `${tool} returned no result`);
        invariant(result.details && typeof result.details === "object", `${tool} returned no structured details`);
        return { resultKind: result.details.operation ?? result.details.provider ?? "structured_tool_result" };
      } finally {
        restore();
      }
    },
  };
}

function directDocument(id, provider, url) {
  return direct(id, provider, url, async (response) => {
    const type = contentType(response);
    invariant(["application/pdf", "application/octet-stream"].includes(type), `${id} returned ${type || "no media type"}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    invariant(bytes.byteLength > 4, `${id} returned an empty document`);
    invariant(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46, `${id} did not return a PDF signature`);
    invariant(bytes.byteLength <= 25_000_000, `${id} exceeded 25 MB`);
    return { mediaType: type, responseBytes: bytes.byteLength };
  });
}

function directText(id, provider, url, mediaTypes) {
  return direct(id, provider, url, async (response) => {
    const type = contentType(response);
    invariant(mediaTypes.includes(type), `${id} returned ${type || "no media type"}`);
    const body = await response.text();
    invariant(body.length > 0, `${id} returned an empty body`);
    invariant(Buffer.byteLength(body) <= 2_000_000, `${id} exceeded 2 MB`);
    return { mediaType: type, responseBytes: Buffer.byteLength(body) };
  });
}

function direct(id, provider, url, validate) {
  const parsed = new URL(url);
  return {
    id,
    provider,
    expectedRequests: [request("GET", parsed.hostname, parsed.pathname)],
    async execute() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), directTimeoutMs);
      try {
        const response = await fetch(url, {
          method: "GET",
          redirect: "error",
          signal: controller.signal,
          headers: {
            accept: "*/*",
            "user-agent": `pi-sparkles-provider-audit/0.1 ${process.env.AGENT_CONTACT.trim()}`,
          },
        });
        invariant(response.ok, `${id} returned HTTP ${response.status}`);
        return await validate(response);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

async function runCheck(check) {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = guardedFetch(originalFetch, check.expectedRequests, requests);
  const started = performance.now();
  try {
    const evidence = await check.execute();
    verifyRequests(check.expectedRequests, requests);
    return {
      id: check.id,
      provider: check.provider,
      status: check.passStatus ?? "passed",
      durationMs: Math.round(performance.now() - started),
      requests,
      evidence,
    };
  } catch (error) {
    return {
      id: check.id,
      provider: check.provider,
      status: "failed",
      durationMs: Math.round(performance.now() - started),
      requests,
      error: safeError(error),
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function runCredentialProbes() {
  const results = [];
  if (!process.env.FRED_API_KEY?.trim()) {
    const fred = [
      ["fred.metadata", "/fred/series"],
      ["fred.observations", "/fred/series/observations"],
    ];
    for (const [id, path] of fred) {
      results.push(await rejectedCredentialProbe({
        id,
        provider: "FRED",
        url: `https://api.stlouisfed.org${path}?series_id=CPIAUCSL&file_type=json&realtime_start=2026-01-15&realtime_end=2026-01-15`,
        expectedStatuses: [400],
        marker: "api_key",
        credential: "FRED_API_KEY",
      }));
    }
  }

  if (
    !process.env.ALPACA_API_KEY_ID?.trim() ||
    !process.env.ALPACA_API_SECRET_KEY?.trim()
  ) {
    const alpaca = [
      ["alpaca.daily_bars", "https://data.alpaca.markets/v2/stocks/bars?symbols=AAPL&timeframe=1Day&start=2024-08-01&end=2024-08-05&limit=10&adjustment=raw&feed=iex&currency=USD&sort=asc&asof=2024-08-06"],
      ["alpaca.latest_quotes", "https://data.alpaca.markets/v2/stocks/quotes/latest?symbols=AAPL&feed=iex&currency=USD"],
      ["alpaca.assets", "https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity&exchange=NASDAQ"],
      ["alpaca.corporate_actions", "https://data.alpaca.markets/v1/corporate-actions?symbols=AAPL&cusips=037833100&types=cash_dividend&region=us&start=2024-08-01&end=2024-08-31&limit=10&data_quality=all&sort=asc"],
      ["alpaca.news", "https://data.alpaca.markets/v1beta1/news?start=2024-08-01T00%3A00%3A00Z&end=2024-08-02T00%3A00%3A00Z&sort=asc&symbols=AAPL&limit=2&include_content=false&exclude_contentless=false"],
    ];
    for (const [id, url] of alpaca) {
      results.push(await rejectedCredentialProbe({
        id,
        provider: "Alpaca",
        url,
        expectedStatuses: [401, 403],
        credential: "ALPACA_API_KEY_ID + ALPACA_API_SECRET_KEY",
      }));
    }
  }

  return results;
}

async function rejectedCredentialProbe(spec) {
  const started = performance.now();
  const requestEvidence = request("GET", new URL(spec.url).hostname, new URL(spec.url).pathname);
  try {
    const response = await boundedFetch(spec.url, { headers: { accept: "application/json" } });
    const body = await boundedText(response, 100_000);
    invariant(spec.expectedStatuses.includes(response.status), `${spec.id} unexpectedly returned HTTP ${response.status}`);
    if (spec.marker) invariant(body.toLowerCase().includes(spec.marker), `${spec.id} did not identify the missing credential`);
    return {
      id: spec.id,
      provider: spec.provider,
      status: "blocked_credential",
      durationMs: Math.round(performance.now() - started),
      requests: [{ ...requestEvidence, status: response.status }],
      required: spec.credential,
      evidence: { sameProductionHostAndPathReached: true, decoderValidated: false },
    };
  } catch (error) {
    return { id: spec.id, provider: spec.provider, status: "failed", durationMs: Math.round(performance.now() - started), requests: [], error: safeError(error) };
  }
}

async function boundedFetch(url, init) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), directTimeoutMs);
  try {
    return await fetch(url, { ...init, method: "GET", redirect: "error", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedText(response, maximumBytes) {
  const body = await response.text();
  invariant(Buffer.byteLength(body) <= maximumBytes, `response exceeded ${maximumBytes} bytes`);
  return body;
}

function guardedFetch(fetchImplementation, expected, requests) {
  return async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    invariant(url.protocol === "https:", "live provider requests must use HTTPS");
    invariant(allowedMethods.has(method), `live provider audit blocked ${method}`);
    invariant(requests.length < expected.length, `request exceeded exact budget of ${expected.length}`);
    const planned = expected[requests.length];
    invariant(method === planned.method && url.hostname === planned.host && url.pathname === planned.path, `unexpected request ${method} ${url.hostname}${url.pathname}`);
    const evidence = { method, host: url.hostname, path: url.pathname, url: safeUrl(url), status: "pending", durationMs: 0 };
    requests.push(evidence);
    const started = performance.now();
    try {
      const response = await fetchImplementation(input, { ...init, redirect: "error" });
      evidence.status = response.status;
      return response;
    } catch (error) {
      evidence.status = "transport_error";
      throw error;
    } finally {
      evidence.durationMs = Math.round(performance.now() - started);
    }
  };
}

function verifyRequests(expected, actual) {
  invariant(actual.length === expected.length, `expected ${expected.length} request(s), observed ${actual.length}`);
}

async function loadPlugin(shortName, nonce) {
  const tools = new Map();
  const artifact = pathToFileURL(join(DIST_DIR, shortName, "index.js"));
  artifact.searchParams.set("live-provider-audit", `${nonce}-${Date.now()}`);
  const module = await import(artifact.href);
  await module.default({
    appendEntry() {},
    registerCommand() {},
    registerTool(definition) { tools.set(definition.name, definition); },
  });
  return tools;
}

async function executeTool(tools, name, input) {
  const definition = tools.get(name);
  invariant(definition, `plugin did not register ${name}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), toolTimeoutMs);
  try {
    return await definition.execute(`live-${name}`, input, controller.signal, undefined, { cwd: ROOT, mode: "text", hasUI: false, ui: {} });
  } finally {
    clearTimeout(timeout);
  }
}

function request(method, host, path) { return { method, host, path }; }

function safeUrl(url) {
  const copy = new URL(url);
  for (const name of secretQueryNames) if (copy.searchParams.has(name)) copy.searchParams.set(name, "<redacted>");
  return copy.toString();
}

function contentType(response) { return (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase(); }

function requireContact() {
  const contact = process.env.AGENT_CONTACT?.trim() ?? "";
  invariant(contact !== "" && !/example\.(com|net|org)$/i.test(contact), "AGENT_CONTACT must identify the real operator for public-provider requests");
}

function selectedCheckId(arguments_) {
  if (arguments_.length === 0) return null;
  invariant(
    arguments_.length === 2 && arguments_[0] === "--check",
    "usage: bun run test:live:providers [--check provider.operation]",
  );
  return arguments_[1];
}

function missingEnvironment(check) {
  if (!check?.requiresEnvironment) return null;
  const names = Array.isArray(check.requiresEnvironment)
    ? check.requiresEnvironment
    : [check.requiresEnvironment];
  return names.find((name) => !process.env[name]?.trim()) ?? null;
}

function countStatuses(results) {
  const summary = { passed: 0, passedDemo: 0, blockedCredential: 0, failed: 0 };
  for (const result of results) {
    if (result.status === "passed") summary.passed += 1;
    else if (result.status === "passed_demo") summary.passedDemo += 1;
    else if (result.status === "blocked_credential") summary.blockedCredential += 1;
    else summary.failed += 1;
  }
  return summary;
}

function safeError(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const name of ["FRED_API_KEY", "OPENFIGI_API_KEY", "TWELVE_DATA_API_KEY", "ALPACA_API_KEY_ID", "ALPACA_API_SECRET_KEY", "TUSHARE_TOKEN"]) {
    const value = process.env[name];
    if (value) message = message.replaceAll(value, "<redacted>");
  }
  return message.slice(0, 1000);
}

function setEnvironment(values) {
  const prior = new Map();
  for (const [name, value] of Object.entries(values)) {
    prior.set(name, process.env[name]);
    process.env[name] = value;
  }
  return () => {
    for (const [name, value] of prior) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

function invariant(condition, message) { if (!condition) throw new Error(message); }
