import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { safeParseContract, VAULT_FAMILY_DESCRIPTORS, VAULT_LAYOUT, vaultMetadataSchema } from "@murphai/contracts";
import {
  applyHostedCanonicalWriteReceipt, REQUIRED_DIRECTORIES, validateVault,
  type HostedCanonicalWriteReceipt, type HostedCanonicalWriteReceiptAction,
} from "@murphai/core";
import {
  hashHostedBrowserVaultReplicaSources, parseHostedCanonicalWriteReceiptArtifact,
} from "@murphai/assistant-runtime";

const MAX_RETAINED_BYTES = 256 * 1024 * 1024;
const MAX_REPLAY_BYTES = 512 * 1024 * 1024;
const MAX_ACTIONS = 200_000;
const RECEIPT_SCHEMA = "murph.hosted-canonical-write-receipt.v1";

export interface RecoveryCandidate {
  payloads: Map<string, Uint8Array>;
  receipts: Array<{ sha256: string; receipt: HostedCanonicalWriteReceipt }>;
  retainedBytes: number;
  replayBytes: number;
  actions: number;
  metadataPayloadCandidates: number;
}

export function createRecoveryCandidate(): RecoveryCandidate {
  return { payloads: new Map(), receipts: [], retainedBytes: 0, replayBytes: 0, actions: 0, metadataPayloadCandidates: 0 };
}

// Only the authenticated census may supply these bytes. No receipt, path,
// plaintext, or content hash is included in the validation result.
export function retainRecoveryCandidateArtifact(
  candidate: RecoveryCandidate, sha256: string, plaintext: Uint8Array, before: number,
): void {
  if (candidate.payloads.has(sha256)) return;
  if (candidate.retainedBytes + plaintext.byteLength > MAX_RETAINED_BYTES) {
    throw new Error("recovery_candidate_memory_limit");
  }
  candidate.payloads.set(sha256, Buffer.from(plaintext));
  candidate.retainedBytes += plaintext.byteLength;
  if (plaintext.byteLength > 4 * 1024 * 1024) return;
  let value: unknown;
  const serialized = new TextDecoder().decode(plaintext);
  try { value = JSON.parse(serialized); } catch { return; }
  if (safeParseContract(vaultMetadataSchema, value).success) candidate.metadataPayloadCandidates++;
  if (value === null || typeof value !== "object" || !("schema" in value) || value.schema !== RECEIPT_SCHEMA) return;
  const receipt = parseHostedCanonicalWriteReceiptArtifact(serialized);
  if (!receipt || !Number.isFinite(Date.parse(receipt.committedAt))) throw new Error("recovery_candidate_invalid_receipt");
  // Compactions duplicate original actions; their existence is not acceptance.
  if (Date.parse(receipt.committedAt) > before || receipt.operationType === "hosted_canonical_write_receipt_compaction") return;
  candidate.actions += receipt.actions.length;
  for (const action of receipt.actions) {
    if (action.kind === "text_upsert" || action.kind === "raw_upsert") candidate.replayBytes += action.byteLength;
    if (action.kind === "jsonl_append") candidate.replayBytes += action.appendByteLength;
  }
  if (candidate.actions > MAX_ACTIONS || candidate.replayBytes > MAX_REPLAY_BYTES) throw new Error("recovery_candidate_replay_limit");
  candidate.receipts.push({ sha256, receipt });
}

export function clearRecoveryCandidate(candidate: RecoveryCandidate): void {
  for (const bytes of candidate.payloads.values()) bytes.fill(0);
  candidate.payloads.clear();
  candidate.receipts.length = 0;
  candidate.retainedBytes = 0;
  candidate.replayBytes = 0;
  candidate.actions = 0;
  candidate.metadataPayloadCandidates = 0;
}

function recoveryTargetFamily(relativePath: string) {
  return VAULT_FAMILY_DESCRIPTORS.find((family) => family.storageKind === "singleton-file"
    ? relativePath === family.relativePath : relativePath.startsWith(`${family.directory}/`))?.id ?? "other";
}

function summarizeRecoveryHistory(candidate: RecoveryCandidate, ordered: RecoveryCandidate["receipts"]) {
  const paths = new Set<string>();
  const pathsByFamily: Record<string, number> = {};
  let metadataWriteActions = 0;
  let coreWriteActions = 0;
  let firstAppendNeedsBasePaths = 0;
  let firstAppendBasePayloadsPresent = 0;
  for (const { receipt } of ordered) for (const action of receipt.actions) {
    if (action.kind === "text_upsert") {
      if (action.targetRelativePath === VAULT_LAYOUT.metadata) metadataWriteActions++;
      if (action.targetRelativePath === VAULT_LAYOUT.coreDocument) coreWriteActions++;
    }
    if (paths.has(action.targetRelativePath)) continue;
    paths.add(action.targetRelativePath);
    const family = recoveryTargetFamily(action.targetRelativePath);
    pathsByFamily[family] = (pathsByFamily[family] ?? 0) + 1;
    if (action.kind === "jsonl_append" && action.baseByteLength > 0) {
      firstAppendNeedsBasePaths++;
      if (candidate.payloads.get(action.baseSha256)?.byteLength === action.baseByteLength) firstAppendBasePayloadsPresent++;
    }
  }
  return { receiptCount: ordered.length, paths: paths.size, pathsByFamily, metadataWriteActions, coreWriteActions,
    metadataPayloadCandidates: candidate.metadataPayloadCandidates, firstAppendNeedsBasePaths, firstAppendBasePayloadsPresent };
}

