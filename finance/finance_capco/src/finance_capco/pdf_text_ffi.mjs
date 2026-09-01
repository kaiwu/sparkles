import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const parserName = "pdfjs-dist";
let pdfJsPromise;

function loadPdfJs() {
  pdfJsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfJsPromise;
}

export async function extract_pdf(
  bodyBase64,
  declaredByteLength,
  expectedSha256,
  maximumBytes,
  maximumPages,
  maximumItems,
  maximumTextBytes,
  timeoutMilliseconds,
  cancellation,
) {
  if (cancellation.signal.aborted) {
    return { ok: false, kind: "cancelled" };
  }
  if (declaredByteLength > maximumBytes) {
    return { ok: false, kind: "too_large", received: declaredByteLength };
  }

  let bytes;
  try {
    bytes = Buffer.from(bodyBase64, "base64");
  } catch {
    return { ok: false, kind: "invalid_base64" };
  }
  if (bytes.toString("base64") !== bodyBase64) {
    return { ok: false, kind: "invalid_base64" };
  }
  if (bytes.byteLength !== declaredByteLength) {
    return {
      ok: false,
      kind: "length_mismatch",
      received: bytes.byteLength,
    };
  }
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) {
    return { ok: false, kind: "hash_mismatch" };
  }
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-", "ascii"))) {
    return { ok: false, kind: "invalid_signature" };
  }

  let loadingTask;
  let stopKind = null;
  const stopForCancellation = () => {
    stopKind ??= "cancelled";
    void loadingTask?.destroy();
  };
  cancellation.signal.addEventListener("abort", stopForCancellation, {
    once: true,
  });
  const timer = setTimeout(() => {
    stopKind ??= "timeout";
    void loadingTask?.destroy();
  }, timeoutMilliseconds);

  try {
    const { getDocument, version } = await loadPdfJs();
    if (stopKind !== null || cancellation.signal.aborted) {
      return { ok: false, kind: stopKind ?? "cancelled" };
    }
    const cMapUrl = fileURLToPath(
      new URL(
        ".",
        import.meta.resolve("pdfjs-dist/cmaps/UniGB-UCS2-H.bcmap"),
      ),
    );
    loadingTask = getDocument({
      data: Uint8Array.from(bytes),
      cMapUrl,
      cMapPacked: true,
      stopAtErrors: true,
      disableAutoFetch: true,
      disableStream: true,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      useWasm: false,
      enableXfa: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      enableHWA: false,
      enableWebGPU: false,
      verbosity: 0,
    });
    const document = await loadingTask.promise;
    if (stopKind !== null || cancellation.signal.aborted) {
      return { ok: false, kind: stopKind ?? "cancelled" };
    }
    if (!Number.isSafeInteger(document.numPages) || document.numPages <= 0) {
      return { ok: false, kind: "invalid_pdf" };
    }
    if (document.numPages > maximumPages) {
      return {
        ok: false,
        kind: "page_limit",
        received: document.numPages,
      };
    }

    const items = [];
    let textBytes = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (stopKind !== null || cancellation.signal.aborted) {
        return { ok: false, kind: stopKind ?? "cancelled" };
      }
      let page;
      try {
        page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (
            typeof item?.str !== "string" ||
            !Array.isArray(item.transform) ||
            !Number.isFinite(item.transform[4])
          ) {
            return { ok: false, kind: "unreadable_page" };
          }
          items.push({ page: pageNumber, x: item.transform[4], text: item.str });
          if (items.length > maximumItems) {
            return { ok: false, kind: "item_limit", received: items.length };
          }
          textBytes += Buffer.byteLength(item.str, "utf8");
          if (textBytes > maximumTextBytes) {
            return { ok: false, kind: "text_limit", received: textBytes };
          }
        }
      } catch {
        return { ok: false, kind: "unreadable_page" };
      } finally {
        page?.cleanup();
      }
    }

    return {
      ok: true,
      pages: document.numPages,
      byteLength: declaredByteLength,
      parser: parserName,
      parserVersion: version,
      items,
    };
  } catch (error) {
    if (stopKind !== null || cancellation.signal.aborted) {
      return { ok: false, kind: stopKind ?? "cancelled" };
    }
    if (error?.name === "PasswordException") {
      return { ok: false, kind: "encrypted" };
    }
    if (
      error?.name === "InvalidPDFException" ||
      error?.name === "MissingPDFException"
    ) {
      return { ok: false, kind: "invalid_pdf" };
    }
    return { ok: false, kind: "extractor_failure" };
  } finally {
    clearTimeout(timer);
    cancellation.signal.removeEventListener("abort", stopForCancellation);
    try {
      await loadingTask?.destroy();
    } catch {
      // Parser destruction errors stay contained at the effect boundary.
    }
  }
}
