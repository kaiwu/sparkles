// DSH-native sibling: only registration, storage, lifecycle and presentation.
// The builder supplies the compiled pure Gleam watchlist laws, never a Pi shell.
import { createReviewRunner, reviewDomain, reviewProjection, REVIEW_EVENT } from "../watchlist-reviews.mjs";
import { loadSessionRuntime } from "../plugin.mjs";
import { acquireReviewLease } from "../store-lease.mjs";
import { executeRegisteredTool } from "../tool-batch.mjs";

const object = (properties = {}, required = []) => ({ type: "object", properties, required, additionalProperties: false });
const string = { type: "string" };
const integer = { type: "integer" };
const reviewFields = {
  requestId: string, watchlist: string,
  provider: { type: "string", const: "eastmoney" }, shareClass: { type: "string", const: "a_share" },
  maximumRequestsPerReview: integer,
};
const fields = Object.keys(reviewFields);

export function createWatchlistReviews(laws) {
  return {
    name: "dsh-sparkles-watchlist-reviews",
    inject: ["tools", "agents", "storageDomain", "sessionController", "sessionProjections"],
    async apply(ctx, config = {}) {
      const { appendPluginRecord } = await loadSessionRuntime();
      const lease = await acquireReviewLease(config.lockDirectory);
      let domain;
      try { domain = await ctx.storageDomain.open(reviewDomain); }
      catch (error) { lease.close(); throw error; }
      const runner = createReviewRunner({
        table: domain.table("owners"), laws,
        async resolveAgent(id) {
          const resolved = await ctx.sessionController.resolveAgent(id);
          if (resolved.error) throw new Error("watchlist_owner_resolution_failed");
          return resolved.agent;
        },
        invoke(agent, name, args, signal, callId) {
          // Use DSH's complete policy pipeline. Denials, including PTC mode
          // collapse, remain cannot_check; no raw callback or fallback bypass.
          return executeRegisteredTool(ctx.tools, { agent, name, arguments: args, signal, callId });
        },
        publish(id, view) {
          const agent = ctx.agents.get(id);
          if (agent) appendPluginRecord(agent.session, REVIEW_EVENT, view);
        },
        log: (code) => ctx.logger.warn(code),
      });
      // Install cleanup before validation or registration can fail.
      try {
        ctx.effect(() => async () => {
          try { await runner.close(); await domain.close(); }
          finally { lease.close(); }
        });
      } catch (error) {
        try { await runner.close(); await domain.close(); }
        finally { lease.close(); }
        throw error;
      }
      runner.initialize();
      ctx.sessionProjections.register(reviewProjection());
      const register = (name, description, parameters, operation) => {
        ctx.tools.register({
          name, description, parameters,
          output: {
            schema: { type: "object", additionalProperties: true },
            render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
          },
          async execute(input, exec) {
            if (!exec.agent?.session || String(exec.agent.id) !== String(exec.agent.session.id)) {
              throw new Error("watchlist_owner_session_required");
            }
            exec.signal.throwIfAborted();
            const op = typeof operation === "function" ? operation(input) : operation;
            return runner.operation(String(exec.agent.session.id), op, input, exec.signal);
          },
        });
      };
      register("watchlist_durable",
        "Inspect or opt into saved picks and bounded automatic reviews in this DSH session. action=status is read-only. Offer to remember picks, wait for acceptance, then enable with userAccepted=true. Saving alone never polls. DSH must remain running. Session-owned storage never reads another session; import exact watchlist_snapshot content to bring picks into another chat. close pauses; disable also withdraws consent; both retain saved data.",
        object({ action: { type: "string", enum: ["status", "enable", "close", "disable"] }, userAccepted: { type: "boolean" } }, ["action"]),
        (input) => input.action === "status" ? "status" : "control");
      register("watchlist_durable_snapshot", "Inspect this session's saved picks and revision without provider access.", object(), "snapshot");
      register("watchlist_durable_save",
        "After opt-in, save the exact watchlist_snapshot snapshotJson/snapshotSha256 using expectedRevision and a unique requestId. Later saves never change existing pinned reviews.",
        object({ requestId: string, expectedRevision: integer, snapshotJson: string, snapshotSha256: string }, ["requestId", "expectedRevision", "snapshotJson", "snapshotSha256"]), "save");
      register("watchlist_review_run",
        "Run one bounded review of saved picks through the explicit Eastmoney a_share CN tool and DSH policy pipeline. HK/US remain track_partial. Interrupted or denied acquisition remains unknown. No automatic source retry, model generation, external notification or investment judgment.",
        object(reviewFields, fields), "run");
      register("watchlist_review_schedule",
        "Only after the user requests recurring checks and chooses timing/count, schedule 1–30 reviews at intervals of 1 hour–30 days against immutable saved picks. At most ten picks and an explicit source-request budget. Restarts perform one recovery review and skip missed intervals. DSH runs direct checks without waking an LLM; source restrictions may yield cannot_check.",
        object({ ...reviewFields, firstDueUnixMilliseconds: integer, intervalMilliseconds: integer, maximumReviews: integer },
          [...fields, "firstDueUnixMilliseconds", "intervalMilliseconds", "maximumReviews"]), "schedule");
      register("watchlist_review_status", "Inspect this session's review jobs, due times and latest receipts. Supply requestId for compact receipt history; also supply cycleIndex for one complete retained source receipt. Receipt hashes bind that complete record. Silence never proves no change.", object({ requestId: string, cycleIndex: integer }), "status");
      register("watchlist_review_cancel", "Cancel this session's exact review requestId and abort its in-flight source. Completed reviews retain their terminal status and receipts.", object({ requestId: string }, ["requestId"]), "cancel");
      ctx.on("agent/created", async ({ agent }) => { await runner.publish(String(agent.session.id)); runner.wake(); });
      ctx.on("agent/disposed", ({ agent }) => { runner.detach(agent); });
      ctx.on("workspace/session-activity", async ({ sessionId }, next) => {
        const view = await runner.operation(String(sessionId), "status");
        const rest = await next();
        const items = view.enabled && !view.paused ? view.jobs
          .filter((job) => ["scheduled", "running"].includes(job.status))
          .map((job) => ({ id: job.requestId, label: `Pick review: ${job.requestId}` })) : [];
        return items.length ? [{ kind: "watchlist_review", items }, ...rest] : rest;
      });
      ctx.on("workspace/session-stop", ({ sessionId }) => runner.stopOwner(String(sessionId)));
    },
  };
}
