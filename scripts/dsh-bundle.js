// DSH all-in-one plugin bundler.
//
// A dedicated builder that turns the DSH-compatible portion of the
// pi-sparkles ledger into one npm bundle DeepSeek Harness can load: a Cordis
// plugin package whose manifest declares `dsh.bundle.patch`, with compatible
// compiled Pi extensions mounted behind a Pi-API facade over the Harness
// `ctx` (tools -> ctx.tools, commands -> ctx.commands).
//
// Not every Pi plugin is DSH-compatible: dsh/bundle.json declares which ledger
// proposals are `exclude_pi` (Pi-specific surfaces such as the TUI statusline)
// and which `extra_dsh` plugins (DSH-native modules in dsh/plugins/) are added.
// The bundle ships the ledger minus exclusions plus DSH-native extras, with an
// independent DSH release gate.
//
// The existing Pi builder/bundler (scripts/build.js, scripts/aggregate-bundle.js)
// is untouched: this script consumes its `dist/<plugin>/index.js` artifacts
// (auto-building any missing one) and never changes tier state.
//
//   bun run dsh:bundle            # build the T6 (T1–T6) all-in-one DSH bundle
//   bun run dsh:bundle -- T5      # prior release boundary
//   bun run dsh:bundle -- --no-build
//
// Output: dist/dsh/dsh-sparkles/  (install with:
//   dsh plugin --profile <name> add ./dist/dsh/dsh-sparkles)

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { buildPlugin } from "./build.js";
import {
  aggregateBundlePlan,
  DEFAULT_AGGREGATE_TARGET,
} from "./aggregate-bundle.js";
import { DIST_DIR, ROOT, WORK_DIR, plugins } from "./modules.js";
import { readTierManifest } from "./tiers.js";
import { dshClientFactorySource } from "../dsh/client.js";

const ALLOWED_TARGETS = new Set(["T5", "T6"]);
export const DSH_PACKAGE_NAME = "@dsh-sparkles/dsh-sparkles";
export const DSH_PLUGIN_NAME = "dsh-sparkles";
export const DSH_OUTPUT_DIR = join(DIST_DIR, "dsh", "dsh-sparkles");
const DSH_MANIFEST_PATH = join(ROOT, "dsh", "bundle.json");
const ENTRY_DIR = join(WORK_DIR, "dsh");
const ENTRY_PATH = join(ENTRY_DIR, "entry.mjs");
const LOCK_SCHEMA_VERSION = 2;
const DSH_MANIFEST_SCHEMA_VERSION = 5;
const PLUGIN_SHORT_NAME = /^[a-z][a-z0-9_]*$/;
export const DSH_RUNTIME_DEPENDENCIES = {
  "@napi-rs/canvas": "1.0.3",
  "pdfjs-dist": "6.2.108",
};
export const DSH_RUNTIME_PEERS = {
  "@deepseek-ai/dsh": "0.1.1-rc.2",
  "@deepseek-ai/dsh-agent": "0.1.1-rc.2",
  "@deepseek-ai/dsh-client-runtime": "0.1.1-rc.2",
  "@deepseek-ai/dsh-client-ui-layout": "0.1.1-rc.2",
  "@deepseek-ai/dsh-client-ui-tool": "0.1.1-rc.2",
  "@deepseek-ai/dsh-commands": "0.1.1-rc.2",
  "@deepseek-ai/dsh-session": "0.1.1-rc.2",
  "@deepseek-ai/dsh-session-projection": "0.1.1-rc.2",
  "@deepseek-ai/dsh-system-prompt": "0.1.1-rc.2",
  "@deepseek-ai/dsh-tools": "0.1.1-rc.2",
};

/** Every file the DSH bundle emits; the npm packager consumes this inventory. */
export const DSH_BUNDLE_FILES = [
  "CONFIGURATION.md",
  "README.md",
  "SHA256SUMS",
  "cordis.patch.yml",
  "dsh-lock.json",
  "client.js",
  "index.js",
  "index.js.map",
  "package.json",
];

