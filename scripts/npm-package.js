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
import {
  aggregateBundlePlan,
  buildAggregateBundle,
  DEFAULT_AGGREGATE_TARGET,
  HOST_PEERS,
  verifyAggregateBundle,
} from "./aggregate-bundle.js";
import {
  BINDING_DIR,
  DIST_DIR,
  FINANCE_DIR,
  PLUGINS_DIR,
  ROOT,
} from "./modules.js";
import { readTierManifest } from "./tiers.js";

const NPM_RELEASE_SCHEMA_VERSION = 2;
const PREVIOUS_NPM_RELEASE_SCHEMA_VERSION = 1;
const NPM_PACKAGE_NAME = "@pi-sparkles/pi-sparkles";
const NPM_REGISTRY = "https://registry.npmjs.org/";
const STARTUP_SMOKE_TIMEOUT_MILLISECONDS = 15_000;
const NPM_PACKAGE_FILES = [
  "CHANGELOG.md",
  "CONFIGURATION.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "SHA256SUMS",
  "THIRD_PARTY_NOTICES.md",
  "aggregate-lock.json",
  "build.json",
  "index.js",
  "metafile.json",
  "release-lock.json",
  "runtime.js",
  "runtime.js.map",
];
const AGGREGATE_COPY_FILES = [
  "CONFIGURATION.md",
  "aggregate-lock.json",
  "build.json",
  "index.js",
  "metafile.json",
  "runtime.js",
  "runtime.js.map",
];
const ROOT_COPY_FILES = [
  "CHANGELOG.md",
  "LICENSE",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
];
const SECRET_PATTERNS = [
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
  const canvasVersion = dependencies["@napi-rs/canvas"];
  const pdfVersion = dependencies["pdfjs-dist"];
  if (
    typeof canvasVersion !== "string" ||
    canvasVersion.length === 0 ||
    typeof pdfVersion !== "string" ||
    pdfVersion.length === 0
  ) {
    throw new Error(
      "Root package.json must pin @napi-rs/canvas and pdfjs-dist for npm packaging",
    );
  }
  return {
    "@napi-rs/canvas": canvasVersion,
    "pdfjs-dist": pdfVersion,
  };
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function safeReleaseOutput(path) {
  const output = resolve(path);
  const protectedDirectories = [
    ROOT,
    PLUGINS_DIR,
    FINANCE_DIR,
    BINDING_DIR,
    DIST_DIR,
  ];
  if (protectedDirectories.includes(output)) {
    throw new Error(`Refusing npm output at protected path: ${output}`);
  }
  if (isInside(output, ROOT)) {
    throw new Error(`Refusing npm output that contains the repository: ${output}`);
  }
  if (
    [PLUGINS_DIR, FINANCE_DIR, BINDING_DIR].some((directory) =>
      isInside(directory, output),
    )
  ) {
    throw new Error(`Refusing npm output inside source: ${output}`);
  }
  return output;
}

function assertReplaceableOutput(output, plan) {
  if (!existsSync(output)) return;
  if (!lstatSync(output).isDirectory()) {
    throw new Error(`Refusing to replace non-directory npm output: ${output}`);
  }
  const summaryPath = join(output, "npm-pack.json");
  if (!existsSync(summaryPath) || !lstatSync(summaryPath).isFile()) {
    throw new Error(
      `Refusing to replace a directory without an npm pack record: ${output}`,
    );
  }
  let summary;
  try {
    summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  } catch {
    throw new Error(`Refusing to replace an invalid npm output: ${output}`);
  }
  if (
    ![
      PREVIOUS_NPM_RELEASE_SCHEMA_VERSION,
      NPM_RELEASE_SCHEMA_VERSION,
    ].includes(summary.schemaVersion) ||
    summary.package?.name !== NPM_PACKAGE_NAME ||
    summary.throughTierId !== plan.throughTierId
  ) {
    throw new Error(`Refusing to replace a different npm output: ${output}`);
  }
}

function runCaptured(command, args, options = {}) {
  const result = Bun.spawnSync([command, ...args], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdin: options.stdin ?? "ignore",
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

function packageReadme(plan) {
  const version = plan.packageVersion;
  const previewNotice = plan.releasable
    ? ""
    : `> Development preview: version ${plan.packageVersion} is private and is not intended for publication.\n\n`;
  const previewSection =
    plan.throughTierId === "T6" && !plan.releasable
      ? `## T6 development inventory

This tarball contains ${plan.plugins.length} present plugin ${plan.plugins.length === 1 ? "entrypoint" : "entrypoints"} through
T6. Its content locks record ${plan.omittedProposals.length} omitted proposals,
${plan.partialImplementations.length} partial implementations, and
${plan.openBlockers.length} open ${plan.openBlockers.length === 1 ? "blocker" : "blockers"}. The repository work behind this target
includes transaction-tape/stream laws, deterministic possible-fill
simulation, evidence-first compliance evaluation, and exact-hash caller-owned
receipt review. The tier must still complete ProductUseful promotion before
this private inventory build can be published.

CN, HK, and US transaction-tape packets require an explicitly selected external
provider capability. OpenD, provider SDKs, credentials, and provider
certification are not included. Provider acquisition is transaction prints
only—never quotes, bid/offer, or an order book—and no plugin can mutate a paper
or live order.

`
      : "";
  const quickStart = plan.releasable
    ? `## Quick start

\`\`\`sh
pi install npm:${NPM_PACKAGE_NAME}@${version}
\`\`\`
`
    : `## Local preview

Install only the exact locally built tarball for development inspection:

\`\`\`sh
npm install ./pi-sparkles-pi-sparkles-${plan.packageVersion}.tgz
\`\`\`
`;
  return `# Sparkles for Pi

${previewNotice}Turn [Pi](https://github.com/badlogic/pi-mono) into a finance research
assistant for mainland China, Hong Kong, and US markets.

This is the Pi distribution of
[Sparkles](https://github.com/kaiwu/sparkles). DeepSeek Harness users should
install the sibling
[@dsh-sparkles/dsh-sparkles](https://www.npmjs.com/package/@dsh-sparkles/dsh-sparkles)
package, which reuses the same finance cores but owns separate DSH tools,
agent/session lifecycle, browser presentation, and release maturity.

Ask about a stock or ETF in everyday language. Pi Sparkles brings current market
data, price history, company filings, fundamentals, and financial calculations
into the conversation, so you can spend less time moving between websites,
spreadsheets, and one-off scripts.

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

Pi automatically looks up current evidence for questions about price, trend,
buying now, or when to sell. You do not need to ask it to "use tools" first.

${previewSection}${quickStart}

For most mainland China and Hong Kong quote/history research, and for SEC filing
research, the only setup is a contact address used to identify requests to public
data services:

\`\`\`sh
AGENT_CONTACT="you@example.com" pi --finance-track cn
\`\`\`

Choose \`cn\`, \`hk\`, or \`us\`. You can switch later with \`/cn-track\`,
\`/hk-track\`, or \`/us-track\` inside Pi.

Then ask naturally:

- \`分析一下科创50ETF的走势\`
- \`588000 如果现在买，什么时候卖比较好？\`
- \`分析腾讯 00700.HK 最近半年的趋势、动量和波动\`
- \`Summarize AAPL's latest SEC fundamentals and cite the evidence.\`
- \`Compare this portfolio with its benchmark and explain the largest risks.\`

## Data sources

| Research area | Available sources |
| --- | --- |
| Mainland China | Eastmoney quotes and daily history; CNINFO disclosures; optional Tushare symbol, name, corporate-action, earnings, quote, and history data; SSE, SZSE, and BSE calendars and rules |
| Hong Kong | Eastmoney quotes and daily history; HKEXnews disclosures; HKEX calendar and rules |
| United States | SEC EDGAR and XBRL filings; optional Alpaca quotes, bars, news, corporate actions, and asset data; optional OpenFIGI identity mapping and Twelve Data company profiles; NYSE and Nasdaq calendars and rules |
| Macroeconomics | Optional Federal Reserve Bank of St. Louis FRED series |
| Day-trader and execution review | Exact bounded packets supplied by a caller-selected external market-data or broker capability; the package validates declared identity, rights, clocks, sequence, conditions, corrections, limits, and receipts without authenticating the provider |
| Your own data | Portfolio files and supported structured imports for research and calculation |

Availability and history depth depend on the selected provider and your account's
permissions. Public-web sources do not promise uptime, completeness, or real-time
delivery.

## Optional data-service setup

The package loads without provider credentials. Add only the services you want;
you do not need every variable below.

| Variable | What it enables |
| --- | --- |
| \`AGENT_CONTACT\` | Identified access to supported public services, including Eastmoney, CNINFO, SEC, and HKEXnews. Use one email address everywhere. |
| \`TUSHARE_TOKEN\` | Optional Tushare data for mainland China. Tushare permissions and points apply. |
| \`ALPACA_API_KEY_ID\`, \`ALPACA_API_SECRET_KEY\` | Optional Alpaca US prices, bars, news, corporate actions, and assets. Feed permissions apply. |
| \`OPENFIGI_API_KEY\` | Optional OpenFIGI identity mapping. |
| \`TWELVE_DATA_API_KEY\` | Optional Twelve Data company profiles. |
| \`FRED_API_KEY\` | Optional FRED macroeconomic series. |

Example:

\`\`\`sh
AGENT_CONTACT="you@example.com" \\
ALPACA_API_KEY_ID="..." \\
ALPACA_API_SECRET_KEY="..." \\
pi --finance-track us
\`\`\`

Your credentials stay in your runtime environment. Sparkles for Pi does not add them
to the package or save them in Pi settings. For a project-local installation,
add \`--local\` to \`pi install\`.

## External day-trader and broker dependencies

Transaction-tape and broker-review tools require exact caller-supplied packets
or receipts from an explicitly selected provider, gateway, export, or adapter.
Futu OpenD, Alpaca, IBKR, their SDKs, credentials, login state, and equivalent
provider components are external dependencies and are not included in this npm
package. Results preserve the declared provider, entitlement, track, venue,
clocks, limits, and unsupported claims; Sparkles never silently selects or
falls back to another provider.

Sparkles for Pi is read-only research software: it cannot place, change, or cancel
broker orders. It is not investment, legal, accounting, or tax advice. See
\`CONFIGURATION.md\` for the complete source and configuration reference.

Version ${version} · Pi package \`${NPM_PACKAGE_NAME}\`
`;
}

function npmManifest(plan) {
  return {
    name: NPM_PACKAGE_NAME,
    version: plan.packageVersion,
    description:
      "Turn Pi into a finance research assistant for China, Hong Kong, and US markets",
    private: !plan.releasable,
    type: "module",
    main: "./index.js",
    exports: "./index.js",
    files: NPM_PACKAGE_FILES,
    license: "Apache-2.0",
    repository: {
      type: "git",
      url: "git+https://github.com/kaiwu/sparkles.git",
    },
    homepage: "https://sparkles.extensio.cn",
    bugs: { url: "https://github.com/kaiwu/sparkles/issues" },
    keywords: [
      "pi-package",
      "pi-extension",
      "finance",
      "gleam",
      "all-in-one",
    ],
    engines: { node: ">=22.19.0" },
    dependencies: runtimeDependencies(),
    peerDependencies: HOST_PEERS,
    pi: { extensions: ["./index.js"] },
    piSparkles: {
      aggregateThrough: plan.throughTierId,
      maturity: plan.maturity,
      pluginCount: plan.plugins.length,
      omittedProposalCount: plan.omittedProposals.length,
      partialImplementationCount: plan.partialImplementations.length,
      openBlockerCount: plan.openBlockers.length,
      publishable: plan.releasable,
      brokerOrderMutation: false,
    },
    ...(plan.releasable
      ? {
          publishConfig: {
            access: "public",
            registry: NPM_REGISTRY,
          },
        }
      : {}),
  };
}

function releaseLock(plan, packageDirectory) {
  const aggregateLockPath = join(packageDirectory, "aggregate-lock.json");
  const aggregateLock = JSON.parse(readFileSync(aggregateLockPath, "utf8"));
  return {
    schemaVersion: NPM_RELEASE_SCHEMA_VERSION,
    package: { name: NPM_PACKAGE_NAME, version: plan.packageVersion },
    throughTierId: plan.throughTierId,
    maturity: plan.maturity,
    publishable: plan.releasable,
    pluginCount: plan.plugins.length,
    sourceAggregate: {
      package: aggregateLock.package,
      aggregateLockSha256: sha256File(aggregateLockPath),
      entrypointSha256: aggregateLock.entrypointSha256,
      bundleSha256: aggregateLock.bundleSha256,
    },
    npmRegistry: NPM_REGISTRY,
    npmFiles: [...NPM_PACKAGE_FILES, "package.json"].sort((left, right) =>
      left.localeCompare(right),
    ),
    runtimeDependencies: runtimeDependencies(),
    runtimePeerDependencies: HOST_PEERS,
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
      else throw new Error(`Npm package contains unsupported content: ${path}`);
    }
  };
  visit(directory);
  return files.sort((left, right) => left.localeCompare(right));
}

function checksumEntries(directory) {
  return directoryFiles(directory)
    .filter((path) => basename(path) !== "SHA256SUMS")
    .map((path) => ({
      path: relative(directory, path).split(sep).join("/"),
      sha256: sha256File(path),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
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
      if (!match) throw new Error(`Invalid npm checksum line: ${line}`);
      return { sha256: match[1], path: match[2] };
    });
}

function scanForCredentialValues(directory) {
  for (const path of directoryFiles(directory)) {
    if (/\.(?:map|js|json|md)$/.test(path) || basename(path) === "LICENSE") {
      const source = readFileSync(path, "utf8");
      if (SECRET_PATTERNS.some((pattern) => pattern.test(source))) {
        throw new Error(
          `Npm package contains text resembling a credential value: ${relative(directory, path)}`,
        );
      }
    }
  }
}

export function npmPackagePlan(
  manifest,
  throughTierId = DEFAULT_AGGREGATE_TARGET,
) {
  const aggregate = aggregateBundlePlan(manifest, throughTierId);
  return {
    ...aggregate,
    npmPackageName: NPM_PACKAGE_NAME,
    aggregateDirectory: aggregate.outputDirectory,
    npmOutputDirectory: join(
      DIST_DIR,
      "npm",
      aggregate.throughTierId.toLowerCase(),
    ),
  };
}

export function verifyNpmPackageDirectory(directory, expectedPlan) {
  const root = resolve(directory);
  const expectedRuntimeDependencies = runtimeDependencies();
  const expectedFiles = [...NPM_PACKAGE_FILES, "package.json"].sort((left, right) =>
    left.localeCompare(right),
  );
  const actualFiles = directoryFiles(root).map((path) =>
    relative(root, path).split(sep).join("/"),
  );
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("Npm package file inventory is incomplete or contains extras");
  }
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "release-lock.json"), "utf8"));
  const aggregateLock = JSON.parse(
    readFileSync(join(root, "aggregate-lock.json"), "utf8"),
  );
  if (
    lock.schemaVersion !== NPM_RELEASE_SCHEMA_VERSION ||
    manifest.name !== NPM_PACKAGE_NAME ||
    manifest.name !== lock.package?.name ||
    manifest.version !== lock.package?.version ||
    manifest.private !== !lock.publishable ||
    manifest.main !== "./index.js" ||
    manifest.exports !== "./index.js" ||
    JSON.stringify(manifest.pi?.extensions) !== '["./index.js"]' ||
    JSON.stringify(manifest.files) !== JSON.stringify(NPM_PACKAGE_FILES) ||
    manifest.license !== "Apache-2.0" ||
    manifest.engines?.node !== ">=22.19.0" ||
    JSON.stringify(manifest.dependencies) !==
      JSON.stringify(expectedRuntimeDependencies) ||
    JSON.stringify(manifest.peerDependencies) !== JSON.stringify(HOST_PEERS) ||
    manifest.scripts !== undefined ||
    lock.lifecycleScriptsIncluded !== false ||
    lock.credentialValuesIncluded !== false ||
    lock.brokerOrderMutation !== false
  ) {
    throw new Error("Npm package manifest or release lock is inconsistent");
  }
  if (
    (lock.publishable &&
      (manifest.publishConfig?.access !== "public" ||
        manifest.publishConfig?.registry !== NPM_REGISTRY)) ||
    (!lock.publishable && manifest.publishConfig !== undefined)
  ) {
    throw new Error("Npm publish configuration does not match tier maturity");
  }
  if (
    aggregateLock.releasable !== lock.publishable ||
    aggregateLock.throughTierId !== lock.throughTierId ||
    aggregateLock.pluginCount !== lock.pluginCount ||
    aggregateLock.entrypointSha256 !== sha256File(join(root, "index.js")) ||
    aggregateLock.bundleSha256 !== sha256File(join(root, "runtime.js")) ||
    lock.sourceAggregate.aggregateLockSha256 !==
      sha256File(join(root, "aggregate-lock.json")) ||
    lock.sourceAggregate.entrypointSha256 !==
      aggregateLock.entrypointSha256 ||
    lock.sourceAggregate.bundleSha256 !== aggregateLock.bundleSha256 ||
    JSON.stringify(lock.npmFiles) !== JSON.stringify(expectedFiles) ||
    JSON.stringify(lock.runtimeDependencies) !==
      JSON.stringify(expectedRuntimeDependencies) ||
    JSON.stringify(lock.runtimePeerDependencies) !== JSON.stringify(HOST_PEERS) ||
    aggregateLock.plugins.some((plugin) => plugin.brokerOrderMutation === true)
  ) {
    throw new Error("Npm package differs from its aggregate source lock");
  }
  if (expectedPlan) {
    if (
      manifest.version !== expectedPlan.packageVersion ||
      lock.throughTierId !== expectedPlan.throughTierId ||
      lock.publishable !== expectedPlan.releasable ||
      lock.pluginCount !== expectedPlan.plugins.length ||
      manifest.piSparkles?.aggregateThrough !== expectedPlan.throughTierId ||
      manifest.piSparkles?.maturity !== expectedPlan.maturity ||
      manifest.piSparkles?.pluginCount !== expectedPlan.plugins.length ||
      manifest.piSparkles?.omittedProposalCount !==
        expectedPlan.omittedProposals.length ||
      manifest.piSparkles?.partialImplementationCount !==
        expectedPlan.partialImplementations.length ||
      manifest.piSparkles?.openBlockerCount !==
        expectedPlan.openBlockers.length ||
      manifest.piSparkles?.publishable !== expectedPlan.releasable ||
      manifest.piSparkles?.brokerOrderMutation !== false
    ) {
      throw new Error("Npm package does not match the selected aggregate plan");
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
      throw new Error(`Unsafe npm checksum path: ${entry.path}`);
    }
    const path = resolve(root, entry.path);
    if (!isInside(root, path) || sha256File(path) !== entry.sha256) {
      throw new Error(`Npm package checksum mismatch: ${entry.path}`);
    }
  }
  const checksumLine = (entry) => `${entry.sha256}  ${entry.path}`;
  if (
    JSON.stringify(declaredChecksums.map(checksumLine)) !==
    JSON.stringify(checksumEntries(root).map(checksumLine))
  ) {
    throw new Error("Npm package checksum inventory is incomplete or unordered");
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
  const record = Array.isArray(parsed)
    ? parsed[0]
    : Object.values(parsed)[0];
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

export function assertNpmPublishable(summary) {
  if (summary.publishable !== true) {
    throw new Error(
      `${summary.throughTierId} npm aggregate is a blocked preview and cannot be published`,
    );
  }
}

export function verifyNpmRelease(directory, expectedPlan) {
  const root = resolve(directory);
  const summaryPath = join(root, "npm-pack.json");
  const sumsPath = join(root, "RELEASE_SHA256SUMS");
  for (const path of [summaryPath, sumsPath]) {
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(`Npm release file is missing: ${path}`);
    }
  }
  const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
  if (
    summary.schemaVersion !== NPM_RELEASE_SCHEMA_VERSION ||
    summary.package?.name !== NPM_PACKAGE_NAME ||
    typeof summary.tarball !== "string" ||
    basename(summary.tarball) !== summary.tarball
  ) {
    throw new Error("Npm pack record is invalid");
  }
  const packageSummary = verifyNpmPackageDirectory(
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
    throw new Error("Npm tarball or pack record is inconsistent");
  }
  const expectedTarEntries = [...NPM_PACKAGE_FILES, "package.json"]
    .map((path) => `package/${path}`)
    .sort();
  if (JSON.stringify(tarballEntries(tarball)) !== JSON.stringify(expectedTarEntries)) {
    throw new Error("Npm tarball file inventory is incomplete or contains extras");
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
    throw new Error("Npm release checksum inventory is invalid");
  }

  const extraction = mkdtempSync(join(tmpdir(), "pi-sparkles-npm-verify-"));
  try {
    requireSuccess(
      runCaptured("tar", ["-xzf", tarball, "-C", extraction], { cwd: ROOT }),
      "npm tarball extraction",
    );
    verifyNpmPackageDirectory(join(extraction, "package"), expectedPlan);
  } finally {
    rmSync(extraction, { recursive: true, force: true });
  }
  return { ...packageSummary, tarball, tarballSha256: summary.tarballSha256 };
}

