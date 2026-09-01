// DSH npm packaging — the parallel of scripts/npm-package.js for the
// DeepSeek Harness all-in-one plugin.
//
// It turns the content-locked DSH bundle (dist/dsh/dsh-sparkles, built by
// `bun run dsh:bundle`) into the stable `@dsh-sparkles/dsh-sparkles` npm
// package: an exact file inventory, a `dsh.bundle.patch` manifest, the
// service peer declarations, no lifecycle scripts, no credential values, an
// inner/outer SHA-256 inventory, and a clean-tarball re-verification. It
// never publishes.
//
//   bun run dsh:npm:pack [-- T5|T6] [--no-build]
//   bun run dsh:npm:pack -- --install-smoke --publish-dry-run --check-registry

import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { DEFAULT_AGGREGATE_TARGET } from "./aggregate-bundle.js";
import {
  DSH_OUTPUT_DIR,
  DSH_PACKAGE_NAME,
  DSH_PLUGIN_NAME,
  DSH_RUNTIME_DEPENDENCIES,
  DSH_RUNTIME_PEERS,
  buildDshBundle,
  dshBundlePlan,
  verifyDshBundle,
} from "./dsh-bundle.js";
import { DIST_DIR, ROOT } from "./modules.js";
import { readTierManifest } from "./tiers.js";

const DSH_NPM_RELEASE_SCHEMA_VERSION = 2;
const DSH_NPM_PACKAGE_NAME = DSH_PACKAGE_NAME;
const DSH_NPM_REGISTRY = "https://registry.npmjs.org/";
const DSH_PEERS = DSH_RUNTIME_PEERS;
const STARTUP_SMOKE_TIMEOUT_MILLISECONDS = 15_000;
const DSH_NPM_PACKAGE_FILES = [
  "CHANGELOG.md",
  "CONFIGURATION.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "SHA256SUMS",
  "THIRD_PARTY_NOTICES.md",
  "cordis.patch.yml",
  "client.js",
  "dsh-lock.json",
  "index.js",
  "index.js.map",
  "release-lock.json",
];
const DSH_BUNDLE_COPY_FILES = [
  "CONFIGURATION.md",
  "client.js",
  "cordis.patch.yml",
  "dsh-lock.json",
  "index.js",
  "index.js.map",
];
const DSH_ROOT_COPY_FILES = [
  "LICENSE",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
];
// The DSH package ships its own changelog, not the Pi package's.
const DSH_CHANGELOG_SOURCE = join(ROOT, "dsh", "CHANGELOG.md");
const DSH_SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/,
  /\bnpm_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function rootManifest() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
}

function runtimeDependencies() {
  const dependencies = rootManifest().dependencies ?? {};
  const expected = DSH_RUNTIME_DEPENDENCIES;
  if (
    Object.entries(expected).some(
      ([name, version]) => dependencies[name] !== version,
    )
  ) {
    throw new Error(
      "Root package.json must pin the DSH PDF runtime dependencies",
    );
  }
  return { ...expected };
}