const PACKAGE_NAME = DSH_PACKAGE_NAME;
const OUTPUT_DIR = DSH_OUTPUT_DIR;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function moduleSpecifier(fromDirectory, target) {
  const path = relative(fromDirectory, target).split(sep).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

function compiledPluginEntry(plugin) {
  return join(
    plugin.directory,
    "build",
    "dev",
    "javascript",
    plugin.name,
    `${plugin.name}.mjs`,
  );
}

function dshComponentCount(plan) {
  return plan.componentCount ?? plan.plugins.length;
}

function assertSafeOutput() {
  const output = resolve(OUTPUT_DIR);
  if (output === ROOT || output === DIST_DIR) {
    throw new Error(`Refusing DSH bundle output at protected path: ${output}`);
  }
  if (existsSync(output) && !lstatSync(output).isDirectory()) {
    throw new Error(`Refusing to replace non-directory DSH output: ${output}`);
  }
  // Fresh output or a directory whose lock matches ours.
  if (existsSync(output)) {
    const lockPath = join(output, "dsh-lock.json");
    if (!existsSync(lockPath)) {
      throw new Error(`Refusing to replace a directory without dsh-lock.json: ${output}`);
    }
    let lock;
    try {
      lock = JSON.parse(readFileSync(lockPath, "utf8"));
    } catch {
      throw new Error(`Refusing to replace an invalid DSH output: ${output}`);
    }
    if (
      ![1, LOCK_SCHEMA_VERSION].includes(lock.schemaVersion) ||
      lock.package?.name !== PACKAGE_NAME ||
      !ALLOWED_TARGETS.has(lock.target)
    ) {
      throw new Error(`Refusing to replace a different DSH output: ${output}`);
    }
  }
}

/**
 * The DSH bundle inventory: which Pi ledger proposals are excluded from the
 * Harness distribution and which DSH-native plugins are added. See
 * dsh/bundle.json.
 */
export function readDshManifest() {
  const manifest = JSON.parse(readFileSync(DSH_MANIFEST_PATH, "utf8"));
  if (manifest.schema_version !== DSH_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `DSH bundle manifest schema_version must be ${DSH_MANIFEST_SCHEMA_VERSION}`,
    );
  }
  const exclude = Array.isArray(manifest.exclude_pi) ? manifest.exclude_pi : [];
  const scoped = Array.isArray(manifest.scoped_pi) ? manifest.scoped_pi : [];
  const extra = Array.isArray(manifest.extra_dsh) ? manifest.extra_dsh : [];
  if (
    exclude.some((name) => typeof name !== "string" || !PLUGIN_SHORT_NAME.test(name)) ||
    scoped.some((name) => typeof name !== "string" || !PLUGIN_SHORT_NAME.test(name)) ||
    extra.some((name) => typeof name !== "string" || !PLUGIN_SHORT_NAME.test(name))
  ) {
    throw new Error("DSH bundle manifest must list plugin short names as strings");
  }
  if (
    new Set(exclude).size !== exclude.length ||
    new Set(scoped).size !== scoped.length ||
    new Set(extra).size !== extra.length
  ) {
    throw new Error("DSH bundle manifest plugin lists must not contain duplicates");
  }
  if (scoped.some((name) => !exclude.includes(name))) {
    throw new Error("Every scoped Pi counterpart must also be excluded from the global Pi lane");
  }
  const exclusionReasons = manifest.exclusion_reasons;
  if (
    !isRecord(exclusionReasons) ||
    exclude.some(
      (name) =>
        typeof exclusionReasons[name] !== "string" ||
        exclusionReasons[name].trim() === "",
    )
  ) {
    throw new Error("Every excluded Pi plugin must have a non-empty exclusion reason");
  }
  const release = manifest.dsh_release;
  if (
    !isRecord(release) ||
    typeof release.version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(release.version) ||
    !["preview", "product_useful"].includes(release.status) ||
    !ALLOWED_TARGETS.has(release.target) ||
    (release.status === "preview" &&
      (typeof release.reason !== "string" || release.reason.trim() === ""))
  ) {
    throw new Error(
      "DSH release must declare a semantic version, preview/product_useful status, a T5/T6 target, and a preview reason",
    );
  }
  return {
    schemaVersion: manifest.schema_version,
    excludePi: [...exclude],
    exclusionReasons: Object.fromEntries(
      exclude.map((name) => [name, exclusionReasons[name]]),
    ),
    scopedPi: [...scoped],
    extraDsh: [...extra],
    release: {
      version: release.version,
      status: release.status,
      target: release.target,
      reason: release.reason ?? null,
    },
  };
}

