import "server-only";

import { createHash } from "node:crypto";

import type {
  HostedSensitiveActionChallenge,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  buildHostedExecutionPendingEffectsReconcileRequestedWake,
} from "@murphai/hosted-execution";
import {
  HOSTED_ACTION_APPROVAL_ID_PREFIX,
  HOSTED_ACTION_APPROVAL_RETURN_CONTACT_KINDS,
  buildHostedActionApprovalCycleOwnerKey,
  buildHostedActionApprovalOutcomeEffectId,
  isHostedActionApprovalId,
  parseHostedActionApprovalConsumeRequest,
  parseHostedActionApprovalPresentation,
  parseHostedActionApprovalRequest,
  serializeHostedActionApprovalRequest,
  type HostedActionApprovalConsumeRequest,
  type HostedActionApprovalObservationEnvelope,
  type HostedActionApprovalRequest,
  type HostedActionApprovalResult,
  type HostedActionApprovalReturnContactKind,
} from "@murphai/hosted-execution/action-approval";
import {
  HOSTED_CONNECTED_APPS_ACTION_ID_PREFIX,
} from "@murphai/hosted-execution/connected-apps";

import type {
  HostedActionApprovalContinuation,
  HostedActionApprovalPresentationKind,
  HostedActionApprovalStatus,
  HostedActionApprovalView,
} from "./action-approvals-shared";
import { appendHostedMailboxEnvelopeTx } from "./hosted-mailbox/store";
import {
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxStrings,
} from "./hosted-crypto/secure-box";
import { hostedOnboardingError } from "./hosted-onboarding/errors";
import { resolveHostedPublicOrigin } from "./hosted-web/public-url";
import {
  createSensitiveActionChallengeMaterial,
  type VerifiedSensitiveActionChallenge,
} from "./sensitive-actions/server";
import type { SensitiveActionChallengeResponse } from "./sensitive-actions/shared";

const ACTION_APPROVAL_TTL_MS = 15 * 60 * 1_000;
const ACTION_APPROVAL_KIND = "assistant.action.approve";
const ACTION_APPROVAL_KEY_VERSION = "murph-action-approval-key-v1";
const ACTION_APPROVAL_HASH_VERSION = "murph-action-approval-request-hash-v1";
const ACTION_APPROVAL_BINDING_VERSION = "murph-action-approval-binding-v1";
const ACTION_APPROVAL_GENERATION_VERSION = "murph-action-approval-generation-v1";
const ACTION_APPROVAL_OUTCOME_WAKE_VERSION = "murph-action-approval-outcome-wake-v1";
const ACTION_APPROVAL_PLACEHOLDER_VERSION = "murph-action-approval-placeholder-v1";
const ACTION_APPROVAL_ID_BYTES = 24;
const ACTION_APPROVAL_PRESENTATION_CRYPTO_LANE = "hosted-member-private-field";
const ACTION_APPROVAL_PRESENTATION_CRYPTO_PURPOSE =
  "hosted-action-approval-presentation";
const ACTION_APPROVAL_PRESENTATION_CRYPTO_TABLE =
  "hosted_sensitive_action_challenge";
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

type ActionApprovalPresentationEncryptedField =
  | "presentation_body_encrypted"
  | "presentation_title_encrypted";

interface HostedActionApprovalMetadata {
  actionHash: string;
  actionId: string;
  approvalId: string;
  bindingHash: string;
  expiresAt: Date;
  returnContactKind: HostedActionApprovalReturnContactKind | null;
  tokenHash: string;
}

export interface PendingHostedActionApprovalIdentity {
  actionHash: string;
  actionId: string;
  approvalId: string;
  bindingHash: string;
  expiresAt: Date;
  presentation: HostedActionApprovalView["presentation"];
  returnContactKind: HostedActionApprovalReturnContactKind | null;
  tokenHash: string;
}

export interface HostedActionApprovalDecisionTxResult {
  approval: HostedActionApprovalView;
  runtimeResume: {
    lane: "system";
    laneSeq: string;
    mailboxItemId: string;
    userId: string;
  };
}

interface HostedActionApprovalReadChallengeDelegate {
  findFirst(
    args: Prisma.HostedSensitiveActionChallengeFindFirstArgs,
  ): Promise<HostedSensitiveActionChallenge | null>;
}

interface HostedActionApprovalWriteChallengeDelegate
  extends HostedActionApprovalReadChallengeDelegate {
  updateMany(
    args: Prisma.HostedSensitiveActionChallengeUpdateManyArgs,
  ): Promise<Prisma.BatchPayload>;
  upsert(
    args: Prisma.HostedSensitiveActionChallengeUpsertArgs,
  ): Promise<HostedSensitiveActionChallenge>;
}