function componentCount(plan) {
  return plan.componentCount ?? plan.plugins.length;
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function runCaptured(command, args, options = {}) {
  const result = Bun.spawnSync([command, ...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
    timeout: options.timeout,
    killSignal: options.killSignal,
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function requireSuccess(result, label) {
  if (result.exitCode === 0) return result;
  const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  throw new Error(`${label} failed${details ? `:\n${details}` : ""}`);
}

function dshPackageReadme(plan) {
  const version = plan.packageVersion;
  const installSection = plan.releasable
    ? `## Quick start

\`\`\`sh
dsh plugin --profile <name> add @dsh-sparkles/dsh-sparkles@${version}
\`\`\`
`
    : `## Local preview install

This content-locked package is private. Install the generated package directory
from a Sparkles checkout; do not attempt a registry install:

\`\`\`sh
dsh plugin --profile <name> add ./dist/dsh/npm/${plan.throughTierId.toLowerCase()}/package
\`\`\`
`;
  return `# Sparkles for DeepSeek Harness

Turn [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) into a
finance research assistant for mainland China, Hong Kong, and US markets.

This is the DSH distribution of
[Sparkles](https://github.com/kaiwu/sparkles). Pi users should install the sibling
[@pi-sparkles/pi-sparkles](https://www.npmjs.com/package/@pi-sparkles/pi-sparkles)
package, which reuses the same finance cores but owns separate Pi lifecycle and
terminal presentation.

Ask about a stock or ETF in everyday language. DSH Sparkles brings current market
data, price history, company filings, fundamentals, and financial calculations
into the conversation.

## What it gives you

- Current quotes and recent price history for supported CN, HK, and US sources.
- Trend, momentum, and volatility analysis with SMA, RSI, and ATR.
- SEC, CNINFO, and HKEXnews filing and disclosure research.
- Fundamental, valuation, portfolio-risk, scenario, event-study, and backtest
  calculations when the required data is available.
- Bounded CN/HK/US transaction-tape packet review, local possible-fill
  simulation, read-only broker evidence review, compound compliance checks,
  non-executable handoffs, and receipt reconciliation.
- Clear source, timestamp, currency, freshness, and data-limit context in answers.
- Responsive inline SVG OHLCV charts rendered as ordinary DSH tool output.

DSH automatically looks up current evidence for questions about price, trend,
buying now, or when to sell. You do not need to ask it to "use tools" first.

${installSection}
The bundle patch layer is applied on the next \`dsh --profile <name>\` boot.
Uninstall with \`dsh plugin --profile <name> remove @dsh-sparkles/dsh-sparkles\`.

For most mainland China and Hong Kong quote/history research, and for SEC filing
research, the only setup is a contact address used to identify requests to public
data services:

\`\`\`sh
AGENT_CONTACT="you@example.com" dsh --profile <name>
\`\`\`

Then ask naturally:

- \`Get a current quote for AAPL.\`
- \`分析一下科创50ETF的走势\`
- \`588000 如果现在买，什么时候卖比较好？\`
- \`分析腾讯 00700.HK 最近半年的趋势、动量和波动\`
- \`Summarize AAPL's latest SEC fundamentals and cite the evidence.\`
- \`Compare this portfolio with its benchmark and explain the largest risks.\`

## Optional data-service setup

The package loads without provider credentials. Add only the services you want;
you do not need every variable below.

| Variable | What it enables |
| --- | --- |
| \`AGENT_CONTACT\` | Identified access to supported public services, including Eastmoney, CNINFO, SEC, and HKEXnews. Use one email address everywhere. |
| \`TUSHARE_TOKEN\` | Optional, rate- and entitlement-limited mainland China stock-identity fallback. It is never required or the first route. Tushare permissions and points apply. |
| \`ALPACA_API_KEY_ID\`, \`ALPACA_API_SECRET_KEY\` | Optional Alpaca US prices, bars, news, corporate actions, and assets. Feed permissions apply. |
| \`OPENFIGI_API_KEY\` | Optional OpenFIGI identity mapping. |
| \`TWELVE_DATA_API_KEY\` | Optional Twelve Data company profiles. |
| \`FRED_API_KEY\` | Optional FRED macroeconomic series. |

Example:

\`\`\`sh
AGENT_CONTACT="you@example.com" \\
ALPACA_API_KEY_ID="..." \\
ALPACA_API_SECRET_KEY="..." \\
dsh --profile <name>
\`\`\`

Credentials stay in your runtime environment; this package does not write, log,
or persist them. Restart DSH after changing environment configuration because
some adapters initialize at boot.

## Boundaries

Sparkles for DSH is read-only research software: it cannot place, change, or
cancel broker orders. External providers, gateways, SDKs, credentials, and
entitlements remain caller-owned; Sparkles never silently selects or falls back
to another provider. It is not investment, legal, accounting, or tax advice.
See \`CONFIGURATION.md\` for the complete source and configuration reference.

Version ${version} · ${plan.throughTierId} · ${componentCount(plan)} plugin components
`;
}

function dshNpmManifest(plan) {
  return {
    name: DSH_NPM_PACKAGE_NAME,
    version: plan.packageVersion,
    description:
      "Sparkles finance evidence tools with a host-native DeepSeek Harness shell and browser client",
    private: !plan.releasable,
    type: "module",
    main: "./index.js",
    exports: {
      ".": "./index.js",
      "./client": "./client.js",
      "./cordis.patch.yml": "./cordis.patch.yml",
      "./package.json": "./package.json",
    },
    files: DSH_NPM_PACKAGE_FILES,
    license: "Apache-2.0",
    repository: {
      type: "git",
      url: "git+https://github.com/kaiwu/sparkles.git",
    },
    homepage: "https://sparkles.extensio.cn",
    bugs: { url: "https://github.com/kaiwu/sparkles/issues" },
    keywords: [
      "deepseek-harness",
      "dsh",
      "dsh-plugin",
      "finance",
      "gleam",
      "all-in-one",
    ],
    engines: { node: ">=22.19.0" },
    dependencies: runtimeDependencies(),
    peerDependencies: DSH_PEERS,
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: {
        inject: [
          "@deepseek-ai/dsh-client-runtime",
          "@deepseek-ai/dsh-client-ui-layout",
          "@deepseek-ai/dsh-client-ui-tool",
        ],
        platform: "web",
      },
    },
    dshSparkles: {
      aggregateThrough: plan.throughTierId,
      maturity: plan.maturity,
      piAggregateMaturity: plan.piAggregateMaturity ?? plan.maturity,
      dshReleaseStatus: plan.dshRelease?.status ??
        (plan.releasable ? "product_useful" : "preview"),
      dshBlockerCount: (plan.dshBlockers ?? []).length,
      pluginCount: componentCount(plan),
      omittedProposalCount: plan.omittedProposals.length,
      partialImplementationCount: plan.partialImplementations.length,
      openBlockerCount: plan.openBlockers.length,
      excludedPiProposalCount: (plan.excludedPiProposals ?? []).length,
      extraDshPluginCount: (plan.extraDshPlugins ?? []).length,
      publishable: plan.releasable,
      brokerOrderMutation: false,
    },
    ...(plan.releasable
      ? {
          publishConfig: {
            access: "public",
            registry: DSH_NPM_REGISTRY,
          },
        }
      : {}),
  };
}

function dshReleaseLock(plan, packageDirectory) {
  const bundleLock = JSON.parse(
    readFileSync(join(packageDirectory, "dsh-lock.json"), "utf8"),
  );
  return {
    schemaVersion: DSH_NPM_RELEASE_SCHEMA_VERSION,
    package: { name: DSH_NPM_PACKAGE_NAME, version: plan.packageVersion },
    throughTierId: plan.throughTierId,
    maturity: plan.maturity,
    piAggregateMaturity: plan.piAggregateMaturity ?? plan.maturity,
    dshRelease: plan.dshRelease ?? {
      status: plan.releasable ? "product_useful" : "preview",
      reason: null,
    },
    dshBlockers: plan.dshBlockers ?? [],
    publishable: plan.releasable,
    pluginCount: componentCount(plan),
    excludedPiProposals: plan.excludedPiProposals ?? [],
    extraDshPlugins: plan.extraDshPlugins ?? [],
    sourceBundle: {
      package: bundleLock.package,
      dshLockSha256: sha256File(join(packageDirectory, "dsh-lock.json")),
      bundleSha256: bundleLock.indexSha256,
    },
    npmRegistry: DSH_NPM_REGISTRY,
    npmFiles: [...DSH_NPM_PACKAGE_FILES, "package.json"].sort((a, b) =>
      a.localeCompare(b),
    ),
    runtimeDependencies: runtimeDependencies(),
    runtimePeerDependencies: DSH_PEERS,
    credentialValuesIncluded: false,
    lifecycleScriptsIncluded: false,
    brokerOrderMutation: false,
  };
}

function directoryFiles(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error(`DSH npm package contains unsupported content: ${path}`);
    }
  };
  visit(directory);
  return files.sort((a, b) => a.localeCompare(b));
}

function checksumEntries(directory) {
  return directoryFiles(directory)
    .filter((path) => basename(path) !== "SHA256SUMS")
    .map((path) => ({
      path: relative(directory, path).split(sep).join("/"),
      sha256: sha256File(path),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function writeChecksums(directory) {
  const source = checksumEntries(directory)
    .map(({ sha256: digest, path }) => `${digest}  ${path}`)
    .join("\n");
  writeFileSync(join(directory, "SHA256SUMS"), `${source}\n`);
}

function parseChecksums(source) {
  return source
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})  (.+)$/);
      if (!match) throw new Error(`Invalid checksum line: ${line}`);
      return { sha256: match[1], path: match[2] };
    });
}

