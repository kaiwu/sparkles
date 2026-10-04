import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ROOT } from "./modules.js";

// This is a scripted host-contract probe over the complete cumulative T6
// entrypoint, without model generation, credentials or a live provider call.
export async function durableWatchlistPiSmoke(
  aggregateDirectory,
  piCommand,
  sourceRuntime = false,
) {
  const lock = JSON.parse(
    await readFile(join(aggregateDirectory, "aggregate-lock.json"), "utf8"),
  );
  if (lock.throughTierId !== "T6" || lock.plugins.length !== 135)
    throw new Error(
      "Durable Pi smoke requires complete cumulative T6 inventory",
    );
  const directory = await mkdtemp(join(tmpdir(), "sparkles-durable-pi-"));
  try {
    const driver = join(directory, "driver.mjs");
    const bridge = resolve(ROOT, "pi_gleam/src/durable_bridge_ffi.mjs");
    await writeFile(
      driver,
      `import { create_invoker } from ${JSON.stringify(bridge)};
import { createHash } from "node:crypto";
let requests = 0;
const body = JSON.stringify({ rc: 0, data: { f43: 130645, f44: 133380, f45: 130350, f46: 132836, f47: 42689, f51: 146120, f52: 119552, f57: "600519", f58: "fixture", f59: 2, f60: 132836, f86: Math.floor(Date.now() / 1000) } });
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.origin !== "https://push2.eastmoney.com" || url.pathname !== "/api/qt/stock/get" || url.searchParams.get("secid") !== "1.600519" || requests !== 0) throw new Error("unexpected durable Pi smoke request");
  requests++;
  return new Response(body, { headers: { "content-type": "application/json" } });
};
export default (api) => {
  const invoke = create_invoker(api);
  const call = async (name, args = {}) => (await invoke(name, args, new AbortController().signal, "durable-pi-smoke")).result;
  api.on("session_start", () => {
    setImmediate(async () => {
      let code = 0;
      try {
        const initial = (await call("watchlist_durable", { action: "status" })).details;
        if (initial.enabled !== false || !initial.optInHint) throw new Error("missing conversational opt-in");
        await call("watchlist_durable", { action: "enable", userAccepted: true });
        await call("watchlist_add", { watchlist: "core", track: "cn", instrumentId: "cninfo:600519", symbol: "600519", mic: "XSHG", tags: [] });
        const handoff = (await call("watchlist_snapshot")).details;
        await call("watchlist_durable_save", { requestId: "save", expectedRevision: 0, snapshotJson: handoff.snapshotJson, snapshotSha256: handoff.snapshotSha256 });
        const review = (await call("watchlist_review_run", { requestId: "review", watchlist: "core", provider: "eastmoney", shareClass: "a_share", maximumRequestsPerReview: 1 })).details.outcome;
        if (review.status !== "completed" || review.result.facts[0].status !== "checked" || review.result.facts[0].lastOrClose !== "1306.45" || review.result.facts[0].sourceReceipt !== createHash("sha256").update(body).digest("hex") || requests !== 1) throw new Error("durable Pi source handoff failed");
        await call("watchlist_durable", { action: "close" });
        await call("watchlist_durable", { action: "enable", userAccepted: true });
        if ((await call("watchlist_durable_snapshot")).details.storeRevision !== 1) throw new Error("durable Pi reopen failed");
        console.log("SPARKLES_DURABLE_PI_PASS");
      } catch (error) { code = 1; console.error(error.message); }
      finally { try { await call("watchlist_durable", { action: "disable" }); } catch {} process.exit(code); }
    });
  });
};
`,
    );
    const process = Bun.spawn(
      [
        piCommand,
        ...(sourceRuntime ? ["--no-env"] : []),
        "--no-extensions",
        "--extension",
        driver,
        "--extension",
        aggregateDirectory,
        "--mode",
        "rpc",
      ],
      {
        cwd: ROOT,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          PATH: globalThis.process.env.PATH,
          HOME: directory,
          PI_CODING_AGENT_DIR: join(directory, "agent"),
          AGENT_CONTACT: "durable-smoke@example.test",
          TERM: "dumb",
        },
      },
    );
    const timer = setTimeout(() => process.kill(), 30000);
    try {
      const [stdout, stderr, code] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited,
      ]);
      if (code !== 0 || !stdout.includes("SPARKLES_DURABLE_PI_PASS"))
        throw new Error(
          `Durable cumulative Pi smoke failed (${code}): ${stderr}\n${stdout}`,
        );
      console.log(
        "T6 installed Pi conversational opt-in, source receipt and durable reopen passed without a model or live network",
      );
    } finally {
      clearTimeout(timer);
      process.stdin.end();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (import.meta.main)
  await durableWatchlistPiSmoke(resolve(process.argv[2]), Bun.which("pi"));
