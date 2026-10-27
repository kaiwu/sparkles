import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const artifact = resolve(import.meta.dir, "../../dist/company_profile/index.js");
const originalFetch = globalThis.fetch;
const originalApiKey = process.env.TWELVE_DATA_API_KEY;
const originalEquiblesKey = process.env.EQUIBLES_API_KEY;
const requests = [];

const profileBody =
  '{"symbol":"AAPL","name":"Apple Inc.","exchange":"NASDAQ","mic_code":"XNGS","sector":"Technology","industry":"Consumer Electronics","employees":150000,"website":"https://www.apple.com","description":"Designs devices and services.","type":"Common Stock","CEO":"Mr. Timothy D. Cook","address":"One Apple Park Way","address2":null,"city":"Cupertino","zip":"95014","state":"CA","country":"United States","phone":"408-996-1010"}';

const statisticsBody =
  '{"meta":{"symbol":"AAPL","name":"Apple Inc.","currency":"USD","exchange":"NASDAQ","mic_code":"XNGS","exchange_timezone":"America/New_York"},"statistics":{"stock_statistics":{"shares_outstanding":14687356000,"float_shares":14569223952}}}';

beforeEach(() => {
  requests.length = 0;
  process.env.TWELVE_DATA_API_KEY = "test-twelve-data-api-key";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    requests.push({ url, headers });
    const profile = url.pathname === "/profile";
    return new Response(profile ? profileBody : statisticsBody, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "api-credits-used": profile ? "10" : "60",
        "api-credits-left": profile ? "550" : "500",
        "api-credits-request": profile ? "10" : "50",
      },
    });
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  restore("TWELVE_DATA_API_KEY", originalApiKey);
  restore("EQUIBLES_API_KEY", originalEquiblesKey);
});

async function harness() {
  const tools = new Map();
  const api = {
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
  };
  const module = await import(
    `${artifact}?company-profile=${Date.now()}-${Math.random()}`
  );
  await module.default(api);
  return tools;
}

function execute(
  tool,
  value = { symbol: "AAPL", mic: "XNGS" },
  signal = new AbortController().signal,
) {
  return tool.execute("company-profile-query", value, signal, undefined, {
    hasUI: false,
    ui: {},
  });
}

