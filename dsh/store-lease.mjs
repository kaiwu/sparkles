// Generic exclusive writer lease, released by the OS even after SIGKILL.
import { chmod, lstat, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";

export async function acquireReviewLease(directory) {
  const configuredHome = process.env.DSH_HOME?.trim();
  const home = configuredHome === "~" ? homedir()
    : configuredHome?.startsWith("~/") ? join(homedir(), configuredHome.slice(2))
    : configuredHome ? resolve(configuredHome) : join(homedir(), ".dsh");
  const path = directory ?? join(home, "sparkles_reviews");
  if (!isAbsolute(path) || normalize(path) !== path) throw new Error("watchlist_lease_requires_absolute_directory");
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("unsafe_watchlist_lease_directory");
  const file = join(path, "owner.sqlite");
  let database;
  try {
    try { if ((await lstat(file)).isSymbolicLink()) throw new Error("unsafe_lease"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (globalThis.Bun) {
      const { Database } = await import("bun:sqlite");
      database = new Database(file, { create: true });
    } else {
      const { DatabaseSync } = await import("node:sqlite");
      database = new DatabaseSync(file);
    }
    database.exec("PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS owner (id INTEGER); BEGIN EXCLUSIVE;");
    await chmod(file, 0o600);
    return database;
  } catch {
    database?.close();
    throw new Error("watchlist_store_writer_unavailable");
  }
}
