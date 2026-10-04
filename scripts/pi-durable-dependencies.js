import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./modules.js";

export const PI_DURABLE_EXTERNALS = ["bun:sqlite"];

export function piDurableDependencies() {
  const root = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const dependencies = {};
  for (const name of [
    "@earendil-works/pi-durable",
    "@earendil-works/chord",
    "@earendil-works/pi-ai",
  ]) {
    const version = root.dependencies?.[name];
    if (!/^\d+\.\d+\.\d+$/.test(version ?? ""))
      throw new Error(`Pi Durable requires an exact runtime version: ${name}`);
    dependencies[name] = version;
  }
  return dependencies;
}