export function dshBundlePlan(
  throughTierId = DEFAULT_AGGREGATE_TARGET,
  tierManifest = readTierManifest(),
) {
  const target = throughTierId.toUpperCase();
  if (!ALLOWED_TARGETS.has(target)) {
    throw new Error("DSH bundle target must be T5 or T6");
  }
  // Reuse the Pi ledger only as an inventory catalog. Pi tier maturity remains
  // informational here and must never gate the independent DSH release lane.
  const base = aggregateBundlePlan(tierManifest, target, {
    enforcePiReleaseGate: false,
  });
  const manifest = readDshManifest();

  const allPlugins = plugins();
  const allByName = new Map(allPlugins.map((plugin) => [plugin.shortName, plugin]));
  const baseByName = new Map(base.plugins.map((plugin) => [plugin.shortName, plugin]));
  const exclude = new Set(manifest.excludePi);
  for (const name of manifest.excludePi) {
    if (!allByName.has(name)) {
      throw new Error(`DSH bundle excludes unknown ledger proposal: ${name}`);
    }
  }
  const scoped = manifest.scopedPi.map((name) => {
    const plugin = allByName.get(name);
    if (!plugin) {
      throw new Error(`DSH bundle scopes unknown ledger proposal: ${name}`);
    }
    return plugin;
  });
  const extras = manifest.extraDsh.map((name) => {
    if (allByName.has(name)) {
      throw new Error(`DSH bundle extra plugin duplicates a ledger proposal: ${name}`);
    }
    const entryPath = join(ROOT, "dsh", "plugins", `${name}.mjs`);
    if (!existsSync(entryPath) || !lstatSync(entryPath).isFile()) {
      throw new Error(`DSH-native plugin entry not found: ${entryPath}`);
    }
    return { shortName: name, entryPath };
  });

  const included = base.plugins.filter((plugin) => !exclude.has(plugin.shortName));
  const relevantExclusions = manifest.excludePi.filter((name) => baseByName.has(name));
  const dshProductUseful = manifest.release.status === "product_useful";
  const acceptedTarget = manifest.release.target === target;
  const completeInventory = base.omittedProposals.length === 0;
  const dshReleasable = dshProductUseful && acceptedTarget && completeInventory;
  const dshBlockers = [];
  if (!dshProductUseful) dshBlockers.push(manifest.release.reason);
  if (!acceptedTarget) {
    dshBlockers.push(
      `DSH acceptance covers ${manifest.release.target}, not ${target}`,
    );
  }
  for (const { tierId, proposal } of base.omittedProposals) {
    dshBlockers.push(`DSH inventory is missing ${tierId}/pi_${proposal}`);
  }
  return {
    ...base,
    packageVersion: manifest.release.version,
    plugins: included,
    pluginTiers: { ...base.pluginTiers },
    piAggregateMaturity: base.maturity,
    maturity: dshReleasable
      ? "product_useful_dsh_aggregate"
      : "dsh_blocked_preview",
    releasable: dshReleasable,
    dshRelease: manifest.release,
    dshBlockers,
    excludedPiProposals: relevantExclusions,
    exclusionReasons: Object.fromEntries(
      relevantExclusions.map((name) => [name, manifest.exclusionReasons[name]]),
    ),
    extraDshPlugins: manifest.extraDsh,
    dshPlugins: extras,
    scopedPiProposals: manifest.scopedPi,
    scopedPiPlugins: scoped,
    componentCount: included.length + scoped.length,
  };
}