export async function assembleNpmRelease(
  plan,
  aggregateDirectory = plan.aggregateDirectory,
  outputDirectory = plan.npmOutputDirectory,
) {
  const output = safeReleaseOutput(outputDirectory);
  assertReplaceableOutput(output, plan);
  verifyAggregateBundle(aggregateDirectory, plan);
  for (const filename of [...AGGREGATE_COPY_FILES]) {
    const path = join(aggregateDirectory, filename);
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(`Aggregate npm source is missing: ${path}`);
    }
  }
  for (const filename of ROOT_COPY_FILES) {
    const path = join(ROOT, filename);
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(`Npm release source is missing: ${path}`);
    }
  }

  mkdirSync(dirname(output), { recursive: true });
  const staging = join(
    dirname(output),
    `.${basename(output)}.staging-${process.pid}-${randomUUID()}`,
  );
  const backup = join(
    dirname(output),
    `.${basename(output)}.previous-${process.pid}-${randomUUID()}`,
  );
  const packageDirectory = join(staging, "package");
  mkdirSync(packageDirectory, { recursive: true });
  let movedPrevious = false;
  try {
    for (const filename of AGGREGATE_COPY_FILES) {
      copyFileSync(join(aggregateDirectory, filename), join(packageDirectory, filename));
    }
    for (const filename of ROOT_COPY_FILES) {
      copyFileSync(join(ROOT, filename), join(packageDirectory, filename));
    }
    writeFileSync(join(packageDirectory, "README.md"), packageReadme(plan));
    writeJson(join(packageDirectory, "package.json"), npmManifest(plan));
    writeJson(
      join(packageDirectory, "release-lock.json"),
      releaseLock(plan, packageDirectory),
    );
    writeChecksums(packageDirectory);
    const packageSummary = verifyNpmPackageDirectory(packageDirectory, plan);
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
      schemaVersion: NPM_RELEASE_SCHEMA_VERSION,
      package: { name: npmResult.name, version: npmResult.version },
      throughTierId: plan.throughTierId,
      maturity: plan.maturity,
      pluginCount: plan.plugins.length,
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
    verifyNpmRelease(staging, plan);

    if (existsSync(output)) {
      renameSync(output, backup);
      movedPrevious = true;
    }
    renameSync(staging, output);
    if (movedPrevious) rmSync(backup, { recursive: true, force: true });
    return verifyNpmRelease(output, plan);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (movedPrevious && !existsSync(output) && existsSync(backup)) {
      renameSync(backup, output);
    }
    throw error;
  }
}

