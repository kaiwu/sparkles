import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  test("enumerates all 48 concrete request operations exactly once", () => {
    const rows = inventory
      .split("\n")
      .filter((line) => providers.some((provider) => line.startsWith(`| ${provider} |`)));

    expect(rows).toHaveLength(48);
    expect(new Set(rows).size).toBe(48);
    for (const provider of providers) {
      expect(rows.some((row) => row.startsWith(`| ${provider} |`))).toBeTrue();
    }
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
