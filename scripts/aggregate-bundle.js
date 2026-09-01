import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { buildPlugins, HOST_EXTERNALS } from "./build.js";
import {
  BINDING_DIR,
  DIST_DIR,
  FINANCE_DIR,
  PLUGINS_DIR,
  ROOT,
  WORK_DIR,
  plugins,
} from "./modules.js";
import {
  partialImplementations,
  readTierManifest,
  tierById,
  unresolvedBlockers,
  validateTierManifest,
} from "./tiers.js";

const BUNDLE_SCHEMA_VERSION = 2;
const PREVIOUS_BUNDLE_SCHEMA_VERSION = 1;
const PRODUCT_TIER_IDS = ["T1", "T2", "T3", "T4", "T5"];
const ALLOWED_TARGETS = new Set(["T5", "T6"]);
export const DEFAULT_AGGREGATE_TARGET = "T6";
export const HOST_PEERS = {
  "@earendil-works/pi-agent-core": "*",
  "@earendil-works/pi-ai": "*",
  "@earendil-works/pi-coding-agent": "*",
  "@earendil-works/pi-tui": "*",
  typebox: "*",
};

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function rootVersion() {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error("Root package.json has no version");
  }
  return manifest.version;
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function safeOutputDirectory(path) {
  const output = resolve(path);
  const protectedDirectories = [
    ROOT,
    PLUGINS_DIR,
    FINANCE_DIR,
    BINDING_DIR,
  ];
  if (protectedDirectories.includes(output)) {
    throw new Error(`Refusing aggregate output at protected path: ${output}`);
  }
  if (isInside(output, ROOT)) {
    throw new Error(`Refusing aggregate output that contains the repository: ${output}`);
  }
  if (
    [PLUGINS_DIR, FINANCE_DIR, BINDING_DIR].some((directory) =>
      isInside(directory, output),
    )
  ) {
    throw new Error(`Refusing aggregate output inside source: ${output}`);
  }
  return output;
}

function assertReplaceableOutput(output, plan) {
  if (!existsSync(output)) return;
  if (!lstatSync(output).isDirectory()) {
    throw new Error(`Refusing to replace non-directory aggregate output: ${output}`);
  }
  const lockPath = join(output, "aggregate-lock.json");
  if (!existsSync(lockPath) || !lstatSync(lockPath).isFile()) {
    throw new Error(
      `Refusing to replace a directory without an aggregate lock: ${output}`,
    );
  }
  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    throw new Error(`Refusing to replace an invalid aggregate output: ${output}`);
  }
  if (
    ![PREVIOUS_BUNDLE_SCHEMA_VERSION, BUNDLE_SCHEMA_VERSION].includes(
      lock.schemaVersion,
    ) ||
    lock.package?.name !== plan.packageName ||
    lock.throughTierId !== plan.throughTierId
  ) {
    throw new Error(`Refusing to replace a different aggregate output: ${output}`);
  }
}

function moduleSpecifier(fromDirectory, target) {
  const path = relative(fromDirectory, target).split(sep).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(path));
    if (entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)) found.push(path);
  }
  return found;
}

function environmentVariables(plugin) {
  const names = new Set();
  const patterns = [
    /(?:process|Bun)\.env\.([A-Z][A-Z0-9_]*)/g,
    /(?:process|Bun)\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g,
  ];
  for (const path of sourceFiles(join(plugin.directory, "src"))) {
    const source = readFileSync(path, "utf8");
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) names.add(match[1]);
    }
  }
  return [...names].sort();
}

function pluginRecord(plan, plugin, artifactRoot) {
  const finance = plugin.metadata.metadata?.finance ?? {};
  return {
    tierId: plan.pluginTiers[plugin.shortName],
    shortName: plugin.shortName,
    gleamPackage: plugin.name,
    version: plugin.version,
    testedPiVersion: plugin.metadata.metadata?.pi?.tested_version ?? null,
    provider: typeof finance.provider === "string" ? finance.provider : null,
    access: typeof finance.access === "string" ? finance.access : null,
    environmentVariables: environmentVariables(plugin),
    brokerOrderMutation: finance.broker_order_mutation ?? null,
    sourceArtifactSha256: sha256File(
      join(artifactRoot, plugin.shortName, "index.js"),
    ),
  };
}

