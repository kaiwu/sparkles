import { homedir } from "node:os";
import { join } from "node:path";
import { lstat, readFile, rename, open } from "node:fs/promises";
import { new_runtime } from "./durable_runtime_ffi.mjs";

export function new_control(invoke, save, schedule, cycle, project, nextDue) {
  const defaultDirectory = join(homedir(), ".pi-sparkles-watchlist");
  let directory = defaultDirectory;
  let runtime;
  let queue = Promise.resolve();
  const serial = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const availability = () => ({
    enabled: runtime !== undefined,
    directory,
    optInHint:
      "Offer the user: Shall I remember these picks across chats? Scheduled CN reviews are also available while Pi is open. Wait for their acceptance before enabling. Saving picks does not schedule checks.",
    persistence: "user_owned_local_pi_durable_store",
    tracks: {
      cn: "saved_picks_and_explicit_eastmoney_a_share_reviews",
      hk: "saved_picks_review_track_partial",
      us: "saved_picks_review_track_partial",
    },
    maximumPicksPerReview: 10,
    maximumReviewsPerSchedule: 30,
    minimumIntervalMilliseconds: 3600000,
    scheduling: "only_while_pi_is_open_no_external_notifications",
  });
  const marker = () => join(directory, "sparkles-store.json");
  const writeMarker = async (value) => {
    const file = await open(`${marker()}.reclaim`, "w", 0o600);
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(`${marker()}.reclaim`, marker());
    const folder = await open(directory, "r");
    try {
      await folder.sync();
    } finally {
      await folder.close();
    }
  };
  const result = (details) => ({
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  });
  const enabled = async () => {
    const candidate = new_runtime(
      directory,
      invoke,
      save,
      schedule,
      cycle,
      project,
      nextDue,
    );
    await candidate.call("snapshot", "{}");
    try {
      await writeMarker({
        schema: "pi-sparkles/durable-watchlist",
        version: 1,
        optIn: true,
      });
      runtime = candidate;
    } catch (error) {
      await candidate.call("close", "{}");
      throw error;
    }
  };
  return {
    availability,
    async discover() {
      return serial(async () => {
        if (runtime) return;
        try {
          const stat = await lstat(marker());
          if (!stat.isFile() || stat.isSymbolicLink())
            throw new Error("unsafe_watchlist_store_marker");
          const value = JSON.parse(await readFile(marker(), "utf8"));
          if (
            value.schema === "pi-sparkles/durable-watchlist" &&
            value.version === 1 &&
            value.optIn === true
          )
            await enabled();
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      });
    },
    async close() {
      return serial(async () => {
        const current = runtime;
        runtime = undefined;
        if (current) await current.call("close", "{}");
      });
    },
    async call(operation, input, signal) {
      signal?.throwIfAborted();
      if (operation === "control")
        return serial(async () => {
          if (input.action === "status") return result(availability());
          if (input.action === "enable") {
            if (input.userAccepted !== true)
              throw new Error("durable_watchlist_requires_user_acceptance");
            const selected = input.directory ?? defaultDirectory;
            if (runtime && directory !== selected)
              throw new Error("close_current_watchlist_store_first");
            directory = selected;
            if (!runtime) await enabled();
            return result(availability());
          }
          if (input.action === "close" || input.action === "disable") {
            const current = runtime;
            runtime = undefined;
            if (current) await current.call("close", "{}");
            if (input.action === "disable") {
              try {
                const value = JSON.parse(await readFile(marker(), "utf8"));
                if (
                  value.schema !== "pi-sparkles/durable-watchlist" ||
                  value.version !== 1
                )
                  throw new Error("unsupported_watchlist_store_version");
                await writeMarker({ ...value, optIn: false });
              } catch (error) {
                if (error.code !== "ENOENT") throw error;
              }
            }
            return result({
              ...availability(),
              action: input.action,
              savedDataRetained: true,
            });
          }
          throw new Error("invalid_durable_watchlist_control");
        });
      if (!runtime)
        return result({
          ...availability(),
          status: "opt_in_required",
          operationPerformed: false,
        });
      const current = runtime;
      const pending = current.call(operation, JSON.stringify(input));
      // Cancellation stops waiting and requests durable abort of a one-off
      // review. Background schedules have a separate explicit cancel tool.
      let onAbort;
      const value = await Promise.race([
        pending,
        new Promise((_, reject) => {
          onAbort = () => {
            if (operation === "run")
              void current
                .call("cancel", JSON.stringify({ requestId: input.requestId }))
                .catch(() => {});
            reject(new Error("watchlist_request_cancelled"));
          };
          if (signal?.aborted) onAbort();
          else signal?.addEventListener("abort", onAbort, { once: true });
        }),
      ]).finally(() => signal?.removeEventListener("abort", onAbort));
      const parsed = JSON.parse(value);
      return result({ ...parsed.details, durableEnabled: true });
    },
  };
}

export const control_call = (control, operation, input, signal) =>
  control.call(operation, input, signal);
export const discover = (control) => control.discover();
export const close = (control) => control.close();
