import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import {
  FINANCE_DIR,
  PLUGINS_DIR,
  ROOT,
  discoverPackages,
} from "../../scripts/modules.js";

function filesBelow(directory, extension) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? filesBelow(path, extension)
      : entry.name.endsWith(extension)
        ? [path]
        : [];
  });
}

function source(path) {
  return readFileSync(path, "utf8");
}

function display(path) {
  return relative(ROOT, path);
}

const piImport = /^import pi(?:\s|\/|\.|$)/m;
const promiseImport = /^import gleam\/javascript\/promise(?:\s|\.|$)/m;
const publicOrderMutation =
  /(?:pub\s+fn|export\s+(?:async\s+)?function|export\s+const)\s+(?:(?:place|submit|route|cancel|replace|modify|approve)_?order|(?:\w+_)?order_?(?:place|submit|route|cancel|replace|modify|approve))\b/i;
const mutatingBrokerAccess =
  /(?:broker|order)[-_ ]*(?:write|mutation)|(?:write|mutation)[-_ ]*(?:broker|order)|(?:paper|live)[-_ ]*trading/i;

describe("functional architecture", () => {
  test("finance libraries never depend on the Pi host", () => {
    for (const pkg of discoverPackages(FINANCE_DIR)) {
      for (const path of filesBelow(join(pkg.directory, "src"), ".gleam")) {
        expect(piImport.test(source(path)), display(path)).toBeFalse();
      }
    }
  });

  test("every concrete provider transport uses the shared limiter", () => {
    for (const pkg of discoverPackages(FINANCE_DIR)) {
      if (pkg.shortName === "finance_http") continue;
      for (const path of filesBelow(join(pkg.directory, "src"), ".gleam")) {
        const gleam = source(path);
        expect(
          /\b(?:binary_)?client\.new_default\b/.test(gleam),
          `${display(path)} must not bypass provider admission`,
        ).toBeFalse();
        if (!gleam.includes("transport.send")) continue;
        expect(
          /^import finance_http\/limiter(?:\s|\.|$)/m.test(gleam),
          display(path),
        ).toBeTrue();
        expect(
          /\blimiter\.admit\s*\(/.test(gleam),
          `${display(path)} must admit before calling the production transport`,
        ).toBeTrue();
      }
      for (const path of filesBelow(join(pkg.directory, "src"), ".mjs")) {
        expect(
          /\bfetch\s*\(/.test(source(path)),
          `${display(path)} must use finance_http transport`,
        ).toBeFalse();
      }
    }
  });

  test("text authority adapters remain independent of the PDF parser", () => {
    for (const name of [
      "finance_authority_snapshot",
      "finance_csrc",
      "finance_sfc",
    ]) {
      const manifest = source(join(FINANCE_DIR, name, "gleam.toml"));
      expect(manifest.includes("finance_pdf"), name).toBeFalse();
      expect(manifest.includes("finance_authority_pdf"), name).toBeFalse();
    }
  });

  test("plugin domain modules do not perform Pi or Promise effects", () => {
    for (const pkg of discoverPackages(PLUGINS_DIR)) {
      const domainDirectory = join(pkg.directory, "src", pkg.name);
      for (const path of filesBelow(domainDirectory, ".gleam")) {
        const gleam = source(path);
        expect(piImport.test(gleam), display(path)).toBeFalse();
        expect(promiseImport.test(gleam), display(path)).toBeFalse();
      }
    }
  });

  test("plugin FFI is restricted to explicitly named effect modules", () => {
    for (const pkg of discoverPackages(PLUGINS_DIR)) {
      const domainDirectory = join(pkg.directory, "src", pkg.name);
      for (const path of filesBelow(domainDirectory, ".gleam")) {
        if (!source(path).includes("@external")) continue;
        const allowed =
          basename(path) === "store.gleam" || path.includes("/effect/");
        expect(allowed, `${display(path)} must move FFI under effect/`).toBeTrue();
      }
    }
  });

  test("plugins cannot expose broker order-mutation operations or authority", () => {
    for (const pkg of discoverPackages(PLUGINS_DIR)) {
      const finance = pkg.metadata.metadata?.finance;
      const access = finance?.access;
      if (typeof access === "string") {
        expect(
          mutatingBrokerAccess.test(access),
          `${pkg.shortName} access`,
        ).toBeFalse();
      }
      if (/(^|_)broker(_|$)/.test(pkg.shortName)) {
        expect(
          finance?.broker_order_mutation,
          `${pkg.shortName} must declare broker_order_mutation = false`,
        ).toBeFalse();
      }

      for (const extension of [".gleam", ".mjs"]) {
        for (const path of filesBelow(join(pkg.directory, "src"), extension)) {
          expect(publicOrderMutation.test(source(path)), display(path)).toBeFalse();
        }
      }
    }
  });

  test("T6 broker and compliance plugins have no market-depth or transport surface", () => {
    const plugins = [
      "cn_broker_paper",
      "broker_readonly_alpaca",
      "broker_readonly_ibkr",
      "broker_paper_alpaca",
      "broker_paper_ibkr",
      "broker_live",
      "trade_compliance",
    ];
    const depthField =
      /["'](?:bid|bids|ask|asks|offer|offers|orderBook|marketDepth)["']/i;
    for (const name of plugins) {
      const directory = join(PLUGINS_DIR, name);
      const manifest = source(join(directory, "gleam.toml"));
      expect(
        manifest.includes("finance_http"),
        `${name} transport dependency`,
      ).toBeFalse();
      for (const path of filesBelow(join(directory, "src"), ".gleam")) {
        const gleam = source(path);
        expect(depthField.test(gleam), `${display(path)} depth field`).toBeFalse();
        expect(gleam.includes("@external"), `${display(path)} FFI`).toBeFalse();
      }
      expect(filesBelow(join(directory, "src"), ".mjs"), name).toEqual([]);
    }
  });

  test("pure finance foundations contain no Promise or unreviewed FFI boundary", () => {
    for (const name of [
      "finance_core",
      "finance_track",
      "finance_track_capabilities",
      "finance_provider_strategy",
      "finance_evidence",
      "finance_listing",
      "finance_market_authorities",
      "finance_market_rules",
      "finance_market_documents",
      "finance_document_attachment",
      "finance_market_accounting",
      "finance_calendar",
      "finance_market_calendar",
      "finance_cn_identity",
      "finance_cn_ohlcv",
      "finance_cn_calendar",
      "finance_cn_rules",
      "finance_cn_documents",
      "finance_cn_accounting",
      "finance_cn_testkit",
      "finance_hk_identity",
      "finance_hk_ohlcv",
      "finance_hk_calendar",
      "finance_hk_rules",
      "finance_hk_documents",
      "finance_hk_accounting",
      "finance_hk_testkit",
      "finance_us_calendar",
      "finance_us_ohlcv",
      "finance_us_rules",
      "finance_math",
      "finance_series",
      "finance_ohlcv",
      "finance_indicators",
      "finance_risk",
      "finance_execution",
      "finance_tape",
      "finance_broker_review",
      "finance_journal",
      "finance_replay",
      "finance_strategy",
      "finance_quote",
      "finance_table",
    ]) {
      const directory = join(FINANCE_DIR, name, "src");
      for (const path of filesBelow(directory, ".gleam")) {
        const gleam = source(path);
        expect(promiseImport.test(gleam), display(path)).toBeFalse();
        const reviewedDecimalPrimitive =
          name === "finance_core" && basename(path) === "decimal.gleam";
        if (!reviewedDecimalPrimitive) {
          expect(gleam.includes("@external"), display(path)).toBeFalse();
        }
      }
      expect(
        filesBelow(directory, ".mjs").map((path) => basename(path)).sort(),
        name,
      ).toEqual(name === "finance_core" ? ["decimal_ffi.mjs"] : []);
    }
  });

  test("cn and hk plugins cannot import SEC market-domain packages", () => {
    const forbidden = /^import finance_sec(?:\s|\/|\.|$)/m;
    for (const pkg of discoverPackages(PLUGINS_DIR)) {
      if (!/pi_sparkles_(cn|hk)_/.test(pkg.name)) continue;
      for (const path of filesBelow(join(pkg.directory, "src"), ".gleam")) {
        expect(forbidden.test(source(path)), display(path)).toBeFalse();
      }
    }
  });

  test("cn and hk plugin shells cannot import each other's market packages", () => {
    for (const pkg of discoverPackages(PLUGINS_DIR)) {
      const forbidden = pkg.name.startsWith("pi_sparkles_cn_")
        ? /^import finance_hk_(?:\w+)(?:\s|\/|\.|$)/m
        : pkg.name.startsWith("pi_sparkles_hk_")
          ? /^import finance_cn_(?:\w+)(?:\s|\/|\.|$)/m
          : null;
      if (!forbidden) continue;
      for (const path of filesBelow(join(pkg.directory, "src"), ".gleam")) {
        expect(forbidden.test(source(path)), display(path)).toBeFalse();
      }
    }
  });

  test("us plugin shells cannot import CN or HK market packages", () => {
    const forbidden = /^import finance_(?:cn_|hk_|eastmoney)(?:\w+)?(?:\s|\/|\.|$)/m;
    for (const pkg of discoverPackages(PLUGINS_DIR)) {
      if (!pkg.name.startsWith("pi_sparkles_us_")) continue;
      for (const path of filesBelow(join(pkg.directory, "src"), ".gleam")) {
        expect(forbidden.test(source(path)), display(path)).toBeFalse();
      }
    }
  });

  test("cn and hk plugin shells cannot import US market packages", () => {
    const forbidden =
      /^import finance_(?:market_alpaca|us_\w+)(?:\s|\/|\.|$)/m;
    for (const pkg of discoverPackages(PLUGINS_DIR)) {
      if (!/pi_sparkles_(cn|hk)_/.test(pkg.name)) continue;
      for (const path of filesBelow(join(pkg.directory, "src"), ".gleam")) {
        expect(forbidden.test(source(path)), display(path)).toBeFalse();
      }
    }
  });

  test("US market packages cannot import CN or HK market packages", () => {
    const forbidden = /^import finance_(?:cn_|hk_)\w*(?:\s|\/|\.|$)/m;
    for (const pkg of discoverPackages(FINANCE_DIR)) {
      if (!pkg.name.startsWith("finance_us_")) continue;
      for (const path of filesBelow(join(pkg.directory, "src"), ".gleam")) {
        expect(forbidden.test(source(path)), display(path)).toBeFalse();
      }
    }
  });

  test("cn and hk testkits cannot import each other's market packages", () => {
    for (const track of ["cn", "hk"]) {
      const other = track === "cn" ? "hk" : "cn";
      const directory = join(FINANCE_DIR, `finance_${track}_testkit`, "src");
      const forbidden = new RegExp(`^import finance_${other}_(?:\\w+)(?:\\s|/|\\.|$)`, "m");
      for (const path of filesBelow(directory, ".gleam")) {
        expect(forbidden.test(source(path)), display(path)).toBeFalse();
      }
    }
  });
});
