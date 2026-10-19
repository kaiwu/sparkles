// DSH storage/timer interpreter for the shared Gleam watchlist review laws.
// Each owner's row is the atomic checkpoint: source intent, outcome, progress,
// saved picks, admission identities and receipts never span table writes.
import { createHash } from "node:crypto";
import { z } from "zod";

export const REVIEW_EVENT = "plugin:pi-sparkles/watchlist-reviews";
export const REVIEW_PROJECTION = "piSparklesWatchlistReviews";
const MAX_ROW_BYTES = 25 * 1024 * 1024;
const MAX_DOMAIN_BYTES = 100 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 32 * 1024;
const MAX_TIMER_DELAY = 2_147_483_647;
const json = (value) => JSON.stringify(value);
const copy = (value) => structuredClone(value);
const canonical = (value) => JSON.stringify(value, (_key, item) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const integer = z.number().int().nonnegative().safe();
const identifier = z.string().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/)
  .refine((value) => !["__proto__", "constructor", "prototype"].includes(value));
const savedSchema = z.object({ snapshotJson: z.string().max(1_000_000), snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const outcomeSchema = z.object({
  state: z.enum(["attempting", "obtained", "interrupted", "failed", "unavailable"]),
  result: z.json().optional(),
  registryInvoked: z.boolean().nullable(),
}).strict();
const planSchema = z.object({
  requestId: identifier, watchlist: z.string(), provider: z.literal("eastmoney"),
  snapshotJson: z.string().max(1_000_000), snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/),
  firstDueUnixMilliseconds: integer, intervalMilliseconds: integer,
  maximumReviews: integer.min(1).max(30), maximumRequestsPerReview: integer.min(1).max(10),
  identityStatus: z.literal("caller_declared_unverified"),
}).strict();
const jobSchema = z.object({
  requestId: identifier, plan: planSchema,
  status: z.enum(["scheduled", "running", "completed", "cancelled"]),
  due: integer, completedReviews: integer.max(30), cycle: z.json().nullable(),
  index: integer.max(10), facts: z.array(z.json()).max(10),
  outcomes: z.record(z.string(), outcomeSchema),
  latest: z.json().nullable(),
  receipts: z.array(z.json()).max(30),
}).strict();
export const ownerSchema = z.object({
  schemaVersion: z.literal(1), ownerSessionId: z.string().min(1),
  enabled: z.boolean(), paused: z.boolean(), revision: integer.max(500),
  saved: savedSchema.nullable(),
  admissions: z.record(identifier, z.object({ fingerprint: z.string(), result: z.json() }).strict())
    .refine((value) => Object.keys(value).length <= 500),
  jobs: z.array(jobSchema).max(10),
}).strict();
export const reviewDomain = {
  name: "sparkles_watchlist_reviews", version: 1,
  tables: { owners: { valueSchema: ownerSchema } },
};

function admitted(result) {
  if (!result.isOk()) throw new Error(result[0]);
  return JSON.parse(result[0]);
}

function emptyOwner(id) {
  return { schemaVersion: 1, ownerSessionId: id, enabled: false, paused: false,
    revision: 0, saved: null, admissions: {}, jobs: [] };
}

function receiptView(receipt) {
  if (receipt === null) return null;
  const { sourceOutcomes, ...view } = receipt;
  return view;
}

export function reviewView(owner) {
  return {
    schemaVersion: 1, ownerSessionId: owner.ownerSessionId,
    enabled: owner.enabled, paused: owner.paused, storeRevision: owner.revision,
    jobs: owner.jobs.map((job) => ({
      requestId: job.requestId, status: job.status,
      completedReviews: job.completedReviews, maximumReviews: job.plan.maximumReviews,
      nextDueUnixMilliseconds: ["scheduled", "running"].includes(job.status) ? job.due : null,
      snapshotSha256: job.plan.snapshotSha256, latest: receiptView(job.latest),
    })),
    scheduling: "active_while_dsh_host_runs", storageScope: "original_session",
  };
}

export function reviewProjection() {
  const viewSchema = z.object({
    schemaVersion: z.literal(1), ownerSessionId: z.string(), enabled: z.boolean(), paused: z.boolean(),
    storeRevision: integer, jobs: z.array(z.json()).max(10),
    scheduling: z.literal("active_while_dsh_host_runs"), storageScope: z.literal("original_session"),
  }).strict().nullable();
  return {
    key: REVIEW_PROJECTION, stateVersion: 1,
    stateSchema: z.object({ ownerSessionId: z.string(), view: viewSchema }).strict(),
    init: (header) => ({ ownerSessionId: String(header.id), view: null }),
    apply(state, event) {
      if (event.type !== REVIEW_EVENT || event.ignorable !== true) return state;
      const parsed = viewSchema.safeParse(event.data);
      return parsed.success && parsed.data?.ownerSessionId === state.ownerSessionId
        ? { ...state, view: parsed.data } : state;
    },
    wire: { viewSchema, view: (state) => state.view },
  };
}

export function createReviewRunner({
  table, laws, resolveAgent, invoke, publish = () => {},
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  log = () => {},
}) {
  let queue = Promise.resolve();
  let timer;
  let driving;
  let stopped = false;
  let requested = false;
  const active = new Map();
  const failures = new Map();
  const serial = (action) => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const owner = (id) => copy(table.get(id) ?? emptyOwner(id));
  const jobOf = (row, requestId) => row.jobs.find((job) => job.requestId === requestId);
  const key = (id, requestId) => json([id, requestId]);
  const live = (row, job) => row.enabled && !row.paused && job && ["scheduled", "running"].includes(job.status);

  function validate(row) {
    ownerSchema.parse(row);
    if (row.saved) admitted(laws.admit_save(json({ requestId: "validate", expectedRevision: 0, ...row.saved })));
    if (new Set(row.jobs.map((job) => job.requestId)).size !== row.jobs.length) throw new Error("duplicate_stored_review_identity");
    for (const job of row.jobs) {
      const plan = admitted(laws.admit_schedule(job.plan.snapshotJson, json({
        requestId: job.requestId, watchlist: job.plan.watchlist, provider: job.plan.provider,
        shareClass: "a_share", maximumRequestsPerReview: job.plan.maximumRequestsPerReview,
        firstDueUnixMilliseconds: job.plan.firstDueUnixMilliseconds,
        intervalMilliseconds: job.plan.intervalMilliseconds, maximumReviews: job.plan.maximumReviews,
      }), job.plan.firstDueUnixMilliseconds, false));
      if (canonical(plan) !== canonical(job.plan) || job.completedReviews > plan.maximumReviews ||
          job.facts.length !== job.index || job.receipts.length !== job.completedReviews ||
          canonical(job.latest) !== canonical(job.receipts.at(-1) ?? null) ||
          (job.status === "completed" && job.completedReviews !== plan.maximumReviews)) {
        throw new Error("invalid_stored_review_checkpoint");
      }
      if (job.cycle !== null && canonical(admitted(laws.cycle(json(plan), job.cycle.startedAtUnixMilliseconds))) !== canonical(job.cycle)) {
        throw new Error("invalid_stored_review_cycle");
      }
      if (job.cycle === null && (job.index !== 0 || Object.keys(job.outcomes).length !== 0)) throw new Error("invalid_stored_review_progress");
      if (job.cycle !== null && (job.index > job.cycle.picks.length ||
          Object.keys(job.outcomes).some((index) => !/^[0-9]$/.test(index) || Number(index) > job.index))) {
        throw new Error("invalid_stored_review_progress");
      }
      for (const [index, receipt] of job.receipts.entries()) {
        const { receiptSha256, ...content } = receipt;
        if (receiptSha256 !== digest(canonical(content)) || receipt.requestId !== job.requestId ||
            receipt.snapshotSha256 !== plan.snapshotSha256 || receipt.cycleIndex !== index ||
            !Array.isArray(receipt.facts) || receipt.facts.length > 10) throw new Error("invalid_stored_review_receipt");
        const picks = admitted(laws.cycle(json(plan), receipt.startedAtUnixMilliseconds)).picks;
        if (receipt.facts.length !== picks.length || !Array.isArray(receipt.sourceOutcomes) ||
            receipt.sourceOutcomes.length !== picks.length) throw new Error("invalid_stored_review_receipt");
        for (const [pickIndex, pick] of picks.entries()) {
          const previous = job.receipts[index - 1]?.facts.find((fact) => fact.key === pick.key) ?? null;
          const outcome = outcomeSchema.parse(receipt.sourceOutcomes[pickIndex]);
          if (outcome.state === "attempting" || Buffer.byteLength(json(outcome)) > MAX_RECEIPT_BYTES + 1024) throw new Error("invalid_stored_review_source");
          let fact;
          try { fact = admitted(laws.project(json(pick), json(outcome), json(previous))); }
          catch { fact = admitted(laws.project(json(pick), json({ state: "failed" }), json(previous))); }
          if (canonical(fact) !== canonical(receipt.facts[pickIndex])) throw new Error("invalid_stored_review_fact");
        }
      }
      for (const [index, fact] of job.facts.entries()) {
        const pick = job.cycle.picks[index];
        const outcome = job.outcomes[index];
        if (!outcome || outcome.state === "attempting") throw new Error("invalid_stored_review_progress");
        const previous = job.latest?.facts.find((prior) => prior.key === pick.key) ?? null;
        let expected;
        try { expected = admitted(laws.project(json(pick), json(outcome), json(previous))); }
        catch { expected = admitted(laws.project(json(pick), json({ state: "failed" }), json(previous))); }
        if (canonical(fact) !== canonical(expected)) throw new Error("invalid_stored_review_fact");
      }
    }
    if (Buffer.byteLength(json(row)) > MAX_ROW_BYTES) throw new Error("watchlist_store_budget_exceeded");
  }

  async function commit(row) {
    validate(row);
    const bytes = [...table.entries()].reduce((sum, [id, value]) =>
      sum + (id === row.ownerSessionId ? 0 : Buffer.byteLength(json(value))), Buffer.byteLength(json(row)));
    if (bytes > MAX_DOMAIN_BYTES) throw new Error("watchlist_domain_budget_exceeded");
    await table.put(row.ownerSessionId, row);
    // UI publication is a replayable read model; the domain row owns execution.
    try { await publish(row.ownerSessionId, reviewView(row)); }
    catch { log("watchlist_review_projection_unavailable"); }
  }

  async function mutate(id, action) {
    return serial(async () => {
      if (stopped) throw new Error("watchlist_review_runner_closed");
      const row = owner(id);
      const result = await action(row);
      await commit(row);
      failures.delete(id);
      return result;
    });
  }

  async function operation(id, operation, input = {}, signal) {
    signal?.throwIfAborted();
    if (stopped) throw new Error("watchlist_review_runner_closed");
    if (typeof id !== "string" || id.length === 0) throw new Error("watchlist_owner_session_required");
    if (operation === "status") {
      const row = owner(id);
      const view = { ...reviewView(row), runnerError: failures.get(id) ?? null };
      if (input.requestId !== undefined) {
        const selected = jobOf(row, identifier.parse(input.requestId));
        if (!selected) throw new Error("review_request_not_found");
        if (input.cycleIndex !== undefined) {
          const index = integer.max(29).parse(input.cycleIndex);
          if (!selected.receipts[index]) throw new Error("review_cycle_not_found");
          return { ...view, receipt: selected.receipts[index] };
        }
        return { ...view, receipts: selected.receipts.map(receiptView) };
      }
      if (input.cycleIndex !== undefined) throw new Error("review_request_id_required");
      return view;
    }
    if (operation === "snapshot") {
      const row = owner(id);
      return { storeRevision: row.revision, saved: row.saved, enabled: row.enabled, paused: row.paused,
        storageScope: "original_session", maximumStoreBytes: MAX_ROW_BYTES,
        maximumDomainBytes: MAX_DOMAIN_BYTES, maximumSourceReceiptBytes: MAX_RECEIPT_BYTES };
    }
    if (operation === "control") {
      if (!["enable", "close", "disable"].includes(input.action)) throw new Error("invalid_watchlist_control");
      if (input.action === "enable" && input.userAccepted !== true) throw new Error("watchlist_requires_user_acceptance");
      const result = await mutate(id, (row) => {
        row.enabled = input.action === "enable" ? true : input.action === "disable" ? false : row.enabled;
        row.paused = input.action !== "enable";
        return reviewView(row);
      });
      if (input.action !== "enable") for (const execution of active.values()) {
        if (execution.owner === id) execution.control.abort(new Error("watchlist_paused"));
      }
      wake();
      return result;
    }
    if (operation === "cancel") {
      const requestId = identifier.parse(input.requestId);
      let result;
      try {
        result = await mutate(id, (row) => {
          const job = jobOf(row, requestId);
          if (!job) throw new Error("review_request_not_found");
          if (["scheduled", "running"].includes(job.status)) job.status = "cancelled";
          return { requestId, status: job.status };
        });
      } catch (error) { failures.set(id, "watchlist_review_cancel_checkpoint_failed"); throw error; }
      finally { active.get(key(id, requestId))?.control.abort(new Error("watchlist_cancelled")); }
      wake();
      return result;
    }
    if (!["save", "run", "schedule"].includes(operation)) throw new Error("invalid_watchlist_operation");
    const fingerprint = digest(canonical({ operation, input }));
    const result = await mutate(id, (row) => {
      signal?.throwIfAborted();
      if (!row.enabled || row.paused) throw new Error("watchlist_not_enabled");
      const requestId = identifier.parse(input.requestId);
      const prior = row.admissions[requestId];
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new Error("watchlist_request_id_conflict");
        return prior.result;
      }
      if (Object.keys(row.admissions).length >= 500) throw new Error("watchlist_admission_budget_exceeded");
      let admittedResult;
      if (operation === "save") {
        const plan = admitted(laws.admit_save(json(input)));
        if (plan.expectedRevision !== row.revision) throw new Error("watchlist_store_revision_conflict");
        row.saved = { snapshotJson: plan.snapshotJson, snapshotSha256: plan.snapshotSha256 };
        row.revision += 1;
        admittedResult = { storeRevision: row.revision, snapshotSha256: plan.snapshotSha256 };
      } else {
        if (row.jobs.length >= 10) throw new Error("watchlist_schedule_budget_exceeded");
        const plan = admitted(laws.admit_schedule(row.saved?.snapshotJson ?? "null", json(input), now(), operation === "run"));
        row.jobs.push({ requestId, plan, status: "scheduled", due: plan.firstDueUnixMilliseconds,
          completedReviews: 0, cycle: null, index: 0, facts: [], outcomes: {}, latest: null, receipts: [] });
        admittedResult = { requestId, snapshotSha256: plan.snapshotSha256, maximumReviews: plan.maximumReviews };
      }
      row.admissions[requestId] = { fingerprint, result: admittedResult };
      return admittedResult;
    });
    wake();
    if (operation === "run") {
      const cancel = () => { void operationForAbort(); };
      const operationForAbort = () => operationCancel(id, input.requestId);
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        if (signal?.aborted) await operationForAbort();
        await drain();
        signal?.throwIfAborted();
        if (failures.has(id)) throw new Error(failures.get(id));
        const completed = jobOf(owner(id), input.requestId);
        if (!completed || ["scheduled", "running"].includes(completed.status)) throw new Error("watchlist_review_not_completed");
      } finally { signal?.removeEventListener("abort", cancel); }
    }
    return operation === "run" ? { ...result, job: reviewView(owner(id)).jobs.find((job) => job.requestId === input.requestId) } : result;
  }

  async function operationCancel(id, requestId) {
    try {
      await mutate(id, (row) => {
        const job = jobOf(row, requestId);
        if (job && ["scheduled", "running"].includes(job.status)) job.status = "cancelled";
      });
    } catch {
      failures.set(id, "watchlist_review_cancel_checkpoint_failed");
      log("watchlist_review_cancel_checkpoint_failed");
    } finally { active.get(key(id, requestId))?.control.abort(new Error("watchlist_run_aborted")); }
  }

  async function executeJob(id, requestId) {
    const control = new AbortController();
    const identity = key(id, requestId);
    const execution = { owner: id, control, agent: null };
    active.set(identity, execution);
    try {
      let row = owner(id), job = jobOf(row, requestId);
      if (!live(row, job)) return;
      if (job.cycle === null) await mutate(id, (next) => {
        const current = jobOf(next, requestId);
        if (!live(next, current)) return;
        current.cycle = admitted(laws.cycle(json(current.plan), now()));
        current.status = "running";
      });
      for (;;) {
        if (stopped || control.signal.aborted) return;
        row = owner(id); job = jobOf(row, requestId);
        if (!live(row, job)) return;
        const pick = job.cycle.picks[job.index];
        if (!pick) break;
        const index = job.index;
        let outcome = job.outcomes[index];
        if (pick.tool === null) outcome = { state: "unavailable", registryInvoked: false };
        else if (outcome?.state === "attempting") outcome = { state: "interrupted", registryInvoked: null };
        else if (!outcome) {
          // Checkpoint BEFORE any resolution or provider effect. An interrupted
          // attempt never acquires another observation under this identity.
          await mutate(id, (next) => { jobOf(next, requestId).outcomes[index] = { state: "attempting", registryInvoked: null }; });
          if (stopped || control.signal.aborted) return;
          try {
            const agent = await resolveAgent(id);
            if (!agent || String(agent.id) !== id || String(agent.session?.id) !== id) throw new Error("watchlist_owner_resolution_failed");
            execution.agent = agent;
            control.signal.throwIfAborted();
            const response = await invoke(agent, pick.tool, pick.args, control.signal,
              `sparkles-review:${id}:${requestId}:${job.completedReviews}:${index}`);
            if (Buffer.byteLength(json(response)) > MAX_RECEIPT_BYTES) throw new Error("watchlist_source_receipt_budget_exceeded");
            outcome = response.isError || !response.value
              ? { state: "failed", registryInvoked: true }
              : { state: "obtained", registryInvoked: true, result: response.value };
          } catch {
            if (stopped || control.signal.aborted) return;
            outcome = { state: "failed", registryInvoked: null };
          }
          if (stopped || control.signal.aborted) return;
          await mutate(id, (next) => { jobOf(next, requestId).outcomes[index] = outcome; });
        }
        const previous = job.latest?.facts.find((fact) => fact.key === pick.key) ?? null;
        let fact;
        try { fact = admitted(laws.project(json(pick), json(outcome), json(previous))); }
        catch { fact = admitted(laws.project(json(pick), json({ state: "failed" }), json(previous))); }
        await mutate(id, (next) => {
          const current = jobOf(next, requestId);
          if (!live(next, current)) return;
          current.outcomes[index] = outcome;
          current.facts.push(fact);
          current.index += 1;
        });
      }
      if (stopped || control.signal.aborted) return;
      await mutate(id, (next) => {
        const current = jobOf(next, requestId);
        if (!live(next, current)) return;
        const [due, missed] = laws.next_due(current.due, current.plan.intervalMilliseconds, now());
        const outcomes = Object.values(current.outcomes);
        const receipt = {
          schema: "pi-sparkles/watch-review-receipt", schemaVersion: 1,
          requestId, cycleIndex: current.completedReviews, snapshotSha256: current.plan.snapshotSha256,
          watchlist: current.plan.watchlist, dueAtUnixMilliseconds: current.due,
          startedAtUnixMilliseconds: current.cycle.startedAtUnixMilliseconds,
          finishedAtUnixMilliseconds: now(), missedIntervals: missed,
          sourceAttempts: current.cycle.picks.filter((pick) => pick.tool !== null).length,
          registryInvocations: outcomes.some((value) => value.registryInvoked === null) ? null
            : outcomes.filter((value) => value.registryInvoked).length,
          toolInvocations: null, transportRequests: null, facts: current.facts,
          sourceOutcomes: current.cycle.picks.map((_pick, index) => current.outcomes[index]),
        };
        current.latest = { ...receipt, receiptSha256: digest(canonical(receipt)) };
        current.receipts.push(current.latest);
        current.completedReviews += 1;
        current.status = current.completedReviews === current.plan.maximumReviews ? "completed" : "scheduled";
        current.due = due; current.cycle = null; current.index = 0; current.facts = []; current.outcomes = {};
      });
    } finally { active.delete(identity); }
  }

  function arm() {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    if (stopped) return;
    const due = [...table.entries()].flatMap(([, row]) => row.enabled && !row.paused && !failures.has(row.ownerSessionId)
      ? row.jobs.filter((job) => live(row, job)).map((job) => job.due) : []);
    if (due.length) {
      timer = setTimer(() => { timer = undefined; void drain(); }, Math.max(0, Math.min(Math.min(...due) - now(), MAX_TIMER_DELAY)));
      timer?.unref?.();
    }
  }

  async function drive() {
    do {
      requested = false;
      const due = [...table.entries()].flatMap(([id, row]) => row.enabled && !row.paused && !failures.has(id)
        ? row.jobs.filter((job) => live(row, job) && job.due <= now()).map((job) => [id, job.requestId]) : []);
      for (const [id, requestId] of due) {
        if (stopped) return;
        try { await executeJob(id, requestId); }
        catch { failures.set(id, "watchlist_review_checkpoint_failed"); log("watchlist_review_checkpoint_failed"); }
      }
    } while (requested && !stopped);
  }

  function drain() {
    if (stopped) return Promise.resolve();
    if (driving) { requested = true; return driving; }
    driving = drive().finally(() => { driving = undefined; arm(); });
    return driving;
  }

  function wake() {
    if (stopped) return;
    requested = true;
    arm();
  }

  return {
    operation, drain, wake,
    initialize() {
      for (const [id, row] of table.entries()) {
        if (id !== row.ownerSessionId) throw new Error("watchlist_stored_owner_mismatch");
        validate(row);
      }
      arm();
    },
    async publish(id) { await publish(id, reviewView(owner(id))); },
    async stopOwner(id) {
      if (!table.get(id)) return;
      try {
        await mutate(id, (row) => {
          row.paused = true;
          for (const job of row.jobs) if (["scheduled", "running"].includes(job.status)) job.status = "cancelled";
        });
      } finally {
        for (const execution of active.values()) if (execution.owner === id) execution.control.abort(new Error("watchlist_session_archived"));
        wake();
      }
    },
    detach(agent) {
      for (const execution of active.values()) if (execution.agent === agent) execution.control.abort(new Error("watchlist_agent_disposed"));
    },
    async close() {
      stopped = true;
      if (timer !== undefined) clearTimer(timer);
      for (const execution of active.values()) execution.control.abort(new Error("watchlist_host_stopping"));
      await driving;
      await queue;
    },
  };
}
