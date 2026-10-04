import { AsyncLocalStorage } from "node:async_hooks";

// Generic host infrastructure. Pi supplies a distinct event-bus facade to each
// extension, so cross-extension invocation uses the bus's explicit request
// channel. Catalogs and captured entries remain scoped to their actual owner.
const key = Symbol.for("pi-sparkles:durable-tool-bridge:v1");
const ownerKey = Symbol.for("pi-sparkles:tool-bridge-owner");
const channel = "pi-sparkles:durable-tool-invoke:v1";
const bridge = (globalThis[key] ??= {
  catalogs: new WeakMap(),
  invocations: new AsyncLocalStorage(),
});
const owner = (api) => api[ownerKey] ?? api.events ?? api;

export function remember_tool(api, definition) {
  const identity = owner(api);
  let catalog = bridge.catalogs.get(identity);
  if (!catalog) {
    bridge.catalogs.set(identity, (catalog = new Map()));
    // DSH catalogs never cross agents, even when their event bus is shared.
    if (!api[ownerKey] && api.events?.on)
      api.events.on(channel, (request) => {
        if (
          !request ||
          request.claimed ||
          !catalog.has(request.name) ||
          typeof request.resolve !== "function" ||
          typeof request.reject !== "function"
        )
          return;
        request.claimed = true;
        invoke_tool(
          api,
          request.name,
          request.args,
          request.signal,
          request.callId,
        ).then(request.resolve, request.reject);
      });
  }
  catalog.set(definition.name, definition);
}

export function capture_entry(api, customType, data) {
  const invocation = bridge.invocations.getStore();
  if (!invocation || invocation.owner !== owner(api)) return false;
  invocation.entries.push(structuredClone({ customType, data }));
  return true;
}

export async function invoke_tool(api, name, args, signal, callId) {
  const tool = bridge.catalogs.get(owner(api))?.get(name);
  if (!tool) throw new Error("durable_capability_unavailable");
  const entries = [];
  const result = await bridge.invocations.run(
    { owner: owner(api), entries },
    () =>
      tool.execute(callId, args, signal, undefined, { hasUI: false, ui: {} }),
  );
  return { result: structuredClone(result), entries };
}

export function create_invoker(api) {
  return (name, args, signal, callId) => {
    if (bridge.catalogs.get(owner(api))?.has(name))
      return invoke_tool(api, name, args, signal, callId);
    if (api[ownerKey] || !api.events?.emit)
      return Promise.reject(new Error("durable_capability_unavailable"));
    return new Promise((resolve, reject) => {
      const request = {
        name,
        args,
        signal,
        callId,
        resolve,
        reject,
        claimed: false,
      };
      api.events.emit(channel, request);
      if (!request.claimed) reject(new Error("durable_capability_unavailable"));
    });
  };
}
