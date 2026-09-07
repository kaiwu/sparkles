import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

export const NPM_REGISTRY = "https://registry.npmjs.org/";

export const RELEASE_HOSTS = Object.freeze({
  pi: "@pi-sparkles/pi-sparkles",
  dsh: "@dsh-sparkles/dsh-sparkles",
});

export function releaseVersionForLane({ lane, piVersion, dshVersion }) {
  if (lane === "pi") return piVersion;
  if (lane === "dsh") return dshVersion;
  throw new Error(`explicit release lane required: expected pi or dsh, got ${lane}`);
}

export function readReleaseVersion(lane, read = readFileSync) {
  if (!Object.hasOwn(RELEASE_HOSTS, lane)) {
    throw new Error("explicit release lane required: expected pi or dsh");
  }
  const source = JSON.parse(read(new URL(
    lane === "pi" ? "../package.json" : "../dsh/bundle.json", import.meta.url,
  ), "utf8"));
  return lane === "pi" ? source.version : source.dsh_release.version;
}

function parseNpmScalar(output, label) {
  const text = output.trim();
  if (text === "") throw new Error(`${label} returned an empty response`);

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
    if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === "string") {
      return parsed[0];
    }
  } catch {
    // npm may print a plain scalar when a caller supplies a custom runner.
  }

  return text;
}

export function runNpm(args, { inherit = false } = {}) {
  const result = spawnSync("npm", args, {
    encoding: "utf8",
    env: process.env,
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout]
      .filter(Boolean)
      .map((value) => value.trim())
      .filter(Boolean)
      .join("\n");
    throw new Error(`npm ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }

  return result.stdout ?? "";
}

export function releaseLatest({
  version,
  lane,
  checkOnly = false,
  run = runNpm,
}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid release version: ${version}`);
  }

  if (!Object.hasOwn(RELEASE_HOSTS, lane)) {
    throw new Error("explicit release lane required: expected pi or dsh");
  }
  const selected = [[lane, RELEASE_HOSTS[lane]]];

  // Confirm this lane's exact publication before changing its tag.
  for (const [, packageName] of selected) {
    const published = parseNpmScalar(
      run(["view", `${packageName}@${version}`, "version", "--json", "--registry", NPM_REGISTRY]),
      `${packageName}@${version}`,
    );
    if (published !== version) {
      throw new Error(`${packageName}@${version} is not the exact published registry version`);
    }
  }

  if (!checkOnly) {
    for (const [, packageName] of selected) {
      run(
        ["dist-tag", "add", `${packageName}@${version}`, "latest", "--registry", NPM_REGISTRY],
        { inherit: true },
      );
    }
  }

  const verified = [];
  for (const [host, packageName] of selected) {
    const latest = parseNpmScalar(
      run(["view", packageName, "dist-tags.latest", "--json", "--registry", NPM_REGISTRY]),
      `${packageName} dist-tags.latest`,
    );
    if (latest !== version) {
      throw new Error(`${packageName}@latest resolved to ${latest}, expected ${version}`);
    }
    verified.push({ host, packageName, version: latest });
  }

  return verified;
}

export function parseLatestCli(args) {
  let lane;
  let version;
  let checkOnly = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--version") {
      if (version !== undefined || !args[i + 1] || args[i + 1].startsWith("--")) {
        throw new Error("--version requires one explicit value and cannot be repeated");
      }
      version = args[++i];
    }
    else if (arg === "--check") checkOnly = true;
    else if ((arg === "pi" || arg === "dsh") && !lane) lane = arg;
    else throw new Error(`unknown argument: ${arg}; expected pi or dsh, --version <version>, or --check`);
  }
  if (!lane) throw new Error("explicit release lane required: expected pi or dsh");
  if (!checkOnly && !version) throw new Error("tag mutation requires explicit --version");
  return { lane, checkOnly, version };
}

if (import.meta.main) {
  try {
    const options = parseLatestCli(process.argv.slice(2));
    const verified = releaseLatest({ ...options, version: options.version ?? readReleaseVersion(options.lane) });
    const verb = options.checkOnly ? "Verified" : "Set and verified";
    for (const result of verified) {
      console.log(`${verb} ${result.packageName}@latest -> ${result.version}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
