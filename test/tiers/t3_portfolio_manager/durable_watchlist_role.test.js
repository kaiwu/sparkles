import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const digest = (text) => createHash("sha256").update(text).digest("hex");
const member = (track = "cn") => ({
  watchlist: "core",
  track,
  instrumentId:
    track === "cn"
      ? "cninfo:600519"
      : track === "hk"
        ? "hkex:00700"
        : "figi:BBG000B9XRY4",
  symbol: track === "cn" ? "600519" : track === "hk" ? "00700" : "AAPL",
  mic: track === "cn" ? "XSHG" : track === "hk" ? "XHKG" : "XNAS",
  tags: [],
});
const review = (requestId = "review") => ({
  requestId,
  watchlist: "core",
  provider: "eastmoney",
  shareClass: "a_share",
  maximumRequestsPerReview: 1,
});

async function harness() {
  const tools = new Map(),
    handlers = new Map(),
    entries = [],
    bus = new Map();
  const eventFacade = () => ({
    on(channel, callback) {
      const callbacks = bus.get(channel) ?? [];
      callbacks.push(callback);
      bus.set(channel, callbacks);
      return () => {};
    },
    emit(channel, data) {
      for (const callback of bus.get(channel) ?? []) callback(data);
    },
  });
  const api = {
    events: {},
    registerCommand() {},
    registerTool(tool) {
      if (tools.has(tool.name)) throw new Error("duplicate tool");
      tools.set(tool.name, tool);
    },
    on(event, handler) {
      const previous = handlers.get(event);
      handlers.set(
        event,
        previous
          ? async (...args) => {
              await previous(...args);
              return handler(...args);
            }
          : handler,
      );
    },
    appendEntry(customType, data) {
      entries.push({ type: "custom", customType, data });
    },
  };
  const load = async (name) =>
    (
      await import(
        `${resolve(import.meta.dir, `../../../dist/${name}/index.js`)}?durable=${Math.random()}`
      )
    ).default({ ...api, events: eventFacade() });
  await load("watchlist");
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
  cleanups.push(() => call("watchlist_durable", { action: "close" }));
  return { api, tools, handlers, entries, load, call };
}
async function directory() {
  const parent = await mkdtemp(join(tmpdir(), "sparkles-durable-role-"));
  cleanups.unshift(() => rm(parent, { recursive: true, force: true }));
  return join(parent, "store");
}
async function enable(instance, path) {
  return instance.call("watchlist_durable", {
    action: "enable",
    userAccepted: true,
    directory: path,
  });
}
async function save(instance, requestId = "save", expectedRevision = 0) {
  const snapshot = (await instance.call("watchlist_snapshot")).details;
  expect(snapshot.snapshotSha256).toBe(digest(snapshot.snapshotJson));
  const input = {
    requestId,
    expectedRevision,
    snapshotJson: snapshot.snapshotJson,
    snapshotSha256: snapshot.snapshotSha256,
  };
  return {
    input,
    result: await instance.call("watchlist_durable_save", input),
  };
}

