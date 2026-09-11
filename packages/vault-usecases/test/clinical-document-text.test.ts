import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect, it } from "vitest";
import { extractClinicalDocumentText } from "../src/clinical-document-text.js";

const roots: string[] = [];
const hasPoppler = (() => {
  try {
    execFileSync("pdfinfo", ["-v"], { stdio: "ignore" });
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch { return false; }
})();
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function vaultRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "clinical-pdf-proof-"));
  roots.push(root);
  return root;
}

// A complete synthetic PDF with an actual xref table, no external fixture/tool dependency.
function syntheticPdf(pageCount: number): Uint8Array {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${4 + index * 2} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let page = 1; page <= pageCount; page++) {
    const stream = `BT /F1 12 Tf 40 740 Td (Clinical report page ${page}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + (page - 1) * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

it.skipIf(!hasPoppler)("reads actual PDF pages beyond the old parser default and removes scratch", async () => {
  const root = await vaultRoot();
  const text = await extractClinicalDocumentText({ bytes: syntheticPdf(101), mediaType: "application/pdf", vaultRoot: root });
  expect(text).toContain("Clinical report page 1");
  expect(text).toContain("Clinical report page 101");
  expect(await readdir(path.join(root, ".runtime/tmp/clinical-document-parser"))).toEqual([]);
});

it("keeps unsupported documents and failed extraction distinguishable from readable text", async () => {
  const root = await vaultRoot();
  expect(await extractClinicalDocumentText({ bytes: Buffer.from("unreadable"), mediaType: "image/png", vaultRoot: root })).toBeUndefined();
  expect(await extractClinicalDocumentText({ bytes: Buffer.from("unreadable"), mediaType: "application/pdf", vaultRoot: root })).toBeUndefined();
  const controller = new AbortController();
  controller.abort(new Error("interrupted"));
  await expect(extractClinicalDocumentText({ bytes: syntheticPdf(1), mediaType: "application/pdf", vaultRoot: root, signal: controller.signal })).rejects.toThrow("interrupted");
});
