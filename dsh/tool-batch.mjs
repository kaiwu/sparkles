// DSH 0.2.2-rc.1 executes tools as a batch. One registered call is still one
// tool-call block; callers keep the unwrapped execution result.
import { DSH_HOST_VERSION } from "./runtime-contract.mjs";

export async function executeRegisteredTool(tools, {
  agent,
  name,
  arguments: args,
  signal,
  callId,
}) {
  if (typeof tools?.execute !== "function") {
    throw new Error(`dsh-sparkles requires DSH ${DSH_HOST_VERSION} tool batch execution`);
  }
  if (typeof callId !== "string" || callId.length === 0) {
    throw new Error(`dsh-sparkles: tool ${name} requires a DSH call id`);
  }
  if (signal === undefined) {
    throw new Error(`dsh-sparkles: tool ${name} requires a DSH cancellation signal`);
  }
  const batch = await tools.execute({
    calls: [{
      type: "tool-call",
      id: callId,
      name,
      arguments: JSON.stringify(args ?? {}),
    }],
    signal,
    ...(agent === undefined ? {} : { agent }),
  });
  const settled = batch?.results?.[0];
  if (settled?.callId !== callId || settled.result === undefined) {
    throw new Error(`dsh-sparkles: DSH returned no result for tool ${name}`);
  }
  return settled.result;
}

export async function mountNativeToolExecutor(ctx, entryHref) {
  const plugin = await import(entryHref);
  if (typeof plugin.apply !== "function" || plugin.name !== "native-tool-executor") {
    throw new Error(`dsh-sparkles requires DSH ${DSH_HOST_VERSION} native tool executor`);
  }
  await ctx.plugin({ name: plugin.name, inject: plugin.inject, apply: plugin.apply });
}