function tierDefinition(tier) {
  return {
    id: tier.id,
    name: tier.name,
    status: tier.status,
    productOutcome: tier.product_outcome,
    trackProfile: tier.track_profile,
    proposals: tier.proposals,
  };
}

export function aggregateBundlePlan(
  manifest,
  throughTierId = DEFAULT_AGGREGATE_TARGET,
  { enforcePiReleaseGate = true } = {},
) {
  const manifestErrors = validateTierManifest(manifest);
  if (manifestErrors.length > 0) {
    throw new Error(`Invalid tier manifest:\n- ${manifestErrors.join("\n- ")}`);
  }
  const target = throughTierId.toUpperCase();
  if (!ALLOWED_TARGETS.has(target)) {
    throw new Error("Aggregate target must be T5 or T6");
  }

  const requestedIds =
    target === "T6" ? [...PRODUCT_TIER_IDS, "T6"] : PRODUCT_TIER_IDS;
  const includedTiers = requestedIds.map((id) => {
    const tier = tierById(manifest, id);
    if (!tier) throw new Error(`Aggregate tier is missing: ${id}`);
    return tier;
  });
  for (const tier of includedTiers.filter((value) => value.id !== "T6")) {
    if (!enforcePiReleaseGate) continue;
    if (tier.status !== "product_useful") {
      throw new Error(
        `${tier.id} is ${tier.status}; aggregate bundles require T1-T5 to remain ProductUseful`,
      );
    }
  }

  const available = new Map(
    plugins().map((plugin) => [plugin.shortName, plugin]),
  );
  const requested = includedTiers.flatMap((tier) =>
    tier.proposals.map((proposal) => ({ tierId: tier.id, proposal })),
  );
  const omittedProposals = requested
    .filter(({ proposal }) => !available.has(proposal))
    .map(({ tierId, proposal }) => ({ tierId, proposal }));
  const earlierMissing = omittedProposals.filter(({ tierId }) => tierId !== "T6");
  if (earlierMissing.length > 0) {
    throw new Error(
      `ProductUseful aggregate implementation is missing: ${earlierMissing
        .map(({ tierId, proposal }) => `${tierId}/pi_${proposal}`)
        .join(", ")}`,
    );
  }

  const selected = requested
    .map(({ tierId, proposal }) => ({
      tierId,
      plugin: available.get(proposal),
    }))
    .filter(({ plugin }) => plugin !== undefined);
  const selectedNames = selected.map(({ plugin }) => plugin.shortName);
  if (new Set(selectedNames).size !== selectedNames.length) {
    throw new Error("Aggregate plan contains a plugin more than once");
  }
  for (const { plugin } of selected) {
    if (plugin.metadata.metadata?.finance?.broker_order_mutation === true) {
      throw new Error(
        `Aggregate bundle refuses broker order mutation: ${plugin.shortName}`,
      );
    }
  }

  const partials = includedTiers.flatMap((tier) =>
    partialImplementations(tier).map((partial) => ({
      tierId: tier.id,
      ...partial,
    })),
  );
  const blockers = includedTiers.flatMap((tier) =>
    unresolvedBlockers(tier).map((blocker) => ({
      tierId: tier.id,
      id: blocker.id,
      exit: blocker.exit,
    })),
  );
  const selectedTier = includedTiers.at(-1);
  const releasable =
    target === "T5" ||
    (selectedTier?.status === "product_useful" &&
      omittedProposals.length === 0 &&
      partials.length === 0 &&
      blockers.length === 0);
  const suffix = target.toLowerCase();
  return {
    throughTierId: target,
    includedTiers,
    plugins: selected.map(({ plugin }) => plugin),
    pluginTiers: Object.fromEntries(
      selected.map(({ tierId, plugin }) => [plugin.shortName, tierId]),
    ),
    omittedProposals,
    partialImplementations: partials,
    openBlockers: blockers,
    excludedExtraPackages: includedTiers.flatMap((tier) => tier.extra_packages),
    releasable,
    maturity: releasable
      ? "product_useful_aggregate"
      : "blocked_inventory_preview",
    packageName: `pi-sparkles-aggregate-${suffix}`,
    packageVersion: rootVersion(),
    outputDirectory: join(DIST_DIR, "aggregate", suffix),
  };
}

