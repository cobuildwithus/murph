import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

import { prepareClinicalEnrichmentDocument } from "../src/hosted-runtime/clinical-enrichment-document.ts";

const roots: string[] = [];
const hasPoppler = ["pdfinfo", "pdftoppm", "pdftotext"].every((command) => {
  try { execFileSync(command, ["-v"], { stdio: "ignore" }); return true; }
  catch { return false; }
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Synthetic text cover followed by a raster-only result page. No patient fixture.
function mixedPdf(): Buffer {
  const cover = "BT /F1 12 Tf 40 740 Td (Synthetic clinical report cover) Tj ET";
  const scan = "q 300 0 0 100 40 650 cm /Im1 Do Q";
  const rows = ["010010111", "110010001", "010111010", "010001100", "111001111"];
  const pixels = Buffer.from(rows.join("").split("").map((pixel) => pixel === "1" ? 0 : 255));
  const stream = (content: string, extra = "") => `<< /Length ${Buffer.byteLength(content, "latin1")} ${extra} >>\nstream\n${content}\nendstream`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    stream(cover),
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>",
    stream(scan),
    stream(pixels.toString("latin1"), "/Type /XObject /Subtype /Image /Width 9 /Height 5 /ColorSpace /DeviceGray /BitsPerComponent 8"),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += "xref\n0 9\n0000000000 65535 f \n";
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

it.skipIf(!hasPoppler)("renders actual scanned clinical pages even when only the cover has extractable text", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "clinical-poppler-test-"));
  roots.push(root);
  const documentPath = path.join(root, "synthetic.pdf");
  await writeFile(documentPath, mixedPdf());
  const cover = await prepareClinicalEnrichmentDocument({ documentPath, mediaType: "application/pdf", page: 1 });
  roots.push(...cover.scratchRoots);
  const scan = await prepareClinicalEnrichmentDocument({ documentPath, mediaType: "application/pdf", page: 2 });
  roots.push(...scan.scratchRoots);
  expect(cover.totalPages).toBe(2);
  expect(cover.extractedText).toBe("Synthetic clinical report cover");
  expect(scan.totalPages).toBe(2);
  expect(scan.extractedText).toBeUndefined();
  expect(scan.renderedPages[0]!.page).toBe(2);
  const image = await readFile(scan.renderedPages[0]!.path);
  expect(image.toString("ascii", 12, 16)).toBe("IHDR");
  expect(image.readUInt32BE(16)).toBeLessThanOrEqual(2000);
  expect(image.readUInt32BE(20)).toBeLessThanOrEqual(2000);
  expect(image.length).toBeGreaterThan(1000);
  expect(image).not.toEqual(await readFile(cover.renderedPages[0]!.path));
  await scan.cleanup();
  await cover.cleanup();
  await expect(stat(scan.scratchRoots[0]!)).rejects.toMatchObject({ code: "ENOENT" });
});
