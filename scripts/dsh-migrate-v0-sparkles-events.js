// Rewrite DSH 0.1.2 v0 session logs so DSH 0.1.5 can migrate them.
//
// DSH 0.1.5's v0-to-v1 edge uses a frozen first-party event inventory and
// refuses unknown historical types, including `pi-sparkles/status` and
// `pi-sparkles/custom`, even when ignorable. Mounting this plugin cannot
// change that. This operator tool replaces those events in place with
// seq-preserving `feedback/record` placeholders so conversation history can
// load. Overlay status and session receipts in those old logs are not
// restored.
//
//   bun scripts/dsh-migrate-v0-sparkles-events.js --dry-run
//   bun scripts/dsh-migrate-v0-sparkles-events.js --apply
//   bun scripts/dsh-migrate-v0-sparkles-events.js --apply --root ~/.dsh/sessions

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { constants, zstdCompressSync, zstdDecompressSync } from "node:zlib";

export const SPARKLES_V0_EVENT_TYPES = new Set([
  "pi-sparkles/custom",
  "pi-sparkles/status",
]);
export const REPLACEMENT_EVENT_TYPE = "feedback/record";
const BACKUP_SUFFIX = ".pre-dsh-0.1.5";
const ZSTD_MAGIC = 0xfd2fb528;
const ZSTD_OPTIONS = {
  params: { [constants.ZSTD_c_checksumFlag]: 1 },
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function replacementText(type) {
  return `omitted ${type} for DSH 0.1.5 v0 historical migration`;
}

export function rewriteSessionJsonl(text) {
  const lines = text.split("\n");
  let replaced = 0;
  const counts = { "pi-sparkles/custom": 0, "pi-sparkles/status": 0 };
  const rewritten = lines.map((line, index) => {
    if (index === 0 || line.length === 0) return line;
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      return line;
    }
    if (!isRecord(value) || !SPARKLES_V0_EVENT_TYPES.has(value.type)) return line;
    counts[value.type] += 1;
    replaced += 1;
    return JSON.stringify({
      type: REPLACEMENT_EVENT_TYPE,
      seq: value.seq,
      time: value.time,
      data: { text: replacementText(value.type) },
    });
  });
  return { text: rewritten.join("\n"), replaced, counts };
}

export function inspectSessionJsonl(text) {
  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length === 0) return { version: null, sparkles: 0, counts: {} };
  let header;
  try {
    header = JSON.parse(lines[0]);
  } catch {
    return { version: null, sparkles: 0, counts: {} };
  }
  const counts = {};
  for (const line of lines.slice(1)) {
    let value;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(value) || !SPARKLES_V0_EVENT_TYPES.has(value.type)) continue;
    counts[value.type] = (counts[value.type] ?? 0) + 1;
  }
  return {
    version: header?.version ?? null,
    id: header?.id,
    sparkles: Object.values(counts).reduce((sum, count) => sum + count, 0),
    counts,
  };
}

function scanZstdFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) {
      throw new Error(`truncated Zstandard frame at byte ${start}`);
    }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(`invalid Zstandard frame magic at byte ${offset}`);
    }
    offset += 4;
    if (offset === buffer.length) {
      throw new Error(`truncated Zstandard frame header at byte ${start}`);
    }
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0
      ? (singleSegment ? 1 : 0)
      : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) {
      throw new Error(`truncated Zstandard frame header at byte ${start}`);
    }
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) {
        throw new Error(`truncated Zstandard block header at byte ${start}`);
      }
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) {
        throw new Error(`truncated Zstandard block at byte ${start}`);
      }
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) {
        throw new Error(`truncated Zstandard checksum at byte ${start}`);
      }
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return frames;
}

export function decompressZstdLog(bytes) {
  const frames = scanZstdFrames(bytes);
  if (frames.length === 0) return "";
  if (frames.length === 1 && frames[0].start === 0 && frames[0].end === bytes.length) {
    return zstdDecompressSync(bytes).toString("utf8");
  }
  return Buffer.concat(frames.map((frame) => zstdDecompressSync(bytes.subarray(frame.start, frame.end))))
    .toString("utf8");
}

function decodeArtifact(path) {
  const bytes = readFileSync(path);
  if (path.endsWith(".zstd")) return decompressZstdLog(bytes);
  return bytes.toString("utf8");
}

export function encodeZstdLog(text) {
  const newline = text.indexOf("\n");
  if (newline < 0) throw new Error("session log has no header line");
  const header = Buffer.from(text.slice(0, newline + 1), "utf8");
  const body = Buffer.from(text.slice(newline + 1), "utf8");
  const frames = [zstdCompressSync(header, ZSTD_OPTIONS)];
  if (body.length > 0) frames.push(zstdCompressSync(body, ZSTD_OPTIONS));
  return Buffer.concat(frames);
}

function encodeArtifact(path, text) {
  if (path.endsWith(".zstd")) return encodeZstdLog(text);
  return Buffer.from(text, "utf8");
}

function walkSessionLogs(root) {
  const found = [];
  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (entry.name === "session.jsonl" || entry.name === "session.jsonl.zstd") {
        found.push(path);
      }
    }
  };
  visit(root);
  return found.sort();
}

export function defaultSessionsRoot() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
  return join(home, "sessions");
}

export function migrateV0SparklesLogs(root, { apply = false } = {}) {
  const results = [];
  for (const path of walkSessionLogs(root)) {
    const text = decodeArtifact(path);
    const inspection = inspectSessionJsonl(text);
    if (inspection.version !== 0 || inspection.sparkles === 0) continue;
    const rewritten = rewriteSessionJsonl(text);
    const result = {
      path,
      id: inspection.id,
      sparkles: rewritten.replaced,
      counts: rewritten.counts,
      applied: false,
      backup: null,
    };
    if (apply) {
      const backup = `${path}${BACKUP_SUFFIX}`;
      if (!existsSync(backup)) copyFileSync(path, backup);
      const temporary = `${path}.tmp-${process.pid}`;
      writeFileSync(temporary, encodeArtifact(path, rewritten.text));
      renameSync(temporary, path);
      result.applied = true;
      result.backup = backup;
    }
    results.push(result);
  }
  return results;
}

function parseArgs(args) {
  const options = { apply: false, root: defaultSessionsRoot() };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--root") {
      const root = args[index + 1];
      if (typeof root !== "string") throw new Error("--root requires a directory");
      options.root = root;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.root)) {
    mkdirSync(options.root, { recursive: true });
  }
  const results = migrateV0SparklesLogs(options.root, { apply: options.apply });
  if (results.length === 0) {
    console.log(`No DSH v0 Sparkles session logs under ${options.root}`);
  } else {
    console.log(
      `${options.apply ? "Rewrote" : "Would rewrite"} ${results.length} v0 session log(s) under ${options.root}`,
    );
    for (const result of results) {
      console.log(
        `  ${result.id ?? result.path}: ${result.sparkles} Sparkles events` +
          (result.applied ? ` (backup ${result.backup})` : ""),
      );
    }
  }
}
