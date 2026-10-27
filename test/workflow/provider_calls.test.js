import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { selectProviderChecks } from "../../scripts/test-live-provider-calls.js";

const root = resolve(import.meta.dir, "../..");
const inventory = readFileSync(resolve(root, "PROVIDER_CALLS.md"), "utf8");
const runner = readFileSync(
  resolve(root, "scripts/test-live-provider-calls.js"),
  "utf8",
);
const build = readFileSync(resolve(root, "scripts/build.js"), "utf8");

const providers = [
  "CAPCO",
  "CNINFO",
  "CSRC",
  "Eastmoney",
  "Equibles",
  "FRED",
  "HKEX",
  "Alpaca",
  "OpenFIGI",
  "SEC",
  "SFC",
  "Sina Finance",
  "SSE",
  "Tushare",
  "Twelve Data",
];

describe("provider call inventory and live-lane safety", () => {
  test("enumerates all 50 concrete request operations exactly once", () => {
    const rows = inventory
      .split("\n")
      .filter((line) => providers.some((provider) => line.startsWith(`| ${provider} |`)));

    expect(rows).toHaveLength(50);
    expect(new Set(rows).size).toBe(50);
    for (const provider of providers) {
      expect(rows.some((row) => row.startsWith(`| ${provider} |`))).toBeTrue();
    }
  });

  test("an available Equibles key does not opt the default audit into its quota", () => {
    const environment = { EQUIBLES_API_KEY: "eq_scripted_audit_key" };
    const defaultIds = selectProviderChecks(null, environment).map((check) => check.id);
    expect(defaultIds).toEqual(selectProviderChecks(null, {}).map((check) => check.id));
    expect(defaultIds).not.toContain("equibles.screener_and_ownership");
    expect(selectProviderChecks("twelve_data.profile_and_statistics", environment)
      .some((check) => check.provider === "Equibles")).toBeFalse();
  });

  test("explicit Equibles selection requires its own key and budgets exactly two requests", () => {
    const id = "equibles.screener_and_ownership";
    for (const environment of [{}, { EQUIBLES_API_KEY: " " }, { TWELVE_DATA_API_KEY: "demo" }]) {
      expect(() => selectProviderChecks(id, environment)).toThrow("requires EQUIBLES_API_KEY");
    }
    const selected = selectProviderChecks(id, { EQUIBLES_API_KEY: "eq_scripted_audit_key" });
    expect(selected.map((check) => check.id)).toEqual([id]);
    expect(selected[0].expectedRequests).toEqual([
      { method: "GET", host: "api.equibles.com", path: "/v1/screener/stocks" },
      { method: "GET", host: "api.equibles.com", path: "/v1/stocks/AAPL/ownership-summary" },
    ]);
    expect(() => selectProviderChecks("equibles.unknown", {})).toThrow("unknown provider check");
  });

  test("keeps credential rejections distinct from decoder conformance", () => {
    expect(inventory).toContain("auth only");
    expect(inventory).toContain("response conformance remains unproved");
    expect(inventory).toContain("provider code `40203`");
    expect(inventory).toContain("no keyless same-request sandbox");
    expect(runner).toContain('status: "blocked_credential"');
    expect(runner).toContain("sameProductionHostAndPathReached: true");
    expect(runner).toContain("decoderValidated: false");
  });

  test("bounds live requests, redacts secrets, and never reads credential files", () => {
    expect(runner).toContain('redirect: "error"');
    expect(runner).toContain("toolTimeoutMs = 30_000");
    expect(runner).toContain("secretQueryNames");
    expect(runner).toContain('"fred.metadata_and_observations"');
    expect(runner).toContain('requiresEnvironment: "FRED_API_KEY"');
    expect(runner).toContain('"alpaca.asset_universe.paper"');
    expect(runner).toContain('environment: "paper"');
    expect(runner).not.toContain("/tmp/tushare");
    expect(runner).not.toContain("/tmp/fred");
    expect(runner).not.toContain("/tmp/alpaca");
    expect(runner).not.toContain("TUSHARE_TOKEN_FILE");
    expect(runner).not.toContain("FRED_API_KEY_FILE");
    expect(runner).not.toContain("ALPACA_API_KEY_FILE");
  });

  test("keeps the pinned PDF parser external to Pi bundles", () => {
    expect(build).toContain('"pdfjs-dist"');
    expect(build).toContain('"pdfjs-dist/*"');
  });
});
