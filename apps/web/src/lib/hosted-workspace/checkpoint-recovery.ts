import { Prisma, type PrismaClient } from "@prisma/client";
import { parseHostedBrowserVaultReplicaRef, parseHostedExecutionSnapshotRef, isHostedWorkspaceSnapshotV2Ref } from "@murphai/hosted-execution/parsers";
import { fingerprintRecoveryReplica, parseHostedCheckpointRecoveryRequest, type HostedCheckpointRecoveryRequest } from "@murphai/hosted-execution/runtime-resources";
import { HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEYS } from "@murphai/hosted-execution/runtime-control";
import { buildHostedWorkspaceSnapshotV2FingerprintSha256 as fingerprint } from "@murphai/hosted-execution/workspace-snapshot-v2";
import { hostedWorkspaceSnapshotObjectKey } from "@murphai/hosted-execution/storage-paths";
import { lockHostedRuntimeMemberCutoverTx } from "../hosted-execution/runtime-cutover";
import { lockHostedRuntimeOwnerRowTx, retireHostedRuntimeTx } from "../hosted-execution/runtime-owner";
import { recordRuntimeOrphansTx, requireRuntimeResourcesPublishableTx, snapshotOrphanCandidates } from "../hosted-execution/runtime-orphans";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { readHostedHealthDataConsentState } from "../legal/consent";
import { checkpointHostedWorkspaceTx } from "./store";

const RECOVERY_PUBLICATION_WINDOW_MS = 55 * 60_000;

function conflict(): never {
  throw hostedOnboardingError({ code: "HOSTED_CHECKPOINT_RECOVERY_CONFLICT", httpStatus: 409,
    message: "Checkpoint recovery preconditions no longer hold." });
}

async function lockRecoveryWorkspaceTx(tx: Prisma.TransactionClient, userId: string) {
  if (await lockHostedRuntimeMemberCutoverTx(tx, userId) !== "postgres") conflict();
  await lockHostedMemberRow(tx, userId);
  const member = await tx.hostedMember.findUnique({ where: { id: userId }, select: { suspendedAt: true } });
  if (!member || member.suspendedAt || await readHostedHealthDataConsentState({ prisma: tx, memberId: userId }) === "revoked"
    || !await readActiveHostedMemberAccess({ prisma: tx, memberId: userId })) conflict();
  const owner = await lockHostedRuntimeOwnerRowTx(tx, userId);
  if (!owner || !["idle", "starting", "active", "retiring"].includes(owner.phase)) conflict();
  await tx.$queryRaw(Prisma.sql`SELECT user_id FROM hosted_workspace WHERE user_id = ${userId} FOR UPDATE`);
  const workspace = await tx.hostedWorkspace.findUnique({ where: { userId } });
  if (!workspace) conflict();
  return { owner, workspace };
}

async function readStagedCandidateTx(tx: Prisma.TransactionClient, userId: string,
  replacement: HostedCheckpointRecoveryRequest["replacement"], now: Date) {
  const staged = await tx.hostedRuntimeOrphan.findUnique({ where: {
    userId_kind_resourceId: { userId, kind: "snapshot", resourceId: replacement.snapshotId },
  } });
  if (staged) {
    const stagedRef = parseHostedExecutionSnapshotRef(staged.snapshotRef);
    if (!isHostedWorkspaceSnapshotV2Ref(stagedRef) || fingerprint(stagedRef) !== fingerprint(replacement)
      || staged.purgedAt || staged.cleanupAt <= now) conflict();
  }
  return staged;
}

/** The protected recovery job validates and reads back the encrypted candidate
 * before publication. This owner only admits its exact member-bound reference.
 * Staging grants no execution authority; publication revokes the old attempt
 * atomically with replacement, leaving native stop proof to the normal adapter. */
export async function recoverHostedWorkspaceCheckpoint(input: {
  prisma: PrismaClient;
  userId: string;
  request: HostedCheckpointRecoveryRequest;
  now?: Date;
}): Promise<{ status: "staged" | "published"; workspaceVersion: string }> {
  const request = parseHostedCheckpointRecoveryRequest(input.request);
  const replacement = request.replacement;
  const now = input.now ?? new Date();
  const age = now.getTime() - Date.parse(replacement.createdAt);
  if (replacement.userId !== input.userId || replacement.encryption.aad.userId !== input.userId
    || replacement.objectKey !== await hostedWorkspaceSnapshotObjectKey({ userId: input.userId, snapshotId: replacement.snapshotId })
    || age < 0 || age > RECOVERY_PUBLICATION_WINDOW_MS
    || replacement.archive.fileCount < 2 || replacement.archive.totalPlainBytes <= 0) conflict();
  const candidates = snapshotOrphanCandidates(replacement);
  const replacementFingerprint = fingerprint(replacement);
  return input.prisma.$transaction(async tx => {
    const { owner, workspace } = await lockRecoveryWorkspaceTx(tx, input.userId);
    const source = parseHostedExecutionSnapshotRef(workspace.snapshotRef);
    if (!isHostedWorkspaceSnapshotV2Ref(source)) conflict();
    // A lost response may be retried after a new runtime has claimed. Never
    // retire that new owner or change mailbox state on an exact publication retry.
    if (fingerprint(source) === replacementFingerprint) return { status: "published", workspaceVersion: workspace.version.toString() };
    const replica = parseHostedBrowserVaultReplicaRef(workspace.browserVaultReplicaRef);
    if (workspace.version.toString() !== request.expectedWorkspaceVersion
      || fingerprint(source) !== request.sourceSnapshotFingerprint
      || !replica || fingerprintRecoveryReplica(replica) !== request.sourceReplicaFingerprint
      || replacement.snapshotId === source.snapshotId) conflict();
    await requireRuntimeResourcesPublishableTx(tx, input.userId, candidates);
    const staged = await readStagedCandidateTx(tx, input.userId, replacement, now);
    if (request.operation === "stage") {
      if (!staged) await recordRuntimeOrphansTx(tx, input.userId, candidates, now);
      return { status: "staged", workspaceVersion: workspace.version.toString() };
    }
    if (!staged) conflict();
    if (owner.phase !== "idle") {
      if (!owner.attemptId || !await retireHostedRuntimeTx(tx, { identity: {
        userId: input.userId, attemptId: owner.attemptId, generation: owner.generation.toString(),
      } })) conflict();
    }
    const status = workspace.redactedStatusJson;
    const omitted = new Set<string>(HOSTED_CANONICAL_WRITE_RECEIPT_REDACTED_STATUS_KEYS);
    // A recovery checkpoint proves no newly handled mailbox work. These fields
    // would otherwise make the checkpoint owner acknowledge system history.
    omitted.add("hostedMailboxSystemHandledThroughSeq");
    omitted.add("hostedMailboxConversationImportedSeq");
    const redactedStatusJson = Object.fromEntries(Object.entries(
      status && typeof status === "object" && !Array.isArray(status) ? status : {},
    ).filter(([key]) => !omitted.has(key)));
    const result = await checkpointHostedWorkspaceTx({ tx, userId: input.userId,
      expectedVersion: request.expectedWorkspaceVersion, reason: "activation_bootstrap",
      snapshotRef: replacement, checkpointedAt: now,
      redactedStatusJson: { ...redactedStatusJson, checkpointPartialRecovery: true },
    });
    if (result.status !== "updated" || !result.workspace) conflict();
    await recordRuntimeOrphansTx(tx, input.userId, snapshotOrphanCandidates(source), now);
    return { status: "published", workspaceVersion: result.workspace.version };
  }, { maxWait: 5_000, timeout: 5_000 });
}
