import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CLINICAL_DOCUMENT_MAX_BYTES } from "@murphai/clinical-records";
import { runCommand } from "@murphai/parsers";
import { readClinicalDocumentSourceText } from "@murphai/vault-usecases/clinical-records";

const MAX_TEXT_BYTES = 600_000;
const MAX_RENDER_BYTES = 16 * 1024 * 1024;
const MAX_RENDER_DIMENSION = 2_000;
const MAX_SOURCE_IMAGE_DIMENSION = 8_192;
const MAX_SOURCE_IMAGE_PIXELS = 32_000_000;
const MAX_PAGES = 100_000;
const COMMAND_TIMEOUT_MS = 15_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export class ClinicalEnrichmentDocumentError extends Error {
  constructor(readonly code:
    | "CLINICAL_ENRICHMENT_DOCUMENT_UNSUPPORTED"
    | "CLINICAL_ENRICHMENT_DOCUMENT_LIMIT"
    | "CLINICAL_ENRICHMENT_DOCUMENT_INVALID"
    | "CLINICAL_ENRICHMENT_DOCUMENT_PAGE_INVALID"
    | "CLINICAL_ENRICHMENT_DOCUMENT_RENDER_FAILED") {
    super("Clinical document preparation could not complete.");
    this.name = "ClinicalEnrichmentDocumentError";
  }
}

export interface PreparedClinicalEnrichmentDocument {
  totalPages: number;
  extractedText?: string;
  renderedPages: { page: number; path: string }[];
  scratchRoots: string[];
  cleanup(): Promise<void>;
}

interface DocumentPreparationInput {
  documentPath: string;
  mediaType: string;
  page: number;
  signal?: AbortSignal | null;
}

type PreparedDocumentPage = Pick<PreparedClinicalEnrichmentDocument,
  "totalPages" | "extractedText" | "renderedPages">;

type ImageMediaType = "image/png" | "image/jpeg";

function isTextMediaType(mediaType: string): boolean {
  return ["text/plain", "text/html", "application/xhtml+xml", "application/xml", "text/xml"].includes(mediaType)
    || mediaType.endsWith("+xml");
}

export async function prepareClinicalEnrichmentDocument(
  input: DocumentPreparationInput,
): Promise<PreparedClinicalEnrichmentDocument> {
  input.signal?.throwIfAborted();
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > MAX_PAGES) {
    throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_PAGE_INVALID");
  }
  const mediaType = input.mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const isText = isTextMediaType(mediaType);
  if (!isText && mediaType !== "application/pdf" && mediaType !== "image/png" && mediaType !== "image/jpeg") {
    throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_UNSUPPORTED");
  }
  const bytes = await readBoundedSource(input.documentPath);
  input.signal?.throwIfAborted();
  if (bytes.length > CLINICAL_DOCUMENT_MAX_BYTES) {
    throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_LIMIT");
  }
  if (isText) return prepareTextDocument(input, bytes);

  const scratchRoot = await realpath(await mkdtemp(path.join(tmpdir(), "clinical-enrichment-document-")));
  const cleanup = () => rm(scratchRoot, { recursive: true, force: true });
  try {
    await chmod(scratchRoot, 0o700);
    input.signal?.throwIfAborted();
    const prepared = mediaType === "image/png" || mediaType === "image/jpeg"
      ? await prepareImageDocument(input, bytes, mediaType, scratchRoot)
      : await preparePdfDocument(input, bytes, scratchRoot);
    return { ...prepared, scratchRoots: [scratchRoot], cleanup };
  } catch (error) {
    await cleanup();
    input.signal?.throwIfAborted();
    if (error instanceof ClinicalEnrichmentDocumentError) throw error;
    throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_RENDER_FAILED");
  }
}

async function prepareTextDocument(input: DocumentPreparationInput, bytes: Buffer): Promise<PreparedClinicalEnrichmentDocument> {
  assertRequestedPage(input.page, 1);
  const extractedText = await readClinicalDocumentSourceText({ bytes, mediaType: input.mediaType });
  input.signal?.throwIfAborted();
  if (!extractedText) throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_INVALID");
  if (Buffer.byteLength(extractedText, "utf8") > MAX_TEXT_BYTES) {
    throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_LIMIT");
  }
  return { totalPages: 1, extractedText, renderedPages: [], scratchRoots: [], async cleanup() {} };
}

async function prepareImageDocument(
  input: DocumentPreparationInput,
  bytes: Buffer,
  mediaType: ImageMediaType,
  scratchRoot: string,
): Promise<PreparedDocumentPage> {
  assertRequestedPage(input.page, 1);
  const dimensions = mediaType === "image/png" ? readPngDimensions(bytes) : readJpegDimensions(bytes);
  assertImageDimensions(dimensions, MAX_SOURCE_IMAGE_DIMENSION, MAX_SOURCE_IMAGE_PIXELS);
  const imagePath = path.join(scratchRoot, mediaType === "image/png" ? "source.png" : "source.jpg");
  await writeFile(imagePath, bytes, { mode: 0o600 });
  input.signal?.throwIfAborted();
  return { totalPages: 1, renderedPages: [{ page: 1, path: imagePath }] };
}

