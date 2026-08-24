// Verify the DSH bridge against the REAL installed DSH runtime.
//
// The unit tests mirror the dsh-tools schema subset by hand; this script runs
// the actual @deepseek-ai/dsh-tools validator and, when the generated bundle
// exists, boots its real Cordis services, applies the all-in-one plugin, and
// executes a deterministic tool through ToolRuntime. It skips gracefully when
// no `dsh` installation is present.
//
//   bun run dsh:verify

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { DSH_OUTPUT_DIR } from "./dsh-bundle.js";
import {
  OUTPUT_SCHEMA,
  translateParameters,
} from "../dsh/schema-translate.mjs";

function resolveDshRuntime() {
  let dshBin;
  try {
    dshBin = execFileSync("which", ["dsh"], { encoding: "utf8" }).trim();
    const real = execFileSync("readlink", ["-f", dshBin], {
      encoding: "utf8",
    }).trim();
    const dshRoot = dirname(dirname(real));
    const packages = join(dshRoot, "node_modules", "@deepseek-ai");
    const entries = {
      agent: join(packages, "dsh-agent", "lib", "index.js"),
      scope: join(packages, "dsh-scope", "lib", "index.js"),
      session: join(packages, "dsh-session", "lib", "index.js"),
      sessionProjection: join(packages, "dsh-session-projection", "lib", "index.js"),
      context: join(packages, "cordis", "lib", "index.js"),
      systemPrompt: join(packages, "dsh-system-prompt", "lib", "index.js"),
      tools: join(packages, "dsh-tools", "lib", "index.js"),
      commands: join(packages, "dsh-commands", "lib", "index.js"),
    };
    return Object.values(entries).every(existsSync) ? entries : null;
  } catch {
    return null;
  }
}

// Pi schema constructors mirroring pi_gleam/src/pi/schema_ffi.mjs.
const string = () => ({ type: "string" });
const integer = () => ({ type: "integer" });
const stringEnum = (values) => ({ type: "string", enum: values });
const array = (items) => ({ type: "array", items });
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const boundedString = (min, max) => ({ type: "string", minLength: min, maxLength: max });
const object = (properties) => ({
  type: "object",
  properties,
  required: Object.entries(properties)
    .filter(([, s]) => s.__required)
    .map(([n]) => n),
  additionalProperties: false,
});
const req = (schema) => ({ ...schema, __required: true });

const REPRESENTATIVE = {
  simple: object({ ticker: req(string()), limit: integer() }),
  nullable: object({ exchange: nullable(stringEnum(["NYSE", "NASDAQ"])) }),
  nested: object({
    listing: req(
      object({ symbol: req(string()), mic: req(stringEnum(["XNYS", "XNAS"])) }),
    ),
    notes: array(boundedString(1, 500)),
    pair: { type: "array", prefixItems: [string(), integer()], minItems: 2, maxItems: 2 },
    meta: { type: "object", additionalProperties: string() },
    extra: {},
  }),
  noParams: object({}),
};

const SAMPLES = {
  simple: { ticker: "AAPL", limit: 3 },
  nullable: { exchange: null },
  nested: {
    listing: { symbol: "AAPL", mic: "XNYS" },
    notes: ["a"],
    pair: ["a", 1],
    meta: { any: "value" },
    extra: { anything: true },
  },
  noParams: {},
};