export async function buildNpmRelease(
  throughTierId = DEFAULT_AGGREGATE_TARGET,
  { build = true, aggregateDirectory, outputDirectory } = {},
) {
  const plan = npmPackagePlan(readTierManifest(), throughTierId);
  const aggregateOutput = aggregateDirectory ?? plan.aggregateDirectory;
  if (build) {
    await buildAggregateBundle(plan.throughTierId, {
      build: true,
      outputDirectory: aggregateOutput,
    });
  } else {
    verifyAggregateBundle(aggregateOutput, plan);
  }
  const summary = await assembleNpmRelease(
    plan,
    aggregateOutput,
    outputDirectory ?? plan.npmOutputDirectory,
  );
  console.log(
    `${summary.throughTierId} npm package: ${summary.tarball} (${summary.pluginCount} plugins${summary.publishable ? ", publish-ready" : ", blocked preview"})`,
  );
  return summary;
}

export function npmPublishDryRun(releaseDirectory, expectedPlan) {
  const summary = verifyNpmRelease(releaseDirectory, expectedPlan);
  assertNpmPublishable(summary);
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

function withoutProviderCredentials(aggregateLock) {
  const environment = { ...process.env };
  const names = new Set(
    aggregateLock.plugins.flatMap(
      (plugin) => plugin.environmentVariables ?? [],
    ),
  );
  for (const name of names) delete environment[name];
  return environment;
}

export function npmInstallSmoke(
  releaseDirectory,
  expectedPlan,
  { piCommand = process.env.PI_SPARKLES_PI_COMMAND ?? "pi" } = {},
) {
  const summary = verifyNpmRelease(releaseDirectory, expectedPlan);
  if (typeof piCommand !== "string" || piCommand.trim().length === 0) {
    throw new Error("Npm install smoke requires a Pi command");
  }
  const installation = mkdtempSync(
    join(tmpdir(), "pi-sparkles-npm-install-smoke-"),
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
          summary.tarball,
        ],
        { cwd: installation },
      ),
      "clean npm tarball installation",
    );
    const installedPackage = join(
      installation,
      "node_modules",
      NPM_PACKAGE_NAME,
    );
    verifyNpmPackageDirectory(installedPackage, expectedPlan);
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
    requireSuccess(
      runCaptured(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          'import { pathToFileURL } from "node:url"; delete globalThis.DOMMatrix; delete globalThis.Path2D; const loaded = await import(pathToFileURL(process.argv[1]).href); if (typeof loaded.default !== "function") throw new Error("npm entrypoint has no default extension export"); if (globalThis.DOMMatrix !== undefined || globalThis.Path2D !== undefined) throw new Error("npm entrypoint eagerly initialized PDF canvas globals");',
          entrypoint,
        ],
        {
          cwd: installation,
          timeout: STARTUP_SMOKE_TIMEOUT_MILLISECONDS,
          killSignal: "SIGKILL",
        },
      ),
      "installed npm entrypoint import",
    );
    const aggregateLock = JSON.parse(
      readFileSync(join(installedPackage, "aggregate-lock.json"), "utf8"),
    );
    const piStartup = requireSuccess(
      runCaptured(
        piCommand,
        [
          "--no-extensions",
          "--extension",
          entrypoint,
          "--mode",
          "rpc",
          "--no-session",
          "--offline",
        ],
        {
          cwd: installation,
          env: withoutProviderCredentials(aggregateLock),
          stdin: Buffer.from(
            '{"id":"pi-sparkles-startup","type":"get_state"}\n',
          ),
          timeout: STARTUP_SMOKE_TIMEOUT_MILLISECONDS,
          killSignal: "SIGKILL",
        },
      ),
      "plain Pi npm tarball load",
    );
    let startupResponse;
    for (const line of piStartup.stdout.trim().split("\n")) {
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        message?.id === "pi-sparkles-startup" &&
        message?.type === "response" &&
        message?.command === "get_state"
      ) {
        startupResponse = message;
        break;
      }
    }
    if (startupResponse?.success !== true) {
      throw new Error(
        "plain Pi npm tarball load did not return a successful startup RPC response",
      );
    }
    console.log(
      `${summary.throughTierId} npm install smoke passed with ${piCommand}, @napi-rs/canvas ${installedRuntimeDependencies["@napi-rs/canvas"]}, and pdfjs-dist ${installedRuntimeDependencies["pdfjs-dist"]}`,
    );
    return summary;
  } finally {
    rmSync(installation, { recursive: true, force: true });
  }
}