interface HostedActionApprovalReadStore {
  hostedSensitiveActionChallenge: HostedActionApprovalReadChallengeDelegate;
}

interface HostedActionApprovalWriteStore extends HostedActionApprovalReadStore {
  hostedSensitiveActionChallenge: HostedActionApprovalWriteChallengeDelegate;
}

export function requireHostedActionApprovalId(value: unknown): string {
  if (!isHostedActionApprovalId(value)) {
    throw actionApprovalNotFound();
  }
  return value;
}

export async function requestHostedActionApproval(input: {
  memberId: string;
  now?: Date;
  prisma: HostedActionApprovalWriteStore;
  request: HostedActionApprovalRequest | unknown;
}): Promise<HostedActionApprovalResult> {
  const prepared = prepareHostedActionApprovalRequest({
    memberId: input.memberId,
    now: input.now,
    request: input.request,
  });
  const existing = await input.prisma.hostedSensitiveActionChallenge.findFirst({
    where: {
      approvalKey: prepared.approvalId,
      kind: ACTION_APPROVAL_KIND,
      memberId: prepared.memberId,
    },
  });
  if (existing) {
    assertHostedActionApprovalMatchesRequest(existing, prepared);
    const existingStatus = readHostedActionApprovalStatus(existing, prepared.now);
    if (existingStatus === "pending" || existingStatus === "approved") {
      return buildHostedActionApprovalResult(existing, prepared.now);
    }
    return buildHostedActionApprovalResult(
      await refreshHostedActionApprovalRequest({
        approval: existing,
        pendingData: await buildPendingHostedActionApprovalData({ prepared }),
        prepared,
        prisma: input.prisma,
      }),
      prepared.now,
    );
  }

  const pendingData = await buildPendingHostedActionApprovalData({
    prepared,
  });

  const approval = await input.prisma.hostedSensitiveActionChallenge.upsert({
    where: { approvalKey: prepared.approvalId },
    create: pendingData,
    update: {},
  });

  assertHostedActionApprovalMatchesRequest(approval, prepared);

  const status = readHostedActionApprovalStatus(approval, prepared.now);
  if (status === "pending" || status === "approved") {
    return buildHostedActionApprovalResult(approval, prepared.now);
  }

  return buildHostedActionApprovalResult(
    await refreshHostedActionApprovalRequest({
      approval,
      pendingData,
      prepared,
      prisma: input.prisma,
    }),
    prepared.now,
  );
}

export async function readHostedActionApprovalObservation(input: {
  memberId: string;
  now?: Date;
  prisma: HostedActionApprovalReadStore;
  request: HostedActionApprovalRequest | unknown;
}): Promise<HostedActionApprovalObservationEnvelope> {
  const prepared = prepareHostedActionApprovalRequest({
    memberId: input.memberId,
    now: input.now,
    request: input.request,
  });
  const approval = await findHostedActionApprovalForRequest({
    prepared,
    prisma: input.prisma,
  });

  assertHostedActionApprovalMatchesRequest(approval, prepared);
  const result = buildHostedActionApprovalResult(approval, prepared.now);
  return {
    cycleOwnerKey: buildHostedActionApprovalCycleOwnerKey({
      approvalId: result.approvalId,
      expiresAt: new Date(
        approval.createdAt.getTime() + ACTION_APPROVAL_TTL_MS,
      ).toISOString(),
    }),
    result,
  };
}

