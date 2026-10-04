import { durableWatchlistPiSmoke } from "./test-durable-watchlist-pi.js";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildAggregateBundle } from "./aggregate-bundle.js";
import { ROOT } from "./modules.js";
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

const summary = await buildAggregateBundle(target, { build: !noBuild });
const piSource = resolve(
  process.env.PI_SOURCE_DIR ?? join(ROOT, "..", "..", "github", "pi-mono"),
);
const piTest = join(piSource, "pi-test.sh");
const sourceTsx = join(piSource, "node_modules", ".bin", "tsx");
const useSourceRuntime = existsSync(piTest) && existsSync(sourceTsx);
const piCommand = useSourceRuntime ? piTest : Bun.which("pi");
if (!piCommand) throw new Error("No runnable Pi installation found");

if (!useSourceRuntime) {
  console.log(
    `Pi source checkout is not hydrated; using installed Pi at ${piCommand}`,
  );
}

console.log(
  `loading ${target} all-in-one aggregate with ${useSourceRuntime ? `Pi from ${piSource}` : "installed Pi"}`,
);
run(
  piCommand,
  [
    ...(useSourceRuntime ? ["--no-env"] : []),
    "--no-extensions",
    "--extension",
    summary.directory,
    "--list-models",
  ],
  { cwd: ROOT, quiet: true },
);
console.log(
  `${target} all-in-one Pi load passed for ${summary.pluginCount} plugins through one entrypoint.`,
);

await durableWatchlistPiSmoke(summary.directory, piCommand, useSourceRuntime);
