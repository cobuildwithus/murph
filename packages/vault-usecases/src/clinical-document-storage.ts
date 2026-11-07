import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  CLINICAL_DOCUMENT_MAX_BYTES, clinicalRawManifestSchema, clinicalRawPathSchema,
  hashClinicalDocumentBytes,
} from "@murphai/clinical-records";
import * as z from "@murphai/contracts/zod-runtime";
import { applyCanonicalWriteBatch, resolveVaultPathOnDisk, withCanonicalWriteLock } from "@murphai/core";
import { readClinicalAttachmentText } from "@murphai/importers/clinical-records";

import { readClinicalEnrichmentParentEligibility } from "./clinical-enrichment-parent.ts";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const integrity = z.object({ sha256: digest, byteLength: z.number().int().positive().max(CLINICAL_DOCUMENT_MAX_BYTES) }).strict();
const storageReceiptSchema = z.object({
  schema: z.literal("murph.clinical-document-storage.v1"),
  transformation: z.literal("reviewed-embedded-image-omission"),
  original: integrity,
  stored: integrity,
  clinicalTextSha256: digest,
  removedImageSha256s: z.array(digest).min(1).max(64),
}).strict();
type StorageReceipt = z.infer<typeof storageReceiptSchema>;
type Source = { rawRef: string; sha256: string; byteLength: number; mediaType: string };
const receiptPath = (rawRef: string) => `${rawRef}.storage.json`;

async function readBounded(vaultRoot: string, relativePath: string, maxBytes: number) {
  const resolved = await resolveVaultPathOnDisk(vaultRoot, relativePath);
  const info = await stat(resolved.absolutePath);
  if (!info.isFile() || info.size > maxBytes) throw new Error("Clinical storage evidence exceeds its bound.");
  const bytes = await readFile(resolved.absolutePath);
  if (bytes.length > maxBytes) throw new Error("Clinical storage evidence exceeds its bound.");
  return { bytes, absolutePath: resolved.absolutePath };
}

/** Original identity remains manifest-bound; retained bytes have their own explicit integrity receipt. */
export async function readClinicalStoredDocument(input: { vaultRoot: string; source: Source }) {
  // Raw bytes and their receipt publish in one canonical batch. Readers must
  // share its lock so they cannot observe an intermediate file replacement.
  return withCanonicalWriteLock(input.vaultRoot, () => readStoredDocument(input));
}

