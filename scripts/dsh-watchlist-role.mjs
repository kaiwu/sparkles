// Deterministic role acceptance through installed DSH services and real JSON
// storage. The source tool is a scripted, rights-safe fixture; no model or live
// provider is called. A separate Node process is killed during acquisition.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { executeRegisteredTool, mountNativeToolExecutor } from "../dsh/tool-batch.mjs";

const HOUR = 3_600_000;
const scriptPath = fileURLToPath(import.meta.url);

async function boot(bundleEntry, directory, { crash = false } = {}) {
  const cli = realpathSync(execFileSync("which", ["dsh"], { encoding: "utf8" }).trim());
  const packages = join(dirname(dirname(cli)), "node_modules", "@deepseek-ai");
  const load = (name) => import(pathToFileURL(join(packages, name, "lib", "index.js")).href);
  const [
    { Context }, { default: SystemPrompt }, { default: Tools }, { default: Commands },
    { default: Sessions, Session, SessionId }, { default: Projections }, { default: Agents },
    { createScope }, { default: LocalFs }, { default: WorkingDirectory },
    { default: Storage }, StorageJson, StorageDomain, { default: product },
  ] = await Promise.all([
    load("cordis"), load("dsh-system-prompt"), load("dsh-tools"), load("dsh-commands"),
    load("dsh-session"), load("dsh-session-projection"), load("dsh-agent"), load("dsh-scope"),
    load("dsh-fs-local"), load("dsh-working-directory"), load("dsh-storage"),
    load("dsh-storage-json"), load("dsh-storage-domain"), import(pathToFileURL(bundleEntry).href),
  ]);
  const ctx = new Context();
  for (const service of [SystemPrompt, Tools, Commands, Sessions, Projections, Agents, LocalFs]) await ctx.plugin(service);
  await mountNativeToolExecutor(
    ctx,
    pathToFileURL(join(packages, "dsh-tool-executor-native", "lib", "index.js")).href,
  );
  await ctx.plugin(WorkingDirectory, {});
  await ctx.plugin(Storage);
  await ctx.plugin(StorageJson, { root: directory });
  await ctx.plugin(StorageDomain, { backend: "json" });
  const owned = new Map();
  const historyFile = join(directory, "fixture-sessions.json");
  const retained = existsSync(historyFile) ? JSON.parse(readFileSync(historyFile, "utf8")) : {};
  let scopeFor;
  await ctx.plugin({ name: "review-role-scopes", inject: ["tools", "commands", "systemPrompt"], apply(scoped) {
    scopeFor = (agent) => createScope(scoped, agent);
  } });
  const createAgent = async (id) => {
    if (owned.has(id)) return owned.get(id).agent;
    const session = retained[id] ? Session.create(SessionId(id), retained[id].events, retained[id].header)
      : ctx.sessions.create(SessionId(id), { meta: { cwd: process.cwd() } });
    const agent = { id: session.id, session, options: {}, status: "idle", inbox: {
      nextTurn: [], nextStep: [], clear() {}, append() {}, prepend() {}, replace: () => false, remove: () => false,
    }, send() {}, followup() {}, steer() {}, inject() {}, cancel() {}, whenIdle: async () => {},
    runMaintenance: (action) => action(new AbortController().signal) };
    const scope = scopeFor(agent);
    agent.ctx = scope.ctx;
    // Override acquisition in this exact agent scope. The real registry still
    // validates schemas and applies global/scoped guards to every source call.
    const source = ctx.tools.get("cn_stock_quote");
    agent.ctx.get("tools").register({
      ...source,
      async execute(args, exec) {
        assert.equal(exec.agent, agent);
        assert.equal(args.provider, "eastmoney");
        appendFileSync(join(directory, "source-count.txt"), `${id}:${args.code}\n`);
        if (crash && args.code === "600519") {
          process.stdout.write("SOURCE_IN_FLIGHT\n");
          await new Promise((_, reject) => exec.signal.addEventListener("abort", () => reject(exec.signal.reason), { once: true }));
        }
        return { content: [{ type: "text", text: "private scripted quote fixture" }], details: {
          schema: "pi-sparkles/cn-stock-quote-result", schemaVersion: 1, track: "cn",
          selectedProvider: "eastmoney", fallbackPerformed: false,
          listing: { code: args.code, venueMic: args.venue === "sse" ? "XSHG" : "XSHE", shareClass: "a_share" },
          asOfDate: args.asOfDate, prices: { lastOrClose: "10.00", currency: "CNY" },
          source: { provider: "eastmoney", entitlement: "fixture", redistribution: "fixture_private" },
          acquisitionReceipt: { contentSha256: "a".repeat(64) }, retrievedAtUnixMilliseconds: Date.now(),
          providerTimestamp: "scripted", freshness: "unknown",
        } };
      },
    });
    const unregister = ctx.agents.enter(agent, undefined);
    owned.set(id, { agent, scope, unregister });
    await ctx.agents.announce(agent, retained[id] ? "resume" : "startup");
    return agent;
  };
  ctx.provide("sessionController", { resolveAgent: async (id) => ({ agent: await createAgent(String(id)) }) });
  const productFiber = await ctx.plugin(product, { dsh: { watchlist_reviews: { lockDirectory: join(directory, "lease") } } });
  const call = async (agent, name, input = {}) => {
    const result = await executeRegisteredTool(ctx.tools, {
      agent, name, arguments: input,
      signal: new AbortController().signal, callId: `role-${name}`,
    });
    assert.equal(result.isError, false, `${name}: ${JSON.stringify(result.content)}`);
    return result.value;
  };
  const saveSessionHistory = () => writeFileSync(historyFile, JSON.stringify(Object.fromEntries(
    [...owned].map(([id, { agent }]) => [id, { header: agent.session.header, events: agent.session.snapshotEvents() }]),
  )));
  return {
    ctx, createAgent, call, saveSessionHistory,
    async close() {
      saveSessionHistory();
      await productFiber.dispose();
      for (const { unregister, scope } of owned.values()) { unregister(); await scope.dispose(); }
      await ctx.fiber.dispose();
    },
  };
}

