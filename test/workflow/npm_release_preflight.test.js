import { describe, expect, test } from "bun:test";
import { inspectRelease, parsePreflightCli, validateArtifactIdentity, validateReleaseChoice } from "../../scripts/npm-release-preflight.js";
import { RELEASE_HOSTS, releaseLatest } from "../../scripts/npm-release-latest.js";

function inspect(lane, localVersion, versions, latest = versions.at(-1)) {
  const calls = [];
  const evidence = inspectRelease({ lane, localVersion, run: (args) => {
    calls.push(args);
    return JSON.stringify({ versions, "dist-tags": { latest } });
  } });
  return { evidence, calls };
}

describe("independent npm release selection", () => {
  test.each(["pi", "dsh"])("publishing and tagging %s leaves the other package's next version unchanged", (lane) => {
    const other = lane === "pi" ? "dsh" : "pi";
    const registry = {
      [RELEASE_HOSTS.pi]: { versions: ["1.2.3"], "dist-tags": { latest: "1.2.3" } },
      [RELEASE_HOSTS.dsh]: { versions: ["4.5.6"], "dist-tags": { latest: "4.5.6" } },
    };
    const calls = [];
    const run = (args) => {
      calls.push(args);
      const spec = args[args[0] === "dist-tag" ? 2 : 1];
      const packageName = Object.values(RELEASE_HOSTS).find((name) => spec === name || spec.startsWith(`${name}@`));
      const record = registry[packageName];
      const version = spec.slice(packageName.length + 1);
      if (args[0] === "dist-tag") { record["dist-tags"].latest = version; return ""; }
      if (args[2] === "version") return JSON.stringify(record.versions.includes(version) ? version : null);
      if (args[2] === "dist-tags.latest") return JSON.stringify(record["dist-tags"].latest);
      return JSON.stringify(record);
    };
    const selectedVersion = lane === "pi" ? "1.2.4" : "4.5.7";
    const inspectOther = () => inspectRelease({ lane: other, localVersion: other === "pi" ? "1.2.4" : "4.5.7", run });
    const before = inspectOther();
    const evidence = inspectRelease({ lane, localVersion: selectedVersion, run });
    validateReleaseChoice(evidence, { base: registry[RELEASE_HOSTS[lane]]["dist-tags"].latest, version: selectedVersion });
    // Model the exact publication; tag mutations use the actual release helper.
    registry[RELEASE_HOSTS[lane]].versions.push(selectedVersion);
    calls.length = 0;
    releaseLatest({ lane, version: selectedVersion, run });
    expect(calls.every((args) => args[args[0] === "dist-tag" ? 2 : 1].startsWith(RELEASE_HOSTS[lane]))).toBe(true);
    expect(inspectOther()).toEqual(before);
    expect(inspectRelease({ lane, localVersion: selectedVersion, run }).publishedBase).toBe(selectedVersion);
  });

  test.each(["pi", "dsh"])("%s artifact cannot be substituted with another channel, version, or preview", (lane) => {
    const { evidence } = inspect(lane, "0.1.11", ["0.1.10"]);
    const summary = { name: evidence.packageName, version: "0.1.11", publishable: true, tarball: "/tmp/reviewed.tgz", tarballSha256: "checksum" };
    expect(validateArtifactIdentity(summary, evidence, "0.1.11").tarball).toBe(summary.tarball);
    for (const changed of [{ name: "@other/package" }, { version: "0.1.12" }, { publishable: false }]) {
      expect(() => validateArtifactIdentity({ ...summary, ...changed }, evidence, "0.1.11")).toThrow("tarball maturity or identity");
    }
  });

  test("a local DSH 0.1.11 candidate is not a publication or reason to skip it", () => {
    const { evidence, calls } = inspect("dsh", "0.1.11", ["0.1.9", "0.1.10"]);
    expect(evidence.localVersionPublished).toBe(false);
    expect(evidence.nextPatch).toBe("0.1.11");
    expect(validateReleaseChoice(evidence, { base: "0.1.10", version: "0.1.11" }).selectedVersion).toBe("0.1.11");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe("@dsh-sparkles/dsh-sparkles");
    const skipped = { ...evidence, localVersion: "0.1.12" };
    expect(() => validateReleaseChoice(skipped, { base: "0.1.10", version: "0.1.12" })).toThrow("expected next patch 0.1.11");
  });

  test.each(["pi", "dsh"])("%s independently validates its baseline, source version, and channel tag", (lane) => {
    const { evidence } = inspect(lane, "0.1.11", ["0.1.10"]);
    expect(validateReleaseChoice(evidence, { base: "0.1.10", version: "0.1.11", ref: `refs/tags/${lane}-v0.1.11` }).lane).toBe(lane);
    expect(() => validateReleaseChoice(evidence, { base: "0.1.9", version: "0.1.11" })).toThrow("published baseline");
    expect(() => validateReleaseChoice(evidence, { base: "0.1.10", version: "0.1.11", ref: "refs/tags/v0.1.11" })).toThrow("release requires");
    expect(() => validateReleaseChoice(evidence, { base: "0.1.10", version: "0.1.11", ref: `refs/tags/${lane === "pi" ? "dsh" : "pi"}-v0.1.11` })).toThrow("release requires");
    expect(() => validateReleaseChoice({ ...evidence, localVersion: "0.1.12" }, { base: "0.1.10", version: "0.1.11" })).toThrow("differs from");
  });

  test("published 0.1.12 stays immutable; an old latest tag and the 0.1.11 gap do not permit backfill", () => {
    const { evidence } = inspect("dsh", "0.1.12", ["0.1.12", "0.1.9", "0.1.10"], "0.1.10");
    expect(evidence.publishedBase).toBe("0.1.12");
    expect(() => validateReleaseChoice(evidence, { base: "0.1.12", version: "0.1.12" })).toThrow("already published");
    expect(() => validateReleaseChoice(evidence, { base: "0.1.12", version: "0.1.11", reason: "fill gap" })).toThrow("must advance");
  });

  test("an explicit minor/major or skipped-patch choice needs a recorded reason", () => {
    const { evidence } = inspect("pi", "0.2.0", ["0.1.11"]);
    expect(() => validateReleaseChoice(evidence, { base: "0.1.11", version: "0.2.0", reason: " " })).toThrow("explicit --reason");
    expect(validateReleaseChoice(evidence, { base: "0.1.11", version: "0.2.0", reason: "Reviewed API expansion" }).reason).toBe("Reviewed API expansion");
  });

  test("registry failure and incomplete evidence fail closed", () => {
    expect(() => inspectRelease({ lane: "dsh", localVersion: "0.1.11", run: () => { throw new Error("offline"); } })).toThrow("offline");
    for (const response of ["{}", "not json", '{"versions":["0.1.10"],"dist-tags":{"latest":"0.1.11"}}']) {
      expect(() => inspectRelease({ lane: "pi", localVersion: "0.1.11", run: () => response })).toThrow();
    }
  });

  test("accepts npm's single-result array, rejects multiple package records", () => {
    const record = { versions: ["0.1.10"], "dist-tags": { latest: "0.1.10" } };
    expect(inspectRelease({ lane: "dsh", localVersion: "0.1.11", run: () => JSON.stringify([record]) }).publishedBase).toBe("0.1.10");
    expect(() => inspectRelease({ lane: "dsh", localVersion: "0.1.11", run: () => JSON.stringify([record, record]) })).toThrow("ambiguous");
  });

  test("inspection selects no version; preflight requires explicit complete inputs", () => {
    expect(parsePreflightCli(["dsh"])).toEqual({ lane: "dsh" });
    for (const args of [[], ["all"], ["dsh", "--version", "0.1.11"], ["pi", "--base", "0.1.10"], ["dsh", "--artifact", "dist"]]) {
      expect(() => parsePreflightCli(args)).toThrow();
    }
    expect(parsePreflightCli(["dsh", "--base", "0.1.10", "--version", "0.1.11"])).toEqual({ lane: "dsh", base: "0.1.10", version: "0.1.11" });
  });
});