export async function consumeHostedActionApproval(input: {
  memberId: string;
  now?: Date;
  prisma: HostedActionApprovalWriteStore;
  request: HostedActionApprovalConsumeRequest | unknown;
}): Promise<HostedActionApprovalResult> {
  const consumeRequest = parseHostedActionApprovalConsumeRequest(input.request);
  const prepared = prepareHostedActionApprovalRequest({
    memberId: input.memberId,
    now: input.now,
    request: consumeRequest.request,
  });
  const approval = await findHostedActionApprovalForRequest({
    prepared,
    prisma: input.prisma,
  });

  assertHostedActionApprovalMatchesRequest(approval, prepared);

  const approvalGeneration = buildHostedActionApprovalGeneration(approval);
  const consumedBy = normalizeActionApprovalConsumerId(approval.consumedBy);
  if (
    approval.approvalStatus === "approved"
    && consumedBy !== null
    && consumedBy === consumeRequest.consumerId
    && approval.consumedAt !== null
    && approval.expiresAt > prepared.now
    && approvalGeneration === consumeRequest.approvalGeneration
  ) {
    return buildApprovedHostedActionApprovalResult(approval);
  }

  const status = readHostedActionApprovalStatus(approval, prepared.now);
  if (status !== "approved") {
    return buildHostedActionApprovalResult(approval, prepared.now);
  }
  if (approvalGeneration !== consumeRequest.approvalGeneration) {
    return {
      approvalId: prepared.approvalId,
      status: "expired",
    };
  }

  const updated = await input.prisma.hostedSensitiveActionChallenge.updateMany({
    where: {
      actionId: prepared.request.actionId,
      approvalKey: prepared.approvalId,
      approvalStatus: "approved",
      consumedAt: null,
      consumedBy: null,
      expiresAt: { gt: prepared.now },
      kind: ACTION_APPROVAL_KIND,
      memberId: prepared.memberId,
      tokenHash: approval.tokenHash,
      AND: [buildHostedActionApprovalHashWhere(prepared)],
    },
    data: {
      consumedAt: prepared.now,
      consumedBy: consumeRequest.consumerId,
    },
  });

  if (updated.count !== 1) {
    const current = await findHostedActionApprovalForRequest({
      prepared,
      prisma: input.prisma,
    });
    assertHostedActionApprovalMatchesRequest(current, prepared);
    const currentConsumedBy = normalizeActionApprovalConsumerId(current.consumedBy);
    const currentGeneration = buildHostedActionApprovalGeneration(current);
    if (currentGeneration !== consumeRequest.approvalGeneration) {
      return {
        approvalId: prepared.approvalId,
        status: "expired",
      };
    }
    if (
      current.approvalStatus === "approved"
      && current.consumedAt !== null
      && currentConsumedBy === consumeRequest.consumerId
      && current.expiresAt > prepared.now
      && currentGeneration === consumeRequest.approvalGeneration
    ) {
      return buildApprovedHostedActionApprovalResult(current);
    }
    return buildHostedActionApprovalResult(current, prepared.now);
  }

  return {
    approvalGeneration: consumeRequest.approvalGeneration,
    approvalId: prepared.approvalId,
    status: "approved",
  };
}

export async function readHostedActionApproval(input: {
  approvalId: string;
  memberId: string;
  now?: Date;
  prisma: HostedActionApprovalReadStore;
}): Promise<HostedActionApprovalView> {
  const approvalId = requireHostedActionApprovalId(input.approvalId);
  const approval = await input.prisma.hostedSensitiveActionChallenge.findFirst({
    where: {
      approvalKey: approvalId,
      kind: ACTION_APPROVAL_KIND,
      memberId: input.memberId,
    },
  });

  if (!approval) {
    throw actionApprovalNotFound();
  }

  return buildHostedActionApprovalView({
    approval,
    memberId: input.memberId,
    now: input.now ?? new Date(),
    prisma: input.prisma,
  });
}

export async function requirePendingHostedActionApproval(input: {
  approvalId: string;
  memberId: string;
  now?: Date;
  prisma: HostedActionApprovalReadStore;
}): Promise<PendingHostedActionApprovalIdentity> {
  const now = input.now ?? new Date();
  const approvalId = requireHostedActionApprovalId(input.approvalId);
  const approval = await input.prisma.hostedSensitiveActionChallenge.findFirst({
    where: {
      approvalKey: approvalId,
      kind: ACTION_APPROVAL_KIND,
      memberId: input.memberId,
    },
  });

  if (!approval) {
    throw actionApprovalNotFound();
  }
  if (approval.approvalStatus !== "pending" || approval.expiresAt <= now) {
    throw actionApprovalUnavailable();
  }

  return requireHostedActionApprovalIdentity({
    approval,
    memberId: input.memberId,
    prisma: input.prisma,
  });
}

