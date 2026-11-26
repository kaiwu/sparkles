import { durableWatchlistPiSmoke } from "./test-durable-watchlist-pi.js";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildAggregateBundle } from "./aggregate-bundle.js";
import { ROOT } from "./modules.js";
import {
  assertPiHostVersion,
  TESTED_PI_HOST_VERSION,
} from "./pi-durable-dependencies.js";
import { run } from "./process.js";

const args = process.argv.slice(2);
const noBuild = args.includes("--no-build");
const target = "T6";
const unexpected = args.filter((argument) => argument !== "--no-build");
if (unexpected.length > 0) {
  throw new Error(
    `The all-in-one Pi test is fixed to cumulative T1-through-T6; unexpected argument: ${unexpected[0]}`,
  );
}

const piSource = resolve(
  process.env.PI_SOURCE_DIR ?? join(ROOT, "..", "..", "github", "pi-mono"),
);
const piTest = join(piSource, "pi-test.sh");
const installedCommand = process.env.PI_SPARKLES_PI_COMMAND;
const releaseTag = `v${TESTED_PI_HOST_VERSION}`;
const useSourceRuntime =
  installedCommand === undefined &&
  existsSync(piTest) &&
  existsSync(join(piSource, "node_modules")) &&
  Bun.spawnSync(
    ["git", "describe", "--tags", "--exact-match", "--dirty", "--match", releaseTag],
    { cwd: piSource, stdout: "pipe", stderr: "pipe" },
  ).stdout.toString().trim() === releaseTag;
const piCommand = useSourceRuntime ? piTest : (installedCommand ?? Bun.which("pi"));
if (!piCommand) throw new Error("No runnable Pi installation found");

const version = assertPiHostVersion(
  run(piCommand, ["--version"], { cwd: ROOT, quiet: true }).stdout.toString(),
);
const summary = await buildAggregateBundle(target, { build: !noBuild });

console.log(
  `loading ${target} all-in-one aggregate with Pi ${version} from ${piCommand}`,
);
await durableWatchlistPiSmoke(summary.directory, piCommand, useSourceRuntime);
console.log(
  `${target} all-in-one Pi load passed for ${summary.pluginCount} plugins through one entrypoint.`,
);
