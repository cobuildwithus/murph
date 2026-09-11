import { mkdtemp, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const commands = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@murphai/parsers", () => ({ runCommand: commands.run }));
import { prepareClinicalEnrichmentDocument } from "../src/hosted-runtime/clinical-enrichment-document.ts";

const roots: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function source(bytes: Buffer | string = "synthetic PDF"): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "clinical-preparation-test-"));
  roots.push(root);
  const documentPath = path.join(root, "source.bin");
  await writeFile(documentPath, bytes);
  return documentPath;
}

function png(width = 100, height = 200): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

it("renders exactly the requested PDF page with bounded process and output settings", async () => {
  const documentPath = await source();
  commands.run.mockImplementation(async (command: string, args: string[]) => {
    if (command === "pdfinfo") return { stdout: "Pages: 7\n", stderr: "" };
    if (command === "pdftoppm") {
      await writeFile(`${args.at(-1)}.png`, png());
      return { stdout: "", stderr: "" };
    }
    return { stdout: "Page 3 clinical text\n", stderr: "" };
  });
  const prepared = await prepareClinicalEnrichmentDocument({ documentPath, mediaType: "application/pdf", page: 3 });
  roots.push(...prepared.scratchRoots);
  expect(prepared).toMatchObject({ totalPages: 7, extractedText: "Page 3 clinical text", renderedPages: [{ page: 3 }] });
  expect(commands.run).toHaveBeenCalledWith("pdftoppm", [
    "-f", "3", "-l", "3", "-singlefile", "-scale-to", "2000", "-png", expect.any(String), expect.any(String),
  ], expect.objectContaining({ timeoutMs: 15_000, maxStdoutBytes: 65_536, maxStderrBytes: 65_536 }));
  expect(commands.run).toHaveBeenCalledWith("pdftotext", [
    "-enc", "UTF-8", "-f", "3", "-l", "3", "-nopgbrk", expect.any(String), "-",
  ], expect.objectContaining({ maxStdoutBytes: 600_000 }));
  expect((await stat(prepared.scratchRoots[0]!)).mode & 0o777).toBe(0o700);
  expect((await stat(prepared.renderedPages[0]!.path)).mode & 0o777).toBe(0o600);
  await prepared.cleanup();
  await prepared.cleanup();
  await expect(stat(prepared.scratchRoots[0]!)).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps rendered scans usable when text extraction fails", async () => {
  commands.run.mockImplementation(async (command: string, args: string[]) => {
    if (command === "pdfinfo") return { stdout: "Pages: 1\n", stderr: "" };
    if (command === "pdftoppm") {
      await writeFile(`${args.at(-1)}.png`, png());
      return { stdout: "", stderr: "" };
    }
    throw new Error("no text layer");
  });
  const prepared = await prepareClinicalEnrichmentDocument({ documentPath: await source(), mediaType: "application/pdf", page: 1 });
  roots.push(...prepared.scratchRoots);
  expect(prepared.extractedText).toBeUndefined();
  expect(prepared.renderedPages).toHaveLength(1);
});