export async function issueHostedActionApprovalChallenge(input: {
  approvalId: string;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  sessionId: string;
}): Promise<SensitiveActionChallengeResponse> {
  const now = input.now ?? new Date();
  const approval = await requirePendingHostedActionApproval({
    approvalId: input.approvalId,
    memberId: input.memberId,
    now,
    prisma: input.prisma,
  });
  const bindingHash = buildHostedActionApprovalBinding({
    actionHash: approval.actionHash,
    actionId: approval.actionId,
    approvalId: approval.approvalId,
    memberId: input.memberId,
    sessionId: input.sessionId,
  });
  const challenge = createSensitiveActionChallengeMaterial({
    bindingHash,
    expiresAt: approval.expiresAt,
    kind: ACTION_APPROVAL_KIND,
  });
  const updated = await input.prisma.hostedSensitiveActionChallenge.updateMany({
    where: {
      actionHash: approval.actionHash,
      approvalKey: approval.approvalId,
      approvalStatus: "pending",
      expiresAt: { gt: now },
      kind: ACTION_APPROVAL_KIND,
      memberId: input.memberId,
      tokenHash: approval.tokenHash,
    },
    data: {
      bindingHash,
      tokenHash: challenge.tokenHash,
    },
  });

  if (updated.count !== 1) {
    throw actionApprovalUnavailable();
  }

  return challenge.response;
}

export async function decideHostedActionApprovalTx(input: {
  approval: PendingHostedActionApprovalIdentity;
  challenge?: VerifiedSensitiveActionChallenge;
  decision: "approved" | "denied";
  memberId: string;
  now?: Date;
  tx: Prisma.TransactionClient;
}): Promise<HostedActionApprovalDecisionTxResult> {
  const now = input.now ?? new Date();
  const proof = input.decision === "approved"
    ? requireApprovalChallenge(input.challenge)
    : null;
  const expiresAt = input.decision === "approved"
    ? new Date(now.getTime() + ACTION_APPROVAL_TTL_MS)
    : input.approval.expiresAt;
  const updated = await input.tx.hostedSensitiveActionChallenge.updateMany({
    where: {
      actionHash: input.approval.actionHash,
      actionId: input.approval.actionId,
      approvalKey: input.approval.approvalId,
      approvalStatus: "pending",
      bindingHash: proof?.bindingHash ?? input.approval.bindingHash,
      expiresAt: { gt: now },
      kind: ACTION_APPROVAL_KIND,
      memberId: input.memberId,
      tokenHash: proof?.tokenHash ?? input.approval.tokenHash,
    },
    data: {
      approvalStatus: input.decision,
      consumedAt: null,
      consumedBy: null,
      decidedAt: now,
      expiresAt,
    },
  });

  if (updated.count !== 1) {
    throw actionApprovalUnavailable();
  }

  const approval: HostedActionApprovalView = {
    approvalId: input.approval.approvalId,
    continuation: resolveHostedActionApprovalContinuation(input.approval.actionId),
    expiresAt: expiresAt.toISOString(),
    presentation: input.approval.presentation,
    presentationKind: resolveHostedActionApprovalPresentationKind(
      input.approval.actionId,
    ),
    returnContactKind: input.approval.returnContactKind,
    status: input.decision,
  };
  const approvalGeneration =
    buildHostedActionApprovalIdentityGeneration(input.approval);

  const mailboxItem = (await appendHostedMailboxEnvelopeTx({
    envelope: buildHostedExecutionPendingEffectsReconcileRequestedWake({
      effectId: buildHostedActionApprovalOutcomeEffectId({
        approvalGeneration,
        approvalId: input.approval.approvalId,
        expiresAt: input.approval.expiresAt.toISOString(),
      }),
      eventId: buildHostedActionApprovalOutcomeWakeEventId({
        approval: input.approval,
        decidedAt: now,
        decision: input.decision,
      }),
      occurredAt: now.toISOString(),
      userId: input.memberId,
    }),
    tx: input.tx,
  })).item;
  if (mailboxItem.lane !== "system") {
    throw new TypeError(
      "Hosted action approval outcome wake must use the system mailbox lane.",
    );
  }

  return {
    approval,
    runtimeResume: {
      lane: mailboxItem.lane,
      laneSeq: mailboxItem.laneSeq,
      mailboxItemId: mailboxItem.id,
      userId: mailboxItem.userId,
    },
  };
}

export function buildHostedActionApprovalBinding(input: {
  actionHash: string;
  actionId: string;
  approvalId: string;
  memberId: string;
  sessionId: string;
}): string {
  if (!SHA256_HEX_PATTERN.test(input.actionHash)) {
    throw new TypeError("Hosted action approval action hash is invalid.");
  }

  return sha256Hex([
    ACTION_APPROVAL_BINDING_VERSION,
    ACTION_APPROVAL_KIND,
    input.memberId,
    input.sessionId,
    input.approvalId,
    input.actionId,
    input.actionHash,
  ].join("\n"));
}

