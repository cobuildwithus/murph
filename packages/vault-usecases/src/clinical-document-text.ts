import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRuntimePaths } from "@murphai/runtime-state/node";

import { loadRuntimeModule } from "./runtime-import.js";

// The original document is always preserved by the clinical import owner.
// Refuse partial extraction so a later retry cannot enrich the same FHIR revision.
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_EXTRACTED_TEXT_BYTES = 600_000;

export async function extractClinicalDocumentText(input: {
  bytes: Uint8Array;
  mediaType: string;
  signal?: AbortSignal | null;
  vaultRoot: string;
}): Promise<string | undefined> {
  if (input.mediaType.split(";", 1)[0]?.trim().toLowerCase() !== "application/pdf") {
    return undefined;
  }
  input.signal?.throwIfAborted();
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) return undefined;
  const scratchRoot = path.join(resolveRuntimePaths(input.vaultRoot).tempRoot, "clinical-document-parser");
  await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  const scratchDirectory = await mkdtemp(path.join(scratchRoot, "pdf-"));
  try {
    const inputPath = path.join(scratchDirectory, "document.pdf");
    await writeFile(inputPath, input.bytes, { mode: 0o600 });
    const { createPopplerPdfProvider } = await loadRuntimeModule<typeof import("@murphai/parsers")>("@murphai/parsers");
    const provider = createPopplerPdfProvider({
      commandTimeoutMs: 15_000,
      maxInputBytes: MAX_DOCUMENT_BYTES,
      maxOutputBytes: MAX_EXTRACTED_TEXT_BYTES,
      maxPages: 10_000,
    });
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const result = await provider.run({
      artifact: {
        absolutePath: inputPath,
        attachmentId: sha256,
        byteSize: input.bytes.byteLength,
        captureId: sha256,
        fileName: "document.pdf",
        kind: "document",
        mime: "application/pdf",
        sha256,
        storedPath: "document.pdf",
      },
      inputPath,
      intent: "attachment_text",
      scratchDirectory,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    input.signal?.throwIfAborted();
    if (result.metadata?.warnings?.length || !result.text.trim()) return undefined;
    return result.text;
  } catch {
    input.signal?.throwIfAborted();
    return undefined;
  } finally {
    await rm(scratchDirectory, { recursive: true, force: true });
  }
}
