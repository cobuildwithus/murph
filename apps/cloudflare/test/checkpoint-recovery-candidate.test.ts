import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { initializeVault, withHostedCanonicalWritePort, type HostedCanonicalWriteReceipt } from "@murphai/core";
import { hashHostedBrowserVaultReplicaSources } from "@murphai/assistant-runtime";
import {
  clearRecoveryCandidate, createRecoveryCandidate, retainRecoveryCandidateArtifact, validateRecoveryCandidate,
  type RecoveryCandidate,
} from "../scripts/checkpoint-recovery-candidate.ts";

const candidates: RecoveryCandidate[] = [];
const scratch: string[] = [];
afterEach(async () => {
  for (const candidate of candidates.splice(0)) clearRecoveryCandidate(candidate);
  for (const directory of scratch.splice(0)) await rm(directory, { recursive: true, force: true });
});

function retainReceipt(candidate: RecoveryCandidate, receipt: HostedCanonicalWriteReceipt) {
  const bytes = Buffer.from(JSON.stringify(receipt));
  retainRecoveryCandidateArtifact(candidate, createHash("sha256").update(bytes).digest("hex"), bytes, Date.now() + 60_000);
}

async function fixture() {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "synthetic-candidate-source-"));
  scratch.push(vaultRoot);
  const candidate = createRecoveryCandidate();
  candidates.push(candidate);
  await withHostedCanonicalWritePort({ async persistCanonicalWrite(write) {
    for (const payload of write.payloads) retainRecoveryCandidateArtifact(candidate, payload.sha256, payload.bytes, Date.now() + 60_000);
    retainReceipt(candidate, write.receipt);
  } }, () => initializeVault({ vaultRoot, title: "Synthetic recovery vault", timezone: "UTC" }));
  const source = await hashHostedBrowserVaultReplicaSources(vaultRoot);
  return { candidate, expectedSourceHash: source.hash, signal: new AbortController().signal };
}

