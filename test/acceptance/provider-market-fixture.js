import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { DIST_DIR } from "../../scripts/modules.js";

const retrievedAtUnixMs = 1_786_092_300_000;

const cnPage =
  '{"rc":0,"data":{"code":"600000","name":"浦发银行","klines":["2026-08-03,10.1000,10.20,10.30,10.00,100000,1015000.00,2.97,0.99,0.10,0.20","2026-08-04,10.20,10.35,10.40,10.15,110000,1135000.00,2.45,1.47,0.15,0.22","2026-08-05,10.35,10.28,10.42,10.20,95000,978500.00,2.13,-0.68,-0.07,0.19","2026-08-06,10.28,10.50,10.55,10.25,120000,1256000.00,2.92,2.14,0.22,0.24","2026-08-07,10.50,10.62,10.70,10.45,130000,1378000.00,2.38,1.14,0.12,0.26"]}}';

const hkPage =
  '{"rc":0,"data":{"code":"00700","name":"腾讯控股","klines":["2026-08-03,550.000,556.000,560.000,548.000,15000000,8310000000.00,2.18,1.09,6.00,0.25","2026-08-04,556.000,552.000,558.000,550.000,14000000,7750000000.00,1.44,-0.72,-4.00,0.23","2026-08-05,552.000,561.000,563.000,551.000,16000000,8950000000.00,2.17,1.63,9.00,0.27","2026-08-06,561.000,565.000,568.000,559.000,15500000,8750000000.00,1.60,0.71,4.00,0.26","2026-08-07,565.000,570.000,573.000,563.000,17000000,9680000000.00,1.77,0.88,5.00,0.29"]}}';

const usPage =
  '{"bars":{"AAPL":[{"c":205.1000,"h":206.20,"l":202.80,"n":510000,"o":203.0000,"t":"2026-08-03T04:00:00Z","v":50100000,"vw":204.5000},{"c":206.2500,"h":207.10,"l":204.60,"n":520000,"o":205.2000,"t":"2026-08-04T04:00:00Z","v":48900000,"vw":205.9000},{"c":204.9000,"h":207.00,"l":204.20,"n":505000,"o":206.3000,"t":"2026-08-05T04:00:00Z","v":47500000,"vw":205.4000},{"c":208.4000,"h":209.00,"l":204.70,"n":540000,"o":205.0000,"t":"2026-08-06T04:00:00Z","v":53000000,"vw":207.1000},{"c":210.1500,"h":211.00,"l":207.90,"n":560000,"o":208.5000,"t":"2026-08-07T04:00:00Z","v":55000000,"vw":209.7000}]},"next_page_token":null}';

const usUniversePage =
  '[{"id":"b0b6dd9d-8b9b-48a9-ba46-b9d54906e415","class":"us_equity","exchange":"NASDAQ","symbol":"AAPL","name":"Apple Inc. Common Stock","status":"active","tradable":true,"marginable":true,"shortable":true,"easy_to_borrow":true,"fractionable":true,"attributes":["has_options"]}]';

const specs = {
  cn: {
    artifact: "cn_ohlcv",
    toolName: "cn_stock_ohlcv",
    input: {
      provider: "eastmoney",
      venue: "sse",
      board: "main",
      shareClass: "a_share",
      code: "600000",
      currency: "CNY",
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      limit: 10,
    },
  },
  hk: {
    artifact: "hk_ohlcv",
    toolName: "hk_stock_ohlcv",
    input: {
      board: "main",
      shareClass: "ordinary_share",
      code: "00700",
      currency: "HKD",
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      limit: 10,
    },
  },
  us: {
    artifact: "us_ohlcv",
    toolName: "us_stock_ohlcv",
    input: {
      symbol: "AAPL",
      startDate: "2026-08-03",
      endDate: "2026-08-07",
      asOf: "2026-08-07",
      feed: "sip",
      pageSize: 10,
      maxPages: 2,
      maxBars: 10,
    },
  },
};

const universeSpec = {
  artifact: "stock_screener",
  toolName: "stock_universe",
  registeredTools: ["stock_universe", "project_universe", "screen"],
  input: {
    environment: "paper",
    status: "active",
    exchange: "NASDAQ",
    maximumAssets: 1000,
  },
};

