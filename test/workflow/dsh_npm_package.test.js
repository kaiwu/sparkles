import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DSH_OUTPUT_DIR,
  DSH_PACKAGE_NAME,
  DSH_RUNTIME_DEPENDENCIES,
  DSH_RUNTIME_PEERS,
} from "../../scripts/dsh-bundle.js";
import {
  assertDshHostVersion,
  assertDshNpmPublishable,
  assembleDshNpmRelease,
  dshNpmPackagePlan,
  parseDshNpmPackageArguments,
  verifyDshNpmPackageDirectory,
  verifyDshNpmRelease,
} from "../../scripts/dsh-npm-package.js";
import { readTierManifest } from "../../scripts/tiers.js";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "dsh-sparkles-npm-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixturePlugin() {
  return {
    directory: join("/", "unused"),
    shortName: "fixture",
    name: "pi_sparkles_fixture",
    version: "0.1.0",
    metadata: { metadata: { finance: { broker_order_mutation: false } } },
  };
}

function fixturePlan(root, { throughTierId = "T6", releasable = true } = {}) {
  const plugin = fixturePlugin();
  return {
    throughTierId,
    includedTiers: [],
    plugins: [plugin],
    componentCount: 1,
    pluginTiers: { fixture: throughTierId },
    omittedProposals: [],
    partialImplementations: [],
    openBlockers: [],
    dshBlockers: releasable ? [] : ["fixture blocker"],
    excludedExtraPackages: [],
    releasable,
    maturity: releasable
      ? "product_useful_aggregate"
      : "blocked_inventory_preview",
    piAggregateMaturity: "product_useful_aggregate",
    dshRelease: {
      status: releasable ? "product_useful" : "preview",
      reason: releasable ? null : "fixture blocker",
    },
    dshPlugins: [],
    scopedPiPlugins: [],
    scopedPiProposals: [],
    packageName: `dsh-sparkles-${throughTierId.toLowerCase()}-fixture`,
    packageVersion: "0.1.0",
    outputDirectory: join(root, "bundle"),
    npmPackageName: DSH_PACKAGE_NAME,
    bundleDirectory: join(root, "bundle"),
    npmOutputDirectory: join(root, "npm"),
  };
}

