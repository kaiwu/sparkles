import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const artifact = resolve(import.meta.dir, "../../dist/watchlist/index.js");
const eventType = "pi_sparkles_watchlist.event.v1";

function entry(id, data, customType = eventType) {
  return {
    type: "custom",
    id,
    parentId: null,
    timestamp: "2026-08-06T00:00:00.000Z",
    customType,
    data,
  };
}

function context(branch, notifications = []) {
  return {
    mode: "tui",
    hasUI: true,
    sessionManager: {
      getBranch: () => branch,
    },
    ui: {
      notify(message, kind) {
        notifications.push({ message, kind });
      },
    },
  };
}

async function harness(entries = []) {
  const commands = new Map();
  const handlers = new Map();
  const tools = new Map();
  let nextId = entries.length;
  const api = {
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    on(name, handler) {
      const previous = handlers.get(name);
      handlers.set(name, previous ? async (...args) => { await previous(...args); return handler(...args); } : handler);
    },
    appendEntry(customType, data) {
      nextId += 1;
      entries.push(entry(`watchlist-${nextId}`, data, customType));
    },
  };
  const module = await import(
    `${artifact}?watchlist=${Date.now()}-${Math.random()}`
  );
  await module.default(api);
  return { commands, entries, handlers, tools };
}

async function execute(tool, input) {
  return tool.execute(
    "watchlist-call",
    input,
    new AbortController().signal,
    undefined,
    { hasUI: false, ui: {} },
  );
}

function apple(overrides = {}) {
  return {
    watchlist: "core",
    track: "us",
    instrumentId: "figi:BBG000B9XRY4",
    symbol: "AAPL",
    mic: "XNAS",
    note: "Primary US technology listing",
    thesisLink: "https://research.example.test/aapl",
    tags: ["quality", "us-tech"],
    ...overrides,
  };
}

describe("track-safe watchlist boundary", () => {
  test("persists exact add/update/remove events and exports a deterministic snapshot", async () => {
    const instance = await harness();
    const ctx = context(instance.entries);
    await instance.handlers.get("session_start")(
      { type: "session_start", reason: "startup" },
      ctx,
    );

    const added = await execute(instance.tools.get("watchlist_add"), apple());
    expect(added.details.action).toBe("added");
    expect(added.details.persisted).toBe(true);
    expect(added.details.track).toBe("us");
    expect(added.details.trackContext.venueMic).toBe("XNAS");
    expect(added.details.member.instrumentId).toBe("figi:BBG000B9XRY4");
    expect(added.details.identityStatus).toBe("caller_declared_unverified");
    expect(instance.entries).toHaveLength(1);
    expect(JSON.parse(instance.entries[0].data)).toMatchObject({
      schemaVersion: 1,
      revision: 1,
      action: "add",
      watchlist: "core",
      member: { track: "us", symbol: "AAPL", mic: "XNAS" },
    });

    const unchanged = await execute(instance.tools.get("watchlist_add"), apple());
    expect(unchanged.details.action).toBe("unchanged");
    expect(unchanged.details.persisted).toBe(false);
    expect(unchanged.details.revision).toBe(1);
    expect(instance.entries).toHaveLength(1);

    const hk = await execute(instance.tools.get("watchlist_add"), {
      watchlist: "asia",
      track: "hk",
      instrumentId: "hkex:00700",
      symbol: "00700",
      mic: "XHKG",
      tags: ["internet"],
    });
    expect(hk.details.track).toBe("hk");
    expect(hk.details.revision).toBe(2);

    const snapshot = await execute(
      instance.tools.get("watchlist_snapshot"),
      {},
    );
    expect(snapshot.details.revision).toBe(2);
    expect(snapshot.details.persistence).toBe(
      "session_branch_versioned_event_log",
    );
    expect(snapshot.details.watchlists.map(({ name }) => name)).toEqual([
      "asia",
      "core",
    ]);
    expect(snapshot.details.watchlists[0].members[0].track).toBe("hk");
    expect(snapshot.details.watchlists[1].members[0].track).toBe("us");

    await expect(
      execute(instance.tools.get("watchlist_add"), {
        watchlist: "bad_scope",
        track: "cn",
        instrumentId: "cninfo:000001",
        symbol: "000001",
        mic: "XNAS",
      }),
    ).rejects.toThrow("TrackMicMismatch");

    await expect(
      execute(instance.tools.get("watchlist_remove"), {
        watchlist: "core",
        track: "us",
        instrumentId: "figi:DIFFERENT",
        symbol: "AAPL",
        mic: "XNAS",
      }),
    ).rejects.toThrow("MemberNotFound");

    const removed = await execute(instance.tools.get("watchlist_remove"), {
      watchlist: "core",
      track: "us",
      instrumentId: "figi:BBG000B9XRY4",
      symbol: "AAPL",
      mic: "XNAS",
    });
    expect(removed.details.action).toBe("removed");
    expect(removed.details.revision).toBe(3);
    expect(JSON.parse(instance.entries.at(-1).data).action).toBe("remove");
  });

  test("replays only the active branch across resume and tree changes", async () => {
    const original = await harness();
    await original.handlers.get("session_start")(
      { type: "session_start", reason: "startup" },
      context(original.entries),
    );
    await execute(original.tools.get("watchlist_add"), apple());
    await execute(original.tools.get("watchlist_add"), {
      watchlist: "asia",
      track: "cn",
      instrumentId: "cninfo:000001",
      symbol: "000001",
      mic: "XSHE",
      tags: [],
    });

    const resumed = await harness([...original.entries]);
    await resumed.handlers.get("session_start")(
      { type: "session_start", reason: "resume" },
      context(resumed.entries),
    );
    let snapshot = await execute(resumed.tools.get("watchlist_snapshot"), {});
    expect(snapshot.details.revision).toBe(2);
    expect(snapshot.details.watchlists).toHaveLength(2);

    const inheritedBranch = [resumed.entries[0]];
    await resumed.handlers.get("session_tree")(
      {
        type: "session_tree",
        newLeafId: "watchlist-1",
        oldLeafId: "watchlist-2",
        fromExtension: false,
      },
      context(inheritedBranch),
    );
    snapshot = await execute(resumed.tools.get("watchlist_snapshot"), {});
    expect(snapshot.details.revision).toBe(1);
    expect(snapshot.details.watchlists.map(({ name }) => name)).toEqual([
      "core",
    ]);

    const fresh = await harness([]);
    await fresh.handlers.get("session_start")(
      { type: "session_start", reason: "new" },
      context(fresh.entries),
    );
    snapshot = await execute(fresh.tools.get("watchlist_snapshot"), {});
    expect(snapshot.details.revision).toBe(0);
    expect(snapshot.details.watchlists).toEqual([]);
  });

  test("locks a malformed branch instead of overwriting persisted state", async () => {
    const entries = [entry("watchlist-bad", "not-json")];
    const instance = await harness(entries);
    const notifications = [];
    await instance.handlers.get("session_start")(
      { type: "session_start", reason: "resume" },
      context(entries, notifications),
    );

    expect(notifications.at(-1).kind).toBe("error");
    expect(notifications.at(-1).message).toContain("mutations are disabled");
    await expect(
      execute(instance.tools.get("watchlist_add"), apple()),
    ).rejects.toThrow("mutations are disabled");
    expect(entries).toHaveLength(1);
  });
});