it("removes owned scratch and redacts parser diagnostics on failures or cancellation", async () => {
  let scratchRoot = "";
  commands.run.mockImplementation(async (_command: string, args: string[]) => {
    scratchRoot = path.dirname(args[0]!);
    throw new Error("synthetic private document title in parser stderr");
  });
  const documentPath = await source();
  await expect(prepareClinicalEnrichmentDocument({ documentPath, mediaType: "application/pdf", page: 1 })).rejects.toMatchObject({
    code: "CLINICAL_ENRICHMENT_DOCUMENT_RENDER_FAILED", message: "Clinical document preparation could not complete.",
  });
  await expect(stat(scratchRoot)).rejects.toMatchObject({ code: "ENOENT" });
  const controller = new AbortController();
  commands.run.mockImplementationOnce(async (_command: string, args: string[]) => {
    scratchRoot = path.dirname(args[0]!);
    controller.abort(new Error("synthetic preemption"));
    throw new Error("aborted");
  });
  await expect(prepareClinicalEnrichmentDocument({ documentPath, mediaType: "application/pdf", page: 1, signal: controller.signal })).rejects.toThrow("synthetic preemption");
  await expect(stat(scratchRoot)).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects invalid page numbers, oversized sources and oversized rendered dimensions", async () => {
  const documentPath = await source();
  for (const page of [0, 1.5, 100_001]) {
    await expect(prepareClinicalEnrichmentDocument({ documentPath, mediaType: "application/pdf", page })).rejects.toMatchObject({ code: "CLINICAL_ENRICHMENT_DOCUMENT_PAGE_INVALID" });
  }
  commands.run.mockImplementation(async (command: string, args: string[]) => {
    if (command === "pdfinfo") return { stdout: "Pages: 2\n", stderr: "" };
    await writeFile(`${args.at(-1)}.png`, png(2001, 100));
    return { stdout: "", stderr: "" };
  });
  await expect(prepareClinicalEnrichmentDocument({ documentPath, mediaType: "application/pdf", page: 3 })).rejects.toMatchObject({ code: "CLINICAL_ENRICHMENT_DOCUMENT_PAGE_INVALID" });
  await expect(prepareClinicalEnrichmentDocument({ documentPath, mediaType: "application/pdf", page: 1 })).rejects.toMatchObject({ code: "CLINICAL_ENRICHMENT_DOCUMENT_LIMIT" });
  await truncate(documentPath, 20 * 1024 * 1024 + 1);
  commands.run.mockClear();
  await expect(prepareClinicalEnrichmentDocument({ documentPath, mediaType: "application/pdf", page: 1 })).rejects.toMatchObject({ code: "CLINICAL_ENRICHMENT_DOCUMENT_LIMIT" });
  expect(commands.run).not.toHaveBeenCalled();
});

it("reuses clinical markup and charset decoding without running document programs", async () => {
  const documentPath = await source(Buffer.from('<html><script>untrusted code</script><p>Caf\u00e9: 142</p></html>', "latin1"));
  const prepared = await prepareClinicalEnrichmentDocument({ documentPath, mediaType: 'text/html; charset="windows-1252"', page: 1 });
  expect(prepared).toMatchObject({ totalPages: 1, extractedText: "Caf\u00e9: 142", renderedPages: [], scratchRoots: [] });
  expect(commands.run).not.toHaveBeenCalled();
  await prepared.cleanup();
  await expect(prepareClinicalEnrichmentDocument({ documentPath, mediaType: "application/octet-stream", page: 1 })).rejects.toMatchObject({ code: "CLINICAL_ENRICHMENT_DOCUMENT_UNSUPPORTED" });
});

it("preserves bounded PNG/JPEG evidence as one-page private sources", async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 100, 0, 200, 0, 0xff, 0xd9]);
  for (const [mediaType, bytes] of [["image/png", png()], ["image/jpeg", jpeg]] as const) {
    const documentPath = await source(bytes);
    const prepared = await prepareClinicalEnrichmentDocument({ documentPath, mediaType, page: 1 });
    roots.push(...prepared.scratchRoots);
    expect(prepared.totalPages).toBe(1);
    expect(await readFile(prepared.renderedPages[0]!.path)).toEqual(bytes);
    await expect(prepareClinicalEnrichmentDocument({ documentPath, mediaType, page: 2 })).rejects.toMatchObject({ code: "CLINICAL_ENRICHMENT_DOCUMENT_PAGE_INVALID" });
  }
  const tooWide = await source(png(9000, 1));
  await expect(prepareClinicalEnrichmentDocument({ documentPath: tooWide, mediaType: "image/png", page: 1 })).rejects.toMatchObject({ code: "CLINICAL_ENRICHMENT_DOCUMENT_LIMIT" });
  expect(commands.run).not.toHaveBeenCalled();
});
