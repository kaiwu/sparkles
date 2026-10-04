import extension from "../../../dist/watchlist/index.js";
import { remember_tool } from "../../../pi_gleam/src/durable_bridge_ffi.mjs";
const [mode, directory] = process.argv.slice(2);
const tools = new Map(),
  handlers = new Map(),
  entries = [];
const api = {
  events: {},
  registerCommand() {},
  registerTool(t) {
    tools.set(t.name, t);
  },
  on(name, handler) {
    const prior = handlers.get(name);
    handlers.set(
      name,
      prior
        ? async (...args) => {
            await prior(...args);
            return handler(...args);
          }
        : handler,
    );
  },
  appendEntry(customType, data) {
    entries.push({ type: "custom", customType, data });
  },
};
await extension(api);
await handlers.get("session_start")(
  { type: "session_start", reason: "startup" },
  { hasUI: false, ui: {}, sessionManager: { getBranch: () => entries } },
);
const call = async (name, input = {}) =>
  tools
    .get(name)
    .execute(name, input, new AbortController().signal, undefined, {
      hasUI: false,
      ui: {},
    });
remember_tool(api, {
  name: "cn_stock_quote",
  execute: async (_id, args, signal) => {
    console.log(`SOURCE:${args.code}`);
    if (mode === "crash" && args.code === "600519") {
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        }),
      );
    }
    return {
      content: [],
      details: {
        schema: "pi-sparkles/cn-stock-quote-result",
        schemaVersion: 1,
        track: "cn",
        selectedProvider: "eastmoney",
        fallbackPerformed: false,
        listing: {
          code: args.code,
          venueMic: args.venue === "sse" ? "XSHG" : "XSHE",
          shareClass: "a_share",
        },
        asOfDate: args.asOfDate,
        prices: { lastOrClose: "10.00", currency: "CNY" },
        source: {
          provider: "eastmoney",
          entitlement: "fixture",
          redistribution: "fixture_private",
        },
        acquisitionReceipt: { contentSha256: "a".repeat(64) },
        retrievedAtUnixMilliseconds: Date.now(),
        providerTimestamp: "fixture",
        freshness: "unknown",
      },
    };
  },
});
try {
  if (mode !== "default-discover")
    await call("watchlist_durable", {
      action: "enable",
      userAccepted: true,
      ...(directory ? { directory } : {}),
    });
  if (mode === "crash") {
    for (const [symbol, mic] of [
      ["600000", "XSHG"],
      ["600519", "XSHG"],
    ])
      await call("watchlist_add", {
        watchlist: "core",
        track: "cn",
        symbol,
        mic,
        instrumentId: `cninfo:${symbol}`,
        tags: [],
      });
    const saved = (await call("watchlist_snapshot")).details;
    await call("watchlist_durable_save", {
      requestId: "save",
      expectedRevision: 0,
      snapshotJson: saved.snapshotJson,
      snapshotSha256: saved.snapshotSha256,
    });
    await call("watchlist_review_schedule", {
      requestId: "crash-review",
      watchlist: "core",
      provider: "eastmoney",
      shareClass: "a_share",
      maximumRequestsPerReview: 2,
      firstDueUnixMilliseconds: Date.now(),
      intervalMilliseconds: 3600000,
      maximumReviews: 1,
    });
    await new Promise(() => {});
  } else if (mode === "resume") {
    for (let attempt = 0; attempt < 100; attempt++) {
      const jobs = (await call("watchlist_review_status")).details.jobs;
      if (jobs[0]?.taskState.status === "terminal") {
        console.log(`RESULT:${JSON.stringify(jobs[0])}`);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  } else if (mode === "default-enable") {
    console.log(
      `RESULT:${JSON.stringify((await call("watchlist_durable", { action: "status" })).details)}`,
    );
  } else if (mode === "default-discover") {
    console.log(
      `RESULT:${JSON.stringify((await call("watchlist_durable", { action: "status" })).details)}`,
    );
  }
} finally {
  await call("watchlist_durable", { action: "close" });
}