export function buildHostedActionApprovalId(input: {
  actionId: string;
  memberId: string;
}): string {
  const digest = createHash("sha256")
    .update([
      ACTION_APPROVAL_KEY_VERSION,
      input.memberId,
      input.actionId,
    ].join("\n"))
    .digest()
    .subarray(0, ACTION_APPROVAL_ID_BYTES)
    .toString("base64url");

  return `${HOSTED_ACTION_APPROVAL_ID_PREFIX}${digest}`;
}

export function hashHostedActionApprovalRequest(input: {
  memberId: string;
  request: HostedActionApprovalRequest;
}): string {
  return sha256Hex([
    ACTION_APPROVAL_HASH_VERSION,
    input.memberId,
    serializeHostedActionApprovalRequest(input.request),
  ].join("\n"));
}

function hashLegacyNullReturnContactKindHostedActionApprovalRequest(input: {
  memberId: string;
  request: HostedActionApprovalRequest;
}): string {
  return sha256Hex([
    ACTION_APPROVAL_HASH_VERSION,
    input.memberId,
    JSON.stringify([
      "murph.hosted-action-approval-request.v1",
      input.request.actionId,
      input.request.actionKind,
      input.request.actionFingerprint,
      input.request.presentation.title,
      input.request.presentation.body,
    ]),
  ].join("\n"));
}

function buildHostedActionApprovalHashWhere(
  prepared: PreparedHostedActionApprovalRequest,
): Prisma.HostedSensitiveActionChallengeWhereInput {
  if (prepared.legacyNullReturnContactKindActionHash === null) {
    return { actionHash: prepared.actionHash };
  }
  return {
    OR: [
      { actionHash: prepared.actionHash },
      { actionHash: prepared.legacyNullReturnContactKindActionHash },
    ],
  };
}

function buildHostedActionApprovalResult(
  approval: HostedSensitiveActionChallenge,
  now: Date,
): HostedActionApprovalResult {
  const identity = requireHostedActionApprovalMetadata(approval);
  const status = readHostedActionApprovalStatus(approval, now);

  if (status === "approved") {
    return buildApprovedHostedActionApprovalResult(approval);
  }
  if (status !== "pending") {
    return {
      approvalId: identity.approvalId,
      status,
    };
  }

  return {
    approvalId: identity.approvalId,
    approvalUrl: buildHostedActionApprovalUrl(identity.approvalId),
    expiresAt: identity.expiresAt.toISOString(),
    status,
  };
}

interface PreparedHostedActionApprovalRequest {
  actionHash: string;
  approvalId: string;
  expiresAt: Date;
  legacyNullReturnContactKindActionHash: string | null;
  memberId: string;
  now: Date;
  request: HostedActionApprovalRequest;
}

function prepareHostedActionApprovalRequest(input: {
  memberId: string;
  now?: Date;
  request: HostedActionApprovalRequest | unknown;
}): PreparedHostedActionApprovalRequest {
  const request = parseHostedActionApprovalRequest(input.request);
  const now = input.now ?? new Date();
  const approvalId = buildHostedActionApprovalId({
    actionId: request.actionId,
    memberId: input.memberId,
  });

  const actionHash = hashHostedActionApprovalRequest({
    memberId: input.memberId,
    request,
  });

  return {
    actionHash,
    approvalId,
    expiresAt: new Date(now.getTime() + ACTION_APPROVAL_TTL_MS),
    legacyNullReturnContactKindActionHash: request.returnContactKind === null
      ? hashLegacyNullReturnContactKindHostedActionApprovalRequest({
          memberId: input.memberId,
          request,
        })
      : null,
    memberId: input.memberId,
    now,
    request,
  };
}

async function buildPendingHostedActionApprovalData(input: {
  prepared: PreparedHostedActionApprovalRequest;
}) {
  const presentation = await buildHostedActionApprovalPresentationStorage(input);
  const prepared = input.prepared;
  return {
    actionHash: prepared.actionHash,
    actionId: prepared.request.actionId,
    approvalKey: prepared.approvalId,
    approvalStatus: "pending" as const,
    bindingHash: prepared.actionHash,
    consumedAt: null,
    consumedBy: null,
    createdAt: prepared.now,
    decidedAt: null,
    expiresAt: prepared.expiresAt,
    kind: ACTION_APPROVAL_KIND,
    memberId: prepared.memberId,
    ...presentation,
    returnContactKind: prepared.request.returnContactKind,
    tokenHash: buildHostedActionApprovalPlaceholderHash(prepared.approvalId),
  };
}

