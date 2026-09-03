import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import {
  NPM_REGISTRY,
  releaseLatest,
  releaseVersionForLane,
} from "../../scripts/npm-release-latest.js";

function registryRunner(calls, version = "0.1.9") {
  return (args, options = {}) => {
    calls.push({ args, options });
    if (args[0] === "view") return JSON.stringify([version]);
    if (args[0] === "dist-tag") return "";
    throw new Error(`unexpected npm command: ${args.join(" ")}`);
  };
}

describe("npm release latest tags", () => {
  test("selects independent Pi and DSH versions and refuses a mismatched all release", () => {
    expect(
      releaseVersionForLane({ lane: "pi", piVersion: "0.1.8", dshVersion: "0.1.9" }),
    ).toBe("0.1.8");
    expect(
      releaseVersionForLane({ lane: "dsh", piVersion: "0.1.8", dshVersion: "0.1.9" }),
    ).toBe("0.1.9");
    expect(() =>
      releaseVersionForLane({ lane: "all", piVersion: "0.1.8", dshVersion: "0.1.9" }),
    ).toThrow("coordinated release requires matching Pi and DSH versions");
  });

  test("the trusted-publishing workflow always publishes and verifies latest", () => {
    const workflow = readFileSync(
      new URL("../../.github/workflows/npm-publish.yml", import.meta.url),
      "utf8",
    );

    expect(workflow).not.toContain("dist_tag");
    expect(workflow.match(/npm publish .* --tag latest/g)).toHaveLength(2);
    expect(workflow).toContain(
      "npm install --global @deepseek-ai/dsh@0.1.1-rc.2",
    );
    expect(workflow).toContain("bun run npm:release:latest -- pi --check");
    expect(workflow).toContain("bun run npm:release:latest -- dsh --check");
  });

  test("preflights, updates, and verifies both host identities", () => {
    const calls = [];
    const result = releaseLatest({
      version: "0.1.9",
      lane: "all",
      run: registryRunner(calls),
    });

    expect(result).toEqual([
      { host: "pi", packageName: "@pi-sparkles/pi-sparkles", version: "0.1.9" },
      { host: "dsh", packageName: "@dsh-sparkles/dsh-sparkles", version: "0.1.9" },
    ]);
    expect(calls.map(({ args }) => args)).toEqual([
      ["view", "@pi-sparkles/pi-sparkles@0.1.9", "version", "--json", "--registry", NPM_REGISTRY],
      ["view", "@dsh-sparkles/dsh-sparkles@0.1.9", "version", "--json", "--registry", NPM_REGISTRY],
      ["dist-tag", "add", "@pi-sparkles/pi-sparkles@0.1.9", "latest", "--registry", NPM_REGISTRY],
      ["dist-tag", "add", "@dsh-sparkles/dsh-sparkles@0.1.9", "latest", "--registry", NPM_REGISTRY],
      ["view", "@pi-sparkles/pi-sparkles", "dist-tags.latest", "--json", "--registry", NPM_REGISTRY],
      ["view", "@dsh-sparkles/dsh-sparkles", "dist-tags.latest", "--json", "--registry", NPM_REGISTRY],
    ]);
  });

  test("check mode verifies one lane without mutating its tag", () => {
    const calls = [];
    const result = releaseLatest({
      version: "0.1.9",
      lane: "dsh",
      checkOnly: true,
      run: registryRunner(calls),
    });

    expect(result).toEqual([
      { host: "dsh", packageName: "@dsh-sparkles/dsh-sparkles", version: "0.1.9" },
    ]);
    expect(calls.every(({ args }) => args[0] === "view")).toBe(true);
  });

  test("does not mutate any tag when a coordinated preflight fails", () => {
    const calls = [];
    const run = (args, options = {}) => {
      calls.push({ args, options });
      if (args[0] === "view" && args[1].startsWith("@dsh-sparkles/")) {
        throw new Error("version is not published");
      }
      return JSON.stringify("0.1.9");
    };

    expect(() => releaseLatest({ version: "0.1.9", lane: "all", run })).toThrow(
      "version is not published",
    );
    expect(calls.some(({ args }) => args[0] === "dist-tag")).toBe(false);
  });
});