async function prepare(runtime, agent, picks) {
  await runtime.call(agent, "watchlist_durable", { action: "enable", userAccepted: true });
  for (const [track, symbol, mic] of picks) await runtime.call(agent, "watchlist_add", {
    watchlist: "core", track, symbol, mic, instrumentId: `caller:${symbol}`, tags: [],
  });
  const handoff = (await runtime.call(agent, "watchlist_snapshot")).details;
  await runtime.call(agent, "watchlist_durable_save", { requestId: "save", expectedRevision: 0,
    snapshotJson: handoff.snapshotJson, snapshotSha256: handoff.snapshotSha256 });
  return handoff;
}
const request = (overrides = {}) => ({ requestId: "review", watchlist: "core", provider: "eastmoney", shareClass: "a_share",
  maximumRequestsPerReview: 2, firstDueUnixMilliseconds: Date.now(), intervalMilliseconds: HOUR, maximumReviews: 1, ...overrides });

async function waitFor(call, predicate) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await call();
    if (predicate(value)) return value;
    await delay(10);
  }
  throw new Error("DSH review role did not settle");
}

async function killDuringSource(bundleEntry, directory) {
  const child = spawn("node", [scriptPath, "--crash-child", bundleEntry, directory], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "", diagnostics = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-8000); });
  try {
    await waitFor(async () => {
      assert.equal(child.exitCode, null, `crash fixture exited: ${diagnostics}`);
      return output;
    }, (value) => value.includes("SOURCE_IN_FLIGHT"));
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((done) => child.once("exit", done));
      child.kill("SIGKILL"); await exited;
    }
  }
}

