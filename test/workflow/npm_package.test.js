import { afterEach, describe, expect, test } from "bun:test";
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
  assembleAggregateBundle,
} from "../../scripts/aggregate-bundle.js";
import {
  assembleNpmRelease,
  assertNpmPublishable,
  npmPackagePlan,
  parseNpmPackageArguments,
  verifyNpmPackageDirectory,
  verifyNpmRelease,
} from "../../scripts/npm-package.js";
import { readTierManifest } from "../../scripts/tiers.js";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "pi-sparkles-npm-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function fixturePlugin(root) {
  const directory = join(root, "source", "fixture");
  mkdirSync(join(directory, "src"), { recursive: true });
  return {
    directory,
    shortName: "fixture",
    name: "pi_sparkles_fixture",
    version: "0.1.0",
    metadata: {
      metadata: {
        pi: { tested_version: "0.83.0" },
        finance: { broker_order_mutation: false },
      },
    },
  };
}

function fixturePlan(root, { throughTierId = "T5", releasable = true } = {}) {
  const plugin = fixturePlugin(root);
  const artifactDirectory = join(root, "artifacts", plugin.shortName);
  mkdirSync(artifactDirectory, { recursive: true });
  writeFileSync(
    join(artifactDirectory, "index.js"),
    "export default function (api) { api.registerTool({ name: 'fixture_tool' }); }\n",
  );
  const tier = {
    id: throughTierId,
    name: "Fixture",
    status: releasable ? "product_useful" : "blocker_resolution",
    product_outcome: "Fixture outcome",
    track_profile: "Fixture track",
    proposals: [plugin.shortName],
    extra_packages: [],
  };
  const aggregateDirectory = join(root, "aggregate");
  return {
    throughTierId,
    includedTiers: [tier],
    plugins: [plugin],
    pluginTiers: { fixture: throughTierId },
    omittedProposals: [],
    partialImplementations: [],
    openBlockers: [],
    excludedExtraPackages: [],
    releasable,
    maturity: releasable
      ? "product_useful_aggregate"
      : "blocked_inventory_preview",
    packageName: `pi-sparkles-aggregate-${throughTierId.toLowerCase()}-fixture`,
    packageVersion: "0.1.0",
    outputDirectory: aggregateDirectory,
    aggregateDirectory,
    npmPackageName: "@pi-sparkles/pi-sparkles",
    npmOutputDirectory: join(root, "npm"),
    artifactDirectory: join(root, "artifacts"),
  };
}

async function buildFixture(plan) {
  await assembleAggregateBundle(
    plan,
    plan.artifactDirectory,
    plan.aggregateDirectory,
  );
  return assembleNpmRelease(
    plan,
    plan.aggregateDirectory,
    plan.npmOutputDirectory,
  );
}

