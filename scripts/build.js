import { piDurableDependencies } from "./pi-durable-dependencies.js";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { DIST_DIR, WORK_DIR, requirePlugins } from "./modules.js";
import { run } from "./process.js";

export const HOST_EXTERNALS = [
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/*",
  "@earendil-works/pi-tui",
  "@earendil-works/pi-durable",
  "@earendil-works/pi-durable/*",
  "@earendil-works/chord/*",
  "bun:sqlite",
  "pdfjs-dist",
  "pdfjs-dist/*",
  "typebox",
  "typebox/*",
];

function moduleSpecifier(fromDirectory, target) {
  const path = relative(fromDirectory, target).split(sep).join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

export async function buildPlugin(plugin) {
  console.log(`building ${plugin.shortName} (${plugin.name} ${plugin.version})`);
  run(
    "gleam",
    ["build", "--target", "javascript", "--warnings-as-errors"],
    { cwd: plugin.directory },
  );

  const compiledEntry = join(
    plugin.directory,
    "build",
    "dev",
    "javascript",
    plugin.name,
    `${plugin.name}${plugin.shortName === "watchlist" ? "_pi" : ""}.mjs`,
  );
  const adapter = join(WORK_DIR, "adapters", `${plugin.shortName}.mjs`);
  mkdirSync(dirname(adapter), { recursive: true });
  writeFileSync(
    adapter,
    `import { extension } from ${JSON.stringify(moduleSpecifier(dirname(adapter), compiledEntry))};\nexport default extension;\n`,
  );

  const outputDirectory = join(DIST_DIR, plugin.shortName);
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });

  const external = plugin.shortName === "watchlist" ? HOST_EXTERNALS.filter((name) =>
    !name.startsWith("@earendil-works/pi-durable") && !name.startsWith("@earendil-works/chord") &&
    !name.startsWith("@earendil-works/pi-ai") && !name.startsWith("typebox")) : HOST_EXTERNALS;
  const result = await Bun.build({
    entrypoints: [adapter],
    outdir: outputDirectory,
    naming: "index.js",
    format: "esm",
    target: "node",
    minify: false,
    sourcemap: "external",
    metafile: true,
    external,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Bun bundle failed for ${plugin.shortName}`);
  }

  const packageManifest = {
    name: plugin.name,
    version: plugin.version,
    private: true,
    type: "module",
    pi: { extensions: ["./index.js"] },
  };
  writeFileSync(
    join(outputDirectory, "package.json"),
    `${JSON.stringify(packageManifest, null, 2)}\n`,
  );
  writeFileSync(
    join(outputDirectory, "build.json"),
    `${JSON.stringify(
      {
        plugin: plugin.name,
        version: plugin.version,
        pi: plugin.metadata.metadata?.pi ?? {},
        external,
        ...(plugin.shortName === "watchlist" ? { bundledPiDurable: piDurableDependencies() } : {}),
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(outputDirectory, "metafile.json"),
    `${JSON.stringify(result.metafile, null, 2)}\n`,
  );

  const source = readFileSync(join(outputDirectory, "index.js"), "utf8");
  if (!source.includes("export")) {
    throw new Error(`Bundle does not contain an export: ${plugin.shortName}`);
  }
  console.log(`  dist/${plugin.shortName}/index.js`);
}

export async function buildPlugins(selected) {
  for (const plugin of selected) await buildPlugin(plugin);
}

export async function build(filter) {
  await buildPlugins(requirePlugins(filter));
}

if (import.meta.main) {
  await build(process.argv[2]);
}