function aggregateRuntimeSource(plan, artifactRoot, adapterPath) {
  const imports = plan.plugins.map((plugin, index) =>
    `import extension${index} from ${JSON.stringify(
      moduleSpecifier(
        dirname(adapterPath),
        join(artifactRoot, plugin.shortName, "index.js"),
      ),
    )};`,
  );
  const records = plan.plugins.map(
    (plugin, index) =>
      `  [${JSON.stringify(plugin.shortName)}, extension${index}],`,
  );
  return `${imports.join("\n")}

const extensions = [
${records.join("\n")}
];

const namedRegistrationMethods = new Map([
  ["registerCommand", (args) => args[0]],
  ["registerShortcut", (args) => args[0]],
  ["registerFlag", (args) => args[0]],
  ["registerProvider", (args) => args[0]],
  ["registerTool", (args) => args[0]?.name],
  ["registerMessageRenderer", (args) => args[0]],
  ["registerEntryRenderer", (args) => args[0]],
]);

function scopedApi(api, pluginName, registrations) {
  return new Proxy(api, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const extractName = namedRegistrationMethods.get(property);
      if (!extractName) return value.bind(target);
      return (...args) => {
        const name = extractName(args);
        if (typeof name !== "string" || name.trim().length === 0) {
          throw new Error(
            "Aggregate plugin " + pluginName + " called " + String(property) + " without a stable name",
          );
        }
        const key = String(property) + ":" + name;
        const previous = registrations.get(key);
        if (previous !== undefined) {
          throw new Error(
            "Aggregate registration collision for " + String(property) + " '" + name + "': " + previous + " and " + pluginName,
          );
        }
        registrations.set(key, pluginName);
        return Reflect.apply(value, target, args);
      };
    },
  });
}

export default async function aggregateExtension(api) {
  const registrations = new Map();
  for (const [pluginName, extension] of extensions) {
    if (typeof extension !== "function") {
      throw new Error("Aggregate plugin " + pluginName + " has no extension factory");
    }
    await extension(scopedApi(api, pluginName, registrations));
  }
}
`;
}

function aggregateEntrypointSource() {
  return `import { createRequire } from "node:module";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const runtimeUrl = new URL("./runtime.js", import.meta.url).href;
const hostBridgeKey = Symbol.for("pi-sparkles:pi-tui-host:" + runtimeUrl);
// Pi's compiled host intentionally transforms extension entrypoints through
// Jiti. Keep the entrypoint tiny and use the host runtime's native module
// loader for the content-locked generated runtime. A Function-created dynamic
// import cannot run inside Jiti's vm context without an import callback.
const requireRuntime = createRequire(import.meta.url);
let runtimeModule;

function loadRuntime() {
  if (runtimeModule === undefined) {
    globalThis[hostBridgeKey] = Object.freeze({ truncateToWidth, visibleWidth });
    try {
      runtimeModule = requireRuntime("./runtime.js");
    } finally {
      delete globalThis[hostBridgeKey];
    }
  }
  return runtimeModule;
}

export default async function aggregateExtension(api) {
  const loaded = loadRuntime();
  if (typeof loaded.default !== "function") {
    throw new Error("Pi Sparkles runtime has no aggregate extension factory");
  }
  return loaded.default(api);
}
`;
}