async function buildHostedActionApprovalPresentationStorage(input: {
  prepared: PreparedHostedActionApprovalRequest;
}) {
  if (
    !input.prepared.request.actionId.startsWith(
      HOSTED_CONNECTED_APPS_ACTION_ID_PREFIX,
    )
  ) {
    return {
      presentationBody: input.prepared.request.presentation.body,
      presentationBodyEncrypted: null,
      presentationTitle: input.prepared.request.presentation.title,
      presentationTitleEncrypted: null,
    };
  }

  const [body, title] = await sealHostedUserSecureBoxStrings({
    entries: [
      buildHostedActionApprovalPresentationCryptoEntry({
        approvalId: input.prepared.approvalId,
        field: "presentation_body_encrypted",
        value: input.prepared.request.presentation.body,
      }),
      buildHostedActionApprovalPresentationCryptoEntry({
        approvalId: input.prepared.approvalId,
        field: "presentation_title_encrypted",
        value: input.prepared.request.presentation.title,
      }),
    ],
    lane: ACTION_APPROVAL_PRESENTATION_CRYPTO_LANE,
    userId: input.prepared.memberId,
  });

  return {
    presentationBody: null,
    presentationBodyEncrypted: body,
    presentationTitle: null,
    presentationTitleEncrypted: title,
  };
}

async function refreshHostedActionApprovalRequest(input: {
  approval: HostedSensitiveActionChallenge;
  pendingData: Awaited<ReturnType<typeof buildPendingHostedActionApprovalData>>;
  prepared: PreparedHostedActionApprovalRequest;
  prisma: HostedActionApprovalWriteStore;
}): Promise<HostedSensitiveActionChallenge> {
  const updated = await input.prisma.hostedSensitiveActionChallenge.updateMany({
    where: {
      actionId: input.prepared.request.actionId,
      approvalKey: input.prepared.approvalId,
      kind: ACTION_APPROVAL_KIND,
      memberId: input.prepared.memberId,
      tokenHash: input.approval.tokenHash,
      AND: [
        buildHostedActionApprovalHashWhere(input.prepared),
        {
          OR: [
            { approvalStatus: "denied" },
            {
              approvalStatus: "pending",
              expiresAt: { lte: input.prepared.now },
            },
            {
              approvalStatus: "approved",
              consumedAt: { not: null },
            },
            {
              approvalStatus: "approved",
              expiresAt: { lte: input.prepared.now },
            },
          ],
        },
      ],
    },
    data: input.pendingData,
  });

  if (updated.count !== 1) {
    return findHostedActionApprovalForRequest(input);
  }

  return findHostedActionApprovalForRequest(input);
}

async function findHostedActionApprovalForRequest(input: {
  prepared: PreparedHostedActionApprovalRequest;
  prisma: HostedActionApprovalReadStore;
}): Promise<HostedSensitiveActionChallenge> {
  const approval = await input.prisma.hostedSensitiveActionChallenge.findFirst({
    where: {
      approvalKey: input.prepared.approvalId,
      kind: ACTION_APPROVAL_KIND,
      memberId: input.prepared.memberId,
    },
  });

  if (!approval) {
    throw actionApprovalNotFound();
  }
  return approval;
}

function assertHostedActionApprovalMatchesRequest(
  approval: HostedSensitiveActionChallenge,
  prepared: PreparedHostedActionApprovalRequest,
): void {
  if (
    approval.kind !== ACTION_APPROVAL_KIND
    || approval.memberId !== prepared.memberId
    || approval.actionId !== prepared.request.actionId
    || approval.approvalKey !== prepared.approvalId
  ) {
    throw hostedOnboardingError({
      code: "ACTION_APPROVAL_IDENTITY_CONFLICT",
      httpStatus: 409,
      message: "This action id is already bound to a different sensitive action.",
    });
  }
  if (approval.actionHash === prepared.actionHash) {
    return;
  }
  if (
    prepared.legacyNullReturnContactKindActionHash !== null
    && approval.actionHash === prepared.legacyNullReturnContactKindActionHash
    && approval.returnContactKind === null
  ) {
    return;
  }
  throw hostedOnboardingError({
    code: "ACTION_APPROVAL_IDENTITY_CONFLICT",
    httpStatus: 409,
    message: "This action id is already bound to a different sensitive action.",
  });
}

async function buildHostedActionApprovalView(input: {
  approval: HostedSensitiveActionChallenge;
  memberId: string;
  now: Date;
  prisma: HostedActionApprovalReadStore;
}): Promise<HostedActionApprovalView> {
  const identity = await requireHostedActionApprovalIdentity(input);

  return {
    approvalId: identity.approvalId,
    continuation: resolveHostedActionApprovalContinuation(identity.actionId),
    expiresAt: identity.expiresAt.toISOString(),
    presentation: identity.presentation,
    presentationKind: resolveHostedActionApprovalPresentationKind(
      identity.actionId,
    ),
    returnContactKind: identity.returnContactKind,
    status: readHostedActionApprovalPresentationStatus(
      input.approval,
      input.now,
    ),
  };
}