function scanForCredentialValues(directory) {
  for (const path of directoryFiles(directory)) {
    if (/\.(?:map|js|json|md)$/.test(path) || basename(path) === "LICENSE") {
      const source = readFileSync(path, "utf8");
      if (DSH_SECRET_PATTERNS.some((pattern) => pattern.test(source))) {
        throw new Error(
          `DSH npm package contains text resembling a credential value: ${relative(directory, path)}`,
        );
      }
    }
  }
}

export function dshNpmPackagePlan(
  manifest,
  throughTierId = DEFAULT_AGGREGATE_TARGET,
) {
  const bundle = dshBundlePlan(throughTierId, manifest);
  return {
    ...bundle,
    npmPackageName: DSH_NPM_PACKAGE_NAME,
    bundleDirectory: DSH_OUTPUT_DIR,
    npmOutputDirectory: join(
      DIST_DIR,
      "dsh",
      "npm",
      bundle.throughTierId.toLowerCase(),
    ),
  };
}

export function verifyDshNpmPackageDirectory(directory, expectedPlan) {
  const root = resolve(directory);
  const expectedRuntimeDependencies = runtimeDependencies();
  const expectedFiles = [...DSH_NPM_PACKAGE_FILES, "package.json"].sort((a, b) =>
    a.localeCompare(b),
  );
  const actualFiles = directoryFiles(root).map((path) =>
    relative(root, path).split(sep).join("/"),
  );
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("DSH npm package file inventory is incomplete or contains extras");
  }
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "release-lock.json"), "utf8"));
  const bundleLock = JSON.parse(readFileSync(join(root, "dsh-lock.json"), "utf8"));
  if (
    lock.schemaVersion !== DSH_NPM_RELEASE_SCHEMA_VERSION ||
    manifest.name !== DSH_NPM_PACKAGE_NAME ||
    manifest.name !== lock.package?.name ||
    manifest.version !== lock.package?.version ||
    manifest.private !== !lock.publishable ||
    manifest.main !== "./index.js" ||
    manifest.dsh?.bundle?.patch !== "./cordis.patch.yml" ||
    manifest.dsh?.client?.platform !== "web" ||
    JSON.stringify(manifest.dsh?.client?.inject) !==
      JSON.stringify([
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-tool",
      ]) ||
    manifest.exports?.["."] !== "./index.js" ||
    manifest.exports?.["./client"] !== "./client.js" ||
    JSON.stringify(manifest.files) !== JSON.stringify(DSH_NPM_PACKAGE_FILES) ||
    manifest.license !== "Apache-2.0" ||
    manifest.engines?.node !== ">=22.19.0" ||
    JSON.stringify(manifest.dependencies) !==
      JSON.stringify(expectedRuntimeDependencies) ||
    JSON.stringify(manifest.peerDependencies) !== JSON.stringify(DSH_PEERS) ||
    lock.maturity !== manifest.dshSparkles?.maturity ||
    lock.piAggregateMaturity !== manifest.dshSparkles?.piAggregateMaturity ||
    lock.dshRelease?.status !== manifest.dshSparkles?.dshReleaseStatus ||
    (lock.dshBlockers ?? []).length !==
      manifest.dshSparkles?.dshBlockerCount ||
    manifest.scripts !== undefined ||
    lock.lifecycleScriptsIncluded !== false ||
    lock.credentialValuesIncluded !== false ||
    lock.brokerOrderMutation !== false
  ) {
    throw new Error("DSH npm package manifest or release lock is inconsistent");
  }
  if (
    (lock.publishable &&
      (manifest.publishConfig?.access !== "public" ||
        manifest.publishConfig?.registry !== DSH_NPM_REGISTRY)) ||
    (!lock.publishable && manifest.publishConfig !== undefined)
  ) {
    throw new Error("DSH npm publish configuration does not match maturity");
  }
  if (
    bundleLock.target !== lock.throughTierId ||
    bundleLock.pluginCount !== lock.pluginCount ||
    bundleLock.maturity !== lock.maturity ||
    bundleLock.piAggregateMaturity !== lock.piAggregateMaturity ||
    JSON.stringify(bundleLock.dshRelease ?? {}) !==
      JSON.stringify(lock.dshRelease ?? {}) ||
    JSON.stringify(bundleLock.dshBlockers ?? []) !==
      JSON.stringify(lock.dshBlockers ?? []) ||
    bundleLock.publishable !== lock.publishable ||
    bundleLock.indexSha256 !== sha256File(join(root, "index.js")) ||
    lock.sourceBundle.bundleSha256 !== sha256File(join(root, "index.js")) ||
    lock.sourceBundle.dshLockSha256 !== sha256File(join(root, "dsh-lock.json")) ||
    JSON.stringify(lock.npmFiles) !== JSON.stringify(expectedFiles) ||
    JSON.stringify(lock.runtimeDependencies) !==
      JSON.stringify(expectedRuntimeDependencies) ||
    JSON.stringify(lock.runtimePeerDependencies) !== JSON.stringify(DSH_PEERS)
  ) {
    throw new Error("DSH npm package differs from its source bundle lock");
  }
  if (expectedPlan) {
    if (
      manifest.version !== expectedPlan.packageVersion ||
      lock.throughTierId !== expectedPlan.throughTierId ||
      lock.publishable !== expectedPlan.releasable ||
      lock.pluginCount !== componentCount(expectedPlan) ||
      manifest.dshSparkles?.aggregateThrough !== expectedPlan.throughTierId ||
      manifest.dshSparkles?.maturity !== expectedPlan.maturity ||
      manifest.dshSparkles?.piAggregateMaturity !==
        (expectedPlan.piAggregateMaturity ?? expectedPlan.maturity) ||
      manifest.dshSparkles?.dshReleaseStatus !==
        (expectedPlan.dshRelease?.status ??
          (expectedPlan.releasable ? "product_useful" : "preview")) ||
      manifest.dshSparkles?.dshBlockerCount !==
        (expectedPlan.dshBlockers ?? []).length ||
      manifest.dshSparkles?.pluginCount !== componentCount(expectedPlan) ||
      manifest.dshSparkles?.omittedProposalCount !== expectedPlan.omittedProposals.length ||
      manifest.dshSparkles?.partialImplementationCount !==
        expectedPlan.partialImplementations.length ||
      manifest.dshSparkles?.openBlockerCount !== expectedPlan.openBlockers.length ||
      manifest.dshSparkles?.excludedPiProposalCount !==
        (expectedPlan.excludedPiProposals ?? []).length ||
      manifest.dshSparkles?.extraDshPluginCount !==
        (expectedPlan.extraDshPlugins ?? []).length ||
      manifest.dshSparkles?.publishable !== expectedPlan.releasable ||
      manifest.dshSparkles?.brokerOrderMutation !== false
    ) {
      throw new Error("DSH npm package does not match the selected bundle plan");
    }
  }
  const declaredChecksums = parseChecksums(
    readFileSync(join(root, "SHA256SUMS"), "utf8"),
  );
  for (const entry of declaredChecksums) {
    if (
      isAbsolute(entry.path) ||
      entry.path.includes("\\") ||
      entry.path.split("/").includes("..")
    ) {
      throw new Error(`Unsafe checksum path: ${entry.path}`);
    }
    const path = resolve(root, entry.path);
    if (!isInside(root, path) || sha256File(path) !== entry.sha256) {
      throw new Error(`Checksum mismatch: ${entry.path}`);
    }
  }
  const checksumLine = (entry) => `${entry.sha256}  ${entry.path}`;
  if (
    JSON.stringify(declaredChecksums.map(checksumLine)) !==
    JSON.stringify(checksumEntries(root).map(checksumLine))
  ) {
    throw new Error("Checksum inventory is incomplete or unordered");
  }
  scanForCredentialValues(root);
  return {
    directory: root,
    name: manifest.name,
    version: manifest.version,
    throughTierId: lock.throughTierId,
    pluginCount: lock.pluginCount,
    publishable: lock.publishable,
  };
}

