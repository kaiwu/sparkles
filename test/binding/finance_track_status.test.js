import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const artifact = resolve(
  import.meta.dir,
  "../../dist/finance_track_status/index.js",
);

function entry(id, track) {
  return {
    type: "custom",
    id,
    parentId: null,
    timestamp: "2026-08-05T00:00:00.000Z",
    customType: "pi_sparkles_finance_track_status.active_track",
    data: track,
  };
}

function context(entries, statuses = [], notifications = []) {
  return {
    mode: "tui",
    hasUI: true,
    sessionManager: {
      getBranch: () => entries,
    },
    ui: {
      setStatus(key, text) {
        statuses.push({ key, text });
      },
      notify(message, kind) {
        notifications.push({ message, kind });
      },
    },
  };
}

async function harness({
  initial = "us",
  contact = "agent@example.test",
  entries = [],
  activeTools = [
    "finance_track_status",
    "finance_capabilities",
    "security_resolve",
    "sec_company_submissions",
    "sec_xbrl_facts",
    "stock_fundamental",
    "stock_fundamental_metric",
    "us_stock_quote",
    "us_stock_ohlcv",
    "us_market_calendar",
    "us_trading_rules",
    "cn_authorities",
    "cn_security_search",
    "cn_market_calendar",
    "cn_trading_rules",
    "cn_disclosure_search",
    "cn_stock_quote",
    "cn_stock_history",
    "cn_financial_statement",
    "cn_stock_fundamental",
    "cn_stock_fundamental_metric",
    "hk_authorities",
    "hk_security_search",
    "hk_security_profile",
    "hk_recent_listing_event",
    "hk_market_calendar",
    "hk_trading_rules",
    "hk_disclosure_search",
    "hk_stock_quote",
    "hk_stock_history",
    "hk_financial_statement",
    "hk_stock_fundamental",
    "hk_stock_fundamental_metric",
  ],
} = {}) {
  const commands = new Map();
  const tools = new Map();
  const handlers = new Map();
  const events = [];
  process.env.AGENT_CONTACT = contact;
  const flags = new Map([["finance-track", initial]]);
  let nextId = entries.length;
  const api = {
    events: {
      emit(channel, data) {
        events.push({ channel, data });
      },
    },
    registerFlag(name, options) {
      if (!flags.has(name)) flags.set(name, options.default);
    },
    getFlag(name) {
      return flags.get(name);
    },
    getActiveTools() {
      return activeTools;
    },
    registerCommand(name, options) {
      commands.set(name, options);
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    on(name, handler) {
      handlers.set(name, handler);
    },
    appendEntry(customType, data) {
      nextId += 1;
      entries.push(entry(`track-${nextId}`, data));
      entries.at(-1).customType = customType;
    },
  };
  const module = await import(
    `${artifact}?track=${Date.now()}-${Math.random()}`
  );
  await module.default(api);
  return { commands, entries, events, handlers, tools };
}

describe("finance track status binding", () => {
  test("injects one pre-tool routing policy for advice, names, CNINFO, and indicators", async () => {
    const instance = await harness();
    const result = await instance.handlers.get("before_agent_start")(
      { type: "before_agent_start" },
      { getSystemPrompt: () => "base prompt" },
    );

    expect(result.systemPrompt).toContain("base prompt");
    expect(result.systemPrompt).not.toMatch(/[^\x00-\x7F]/);
    expect(result.systemPrompt).toContain(
      "call installed cn_market_overview exactly once",
    );
    expect(result.systemPrompt).toContain(
      "the first evidence-acquisition step MUST contain only applicable installed Pi Sparkles tools",
    );
    expect(result.systemPrompt).toContain(
      "including STAR 50 or index 000688",
    );
    expect(result.systemPrompt).toContain(
      "Do not call cn_raw_vendor_history for 000688",
    );
    expect(result.systemPrompt).toContain(
      "call cn_raw_vendor_history first with provider eastmoney",
    );
    expect(result.systemPrompt).toContain(
      "state that Sina was not called, and ask whether the user explicitly wants the separately selected Sina source",
    );
    expect(result.systemPrompt).toContain(
      "Never call Sina in the same step or automatically",
    );
    expect(result.systemPrompt).toContain(
      "Only after the user explicitly accepts Sina may a new cn_raw_vendor_history call",
    );
    expect(result.systemPrompt).toContain(
      "state the data-source change explicitly",
    );
    expect(result.systemPrompt).toContain(
      "call cn_index_constituents exactly once with venue sse and code 000688",
    );
    expect(result.systemPrompt).toContain(
      "also call cn_index_industry_composition exactly once with the same identity",
    );
    expect(result.systemPrompt).toContain("hk and us are track_partial");
    expect(result.systemPrompt).toContain(
      "Never relabel, reuse, or substitute the cn result across tracks",
    );
    expect(result.systemPrompt).toContain(
      "do not ask the user to supply the member list, call Tushare, use generic web",
    );
    expect(result.systemPrompt).toContain(
      "do not probe benchmark codes through stock quote/history",
    );
    expect(result.systemPrompt).toContain(
      "call cn_sector_series once with one explicit date window",
    );
    expect(result.systemPrompt).toContain(
      "pass its comparisonInput and expectedInputSha256 unchanged to compare_series_returns",
    );
    expect(result.systemPrompt).toContain(
      "For a current CN top-gainers or largest percentage-gainers request, call cn_market_movers once",
    );
    expect(result.systemPrompt).toContain(
      "currently track_partial for hk and us",
    );
    expect(result.systemPrompt).toContain(
      "Do not reacquire the movers page and do not expect one top-ten-analysis tool to own every step",
    );
    expect(result.systemPrompt).toContain(
      "Do not automatically fan out identity, classification, quote, history, indicator, disclosure, or fundamental calls across the result list",
    );
    expect(result.systemPrompt).toContain(
      "A failed optional enrichment is terminal for that dimension",
    );
    expect(result.systemPrompt).toContain(
      "do not call generic web search in parallel with the controlled acquisition",
    );
    expect(result.systemPrompt).toContain(
      "do not replace it with generic web search, web snippets, browsing, model memory, or an unrequested provider",
    );
    expect(result.systemPrompt).toContain(
      "only when the user explicitly requests them as a distinct source path",
    );
    expect(result.systemPrompt).toContain(
      "cn_stock_symbol_search exact-code mode requires a caller-proven venue and TUSHARE_TOKEN",
    );
    expect(result.systemPrompt).toContain(
      "Do not call finance_track_status, finance_capabilities, provider-health tools, or shell-time tools first",
    );
    expect(result.systemPrompt).toContain(
      "never infer a venue, board, security kind, daily price-limit rule, currency, numeric unit, or display scale from a code prefix, provider filter, or field name",
    );
    expect(result.systemPrompt).toContain(
      "never convert them to thousands, millions, billions, wan, or yi",
    );
    expect(result.systemPrompt).toContain(
      "never append CNY, RMB, yuan, or any currency-denominated price-band wording",
    );
    expect(result.systemPrompt).toContain(
      "provider-filtered CN listing-category rows, not verified A-share instruments",
    );
    expect(result.systemPrompt).toContain(
      "not a proved official close",
    );
    expect(result.systemPrompt).toContain(
      "Do not describe a percentage cluster as a price limit, limit-up event, daily ceiling, board regime, or abnormal activity",
    );
    expect(result.systemPrompt).toContain(
      "Do not guess or probe sector codes with cn_raw_vendor_history",
    );
    expect(result.systemPrompt).toContain(
      "never translate it into fund flow, capital rotation, sector breadth, causal leadership, AI/theme exposure",
    );
    expect(result.systemPrompt).toContain(
      "Never infer a mainland listing's exact venue or code from model memory",
    );
    expect(result.systemPrompt).toContain(
      "use an applicable installed identity-discovery tool only when that tool covers the instrument kind",
    );
    expect(result.systemPrompt).toContain(
      "heavily rate- and entitlement-limited optional Tushare stock_basic adapter",
    );
    expect(result.systemPrompt).toContain(
      "Keep it only as a fallback option: never use it as the first route or invoke it automatically",
    );
    expect(result.systemPrompt).toContain(
      "only after the primary identity path is unavailable and the user explicitly requests or accepts the Tushare fallback",
    );
    expect(result.systemPrompt).toContain(
      "It is never a mandatory prerequisite",
    );
    expect(result.systemPrompt).toContain(
      "If no applicable configured identity path can prove the identity, keep it unresolved",
    );
    expect(result.systemPrompt).toContain(
      "otherwise report that controlled index discovery is unavailable",
    );
    expect(result.systemPrompt).toContain(
      "CNINFO is never a prerequisite for quotes, OHLCV, or indicators",
    );
    expect(result.systemPrompt).toContain("call installed sma, rsi, and atr");
    expect(result.systemPrompt).toContain("instead of writing or executing a program");
    expect(result.systemPrompt).toContain(
      "When a user asks whether to buy now, what happens if they buy now, when to sell",
    );
    expect(result.systemPrompt).toContain(
      "The user never needs to say 'use tools', 'use current data', or 'provide tool evidence'",
    );
    expect(result.systemPrompt).toContain(
      "do not skip tools merely because the LLM owns the recommendation",
    );
    expect(result.systemPrompt).toContain(
      "fetch a current quote and a bounded recent daily OHLCV/history series",
    );
    expect(result.systemPrompt).toContain(
      "use simulate_bar_paths only for an exact proposed order and completed bar",
    );
    expect(result.systemPrompt).toContain(
      "never pause to calculate that hash",
    );
    expect(result.systemPrompt).toContain(
      "priorOffset is one-based: use 1 for the newest calculated value, never 0",
    );
    expect(result.systemPrompt).toContain(
      "omit label and instructionRef entirely instead of copying display labels or null fields",
    );
    expect(result.systemPrompt).toContain(
      "do not call quote and then history for the same sample",
    );
    expect(result.systemPrompt).toContain(
      "do not assign any sampled stock to an industry",
    );
    expect(result.systemPrompt).toContain(
      "Never substitute acquisitionReceipt, gapAssessmentReceiptDigest",
    );
    expect(result.systemPrompt).toContain(
      "do not retry the same receipt across sma, rsi, atr, or chart_ohlcv",
    );
    expect(result.systemPrompt).toContain(
      "US us_stock_ohlcv creates a seriesReceipt only",
    );
  });

  test("renders and switches all three isolated track profiles", async () => {
    const instance = await harness();
    const statuses = [];
    const ctx = context(instance.entries, statuses);

    await instance.handlers.get("session_start")(
      { type: "session_start", reason: "startup" },
      ctx,
    );
    expect(statuses.at(-1).text).toBe(
      "US · USD · America/New_York · src:80% · feat:100%",
    );

    for (const [command, expected] of [
      [
        "cn-track",
        "CN · CNY · Asia/Shanghai · src:65% · feat:100%",
      ],
      [
        "hk-track",
        "HK · HKD · Asia/Hong_Kong · src:70% · feat:100%",
      ],
      [
        "us-track",
        "US · USD · America/New_York · src:80% · feat:100%",
      ],
    ]) {
      await instance.commands.get(command).handler("", ctx);
      expect(statuses.at(-1).text).toBe(expected);
    }

    expect(instance.entries.map(({ data }) => data)).toEqual([
      "cn",
      "hk",
      "us",
    ]);
    expect(instance.events.map(({ data }) => data)).toEqual([
      "us",
      "cn",
      "hk",
      "us",
    ]);
  });

  test("restores the active branch and exposes structured headless status", async () => {
    const entries = [entry("track-1", "cn"), entry("track-2", "hk")];
    const instance = await harness({ entries });
    const ctx = context(entries);
    await instance.handlers.get("session_start")(
      { type: "session_start", reason: "resume" },
      ctx,
    );

    const result = await instance.tools.get("finance_track_status").execute(
      "status-1",
      {},
      new AbortController().signal,
      undefined,
      { hasUI: false, ui: {} },
    );
    expect(result.details.track).toBe("hk");
    expect(result.details.currency).toBe("HKD");
    expect(result.details.timezone).toBe("Asia/Hong_Kong");
    expect(result.details.agentContactConfigured).toBeTrue();
    expect(result.details.agentContact).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("agent@example.test");
    expect(result.details.trackContext.track).toBe("hk");
    expect(result.details.sourceCredibilityPercentage).toBe(70);
    expect(result.details.featureCoveragePercentage).toBe(100);
    expect(result.details.sourceCredibility.meaning).toBe(
      "evidence_maturity_not_truth_probability",
    );
    expect(result.details.sourceCredibility.scoreBasisPoints).toBe(7000);
    expect(result.details.sourceCredibility.criterionCount).toBe(10);
    expect(result.details.sourceCredibility.calculation).toBe(
      "equal_weight_mean_verified_10000_partial_5000_missing_0",
    );
    expect(result.details.sourceCredibility.readiness).toBe(
      "limited_credibility",
    );
    expect(result.details.sourceCredibility.criticalGaps).toEqual([
      "freshness_receipt",
      "semantic_decoder",
      "entitlement_and_licence",
    ]);
    expect(result.details.featureCoverage.meaning).toBe(
      "installed_end_user_feature_coverage_not_data_completeness",
    );
    expect(result.details.featureCoverage.requirementCount).toBe(10);
    expect(result.details.featureCoverage.coveredCount).toBe(10);
    expect(result.details.featureCoverage.calculation).toBe(
      "set_union_covered_requirements_over_declared_requirements",
    );
    expect(result.details.featureCoverage.missingRequirements).not.toContain(
      "market_calendar",
    );
    expect(result.details.featureCoverage.missingRequirements).not.toContain(
      "effective_rules",
    );
    expect(result.details.featureCoverage.missingRequirements).toEqual([]);
  });

  test("typed tool switching persists and invalid slash input is rejected visibly", async () => {
    const instance = await harness();
    const notifications = [];
    const ctx = context(instance.entries, [], notifications);

    const result = await instance.tools.get("finance_track_switch").execute(
      "switch-1",
      { track: "cn" },
      new AbortController().signal,
      undefined,
      ctx,
    );
    expect(result.details.track).toBe("cn");
    expect(instance.entries.at(-1).data).toBe("cn");

    await expect(
      instance.tools.get("finance_track_switch").execute(
        "switch-bad",
        { track: "global" },
        new AbortController().signal,
        undefined,
        ctx,
      ),
    ).rejects.toThrow("cn, hk, or us track");

    await instance.commands.get("finance-track").handler("CN", ctx);
    expect(notifications.at(-1)).toEqual({
      kind: "error",
      message: "Unknown finance track 'CN'; use cn, hk, or us",
    });
  });

  test("malformed branch state and contact fail visibly", async () => {
    const entries = [entry("track-bad", "global")];
    const instance = await harness({
      initial: "cn",
      contact: "bad\ncontact",
      entries,
    });
    const statuses = [];
    const notifications = [];
    const ctx = context(entries, statuses, notifications);

    await instance.handlers.get("session_start")(
      { type: "session_start", reason: "resume" },
      ctx,
    );
    expect(statuses.at(-1).text).toBe(
      "CN · CNY · Asia/Shanghai · src:65% · feat:100%",
    );
    expect(notifications.at(-1)).toEqual({
      kind: "warning",
      message:
        "Finance track state could not be restored; using configured cn track",
    });

    const result = await instance.tools.get("finance_track_status").execute(
      "status-invalid",
      {},
      new AbortController().signal,
      undefined,
      { hasUI: false, ui: {} },
    );
    expect(result.details.configurationValid).toBeFalse();
  });

  test("tools from sibling tracks cannot inflate active-track coverage", async () => {
    const instance = await harness({
      initial: "cn",
      activeTools: [
        "finance_track_status",
        "finance_capabilities",
        "security_resolve",
        "sec_company_submissions",
        "sec_xbrl_facts",
        "stock_fundamental",
        "stock_fundamental_metric",
      ],
    });
    const statuses = [];
    const ctx = context(instance.entries, statuses);

    await instance.handlers.get("session_start")(
      { type: "session_start", reason: "startup" },
      ctx,
    );

    expect(statuses.at(-1).text).toBe(
      "CN · CNY · Asia/Shanghai · src:65% · feat:10%",
    );
    const result = await instance.tools.get("finance_track_status").execute(
      "status-isolated",
      {},
      new AbortController().signal,
      undefined,
      { hasUI: false, ui: {} },
    );
    expect(result.details.featureCoverage.coveredRequirements).toEqual([
      "navigation_context",
    ]);
    expect(result.details.featureCoverage.criticalGaps).toEqual([
      "source_registry",
      "security_identity",
    ]);
  });

  test("released inventory reports current CN and HK gaps without stale support-shell credit", async () => {
    const activeTools = [
      "finance_track_status",
      "list_sources",
      "cn_security_search",
      "cn_market_calendar",
      "cn_trading_rules",
      "cn_disclosure_search",
      "cn_stock_quote",
      "cn_stock_history",
      "cn_financial_metrics",
      "hk_security_search",
      "hk_market_calendar",
      "hk_trading_rules",
      "hk_disclosure_search",
      "hk_stock_quote",
      "hk_stock_history",
    ];
    const instance = await harness({ initial: "cn", activeTools });
    const statuses = [];
    const ctx = context(instance.entries, statuses);

    await instance.handlers.get("session_start")(
      { type: "session_start", reason: "startup" },
      ctx,
    );
    expect(statuses.at(-1).text).toBe(
      "CN · CNY · Asia/Shanghai · src:65% · feat:80%",
    );
    let result = await instance.tools.get("finance_track_status").execute(
      "released-cn",
      {},
      new AbortController().signal,
      undefined,
      { hasUI: false, ui: {} },
    );
    expect(result.details.featureCoverage.missingRequirements).toEqual([
      "raw_fundamentals",
      "normalized_fundamentals",
    ]);

    await instance.commands.get("hk-track").handler("", ctx);
    expect(statuses.at(-1).text).toBe(
      "HK · HKD · Asia/Hong_Kong · src:70% · feat:70%",
    );
    result = await instance.tools.get("finance_track_status").execute(
      "released-hk",
      {},
      new AbortController().signal,
      undefined,
      { hasUI: false, ui: {} },
    );
    expect(result.details.featureCoverage.missingRequirements).toEqual([
      "raw_fundamentals",
      "normalized_fundamentals",
      "reproducible_derivations",
    ]);
  });
});
