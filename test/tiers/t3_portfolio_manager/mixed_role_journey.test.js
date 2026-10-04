import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let directory;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const marker = (character) => character.repeat(64);

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "pi-sparkles-t3-"));
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function harness(name, entries = []) {
  const commands = new Map();
  const handlers = new Map();
  const tools = new Map();
  let nextEntry = entries.length;
  const api = {
    registerCommand(command, definition) {
      commands.set(command, definition);
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    on(event, handler) {
      const previous = handlers.get(event);
      handlers.set(event, previous ? async (...args) => { await previous(...args); return handler(...args); } : handler);
    },
    appendEntry(customType, data) {
      nextEntry += 1;
      entries.push({
        type: "custom",
        id: `t3-watchlist-${nextEntry}`,
        parentId: null,
        timestamp: "2026-08-12T01:00:00.000Z",
        customType,
        data,
      });
    },
  };
  const artifact = resolve(import.meta.dir, `../../../dist/${name}/index.js`);
  const module = await import(`${artifact}?t3=${Date.now()}-${Math.random()}`);
  await module.default(api);
  return { commands, entries, handlers, tools };
}

function execute(tool, input, id = "t3-role") {
  return tool.execute(
    id,
    input,
    new AbortController().signal,
    undefined,
    { hasUI: false, ui: {} },
  );
}

async function packetFile(name, value) {
  const text = JSON.stringify(value);
  const path = join(directory, name);
  await writeFile(path, text, "utf8");
  return { path, text, sha256: sha256(text) };
}

function packetInput(file, extra = {}) {
  return {
    path: file.path,
    expectedSha256: file.sha256,
    maximumBytes: 1_000_000,
    ...extra,
  };
}

function portfolioImportInput(path) {
  return {
    path,
    format: "json",
    delimiter: "comma",
    decimalConvention: "plain_dot",
    maximumBytes: 1_000_000,
    maximumRows: 100,
    maximumColumns: 100,
    maximumFieldBytes: 4096,
    maximumJsonDepth: 10,
    maximumJsonElements: 10_000,
    reconciliationTolerance: "0.01",
    accountVisibility: "redacted",
  };
}

function portfolioDocument() {
  return {
    snapshot: {
      snapshot_id: "mixed-snapshot-001",
      source_kind: "ImportedFile",
      account_id: "private-multi-market-account",
      base_currency: "USD",
      source_as_of: "2026-08-11T20:00:00Z",
      entitlement: "caller_private_local_use",
    },
    positions: [
      {
        position_id: "US-AAPL",
        track: "us",
        listing_id: "US0378331005",
        mic: "XNAS",
        source_symbol: "AAPL",
        security_name: "Apple Inc.",
        security_type: "CommonStock",
        direction: "Long",
        quantity: "10",
        quantity_unit: "shares",
        avg_cost: "180",
        cost_basis_total: "1800",
        current_mark: "200",
        mark_time: "2026-08-11T20:00:00Z",
        market_value: "2000",
        position_currency: "USD",
        unrealized_pnl: "200",
        source_row_id: "row-us",
      },
      {
        position_id: "CN-PAB",
        track: "cn",
        listing_id: "CN0000000001",
        mic: "XSHE",
        source_symbol: "000001",
        security_name: "平安银行",
        security_type: "CommonStock",
        direction: "Long",
        quantity: "100",
        quantity_unit: "shares",
        avg_cost: "10",
        cost_basis_total: "1000",
        current_mark: "12",
        mark_time: "2026-08-12T15:00:00+08:00",
        market_value: "1200",
        position_currency: "CNY",
        unrealized_pnl: "200",
        source_row_id: "row-cn",
      },
      {
        position_id: "HK-TENCENT",
        track: "hk",
        listing_id: "HK00700",
        mic: "XHKG",
        source_symbol: "00700",
        security_name: "腾讯控股",
        security_type: "CommonStock",
        direction: "Long",
        quantity: "20",
        quantity_unit: "shares",
        avg_cost: "400",
        cost_basis_total: "8000",
        current_mark: "450",
        mark_time: "2026-08-12T16:00:00+08:00",
        market_value: "9000",
        position_currency: "HKD",
        unrealized_pnl: "1000",
        source_row_id: "row-hk",
      },
    ],
  };
}

function riskSource(value, currency, unit, receipt, kind) {
  return {
    kind,
    reference: receipt,
    effectiveAtUnixMilliseconds: 1_776_000_000_000,
    retrievedAtUnixMilliseconds: 1_776_000_000_100,
    currency,
    unit,
    sourceLexeme: value,
    scope: "t3-mixed-portfolio-us-leg",
    retainedAlternatives: [],
  };
}

function knownRisk(value, currency, unit, receipt, kind) {
  return {
    state: "known",
    value,
    source: riskSource(value, currency, unit, receipt, kind),
    alternatives: [],
  };
}

function portfolioRiskInput(snapshotReceipt) {
  const asOf = 1_776_000_000_000;
  return {
    portfolioId: "mixed-snapshot-001:us-leg",
    instructionRef: marker("f"),
    account: {
      accountId: "redacted-account",
      netLiquidationValue: knownRisk(
        "10000",
        "USD",
        "currency",
        snapshotReceipt,
        "caller_declared",
      ),
      accountCurrency: "USD",
      asOfUnixMilliseconds: asOf,
      sourceKind: "caller_declared",
      sourceReceipt: snapshotReceipt,
    },
    positions: [{
      positionId: "US-AAPL",
      listingId: "US0378331005",
      mic: "XNAS",
      track: "us",
      direction: "long",
      quantity: knownRisk(
        "10",
        "N/A",
        "shares",
        marker("1"),
        "custodian_observation",
      ),
      quantityUnit: "shares",
      currentMark: knownRisk(
        "200",
        "USD",
        "currency_per_share",
        marker("2"),
        "provider_observation",
      ),
      markTimeUnixMilliseconds: asOf,
      desiredStop: knownRisk(
        "180",
        "USD",
        "currency_per_share",
        marker("3"),
        "llm_instruction",
      ),
      stopTimeUnixMilliseconds: asOf,
      positionCurrency: "USD",
      asOfUnixMilliseconds: asOf,
    }],
    calculation: {
      informationPolicy: "partial_totals_v1",
      heatVariant: "heat_mark_basis_v1",
      heatDenominator: { kind: "denom_nlv_v1" },
      positionWeightFormat: "fraction_v1",
      roundingMode: "half_up",
      currencyScale: 2,
      weightScale: 4,
      percentageScale: 2,
      intermediateScale: 8,
    },
    requestedSummaryFields: [
      "position_count",
      "gross_market_exposure",
      "portfolio_heat",
      "heat_pct",
      "position_contributions",
      "reconciliation",
      "temporal_coherence",
      "receipt_handle",
    ],
    projection: "receipt",
  };
}

function reviewCommon(contractId, operation, sourceReceipts) {
  return {
    schemaVersion: 1,
    contractId,
    operation,
    requestId: `${operation}-t3-request`,
    snapshotId: "mixed-snapshot-001",
    baseCurrency: "USD",
    scale: 6,
    rounding: "half_even",
    trackLegs: ["cn", "hk", "us"],
    sourceReceipts,
    assumptions: ["caller supplied explicit FX and policy receipts"],
  };
}

function sourcePacket(contractId, track, listingId, mic, kind, overrides = {}) {
  return {
    schemaVersion: 1,
    contractId,
    requestId: `${contractId}-${track}-request`,
    track,
    listingId,
    mic,
    rangeStart: "2026-08-01T00:00:00Z",
    rangeEnd: "2026-08-12T23:59:59Z",
    timezone: track === "us" ? "America/New_York" : "Asia/Shanghai",
    sources: [{
      sourceId: `${track}-source-1`,
      provider: overrides.provider ?? "rights-safe-scripted-source",
      authorityRole: overrides.authorityRole ?? "original_publisher_metadata",
      retrievedAt: "2026-08-12T01:00:00Z",
      coverage: "bounded_fixture_range_only",
      entitlement: "test_fixture_local_use",
      licence: "rights_safe_synthetic_fixture",
      contentHash: marker(track === "us" ? "4" : track === "hk" ? "5" : "6"),
      status: overrides.status ?? "complete_for_fixture",
      limitations: overrides.limitations ?? [],
    }],
    events: [{
      ordinal: 1,
      eventId: `${track}-event-1`,
      kind,
      title: overrides.title ?? `${track} source event`,
      language: overrides.language ?? "en",
      eventTime: overrides.eventTime ?? null,
      publicationTime: "2026-08-11T12:00:00Z",
      retrievalTime: "2026-08-12T01:00:00Z",
      effectiveTime: overrides.effectiveTime ?? null,
      sourceId: `${track}-source-1`,
      sourceReceipt: marker(track === "us" ? "7" : track === "hk" ? "8" : "9"),
      documentId: `${track}-document-1`,
      originalLexeme: overrides.originalLexeme ?? `${track} original metadata`,
      corrects: null,
      retracted: false,
    }],
    omissions: overrides.omissions ?? [],
  };
}

function monitorDefinition({
  monitorId,
  kind,
  track,
  mic,
  listingIds,
  portfolioReceipt = null,
  sourceScope,
  eventKinds,
  field,
  value,
  authorized,
  authorizationId,
  destinationRef,
}) {
  return {
    schemaVersion: 1,
    contractId: "finance_alerts_definition_v1",
    monitorId,
    version: 1,
    ownerKind: "user",
    ownerId: "portfolio-manager-1",
    scope: {
      kind,
      track,
      listingIds,
      mic,
      sourceScope,
      eventKinds,
      portfolioReceipt,
    },
    predicate: {
      kind: "caller_supplied",
      field,
      operator: "exact_equals",
      value,
    },
    temporal: {
      freshnessCutoffSeconds: 86_400,
      startAtUnixMilliseconds: 1_776_000_000_000,
      endAtUnixMilliseconds: null,
    },
    dedupe: {
      kind: "by_content_hash",
      windowSeconds: 86_400,
      cooldownSeconds: 0,
      scope: "per_monitor",
    },
    budgets: {
      maxEventsPerBatch: 100,
      maxMatchesPerBatch: 10,
      maxConsecutiveFailures: 5,
    },
    notificationAuthorization: {
      authorized,
      authorizationId,
      channel: "scripted_local",
      destinationRef,
      maximumAttempts: 2,
    },
    retentionPolicy: "caller_owned_append_only",
    parentEventId: null,
    sourceEntitlementReceipts: [marker("a")],
  };
}

function alertEventInput(journalPath, extra = {}) {
  return {
    journalPath,
    maximumJournalBytes: 2_000_000,
    expectedRevision: 0,
    eventId: "event-1",
    idempotencyKey: "idempotency-1",
    occurredAtUnixMilliseconds: 1_776_000_001_000,
    privacy: "review_visible",
    ...extra,
  };
}

function watchlistContext(entries) {
  return {
    mode: "tui",
    hasUI: true,
    sessionManager: { getBranch: () => entries },
    ui: { notify() {} },
  };
}

describe("T3 mixed portfolio-manager and monitoring role journey", () => {
  test("imports separate track legs, reviews exact facts, persists monitors, authorizes one alert, and resumes an auditable record", async () => {
    const portfolioFile = await packetFile("mixed-portfolio.json", portfolioDocument());
    const portfolio = await harness("portfolio");
    const imported = await execute(
      portfolio.tools.get("portfolio_import"),
      portfolioImportInput(portfolioFile.path),
      "import",
    );
    expect(imported.details).toMatchObject({
      snapshotId: "mixed-snapshot-001",
      baseCurrency: "USD",
      counts: { retainedRows: 3 },
      accountId: { state: "redacted" },
    });
    expect(imported.details.subtotals.map(({ currency }) => currency)).toEqual([
      "CNY",
      "HKD",
      "USD",
    ]);
    expect(imported.details.reconciliation.state).toBe("unperformed");
    expect(imported.details.reconciliation.reason).toBe(
      "source_declared_total_unavailable",
    );
    const positions = await execute(portfolio.tools.get("portfolio_positions"), {
      snapshotId: "mixed-snapshot-001",
      cursor: 0,
      limit: 10,
    });
    expect(positions.details.positions.map(({ track }) => track.value)).toEqual([
      "us",
      "cn",
      "hk",
    ]);
    const snapshotReceipt = imported.details.sourceFile.contentSha256;

    const risk = await execute(
      (await harness("portfolio_risk")).tools.get("portfolio_risk"),
      portfolioRiskInput(snapshotReceipt),
      "risk-us-leg",
    );
    expect(risk.details.result).toMatchObject({
      grossMarketExposure: { knownTotal: { value: "2000.00", currency: "USD" } },
      portfolioHeat: { knownTotal: { value: "200.00", currency: "USD" } },
    });
    const riskReceipt = risk.details.semanticReceiptHandle;

    const scenarioFile = await packetFile("scenario.json", {
      ...reviewCommon("portfolio_scenarios_v1", "run_scenario", [snapshotReceipt]),
      scenarioId: "manager-downside-1",
      scenarioLabel: "caller-defined parallel price shock",
      resultLabel: "hypothetical",
      nlv: "5000",
      positions: [
        { positionId: "US-AAPL", listingId: "US0378331005", track: "us", currency: "USD", quantity: "10", currentPrice: "200", fxToBase: null },
        { positionId: "CN-PAB", listingId: "CN0000000001", track: "cn", currency: "CNY", quantity: "100", currentPrice: "12", fxToBase: "0.14" },
        { positionId: "HK-TENCENT", listingId: "HK00700", track: "hk", currency: "HKD", quantity: "20", currentPrice: "450", fxToBase: "0.128" },
      ],
      shocks: [
        { shockId: "shock-us", kind: "price_shock", listingId: "US0378331005", value: "-0.10" },
        { shockId: "shock-cn", kind: "price_shock", listingId: "CN0000000001", value: "-0.05" },
        { shockId: "shock-hk", kind: "price_shock", listingId: "HK00700", value: "-0.08" },
      ],
    });
    const scenario = await execute(
      (await harness("portfolio_scenarios")).tools.get("run_scenario"),
      packetInput(scenarioFile),
      "scenario",
    );
    expect(scenario.details.canonicalReview.trackLegs).toEqual(["cn", "hk", "us"]);
    expect(scenario.details.canonicalReview.perPositionImpact.map(({ track }) => track)).toEqual(["us", "cn", "hk"]);
    expect(scenario.details.canonicalReview.resultLabel).toBe("hypothetical");

    const attributionFile = await packetFile("attribution.json", {
      ...reviewCommon("portfolio_attribution_v1", "attribution_brinson", [snapshotReceipt, marker("b")]),
      benchmarkId: "caller-benchmark-1",
      groups: [
        { groupId: "cn-leg", portfolioWeight: "0.20", portfolioReturn: "0.03", benchmarkWeight: "0.15", benchmarkReturn: "0.02" },
        { groupId: "hk-leg", portfolioWeight: "0.25", portfolioReturn: "-0.01", benchmarkWeight: "0.25", benchmarkReturn: "0.00" },
        { groupId: "us-leg", portfolioWeight: "0.55", portfolioReturn: "0.04", benchmarkWeight: "0.60", benchmarkReturn: "0.03" },
      ],
    });
    const attribution = await execute(
      (await harness("portfolio_attribution")).tools.get("attribution_brinson"),
      packetInput(attributionFile),
      "attribution",
    );
    expect(attribution.details.canonicalReview).toMatchObject({
      method: "brinson_fachler_v1",
      benchmarkId: "caller-benchmark-1",
      reconciliationDelta: "0",
      interpretation: "not_performed",
    });

    const rebalanceFile = await packetFile("rebalance.json", {
      ...reviewCommon("portfolio_rebalance_v1", "compute_rebalance", [snapshotReceipt]),
      proposalId: "manager-target-deltas-1",
      nlv: "5000",
      cash: "500",
      targetSourceReceipt: marker("c"),
      positions: [
        { positionId: "US-AAPL", track: "us", currency: "USD", currentValue: "2000", currentPrice: "200", fxToBase: null, targetWeight: "0.35", lotSize: "1", minimumTradeQuantity: "1" },
        { positionId: "CN-PAB", track: "cn", currency: "CNY", currentValue: "1200", currentPrice: "12", fxToBase: "0.14", targetWeight: "0.20", lotSize: "100", minimumTradeQuantity: "100" },
        { positionId: "HK-TENCENT", track: "hk", currency: "HKD", currentValue: "9000", currentPrice: "450", fxToBase: "0.128", targetWeight: "0.25", lotSize: "100", minimumTradeQuantity: "100" },
      ],
    });
    const rebalance = await execute(
      (await harness("portfolio_rebalance")).tools.get("compute_rebalance"),
      packetInput(rebalanceFile),
      "rebalance",
    );
    expect(rebalance.details.canonicalReview.proposalMeaning).toBe(
      "mechanical_deltas_not_orders_or_recommendations",
    );
    expect(rebalance.details.canonicalReview.trades.map(({ nativeCurrency, fxToBase }) => ({ nativeCurrency, fxToBase }))).toEqual([
      { nativeCurrency: "USD", fxToBase: "1" },
      { nativeCurrency: "CNY", fxToBase: "0.14" },
      { nativeCurrency: "HKD", fxToBase: "0.128" },
    ]);
    expect(JSON.stringify(rebalance.details)).not.toContain('"order"');

    const taxFile = await packetFile("tax-lots.json", {
      ...reviewCommon("tax_lots_v1", "realized_gain", [snapshotReceipt]),
      jurisdiction: "caller-rule-set-us-2026",
      jurisdictionRuleReceipt: marker("d"),
      holdingPeriodThresholdDays: 365,
      disposalMethod: "specific_identification",
      lots: [{
        lotId: "US-AAPL-lot-1",
        positionId: "US-AAPL",
        track: "us",
        currency: "USD",
        acquisitionDate: "2024-01-15",
        asOfDate: "2026-08-12",
        quantity: "10",
        acquisitionCost: "1800",
        currentMark: "200",
      }],
      sale: { quantity: "2", price: "205", selectedLotIds: ["US-AAPL-lot-1"] },
    });
    const taxLots = await execute(
      (await harness("tax_lots")).tools.get("realized_gain"),
      packetInput(taxFile),
      "tax-lots",
    );
    expect(taxLots.details.canonicalReview).toMatchObject({
      taxMeaning: "caller_rule_mechanics_not_tax_advice",
      realizedSale: { state: "calculated", realizedGain: "50" },
      lots: [{ holdingClassification: "long_term", currency: "USD" }],
    });

    const filingFile = await packetFile(
      "filing-events.json",
      sourcePacket("filing_monitor_v1", "us", "US0378331005", "XNAS", "FilingAmended", {
        title: "10-Q amendment",
        provider: "sec-edgar-receipt",
      }),
    );
    const filing = await execute(
      (await harness("filing_monitor")).tools.get("filing_monitor_query"),
      packetInput(filingFile, { offset: 0, limit: 50 }),
      "filing",
    );
    expect(filing.details.canonicalTimeline).toMatchObject({
      track: "us",
      mic: "XNAS",
      eventCount: 1,
      events: [{ kind: "FilingAmended" }],
      causalFields: [],
    });

    const catalystFile = await packetFile(
      "catalyst-events.json",
      sourcePacket("finance_catalysts_v1", "hk", "HK00700", "XHKG", "CorporateAction", {
        title: "股份回購報告",
        language: "zh-Hant",
        status: "track_partial",
        limitations: ["fixture covers one published corporate action"],
        omissions: ["news source unavailable in this bounded batch"],
      }),
    );
    const catalyst = await execute(
      (await harness("finance_catalysts")).tools.get("catalyst_timeline"),
      packetInput(catalystFile, { offset: 0, limit: 50 }),
      "catalyst",
    );
    expect(catalyst.details.canonicalTimeline).toMatchObject({
      track: "hk",
      omissions: ["news source unavailable in this bounded batch"],
      noMatchMeaning: "no_event_in_supplied_bounded_receipts_not_absence_proof",
      events: [{ language: "zh-Hant", kind: "CorporateAction" }],
    });

    const cnWatchFile = await packetFile(
      "cn-watch-events.json",
      sourcePacket("cn_stock_watch_v1", "cn", "CN0000000001", "XSHE", "Announcement", {
        title: "关于召开股东大会的公告",
        language: "zh-Hans",
        originalLexeme: "关于召开股东大会的公告",
      }),
    );
    const cnWatch = await execute(
      (await harness("cn_stock_watch")).tools.get("cn_stock_watch_query"),
      packetInput(cnWatchFile, { offset: 0, limit: 50 }),
      "cn-watch",
    );
    expect(cnWatch.details.canonicalTimeline).toMatchObject({
      track: "cn",
      mic: "XSHE",
      events: [{ kind: "Announcement", language: "zh-Hans" }],
    });
    await expect(
      execute(
        (await harness("filing_monitor")).tools.get("filing_monitor_query"),
        packetInput(filingFile, { expectedSha256: marker("0"), offset: 0, limit: 50 }),
        "changed-receipt",
      ),
    ).rejects.toThrow("does not match expectedSha256");

    const watchlist = await harness("watchlist");
    await watchlist.handlers.get("session_start")(
      { type: "session_start", reason: "startup" },
      watchlistContext(watchlist.entries),
    );
    for (const member of [
      { watchlist: "mixed-manager", track: "us", instrumentId: "isin:US0378331005", symbol: "AAPL", mic: "XNAS", tags: ["portfolio"] },
      { watchlist: "mixed-manager", track: "cn", instrumentId: "cninfo:000001", symbol: "000001", mic: "XSHE", tags: ["portfolio"] },
      { watchlist: "mixed-manager", track: "hk", instrumentId: "hkex:00700", symbol: "00700", mic: "XHKG", tags: ["portfolio"] },
    ]) {
      await execute(watchlist.tools.get("watchlist_add"), member, `watch-${member.track}`);
    }
    const watchlistSnapshot = await execute(watchlist.tools.get("watchlist_snapshot"), {});
    expect(watchlistSnapshot.details.watchlists[0].members.map(({ track }) => track)).toEqual(["cn", "hk", "us"]);
    expect(watchlistSnapshot.details.persistence).toBe("session_branch_versioned_event_log");

    const alertJournal = join(directory, "alerts.jsonl");
    const alerts = await harness("finance_alerts");
    const companyDefinition = await packetFile("company-monitor.json", monitorDefinition({
      monitorId: "cn-company-monitor",
      kind: "company",
      track: "cn",
      mic: "XSHE",
      listingIds: ["CN0000000001"],
      sourceScope: ["cn_stock_watch"],
      eventKinds: ["Announcement"],
      field: "event_kind",
      value: "Announcement",
      authorized: false,
      authorizationId: "no-company-delivery",
      destinationRef: "disabled-company-destination",
    }));
    await execute(alerts.tools.get("alert_define"), alertEventInput(alertJournal, {
      eventId: "define-company-1",
      idempotencyKey: "define-company-v1",
      packetPath: companyDefinition.path,
      expectedSha256: companyDefinition.sha256,
      maximumPacketBytes: 1_000_000,
    }), "define-company");

    const portfolioDefinition = await packetFile("portfolio-monitor.json", monitorDefinition({
      monitorId: "mixed-portfolio-us-risk-monitor",
      kind: "portfolio",
      track: "us",
      mic: "XNAS",
      listingIds: [],
      portfolioReceipt: snapshotReceipt,
      sourceScope: ["portfolio_risk"],
      eventKinds: ["PortfolioRiskFact"],
      field: "review_state",
      value: "review_required",
      authorized: true,
      authorizationId: "manager-alert-auth-1",
      destinationRef: "opaque-manager-inbox",
    }));
    await expect(
      execute(alerts.tools.get("alert_define"), alertEventInput(alertJournal, {
        expectedRevision: 0,
        eventId: "define-portfolio-stale",
        idempotencyKey: "define-portfolio-stale",
        packetPath: portfolioDefinition.path,
        expectedSha256: portfolioDefinition.sha256,
        maximumPacketBytes: 1_000_000,
      }), "stale-cas"),
    ).rejects.toThrow("currentRevision=1");
    await execute(alerts.tools.get("alert_define"), alertEventInput(alertJournal, {
      expectedRevision: 1,
      eventId: "define-portfolio-1",
      idempotencyKey: "define-portfolio-v1",
      packetPath: portfolioDefinition.path,
      expectedSha256: portfolioDefinition.sha256,
      maximumPacketBytes: 1_000_000,
    }), "define-portfolio");

    const companyBatch = await packetFile("company-batch.json", {
      schemaVersion: 1,
      contractId: "finance_alerts_batch_v1",
      batchId: "cn-company-batch-1",
      monitorId: "cn-company-monitor",
      evaluatedAtUnixMilliseconds: 1_776_000_003_000,
      observations: [{
        observationId: "cn-event-observation-1",
        eventIdentity: "cn-event-1",
        contentHash: cnWatch.details.canonicalContentHash,
        observedAtUnixMilliseconds: 1_776_000_002_000,
        knowledgeAtUnixMilliseconds: 1_776_000_002_000,
        corrects: null,
        fields: [{ name: "event_kind", state: "known", value: "Announcement" }],
      }],
      sourceReceipts: [cnWatch.details.canonicalContentHash],
    });
    const companyEvaluation = await execute(alerts.tools.get("alert_evaluate"), alertEventInput(alertJournal, {
      expectedRevision: 2,
      eventId: "evaluate-company-1",
      idempotencyKey: "evaluate-company-batch-1",
      occurredAtUnixMilliseconds: 1_776_000_003_000,
      packetPath: companyBatch.path,
      expectedSha256: companyBatch.sha256,
      maximumPacketBytes: 1_000_000,
    }), "evaluate-company");
    expect(companyEvaluation.details).toMatchObject({
      matchCount: 1,
      silenceMeaning: "no_supplied_observation_matched_not_all_clear",
    });

    const portfolioBatch = await packetFile("portfolio-batch.json", {
      schemaVersion: 1,
      contractId: "finance_alerts_batch_v1",
      batchId: "portfolio-risk-batch-1",
      monitorId: "mixed-portfolio-us-risk-monitor",
      evaluatedAtUnixMilliseconds: 1_776_000_004_000,
      observations: [{
        observationId: "risk-observation-1",
        eventIdentity: riskReceipt,
        contentHash: riskReceipt,
        observedAtUnixMilliseconds: 1_776_000_003_500,
        knowledgeAtUnixMilliseconds: 1_776_000_003_500,
        corrects: null,
        fields: [{ name: "review_state", state: "known", value: "review_required" }],
      }],
      sourceReceipts: [riskReceipt],
    });
    const portfolioEvaluation = await execute(alerts.tools.get("alert_evaluate"), alertEventInput(alertJournal, {
      expectedRevision: 3,
      eventId: "evaluate-portfolio-1",
      idempotencyKey: "evaluate-portfolio-batch-1",
      occurredAtUnixMilliseconds: 1_776_000_004_000,
      packetPath: portfolioBatch.path,
      expectedSha256: portfolioBatch.sha256,
      maximumPacketBytes: 1_000_000,
    }), "evaluate-portfolio");
    expect(portfolioEvaluation.details.matchCount).toBe(1);
    const matchId = portfolioEvaluation.details.results[0].matchId;

    const notifyInput = alertEventInput(alertJournal, {
      expectedRevision: 4,
      eventId: "notify-portfolio-1",
      idempotencyKey: "notify-portfolio-match-1",
      occurredAtUnixMilliseconds: 1_776_000_005_000,
      monitorId: "mixed-portfolio-us-risk-monitor",
      matchId,
      authorizationId: "manager-alert-auth-1",
      channel: "scripted_local",
      destinationRef: "opaque-manager-inbox",
      attempt: 1,
      scriptedOutcome: "delivered",
    });
    await expect(
      execute(alerts.tools.get("alert_notify"), {
        ...notifyInput,
        authorizationId: "wrong-authorization",
      }, "unauthorized-notification"),
    ).rejects.toThrow("not explicitly authorized");
    const notified = await execute(alerts.tools.get("alert_notify"), notifyInput, "authorized-notification");
    expect(notified.details).toMatchObject({
      monitorId: "mixed-portfolio-us-risk-monitor",
      matchId,
      status: "delivered",
      destinationPrivacy: "opaque_reference_only",
    });
    const repeatedNotification = await execute(alerts.tools.get("alert_notify"), notifyInput, "idempotent-notification-retry");
    expect(repeatedNotification.details).toMatchObject({
      effectRepeated: false,
      journalRevision: 5,
    });

    const resumedAlerts = await harness("finance_alerts");
    const companyState = await execute(resumedAlerts.tools.get("alert_inspect"), {
      journalPath: alertJournal,
      maximumJournalBytes: 2_000_000,
      monitorId: "cn-company-monitor",
      includePrivate: false,
      maximumEvents: 20,
    }, "resume-company");
    const portfolioState = await execute(resumedAlerts.tools.get("alert_inspect"), {
      journalPath: alertJournal,
      maximumJournalBytes: 2_000_000,
      monitorId: "mixed-portfolio-us-risk-monitor",
      includePrivate: false,
      maximumEvents: 20,
    }, "resume-portfolio");
    expect(companyState.details.monitor).toMatchObject({
      journalRevision: 5,
      monitorId: "cn-company-monitor",
      returnedEventCount: 2,
    });
    expect(portfolioState.details.monitor).toMatchObject({
      journalRevision: 5,
      monitorId: "mixed-portfolio-us-risk-monitor",
      returnedEventCount: 3,
      persistence: "user_owned_append_only_jsonl_atomic_cas",
    });
    expect(portfolioState.details.monitor.events.map(({ event }) => event.kind)).toEqual([
      "definition",
      "evaluation",
      "notification",
    ]);

    const reviewPacket = await packetFile("manager-review.json", {
      schemaVersion: 1,
      contractId: "portfolio_review_v1",
      reviewId: "mixed-review-001",
      snapshotId: "mixed-snapshot-001",
      reviewAsOf: "2026-08-12T10:00:00+08:00",
      reviewerKind: "user",
      reviewerId: "portfolio-manager-1",
      priorReviewId: null,
      supersedes: null,
      changedSections: ["risk", "scenario", "attribution", "rebalance", "tax_lots", "monitoring"],
      receiptLinks: [
        { section: "snapshot", receipt: snapshotReceipt },
        { section: "risk", receipt: riskReceipt },
        { section: "scenario", receipt: scenario.details.canonicalContentHash },
        { section: "attribution", receipt: attribution.details.canonicalContentHash },
        { section: "rebalance", receipt: rebalance.details.canonicalContentHash },
        { section: "tax_lots", receipt: taxLots.details.canonicalContentHash },
        { section: "monitoring", receipt: portfolioState.details.canonicalContentHash },
      ],
      conclusionRef: "manager-owned-review-conclusion-001",
      privacy: "review_visible",
    });
    const reviewJournal = join(directory, "portfolio-reviews.jsonl");
    const recorded = await execute(portfolio.tools.get("portfolio_review_record"), {
      journalPath: reviewJournal,
      maximumJournalBytes: 1_000_000,
      expectedRevision: 0,
      eventId: "portfolio-review-event-1",
      idempotencyKey: "portfolio-review-idempotency-1",
      packetPath: reviewPacket.path,
      expectedSha256: reviewPacket.sha256,
      maximumPacketBytes: 1_000_000,
    }, "record-review");
    expect(recorded.details.receiptLinks).toHaveLength(7);

    const resumedPortfolio = await harness("portfolio");
    const durableReview = await execute(resumedPortfolio.tools.get("portfolio_review_inspect"), {
      journalPath: reviewJournal,
      maximumJournalBytes: 1_000_000,
      reviewId: "mixed-review-001",
      includePrivate: false,
      maximumHistory: 20,
    }, "resume-review");
    expect(durableReview.details.portfolioReview).toMatchObject({
      journalRevision: 1,
      persistence: "user_owned_append_only_jsonl_atomic_cas",
      selected: {
        snapshotId: "mixed-snapshot-001",
        conclusionRef: "manager-owned-review-conclusion-001",
      },
    });
    expect(await readFile(alertJournal, "utf8")).not.toContain("private-multi-market-account");
    expect(await readFile(reviewJournal, "utf8")).not.toContain(portfolioFile.path);
  });
});