function entrySource(plan) {
  const imports = plan.plugins.map((plugin, index) =>
    `import extension${index} from ${JSON.stringify(
      moduleSpecifier(ENTRY_DIR, join(DIST_DIR, plugin.shortName, "index.js")),
    )};`,
  );
  const records = plan.plugins.map(
    (plugin, index) =>
      `  [${JSON.stringify(plugin.shortName)}, extension${index}],`,
  );
  const dshImports = plan.dshPlugins.map(
    (plugin, index) =>
      `import dshExtension${index} from ${JSON.stringify(
        moduleSpecifier(ENTRY_DIR, plugin.entryPath),
      )};`,
  );
  const dshRecords = plan.dshPlugins.map(
    (plugin, index) =>
      `  [${JSON.stringify(plugin.shortName)}, dshExtension${index}],`,
  );
  const scopedImports = plan.scopedPiPlugins.map((plugin, index) => {
    if (plugin.shortName === "finance_track_status") {
      const compiledEntry = compiledPluginEntry(plugin);
      return `import { extension as scopedExtension${index}, routing_prompt as scopedPrompt${index} } from ${JSON.stringify(
        moduleSpecifier(ENTRY_DIR, compiledEntry),
      )};`;
    }
    return `import scopedExtension${index} from ${JSON.stringify(
      moduleSpecifier(ENTRY_DIR, join(DIST_DIR, plugin.shortName, "index.js")),
    )};`;
  });
  const scopedRecords = plan.scopedPiPlugins.map((plugin, index) => {
    const metadata = plugin.shortName === "finance_track_status"
      ? `, { systemPrompt: scopedPrompt${index}(), promptName: "pi-sparkles:finance-routing", promptOrder: 99 }`
      : "";
    return `  [${JSON.stringify(plugin.shortName)}, scopedExtension${index}${metadata}],`;
  });
  return `${[...imports, ...scopedImports, ...dshImports].join("\n")}

import { createPlugin } from ${JSON.stringify(
    moduleSpecifier(ENTRY_DIR, join(ROOT, "dsh", "plugin.mjs")),
)};

const extensions = [
${records.join("\n")}
];

const dshExtensions = [
${dshRecords.join("\n")}
];

const scopedExtensions = [
${scopedRecords.join("\n")}
];

export default createPlugin(extensions, dshExtensions, ${JSON.stringify(DSH_PLUGIN_NAME)}, scopedExtensions);
`;
}

function pluginRecord(plan, plugin) {
  const finance = plugin.metadata.metadata?.finance ?? {};
  return {
    tierId: plan.pluginTiers[plugin.shortName] ?? null,
    shortName: plugin.shortName,
    gleamPackage: plugin.name,
    version: plugin.version,
    sourceArtifactSha256: sha256File(
      join(DIST_DIR, plugin.shortName, "index.js"),
    ),
    provider: typeof finance.provider === "string" ? finance.provider : null,
  };
}

function environmentVariables(plugin) {
  const names = new Set();
  const patterns = [
    /(?:process|Bun)\.env\.([A-Z][A-Z0-9_]*)/g,
    /(?:process|Bun)\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  ];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) {
        const source = readFileSync(path, "utf8");
        for (const pattern of patterns) {
          for (const match of source.matchAll(pattern)) names.add(match[1]);
        }
      }
    }
  };
  visit(join(plugin.directory, "src"));
  return [...names].sort();
}

function patchSource(plan) {
  return `# Pi Sparkles finance tools as one DeepSeek Harness bundle.
#
# Installed with:
#   dsh plugin --profile <name> add ./dist/dsh/dsh-sparkles
# The profile launcher applies this bundle layer over the profile root, then
# the user's own cordis.patch.yml (last write wins per row).
#
# Optional per-bundle configuration (edit the profile's cordis.patch.yml or
# pass --patch): a \`flags\` map overrides Pi flag defaults, e.g.
#   config:
#     flags:
#       finance-currency: EUR
# Environment variables (AGENT_CONTACT, TUSHARE_TOKEN, ALPACA_API_KEY_ID, ...)
# are read from the DSH host process. Restart DSH after changing them; see
# CONFIGURATION.md.

- insert:
    - id: ${DSH_PLUGIN_NAME}
      name: ${JSON.stringify(PACKAGE_NAME)}
      config:
        flags: {}
`;
}

