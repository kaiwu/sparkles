import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { executeRegisteredTool, mountNativeToolExecutor } from "../../dsh/tool-batch.mjs";

describe("DSH tool batch", () => {
  test("sends one tool-call and unwraps the settled result", async () => {
    const signal = new AbortController().signal;
    const agent = { id: "agent" };
    const seen = [];
    const tools = {
      async execute(input) {
        seen.push(input);
        return {
          results: [{
            callId: "call-1",
            result: {
              isError: false,
              value: { ok: true },
              content: [{ type: "text", text: "ok" }],
            },
          }],
        };
      },
    };
    const result = await executeRegisteredTool(tools, {
      agent,
      name: "quote",
      arguments: { symbol: "AAPL" },
      signal,
      callId: "call-1",
    });
    expect(result).toEqual({
      isError: false,
      value: { ok: true },
      content: [{ type: "text", text: "ok" }],
    });
    expect(seen).toEqual([{
      calls: [{
        type: "tool-call",
        id: "call-1",
        name: "quote",
        arguments: JSON.stringify({ symbol: "AAPL" }),
      }],
      signal,
      agent,
    }]);
  });

  test("omits an absent agent and rejects a missing settled call", async () => {
    let seen;
    const tools = {
      async execute(input) {
        seen = input;
        return { results: [] };
      },
    };
    const signal = new AbortController().signal;
    await expect(executeRegisteredTool(tools, {
      name: "quote",
      arguments: {},
      signal,
      callId: "missing",
    })).rejects.toThrow("no result for tool quote");
    expect(seen.agent).toBeUndefined();
    expect(Object.hasOwn(seen, "agent")).toBe(false);
    expect(seen.calls[0].arguments).toBe("{}");
  });

  test("mounts only the named native executor", async () => {
    const directory = mkdtempSync(join(tmpdir(), "dsh-executor-"));
    try {
      const good = join(directory, "good.mjs");
      writeFileSync(good, [
        "export const name = \"native-tool-executor\";",
        "export const inject = [\"tools\"];",
        "export function apply(ctx) { ctx.mounted = true; }",
        "",
      ].join("\n"));
      let mounted;
      await mountNativeToolExecutor({
        async plugin(plugin) { mounted = plugin; },
      }, pathToFileURL(good).href);
      expect(mounted.name).toBe("native-tool-executor");
      expect(mounted.inject).toEqual(["tools"]);
      const ctx = {};
      mounted.apply(ctx);
      expect(ctx.mounted).toBe(true);

      const other = join(directory, "other.mjs");
      writeFileSync(other, "export const name = \"other\";\nexport function apply() {}\n");
      await expect(mountNativeToolExecutor({ async plugin() {} }, pathToFileURL(other).href))
        .rejects.toThrow("native tool executor");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
