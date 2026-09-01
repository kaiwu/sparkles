import { createHash } from "node:crypto";

const parserName = "pdfjs-dist";
let pdfJsPromise;

function loadPdfJs() {
  pdfJsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfJsPromise;
}

export async function inspect_pdf(
  bodyBase64,
  declaredByteLength,
  expectedSha256,
  maximumBytes,
  maximumPages,
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
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== expectedSha256) {
    return { ok: false, kind: "hash_mismatch" };
  }
  if (bytes.byteLength > maximumBytes) {
    return { ok: false, kind: "too_large", received: bytes.byteLength };
  }

  let loadingTask;
  let document;
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
    loadingTask = getDocument({
      data: Uint8Array.from(bytes),
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
    document = await loadingTask.promise;

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

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (stopKind !== null || cancellation.signal.aborted) {
        return { ok: false, kind: stopKind ?? "cancelled" };
      }
      let page;
      try {
        page = await document.getPage(pageNumber);
      } catch {
        return { ok: false, kind: "unreadable_page" };
      }
      if (page.pageNumber !== pageNumber) {
        return { ok: false, kind: "unreadable_page" };
      }
      page.cleanup();
    }

    return {
      ok: true,
      pages: document.numPages,
      byteLength: declaredByteLength,
      parser: parserName,
      parserVersion: version,
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
    return { ok: false, kind: "inspector_failure" };
  } finally {
    clearTimeout(timer);
    cancellation.signal.removeEventListener("abort", stopForCancellation);
    try {
      await loadingTask?.destroy();
    } catch {
      // Destruction failures are intentionally contained and never expose
      // parser exception text across the FFI boundary.
    }
  }
}