function normalizeNpmPackResult(source) {
  const parsed = JSON.parse(source);
  const record = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  if (
    typeof record !== "object" ||
    record === null ||
    typeof record.filename !== "string" ||
    !Array.isArray(record.files)
  ) {
    throw new Error("npm pack returned an unsupported JSON result");
  }
  return record;
}

function packDirectory(packageDirectory, destination) {
  const result = requireSuccess(
    runCaptured(
      "npm",
      [
        "pack",
        packageDirectory,
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        destination,
      ],
      { cwd: ROOT },
    ),
    "npm pack",
  );
  return normalizeNpmPackResult(result.stdout);
}

function tarballEntries(path) {
  const result = requireSuccess(
    runCaptured("tar", ["-tzf", path], { cwd: ROOT }),
    "tarball inventory",
  );
  return result.stdout
    .trim()
    .split("\n")
    .filter((entry) => entry && !entry.endsWith("/"))
    .sort();
}

function writeOuterChecksums(directory, filenames) {
  const source = [...filenames]
    .sort()
    .map((filename) => `${sha256File(join(directory, filename))}  ${filename}`)
    .join("\n");
  writeFileSync(join(directory, "RELEASE_SHA256SUMS"), `${source}\n`);
}

export function assertDshNpmPublishable(summary) {
  if (summary.publishable !== true) {
    throw new Error(
      `${summary.throughTierId} dsh-sparkles bundle is a blocked preview and cannot be published`,
    );
  }
}

