import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import * as classification from "../../finance/finance_capco/build/dev/javascript/finance_capco/finance_capco/classification.mjs";
import * as pdfText from "../../finance/finance_capco/build/dev/javascript/finance_capco/finance_capco/pdf_text.mjs";
import * as time from "../../finance/finance_capco/build/dev/javascript/finance_core/finance_core/time.mjs";
import * as binaryResponse from "../../finance/finance_capco/build/dev/javascript/finance_http/finance_http/binary_response.mjs";
import * as response from "../../finance/finance_capco/build/dev/javascript/finance_http/finance_http/response.mjs";
import * as transport from "../../finance/finance_capco/build/dev/javascript/finance_http/finance_http/transport.mjs";
import {
  Error,
  Ok,
  toList,
} from "../../finance/finance_capco/build/dev/javascript/finance_capco/gleam.mjs";

function unwrap(result) {
  if (result instanceof Ok) return result[0];
  throw new globalThis.Error(
    `Expected Ok, received ${result.constructor.name}`,
  );
}

function duration(milliseconds) {
  return unwrap(time.duration(milliseconds));
}

function pdfResponse(
  bytes,
  sha256 = createHash("sha256").update(bytes).digest("hex"),
) {
  return unwrap(
    binaryResponse.new$(
      200,
      toList([response.Header$Header("content-type", "application/pdf")]),
      bytes.toString("base64"),
      bytes.byteLength,
      sha256,
      bytes.subarray(0, 16).toString("hex"),
      duration(1),
    ),
  );
}

function classificationPdf() {
  const content = [
    "BT /F1 10 Tf 1 0 0 1 44.72 738.51 Tm (000001) Tj ET",
    "BT /F1 10 Tf 1 0 0 1 79.01 728.50 Tm (PING AN BANK) Tj ET",
    "BT /F1 10 Tf 1 0 0 1 132.51 718.49 Tm (J) Tj ET",
    "BT /F1 10 Tf 1 0 0 1 192.62 708.48 Tm (FINANCE) Tj ET",
    "BT /F1 10 Tf 1 0 0 1 423.09 698.47 Tm (66) Tj ET",
    "BT /F1 10 Tf 1 0 0 1 478.32 688.46 Tm (BANKING) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

test("CAPCO PDF boundary extracts positioned text for the pure row parser", async () => {
  const extracted = await pdfText.extract(
    pdfResponse(classificationPdf()),
    transport.new_cancellation(),
  );
  expect(extracted).toBeInstanceOf(Ok);
  expect(extracted[0].page_count).toBe(1);
  expect(extracted[0].parser).toBe("pdfjs-dist");

  const parsed = classification.find(extracted[0], "000001");
  expect(parsed).toBeInstanceOf(Ok);
  expect(parsed[0].listing_name).toBe("PING AN BANK");
  expect(parsed[0].section.code).toBe("J");
  expect(parsed[0].division.code).toBe("66");
}, 15000);

test("CAPCO PDF boundary rejects forged hashes and cancellation", async () => {
  const bytes = classificationPdf();
  const forged = await pdfText.extract(
    pdfResponse(bytes, "a".repeat(64)),
    transport.new_cancellation(),
  );
  expect(forged).toBeInstanceOf(Error);
  expect(forged[0]).toBe(pdfText.ExtractionError$ContentHashMismatch$const);

  const cancellation = transport.new_cancellation();
  transport.cancel(cancellation);
  const cancelled = await pdfText.extract(pdfResponse(bytes), cancellation);
  expect(cancelled).toBeInstanceOf(Error);
  expect(cancelled[0]).toBe(pdfText.ExtractionError$Cancelled$const);
});