export async function loadBundledMarketReceipts() {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const savedEnvironment = {
    AGENT_CONTACT: process.env.AGENT_CONTACT,
    ALPACA_API_KEY_ID: process.env.ALPACA_API_KEY_ID,
    ALPACA_API_SECRET_KEY: process.env.ALPACA_API_SECRET_KEY,
  };
  const requests = [];
  try {
    Date.now = () => retrievedAtUnixMs;
    process.env.AGENT_CONTACT = "acceptance@example.test";
    process.env.ALPACA_API_KEY_ID = "acceptance-key-id";
    process.env.ALPACA_API_SECRET_KEY = "acceptance-secret-key";
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      requests.push({ url: url.toString(), headers });
      if (url.hostname === "paper-api.alpaca.markets") {
        return new Response(usUniversePage, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "acceptance-us-universe",
          },
        });
      }
      if (url.hostname === "data.alpaca.markets") {
        return new Response(usPage, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": "acceptance-us-page-1",
          },
        });
      }
      if (url.hostname === "push2his.eastmoney.com") {
        const body = url.searchParams.get("secid")?.startsWith("116.")
          ? hkPage
          : cnPage;
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": url.searchParams.get("secid")?.startsWith("116.")
              ? "acceptance-hk-page-1"
              : "acceptance-cn-page-1",
          },
        });
      }
      throw new Error(`Acceptance transport rejected host ${url.hostname}`);
    };

    const copies = {};
    for (const [track, spec] of Object.entries(specs)) {
      const details = await executeBundledTool(spec);
      copies[track] = copyReceipt(track, spec.toolName, details);
    }
    copies.usUniverse = copyUniverse(
      universeSpec.toolName,
      await executeBundledTool(universeSpec),
    );
    invariant(
      requests.length === 4,
      "Expected one market request per track plus one US universe request",
    );
    invariant(
      requests.every(({ headers }) =>
        headers.get("user-agent")?.includes("acceptance@example.test"),
      ),
      "Bundled provider request omitted caller identification",
    );
    return copies;
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    restoreEnvironment(savedEnvironment);
  }
}

function copyUniverse(toolName, details) {
  invariant(details.track === "us", `${toolName} changed the requested track`);
  invariant(details.rows.length === 1, `${toolName} did not return one row`);
  invariant(
    details.rows[0].symbol === "AAPL",
    `${toolName} changed the provider universe row`,
  );
  invariant(
    details.decisionOwner === "llm" &&
      details.pluginDecisionFields.length === 0,
    `${toolName} returned plugin-owned decision fields`,
  );
  invariant(
    details.sourceReceipt === sha256(usUniversePage),
    `${toolName} source receipt does not bind the exact response`,
  );
  invariant(
    details.universeReceipt ===
      sha256(`${details.sourceReference}\n${usUniversePage}`),
    `${toolName} universe receipt does not bind its request and response`,
  );
  const sourceResultPayload = JSON.stringify(details);
  invariant(
    !sourceResultPayload.includes("acceptance-secret-key"),
    `${toolName} leaked a fixture credential`,
  );
  return {
    sourceTool: toolName,
    sourceResultPayload,
    sourceResultContentHash: sha256(sourceResultPayload),
    sourceReceipt: details.sourceReceipt,
    universeReceipt: details.universeReceipt,
  };
}

export function verifyBundledUniverseCopy(copy, candidateCopy) {
  invariant(
    copy.sourceTool === "stock_universe",
    "Unexpected bundled universe source tool",
  );
  invariant(
    sha256(copy.sourceResultPayload) === copy.sourceResultContentHash,
    "Bundled universe result content hash changed",
  );
  const details = JSON.parse(copy.sourceResultPayload);
  invariant(details.track === "us", "Bundled universe result track changed");
  invariant(
    details.sourceReceipt === copy.sourceReceipt &&
      details.universeReceipt === copy.universeReceipt,
    "Bundled universe receipt handles changed",
  );
  const candidate = JSON.parse(candidateCopy.payload).payload.observation.value;
  invariant(
    candidate.source_receipt === copy.sourceReceipt &&
      candidate.universe_receipt === copy.universeReceipt,
    "Universe candidate does not copy the bundled tool receipts",
  );
}