function pdfCommandOptions(signal: AbortSignal | null | undefined) {
  return {
    maxStderrBytes: 64 * 1024,
    maxStdoutBytes: 64 * 1024,
    timeoutMs: COMMAND_TIMEOUT_MS,
    ...(signal ? { signal } : {}),
  };
}

async function preparePdfDocument(
  input: DocumentPreparationInput,
  bytes: Buffer,
  scratchRoot: string,
): Promise<PreparedDocumentPage> {
  const pdfPath = path.join(scratchRoot, "source.pdf");
  await writeFile(pdfPath, bytes, { mode: 0o600 });
  const info = await runCommand("pdfinfo", [pdfPath], pdfCommandOptions(input.signal));
  const totalPages = Number(/^Pages:\s+(\d+)\s*$/mu.exec(info.stdout)?.[1]);
  if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > MAX_PAGES) {
    throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_LIMIT");
  }
  assertRequestedPage(input.page, totalPages);
  const imagePath = await renderPdfPage(input, pdfPath, scratchRoot);
  const extractedText = await readPdfPageText(input, pdfPath);
  input.signal?.throwIfAborted();
  return {
    totalPages,
    ...(extractedText ? { extractedText } : {}),
    renderedPages: [{ page: input.page, path: imagePath }],
  };
}

async function renderPdfPage(input: DocumentPreparationInput, pdfPath: string, scratchRoot: string): Promise<string> {
  const outputPrefix = path.join(scratchRoot, "page");
  await runCommand("pdftoppm", [
    "-f", String(input.page), "-l", String(input.page), "-singlefile",
    "-scale-to", String(MAX_RENDER_DIMENSION), "-png", pdfPath, outputPrefix,
  ], pdfCommandOptions(input.signal));
  input.signal?.throwIfAborted();
  const imagePath = `${outputPrefix}.png`;
  const imageStat = await stat(imagePath);
  if (!imageStat.isFile() || imageStat.size > MAX_RENDER_BYTES) {
    throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_LIMIT");
  }
  const imageBytes = await readFile(imagePath);
  assertImageDimensions(readPngDimensions(imageBytes), MAX_RENDER_DIMENSION, MAX_RENDER_DIMENSION ** 2);
  await chmod(imagePath, 0o600);
  return imagePath;
}

async function readPdfPageText(input: DocumentPreparationInput, pdfPath: string): Promise<string | undefined> {
  try {
    const extracted = await runCommand("pdftotext", [
      "-enc", "UTF-8", "-f", String(input.page), "-l", String(input.page),
      "-nopgbrk", pdfPath, "-",
    ], { ...pdfCommandOptions(input.signal), maxStdoutBytes: MAX_TEXT_BYTES });
    return extracted.stdout.trim() || undefined;
  } catch {
    // Rendered evidence remains usable for scans and for failed text extraction.
    input.signal?.throwIfAborted();
    return undefined;
  }
}

function assertRequestedPage(page: number, totalPages: number): void {
  if (page > totalPages) throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_PAGE_INVALID");
}

async function readBoundedSource(documentPath: string): Promise<Buffer> {
  try {
    const sourcePath = await realpath(documentPath);
    const metadata = await stat(sourcePath);
    if (!metadata.isFile() || metadata.size < 1) {
      throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_INVALID");
    }
    if (metadata.size > CLINICAL_DOCUMENT_MAX_BYTES) {
      throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_LIMIT");
    }
    return await readFile(sourcePath);
  } catch (error) {
    if (error instanceof ClinicalEnrichmentDocumentError) throw error;
    throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_INVALID");
  }
}

function assertImageDimensions(dimensions: { width: number; height: number } | null, maxDimension: number, maxPixels: number): void {
  if (!dimensions || !dimensions.width || !dimensions.height) {
    throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_INVALID");
  }
  if (dimensions.width > maxDimension || dimensions.height > maxDimension
    || dimensions.width * dimensions.height > maxPixels) {
    throw new ClinicalEnrichmentDocumentError("CLINICAL_ENRICHMENT_DOCUMENT_LIMIT");
  }
}

function readPngDimensions(bytes: Buffer): { width: number; height: number } | null {
  return bytes.length >= 24 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)
    && bytes.toString("ascii", 12, 16) === "IHDR"
    ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;
}

function readJpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++]!;
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return length >= 8
        ? { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) } : null;
    }
    offset += length;
  }
  return null;
}
