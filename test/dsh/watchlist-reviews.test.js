import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as laws from "../../plugins/watchlist/build/dev/javascript/pi_sparkles_watchlist/pi_sparkles_watchlist/durable.mjs";
import { extension } from "../../plugins/watchlist/build/dev/javascript/pi_sparkles_watchlist/pi_sparkles_watchlist.mjs";
import { createReviewRunner, reviewProjection, REVIEW_EVENT } from "../../dsh/watchlist-reviews.mjs";
import { acquireReviewLease } from "../../dsh/store-lease.mjs";

const clone = structuredClone;
const HOUR = 3_600_000;
const DATE = Date.UTC(2026, 9, 18);

export async function snapshot(picks = [["cn", "600000", "XSHG"], ["hk", "00700", "XHKG"], ["us", "AAPL", "XNAS"]]) {
  const tools = new Map();
  const handlers = new Map(), entries = [];
  await extension({ registerTool: (tool) => tools.set(tool.name, tool), registerCommand() {},
    on: (name, handler) => handlers.set(name, handler),
    appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }) });
  await handlers.get("session_start")({ reason: "startup" }, { sessionManager: { getBranch: () => entries }, hasUI: false });
  for (const [track, symbol, mic] of picks) await tools.get("watchlist_add").execute("add", {
    watchlist: "core", track, symbol, mic, instrumentId: `caller:${symbol}`, tags: [],
  }, new AbortController().signal, undefined, {});
  return (await tools.get("watchlist_snapshot").execute("snapshot", {}, new AbortController().signal, undefined, {})).details;
}

export function quote(args, price = "10.00") {
  return { isError: false, value: { content: [], details: {
    schema: "pi-sparkles/cn-stock-quote-result", schemaVersion: 1, track: "cn",
    selectedProvider: "eastmoney", fallbackPerformed: false,
    listing: { code: args.code, venueMic: args.venue === "sse" ? "XSHG" : "XSHE", shareClass: "a_share" },
    asOfDate: args.asOfDate, prices: { lastOrClose: price, currency: "CNY" },
    source: { provider: "eastmoney", entitlement: "fixture", redistribution: "fixture_private" },
    acquisitionReceipt: { contentSha256: "a".repeat(64) }, retrievedAtUnixMilliseconds: DATE,
    providerTimestamp: "fixture", freshness: "unknown",
  } } };
}

