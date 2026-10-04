import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, parse, sep } from "node:path";

// These imports are compiled into lazy module initializers for the Pi sibling.
// Compiled Pi's embedded module resolver cannot load arbitrary SDK packages.
const STORE_VERSION = 1;
const MAXIMUM_STORE_BYTES = 100 * 1024 * 1024;
const MAXIMUM_RECEIPT_BYTES = 32 * 1024;
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const encode = (value) => JSON.stringify(value);
const canonical = (value) =>
  JSON.stringify(value, (_key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item))
      return Object.fromEntries(
        Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
      );
    return item;
  });

function admitted(result) {
  if (!result.isOk()) throw new Error(result[0]);
  return JSON.parse(result[0]);
}

async function checkDirectory(path, create = false) {
  if (
    !isAbsolute(path) ||
    normalize(path) !== path ||
    path === parse(path).root
  ) {
    throw new Error("watchlist_store_requires_an_exact_absolute_directory");
  }
  // Every existing ancestor must be a real directory, never a symlink.
  let part = parse(path).root;
  for (const segment of path.slice(part.length).split(sep)) {
    part = join(part, segment);
    try {
      const stat = await lstat(part);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("unsafe_watchlist_store_path");
    } catch (error) {
      if (error.code !== "ENOENT" || part !== path || !create) throw error;
      await mkdir(path, { mode: 0o700 });
    }
  }
  const files = await readdir(path);
  const marker = join(path, "sparkles-store.json");
  if (!files.includes("sparkles-store.json")) {
    if (!create || files.length !== 0)
      throw new Error("watchlist_store_is_not_an_owned_empty_directory");
    await writeFile(
      marker,
      encode({
        schema: "pi-sparkles/durable-watchlist",
        version: STORE_VERSION,
      }),
      { flag: "wx", mode: 0o600 },
    );
    await chmod(path, 0o700);
  }
  let bytes = 0;
  for (const file of await readdir(path)) {
    if (
      !/^(?:sparkles-store\.json(?:\.reclaim)?|owner\.sqlite(?:-journal|-wal|-shm)?|(?:main|doc-\d+|task-\d+)\.jsonl(?:\.reclaim)?)$/.test(
        file,
      )
    ) {
      throw new Error("unexpected_watchlist_store_file");
    }
    let stat;
    try {
      stat = await lstat(join(path, file));
    } catch (error) {
      // Durable reclaims completed task files while reviews are running.
      // A listed file may already have disappeared; every remaining entry
      // still has to satisfy the owned-file and size checks.
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error("unsafe_watchlist_store_file");
    bytes += stat.size;
  }
  if (bytes > MAXIMUM_STORE_BYTES)
    throw new Error("watchlist_store_byte_budget_exceeded");
  const markerValue = JSON.parse(await readFile(marker, "utf8"));
  if (
    markerValue.schema !== "pi-sparkles/durable-watchlist" ||
    markerValue.version !== STORE_VERSION
  ) {
    throw new Error("unsupported_watchlist_store_version");
  }
  if (((await lstat(path)).mode & 0o077) !== 0)
    throw new Error("watchlist_store_directory_requires_private_permissions");
  return bytes;
}

// A separate SQLite EXCLUSIVE transaction is the writer lease. The OS releases
// it on process death; recovery needs no stale-lock deletion or guessed timeout.
async function writerLease(path) {
  let database;
  try {
    if (globalThis.Bun) {
      const { Database } = await import("bun:sqlite");
      database = new Database(join(path, "owner.sqlite"), { create: true });
    } else {
      const { DatabaseSync } = await import("node:sqlite");
      database = new DatabaseSync(join(path, "owner.sqlite"));
    }
    database.exec(
      "PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS owner (id INTEGER); BEGIN EXCLUSIVE;",
    );
    for (const file of await readdir(path))
      if (file.startsWith("owner.sqlite")) await chmod(join(path, file), 0o600);
    return database;
  } catch {
    database?.close();
    throw new Error("watchlist_store_writer_unavailable");
  }
}

export function new_runtime(
  path,
  invoke,
  savePlan,
  schedulePlan,
  cyclePlan,
  project,
  nextDue,
) {
  let connection;
  let queue = Promise.resolve();
  const serial = (callback) => {
    const result = queue.then(callback);
    queue = result.catch(() => {});
    return result;
  };

  const open = async () => {
    if (connection) return connection;
    connection = (async () => {
      await checkDirectory(path, true);
      const lease = await writerLease(path);
      let harness;
      let closeContext;
      try {
        const [
          sdk,
          { BACKGROUND_CONTEXT: context },
          { createModels },
          { openNodeJsonlStorage },
        ] = await Promise.all([
          import("@earendil-works/pi-durable"),
          import("@earendil-works/chord/context"),
          import("@earendil-works/pi-ai/models"),
          import("@earendil-works/pi-durable/storage/jsonl/node"),
        ]);
        closeContext = context;
        const {
          defineDoc,
          defineTask,
          createRegistry,
          defineExtension,
          Harness,
        } = sdk;
        const Store = defineDoc({
          kind: "pi-sparkles.watchlist-store",
          version: 1,
          scope: "conversation",
          history: "latest",
          fork: "initial",
          initial: () => ({
            revision: 0,
            saved: null,
            admissions: {},
            jobs: [],
          }),
        });
        const terminal = (result) => ({
          status: "terminal",
          outcome: { status: "completed", result },
        });
        const abort = async (_task, runtime, taskContext) => {
          await runtime.commit(
            () => ({ status: "terminal", outcome: { status: "aborted" } }),
            taskContext,
          );
        };
        const Source = defineTask({
          name: "pi-sparkles.watch-source",
          version: 1,
          initial: () => ({ phase: "execute" }),
          phases: {
            execute: async (task, runtime, taskContext) => {
              let outcome;
              // Source reads change over time. Persist the attempted intent,
              // then never re-fetch an interrupted call under its old identity.
              if (
                (await runtime.memo("attempted", taskContext)) !== undefined
              ) {
                outcome = {
                  state: "interrupted",
                  attemptStarted: true,
                  toolInvoked: null,
                };
              } else {
                await runtime.memo("attempted", true, taskContext);
                try {
                  const value = await invoke(
                    task.input.tool,
                    task.input.args,
                    runtime.signal,
                    `durable-source-${task.id}`,
                  );
                  if (Buffer.byteLength(encode(value)) > MAXIMUM_RECEIPT_BYTES)
                    throw new Error("receipt_too_large");
                  outcome = {
                    state: "obtained",
                    attemptStarted: true,
                    toolInvoked: true,
                    ...value,
                  };
                } catch (error) {
                  if (runtime.signal.aborted) throw error;
                  outcome = {
                    state:
                      error.message === "durable_capability_unavailable"
                        ? "unavailable"
                        : "failed",
                    attemptStarted: true,
                    toolInvoked:
                      error.message !== "durable_capability_unavailable",
                  };
                }
              }
              await runtime.commit(async (tx) => {
                const entry = await tx.appendEntry(task.conversationId, {
                  kind: "pi-sparkles.watch-source-receipt",
                  data: outcome,
                });
                return terminal({ ...outcome, entryId: entry.id });
              }, taskContext);
            },
          },
          abort,
        });
        const Review = defineTask({
          name: "pi-sparkles.watch-review",
          version: 1,
          initial: (input) => ({
            phase: "due",
            due: input.firstDueUnixMilliseconds,
            remaining: input.maximumReviews,
            cycleIndex: 0,
          }),
          phases: {
            due: async (task, runtime, taskContext) => {
              await runtime.sleep(task.state.checkpoint.due, taskContext);
              const cycle = admitted(
                cyclePlan(encode(task.input), runtime.now()),
              );
              await runtime.commit(
                () => ({
                  status: "running",
                  checkpoint: {
                    ...task.state.checkpoint,
                    phase: "collect",
                    cycle,
                    index: 0,
                    facts: [],
                    sourceEntries: [],
                    attempts: 0,
                    invocations: 0,
                  },
                }),
                taskContext,
              );
            },
            collect: async (task, runtime, taskContext) => {
              const state = task.state.checkpoint;
              const pick = state.cycle.picks[state.index];
              if (!pick) {
                await runtime.commit(
                  () => ({
                    status: "running",
                    checkpoint: { ...state, phase: "finish" },
                  }),
                  taskContext,
                );
                return;
              }
              if (pick.tool === null) {
                const fact = admitted(
                  project(
                    encode(pick),
                    encode({ state: "unavailable" }),
                    "null",
                  ),
                );
                await runtime.commit(
                  () => ({
                    status: "running",
                    checkpoint: {
                      ...state,
                      index: state.index + 1,
                      facts: [...state.facts, fact],
                    },
                  }),
                  taskContext,
                );
                return;
              }
              await runtime.commit(async (tx) => {
                const child = await tx.createTask(Source, pick, {
                  ownership: { kind: "task", taskId: task.id },
                });
                return {
                  status: "waiting",
                  checkpoint: { ...state, phase: "join", child },
                  on: [child],
                  policy: "allSettled",
                };
              }, taskContext);
            },
            join: async (task, runtime, taskContext) => {
              const state = task.state.checkpoint;
              const [child] = await runtime.outcomes(
                [state.child],
                taskContext,
              );
              const result =
                child.status === "completed"
                  ? child.result
                  : { state: "interrupted" };
              const store = await runtime.snapshot(
                Store,
                task.conversationId,
                taskContext,
              );
              const previous =
                store.jobs
                  .find((job) => job.taskId === task.id)
                  ?.latest?.facts.find(
                    (fact) => fact.key === state.cycle.picks[state.index].key,
                  ) ?? null;
              let fact;
              try {
                fact = admitted(
                  project(
                    encode(state.cycle.picks[state.index]),
                    encode(result),
                    encode(previous),
                  ),
                );
              } catch {
                fact = admitted(
                  project(
                    encode(state.cycle.picks[state.index]),
                    encode({ state: "failed" }),
                    encode(previous),
                  ),
                );
              }
              await runtime.commit(
                () => ({
                  status: "running",
                  checkpoint: {
                    ...state,
                    phase: "collect",
                    index: state.index + 1,
                    facts: [...state.facts, fact],
                    attempts: state.attempts + (result.attemptStarted ? 1 : 0),
                    invocations:
                      state.invocations === null || result.toolInvoked == null
                        ? null
                        : state.invocations + (result.toolInvoked ? 1 : 0),
                    sourceEntries: result.entryId
                      ? [...state.sourceEntries, result.entryId]
                      : state.sourceEntries,
                  },
                }),
                taskContext,
              );
            },
            finish: async (task, runtime, taskContext) => {
              const state = task.state.checkpoint;
              const [due, missed] = nextDue(
                state.due,
                task.input.intervalMilliseconds,
                runtime.now(),
              );
              const receipt = {
                schema: "pi-sparkles/watch-review-receipt",
                schemaVersion: 1,
                requestId: task.input.requestId,
                cycleIndex: state.cycleIndex,
                snapshotSha256: task.input.snapshotSha256,
                watchlist: task.input.watchlist,
                dueAtUnixMilliseconds: state.due,
                startedAtUnixMilliseconds:
                  state.cycle.startedAtUnixMilliseconds,
                completedAtUnixMilliseconds: runtime.now(),
                skippedIntervals: missed,
                sourceAttemptCount: state.attempts,
                toolInvocationCount: state.invocations,
                networkRequestCount: "not_obtained",
                maximumRequestsPerReview: task.input.maximumRequestsPerReview,
                facts: state.facts,
                sourceEntryIds: state.sourceEntries,
                silenceMeaning: "unknown_until_a_review_receipt_is_inspected",
                scheduling:
                  "fixed_interval_while_pi_owns_store_no_market_calendar_claim",
                decisionOwner: "llm",
              };
              receipt.reviewReceipt = sha256(encode(receipt));
              await runtime.commit(async (tx) => {
                const doc = await tx.doc(Store, task.conversationId);
                const job = doc.jobs.find((value) => value.taskId === task.id);
                const entry = await tx.appendEntry(task.conversationId, {
                  kind: "pi-sparkles.watch-review-receipt",
                  data: receipt,
                });
                job.latest = { ...receipt, entryId: entry.id };
                job.completedReviews = state.cycleIndex + 1;
                if (state.remaining === 1) return terminal(job.latest);
                return {
                  status: "running",
                  checkpoint: {
                    phase: "due",
                    due,
                    remaining: state.remaining - 1,
                    cycleIndex: state.cycleIndex + 1,
                  },
                };
              }, taskContext);
            },
          },
          abort,
        });
        const registry = createRegistry();
        registry.install(
          defineExtension({
            name: "pi-sparkles-watchlist",
            tasks: [Source, Review],
          }),
        );
        const storage = await openNodeJsonlStorage(path, context, {
          fsync: true,
        });
        const write = storage.commit.bind(storage);
        storage.commit = async (writes, writeContext) => {
          const current = await checkDirectory(path);
          if (
            current + Buffer.byteLength(encode(writes)) * 4 + 16384 >
            MAXIMUM_STORE_BYTES
          )
            throw new Error("watchlist_store_byte_budget_exceeded");
          await write(writes, writeContext);
          for (const file of await readdir(path)) {
            try {
              await chmod(join(path, file), 0o600);
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
            }
          }
        };
        harness = await Harness.open(
          storage,
          { models: createModels(), registry },
          context,
        );
        const root = await harness.root(context);
        await root.commit(async (tx) => {
          await tx.doc(Store, root.id);
        }, context);
        harness.resume();
        return { harness, root, Store, Review, context, lease };
      } catch (error) {
        await harness?.close(closeContext);
        lease.close();
        connection = undefined;
        throw error;
      }
    })();
    return connection;
  };

  async function admit(operation, input) {
    const c = await open();
    await checkDirectory(path);
    const { root, Store, context, harness, Review } = c;
    if (operation === "snapshot") {
      const doc = await harness.snapshot(Store, root.id, context);
      return {
        storeRevision: doc.revision,
        saved: doc.saved,
        persistence: "pi_durable_user_owned_jsonl_fsync",
        maximumStoreBytes: MAXIMUM_STORE_BYTES,
      };
    }
    if (operation === "status") {
      // Read receipts and task states on one mutation line. Separate reads can
      // pair a pre-completion document with an already completed task.
      return root.commit(async (tx) => {
        const doc = await tx.doc(Store, root.id);
        const jobs = [];
        for (const job of doc.jobs) {
          const task = await tx.task(job.taskId);
          jobs.push({
            ...job,
            taskState: {
              status: task.state.status,
              phase: task.state.checkpoint?.phase,
              nextDueUnixMilliseconds: task.state.checkpoint?.due,
              outcome: task.state.outcome?.status,
            },
          });
        }
        return JSON.parse(
          encode({
            storeRevision: doc.revision,
            jobs,
            scheduling: "active_only_while_pi_owns_store",
          }),
        );
      }, context);
    }
    if (operation === "cancel") {
      const request = JSON.parse(input);
      const doc = await harness.snapshot(Store, root.id, context);
      const job = doc.jobs.find(
        (value) => value.requestId === request.requestId,
      );
      if (!job) throw new Error("review_request_not_found");
      const task = await harness.getTask(job.taskId, context);
      if (task.state.status !== "terminal")
        await harness.abortTask(job.taskId, context);
      const settled = await harness.waitForTask(job.taskId, context);
      return {
        requestId: job.requestId,
        taskId: job.taskId,
        status: settled.state.outcome.status,
      };
    }
    const existing = await harness.snapshot(Store, root.id, context);
    const request = JSON.parse(input);
    const prior = Object.hasOwn(existing.admissions, request.requestId)
      ? existing.admissions[request.requestId]
      : undefined;
    if (prior) {
      if (
        prior.inputFingerprint !== sha256(input) ||
        prior.operation !== operation
      )
        throw new Error("watchlist_request_id_conflict");
      return prior.result;
    }
    const payload =
      operation === "save"
        ? admitted(savePlan(input))
        : admitted(
            schedulePlan(
              (await harness.snapshot(Store, root.id, context)).saved
                ?.snapshotJson ?? "null",
              input,
              Date.now(),
              operation === "run",
            ),
          );
    const fingerprint = sha256(encode({ operation, payload }));
    return root.commit(async (tx) => {
      const doc = await tx.doc(Store, root.id);
      const old = Object.hasOwn(doc.admissions, payload.requestId)
        ? doc.admissions[payload.requestId]
        : undefined;
      if (old) {
        // One-off 'now' is captured on first admission, rather than changing
        // the identity of a retried operation's otherwise identical input.
        const inputFingerprint = sha256(input);
        if (
          old.inputFingerprint !== inputFingerprint ||
          old.operation !== operation
        )
          throw new Error("watchlist_request_id_conflict");
        return old.result;
      }
      if (Object.keys(doc.admissions).length >= 500)
        throw new Error("watchlist_admission_budget_exceeded");
      let result;
      if (operation === "save") {
        if (doc.revision !== payload.expectedRevision)
          throw new Error("watchlist_store_revision_conflict");
        doc.saved = {
          snapshotJson: payload.snapshotJson,
          snapshotSha256: payload.snapshotSha256,
        };
        doc.revision++;
        result = {
          storeRevision: doc.revision,
          snapshotSha256: payload.snapshotSha256,
        };
      } else {
        if (doc.jobs.length >= 10)
          throw new Error("watchlist_schedule_budget_exceeded");
        const taskId = await tx.createTask(Review, payload, {
          ownership: { kind: "conversation" },
        });
        result = {
          requestId: payload.requestId,
          taskId,
          snapshotSha256: payload.snapshotSha256,
          maximumReviews: payload.maximumReviews,
        };
        doc.jobs.push({ ...result, completedReviews: 0, latest: null });
      }
      await tx.appendEntry(root.id, {
        kind: "pi-sparkles.watchlist-admission",
        data: { operation, fingerprint, result },
      });
      doc.admissions[payload.requestId] = {
        operation,
        inputFingerprint: sha256(input),
        result,
      };
      return result;
    }, context);
  }

  return {
    async call(operation, input) {
      input = canonical(JSON.parse(input));
      if (operation === "close") {
        await serial(async () => {
          if (!connection) return;
          const c = await connection;
          await c.harness.close(c.context);
          c.lease.close();
          connection = undefined;
        });
        return encode({
          summary:
            "Durable watchlist store closed; unfinished tasks remain resumable",
          details: { status: "closed" },
        });
      }
      const result = await serial(() => admit(operation, input));
      if (operation === "run") {
        const c = await open();
        const settled = await c.harness.waitForTask(result.taskId, c.context);
        return encode({
          summary:
            "Durable watchlist review finished; inspect every pick's status and source limits",
          details: { admission: result, outcome: settled.state.outcome },
        });
      }
      return encode({
        summary: `Durable watchlist ${operation} stored or inspected`,
        details: result,
      });
    },
  };
}

export function call(runtime, operation, input) {
  return runtime.call(operation, JSON.stringify(input)).then((value) => {
    const parsed = JSON.parse(value);
    return {
      content: [
        {
          type: "text",
          text: `${parsed.summary}\n${JSON.stringify(parsed.details)}`,
        },
      ],
      details: parsed.details,
    };
  });
}

export async function close(runtime) {
  await runtime.call("close", "{}");
}