function piTuiHostBridgePlugin() {
  return {
    name: "pi-sparkles-pi-tui-host-bridge",
    setup(build) {
      build.onResolve(
        { filter: /^@earendil-works\/pi-tui$/ },
        () => ({ path: "pi-tui-host", namespace: "pi-sparkles-host" }),
      );
      build.onLoad(
        { filter: /.*/, namespace: "pi-sparkles-host" },
        () => ({
          loader: "js",
          contents: `const key = Symbol.for("pi-sparkles:pi-tui-host:" + import.meta.url);
const host = globalThis[key];
if (host === undefined) throw new Error("Pi Sparkles runtime has no Pi TUI host bridge");
export const truncateToWidth = host.truncateToWidth;
export const visibleWidth = host.visibleWidth;
`,
        }),
      );
    },
  };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function checksumEntries(directory) {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name !== "SHA256SUMS") files.push(path);
      else if (!entry.isFile()) {
        throw new Error(`Aggregate bundle contains unsupported content: ${path}`);
      }
    }
  };
  visit(directory);
  return files
    .map((path) => ({
      path: relative(directory, path).split(sep).join("/"),
      sha256: sha256File(path),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function writeChecksums(directory) {
  const content = checksumEntries(directory)
    .map(({ sha256, path }) => `${sha256}  ${path}`)
    .join("\n");
  writeFileSync(join(directory, "SHA256SUMS"), `${content}\n`);
}

function parseChecksums(source) {
  return source
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})  (.+)$/);
      if (!match) throw new Error(`Invalid aggregate checksum line: ${line}`);
      return { sha256: match[1], path: match[2] };
    });
}

function configurationMarkdown(pluginRecords) {
  const markdownCell = (value) =>
    value.replaceAll("|", "\\|").replaceAll("\n", " ");
  const configured = pluginRecords.filter(
    (plugin) =>
      plugin.environmentVariables.length > 0 ||
      plugin.provider !== null ||
      plugin.access !== null,
  );
  const rows = configured.map((plugin) => {
    const provider = markdownCell(plugin.provider ?? "provider-neutral");
    const access = markdownCell(plugin.access ?? "see plugin contract");
    const variables =
      plugin.environmentVariables.length === 0
        ? "None"
        : plugin.environmentVariables.map((name) => `\`${name}\``).join(", ");
    return `| \`${plugin.shortName}\` | ${provider} | ${access} | ${variables} |`;
  });
  return `# Runtime configuration

The aggregate contains variable names only. It never reads or copies credential
values while building. \`AGENT_CONTACT\` is one shared non-secret operator identity
used across tracks and adapters; it grants no provider authority. Credentials
remain owned by the adapter that explicitly selects them, and providers never
silently fall back or share authority.
Required-versus-optional behavior and entitlement limits remain controlled by
the named plugin's contract.

| Plugin | Provider | Access | Referenced environment variables |
| --- | --- | --- | --- |
${rows.join("\n")}
`;
}

function packageReadme(plan) {
  const warning = plan.releasable
    ? "Every included tier is ProductUseful."
    : `This is a non-releasable inventory build awaiting ProductUseful promotion. Missing proposals: ${plan.omittedProposals
        .map(({ proposal }) => `pi_${proposal}`)
        .join(", ") || "none"}.`;
  return `# ${plan.packageName}

One Pi extension entrypoint aggregating ${plan.plugins.length} existing tier
plugins through ${plan.throughTierId}. ${warning}

The builder combines initialization and distribution only. Each plugin keeps
its existing compiled domain/effect boundary, configuration ownership, track,
receipts, and maturity. Runtime guards reject duplicate named tools, commands,
shortcuts, flags, providers, and renderers. Broker order mutation remains
forbidden.

Install with \`pi install .\`, or inspect without installation with
\`pi --no-extensions -e . --list-models\`. Review \`CONFIGURATION.md\` before
provider-backed use. See \`aggregate-lock.json\` and \`SHA256SUMS\` for the exact
inventory.
`;
}

function packageManifest(plan) {
  return {
    name: plan.packageName,
    version: plan.packageVersion,
    description: `Single-entry Pi aggregate through ${plan.throughTierId}`,
    private: !plan.releasable,
    type: "module",
    license: "Apache-2.0",
    keywords: ["pi-package", "pi-sparkles", "aggregate"],
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
  };
}