async function readStoredDocument(input: { vaultRoot: string; source: Source }) {
  const rawRef = clinicalRawPathSchema.parse(input.source.rawRef);
  const original = integrity.parse({ sha256: input.source.sha256, byteLength: input.source.byteLength });
  let receipt: StorageReceipt | undefined;
  try {
    const stored = await readBounded(input.vaultRoot, receiptPath(rawRef), 16_384);
    receipt = storageReceiptSchema.parse(JSON.parse(stored.bytes.toString("utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (receipt && (receipt.original.sha256 !== original.sha256 || receipt.original.byteLength !== original.byteLength)) {
    throw new Error("Clinical storage receipt does not match the original source.");
  }
  const file = await readBounded(input.vaultRoot, rawRef, CLINICAL_DOCUMENT_MAX_BYTES);
  const expected = receipt?.stored ?? original;
  if (file.bytes.length !== expected.byteLength || hashClinicalDocumentBytes(file.bytes) !== expected.sha256) {
    throw new Error("Clinical stored document integrity mismatch.");
  }
  if (receipt) {
    const text = readClinicalAttachmentText(file.bytes, input.source.mediaType);
    if (text === undefined || hashClinicalDocumentBytes(Buffer.from(text)) !== receipt.clinicalTextSha256) {
      throw new Error("Clinical retained text integrity mismatch.");
    }
  }
  return { ...file, sha256: expected.sha256, receipt };
}

/** A replay uses retained bytes only when explicit storage evidence exists. */
export async function readMinimizedClinicalDocument(input: { vaultRoot: string; source: Source }) {
  const rawRef = clinicalRawPathSchema.parse(input.source.rawRef);
  try { await readBounded(input.vaultRoot, receiptPath(rawRef), 16_384); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
  return (await readClinicalStoredDocument(input)).bytes;
}

/** Omit only exact image payloads already reviewed as nonclinical; never classify images heuristically. */
type MinimizationInput = {
  vaultRoot: string;
  manifestPath: string;
  manifestSha256: string;
  attachmentRelativePath: string;
  reviewedImageSha256s: string[];
};

export async function minimizeClinicalDocumentImages(input: MinimizationInput): Promise<{ changed: boolean; bytesSaved: number; removedImageCount: number }> {
  const reviewed = new Set(z.array(digest).min(1).max(64).parse(input.reviewedImageSha256s));
  const manifestPath = clinicalRawPathSchema.parse(input.manifestPath);
  digest.parse(input.manifestSha256);
  return withCanonicalWriteLock(input.vaultRoot, async () => {
    const source = await readMinimizationSource(input, manifestPath);
    const rawRef = source.rawRef;
    const stored = await readClinicalStoredDocument({ vaultRoot: input.vaultRoot, source });
    const html = stored.bytes.toString("utf8");
    if (!Buffer.from(html).equals(stored.bytes)) throw new Error("Clinical image cleanup requires lossless UTF-8 text.");
    const removed = new Set(stored.receipt?.removedImageSha256s ?? []);
    const next = html.replace(/data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\r\n]+)/giu, (uri, encoded: string) => {
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.toString("base64") !== encoded.replace(/\s/gu, "")) return uri;
      const sha256 = hashClinicalDocumentBytes(bytes);
      if (!reviewed.has(sha256)) return uri;
      removed.add(sha256);
      return "data:,";
    });
    if ([...reviewed].some((sha256) => !removed.has(sha256))) throw new Error("Reviewed image was not found in this source.");
    if (next === html) return { changed: false, bytesSaved: 0, removedImageCount: 0 };
    const text = readClinicalAttachmentText(stored.bytes, source.mediaType);
    const bytes = Buffer.from(next);
    if (text === undefined || readClinicalAttachmentText(bytes, source.mediaType) !== text) {
      throw new Error("Clinical image cleanup would change retained clinical text.");
    }
    const receipt = storageReceiptSchema.parse({
      schema: "murph.clinical-document-storage.v1", transformation: "reviewed-embedded-image-omission",
      original: { sha256: source.sha256, byteLength: source.byteLength },
      stored: { sha256: hashClinicalDocumentBytes(bytes), byteLength: bytes.length },
      clinicalTextSha256: hashClinicalDocumentBytes(Buffer.from(text)), removedImageSha256s: [...removed].sort(),
    });
    const receiptContent = `${JSON.stringify(receipt, null, 2)}\n`;
    const metadataPath = receiptPath(rawRef);
    const existingReceipt = stored.receipt ? await readBounded(input.vaultRoot, metadataPath, 16_384) : undefined;
    const bytesSaved = stored.bytes.length + (existingReceipt?.bytes.length ?? 0) - bytes.length - Buffer.byteLength(receiptContent);
    if (bytesSaved <= 0) return { changed: false, bytesSaved: 0, removedImageCount: 0 };
    await applyCanonicalWriteBatch({
      vaultRoot: input.vaultRoot, operationType: "clinical_document_image_minimization",
      summary: "Omit reviewed nonclinical embedded images while preserving clinical text",
      audit: { action: "vault_repair", commandName: "vault-usecases.minimizeClinicalDocumentImages", summary: `Omitted reviewed nonclinical images; bytesSaved=${bytesSaved}.` },
      textWrites: [{ relativePath: rawRef, content: next, overwrite: true,
        rawReplacement: { sha256: stored.sha256, byteLength: stored.bytes.length } },
      ...(existingReceipt ? [{ relativePath: metadataPath, content: receiptContent, overwrite: true,
        rawReplacement: { sha256: hashClinicalDocumentBytes(existingReceipt.bytes), byteLength: existingReceipt.bytes.length } }] : [])],
      ...(!existingReceipt ? { rawContents: [{ targetRelativePath: metadataPath, content: receiptContent, originalFileName: "storage.json", mediaType: "application/json" }] } : {}),
    });
    await readClinicalStoredDocument({ vaultRoot: input.vaultRoot, source });
    return { changed: true, bytesSaved, removedImageCount: removed.size - (stored.receipt?.removedImageSha256s.length ?? 0) };
  });
}

async function readMinimizationSource(input: MinimizationInput, manifestPath: string): Promise<Source> {
  const file = await readBounded(input.vaultRoot, manifestPath, 4 * 1024 * 1024);
  if (hashClinicalDocumentBytes(file.bytes) !== input.manifestSha256) throw new Error("Clinical source manifest changed.");
  const manifest = clinicalRawManifestSchema.parse(JSON.parse(file.bytes.toString("utf8")));
  const attachments = manifest.documentAttachments?.filter((item) => item.status === "downloaded" && item.relativePath === input.attachmentRelativePath) ?? [];
  const attachment = attachments[0];
  if (!attachment || attachment.status !== "downloaded" || !/^text\/html(?:;|$)/iu.test(attachment.mediaType)) {
    throw new Error("Only a manifest-bound HTML document can be minimized.");
  }
  for (const candidate of attachments) {
    if (candidate.status !== "downloaded" || candidate.sha256 !== attachment.sha256
      || candidate.byteLength !== attachment.byteLength || candidate.mediaType !== attachment.mediaType) {
      throw new Error("Clinical attachment has conflicting manifest evidence.");
    }
    const parent = await readClinicalEnrichmentParentEligibility({ vaultRoot: input.vaultRoot, manifestPath, manifest, attachment: candidate });
    if (!parent.eligible || parent.hasInlineContent) throw new Error("Clinical image cleanup requires an eligible linked document.");
  }
  const rawRef = clinicalRawPathSchema.parse(path.posix.join(path.posix.dirname(manifestPath), attachment.relativePath));
  return { rawRef, sha256: attachment.sha256, byteLength: attachment.byteLength, mediaType: attachment.mediaType };
}