function configurationSource(plan) {
  const names = [
    ...new Set(
      plan.plugins.flatMap((plugin) => environmentVariables(plugin)),
    ),
  ].sort();
  const excluded = plan.excludedPiProposals ?? [];
  const extras = plan.extraDshPlugins ?? [];
  const scoped = plan.scopedPiProposals ?? [];
  const lines = [
    "# DSH bundle configuration",
    "",
    `Bundled plugins: ${plan.plugins.length} (${plan.throughTierId} ledger)`,
    ...(excluded.length > 0
      ? [
          "",
          "## Excluded Pi plugins",
          "",
          ...excluded.map(
            (name) => `- \`${name}\`: ${plan.exclusionReasons[name]}`,
          ),
        ]
      : []),
    ...(extras.length > 0
      ? [
          "",
          "## DSH-dedicated plugins",
          "",
          ...extras.map((name) => `- \`${name}\``),
        ]
      : []),
    ...(scoped.length > 0
      ? [
          "",
          "## Per-agent shared-core counterparts",
          "",
          ...scoped.map(
            (name) => `- \`${name}\`: the existing compiled Gleam shell/core is instantiated once per DSH agent`,
          ),
          "",
          "DSH sessions are append-only/forked rather than navigated in place, so",
          "Pi session-tree restore hooks are registered for compatibility but do not",
          "receive a synthetic navigation event. Fresh and resumed DSH agents restore",
          "from their own session logs during the real session-start lifecycle.",
        ]
      : []),
    "",
    "## Environment variables",
    "",
    ...names.map((name) => `- \`${name}\``),
    "",
    "Variables are read from the DSH host process. Some adapters initialize",
    "at plugin boot, so restart DSH after changing configuration.",
    "",
    "Credential values and provider entitlements are caller-owned runtime inputs.",
    "They are read only from the host environment and are never embedded,",
    "logged, written, or persisted by this bundle.",
  ];
  return `${lines.join("\n")}\n`;
}

function readmeSource(plan) {
  const version = plan.packageVersion;
  return `# Sparkles for DeepSeek Harness

One DeepSeek Harness ${plan.releasable ? "release" : "preview"} registering ${plan.componentCount} Sparkles
${plan.throughTierId} plugin components as read-only finance tools behind a
Pi-API compatibility shell. This DSH package and the sibling
[@pi-sparkles/pi-sparkles](https://www.npmjs.com/package/@pi-sparkles/pi-sparkles)
distribution reuse the finance cores from
[github.com/kaiwu/sparkles](https://github.com/kaiwu/sparkles), but each owns
its host lifecycle and presentation. The Pi tier ledger remains authoritative
only for Pi; DSH has its own release gate and this build is
\`${plan.maturity}\`. No plugin can place, route, cancel, replace, or otherwise
mutate a paper or live order.

## Install

\`\`\`sh
bun run dsh:bundle
dsh plugin --profile <name> add ./dist/dsh/dsh-sparkles
\`\`\`

The bundle patch layer is applied on the next \`dsh --profile <name>\` boot.
Uninstall with \`dsh plugin --profile <name> remove @dsh-sparkles/dsh-sparkles\`.

## Usage

Set the same caller-owned environment variables the Pi distribution uses
(see CONFIGURATION.md): \`AGENT_CONTACT\` is required by every adapter;
\`TUSHARE_TOKEN\`, \`ALPACA_API_KEY_ID\`, \`ALPACA_API_SECRET_KEY\`,
\`OPENFIGI_API_KEY\`, \`TWELVE_DATA_API_KEY\`, and \`FRED_API_KEY\` are optional
credentials. Then ask the agent for evidence, e.g. "get a current quote for
AAPL" or "compare SMA/RSI/ATR for 600519.SH".

## Behavior notes

- Pi-specific process-global shells are excluded from the global lane. Their
  existing compiled Gleam cores are mounted afresh in each DSH agent scope, so
  portfolio, watchlist, swing-workbench, and track state cannot cross sessions.
- Finance track status is a DSH \`shell.overlay\` surface backed by the current
  session's event-sourced status projection; it never calls Pi's TUI APIs. Drag
  the badge or move it with arrow keys when it covers content; double-click or
  press Home to reset it.
- The package contributes its required \`pi-sparkles/custom\` and
  \`pi-sparkles/status\` types to DSH rc.7's process-wide persisted-event
  catalog before cold session loading, so scoped state and the overlay survive
  a host restart.
- Tools register through \`ctx.tools\` and are validated against the DSH
  schema subset; the embedded Pi decoders still enforce the full argument
  contract (lengths, ranges, enums) at call time.
- Commands register through \`ctx.commands\`; their text output is the command
  result.
- Compatible custom entries are written to the invoking DSH agent's session
  log. No extension-global synthetic session is used.
- Pi notifications become DSH command/tool text. Unsupported Pi UI and host
  effects fail explicitly instead of reporting placeholder success.
- Charts remain ordinary inline tool output: Pi owns its ASCII result component;
  DSH persists bounded chart metadata and renders a keyed browser SVG card. No
  image, attachment, overlay, file, or data URL carries chart output.
- Provider identity, entitlement, and completeness are never authenticated by
  this bundle; providers and credentials stay caller-owned.

## Build

\`bun run dsh:bundle\` consumes the compiled artifacts from the ordinary Pi
build (\`bun run build\`) and bundles them into this package. The Pi
builder/bundler and the tier ledger are untouched.
`;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function hashTree(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name !== "SHA256SUMS") files.push(path);
    }
  };
  visit(directory);
  return files
    .map((path) => `${sha256File(path)}  ${relative(directory, path).split(sep).join("/")}`)
    .sort()
    .join("\n");
}