export function resolveHostedActionApprovalContinuation(
  actionId: string,
): HostedActionApprovalContinuation {
  return actionId.startsWith(HOSTED_CONNECTED_APPS_ACTION_ID_PREFIX)
    ? "return-to-conversation"
    : "automatic";
}

export function resolveHostedActionApprovalPresentationKind(
  actionId: string,
): HostedActionApprovalPresentationKind {
  return actionId.startsWith(HOSTED_CONNECTED_APPS_ACTION_ID_PREFIX)
    ? "fact-rows"
    : "prose";
}

async function requireHostedActionApprovalIdentity(input: {
  approval: HostedSensitiveActionChallenge;
  memberId: string;
  prisma: HostedActionApprovalReadStore;
}): Promise<PendingHostedActionApprovalIdentity> {
  if (input.approval.memberId !== input.memberId) {
    throw new TypeError("Hosted action approval record is invalid.");
  }
  const identity = requireHostedActionApprovalMetadata(input.approval);
  const presentation = await readHostedActionApprovalPresentation(input);

  return {
    ...identity,
    presentation,
  };
}

async function readHostedActionApprovalPresentation(input: {
  approval: HostedSensitiveActionChallenge;
  memberId: string;
  prisma: HostedActionApprovalReadStore;
}): Promise<HostedActionApprovalView["presentation"]> {
  if (
    !input.approval.actionId?.startsWith(
      HOSTED_CONNECTED_APPS_ACTION_ID_PREFIX,
    )
  ) {
    if (
      !input.approval.presentationBody
      || !input.approval.presentationTitle
      || input.approval.presentationBodyEncrypted !== null
      || input.approval.presentationTitleEncrypted !== null
    ) {
      throw new TypeError("Hosted action approval presentation is invalid.");
    }
    return parseHostedActionApprovalPresentation({
      body: input.approval.presentationBody,
      title: input.approval.presentationTitle,
    });
  }

  if (
    input.approval.presentationBody !== null
    || input.approval.presentationTitle !== null
    || !input.approval.presentationBodyEncrypted
    || !input.approval.presentationTitleEncrypted
    || !input.approval.approvalKey
  ) {
    throw new TypeError("Hosted action approval presentation is invalid.");
  }

  const [body, title] = await openHostedUserSecureBoxStrings({
    entries: [
      {
        ...buildHostedActionApprovalPresentationCryptoEntry({
          approvalId: input.approval.approvalKey,
          field: "presentation_body_encrypted",
          value: input.approval.presentationBodyEncrypted,
        }),
        userId: input.memberId,
      },
      {
        ...buildHostedActionApprovalPresentationCryptoEntry({
          approvalId: input.approval.approvalKey,
          field: "presentation_title_encrypted",
          value: input.approval.presentationTitleEncrypted,
        }),
        userId: input.memberId,
      },
    ],
    lane: ACTION_APPROVAL_PRESENTATION_CRYPTO_LANE,
  });
  if (body === null || title === null) {
    throw new TypeError("Hosted action approval presentation is invalid.");
  }
  return parseHostedActionApprovalPresentation({ body, title });
}

function buildHostedActionApprovalPresentationCryptoEntry(input: {
  approvalId: string;
  field: ActionApprovalPresentationEncryptedField;
  value: string;
}) {
  return {
    aad: {
      field: input.field,
      purpose: ACTION_APPROVAL_PRESENTATION_CRYPTO_PURPOSE,
      rowId: input.approvalId,
      table: ACTION_APPROVAL_PRESENTATION_CRYPTO_TABLE,
    },
    scope: `${ACTION_APPROVAL_PRESENTATION_CRYPTO_PURPOSE}:${input.field}`,
    value: input.value,
  };
}

function requireHostedActionApprovalMetadata(
  approval: HostedSensitiveActionChallenge,
): HostedActionApprovalMetadata {
  if (
    approval.kind !== ACTION_APPROVAL_KIND
    || !approval.approvalKey
    || !approval.actionId
    || !approval.actionHash
    || !approval.approvalStatus
  ) {
    throw new TypeError("Hosted action approval record is invalid.");
  }

  return {
    actionHash: approval.actionHash,
    actionId: approval.actionId,
    approvalId: approval.approvalKey,
    bindingHash: approval.bindingHash,
    expiresAt: approval.expiresAt,
    returnContactKind: readStoredReturnContactKind(approval.returnContactKind),
    tokenHash: approval.tokenHash,
  };
}