export function verifyDshNpmRelease(directory, expectedPlan) {
  const root = resolve(directory);
  const summaryPath = join(root, "npm-pack.json");
  const sumsPath = join(root, "RELEASE_SHA256SUMS");
  for (const path of [summaryPath, sumsPath]) {
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(`Release file is missing: ${path}`);
    }
  }
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  if (
    summary.schemaVersion !== DSH_NPM_RELEASE_SCHEMA_VERSION ||
    summary.package?.name !== DSH_NPM_PACKAGE_NAME ||
    typeof summary.tarball !== "string" ||
    basename(summary.tarball) !== summary.tarball
  ) {
    throw new Error("DSH npm pack record is invalid");
  }
  const packageSummary = verifyDshNpmPackageDirectory(
    join(root, "package"),
    expectedPlan,
  );
  const tarball = join(root, summary.tarball);
  if (
    !existsSync(tarball) ||
    !lstatSync(tarball).isFile() ||
    sha256File(tarball) !== summary.tarballSha256 ||
    summary.package.name !== packageSummary.name ||
    summary.package.version !== packageSummary.version ||
    summary.throughTierId !== packageSummary.throughTierId ||
    summary.pluginCount !== packageSummary.pluginCount ||
    summary.publishable !== packageSummary.publishable
  ) {
    throw new Error("DSH npm tarball or pack record is inconsistent");
  }
  const expectedTarEntries = [...DSH_NPM_PACKAGE_FILES, "package.json"]
    .map((path) => `package/${path}`)
    .sort();
  if (JSON.stringify(tarballEntries(tarball)) !== JSON.stringify(expectedTarEntries)) {
    throw new Error("DSH npm tarball file inventory is incomplete or contains extras");
  }
  const declaredSums = parseChecksums(readFileSync(sumsPath, "utf8"));
  const expectedOuter = ["npm-pack.json", summary.tarball]
    .sort()
    .map((path) => ({ path, sha256: sha256File(join(root, path)) }));
  const checksumLine = (entry) => `${entry.sha256}  ${entry.path}`;
  if (
    JSON.stringify(declaredSums.map(checksumLine)) !==
    JSON.stringify(expectedOuter.map(checksumLine))
  ) {
    throw new Error("DSH npm release checksum inventory is invalid");
  }

  const extraction = mkdtempSync(join(tmpdir(), "dsh-sparkles-npm-verify-"));
  try {
    requireSuccess(
      runCaptured("tar", ["-xzf", tarball, "-C", extraction], { cwd: ROOT }),
      "npm tarball extraction",
    );
    verifyDshNpmPackageDirectory(join(extraction, "package"), expectedPlan);
  } finally {
    rmSync(extraction, { recursive: true, force: true });
  }
  return { ...packageSummary, tarball, tarballSha256: summary.tarballSha256 };
}