function lockRecord(plan, pluginRecords, entrypointPath, bundlePath) {
  const partialNames = new Set(
    plan.partialImplementations.map(({ proposal }) => proposal),
  );
  return {
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    package: { name: plan.packageName, version: plan.packageVersion },
    throughTierId: plan.throughTierId,
    maturity: plan.maturity,
    releasable: plan.releasable,
    singleEntrypoint: true,
    includedTiers: plan.includedTiers.map(tierDefinition),
    pluginCount: plan.plugins.length,
    initializationOrder: plan.plugins.map((plugin) => plugin.shortName),
    plugins: pluginRecords.map((plugin) => ({
      ...plugin,
      ledgerStatus: partialNames.has(plugin.shortName)
        ? "track_partial"
        : plan.pluginTiers[plugin.shortName] === "T6" && !plan.releasable
          ? "implementation_inventory"
          : "product_useful",
    })),
    omittedProposals: plan.omittedProposals,
    partialImplementations: plan.partialImplementations,
    openBlockers: plan.openBlockers,
    excludedExtraPackages: plan.excludedExtraPackages,
    collisionPolicy:
      "fail_before_duplicate_named_registration_is_forwarded_to_pi",
    credentialsIncluded: false,
    entrypointSha256: sha256File(entrypointPath),
    bundleSha256: sha256File(bundlePath),
  };
}

export function verifyAggregateBundle(directory, expectedPlan) {
  const root = resolve(directory);
  const required = [
    "package.json",
    "index.js",
    "runtime.js",
    "runtime.js.map",
    "build.json",
    "metafile.json",
    "aggregate-lock.json",
    "README.md",
    "CONFIGURATION.md",
    "SHA256SUMS",
  ];
  for (const file of required) {
    const path = join(root, file);
    if (!existsSync(path) || !lstatSync(path).isFile()) {
      throw new Error(`Aggregate bundle file is missing: ${path}`);
    }
  }
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(
    readFileSync(join(root, "aggregate-lock.json"), "utf8"),
  );
  if (lock.schemaVersion !== BUNDLE_SCHEMA_VERSION) {
    throw new Error(`Unsupported aggregate schema: ${lock.schemaVersion}`);
  }
  if (JSON.stringify(manifest.pi?.extensions) !== '["./index.js"]') {
    throw new Error("Aggregate package must declare exactly one Pi entrypoint");
  }
  if (
    manifest.name !== lock.package?.name ||
    manifest.version !== lock.package?.version ||
    manifest.private !== !lock.releasable ||
    manifest.piSparkles?.aggregateThrough !== lock.throughTierId ||
    manifest.piSparkles?.maturity !== lock.maturity ||
    manifest.piSparkles?.pluginCount !== lock.pluginCount ||
    manifest.piSparkles?.omittedProposalCount !== lock.omittedProposals?.length ||
    manifest.piSparkles?.partialImplementationCount !==
      lock.partialImplementations?.length ||
    manifest.piSparkles?.openBlockerCount !== lock.openBlockers?.length ||
    manifest.piSparkles?.publishable !== lock.releasable ||
    manifest.piSparkles?.brokerOrderMutation !== false ||
    lock.singleEntrypoint !== true ||
    lock.credentialsIncluded !== false ||
    lock.pluginCount !== lock.plugins?.length ||
    lock.entrypointSha256 !== sha256File(join(root, "index.js")) ||
    lock.bundleSha256 !== sha256File(join(root, "runtime.js"))
  ) {
    throw new Error("Aggregate package manifest or lock is inconsistent");
  }
  if (
    !Array.isArray(lock.initializationOrder) ||
    new Set(lock.initializationOrder).size !== lock.initializationOrder.length ||
    JSON.stringify(lock.initializationOrder) !==
      JSON.stringify(lock.plugins.map((plugin) => plugin.shortName))
  ) {
    throw new Error("Aggregate initialization inventory is invalid");
  }
  if (lock.plugins.some((plugin) => plugin.brokerOrderMutation === true)) {
    throw new Error("Aggregate lock contains broker order-mutation authority");
  }
  if (expectedPlan) {
    const expectedNames = expectedPlan.plugins.map((plugin) => plugin.shortName);
    if (
      lock.throughTierId !== expectedPlan.throughTierId ||
      lock.releasable !== expectedPlan.releasable ||
      JSON.stringify(lock.initializationOrder) !== JSON.stringify(expectedNames) ||
      JSON.stringify(lock.omittedProposals) !==
        JSON.stringify(expectedPlan.omittedProposals)
    ) {
      throw new Error("Aggregate bundle does not match the current plan");
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
      throw new Error(`Unsafe aggregate checksum path: ${entry.path}`);
    }
    const path = resolve(root, entry.path);
    if (!isInside(root, path) || sha256File(path) !== entry.sha256) {
      throw new Error(`Aggregate checksum mismatch: ${entry.path}`);
    }
  }
  const expectedChecksums = checksumEntries(root);
  const checksumLine = (entry) => `${entry.sha256}  ${entry.path}`;
  if (
    JSON.stringify(declaredChecksums.map(checksumLine)) !==
    JSON.stringify(expectedChecksums.map(checksumLine))
  ) {
    throw new Error("Aggregate checksum inventory is incomplete or unordered");
  }
  return {
    directory: root,
    name: manifest.name,
    version: manifest.version,
    throughTierId: lock.throughTierId,
    pluginCount: lock.pluginCount,
    releasable: lock.releasable,
  };
}