function readStoredReturnContactKind(
  value: string | null,
): HostedActionApprovalReturnContactKind | null {
  if (value === null) {
    return null;
  }
  if (
    (HOSTED_ACTION_APPROVAL_RETURN_CONTACT_KINDS as readonly string[]).includes(value)
  ) {
    return value as HostedActionApprovalReturnContactKind;
  }
  throw new TypeError("Hosted action approval returnContactKind is invalid.");
}

function readHostedActionApprovalStatus(
  approval: HostedSensitiveActionChallenge,
  now: Date,
): HostedActionApprovalStatus {
  if (approval.approvalStatus === "approved") {
    return approval.consumedAt !== null || approval.expiresAt <= now
      ? "expired"
      : "approved";
  }
  if (approval.approvalStatus === "denied") {
    return "denied";
  }
  if (approval.approvalStatus !== "pending") {
    throw new TypeError("Hosted action approval status is invalid.");
  }
  return approval.expiresAt <= now ? "expired" : "pending";
}

function readHostedActionApprovalPresentationStatus(
  approval: HostedSensitiveActionChallenge,
  now: Date,
): HostedActionApprovalStatus {
  if (
    approval.approvalStatus === "approved"
    && approval.consumedAt !== null
  ) {
    return "approved";
  }
  return readHostedActionApprovalStatus(approval, now);
}

function requireApprovalChallenge(
  challenge: VerifiedSensitiveActionChallenge | undefined,
): VerifiedSensitiveActionChallenge {
  if (!challenge || challenge.kind !== ACTION_APPROVAL_KIND) {
    throw actionApprovalUnavailable();
  }
  return challenge;
}

function buildHostedActionApprovalPlaceholderHash(approvalId: string): string {
  return sha256Hex([
    ACTION_APPROVAL_PLACEHOLDER_VERSION,
    approvalId,
  ].join("\n"));
}

function buildApprovedHostedActionApprovalResult(
  approval: HostedSensitiveActionChallenge,
): HostedActionApprovalResult {
  const identity = requireHostedActionApprovalMetadata(approval);
  return {
    approvalGeneration: buildHostedActionApprovalGeneration(approval),
    approvalId: identity.approvalId,
    status: "approved",
  };
}

function buildHostedActionApprovalGeneration(
  approval: HostedSensitiveActionChallenge,
): string {
  return buildHostedActionApprovalIdentityGeneration(
    requireHostedActionApprovalMetadata(approval),
  );
}

function buildHostedActionApprovalIdentityGeneration(
  identity: HostedActionApprovalMetadata,
): string {
  return sha256Hex([
    ACTION_APPROVAL_GENERATION_VERSION,
    identity.approvalId,
    identity.actionHash,
    identity.tokenHash,
  ].join("\n"));
}

function buildHostedActionApprovalOutcomeWakeEventId(input: {
  approval: PendingHostedActionApprovalIdentity;
  decidedAt: Date;
  decision: "approved" | "denied";
}): string {
  const fingerprint = sha256Hex([
    ACTION_APPROVAL_OUTCOME_WAKE_VERSION,
    buildHostedActionApprovalIdentityGeneration(input.approval),
    input.decidedAt.toISOString(),
    input.decision,
  ].join("\n"));
  return `runtime-control:pending-effects-reconcile:${fingerprint}`;
}

function normalizeActionApprovalConsumerId(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    return null;
  }
  return value;
}

function buildHostedActionApprovalUrl(approvalId: string): string {
  const origin = resolveHostedPublicOrigin();
  if (!origin) {
    throw hostedOnboardingError({
      code: "ACTION_APPROVAL_UNAVAILABLE",
      httpStatus: 503,
      message: "Secure approval is temporarily unavailable.",
      retryable: true,
    });
  }

  return new URL(`/approve/${encodeURIComponent(approvalId)}`, origin).toString();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function actionApprovalNotFound() {
  return hostedOnboardingError({
    code: "ACTION_APPROVAL_NOT_FOUND",
    httpStatus: 404,
    message: "This secure approval request was not found.",
  });
}

function actionApprovalUnavailable() {
  return hostedOnboardingError({
    code: "ACTION_APPROVAL_UNAVAILABLE",
    httpStatus: 410,
    message: "This secure approval request is expired or already decided.",
  });
}