export async function assembleDshNpmRelease(
  plan,
  bundleDirectory = plan.bundleDirectory,
  outputDirectory = plan.npmOutputDirectory,
) {
  verifyDshBundle(bundleDirectory, plan);
  for (const filename of DSH_BUNDLE_COPY_FILES) {
    const path = join(bundleDirectory, filename);
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(`DSH bundle source is missing: ${path}`);
    }
  }
  for (const filename of DSH_ROOT_COPY_FILES) {
    const path = join(ROOT, filename);
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(`DSH npm release source is missing: ${path}`);
    }
  }
  if (!existsSync(DSH_CHANGELOG_SOURCE) || !lstatSync(DSH_CHANGELOG_SOURCE).isFile()) {
    throw new Error("DSH changelog source is missing: " + DSH_CHANGELOG_SOURCE);
  }

  mkdirSync(dirname(outputDirectory), { recursive: true });
  const staging = join(
    dirname(outputDirectory),
    `.${basename(outputDirectory)}.staging-${process.pid}-${randomUUID()}`,
  );
  const backup = join(
    dirname(outputDirectory),
    `.${basename(outputDirectory)}.previous-${process.pid}-${randomUUID()}`,
  );
  const packageDirectory = join(staging, "package");
  mkdirSync(packageDirectory, { recursive: true });
  let movedPrevious = false;
  try {
    for (const filename of DSH_BUNDLE_COPY_FILES) {
      copyFileSync(join(bundleDirectory, filename), join(packageDirectory, filename));
    }
    for (const filename of DSH_ROOT_COPY_FILES) {
      copyFileSync(join(ROOT, filename), join(packageDirectory, filename));
    }
    copyFileSync(DSH_CHANGELOG_SOURCE, join(packageDirectory, "CHANGELOG.md"));
    writeFileSync(join(packageDirectory, "README.md"), dshPackageReadme(plan));
    writeJson(join(packageDirectory, "package.json"), dshNpmManifest(plan));
    writeJson(
      join(packageDirectory, "release-lock.json"),
      dshReleaseLock(plan, packageDirectory),
    );
    writeChecksums(packageDirectory);
    const packageSummary = verifyDshNpmPackageDirectory(packageDirectory, plan);
    const npmResult = packDirectory(packageDirectory, staging);
    const tarball = join(staging, npmResult.filename);
    if (
      npmResult.name !== packageSummary.name ||
      npmResult.version !== packageSummary.version ||
      !existsSync(tarball)
    ) {
      throw new Error("npm pack identity differs from the staged package");
    }
    const packRecord = {
      schemaVersion: DSH_NPM_RELEASE_SCHEMA_VERSION,
      package: { name: npmResult.name, version: npmResult.version },
      throughTierId: plan.throughTierId,
      maturity: plan.maturity,
      pluginCount: componentCount(plan),
      publishable: plan.releasable,
      tarball: npmResult.filename,
      tarballSha256: sha256File(tarball),
      npmIntegrity: npmResult.integrity,
      npmShasum: npmResult.shasum,
      packedSize: npmResult.size,
      unpackedSize: npmResult.unpackedSize,
      entryCount: npmResult.entryCount ?? npmResult.files.length,
      files: npmResult.files.map((file) => ({
        path: file.path,
        size: file.size,
        mode: file.mode,
      })),
    };
    writeJson(join(staging, "npm-pack.json"), packRecord);
    writeOuterChecksums(staging, [npmResult.filename, "npm-pack.json"]);
    verifyDshNpmRelease(staging, plan);

    if (existsSync(outputDirectory)) {
      renameSync(outputDirectory, backup);
      movedPrevious = true;
    }
    renameSync(staging, outputDirectory);
    if (movedPrevious) rmSync(backup, { recursive: true, force: true });
    return verifyDshNpmRelease(outputDirectory, plan);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (movedPrevious && !existsSync(outputDirectory) && existsSync(backup)) {
      renameSync(backup, outputDirectory);
    }
    throw error;
  }
}