export async function assembleAggregateBundle(
  plan,
  artifactRoot = DIST_DIR,
  outputDirectory = plan.outputDirectory,
) {
  const output = safeOutputDirectory(outputDirectory);
  assertReplaceableOutput(output, plan);
  for (const plugin of plan.plugins) {
    const artifact = join(artifactRoot, plugin.shortName, "index.js");
    if (!existsSync(artifact) || !lstatSync(artifact).isFile()) {
      throw new Error(`Missing source artifact for aggregate: ${artifact}`);
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
  const adapter = join(
    WORK_DIR,
    "aggregate-adapters",
    `${plan.throughTierId.toLowerCase()}-${process.pid}-${randomUUID()}.mjs`,
  );
  mkdirSync(staging, { recursive: true });
  mkdirSync(dirname(adapter), { recursive: true });
  let movedPrevious = false;
  try {
    writeFileSync(adapter, aggregateRuntimeSource(plan, artifactRoot, adapter));
    const result = await Bun.build({
      entrypoints: [adapter],
      outdir: staging,
      naming: "runtime.js",
      format: "esm",
      target: "node",
      minify: false,
      sourcemap: "external",
      metafile: true,
      external: HOST_EXTERNALS.filter(
        (specifier) => specifier !== "@earendil-works/pi-tui",
      ),
      plugins: [piTuiHostBridgePlugin()],
    });
    if (!result.success) {
      const details = result.logs.map((log) => String(log)).join("\n");
      throw new Error(`Aggregate Bun build failed${details ? `:\n${details}` : ""}`);
    }
    const unsupportedRuntimeExternals = new Set();
    for (const input of Object.values(result.metafile.inputs)) {
      for (const imported of input.imports ?? []) {
        if (
          imported.external &&
          !imported.path.startsWith("node:") &&
          imported.path !== "pdfjs-dist/legacy/build/pdf.mjs"
        ) {
          unsupportedRuntimeExternals.add(imported.path);
        }
      }
    }
    if (unsupportedRuntimeExternals.size > 0) {
      throw new Error(
        `Native aggregate runtime has unbridged external imports: ${[
          ...unsupportedRuntimeExternals,
        ].sort().join(", ")}`,
      );
    }
    const entrypointPath = join(staging, "index.js");
    const bundlePath = join(staging, "runtime.js");
    writeFileSync(entrypointPath, aggregateEntrypointSource());
    const pluginRecords = plan.plugins.map((plugin) =>
      pluginRecord(plan, plugin, artifactRoot),
    );
    writeJson(join(staging, "package.json"), packageManifest(plan));
    writeJson(join(staging, "build.json"), {
      kind: "single_entrypoint_tier_aggregate",
      throughTierId: plan.throughTierId,
      pluginCount: plan.plugins.length,
      releasable: plan.releasable,
      external: HOST_EXTERNALS,
    });
    writeJson(join(staging, "metafile.json"), result.metafile);
    writeFileSync(join(staging, "README.md"), packageReadme(plan));
    writeFileSync(
      join(staging, "CONFIGURATION.md"),
      configurationMarkdown(pluginRecords),
    );
    writeJson(
      join(staging, "aggregate-lock.json"),
      lockRecord(plan, pluginRecords, entrypointPath, bundlePath),
    );
    writeChecksums(staging);
    verifyAggregateBundle(staging, plan);

    if (existsSync(output)) {
      renameSync(output, backup);
      movedPrevious = true;
    }
    renameSync(staging, output);
    if (movedPrevious) rmSync(backup, { recursive: true, force: true });
    return verifyAggregateBundle(output, plan);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (movedPrevious && !existsSync(output) && existsSync(backup)) {
      renameSync(backup, output);
    }
    throw error;
  } finally {
    rmSync(adapter, { force: true });
  }
}

export async function buildAggregateBundle(
  throughTierId = DEFAULT_AGGREGATE_TARGET,
  { build = true, outputDirectory } = {},
) {
  const plan = aggregateBundlePlan(readTierManifest(), throughTierId);
  if (build) await buildPlugins(plan.plugins);
  const summary = await assembleAggregateBundle(
    plan,
    DIST_DIR,
    outputDirectory ?? plan.outputDirectory,
  );
  console.log(
    `${summary.throughTierId} aggregate: ${summary.directory} (${summary.pluginCount} plugins, one Pi entrypoint${summary.releasable ? "" : ", blocked preview"})`,
  );
  return summary;
}

function usage() {
  return [
    "Usage: bun run aggregate:build -- [T5|T6] [--no-build] [--output <directory>]",
    "       bun run aggregate:build -- [T5|T6] --verify-only [--output <directory>]",
    "T6 is the next-release default and becomes releasable only after ProductUseful promotion; select T5 explicitly for the prior release.",
  ].join("\n");
}

export function parseAggregateArguments(args) {
  let throughTierId = DEFAULT_AGGREGATE_TARGET;
  let targetSeen = false;
  let build = true;
  let verifyOnly = false;
  let outputDirectory;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-build") build = false;
    else if (arg === "--verify-only") verifyOnly = true;
    else if (arg === "--output") {
      outputDirectory = args[index + 1];
      index += 1;
      if (!outputDirectory) throw new Error("--output requires a directory");
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else if (targetSeen) throw new Error(`Unexpected argument: ${arg}`);
    else {
      throughTierId = arg.toUpperCase();
      targetSeen = true;
    }
  }
  if (!ALLOWED_TARGETS.has(throughTierId)) {
    throw new Error("Aggregate target must be T5 or T6");
  }
  if (verifyOnly && build === false) {
    throw new Error("--no-build is redundant with --verify-only");
  }
  return { throughTierId, build, verifyOnly, outputDirectory, help: false };
}

if (import.meta.main) {
  try {
    const options = parseAggregateArguments(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    const plan = aggregateBundlePlan(
      readTierManifest(),
      options.throughTierId,
    );
    const output = options.outputDirectory ?? plan.outputDirectory;
    if (options.verifyOnly) {
      const summary = verifyAggregateBundle(output, plan);
      console.log(
        `${summary.throughTierId} aggregate verified: ${summary.pluginCount} plugins at ${summary.directory}`,
      );
    } else {
      await buildAggregateBundle(options.throughTierId, {
        build: options.build,
        outputDirectory: output,
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    process.exit(1);
  }
}
