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
  if (lane !== "all") {
    throw new Error(`unknown release lane: ${lane}; expected pi, dsh, or all`);
  }
  if (piVersion !== dshVersion) {
    throw new Error(
      `coordinated release requires matching Pi and DSH versions, got ${piVersion} and ${dshVersion}`,
    );
  }
  return piVersion;
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

function runNpm(args, { inherit = false } = {}) {
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
  lane = "all",
  checkOnly = false,
  run = runNpm,
}) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`invalid release version: ${version}`);
  }

  const selected =
    lane === "all"
      ? Object.entries(RELEASE_HOSTS)
      : RELEASE_HOSTS[lane]
        ? [[lane, RELEASE_HOSTS[lane]]]
        : null;
  if (!selected) throw new Error(`unknown release lane: ${lane}; expected pi, dsh, or all`);

  // Preflight every selected host before changing any tag so a coordinated
  // release cannot start when one exact package version is absent.
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

function parseCli(args) {
  let lane = "all";
  let checkOnly = false;
  for (const arg of args) {
    if (arg === "--check") checkOnly = true;
    else if (arg === "pi" || arg === "dsh" || arg === "all") lane = arg;
    else throw new Error(`unknown argument: ${arg}; expected pi, dsh, all, or --check`);
  }
  return { lane, checkOnly };
}

if (import.meta.main) {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    const dshManifest = JSON.parse(
      readFileSync(new URL("../dsh/bundle.json", import.meta.url), "utf8"),
    );
    const options = parseCli(process.argv.slice(2));
    const version = releaseVersionForLane({
      lane: options.lane,
      piVersion: manifest.version,
      dshVersion: dshManifest.dsh_release?.version,
    });
    const verified = releaseLatest({ version, ...options });
    const verb = options.checkOnly ? "Verified" : "Set and verified";
    for (const result of verified) {
      console.log(`${verb} ${result.packageName}@latest -> ${result.version}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
