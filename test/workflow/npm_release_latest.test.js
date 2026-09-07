import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { NPM_REGISTRY, RELEASE_HOSTS, parseLatestCli, readReleaseVersion, releaseLatest, releaseVersionForLane } from "../../scripts/npm-release-latest.js";

describe("npm release latest tags", () => {
  test.each(["pi", "dsh"])("%s version lookup never reads the other package's manifest", (lane) => {
    const calls = [];
    const version = readReleaseVersion(lane, (url) => {
      calls.push(url.pathname);
      if (lane === "pi" && !url.pathname.endsWith("/dsh/bundle.json")) return '{"version":"1.2.3"}';
      if (lane === "dsh" && url.pathname.endsWith("/dsh/bundle.json")) return '{"dsh_release":{"version":"4.5.6"}}';
      throw new Error("other channel is unavailable");
    });
    expect(version).toBe(lane === "pi" ? "1.2.3" : "4.5.6");
    expect(calls).toHaveLength(1);
  });

  test.each(["pi", "dsh"])("CI %s selection installs and verifies only its own host/package", (lane) => {
    const workflow = Bun.YAML.parse(readFileSync(new URL("../../.github/workflows/npm-publish.yml", import.meta.url), "utf8"));
    for (const [name, expected] of [
      ["Install the selected package's tested host", lane === "pi" ? "npm install --global @earendil-works/pi-coding-agent@0.84.1" : "npm install --global @deepseek-ai/dsh@0.1.2-rc.1"],
      ["Build and verify the selected T6 release", lane === "pi" ? "bun run npm:release:verify" : "bun run dsh:npm:release:verify"],
    ]) {
      const step = workflow.jobs.publish.steps.find((step) => step.name === name);
      // Execute CI's branch selection with recording functions; never install or publish.
      const result = spawnSync("bash", ["-eu"], {
        input: 'npm() { printf "npm %s\\n" "$*"; }; bun() { printf "bun %s\\n" "$*"; };\n' + step.run,
        env: { ...process.env, RELEASE_LANE: lane }, encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(expected);
    }
  });

  test("selects each manifest independently and rejects combined or default lanes", () => {
    expect(releaseVersionForLane({ lane: "pi", piVersion: "0.1.11", dshVersion: "0.1.12" })).toBe("0.1.11");
    expect(releaseVersionForLane({ lane: "dsh", piVersion: "0.1.11", dshVersion: "0.1.12" })).toBe("0.1.12");
    for (const lane of [undefined, "all"]) {
      expect(() => releaseVersionForLane({ lane, piVersion: "0.1.11", dshVersion: "0.1.11" })).toThrow("explicit release lane");
      expect(() => releaseLatest({ lane, version: "0.1.11", run: () => { throw new Error("must not access registry"); } })).toThrow("explicit release lane");
    }
  });

  test("tag mutation needs an explicit lane and version", () => {
    for (const args of [[], ["all"], ["pi"], ["dsh"], ["--version", "0.1.11"], ["dsh", "--check", "--version"], ["pi", "--version", "0.1.11", "--version", "0.1.12"]]) {
      expect(() => parseLatestCli(args)).toThrow();
    }
    expect(parseLatestCli(["dsh", "--check"])).toEqual({ lane: "dsh", version: undefined, checkOnly: true });
    expect(parseLatestCli(["pi", "--version", "0.1.11"])).toEqual({ lane: "pi", version: "0.1.11", checkOnly: false });
  });

  test.each(["pi", "dsh"])("preflights, changes, and verifies only %s", (lane) => {
    const calls = [];
    const result = releaseLatest({ lane, version: "0.1.11", run: (args) => {
      calls.push(args);
      return args[0] === "view" ? JSON.stringify("0.1.11") : "";
    } });
    const name = RELEASE_HOSTS[lane];
    expect(result).toEqual([{ host: lane, packageName: name, version: "0.1.11" }]);
    expect(calls).toEqual([
      ["view", `${name}@0.1.11`, "version", "--json", "--registry", NPM_REGISTRY],
      ["dist-tag", "add", `${name}@0.1.11`, "latest", "--registry", NPM_REGISTRY],
      ["view", name, "dist-tags.latest", "--json", "--registry", NPM_REGISTRY],
    ]);
  });

  test("check mode is read-only and failed publication proof never mutates", () => {
    const calls = [];
    const run = (args) => { calls.push(args); return JSON.stringify("0.1.11"); };
    releaseLatest({ lane: "dsh", version: "0.1.11", checkOnly: true, run });
    expect(calls.every((args) => args[0] === "view")).toBe(true);
    expect(() => releaseLatest({ lane: "pi", version: "0.1.12", run })).toThrow("not the exact published");
    expect(calls.every((args) => args[0] === "view")).toBe(true);
  });

  test("CI requires explicit single-channel inputs and validates again before one publish", () => {
    const workflow = readFileSync(new URL("../../.github/workflows/npm-publish.yml", import.meta.url), "utf8");
    const parsed = Bun.YAML.parse(workflow);
    const inputs = parsed.on.workflow_dispatch.inputs;
    for (const name of ["lane", "version", "base", "confirmation"]) expect(inputs[name].required).toBe(true);
    expect(inputs.lane.options).toEqual(["pi", "dsh"]);
    const steps = parsed.jobs.publish.steps;
    const publishes = steps.filter((step) => step.run?.includes("npm publish "));
    expect(publishes).toHaveLength(1);
    expect(publishes[0].run).toContain('npm publish "$RELEASE_TARBALL" --tag latest');
    const preflights = steps.filter((step) => step.run?.includes("npm:release:preflight"));
    expect(preflights).toHaveLength(2);
    expect(preflights[1].run).toContain('--artifact "$release_directory"');
    expect(preflights.every((step) => step.run.includes('--ref "$GITHUB_REF"'))).toBe(true);
    expect(steps.indexOf(preflights[1])).toBeLessThan(steps.indexOf(publishes[0]));
    expect(steps.at(-1).run).toContain('"$RELEASE_LANE" --version "$RELEASE_VERSION" --check');
  });
});
