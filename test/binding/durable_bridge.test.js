import { expect, test } from "bun:test";
import {
  create_invoker,
  capture_entry,
  remember_tool,
} from "../../pi_gleam/src/durable_bridge_ffi.mjs";
import { createPiApi } from "../../dsh/pi-api.mjs";

test("the tool bridge composes separate Pi extension APIs and keeps receipts invocation-local", async () => {
  const listeners = new Map();
  const facade = () => ({
    on(channel, handler) {
      const values = listeners.get(channel) ?? [];
      values.push(handler);
      listeners.set(channel, values);
    },
    emit(channel, request) {
      for (const handler of listeners.get(channel) ?? []) handler(request);
    },
  });
  const producer = { events: facade() },
    consumer = { events: facade() };
  remember_tool(producer, {
    name: "source",
    execute: async (id, args, signal, _updates, context) => {
      expect(context.hasUI).toBe(false);
      expect(signal.aborted).toBe(false);
      await Promise.resolve();
      expect(capture_entry(producer, "receipt", { id })).toBe(true);
      return { content: [], details: { key: args.key } };
    },
  });
  const invoke = create_invoker(consumer);
  const results = await Promise.all(
    ["one", "two"].map((id) =>
      invoke("source", { key: id }, new AbortController().signal, id),
    ),
  );
  expect(results.map((value) => value.entries[0].data.id)).toEqual([
    "one",
    "two",
  ]);
  expect(results.map((value) => value.result.details.key)).toEqual([
    "one",
    "two",
  ]);
  expect(capture_entry(producer, "outside", {})).toBe(false);
  await expect(
    create_invoker({ events: {} })(
      "source",
      {},
      new AbortController().signal,
      "missing",
    ),
  ).rejects.toThrow("capability_unavailable");
});

test("DSH API catalogs remain separate even on a shared host event bus", async () => {
  const bus = { emit() {}, on() {} };
  const one = createPiApi({ ctx: {}, bus, scopedState: true });
  const two = createPiApi({ ctx: {}, bus, scopedState: true });
  remember_tool(one, {
    name: "scoped",
    execute: async () => ({ content: [], details: { owner: "one" } }),
  });
  remember_tool(two, {
    name: "scoped",
    execute: async () => ({ content: [], details: { owner: "two" } }),
  });
  for (const [api, owner] of [
    [one, "one"],
    [two, "two"],
  ]) {
    expect(
      (
        await create_invoker(api)(
          "scoped",
          {},
          new AbortController().signal,
          "call",
        )
      ).result.details.owner,
    ).toBe(owner);
  }
});