function writeFixtureBundle(plan) {
  const directory = plan.bundleDirectory;
  mkdirSync(directory, { recursive: true });
  const indexSource =
    "const plugin = { name: 'dsh-sparkles', inject: ['tools', 'commands'], async apply() {} };\nexport default plugin;\n";
  const clientSource =
    "window.__ModuleLoader__.load({ id: '@dsh-sparkles/dsh-sparkles', factory: () => ({ inject: [], apply() {} }) });\n";
  writeFileSync(join(directory, "index.js"), indexSource);
  writeFileSync(join(directory, "index.js.map"), "{}\n");
  writeFileSync(join(directory, "client.js"), clientSource);
  writeFileSync(join(directory, "CONFIGURATION.md"), "# Configuration\n");
  writeFileSync(
    join(directory, "cordis.patch.yml"),
    "- insert:\n    - id: dsh-sparkles\n      name: '@dsh-sparkles/dsh-sparkles'\n",
  );
  writeFileSync(join(directory, "README.md"), "# dsh-sparkles\n");
  writeFileSync(join(directory, "SHA256SUMS"), "");
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify(
      {
        name: DSH_PACKAGE_NAME,
        version: plan.packageVersion,
        type: "module",
        main: "index.js",
        exports: { ".": "./index.js", "./client": "./client.js" },
        private: !plan.releasable,
        engines: { node: ">=22.19.0" },
        dependencies: DSH_RUNTIME_DEPENDENCIES,
        peerDependencies: DSH_RUNTIME_PEERS,
        dsh: {
          bundle: { patch: "./cordis.patch.yml" },
          client: {
            inject: [
              "@deepseek-ai/dsh-client-ui-session",
              "@deepseek-ai/dsh-client-ui-layout",
              "@deepseek-ai/dsh-client-ui-tool",
            ],
            platform: "web",
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(directory, "dsh-lock.json"),
    `${JSON.stringify(
      {
        schemaVersion: 2,
        package: { name: DSH_PACKAGE_NAME, version: plan.packageVersion },
        target: plan.throughTierId,
        pluginCount: plan.plugins.length,
        plugins: [
          {
            tierId: plan.throughTierId,
            shortName: "fixture",
            gleamPackage: "pi_sparkles_fixture",
            version: "0.1.0",
            sourceArtifactSha256: "0".repeat(64),
            provider: null,
          },
        ],
        dshPlugins: [],
        scopedPiPlugins: [],
        excludedPiProposals: [],
        exclusionReasons: {},
        extraDshPlugins: [],
        scopedPiProposals: [],
        dshRelease: plan.dshRelease,
        dshBlockers: plan.dshBlockers,
        maturity: plan.maturity,
        piAggregateMaturity: plan.piAggregateMaturity,
        publishable: plan.releasable,
        indexSha256: sha256(indexSource),
        clientSha256: sha256(clientSource),
      },
      null,
      2,
    )}\n`,
  );
  const checksums = [
    "CONFIGURATION.md",
    "README.md",
    "cordis.patch.yml",
    "client.js",
    "dsh-lock.json",
    "index.js",
    "index.js.map",
    "package.json",
  ]
    .map((name) => `${sha256(readFileSync(join(directory, name)))}  ${name}`)
    .sort()
    .join("\n");
  writeFileSync(join(directory, "SHA256SUMS"), `${checksums}\n`);
}

async function buildFixture(plan) {
  writeFixtureBundle(plan);
  return assembleDshNpmRelease(
    plan,
    plan.bundleDirectory,
    plan.npmOutputDirectory,
  );
}

describe("dsh-sparkles npm packaging", () => {
  test("requires the exact declared DSH host version", () => {
    const run = () => ({ exitCode: 0, stdout: "0.1.2-rc.1\n", stderr: "" });
    expect(
      assertDshHostVersion("dsh", "0.1.2-rc.1", { run }),
    ).toBe("0.1.2-rc.1");
    expect(() =>
      assertDshHostVersion("dsh", "0.1.2-rc.1", {
        run: () => ({ exitCode: 0, stdout: "0.1.1-rc.1\n", stderr: "" }),
      }),
    ).toThrow("Installed DSH host is 0.1.1-rc.1, expected exact 0.1.2-rc.1");
  });

  test("derives the T6 all-in-one bundle and preserves the maturity gate", () => {
    const manifest = readTierManifest();
    const t6 = dshNpmPackagePlan(manifest, "T6");
    expect(t6.npmPackageName).toBe("@dsh-sparkles/dsh-sparkles");
    expect(t6.plugins).toHaveLength(131);
    expect(t6.componentCount).toBe(135);
    expect(t6.plugins.some((plugin) => plugin.shortName === "finance_track_status")).toBeFalse();
    expect(t6.excludedPiProposals).toEqual([
      "finance_track_status",
      "swing_workbench",
      "portfolio",
      "watchlist",
    ]);
    expect(t6.extraDshPlugins).toEqual(["finance_track_overlay"]);
    expect(t6.scopedPiProposals).toEqual([
      "finance_track_status",
      "swing_workbench",
      "portfolio",
      "watchlist",
    ]);
    expect(t6.omittedProposals).toEqual([]);
    expect(t6.partialImplementations).toEqual([]);
    expect(t6.openBlockers).toEqual([]);
    expect(t6.packageVersion).toBe("0.1.12");
    expect(t6.maturity).toBe("product_useful_dsh_aggregate");
    expect(t6.dshRelease).toMatchObject({
      version: "0.1.12",
      status: "product_useful",
      target: "T6",
    });
    expect(t6.releasable).toBeTrue();

    const t5 = dshNpmPackagePlan(manifest, "T5");
    expect(t5.plugins).toHaveLength(120);
    expect(t5.releasable).toBeFalse();
  });

  test("keeps the DSH release gate independent from Pi maturity", () => {
    const manifest = structuredClone(readTierManifest());
    for (const tier of manifest.tiers) tier.status = "building";

    const t6 = dshNpmPackagePlan(manifest, "T6");
    expect(t6.piAggregateMaturity).toBe("blocked_inventory_preview");
    expect(t6.dshRelease.status).toBe("product_useful");
    expect(t6.maturity).toBe("product_useful_dsh_aggregate");
    expect(t6.releasable).toBeTrue();
  });

  test("packs a content-locked tarball with the dsh.bundle manifest", async () => {
    const root = temporaryDirectory();
    const plan = fixturePlan(root);
    const summary = await buildFixture(plan);
    expect(summary).toMatchObject({
      name: "@dsh-sparkles/dsh-sparkles",
      version: "0.1.0",
      throughTierId: "T6",
      pluginCount: 1,
      publishable: true,
    });
    expect(verifyDshNpmRelease(plan.npmOutputDirectory, plan)).toEqual(summary);
    expect(
      verifyDshNpmPackageDirectory(join(plan.npmOutputDirectory, "package"), plan),
    ).toMatchObject({ publishable: true });

    const manifest = JSON.parse(
      readFileSync(
        join(plan.npmOutputDirectory, "package", "package.json"),
        "utf8",
      ),
    );
    expect(manifest.dsh.bundle.patch).toBe("./cordis.patch.yml");
    expect(manifest.dsh.client).toEqual({
      inject: [
        "@deepseek-ai/dsh-client-ui-session",
        "@deepseek-ai/dsh-client-ui-layout",
        "@deepseek-ai/dsh-client-ui-tool",
      ],
      platform: "web",
    });
    expect(manifest.main).toBe("./index.js");
    expect(manifest.dshSparkles).toEqual({
      aggregateThrough: "T6",
      maturity: "product_useful_aggregate",
      piAggregateMaturity: "product_useful_aggregate",
      dshReleaseStatus: "product_useful",
      dshBlockerCount: 0,
      pluginCount: 1,
      omittedProposalCount: 0,
      partialImplementationCount: 0,
      openBlockerCount: 0,
      excludedPiProposalCount: 0,
      extraDshPluginCount: 0,
      publishable: true,
      brokerOrderMutation: false,
    });
    expect(manifest.dependencies).toEqual({
      "@napi-rs/canvas": "1.0.3",
      "pdfjs-dist": "6.2.108",
    });
    expect(manifest.peerDependencies).toEqual({
      "@deepseek-ai/dsh": "0.1.2-rc.1",
      "@deepseek-ai/dsh-agent": "0.1.2-rc.1",
      "@deepseek-ai/dsh-client-ui-session": "0.1.2-rc.1",
      "@deepseek-ai/dsh-client-ui-layout": "0.1.2-rc.1",
      "@deepseek-ai/dsh-client-ui-tool": "0.1.2-rc.1",
      "@deepseek-ai/dsh-commands": "0.1.2-rc.1",
      "@deepseek-ai/dsh-session": "0.1.2-rc.1",
      "@deepseek-ai/dsh-session-projection": "0.1.2-rc.1",
      "@deepseek-ai/dsh-system-prompt": "0.1.2-rc.1",
      "@deepseek-ai/dsh-tools": "0.1.2-rc.1",
    });
    expect(manifest.scripts).toBeUndefined();
    expect(manifest.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org/",
    });
    expect(manifest.keywords).toContain("deepseek-harness");
    expect(manifest.homepage).toBe("https://sparkles.extensio.cn");
    expect(manifest.repository.url).toBe(
      "git+https://github.com/kaiwu/sparkles.git",
    );
    expect(manifest.bugs.url).toBe(
      "https://github.com/kaiwu/sparkles/issues",
    );

    const packageReadme = readFileSync(
      join(plan.npmOutputDirectory, "package", "README.md"),
      "utf8",
    );
    expect(packageReadme).toContain("## Quick start");
    expect(packageReadme).toContain("dsh plugin --profile <name> add @dsh-sparkles/dsh-sparkles");
    expect(packageReadme).toContain("| Variable | What it enables |");
    expect(packageReadme).toContain("| `AGENT_CONTACT` |");
    expect(packageReadme).toContain("| `TUSHARE_TOKEN` |");
    expect(packageReadme).toContain("- `Get a current quote for AAPL.`");
    expect(packageReadme).toContain(
      "- `Summarize AAPL's latest SEC fundamentals and cite the evidence.`",
    );
    expect(packageReadme).toContain("## Boundaries");
    expect(packageReadme).toContain("read-only research software");
    expect(packageReadme).not.toContain("shell.overlay");
    expect(packageReadme).not.toContain("Pi inline images");
    expect(packageReadme).toContain("https://github.com/kaiwu/sparkles");
    expect(packageReadme).toContain("@pi-sparkles/pi-sparkles");
    expect(packageReadme).toContain("This is the DSH distribution");
    expect(() => assertDshNpmPublishable(summary)).not.toThrow();

    const rebuilt = await assembleDshNpmRelease(
      plan,
      plan.bundleDirectory,
      plan.npmOutputDirectory,
    );
    expect(rebuilt.tarballSha256).toBe(summary.tarballSha256);
  });

  test("packs a blocked preview privately and refuses its publish gate", async () => {
    const root = temporaryDirectory();
    const plan = fixturePlan(root, { throughTierId: "T6", releasable: false });
    const summary = await buildFixture(plan);
    const manifest = JSON.parse(
      readFileSync(
        join(plan.npmOutputDirectory, "package", "package.json"),
        "utf8",
      ),
    );
    expect(summary.publishable).toBeFalse();
    expect(manifest.private).toBeTrue();
    expect(manifest.publishConfig).toBeUndefined();
    expect(manifest.dshSparkles).toMatchObject({
      maturity: "blocked_inventory_preview",
      publishable: false,
    });
    const packageReadme = readFileSync(
      join(plan.npmOutputDirectory, "package", "README.md"),
      "utf8",
    );
    expect(packageReadme).toContain("## Local preview install");
    expect(packageReadme).toContain("./dist/dsh/npm/t6/package");
    expect(packageReadme).not.toContain(
      "add @dsh-sparkles/dsh-sparkles@0.1.0",
    );
    expect(() => assertDshNpmPublishable(summary)).toThrow(
      "blocked preview and cannot be published",
    );
  });

  test("detects package tampering after npm packing", async () => {
    const root = temporaryDirectory();
    const plan = fixturePlan(root);
    await buildFixture(plan);
    writeFileSync(
      join(plan.npmOutputDirectory, "package", "index.js"),
      "export default function () {}\n",
    );
    expect(() => verifyDshNpmRelease(plan.npmOutputDirectory, plan)).toThrow();
  });

  test("argument parsing mirrors the Pi packager defaults", () => {
    expect(parseDshNpmPackageArguments([])).toMatchObject({
      throughTierId: "T6",
      build: true,
    });
    expect(
      parseDshNpmPackageArguments(["T5", "--no-build", "--install-smoke"]),
    ).toMatchObject({ throughTierId: "T5", build: false, installSmoke: true });
    expect(() => parseDshNpmPackageArguments(["T4"])).toThrow(
      "target must be T5 or T6",
    );
  });

  test("the real T6 bundle directory is the pack source", () => {
    expect(DSH_OUTPUT_DIR.endsWith("dist/dsh/dsh-sparkles")).toBeTrue();
  });
});