function recoveryActionDiagnostics(candidate: RecoveryCandidate, action: HostedCanonicalWriteReceiptAction | undefined) {
  if (!action) return undefined;
  return { kind: action.kind, family: recoveryTargetFamily(action.targetRelativePath),
    ...(action.kind === "jsonl_append" ? {
      expectedBaseBytes: action.baseByteLength,
      fullBaseArtifactPresent: candidate.payloads.get(action.baseSha256)?.byteLength === action.baseByteLength,
    } : {}) };
}

export async function validateRecoveryCandidate(input: {
  candidate: RecoveryCandidate; expectedSourceHash: string; signal: AbortSignal;
}) {
  let scratch: string | undefined;
  let replayedReceipts = 0;
  let mediaActionsWithoutPayload = 0;
  let stage: "replay" | "vault_validation" | "source_comparison" = "replay";
  let activeAction: HostedCanonicalWriteReceiptAction | undefined;
  let history: ReturnType<typeof summarizeRecoveryHistory> | undefined;
  try {
    input.signal.throwIfAborted();
    scratch = await mkdtemp(path.join(tmpdir(), "murph-recovery-candidate-"));
    const vaultRoot = path.join(scratch, "vault");
    // Receipts preserve original metadata and files, not empty directories.
    // Never initialize a replacement vault or invent an identity.
    for (const relative of REQUIRED_DIRECTORIES) await mkdir(path.join(vaultRoot, relative), { recursive: true });
    const ordered = [...input.candidate.receipts].sort((a, b) =>
      Date.parse(a.receipt.committedAt) - Date.parse(b.receipt.committedAt) || a.sha256.localeCompare(b.sha256));
    history = summarizeRecoveryHistory(input.candidate, ordered);
    for (const { receipt } of ordered) {
      for (const action of receipt.actions) {
        input.signal.throwIfAborted();
        activeAction = action;
        if (action.kind === "raw_upsert" && action.mediaRef && !action.contentRef) mediaActionsWithoutPayload++;
        await applyHostedCanonicalWriteReceipt({ vaultRoot, receipt: { ...receipt, actions: [action] }, readPayload: async (ref) => {
          input.signal.throwIfAborted();
          const bytes = input.candidate.payloads.get(ref.sha256);
          return bytes?.byteLength === ref.byteSize ? bytes : null;
        } });
        activeAction = undefined;
      }
      replayedReceipts++;
    }
    stage = "vault_validation";
    input.signal.throwIfAborted();
    const vault = await validateVault({ vaultRoot });
    stage = "source_comparison";
    const sources = await hashHostedBrowserVaultReplicaSources(vaultRoot, input.signal);
    return {
      complete: true, replayedReceipts, mediaActionsWithoutPayload, validVault: vault.valid, history,
      validationIssueCount: vault.issues.length, sourceFiles: sources.fileCount,
      sourceBytes: sources.totalBytes, sourceHashMatches: sources.hash === input.expectedSourceHash,
      // Ordering by timestamp and matching a projection's source hash do not
      // prove acceptance, deleted/expired data, or files outside that hash.
      acceptedHistoryProven: false, restorationPerformed: false,
    };
  } catch (error) {
    return { complete: false, replayedReceipts, failureStage: stage, history,
      failureAction: recoveryActionDiagnostics(input.candidate, activeAction),
      failure: input.signal.aborted ? "cancelled" : candidateFailure(error),
      acceptedHistoryProven: false, restorationPerformed: false };
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}

function candidateFailure(error: unknown): string {
  const code = error !== null && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "HOSTED_CANONICAL_WRITE_PAYLOAD_MISSING" || code === "HOSTED_CANONICAL_WRITE_PAYLOAD_UNAVAILABLE") return "missing_payload";
  if (code === "HOSTED_CANONICAL_WRITE_PAYLOAD_INTEGRITY") return "payload_integrity";
  if (["HOSTED_CANONICAL_WRITE_APPEND_BASE_MISMATCH", "HOSTED_CANONICAL_WRITE_TEXT_CONFLICT",
    "HOSTED_CANONICAL_WRITE_RAW_CONFLICT", "HOSTED_CANONICAL_WRITE_DELETE_CONFLICT"].includes(String(code))) return "history_conflict";
  return "validation_failed";
}
