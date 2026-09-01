import { afterEach, expect, test } from "bun:test";
import {
  copyFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("PDF effect modules do not load PDF.js while the host is starting", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-sparkles-pdf-startup-"));
  temporaryDirectories.push(directory);
  const sources = [
    "finance/finance_pdf/src/finance_pdf/inspector_ffi.mjs",
    "finance/finance_capco/src/finance_capco/pdf_text_ffi.mjs",
  ];

  for (const source of sources) {
    const destination = join(directory, basename(source));
    copyFileSync(source, destination);
    const loaded = await import(pathToFileURL(destination).href);
    expect(Object.keys(loaded)).toHaveLength(1);
  }
});