describe("Pi Durable personal watchlist role", () => {
  test("offers conversational opt-in without storing or polling, and rejects unaccepted enabling", async () => {
    const instance = await harness();
    const path = await directory();
    const status = (
      await instance.call("watchlist_durable", { action: "status" })
    ).details;
    expect(status.enabled).toBe(false);
    expect(status.optInHint).toContain("Shall I remember these picks");
    expect(instance.tools.get("watchlist_durable").promptSnippet).toContain(
      "Wait for acceptance",
    );
    expect(
      (await instance.call("watchlist_review_run", review())).details,
    ).toMatchObject({ operationPerformed: false, status: "opt_in_required" });
    await expect(
      instance.call("watchlist_durable", { action: "enable", directory: path }),
    ).rejects.toThrow("requires_user_acceptance");
    await expect(stat(path)).rejects.toThrow();
  });

  test("saves exact mixed-track picks with hash/CAS/deduplication, survives new chats, and excludes credentials", async () => {
    const path = await directory();
    const first = await harness();
    await enable(first, path);
    for (const track of ["cn", "hk", "us"])
      await first.call("watchlist_add", member(track));
    const { input } = await save(first);
    expect(
      (await first.call("watchlist_durable_save", { ...input })).details
        .storeRevision,
    ).toBe(1);
    await expect(
      first.call("watchlist_durable_save", { ...input, expectedRevision: 1 }),
    ).rejects.toThrow("request_id_conflict");
    await expect(
      first.call("watchlist_durable_save", { ...input, requestId: "stale" }),
    ).rejects.toThrow("revision_conflict");
    await expect(
      first.call("watchlist_durable_save", {
        ...input,
        requestId: "corrupt",
        expectedRevision: 1,
        snapshotSha256: "a".repeat(64),
      }),
    ).rejects.toThrow("content_hash_mismatch");
    await first.call("watchlist_durable", { action: "close" });
    const second = await harness();
    await enable(second, path);
    const restored = (await second.call("watchlist_durable_snapshot")).details;
    expect(restored.storeRevision).toBe(1);
    expect(restored.saved).toEqual({
      snapshotJson: input.snapshotJson,
      snapshotSha256: input.snapshotSha256,
    });
    expect(
      (await second.call("watchlist_snapshot")).details.watchlists,
    ).toEqual([]);
    for (const file of await readdir(path)) {
      expect((await stat(join(path, file))).mode & 0o077).toBe(0);
      if (file.endsWith("jsonl"))
        expect(await readFile(join(path, file), "utf8")).not.toContain(
          "AGENT_CONTACT",
        );
    }
    expect(
      (await second.call("watchlist_durable", { action: "disable" })).details
        .savedDataRetained,
    ).toBe(true);
    expect(
      JSON.parse(await readFile(join(path, "sparkles-store.json"), "utf8"))
        .optIn,
    ).toBe(false);
  });

  test("composes the existing source tool and receipt, preserves partial tracks, and skips refetch on duplicate review", async () => {
    const originalFetch = globalThis.fetch,
      originalContact = process.env.AGENT_CONTACT;
    cleanups.push(() => {
      globalThis.fetch = originalFetch;
      if (originalContact === undefined) delete process.env.AGENT_CONTACT;
      else process.env.AGENT_CONTACT = originalContact;
    });
    process.env.AGENT_CONTACT = "durable-fixture@example.test";
    let requests = 0;
    const body = JSON.stringify({
      rc: 0,
      data: {
        f43: 130645,
        f44: 133380,
        f45: 130350,
        f46: 132836,
        f47: 42689,
        f51: 146120,
        f52: 119552,
        f57: "600519",
        f58: "fixture",
        f59: 2,
        f60: 132836,
        f86: Math.floor(Date.now() / 1000),
      },
    });
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://push2.eastmoney.com");
      expect(url.pathname).toBe("/api/qt/stock/get");
      expect(url.searchParams.get("secid")).toBe("1.600519");
      requests++;
      return new Response(body, {
        headers: { "content-type": "application/json" },
      });
    };
    const instance = await harness();
    await instance.load("cn_stock_quote");
    await enable(instance, await directory());
    for (const track of ["cn", "hk", "us"])
      await instance.call("watchlist_add", member(track));
    await save(instance);
    const result = (await instance.call("watchlist_review_run", review()))
      .details;
    expect(result.outcome.status).toBe("completed");
    const receipt = result.outcome.result;
    expect(requests).toBe(1);
    expect(receipt.facts.map((fact) => [fact.track, fact.status])).toEqual([
      ["cn", "checked"],
      ["hk", "track_partial"],
      ["us", "track_partial"],
    ]);
    expect(receipt.facts[0]).toMatchObject({
      lastOrClose: "1306.45",
      sourceReceipt: digest(body),
      change: "no_comparable_prior_observation",
      decisionOwner: "llm",
    });
    expect(receipt.sourceEntryIds).toHaveLength(1);
    expect(instance.entries).toHaveLength(3); // Source cache entries belong to the durable receipt, not the active Pi branch.
    expect(
      (await instance.call("watchlist_review_run", review())).details.outcome
        .result,
    ).toEqual(receipt);
    expect(requests).toBe(1);
    expect(
      (await instance.call("watchlist_review_cancel", { requestId: "review" }))
        .details.status,
    ).toBe("completed");
  });

  test("reports missing capabilities as unknown, enforces timing and source budgets, and cancels future reviews", async () => {
    const instance = await harness();
    await enable(instance, await directory());
    await instance.call("watchlist_add", member());
    await save(instance);
    const result = (await instance.call("watchlist_review_run", review()))
      .details;
    expect(result.outcome.result.facts[0]).toMatchObject({
      status: "cannot_check",
      change: "unknown",
      reason: "unavailable",
    });
    const future = {
      ...review("future"),
      firstDueUnixMilliseconds: Date.now() + 60000,
      intervalMilliseconds: 3600000,
      maximumReviews: 2,
    };
    await expect(
      instance.call("watchlist_review_schedule", {
        ...future,
        intervalMilliseconds: 10,
      }),
    ).rejects.toThrow("invalid_review_interval");
    await instance.call("watchlist_review_schedule", future);
    expect(
      (await instance.call("watchlist_review_status")).details.jobs.at(-1)
        .taskState.nextDueUnixMilliseconds,
    ).toBe(future.firstDueUnixMilliseconds);
    expect(
      (await instance.call("watchlist_review_cancel", { requestId: "future" }))
        .details.status,
    ).toBe("aborted");
  });

  test("rejects another writer without damaging the active store", async () => {
    const path = await directory();
    const one = await harness(),
      two = await harness();
    await enable(one, path);
    await expect(enable(two, path)).rejects.toThrow("writer_unavailable");
    await one.call("watchlist_durable", { action: "close" });
    expect((await enable(two, path)).details.enabled).toBe(true);
  });
});