export async function verifyDshWatchlistRole(bundleEntry) {
  const root = mkdtempSync(join(tmpdir(), "sparkles-dsh-watchlist-role-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("live network disabled in DSH review acceptance"); };
  let runtime;
  try {
    const normal = join(root, "normal");
    runtime = await boot(bundleEntry, normal);
    const one = await runtime.createAgent("review-owner"), two = await runtime.createAgent("review-other");
    assert.equal((await runtime.call(one, "watchlist_durable", { action: "status" })).enabled, false);
    const handoff = await prepare(runtime, one, [["cn", "600000", "XSHG"], ["hk", "00700", "XHKG"], ["us", "AAPL", "XNAS"]]);
    const run = await runtime.call(one, "watchlist_review_run", request());
    assert.deepEqual(run.job.latest.facts.map((fact) => fact.status), ["checked", "track_partial", "track_partial"]);
    assert.equal((await runtime.call(two, "watchlist_durable_snapshot")).saved, null);
    const projection = runtime.ctx.sessionProjections.snapshot(one.session).values.piSparklesWatchlistReviews;
    assert.equal(projection.jobs[0].latest.facts[0].lastOrClose, "10.00");
    const disposeGuard = one.ctx.get("tools").guard((exec) => exec.name === "cn_stock_quote" ? "scripted denial" : undefined);
    const denied = await runtime.call(one, "watchlist_review_run", request({ requestId: "denied" }));
    assert.equal(denied.job.latest.facts[0].status, "cannot_check");
    disposeGuard();
    await runtime.call(one, "watchlist_review_schedule", request({ requestId: "catchup", maximumReviews: 2, firstDueUnixMilliseconds: Date.now() - 3 * HOUR }));
    const caught = await waitFor(() => runtime.call(one, "watchlist_review_status"), (value) => value.jobs.find((job) => job.requestId === "catchup")?.completedReviews === 1);
    assert.equal(caught.jobs.find((job) => job.requestId === "catchup").latest.missedIntervals, 3);
    const activity = await runtime.ctx.waterfall("workspace/session-activity", { sessionId: one.session.id }, () => Promise.resolve([]));
    assert.ok(activity.some((entry) => entry.kind === "watchlist_review" && entry.items[0].id === "catchup"));
    await runtime.ctx.parallel("workspace/session-stop", { sessionId: one.session.id });
    assert.equal((await runtime.call(one, "watchlist_review_status")).paused, true);
    await runtime.call(one, "watchlist_review_cancel", { requestId: "catchup" });
    await runtime.close(); runtime = undefined;
    runtime = await boot(bundleEntry, normal);
    const resumed = await runtime.createAgent("review-owner");
    assert.equal((await runtime.call(resumed, "watchlist_durable_snapshot")).saved.snapshotSha256, handoff.snapshotSha256);
    const restored = await runtime.call(resumed, "watchlist_review_status", { requestId: "review" });
    assert.equal(restored.receipts.length, 1);
    assert.equal(restored.jobs.find((job) => job.requestId === "catchup").status, "cancelled");
    assert.equal(readFileSync(join(normal, "source-count.txt"), "utf8").trim().split("\n").length, 2);
    await runtime.close(); runtime = undefined;

    const crashDirectory = join(root, "crash");
    await killDuringSource(bundleEntry, crashDirectory);
    runtime = await boot(bundleEntry, crashDirectory);
    const owner = await runtime.createAgent("crash-owner");
    const recovered = await waitFor(() => runtime.call(owner, "watchlist_review_status"), (value) => value.jobs[0]?.status === "completed");
    assert.deepEqual(recovered.jobs[0].latest.facts.map((fact) => fact.status), ["checked", "cannot_check"]);
    assert.equal(recovered.jobs[0].latest.facts[1].reason, "interrupted");
    assert.equal(recovered.jobs[0].latest.facts[1].change, "unknown");
    assert.equal(readFileSync(join(crashDirectory, "source-count.txt"), "utf8").trim().split("\n").length, 2, "recovery must not refetch either source");
    return { watchlistReviews: true, hardCrashRecovery: true, policyGuards: true, modelCalls: 0, liveProviderCalls: 0 };
  } finally {
    await runtime?.close();
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--crash-child") {
  globalThis.fetch = async () => { throw new Error("live network disabled"); };
  const runtime = await boot(resolve(process.argv[3]), resolve(process.argv[4]), { crash: true });
  const owner = await runtime.createAgent("crash-owner");
  await prepare(runtime, owner, [["cn", "600000", "XSHG"], ["cn", "600519", "XSHG"]]);
  runtime.saveSessionHistory();
  await runtime.call(owner, "watchlist_review_schedule", request());
  // Keep the fixture alive while its timer/source is intentionally suspended.
  setInterval(() => {}, 1000);
}