it("replays original initialization and matches the real Browser Vault source owner without certifying history", async () => {
  const input = await fixture();
  const result = await validateRecoveryCandidate(input);
  expect(result).toMatchObject({ complete: true, validVault: true, sourceHashMatches: true,
    replayedReceipts: 1, mediaActionsWithoutPayload: 0, acceptedHistoryProven: false, restorationPerformed: false,
    history: { metadataWriteActions: 1, coreWriteActions: 1, metadataPayloadCandidates: 1, firstAppendNeedsBasePaths: 0 } });
  expect(JSON.stringify(result)).not.toContain("Synthetic recovery vault");
  const retained = [...input.candidate.payloads.values()];
  clearRecoveryCandidate(input.candidate);
  expect(retained.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
});

it.each([false, true])("reports a missing starting file without silently adopting a full base artifact (available=%s)", async (baseAvailable) => {
  const input = await fixture();
  const base = Buffer.from('{"id":"synthetic-base"}\n');
  const append = Buffer.from('{"id":"synthetic-next"}\n');
  const baseSha256 = createHash("sha256").update(base).digest("hex");
  const appendSha256 = createHash("sha256").update(append).digest("hex");
  const targetRelativePath = "ledger/events/2026-01.jsonl";
  if (baseAvailable) retainRecoveryCandidateArtifact(input.candidate, baseSha256, base, Date.now());
  retainRecoveryCandidateArtifact(input.candidate, appendSha256, append, Date.now());
  const initial = input.candidate.receipts[0]!.receipt;
  retainReceipt(input.candidate, { ...initial, operationId: "synthetic-conflict",
    committedAt: new Date(Date.parse(initial.committedAt) + 1000).toISOString(),
    actions: [{ kind: "jsonl_append", targetRelativePath, appendSha256, appendByteLength: append.byteLength,
      originalSize: base.byteLength, baseByteLength: base.byteLength, baseSha256,
      contentRef: { sha256: appendSha256, byteSize: append.byteLength } }] });
  const result = await validateRecoveryCandidate(input);
  expect(result).toMatchObject({ complete: false, replayedReceipts: 1, failure: "history_conflict",
    failureAction: { kind: "jsonl_append", family: "events", expectedBaseBytes: base.byteLength, fullBaseArtifactPresent: baseAvailable },
    history: { firstAppendNeedsBasePaths: 1, firstAppendBasePayloadsPresent: Number(baseAvailable) },
    acceptedHistoryProven: false, restorationPerformed: false });
  const output = JSON.stringify(result);
  for (const privateValue of [targetRelativePath, "synthetic-conflict", "synthetic-base", "synthetic-next", baseSha256, appendSha256]) {
    expect(output).not.toContain(privateValue);
  }
});

it("distinguishes an authenticated metadata payload from a receipt that writes it", async () => {
  const input = await fixture();
  input.candidate.receipts[0]!.receipt.actions = input.candidate.receipts[0]!.receipt.actions
    .filter((action) => action.targetRelativePath !== "vault.json");
  const result = await validateRecoveryCandidate(input);
  expect(result).toMatchObject({ history: { metadataWriteActions: 0, metadataPayloadCandidates: 1 }, restorationPerformed: false });
  expect(result).not.toMatchObject({ validVault: true });
  clearRecoveryCandidate(input.candidate);
  expect(input.candidate.metadataPayloadCandidates).toBe(0);
});

it("rejects missing or corrupted payloads through canonical replay", async () => {
  for (const missing of [true, false]) {
    const input = await fixture();
    const action = input.candidate.receipts[0]!.receipt.actions.find((action) => action.kind === "text_upsert")!;
    if (action.kind !== "text_upsert" || !action.contentRef) throw new Error("Missing synthetic text payload");
    if (missing) input.candidate.payloads.delete(action.contentRef.sha256);
    else input.candidate.payloads.get(action.contentRef.sha256)!.fill(0);
    expect(await validateRecoveryCandidate(input)).toMatchObject({ complete: false, failureStage: "replay", restorationPerformed: false });
  }
});

it("does not equate a valid vault with the accepted source fingerprint", async () => {
  const input = await fixture();
  expect(await validateRecoveryCandidate({ ...input, expectedSourceHash: "0".repeat(64) }))
    .toMatchObject({ complete: true, validVault: true, sourceHashMatches: false, acceptedHistoryProven: false });
});

it("excludes duplicate compactions and receipts after the comparison cutoff", async () => {
  const input = await fixture();
  const receipt = input.candidate.receipts[0]!.receipt;
  retainReceipt(input.candidate, { ...receipt, operationType: "hosted_canonical_write_receipt_compaction" });
  retainReceipt(input.candidate, { ...receipt, committedAt: new Date(Date.now() + 120_000).toISOString() });
  expect(await validateRecoveryCandidate(input)).toMatchObject({ complete: true, replayedReceipts: 1, sourceHashMatches: true });
});

it("honors deletes in timestamp order rather than inventory order", async () => {
  const input = await fixture();
  const receipt = input.candidate.receipts[0]!.receipt;
  retainReceipt(input.candidate, { ...receipt, committedAt: new Date(Date.parse(receipt.committedAt) + 1000).toISOString(),
    actions: [{ kind: "delete", targetRelativePath: "vault.json", existedBefore: true }] });
  input.candidate.receipts.reverse();
  const result = await validateRecoveryCandidate(input);
  expect(result).not.toMatchObject({ validVault: true });
  expect(result).toMatchObject({ replayedReceipts: 2, acceptedHistoryProven: false });
});

it("rejects path escapes and honors cancellation before replay", async () => {
  const input = await fixture();
  input.candidate.receipts[0]!.receipt.actions[0]!.targetRelativePath = "../escaped.txt";
  expect(await validateRecoveryCandidate(input)).toMatchObject({ complete: false, failureStage: "replay" });
  const controller = new AbortController(); controller.abort();
  expect(await validateRecoveryCandidate({ ...input, signal: controller.signal }))
    .toMatchObject({ complete: false, replayedReceipts: 0 });
});

it("stops retaining bytes or accepting actions at the shared candidate budgets", async () => {
  const input = await fixture();
  input.candidate.retainedBytes = 256 * 1024 * 1024;
  expect(() => retainRecoveryCandidateArtifact(input.candidate, "f".repeat(64), new Uint8Array([1]), Date.now()))
    .toThrow("recovery_candidate_memory_limit");
  expect(input.candidate.payloads.has("f".repeat(64))).toBe(false);
  input.candidate.retainedBytes = 0;
  input.candidate.actions = 200_000;
  expect(() => retainReceipt(input.candidate, { ...input.candidate.receipts[0]!.receipt, operationId: "synthetic-over-budget" }))
    .toThrow("recovery_candidate_replay_limit");
  clearRecoveryCandidate(input.candidate);
  expect(input.candidate.payloads.size).toBe(0);
});