// Real process death: the second source was attempted, while the first source
// and its receipt were already committed. Recovery must reuse one and mark the
// other unknown without another source call.
test("SIGKILL recovery reuses completed receipts and never refetches interrupted observations across Bun and Node", async () => {
  const path = await directory();
  const driver = resolve(
    import.meta.dir,
    "../../fixtures/durable-watchlist/driver.mjs",
  );
  const child = Bun.spawn(["bun", driver, "crash", path], {
    stdout: "pipe",
    stderr: "pipe",
  });
  let text = "";
  const reader = child.stdout.getReader();
  while (!text.includes("SOURCE:600519")) {
    const { value, done } = await reader.read();
    if (done)
      throw new Error(
        `crash driver exited before source: ${text} ${await new Response(child.stderr).text()}`,
      );
    text += new TextDecoder().decode(value);
  }
  child.kill("SIGKILL");
  await child.exited;
  const resumed = Bun.spawn(["node", driver, "resume", path], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(resumed.stdout).text(),
    new Response(resumed.stderr).text(),
    resumed.exited,
  ]);
  if (code !== 0)
    throw new Error(`resume driver failed (${code}): ${stderr}\n${stdout}`);
  expect(stderr).not.toContain("Error:");
  expect(stdout).not.toContain("SOURCE:");
  const value = JSON.parse(stdout.split("RESULT:")[1].trim());
  expect(value.taskState.outcome).toBe("completed");
  expect(value.latest.facts.map((fact) => [fact.symbol, fact.status])).toEqual([
    ["600000", "checked"],
    ["600519", "cannot_check"],
  ]);
  expect(value.latest.facts[1]).toMatchObject({
    reason: "interrupted",
    change: "unknown",
  });
  expect(value.latest.sourceEntryIds).toHaveLength(2);
}, 15000);

test("accepted default store reopens in a later Pi process without a command-line opt-in", async () => {
  const home = await mkdtemp(join(tmpdir(), "sparkles-durable-home-"));
  cleanups.unshift(() => rm(home, { recursive: true, force: true }));
  const driver = resolve(
    import.meta.dir,
    "../../fixtures/durable-watchlist/driver.mjs",
  );
  for (const mode of ["default-enable", "default-discover"]) {
    const child = Bun.spawn(["node", driver, mode], {
      env: { ...process.env, HOME: home },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).not.toContain("Error:");
    const status = JSON.parse(stdout.split("RESULT:")[1].trim());
    expect(status.enabled).toBe(true);
    expect(status.directory).toBe(join(home, ".pi-sparkles-watchlist"));
  }
}, 15000);