async function executeBundledTool(spec) {
  const tools = new Map();
  const api = {
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    appendEntry() {},
  };
  const artifact = join(DIST_DIR, spec.artifact, "index.js");
  const module = await import(
    `${pathToFileURL(artifact).href}?provider-copy=${retrievedAtUnixMs}-${spec.artifact}`
  );
  await module.default(api);
  const registeredTools = [...tools.keys()];
  const expectedTools = spec.registeredTools ?? [spec.toolName];
  invariant(
    JSON.stringify(registeredTools) === JSON.stringify(expectedTools),
    `${spec.artifact} registered unexpected tools`,
  );
  const tool = tools.get(spec.toolName);
  invariant(tool, `${spec.artifact} did not register ${spec.toolName}`);
  const result = await tool.execute(
    `acceptance-${spec.artifact}`,
    spec.input,
    new AbortController().signal,
    undefined,
    { hasUI: false, ui: {} },
  );
  invariant(result?.isError !== true, `${spec.toolName} returned an error`);
  return result.details;
}

function copyReceipt(track, toolName, details) {
  invariant(details.track === track, `${toolName} changed the requested track`);
  invariant(details.bars.length === 5, `${toolName} did not return five bars`);
  const receipt = details.gapAssessmentReceipt;
  const canonical = canonicalGapProjection(track, receipt);
  const digest = sha256(JSON.stringify(canonical));
  invariant(receipt.digest === digest, `${toolName} receipt digest mismatch`);
  invariant(
    receipt.integrity?.providerAuthenticated === false,
    `${toolName} fixture must not claim authenticated provider origin`,
  );
  const sourceResultPayload = JSON.stringify(details);
  invariant(
    !sourceResultPayload.includes("acceptance-secret-key"),
    `${toolName} leaked a fixture credential`,
  );
  return {
    schema: receipt.schema,
    payload: JSON.stringify(receipt),
    canonicalContentHash: receipt.digest,
    integrity: "bundled_tool_gap_projection_sha256",
    sourceTool: toolName,
    sourceResultPayload,
    sourceResultContentHash: sha256(sourceResultPayload),
  };
}

export function verifyBundledMarketCopy(track, copy) {
  invariant(
    copy.integrity === "bundled_tool_gap_projection_sha256",
    `Unexpected ${track} bundled receipt integrity`,
  );
  const receipt = JSON.parse(copy.payload);
  const digest = sha256(JSON.stringify(canonicalGapProjection(track, receipt)));
  invariant(
    digest === copy.canonicalContentHash,
    `${track} market digest changed`,
  );
  invariant(
    receipt.digest === digest,
    `${track} copied receipt handle changed`,
  );
  const details = JSON.parse(copy.sourceResultPayload);
  invariant(
    sha256(copy.sourceResultPayload) === copy.sourceResultContentHash,
    `${track} bundled result content hash changed`,
  );
  invariant(
    JSON.stringify(details.gapAssessmentReceipt) === copy.payload,
    `${track} receipt is not an exact copy of the bundled result`,
  );
  invariant(details.track === track, `${track} bundled result track changed`);
}

function canonicalGapProjection(track, receipt) {
  const identity =
    track === "us"
      ? {
          symbol: receipt.symbol,
          start_date: receipt.startDate,
          end_date: receipt.endDate,
          identity_as_of: receipt.identityAsOf,
          feed: receipt.feed,
        }
      : {
          venue: receipt.venue,
          board: receipt.board,
          share_class: receipt.shareClass,
          currency: receipt.currency,
          code: receipt.code,
          start_date: receipt.startDate,
          end_date: receipt.endDate,
          limit: String(receipt.limit),
        };
  return {
    schema: receipt.schema,
    schema_version: receipt.schemaVersion,
    track,
    provider: receipt.provider,
    ...identity,
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
}

function restoreEnvironment(saved) {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
