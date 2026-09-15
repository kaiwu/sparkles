import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";
import {
  decompressZstdLog,
  inspectSessionJsonl,
  migrateV0SparklesLogs,
  rewriteSessionJsonl,
} from "../../scripts/dsh-migrate-v0-sparkles-events.js";

const zstdOptions = {
  params: { [constants.ZSTD_c_checksumFlag]: 1 },
};

const SAMPLE = [
  JSON.stringify({
    type: "session",
    version: 0,
    id: "session-fixture",
    createdAt: 1,
    cwd: "/work",
    delegationDepth: 0,
  }),
  JSON.stringify({ type: "turn/start", seq: 0, time: 1, data: { turn: 1 } }),
  JSON.stringify({
    type: "pi-sparkles/status",
    seq: 1,
    time: 2,
    data: { key: "finance-track", text: "CN · CNY" },
  }),
  JSON.stringify({
    type: "reasoning-chunks",
    turn: 1,
    step: 1,
    chunks: ["keep packed rows untouched"],
  }),
  JSON.stringify({
    type: "pi-sparkles/custom",
    seq: 2,
    time: 3,
    data: { customType: "receipt", data: { bars: [1, 2, 3] } },
  }),
  JSON.stringify({ type: "turn/end", seq: 3, time: 4, data: { turn: 1, reason: { kind: "completed" } } }),
  "",
].join("\n");

describe("DSH v0 Sparkles session rewrite", () => {
  test("replaces only Sparkles events and keeps seq, packed rows, and other types", () => {
    const inspection = inspectSessionJsonl(SAMPLE);
    expect(inspection).toMatchObject({
      version: 0,
      id: "session-fixture",
      sparkles: 2,
      counts: { "pi-sparkles/status": 1, "pi-sparkles/custom": 1 },
    });
    const rewritten = rewriteSessionJsonl(SAMPLE);
    expect(rewritten.replaced).toBe(2);
    const lines = rewritten.text.split("\n");
    expect(lines[0]).toBe(SAMPLE.split("\n")[0]);
    expect(JSON.parse(lines[1])).toEqual({ type: "turn/start", seq: 0, time: 1, data: { turn: 1 } });
    expect(JSON.parse(lines[2])).toEqual({
      type: "feedback/record",
      seq: 1,
      time: 2,
      data: { text: "omitted pi-sparkles/status for DSH 0.1.5 v0 historical migration" },
    });
    expect(lines[3]).toBe(SAMPLE.split("\n")[3]);
    expect(JSON.parse(lines[4])).toEqual({
      type: "feedback/record",
      seq: 2,
      time: 3,
      data: { text: "omitted pi-sparkles/custom for DSH 0.1.5 v0 historical migration" },
    });
    expect(JSON.parse(lines[5]).type).toBe("turn/end");
    expect(inspectSessionJsonl(rewritten.text).sparkles).toBe(0);
  });

  test("rewrites compressed v0 logs in place and leaves a backup", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-v0-sparkles-"));
    const directory = join(root, "session-fixture");
    mkdirSync(directory);
    const path = join(directory, "session.jsonl.zstd");
    writeFileSync(path, zstdCompressSync(Buffer.from(SAMPLE, "utf8"), zstdOptions));
    const dry = migrateV0SparklesLogs(root, { apply: false });
    expect(dry).toHaveLength(1);
    expect(dry[0].applied).toBeFalse();
    expect(zstdDecompressSync(readFileSync(path)).toString("utf8")).toBe(SAMPLE);
    const applied = migrateV0SparklesLogs(root, { apply: true });
    expect(applied[0].applied).toBeTrue();
    const backup = readFileSync(`${path}.pre-dsh-0.1.5`);
    expect(zstdDecompressSync(backup).toString("utf8")).toBe(SAMPLE);
    const written = readFileSync(path);
    expect(zstdDecompressSync(written).toString("utf8")).toBe(`${SAMPLE.split("\n")[0]}\n`);
    const migrated = decompressZstdLog(written);
    expect(migrated).toBe(rewriteSessionJsonl(SAMPLE).text);
    expect(inspectSessionJsonl(migrated).sparkles).toBe(0);
    const types = migrated
      .split("\n")
      .filter((line) => line.length > 0)
      .slice(1)
      .map((line) => JSON.parse(line).type);
    expect(types).toContain("feedback/record");
    expect(types).not.toContain("pi-sparkles/status");
    expect(types).not.toContain("pi-sparkles/custom");
  });

  test("reads concatenated DSH Zstandard frames", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-v0-sparkles-frames-"));
    const directory = join(root, "session-fixture");
    mkdirSync(directory);
    const path = join(directory, "session.jsonl.zstd");
    const lines = SAMPLE.split("\n");
    const header = Buffer.from(`${lines[0]}\n`, "utf8");
    const body = Buffer.from(`${lines.slice(1).join("\n")}`, "utf8");
    writeFileSync(
      path,
      Buffer.concat([
        zstdCompressSync(header, zstdOptions),
        zstdCompressSync(body, zstdOptions),
      ]),
    );
    const dry = migrateV0SparklesLogs(root, { apply: false });
    expect(dry).toHaveLength(1);
    expect(dry[0].sparkles).toBe(2);
  });
});