describe("company profile boundary", () => {
  test("registers only the read-only company_profile tool", async () => {
    const tools = await harness();
    expect([...tools.keys()]).toEqual(["company_profile"]);
  });

  test("joins two exact MIC-scoped snapshots and exposes content and credit receipts", async () => {
    const tools = await harness();
    const result = await execute(tools.get("company_profile"));

    expect(requests).toHaveLength(2);
    expect(requests[0].url.origin).toBe("https://api.twelvedata.com");
    expect(requests[0].url.pathname).toBe("/profile");
    expect(requests[1].url.pathname).toBe("/statistics");
    for (const request of requests) {
      expect(request.url.searchParams.get("symbol")).toBe("AAPL");
      expect(request.url.searchParams.get("mic_code")).toBe("XNGS");
      expect(request.url.searchParams.get("country")).toBe("US");
      expect(request.headers.get("authorization")).toBe(
        "apikey test-twelve-data-api-key",
      );
    }

    expect(result.details).toMatchObject({
      operation: "company_profile",
      track: "us",
      listing: {
        symbol: "AAPL",
        mic: "XNGS",
        exchange: "NASDAQ",
        identityState: "exact_provider_match_not_exchange_authority_proof",
      },
      profile: {
        value: {
          name: "Apple Inc.",
          sector: "Technology",
          industry: "Consumer Electronics",
          employeesRaw: "150000",
          chiefExecutive: "Mr. Timothy D. Cook",
        },
        freshness: { tag: "unknown" },
        entitlement: { tag: "unknown" },
        source: { kind: { tag: "licensed_vendor" } },
      },
      shares: {
        value: {
          outstanding: {
            state: "observed",
            rawValue: "14687356000",
            unit: "shares",
          },
          float: {
            state: "observed",
            rawValue: "14569223952",
          },
        },
        unit: { tag: "shares" },
      },
      scope: {
        providerSnapshotAsOf: "retrieval_time_only",
        fieldEffectiveAt: null,
        classificationTaxonomy: null,
        chiefExecutiveEffectiveAt: null,
        sharesMeasurementAt: null,
        crossListingFallback: null,
        qualityRating: null,
        investmentJudgment: null,
      },
      decisionOwner: "llm",
      pluginDecisionFields: [],
    });
    expect(result.details.trackContext).toMatchObject({
      track: "us",
      venueMic: "XNGS",
      providers: ["Twelve Data"],
      entitlement: "caller_twelve_data_subscription",
    });
    expect(result.details.source.profile).toMatchObject({
      endpoint: "/profile",
      responseByteLength: Buffer.byteLength(profileBody),
      contentSha256: createHash("sha256").update(profileBody).digest("hex"),
      apiCreditsUsed: "10",
      apiCreditsLeft: "550",
      apiCreditsRequest: "10",
    });
    expect(result.details.source.statistics).toMatchObject({
      endpoint: "/statistics",
      responseByteLength: Buffer.byteLength(statisticsBody),
      contentSha256: createHash("sha256")
        .update(statisticsBody)
        .digest("hex"),
      apiCreditsUsed: "60",
      apiCreditsLeft: "500",
      apiCreditsRequest: "50",
    });
    expect(JSON.stringify(result.details)).not.toContain(
      "test-twelve-data-api-key",
    );
  });

  test("rejects a profile identity mismatch before spending statistics credits", async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requests.push({ url, headers: new Headers() });
      return new Response(profileBody.replace('"mic_code":"XNGS"', '"mic_code":"XNYS"'));
    };
    const tools = await harness();

    await expect(execute(tools.get("company_profile"))).rejects.toThrow(
      "did not match the exact requested symbol and MIC",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe("/profile");
  });

  test("rejects profile and statistics rows that cannot prove the same provider identity", async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      return new Response(
        url.pathname === "/profile"
          ? profileBody
          : statisticsBody.replace("Apple Inc.", "Different Issuer"),
      );
    };
    const tools = await harness();

    await expect(execute(tools.get("company_profile"))).rejects.toThrow(
      "identities did not match exactly",
    );
  });

  test("preserves unavailable share fields without inventing zero", async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      return new Response(
        url.pathname === "/profile"
          ? profileBody
          : statisticsBody
              .replace("14687356000", "null")
              .replace("14569223952", "null"),
      );
    };
    const tools = await harness();
    const result = await execute(tools.get("company_profile"));

    expect(result.details.shares.value.outstanding).toEqual({
      state: "not_supplied",
      providerField: "shares_outstanding",
      rawValue: null,
      unit: "shares",
    });
    expect(result.details.shares.value.float.rawValue).toBeNull();
    expect(result.details.shares.quality).toEqual({
      tag: "missing",
      reason: "unavailable",
    });
  });

  test("reports subscription denial without retrying the 50-credit endpoint", async () => {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requests.push({ url, headers: new Headers() });
      return url.pathname === "/profile"
        ? new Response(profileBody)
        : new Response('{"status":"error"}', { status: 403 });
    };
    const tools = await harness();

    await expect(execute(tools.get("company_profile"))).rejects.toThrow(
      "subscription does not permit",
    );
    expect(requests).toHaveLength(2);
  });

  test("requires the caller's Twelve Data API key", async () => {
    delete process.env.TWELVE_DATA_API_KEY;
    const tools = await harness();

    await expect(execute(tools.get("company_profile"))).rejects.toThrow(
      "requires the caller's TWELVE_DATA_API_KEY",
    );
    expect(requests).toHaveLength(0);
  });

  test("keeps the Twelve Data path when an Equibles key is also set", async () => {
    process.env.EQUIBLES_API_KEY = "eq_unused_equibles_key";
    const tools = await harness();
    await execute(tools.get("company_profile"));

    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.url.host === "api.twelvedata.com")).toBeTrue();
  });

  test("reads an Equibles screener row and ownership summary without confirming MIC", async () => {
    process.env.EQUIBLES_API_KEY = "eq_test_key_binding";
    const screenerBody =
      '{"totalCount":1,"count":1,"notFound":[],"data":[{"ticker":"AAPL","name":"Apple Inc.","market":"US","currency":"USD","sector":"Technology","industry":"Consumer Electronics","marketCap":5024411287552.0,"price":343.91,"squeezeScore":1}]}';
    const ownershipBody =
      '{"ticker":"AAPL","exactListing":false,"reportDate":"2026-09-30","sharesOutstanding":14594180000,"percentUnavailableReason":null}';
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      requests.push({ url, headers });
      const screener = url.pathname === "/v1/screener/stocks";
      return new Response(screener ? screenerBody : ownershipBody, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-limit": "100",
          "x-ratelimit-remaining": screener ? "98" : "97",
          "x-ratelimit-reset": "1793145600",
        },
      });
    };
    const tools = await harness();
    const result = await execute(tools.get("company_profile"), {
      symbol: "AAPL",
      mic: "XNGS",
      provider: "equibles",
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].url.origin).toBe("https://api.equibles.com");
    expect(requests[0].url.pathname).toBe("/v1/screener/stocks");
    expect(requests[0].url.searchParams.get("tickers")).toBe("AAPL");
    expect(requests[0].url.searchParams.get("limit")).toBe("1");
    expect(requests[0].url.searchParams.get("mic_code")).toBeNull();
    expect(requests[1].url.pathname).toBe("/v1/stocks/AAPL/ownership-summary");
    expect(requests[1].url.search).toBe("");
    for (const request of requests) {
      expect(request.headers.get("authorization")).toBe(
        "Bearer eq_test_key_binding",
      );
      expect(request.url.search).not.toContain("eq_test_key_binding");
    }
    expect(result.details).toMatchObject({
      operation: "company_profile",
      track: "us",
      listing: {
        symbol: "AAPL",
        requestedMic: "XNGS",
        market: "US",
        currency: "USD",
        micConfirmation: "not_supplied_by_provider",
        identityState: "exact_ticker_match_mic_not_confirmed",
      },
      profile: {
        value: {
          name: "Apple Inc.",
          marketCapRaw: "5024411287552.0",
          priceRaw: "343.91",
        },
      },
      shares: {
        value: {
          exactListing: false,
          outstanding: {
            state: "observed",
            rawValue: "14594180000",
            providerField: "sharesOutstanding",
          },
          float: {
            state: "not_supplied",
            rawValue: null,
          },
          institutionalReportDate: "2026-09-30",
          percentUnavailableReason: null,
        },
      },
      source: {
        provider: "Equibles",
        termsReference: "https://equibles.com/docs/api",
        screener: {
          endpoint: "/v1/screener/stocks",
          responseByteLength: Buffer.byteLength(screenerBody),
          contentSha256: createHash("sha256").update(screenerBody).digest("hex"),
          rateLimit: "100",
          rateRemaining: "98",
          rateReset: "1793145600",
        },
        ownership: {
          endpoint: "/v1/stocks/AAPL/ownership-summary",
          rateRemaining: "97",
        },
      },
      scope: {
        sharesBasis:
          "equibles_entity_wide_common_shares_on_current_split_basis",
        sharesMeasurementAt: null,
        sharesListingUnitCompatibility: "not_established",
        institutionalReportDate: "2026-09-30",
      },
    });
    expect(result.details.trackContext).toMatchObject({
      venueMic: null,
      timezone: null,
      providers: ["Equibles"],
      entitlement: "caller_equibles_plan",
      marketScope: "us_equibles_company_snapshot",
    });
    expect(result.details.trackContext.limitations).toContain("us_listing_only");
    expect(JSON.stringify(result.details)).not.toContain("eq_test_key_binding");
    expect(JSON.stringify(result.details)).not.toContain("squeezeScore");
  });

  test("does not call ownership or Twelve Data when the Equibles listing is not the exact US row", async () => {
    process.env.EQUIBLES_API_KEY = "eq_test_key_binding";
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, headers: new Headers(init?.headers) });
      const body =
        url.searchParams.get("tickers") === "AAPL"
          ? '{"notFound":["AAPL"],"data":[]}'
          : '{"notFound":[],"data":[{"ticker":"0700","name":"Tencent","market":"HK","currency":"HKD","sector":null,"industry":null,"marketCap":1,"price":1}]}';
      return new Response(body, { status: 200 });
    };
    const tools = await harness();
    const tool = tools.get("company_profile");

    await expect(
      execute(tool, { symbol: "AAPL", mic: "XNGS", provider: "equibles" }),
    ).rejects.toThrow("did not return the exact US listing");
    await expect(
      execute(tool, { symbol: "0700", mic: "XNGS", provider: "equibles" }),
    ).rejects.toThrow("did not return the exact US listing");
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.url.host === "api.equibles.com")).toBeTrue();
    expect(requests.every((request) => request.url.pathname === "/v1/screener/stocks")).toBeTrue();
  });

  test("preserves Equibles ordinary-share warnings for a US-listed ADR", async () => {
    process.env.EQUIBLES_API_KEY = "eq_test_key_binding";
    const reason = "Foreign private issuer: count is in ordinary shares, not ADRs.";
    globalThis.fetch = async (input) => new Response(JSON.stringify(
      new URL(String(input)).pathname === "/v1/screener/stocks"
        ? { data: [{ ticker: "TSM", name: "Fixture issuer", market: "US", currency: "USD" }] }
        : { ticker: "TSM", exactListing: false, sharesOutstanding: 1000, percentUnavailableReason: reason },
    ));
    const tools = await harness();
    const result = await execute(tools.get("company_profile"), {
      symbol: "TSM", mic: "XNYS", provider: "equibles",
    });
    expect(result.details.shares.value.percentUnavailableReason).toBe(reason);
    expect(result.details.shares.value.outstanding.rawValue).toBe("1000");
    expect(result.details.scope.sharesListingUnitCompatibility).toBe("not_established");
    expect(result.content[0].text).toContain(reason);
    expect(result.details.trackContext.limitations).toContain("share_count_not_confirmed_in_listing_units");
  });

  test("rejects a provider object forged as a numeric share token", async () => {
    process.env.EQUIBLES_API_KEY = "eq_test_key_binding";
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      requests.push({ url });
      return new Response(JSON.stringify(url.pathname === "/v1/screener/stocks"
        ? { data: [{ ticker: "AAPL", name: "Fixture issuer", market: "US", currency: "USD" }] }
        : { ticker: "AAPL", exactListing: false, sharesOutstanding: { __finance_equibles_number__: "9007199254740993" } }));
    };
    const tools = await harness();
    await expect(execute(tools.get("company_profile"), {
      symbol: "AAPL", mic: "XNGS", provider: "equibles",
    })).rejects.toThrow("invalid ownership-summary response");
    expect(requests).toHaveLength(2);
  });

  test("requires the selected Equibles key and does not fall back to Twelve Data", async () => {
    delete process.env.EQUIBLES_API_KEY;
    const tools = await harness();

    await expect(
      execute(tools.get("company_profile"), {
        symbol: "AAPL",
        mic: "XNGS",
        provider: "equibles",
      }),
    ).rejects.toThrow("requires the caller's EQUIBLES_API_KEY");
    expect(requests).toHaveLength(0);
  });

  test("does not retry an Equibles daily limit response", async () => {
    process.env.EQUIBLES_API_KEY = "eq_test_key_binding";
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ url, headers: new Headers(init?.headers) });
      return new Response('{"error":{"code":"rate_limited","message":"limit","status":429}}', {
        status: 429,
      });
    };
    const tools = await harness();

    await expect(
      execute(tools.get("company_profile"), {
        symbol: "AAPL",
        mic: "XNGS",
        provider: "equibles",
      }),
    ).rejects.toThrow("daily request limit was reached");
    expect(requests).toHaveLength(1);
    expect(requests[0].url.pathname).toBe("/v1/screener/stocks");
  });

  test("honors cancellation before provider transport", async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return new Response(profileBody);
    };
    const controller = new AbortController();
    controller.abort();
    const tools = await harness();

    await expect(
      execute(
        tools.get("company_profile"),
        { symbol: "AAPL", mic: "XNGS" },
        controller.signal,
      ),
    ).rejects.toThrow("failed safely");
    expect(called).toBeFalse();
  });
});

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