export async function verifyAgainstDshTools({ log = console.log } = {}) {
  const runtime = resolveDshRuntime();
  if (!runtime) {
    return { skipped: true, reason: "dsh CLI / dsh-tools not found" };
  }
  const mod = await import(pathToFileURL(runtime.tools).href);
  const { assertSupportedJsonSchema, validateJsonSchemaValue } = mod;
  if (typeof assertSupportedJsonSchema !== "function") {
    throw new Error("dsh-tools did not export assertSupportedJsonSchema");
  }

  const failures = [];
  for (const [name, piSchema] of Object.entries(REPRESENTATIVE)) {
    const translated = translateParameters(piSchema);
    try {
      assertSupportedJsonSchema(translated);
    } catch (error) {
      failures.push(`${name}: assertSupportedJsonSchema rejected: ${error.message}`);
      continue;
    }
    const violations = validateJsonSchemaValue(translated, SAMPLES[name], "");
    if (violations.length > 0) {
      failures.push(`${name}: sample rejected: ${violations.join("; ")}`);
    }
  }

  try {
    assertSupportedJsonSchema(OUTPUT_SCHEMA);
  } catch (error) {
    failures.push(`OUTPUT_SCHEMA rejected: ${error.message}`);
  }

  if (failures.length > 0) {
    throw new Error(`DSH verification failed:\n- ${failures.join("\n- ")}`);
  }
  const bundleEntry = join(DSH_OUTPUT_DIR, "index.js");
  let runtimeSmoke = false;
  let toolCount = 0;
  let scopedCounterparts = false;
  let overlayProjection = false;
  let chartPresentationMeta = false;
  if (existsSync(bundleEntry)) {
    const [
      { Context },
      { default: SystemPrompt },
      { default: ToolRuntime },
      { default: CommandRuntime },
      { default: SessionStore, SessionId },
      { default: SessionProjectionRegistry },
      { default: AgentRegistry, Inbox, agentEvents },
      { createScope },
      { default: plugin },
    ] =
      await Promise.all([
        import(pathToFileURL(runtime.context).href),
        import(pathToFileURL(runtime.systemPrompt).href),
        import(pathToFileURL(runtime.tools).href),
        import(pathToFileURL(runtime.commands).href),
        import(pathToFileURL(runtime.session).href),
        import(pathToFileURL(runtime.sessionProjection).href),
        import(pathToFileURL(runtime.agent).href),
        import(pathToFileURL(runtime.scope).href),
        import(`${pathToFileURL(bundleEntry).href}?verify=${Date.now()}`),
      ]);
    const ctx = new Context();
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(CommandRuntime);
    await ctx.plugin(SessionStore);
    await ctx.plugin(SessionProjectionRegistry);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(plugin, {});
    let createAgentScope;
    await ctx.plugin({
      name: "dsh-sparkles-verify-agent-scope",
      inject: ["tools", "commands", "systemPrompt"],
      apply(scopedCtx) {
        createAgentScope = (key) => createScope(scopedCtx, key);
      },
    });
    if (typeof createAgentScope !== "function") {
      throw new Error("real DSH runtime did not initialize the agent scope factory");
    }

    const createAgent = (rawId, retainedSession, source = "startup") => {
      const id = SessionId(rawId);
      const session = retainedSession ??
        ctx.sessions.create(id, { meta: { cwd: process.cwd() } });
      const agent = {};
      const scope = createAgentScope(agent);
      Object.assign(agent, {
        id,
        options: {},
        session,
        inbox: new Inbox(session, {
          inserted() {},
          discarded() {},
          claimed() {},
        }),
        status: "idle",
        ctx: scope.ctx,
        send() {},
        followup() {},
        steer() {
          return { outcome: Promise.resolve({ status: "rejected" }) };
        },
        inject() {},
        cancel() {},
        runMaintenance: (task) => task(new AbortController().signal),
        whenIdle: () => Promise.resolve(),
      });
      const unregister = ctx.agents.register(agent);
      agentEvents(ctx, agent).emit("agent/session-start", { source });
      return { agent, scope, unregister };
    };

    const first = createAgent("dsh-sparkles-verify-1");
    const second = createAgent("dsh-sparkles-verify-2");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const schemas = ctx.tools.schemas(first.agent);
    toolCount = schemas.length;
    const scopedNames = new Set(
      schemas.map((schema) => schema.name),
    );
    for (const name of [
      "finance_track_status",
      "swing_snapshot",
      "portfolio_summary",
      "watchlist_snapshot",
    ]) {
      if (!scopedNames.has(name)) failures.push(`scoped counterpart tool is missing: ${name}`);
    }
    const commandNames = new Set(
      ctx.commands.list(first.agent).map((command) => command.name),
    );
    for (const name of ["finance-track", "cn-track", "swing", "watch"]) {
      if (!commandNames.has(name)) failures.push(`scoped counterpart command is missing: ${name}`);
    }
    const prompt = await ctx.systemPrompt.assemble({
      agent: first.agent,
      scope: first.agent,
    });
    const expectedTushareGuidance = process.env.TUSHARE_TOKEN?.trim()
      ? "The heavily limited Tushare stock-listing identity fallback is configured in this DSH process; never use it first or automatically, and call it only after the primary path is unavailable and the user explicitly requests or accepts the fallback."
      : "The optional Tushare stock-listing identity adapter is unavailable in this DSH process because TUSHARE_TOKEN is not configured; do not call it or guess the missing identity.";
    if (
      !prompt.sections.some(
        (section) =>
          section.name === "pi-sparkles:finance-routing" &&
          section.text.includes("Pi Sparkles finance routing") &&
          section.text.includes("never invoke a shell merely to discover today's date") &&
          section.text.includes("cn_stock_symbol_search covers stock listings only") &&
          section.text.includes("call cn_index_constituents exactly once with venue sse and code 000688") &&
          section.text.includes("also call cn_index_industry_composition exactly once with the same identity") &&
          section.text.includes("hk and us are track_partial") &&
          section.text.includes("Never relabel, reuse, or substitute the cn result across tracks") &&
          section.text.includes(expectedTushareGuidance) &&
          section.text.includes("priorOffset is one-based"),
      )
    ) {
      failures.push("shared finance routing/date/tool-handoff prompt is incomplete in the DSH agent scope");
    }
    const smaSchema = schemas.find((schema) => schema.name === "sma")?.parameters;
    const priorOffsetDescription =
      smaSchema?.properties?.projection?.properties?.priorOffset?.description;
    if (
      typeof priorOffsetDescription !== "string" ||
      !priorOffsetDescription.includes("value 1..2000")
    ) {
      failures.push("DSH schema bridge did not preserve the sma priorOffset bounds");
    }
    const rawBasis = smaSchema?.properties?.context?.properties?.basis;
    if (
      rawBasis?.properties?.label?.oneOf !== undefined ||
      rawBasis?.properties?.instructionRef?.oneOf !== undefined
    ) {
      failures.push("DSH schema still advertises nullable stock-technical basis fields");
    }
    const historySchema = schemas.find(
      (schema) => schema.name === "cn_raw_vendor_history",
    )?.parameters;
    if (
      !historySchema?.properties?.endDate?.description?.includes("future") ||
      !historySchema?.properties?.limit?.description?.includes("value 1..1000")
    ) {
      failures.push("DSH schema is missing bounded current-date history guidance");
    }
    scopedCounterparts = true;

    const executeFor = (agent, name, args, callId) =>
      ctx.tools.execute({
        agent,
        signal: new AbortController().signal,
        callId,
        name,
        arguments: args,
      });
    const trackStatuses = [
      [
        "cn",
        "CN · CNY · Asia/Shanghai · src:65% · feat:80%",
        ["raw_fundamentals", "normalized_fundamentals"],
      ],
      [
        "hk",
        "HK · HKD · Asia/Hong_Kong · src:70% · feat:70%",
        [
          "raw_fundamentals",
          "normalized_fundamentals",
          "reproducible_derivations",
        ],
      ],
      ["us", "US · USD · America/New_York · src:80% · feat:100%", []],
    ];
    for (const [track, expectedStatus, expectedGaps] of trackStatuses) {
      await ctx.commands.execute(
        first.agent,
        `/${track}-track`,
        [],
        new AbortController().signal,
      );
      const status = ctx.sessionProjections.snapshot(first.agent.session)
        .values.piSparklesStatus?.values?.["finance-track"];
      if (status !== expectedStatus) {
        failures.push(
          `finance track overlay projection is invalid for ${track}: ${String(status)}`,
        );
      }
      const trackStatus = await executeFor(
        first.agent,
        "finance_track_status",
        {},
        `dsh-verify-finance-track-status-${track}`,
      );
      if (
        trackStatus.value?.details?.featureCoveragePercentage !==
          100 - expectedGaps.length * 10 ||
        JSON.stringify(
          trackStatus.value?.details?.featureCoverage?.missingRequirements,
        ) !== JSON.stringify(expectedGaps)
      ) {
        failures.push(
          `finance track feature coverage is stale for ${track}: ${JSON.stringify(trackStatus.value?.details?.featureCoverage)}`,
        );
      }
    }
    await ctx.commands.execute(
      first.agent,
      "/cn-track",
      [],
      new AbortController().signal,
    );
    overlayProjection = !failures.some((failure) =>
      failure.startsWith("finance track overlay projection is invalid"),
    );

    await executeFor(
      first.agent,
      "watchlist_add",
      {
        watchlist: "verify",
        track: "us",
        instrumentId: "ticker:AAPL",
        symbol: "AAPL",
        mic: "XNAS",
        tags: ["verify"],
      },
      "dsh-verify-watchlist-add",
    );
    const firstWatchlist = await executeFor(
      first.agent,
      "watchlist_snapshot",
      {},
      "dsh-verify-watchlist-first",
    );
    const secondWatchlist = await executeFor(
      second.agent,
      "watchlist_snapshot",
      {},
      "dsh-verify-watchlist-second",
    );
    if (
      firstWatchlist.value?.details?.revision !== 1 ||
      secondWatchlist.value?.details?.revision !== 0
    ) {
      failures.push("watchlist state leaked between real DSH agent scopes");
    }

    const retainedFirstSession = first.agent.session;
    first.unregister();
    await first.scope.dispose();
    const resumed = createAgent(
      "dsh-sparkles-verify-1",
      retainedFirstSession,
      "resume",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const resumedWatchlist = await executeFor(
      resumed.agent,
      "watchlist_snapshot",
      {},
      "dsh-verify-watchlist-resumed",
    );
    if (resumedWatchlist.value?.details?.revision !== 1) {
      failures.push("watchlist state did not restore from the resumed DSH session log");
    }
    const resumedStatus = ctx.sessionProjections.snapshot(resumed.agent.session)
      .values.piSparklesStatus?.values?.["finance-track"];
    if (typeof resumedStatus !== "string" || !resumedStatus.startsWith("CN · CNY ·")) {
      failures.push(`finance track overlay did not restore on resume: ${String(resumedStatus)}`);
    }

    const result = await ctx.tools.execute({
      agent: resumed.agent,
      signal: new AbortController().signal,
      callId: "dsh-verify-finance-capabilities",
      name: "finance_capabilities",
      arguments: {},
    });
    if (!Array.isArray(result?.content) || result.content[0]?.type !== "text") {
      failures.push("runtime tool projection is not a DSH ContentBlock[]");
    }
    if (!Array.isArray(result?.value?.content)) {
      failures.push("runtime canonical tool value does not match the bridge output schema");
    }
    const hash = (digit) => digit.repeat(64);
    const chart = await executeFor(
      resumed.agent,
      "chart_ohlcv",
      {
        context: {
          instructionRef: hash("1"),
          track: "us",
          instrumentId: "US-AAPL",
          mic: "XNAS",
          timezone: "America/New_York",
          sourceLanguage: "en-US",
          priceUnit: "USD",
          volumeUnit: "shares",
          adjustment: { kind: "raw", label: null },
          source: {
            provider: "dsh-verify-fixture",
            sourceReference: "fixture://dsh-verify/chart",
            acquisitionReceipt: hash("2"),
            retrievedAtUnixMilliseconds: 1_800_000_000_000,
            sourceCutoffUnixMilliseconds: 1_799_999_000_000,
            entitlement: "fixture_local_analysis",
          },
          limitations: ["fixture_only"],
        },
        series: [{
          date: "2026-02-02",
          sessionType: "regular",
          open: "10.00",
          high: "11.00",
          low: "9.00",
          close: "10.50",
          volume: "100",
        }],
        indicators: [],
        trades: [],
        gaps: [],
        inputOmissions: [],
        fallbackMaximumRows: 1,
      },
      "dsh-verify-finance-chart",
    );
    if (
      chart.meta?.schema !== "pi-sparkles/dsh-finance-chart-meta" ||
      chart.meta?.schemaVersion !== 1 ||
      chart.meta?.valid !== true ||
      chart.meta?.chart?.bars?.[0]?.close !== "10.50"
    ) {
      failures.push("chart_ohlcv did not persist the exact DSH browser metadata contract");
    } else if (
      !Array.isArray(chart.content) ||
      chart.content.some((block) => block?.type !== "text")
    ) {
      failures.push("chart_ohlcv escaped the ordinary inline text output path");
    } else {
      chartPresentationMeta = true;
    }
    resumed.unregister();
    second.unregister();
    await resumed.scope.dispose();
    await second.scope.dispose();
    runtimeSmoke = true;
  }

  if (failures.length > 0) {
    throw new Error(`DSH verification failed:\n- ${failures.join("\n- ")}`);
  }
  return {
    skipped: false,
    cases: Object.keys(REPRESENTATIVE).length,
    runtimeSmoke,
    toolCount,
    scopedCounterparts,
    overlayProjection,
    chartPresentationMeta,
  };
}

if (import.meta.main) {
  try {
    const result = await verifyAgainstDshTools();
    if (result.skipped) {
      console.log(`dsh:verify skipped: ${result.reason}`);
      process.exit(0);
    }
    console.log(
      `dsh:verify passed ${result.cases} representative schemas against real dsh-tools` +
        (result.runtimeSmoke
          ? ` and executed the generated bundle (${result.toolCount} tools, scoped counterparts=${result.scopedCounterparts}, overlay projection=${result.overlayProjection}, chart metadata=${result.chartPresentationMeta}) in the real DSH runtime`
          : "; generated bundle not present, runtime execution skipped"),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