describe("all-in-one npm packaging", () => {
  test("derives the complete selected aggregate and preserves the maturity gate", () => {
    const manifest = readTierManifest();
    const t5 = npmPackagePlan(manifest, "T5");
    expect(t5.npmPackageName).toBe("@pi-sparkles/pi-sparkles");
    expect(t5.plugins).toHaveLength(124);
    expect(t5.releasable).toBeTrue();

    const t6 = npmPackagePlan(manifest, "T6");
    expect(t6.npmPackageName).toBe("@pi-sparkles/pi-sparkles");
    expect(t6.plugins).toHaveLength(135);
    expect(t6.omittedProposals).toEqual([]);
    expect(t6.partialImplementations).toEqual([]);
    expect(t6.openBlockers).toEqual([]);
    expect(t6.packageVersion).toBe("0.1.11");
    expect(t6.releasable).toBe(
      t6.includedTiers.at(-1).status === "product_useful",
    );
    expect(npmPackagePlan(manifest).throughTierId).toBe("T6");
  });

  test("packs a content-locked npm tarball with one Pi entrypoint", async () => {
    const root = temporaryDirectory();
    const plan = fixturePlan(root);
    const summary = await buildFixture(plan);
    expect(summary).toMatchObject({
      name: "@pi-sparkles/pi-sparkles",
      version: "0.1.0",
      throughTierId: "T5",
      pluginCount: 1,
      publishable: true,
    });
    expect(verifyNpmRelease(plan.npmOutputDirectory, plan)).toEqual(summary);
    expect(
      verifyNpmPackageDirectory(
        join(plan.npmOutputDirectory, "package"),
        plan,
      ),
    ).toMatchObject({ publishable: true });

    const packageManifest = JSON.parse(
      readFileSync(
        join(plan.npmOutputDirectory, "package", "package.json"),
        "utf8",
      ),
    );
    expect(packageManifest.pi.extensions).toEqual(["./index.js"]);
    expect(packageManifest.piSparkles).toEqual({
      aggregateThrough: "T5",
      maturity: "product_useful_aggregate",
      pluginCount: 1,
      omittedProposalCount: 0,
      partialImplementationCount: 0,
      openBlockerCount: 0,
      publishable: true,
      brokerOrderMutation: false,
    });
    expect(packageManifest.dependencies).toEqual({
      "@napi-rs/canvas": "1.0.3",
      "pdfjs-dist": "6.2.108",
    });
    expect(packageManifest.peerDependencies).toEqual({
      "@earendil-works/pi-agent-core": "*",
      "@earendil-works/pi-ai": "*",
      "@earendil-works/pi-coding-agent": "*",
      "@earendil-works/pi-tui": "*",
      typebox: "*",
    });
    expect(packageManifest.scripts).toBeUndefined();
    expect(packageManifest.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org/",
    });
    expect(packageManifest.description).toBe(
      "Turn Pi into a finance research assistant for China, Hong Kong, and US markets",
    );
    expect(packageManifest.homepage).toBe("https://sparkles.extensio.cn");
    expect(packageManifest.repository.url).toBe(
      "git+https://github.com/kaiwu/sparkles.git",
    );
    expect(packageManifest.bugs.url).toBe(
      "https://github.com/kaiwu/sparkles/issues",
    );
    const packageReadme = readFileSync(
      join(plan.npmOutputDirectory, "package", "README.md"),
      "utf8",
    );
    expect(packageReadme).toContain("## Data sources");
    expect(packageReadme).toContain("## What it gives you");
    expect(packageReadme).toContain("## Optional data-service setup");
    expect(packageReadme).toContain('AGENT_CONTACT="you@example.com"');
    expect(packageReadme).toContain("You do not need to ask it");
    expect(packageReadme).toContain("https://github.com/kaiwu/sparkles");
    expect(packageReadme).toContain("@dsh-sparkles/dsh-sparkles");
    expect(packageReadme).toContain("This is the Pi distribution");
    expect(packageReadme).not.toContain("T5");
    expect(packageReadme).not.toContain("ProductUseful");
    expect(packageReadme).not.toContain("tier");
    expect(packageReadme).not.toContain("aggregate");
    expect(packageReadme).toContain("External day-trader and broker dependencies");
    expect(packageReadme).toContain("Futu OpenD, Alpaca, IBKR");
    expect(packageReadme).toContain(
      "external dependencies and are not included in this npm",
    );
    expect(() => assertNpmPublishable(summary)).not.toThrow();

    const rebuilt = await assembleNpmRelease(
      plan,
      plan.aggregateDirectory,
      plan.npmOutputDirectory,
    );
    expect(rebuilt.tarballSha256).toBe(summary.tarballSha256);
  }, 15_000);

  test("packs T6-format inventory privately and refuses its publish gate", async () => {
    const root = temporaryDirectory();
    const plan = fixturePlan(root, {
      throughTierId: "T6",
      releasable: false,
    });
    const summary = await buildFixture(plan);
    const packageManifest = JSON.parse(
      readFileSync(
        join(plan.npmOutputDirectory, "package", "package.json"),
        "utf8",
      ),
    );
    expect(summary.publishable).toBeFalse();
    expect(packageManifest.private).toBeTrue();
    expect(packageManifest.publishConfig).toBeUndefined();
    expect(packageManifest.piSparkles).toMatchObject({
      aggregateThrough: "T6",
      maturity: "blocked_inventory_preview",
      publishable: false,
    });
    const packageReadme = readFileSync(
      join(plan.npmOutputDirectory, "package", "README.md"),
      "utf8",
    );
    expect(packageReadme).toContain("## T6 development inventory");
    expect(packageReadme).toContain("OpenD, provider SDKs, credentials");
    expect(packageReadme).toContain("never quotes, bid/offer, or an order");
    expect(packageReadme).toContain("## Local preview");
    expect(packageReadme).not.toContain(`pi install npm:@pi-sparkles/pi-sparkles`);
    expect(() => assertNpmPublishable(summary)).toThrow(
      "T6 npm aggregate is a blocked preview and cannot be published",
    );
  }, 15_000);

  test("detects package tampering after npm packing", async () => {
    const root = temporaryDirectory();
    const plan = fixturePlan(root);
    await buildFixture(plan);
    writeFileSync(
      join(plan.npmOutputDirectory, "package", "index.js"),
      "export default function () {}\n",
    );
    expect(() => verifyNpmRelease(plan.npmOutputDirectory, plan)).toThrow();
  }, 15_000);

  test("defaults to the T6 next release and accepts explicit T5", () => {
    expect(parseNpmPackageArguments([])).toMatchObject({
      throughTierId: "T6",
      build: true,
    });
    expect(parseNpmPackageArguments(["T5", "--no-build"])).toMatchObject({
      throughTierId: "T5",
      build: false,
    });
    expect(
      parseNpmPackageArguments(["T5", "--no-build", "--install-smoke"]),
    ).toMatchObject({
      throughTierId: "T5",
      build: false,
      installSmoke: true,
    });
    expect(() => parseNpmPackageArguments(["T4"])).toThrow(
      "target must be T5 or T6",
    );
  });
});
