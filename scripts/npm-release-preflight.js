import { NPM_REGISTRY, RELEASE_HOSTS, readReleaseVersion, runNpm } from "./npm-release-latest.js";

const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function stableParts(version) {
  if (typeof version !== "string" || !STABLE.test(version)) {
    throw new Error(`stable package version required: ${version}`);
  }
  const parts = version.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error("version component exceeds safe integer");
  return parts;
}

function compare(a, b) {
  const left = stableParts(a);
  const right = stableParts(b);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

export function inspectRelease({ lane, localVersion, run = runNpm }) {
  if (!Object.hasOwn(RELEASE_HOSTS, lane)) {
    throw new Error("explicit release lane required: expected pi or dsh");
  }
  const packageName = RELEASE_HOSTS[lane];
  const response = JSON.parse(run([
    "view", packageName, "versions", "dist-tags", "--json", "--registry", NPM_REGISTRY,
    "--prefer-online",
  ]));
  // npm versions can wrap a multi-field response in a one-element array.
  const registry = Array.isArray(response) && response.length === 1 ? response[0] : response;
  if (!registry || Array.isArray(registry)) throw new Error("ambiguous registry history response");
  const versions = registry.versions;
  const tags = registry["dist-tags"];
  if (!Array.isArray(versions) || !versions.every((v) => typeof v === "string") ||
      !tags || typeof tags.latest !== "string" || !versions.includes(tags.latest)) {
    throw new Error("incomplete registry history; cannot establish a release baseline");
  }
  const stable = versions.filter((v) => STABLE.test(v)).sort(compare);
  if (!stable.length) throw new Error("no published stable baseline; initial release needs a separate procedure");
  const publishedBase = stable.at(-1);
  const [major, minor, patch] = stableParts(publishedBase);
  return {
    lane, packageName, localVersion, localVersionPublished: versions.includes(localVersion),
    publishedBase, distTags: tags, versions,
    nextPatch: `${major}.${minor}.${patch + 1}`,
  };
}

export function validateReleaseChoice(evidence, { base, version, reason, ref }) {
  stableParts(version);
  if (!base || base !== evidence.publishedBase) {
    throw new Error(`published baseline must be explicitly ${evidence.publishedBase} for ${evidence.packageName}`);
  }
  if (evidence.versions.includes(version)) throw new Error(`${evidence.packageName}@${version} is already published`);
  if (compare(version, base) <= 0) throw new Error("release version must advance the published baseline");
  if (version !== evidence.nextPatch && !reason?.trim()) {
    throw new Error(`expected next patch ${evidence.nextPatch}; a different version requires an explicit --reason`);
  }
  if (version !== evidence.localVersion) {
    throw new Error(`selected version ${version} differs from ${evidence.lane} source version ${evidence.localVersion}`);
  }
  const expectedRef = `refs/tags/${evidence.lane}-v${version}`;
  if (ref !== undefined && ref !== expectedRef) throw new Error(`release requires ${expectedRef}`);
  return { ...evidence, selectedVersion: version, reason: reason?.trim() || "next patch of this package's published baseline" };
}

export function parsePreflightCli(args) {
  const [lane, ...rest] = args;
  if (!Object.hasOwn(RELEASE_HOSTS, lane)) throw new Error("explicit release lane required: expected pi or dsh");
  const options = { lane };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].replace(/^--/, "");
    if (!["base", "version", "reason", "ref", "artifact"].includes(key) ||
        rest[i] !== `--${key}` || rest[i + 1] === undefined || Object.hasOwn(options, key)) {
      throw new Error(`invalid or repeated preflight option: ${rest[i]}`);
    }
    options[key] = rest[i + 1];
  }
  if (rest.length && (!options.base || !options.version)) {
    throw new Error("preflight requires both --base and --version; lane alone inspects without selecting");
  }
  return options;
}

export function validateArtifactIdentity(summary, evidence, version) {
  if (summary.publishable !== true || summary.name !== evidence.packageName || summary.version !== version) {
    throw new Error("verified tarball maturity or identity differs from the explicit release choice");
  }
  return { tarball: summary.tarball, tarballSha256: summary.tarballSha256 };
}

if (import.meta.main) {
  try {
    const options = parsePreflightCli(process.argv.slice(2));
    const localVersion = readReleaseVersion(options.lane);
    const evidence = inspectRelease({ lane: options.lane, localVersion });
    let result = options.version ? validateReleaseChoice(evidence, options) : evidence;
    if (options.artifact) {
      const module = await import(options.lane === "pi" ? "./npm-package.js" : "./dsh-npm-package.js");
      const verify = options.lane === "pi" ? module.verifyNpmRelease : module.verifyDshNpmRelease;
      const assertPublishable = options.lane === "pi" ? module.assertNpmPublishable : module.assertDshNpmPublishable;
      const summary = verify(options.artifact);
      assertPublishable(summary);
      result = { ...result, ...validateArtifactIdentity(summary, evidence, options.version) };
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
