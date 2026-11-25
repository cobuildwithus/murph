import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { createInterface } from "node:readline";
import { isDeepStrictEqual } from "node:util";

import { externalRefSchema } from "@murphai/contracts";
import * as z from "@murphai/contracts/zod-runtime";

import { VaultError } from "./errors.ts";
import { withCanonicalWriteLock } from "./operations/canonical-write-lock.ts";
import type { WriteBatch } from "./operations/write-batch.ts";
import { resolveVaultPathOnDisk } from "./path-safety.ts";
import { isErrnoException } from "./types.ts";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const sourceId = z.string().min(1).max(120);
const unitSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("retrieval"), batch: z.number().int().nonnegative(), generation: z.number().int().positive().optional() }).strict(),
  z.object({ kind: z.literal("enrichment"), batch: z.number().int().nonnegative(), jobId: digest, sourceId: digest, page: z.number().int().positive() }).strict(),
]);
const identitySchema = z.object({
  connectionId: sourceId, runId: sourceId, unit: unitSchema, inputDigest: digest,
}).strict();
const receiptSchema = z.object({
  schema: z.literal("murph.clinical-change-receipt.v1"),
  identity: identitySchema,
  changes: z.array(z.object({
    action: z.enum(["created", "superseded", "retracted"]),
    eventId: z.string().min(1),
    revision: z.number().int().positive(),
    externalRef: externalRefSchema,
  }).strict()),
}).strict();

export type ClinicalChangeReceipt = z.infer<typeof receiptSchema>;
export type ClinicalChangeReceiptIdentity = ClinicalChangeReceipt["identity"];
export type ClinicalRecordChange = ClinicalChangeReceipt["changes"][number];

export function clinicalChangeRunRef(runId: string): string {
  return createHash("sha256").update(sourceId.parse(runId)).digest("hex");
}

function shardPath(runRef: string) {
  return `ledger/clinical-change-receipts/${digest.parse(runRef)}.jsonl`;
}

async function* readRun(vaultRoot: string, runRef: string, offset = 0) {
  const file = await resolveVaultPathOnDisk(vaultRoot, shardPath(runRef));
  let handle;
  try {
    handle = await open(file.absolutePath, "r");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return;
    throw error;
  }
  const stream = handle.createReadStream({ start: offset });
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      let receipt;
      try {
        receipt = receiptSchema.parse(JSON.parse(line));
      } catch {
        // Parser errors can contain private input. Only surface the error class.
        throw new VaultError("CLINICAL_RECEIPT_INVALID", "Invalid private clinical receipt.");
      }
      if (clinicalChangeRunRef(receipt.identity.runId) !== runRef) {
        throw new VaultError("CLINICAL_RECEIPT_INVALID", "Invalid private clinical receipt.");
      }
      offset += Buffer.byteLength(line) + 1;
      yield { receipt, offset };
    }
  } finally {
    stream.destroy();
    await handle.close();
  }
}

export function listClinicalChangeReceipts(input: { vaultRoot: string; runRef: string; cursor?: number; limit?: number }) {
  const limit = z.number().int().min(1).max(32).parse(input.limit ?? 8);
  const cursor = z.number().int().nonnegative().parse(input.cursor ?? 0);
  return withCanonicalWriteLock(input.vaultRoot, async () => {
    const receipts: ClinicalChangeReceipt[] = [];
    let nextCursor = cursor;
    for await (const row of readRun(input.vaultRoot, input.runRef, cursor)) {
      if (receipts.length === limit) return { receipts, nextCursor };
      receipts.push(row.receipt);
      nextCursor = row.offset;
    }
    return { receipts, nextCursor: null };
  });
}

export async function readClinicalChangeReceipt(vaultRoot: string, identity: ClinicalChangeReceiptIdentity) {
  const expected = identitySchema.parse(identity);
  const runRef = clinicalChangeRunRef(expected.runId);
  return withCanonicalWriteLock(vaultRoot, async () => {
    for await (const { receipt } of readRun(vaultRoot, runRef)) {
      const stored = receipt.identity;
      const unit = stored.unit;
      const requested = expected.unit;
      const generationChanged = unit.kind === "retrieval" && requested.kind === "retrieval"
        && unit.generation !== requested.generation;
      if (stored.connectionId !== expected.connectionId || generationChanged) {
        throw receiptConflict();
      }
      const sameUnit = unit.kind === "retrieval" && requested.kind === "retrieval"
        ? unit.batch === requested.batch
        : isDeepStrictEqual(unit, requested);
      if (sameUnit) {
        if (stored.inputDigest !== expected.inputDigest) throw receiptConflict();
        return receipt;
      }
    }
    return null;
  });
}

function receiptConflict() {
  return new VaultError("CLINICAL_RECEIPT_CONFLICT", "Clinical import identity or input digest changed.");
}

export async function stageClinicalChangeReceipt(batch: WriteBatch, identity: ClinicalChangeReceiptIdentity, changes: ClinicalRecordChange[]) {
  const receipt = receiptSchema.parse({ schema: "murph.clinical-change-receipt.v1", identity, changes });
  await batch.stageJsonlAppend(shardPath(clinicalChangeRunRef(identity.runId)), JSON.stringify(receipt) + "\n");
  return receipt;
}