export function checkNpmRegistryAvailability(summary) {
  assertNpmPublishable(summary);
  const spec = `${summary.name}@${summary.version}`;
  const result = runCaptured(
    "npm",
    ["view", spec, "version", "--json", "--registry", NPM_REGISTRY],
    { cwd: ROOT },
  );
  if (result.exitCode === 0) {
    throw new Error(`${spec} already exists in the npm registry`);
  }
  if (!result.stderr.includes("E404")) {
    throw new Error(`Could not confirm npm version availability:\n${result.stderr}`);
  }
  console.log(`${spec} is currently available at ${NPM_REGISTRY}`);
}

function usage() {
  return [
    "Usage: bun run npm:pack -- [T5|T6] [--no-build] [--output <directory>]",
    "       bun run npm:pack -- [T5|T6] --verify-only [--output <directory>]",
    "       bun run npm:pack -- [T5|T6] --no-build --install-smoke [--publish-dry-run] [--check-registry]",
    "T6 is the next-release default and becomes publishable only after ProductUseful promotion; select T5 explicitly for the prior release.",
  ].join("\n");
}

export function parseNpmPackageArguments(args) {
  let throughTierId = DEFAULT_AGGREGATE_TARGET;
  let targetSeen = false;
  let build = true;
  let verifyOnly = false;
  let publishDryRun = false;
  let installSmoke = false;
  let checkRegistry = false;
  let outputDirectory;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-build") build = false;
    else if (arg === "--verify-only") verifyOnly = true;
    else if (arg === "--publish-dry-run") publishDryRun = true;
    else if (arg === "--install-smoke") installSmoke = true;
    else if (arg === "--check-registry") checkRegistry = true;
    else if (arg === "--output") {
      outputDirectory = args[index + 1];
      index += 1;
      if (!outputDirectory) throw new Error("--output requires a directory");
    } else if (arg === "--help" || arg === "-h") return { help: true };
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (targetSeen) throw new Error(`Unexpected argument: ${arg}`);
    else {
      throughTierId = arg.toUpperCase();
      targetSeen = true;
    }
  }
  if (!new Set(["T5", "T6"]).has(throughTierId)) {
    throw new Error("Npm aggregate target must be T5 or T6");
  }
  if (verifyOnly && (publishDryRun || checkRegistry || build === false)) {
    throw new Error(
      "--verify-only cannot be combined with --no-build, --publish-dry-run, or --check-registry",
    );
  }
  return {
    throughTierId,
    build,
    verifyOnly,
    publishDryRun,
    installSmoke,
    checkRegistry,
    outputDirectory,
    help: false,
  };
}

if (import.meta.main) {
  try {
    const options = parseNpmPackageArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    const plan = npmPackagePlan(readTierManifest(), options.throughTierId);
    const output = options.outputDirectory ?? plan.npmOutputDirectory;
    const summary = options.verifyOnly
      ? verifyNpmRelease(output, plan)
      : await buildNpmRelease(options.throughTierId, {
          build: options.build,
          outputDirectory: output,
        });
    if (options.publishDryRun) npmPublishDryRun(output, plan);
    if (options.installSmoke) npmInstallSmoke(output, plan);
    if (options.checkRegistry) checkNpmRegistryAvailability(summary);
    if (options.verifyOnly) {
      console.log(
        `${summary.throughTierId} npm package verified: ${summary.tarball}`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exit(1);
  }
}