export async function buildDshBundle(
  throughTierId = DEFAULT_AGGREGATE_TARGET,
  { build = true } = {},
) {
  const plan = dshBundlePlan(throughTierId);
  assertSafeOutput();

  // Consume the Pi builder's artifacts, auto-building any missing plugin.
  const missing = plan.plugins.filter(
    (plugin) => !existsSync(join(DIST_DIR, plugin.shortName, "index.js")),
  );
  if (!build && missing.length > 0) {
    throw new Error(
      `Missing DSH input artifacts: ${missing.map((plugin) => plugin.shortName).join(", ")}`,
    );
  }
  if (build) {
    for (const plugin of missing) {
      console.log(`dsh:bundle building missing artifact ${plugin.shortName}`);
      await buildPlugin(plugin);
    }
  }
  // Scoped counterparts import their current compiled module and must never
  // reuse a stale global artifact: rebuild this small, explicit set every time.
  if (build) {
    for (const plugin of plan.scopedPiPlugins) {
      console.log(`dsh:bundle building scoped counterpart ${plugin.shortName}`);
      await buildPlugin(plugin);
    }
  }

  mkdirSync(ENTRY_DIR, { recursive: true });
  writeFileSync(ENTRY_PATH, entrySource(plan));

  rmSync(OUTPUT_DIR, { recursive: true, force: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const result = await Bun.build({
    entrypoints: [ENTRY_PATH],
    outdir: OUTPUT_DIR,
    naming: "index.js",
    format: "esm",
    target: "node",
    minify: false,
    sourcemap: "external",
    metafile: true,
    external: [
      "pdfjs-dist",
      "pdfjs-dist/*",
      ...Object.keys(DSH_RUNTIME_PEERS).flatMap((name) => [name, `${name}/*`]),
    ],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`DSH bundle failed: ${result.logs.length} build errors`);
  }

  const version = plan.packageVersion;
  const manifest = {
    name: PACKAGE_NAME,
    version,
    description: `DeepSeek Harness ${plan.releasable ? "release" : "preview"} for ${plan.componentCount} Sparkles ${plan.throughTierId} plugin components`,
    private: !plan.releasable,
    type: "module",
    main: "index.js",
    exports: {
      ".": "./index.js",
      "./client": "./client.js",
      "./cordis.patch.yml": "./cordis.patch.yml",
      "./package.json": "./package.json",
    },
    files: [
      "index.js",
      "index.js.map",
      "client.js",
      "cordis.patch.yml",
      "CONFIGURATION.md",
      "README.md",
      "dsh-lock.json",
      "SHA256SUMS",
    ],
    dependencies: DSH_RUNTIME_DEPENDENCIES,
    peerDependencies: DSH_RUNTIME_PEERS,
    engines: { node: ">=22.19.0" },
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
    license: "Apache-2.0",
  };

  writeJson(join(OUTPUT_DIR, "package.json"), manifest);
  writeFileSync(
    join(OUTPUT_DIR, "client.js"),
    dshClientFactorySource(PACKAGE_NAME),
  );
  writeFileSync(join(OUTPUT_DIR, "cordis.patch.yml"), patchSource(plan));
  writeFileSync(join(OUTPUT_DIR, "CONFIGURATION.md"), configurationSource(plan));
  writeFileSync(join(OUTPUT_DIR, "README.md"), readmeSource(plan));

  const lock = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    package: { name: PACKAGE_NAME, version },
    target: plan.throughTierId,
    pluginCount: plan.componentCount,
    plugins: plan.plugins.map((plugin) => pluginRecord(plan, plugin)),
    dshPlugins: plan.dshPlugins.map((plugin) => ({
      shortName: plugin.shortName,
      sourceSha256: sha256File(plugin.entryPath),
    })),
    scopedPiPlugins: plan.scopedPiPlugins.map((plugin) => pluginRecord(plan, plugin)),
    excludedPiProposals: plan.excludedPiProposals,
    exclusionReasons: plan.exclusionReasons,
    extraDshPlugins: plan.extraDshPlugins,
    scopedPiProposals: plan.scopedPiProposals,
    omittedProposals: plan.omittedProposals,
    partialImplementations: plan.partialImplementations,
    openBlockers: plan.openBlockers,
    maturity: plan.maturity,
    piAggregateMaturity: plan.piAggregateMaturity,
    dshRelease: plan.dshRelease,
    dshBlockers: plan.dshBlockers,
    publishable: plan.releasable,
    indexSha256: sha256File(join(OUTPUT_DIR, "index.js")),
    clientSha256: sha256File(join(OUTPUT_DIR, "client.js")),
  };
  writeJson(join(OUTPUT_DIR, "dsh-lock.json"), lock);
  writeFileSync(join(OUTPUT_DIR, "SHA256SUMS"), `${hashTree(OUTPUT_DIR)}\n`);

  const excluded = plan.excludedPiProposals.length;
  const extra = plan.extraDshPlugins.length;
  console.log(
    `DSH bundle ${PACKAGE_NAME}@${version} (${plan.throughTierId}, ${plan.componentCount} components, ${plan.plugins.length} global Pi shells, ${plan.scopedPiPlugins.length} scoped counterparts${excluded > 0 ? `, ${excluded} Pi global shell${excluded === 1 ? "" : "s"} excluded` : ""}${extra > 0 ? `, ${extra} DSH extra${extra === 1 ? "" : "s"}` : ""}) at ${OUTPUT_DIR}`,
  );
}

export function parseDshBundleArguments(args) {
  const options = { build: true, target: DEFAULT_AGGREGATE_TARGET, help: false };
  for (const arg of args) {
    if (arg === "--no-build") options.build = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (!arg.startsWith("--")) options.target = arg;
    else throw new Error(`Unknown dsh:bundle option: ${arg}`);
  }
  return options;
}

function usage() {
  return `usage: bun run dsh:bundle [-- T5|T6] [--no-build]

Build the all-in-one DeepSeek Harness plugin for the pi-sparkles ledger.
T6 (default) bundles the cumulative T1-T6 inventory; T5 selects the prior
release boundary. --no-build reuses existing dist artifacts only.
Output: ${OUTPUT_DIR}`;
}

/**
 * Verify a built DSH bundle directory against its plan and lock, without
 * rebuilding. Shared by the npm packager so the packed tarball always comes
 * from a content-locked bundle.
 */
export function verifyDshBundle(directory, plan) {
  const root = resolve(directory);
  const actual = readdirSync(root).sort().join("\n");
  const expected = [...DSH_BUNDLE_FILES].sort().join("\n");
  if (actual !== expected) {
    throw new Error(
      `DSH bundle file inventory differs:\n${actual}\n--- expected ---\n${expected}`,
    );
  }
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (
    manifest.name !== DSH_PACKAGE_NAME ||
    manifest.dsh?.bundle?.patch !== "./cordis.patch.yml" ||
    manifest.dsh?.client?.platform !== "web" ||
    JSON.stringify(manifest.dsh?.client?.inject) !==
      JSON.stringify([
        "@deepseek-ai/dsh-client-runtime",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-tool",
      ]) ||
    manifest.main !== "index.js" ||
    manifest.exports?.["./client"] !== "./client.js" ||
    manifest.private !== !plan.releasable ||
    manifest.engines?.node !== ">=22.19.0" ||
    JSON.stringify(manifest.dependencies) !==
      JSON.stringify(DSH_RUNTIME_DEPENDENCIES) ||
    JSON.stringify(manifest.peerDependencies) !==
      JSON.stringify(DSH_RUNTIME_PEERS)
  ) {
    throw new Error("DSH bundle manifest is inconsistent");
  }
  const lock = JSON.parse(readFileSync(join(root, "dsh-lock.json"), "utf8"));
  if (
    lock.schemaVersion !== LOCK_SCHEMA_VERSION ||
    lock.package?.name !== DSH_PACKAGE_NAME ||
    lock.target !== plan.throughTierId ||
    lock.pluginCount !== dshComponentCount(plan) ||
    JSON.stringify(lock.excludedPiProposals ?? []) !==
      JSON.stringify(plan.excludedPiProposals ?? []) ||
    JSON.stringify(lock.extraDshPlugins ?? []) !==
      JSON.stringify(plan.extraDshPlugins ?? []) ||
    JSON.stringify(lock.scopedPiProposals ?? []) !==
      JSON.stringify(plan.scopedPiProposals ?? []) ||
    JSON.stringify(lock.exclusionReasons ?? {}) !==
      JSON.stringify(plan.exclusionReasons ?? {}) ||
    JSON.stringify(lock.dshRelease ?? {}) !==
      JSON.stringify(plan.dshRelease ?? {}) ||
    JSON.stringify(lock.dshBlockers ?? []) !==
      JSON.stringify(plan.dshBlockers ?? []) ||
    lock.maturity !== plan.maturity ||
    lock.piAggregateMaturity !== plan.piAggregateMaturity ||
    lock.publishable !== plan.releasable ||
    !lockPluginsMatchPlan(lock.plugins, plan) ||
    !lockDshPluginsMatchPlan(lock.dshPlugins, plan) ||
    !lockScopedPiPluginsMatchPlan(lock.scopedPiPlugins, plan) ||
    lock.indexSha256 !== sha256File(join(root, "index.js")) ||
    lock.clientSha256 !== sha256File(join(root, "client.js"))
  ) {
    throw new Error("DSH bundle lock is inconsistent with the bundle content");
  }
  const declaredChecksums = readFileSync(join(root, "SHA256SUMS"), "utf8").trim();
  if (declaredChecksums !== hashTree(root)) {
    throw new Error("DSH bundle checksum inventory is incomplete or inconsistent");
  }
  return {
    directory: root,
    name: manifest.name,
    version: manifest.version,
    throughTierId: lock.target,
    pluginCount: lock.pluginCount,
    maturity: lock.maturity,
    publishable: plan.releasable,
  };
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function lockPluginsMatchPlan(records, plan) {
  if (!Array.isArray(records) || records.length !== plan.plugins.length) return false;
  return records.every((record, index) => {
    const plugin = plan.plugins[index];
    return (
      record?.tierId === (plan.pluginTiers[plugin.shortName] ?? null) &&
      record?.shortName === plugin.shortName &&
      record?.gleamPackage === plugin.name &&
      record?.version === plugin.version &&
      isSha256(record?.sourceArtifactSha256)
    );
  });
}

function lockDshPluginsMatchPlan(records, plan) {
  const plugins = plan.dshPlugins ?? [];
  if (!Array.isArray(records) || records.length !== plugins.length) return false;
  return records.every(
    (record, index) =>
      record?.shortName === plugins[index].shortName &&
      isSha256(record?.sourceSha256),
  );
}

function lockScopedPiPluginsMatchPlan(records, plan) {
  const scoped = plan.scopedPiPlugins ?? [];
  if (!Array.isArray(records) || records.length !== scoped.length) return false;
  return records.every((record, index) => {
    const plugin = scoped[index];
    return (
      record?.tierId === (plan.pluginTiers[plugin.shortName] ?? null) &&
      record?.shortName === plugin.shortName &&
      record?.gleamPackage === plugin.name &&
      record?.version === plugin.version &&
      isSha256(record?.sourceArtifactSha256)
    );
  });
}

if (import.meta.main) {
  try {
    const options = parseDshBundleArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    if (!options.build) {
      // No build flag path: only consume existing artifacts.
      const plan = dshBundlePlan(options.target);
      for (const plugin of [...plan.plugins, ...plan.scopedPiPlugins]) {
        if (!existsSync(join(DIST_DIR, plugin.shortName, "index.js"))) {
          throw new Error(
            `Missing artifact for ${plugin.shortName}; run "bun run dsh:bundle" without --no-build first`,
          );
        }
      }
      const trackStatus = plan.scopedPiPlugins.find(
        (plugin) => plugin.shortName === "finance_track_status",
      );
      if (
        trackStatus !== undefined &&
        !existsSync(compiledPluginEntry(trackStatus))
      ) {
        throw new Error(
          "Missing compiled finance_track_status shared-core module; rerun without --no-build",
        );
      }
    }
    await buildDshBundle(options.target, { build: options.build });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exit(1);
  }
}