export async function buildDshNpmRelease(
  throughTierId = DEFAULT_AGGREGATE_TARGET,
  { build = true, bundleDirectory, outputDirectory } = {},
) {
  const plan = dshNpmPackagePlan(readTierManifest(), throughTierId);
  const bundleOutput = bundleDirectory ?? plan.bundleDirectory;
  if (build) {
    await buildDshBundle(plan.throughTierId);
  }
  const summary = await assembleDshNpmRelease(
    plan,
    bundleOutput,
    outputDirectory ?? plan.npmOutputDirectory,
  );
  console.log(
    `${summary.throughTierId} dsh-sparkles npm package: ${summary.tarball} (${summary.pluginCount} plugin components${summary.publishable ? ", publish-ready" : ", blocked preview"})`,
  );
  return summary;
}

export function dshNpmPublishDryRun(releaseDirectory, expectedPlan) {
  const summary = verifyDshNpmRelease(releaseDirectory, expectedPlan);
  assertDshNpmPublishable(summary);
  requireSuccess(
    runCaptured(
      "npm",
      ["publish", summary.tarball, "--dry-run", "--ignore-scripts"],
      { cwd: ROOT },
    ),
    "npm publish --dry-run",
  );
  return summary;
}

function resolveDshCli() {
  try {
    const result = runCaptured("which", ["dsh"], {});
    return result.exitCode === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

export function assertDshHostVersion(
  dshCommand,
  expectedVersion,
  { run = runCaptured } = {},
) {
  const result = requireSuccess(
    run(dshCommand, ["--version"], {}),
    "DSH host version check",
  );
  const actualVersion = result.stdout.trim();
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Installed DSH host is ${actualVersion || "unknown"}, expected exact ${expectedVersion}`,
    );
  }
  return actualVersion;
}

/**
 * Install the exact tarball into a clean npm prefix and smoke its DSH bundle
 * contract: import the entrypoint, assert the Cordis plugin shape and
 * `dsh.bundle.patch`, then compose it into an isolated profile with the real
 * `dsh` CLI when one is available. The standalone prefix intentionally does
 * not auto-install host peers: the verified manifest pins their versions, and
 * the installed DSH runtime is the authority that supplies and exercises them.
 */
export function dshNpmInstallSmoke(
  releaseDirectory,
  expectedPlan,
  { dshCommand = process.env.DSH_SPARKLES_DSH_COMMAND ?? resolveDshCli() } = {},
) {
  const summary = verifyDshNpmRelease(releaseDirectory, expectedPlan);
  const installation = mkdtempSync(
    join(tmpdir(), "dsh-sparkles-npm-install-smoke-"),
  );
  try {
    requireSuccess(
      runCaptured(
        "npm",
        [
          "install",
          "--prefix",
          installation,
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
          "--package-lock=false",
          "--legacy-peer-deps",
          summary.tarball,
        ],
        { cwd: installation },
      ),
      "clean npm tarball installation",
    );
    const installedPackage = join(
      installation,
      "node_modules",
      DSH_NPM_PACKAGE_NAME,
    );
    verifyDshNpmPackageDirectory(installedPackage, expectedPlan);
    const installedRuntimeDependencies = runtimeDependencies();
    for (const [name, expectedVersion] of Object.entries(
      installedRuntimeDependencies,
    )) {
      const installedManifest = JSON.parse(
        readFileSync(
          join(installation, "node_modules", name, "package.json"),
          "utf8",
        ),
      );
      if (installedManifest.version !== expectedVersion) {
        throw new Error(
          `Clean npm installation resolved ${name} ${installedManifest.version}, expected ${expectedVersion}`,
        );
      }
    }

    const entrypoint = join(installedPackage, "index.js");
    const patchPath = join(installedPackage, "cordis.patch.yml");
    if (!existsSync(patchPath) || !lstatSync(patchPath).isFile()) {
      throw new Error("Installed package has no cordis.patch.yml");
    }
    requireSuccess(
      runCaptured(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `import { pathToFileURL } from "node:url";
delete globalThis.DOMMatrix;
delete globalThis.Path2D;
const loaded = await import(pathToFileURL(process.argv[1]).href);
const plugin = loaded.default;
if (typeof plugin?.apply !== "function") throw new Error("entrypoint has no apply");
if (plugin.name !== "dsh-sparkles") throw new Error("unexpected plugin name: " + plugin.name);
if (JSON.stringify(plugin.inject) !== JSON.stringify(["tools", "commands", "agents", "systemPrompt"])) throw new Error("unexpected inject: " + JSON.stringify(plugin.inject));
if (globalThis.DOMMatrix !== undefined || globalThis.Path2D !== undefined) throw new Error("DSH entrypoint eagerly initialized PDF canvas globals");`,
          entrypoint,
        ],
        {
          cwd: installation,
          timeout: STARTUP_SMOKE_TIMEOUT_MILLISECONDS,
          killSignal: "SIGKILL",
        },
      ),
      "installed DSH entrypoint import",
    );

    // Compose the installed bundle in a real, isolated DSH profile.
    if (typeof dshCommand !== "string" || dshCommand.trim().length === 0) {
      if (summary.publishable) {
        throw new Error(
          `DSH release verification requires @deepseek-ai/dsh@${DSH_PEERS["@deepseek-ai/dsh"]}`,
        );
      }
      console.log("DSH npm install smoke passed (dsh CLI unavailable; entrypoint contract verified)");
      return summary;
    }
    const dshVersion = assertDshHostVersion(
      dshCommand,
      DSH_PEERS["@deepseek-ai/dsh"],
    );
    const dshHome = mkdtempSync(join(tmpdir(), "dsh-sparkles-smoke-home-"));
    const profileName = "dsh-sparkles-smoke";
    try {
      const env = { ...process.env, DSH_HOME: dshHome };
      requireSuccess(
        runCaptured(dshCommand, ["plugin", "--profile", profileName, "add", installedPackage], {
          cwd: installation,
          env,
        }),
        "dsh plugin add",
      );
      const dump = requireSuccess(
        runCaptured(dshCommand, ["--profile", profileName, "--dump-config"], {
          cwd: installation,
          env,
        }),
        "dsh --dump-config",
      );
      if (!dump.stdout.includes(`name: '@dsh-sparkles/dsh-sparkles'`) && !dump.stdout.includes('@dsh-sparkles/dsh-sparkles')) {
        throw new Error("Isolated dsh profile did not compose the dsh-sparkles bundle layer");
      }
    } finally {
      rmSync(dshHome, { recursive: true, force: true });
    }
    console.log(
      `${summary.throughTierId} dsh-sparkles npm install smoke passed with DSH ${dshVersion}, @napi-rs/canvas ${installedRuntimeDependencies["@napi-rs/canvas"]}, and pdfjs-dist ${installedRuntimeDependencies["pdfjs-dist"]}`,
    );
    return summary;
  } finally {
    rmSync(installation, { recursive: true, force: true });
  }
}

export function checkDshNpmRegistryAvailability(summary) {
  assertDshNpmPublishable(summary);
  const spec = `${summary.name}@${summary.version}`;
  const result = runCaptured(
    "npm",
    ["view", spec, "version", "--json", "--registry", DSH_NPM_REGISTRY],
    { cwd: ROOT },
  );
  if (result.exitCode === 0) {
    throw new Error(`${spec} already exists in the npm registry`);
  }
  if (!result.stderr.includes("E404")) {
    throw new Error(`Could not confirm npm version availability:\n${result.stderr}`);
  }
  console.log(`${spec} is currently available at ${DSH_NPM_REGISTRY}`);
}

function usage() {
  return [
    "Usage: bun run dsh:npm:pack -- [T5|T6] [--no-build]",
    "       bun run dsh:npm:pack -- [T5|T6] --no-build --install-smoke [--publish-dry-run] [--check-registry]",
    "T6 is the release default (T1–T6); select T5 explicitly for the prior boundary.",
  ].join("\n");
}

export function parseDshNpmPackageArguments(args) {
  let throughTierId = DEFAULT_AGGREGATE_TARGET;
  let targetSeen = false;
  let build = true;
  let publishDryRun = false;
  let installSmoke = false;
  let checkRegistry = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-build") build = false;
    else if (arg === "--publish-dry-run") publishDryRun = true;
    else if (arg === "--install-smoke") installSmoke = true;
    else if (arg === "--check-registry") checkRegistry = true;
    else if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (targetSeen) throw new Error(`Unexpected argument: ${arg}`);
    else {
      throughTierId = arg.toUpperCase();
      targetSeen = true;
    }
  }
  if (!new Set(["T5", "T6"]).has(throughTierId)) {
    throw new Error("dsh-sparkles npm target must be T5 or T6");
  }
  return {
    throughTierId,
    build,
    publishDryRun,
    installSmoke,
    checkRegistry,
    help: false,
  };
}

if (import.meta.main) {
  try {
    const options = parseDshNpmPackageArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    const plan = dshNpmPackagePlan(readTierManifest(), options.throughTierId);
    const summary = await buildDshNpmRelease(options.throughTierId, {
      build: options.build,
    });
    if (options.publishDryRun) dshNpmPublishDryRun(plan.npmOutputDirectory, plan);
    if (options.installSmoke) dshNpmInstallSmoke(plan.npmOutputDirectory, plan);
    if (options.checkRegistry) checkDshNpmRegistryAvailability(summary);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exit(1);
  }
}