function fixture({ rows = new Map(), invoke, resolveAgent, fault } = {}) {
  let time = DATE;
  let writes = 0;
  const calls = [];
  const published = [];
  const timers = new Map();
  let timerId = 0;
  const table = {
    get: (id) => clone(rows.get(id)),
    entries: () => [...rows.entries()].map(([id, row]) => [id, clone(row)]),
    async put(id, row) {
      writes += 1;
      if (fault?.(row, writes)) throw new Error("scripted storage failure");
      rows.set(id, clone(row));
    },
  };
  const runner = createReviewRunner({
    table, laws, now: () => time,
    setTimer(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimer: (id) => timers.delete(id),
    resolveAgent: resolveAgent ?? (async (id) => ({ id, session: { id } })),
    async invoke(agent, name, args, signal, callId) {
      calls.push({ owner: agent.session.id, name, args, callId });
      return invoke ? invoke(agent, name, args, signal, callId) : quote(args);
    },
    publish: (id, view) => { published.push({ id, view: clone(view) }); },
  });
  runner.initialize();
  return {
    runner, rows, calls, timers, published,
    clock: (value) => { time = value; },
    call: (op, input = {}, owner = "one", signal) => runner.operation(owner, op, input, signal),
  };
}

async function save(f, owner = "one", picks) {
  await f.call("control", { action: "enable", userAccepted: true }, owner);
  const handoff = await snapshot(picks);
  await f.call("save", { requestId: "save", expectedRevision: 0, snapshotJson: handoff.snapshotJson, snapshotSha256: handoff.snapshotSha256 }, owner);
  return handoff;
}
const request = (overrides = {}) => ({ requestId: "review", watchlist: "core", provider: "eastmoney", shareClass: "a_share",
  maximumRequestsPerReview: 1, firstDueUnixMilliseconds: DATE, intervalMilliseconds: HOUR, maximumReviews: 2, ...overrides });

describe("DSH durable pick review interpreter", () => {
  test("status is inert; opt-in, revision, hash and request identities fail closed", async () => {
    const f = fixture();
    expect((await f.call("status")).enabled).toBe(false);
    expect(f.rows.size).toBe(0);
    await expect(f.call("control", { action: "enable" })).rejects.toThrow("acceptance");
    await save(f);
    await expect(f.call("save", { requestId: "save", expectedRevision: 1 })).rejects.toThrow("conflict");
    const handoff = await snapshot();
    await expect(f.call("save", { requestId: "bad", expectedRevision: 1, snapshotJson: handoff.snapshotJson, snapshotSha256: "b".repeat(64) })).rejects.toThrow("hash");
    await expect(f.call("save", { requestId: "stale", expectedRevision: 0, snapshotJson: handoff.snapshotJson, snapshotSha256: handoff.snapshotSha256 })).rejects.toThrow("revision_conflict");
    expect(f.calls).toHaveLength(0);
    await f.runner.close();
  });

  test("mixed-track role journey pins picks, compares exact receipts, skips downtime and ends at its count", async () => {
    let price = "10.00";
    const f = fixture({ invoke: async (_agent, _name, args) => quote(args, price) });
    const handoff = await save(f);
    const admitted = await f.call("schedule", request());
    expect(await f.call("schedule", request())).toEqual(admitted);
    await f.runner.drain();
    let status = await f.call("status");
    expect(status.jobs[0].completedReviews).toBe(1);
    expect(status.jobs[0].latest.facts.map((fact) => fact.status)).toEqual(["checked", "track_partial", "track_partial"]);
    expect(f.calls).toHaveLength(1);
    const changed = await snapshot([["cn", "600519", "XSHG"]]);
    await f.call("save", { requestId: "save-again", expectedRevision: 1, snapshotJson: changed.snapshotJson, snapshotSha256: changed.snapshotSha256 });
    price = "10.50";
    f.clock(DATE + 5 * HOUR);
    await f.runner.drain();
    status = await f.call("status", { requestId: "review" });
    expect(status.jobs[0].status).toBe("completed");
    expect(status.jobs[0].snapshotSha256).toBe(handoff.snapshotSha256);
    expect(status.jobs[0].latest.facts[0].change).toBe("price_changed");
    expect(status.jobs[0].latest.missedIntervals).toBe(4);
    expect(status.receipts).toHaveLength(2);
    expect(f.calls.map((call) => call.args.code)).toEqual(["600000", "600000"]);
    f.clock(DATE + 30 * HOUR); await f.runner.drain();
    expect(f.calls).toHaveLength(2);
    await f.runner.close();
  });

  test("sessions cannot read, cancel or overwrite another owner's jobs and picks", async () => {
    const f = fixture(); await save(f);
    await f.call("schedule", request({ firstDueUnixMilliseconds: DATE + HOUR }));
    expect((await f.call("snapshot", {}, "two")).saved).toBeNull();
    expect((await f.call("status", {}, "two")).jobs).toEqual([]);
    await expect(f.call("cancel", { requestId: "review" }, "two")).rejects.toThrow("not_found");
    await save(f, "two");
    await f.call("run", request({ requestId: "second" }), "two");
    expect(f.calls.map((call) => call.owner)).toEqual(["two"]);
    expect((await f.call("status")).jobs[0].completedReviews).toBe(0);
    await f.runner.close();
  });

  test("restart reuses an obtained outcome and never repeats an interrupted attempt", async () => {
    for (const checkpoint of ["obtained", "attempting"]) {
      const f = fixture({ fault: (row) => {
        const job = row.jobs[0];
        return checkpoint === "obtained"
          ? job?.index === 1
          : job?.outcomes[0]?.state === "obtained";
      } });
      await save(f);
      await f.call("schedule", request({ maximumReviews: 1 }));
      await f.runner.drain();
      expect((await f.call("status")).runnerError).toContain("checkpoint_failed");
      expect(f.calls).toHaveLength(1);
      const retained = new Map(JSON.parse(JSON.stringify([...f.rows])));
      await f.runner.close();
      const restored = fixture({ rows: retained });
      await restored.runner.drain();
      const receipt = (await restored.call("status")).jobs[0].latest;
      expect(restored.calls).toHaveLength(0);
      expect(receipt.facts[0].status).toBe(checkpoint === "obtained" ? "checked" : "cannot_check");
      if (checkpoint === "attempting") expect(receipt.facts[0].change).toBe("unknown");
      expect((await restored.call("status")).jobs[0].status).toBe("completed");
      await restored.runner.close();
    }
  });

  test("failure, policy denial, wrong-scope and oversized source values remain unknown without fallback", async () => {
    for (const mode of ["throw", "denied", "wrong", "oversized"]) {
      const f = fixture({ invoke: async (_agent, _name, args) => {
        if (mode === "throw") throw new Error("private provider diagnostic");
        if (mode === "denied") return { isError: true, error: { code: "DENIED" } };
        const value = quote(args);
        if (mode === "wrong") value.value.details.listing.code = "600519";
        if (mode === "oversized") value.value.content = [{ type: "text", text: "x".repeat(33000) }];
        return value;
      } });
      await save(f); await f.call("run", request());
      const fact = (await f.call("status")).jobs[0].latest.facts[0];
      expect(fact.status).toBe("cannot_check"); expect(fact.change).toBe("unknown");
      expect(f.calls).toHaveLength(1);
      expect(JSON.stringify([...f.rows])).not.toContain("private provider diagnostic");
      await f.runner.close();
    }
  });

  test("cancel aborts owned acquisition and remains terminal after reopen", async () => {
    const entered = Promise.withResolvers();
    const f = fixture({ invoke: async (_agent, _name, _args, signal) => {
      entered.resolve();
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    } });
    await save(f); await f.call("schedule", request());
    const running = f.runner.drain(); await entered.promise;
    await f.call("cancel", { requestId: "review" }); await running;
    expect((await f.call("status")).jobs[0].status).toBe("cancelled");
    await f.runner.close();
    const restored = fixture({ rows: f.rows }); await restored.runner.drain();
    expect(restored.calls).toHaveLength(0);
    expect((await restored.call("status")).jobs[0].status).toBe("cancelled");
    await restored.runner.close();
  });

  test("pause and disable stop timers; explicit reenable restores saved picks", async () => {
    const f = fixture(); await save(f);
    await f.call("schedule", request());
    await f.call("control", { action: "disable" });
    await f.runner.drain(); expect(f.calls).toHaveLength(0); expect(f.timers.size).toBe(0);
    expect((await f.call("snapshot")).saved).not.toBeNull();
    await f.call("control", { action: "enable", userAccepted: true }); await f.runner.drain();
    expect(f.calls).toHaveLength(1);
    await f.call("control", { action: "close" }); expect(f.timers.size).toBe(0);
    await f.runner.close();
  });

  test("caller cancellation aborts a one-off source and persists cancellation", async () => {
    const entered = Promise.withResolvers();
    const f = fixture({ invoke: async (_agent, _name, _args, signal) => {
      entered.resolve();
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    } });
    await save(f);
    const control = new AbortController();
    const running = f.call("run", request(), "one", control.signal);
    await entered.promise;
    control.abort(new Error("caller stopped review"));
    await expect(running).rejects.toThrow("caller stopped review");
    expect((await f.call("status")).jobs[0].status).toBe("cancelled");
    await f.runner.close();
  });

  test("a retained full receipt is content-bound and corrupted history rejects reopen", async () => {
    const f = fixture(); await save(f); await f.call("run", request());
    const full = (await f.call("status", { requestId: "review", cycleIndex: 0 })).receipt;
    expect(full.sourceOutcomes[0].result.details.prices.lastOrClose).toBe("10.00");
    expect((await f.call("status", { requestId: "review" })).receipts[0].sourceOutcomes).toBeUndefined();
    const row = f.rows.get("one");
    row.jobs[0].receipts[0].facts[0].lastOrClose = "9000.00";
    expect(() => fixture({ rows: f.rows })).toThrow("invalid_stored_review");
    await f.runner.close();
  });

  test("exclusive writer lease rejects competitors and releases on close", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sparkles-review-lease-"));
    let first, reopened;
    try {
      first = await acquireReviewLease(directory);
      await expect(acquireReviewLease(directory)).rejects.toThrow("writer_unavailable");
      expect(statSync(join(directory, "owner.sqlite")).mode & 0o077).toBe(0);
      first.close(); first = null;
      reopened = await acquireReviewLease(directory);
    } finally {
      first?.close(); reopened?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("invalid persisted identity fails startup, projection accepts only versioned owned records", async () => {
    const f = fixture(); await save(f);
    const row = f.rows.get("one"); row.ownerSessionId = "two";
    expect(() => fixture({ rows: f.rows })).toThrow("owner_mismatch");
    row.ownerSessionId = "one";
    const projection = reviewProjection();
    const initial = projection.init({ id: "one" });
    expect(projection.apply(initial, { type: REVIEW_EVENT, data: {} })).toBe(initial);
    const view = (await f.call("status")); delete view.runnerError;
    expect(projection.wire.view(projection.apply(initial, { type: REVIEW_EVENT, ignorable: true, data: view }))).toEqual(view);
    const fork = projection.init({ id: "fork" });
    expect(projection.apply(fork, { type: REVIEW_EVENT, ignorable: true, data: view })).toBe(fork);
    await f.runner.close();
  });
});
