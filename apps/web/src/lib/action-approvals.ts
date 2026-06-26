import "server-only";

import { createHash } from "node:crypto";

import type {
  HostedSensitiveActionChallenge,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  HOSTED_ACTION_APPROVAL_ID_PREFIX,
  HOSTED_ACTION_APPROVAL_RETURN_CONTACT_KINDS,
  isHostedActionApprovalId,
  parseHostedActionApprovalConsumeRequest,
  parseHostedActionApprovalPresentation,
  parseHostedActionApprovalRequest,
  serializeHostedActionApprovalRequest,
  type HostedActionApprovalConsumeRequest,
  type HostedActionApprovalRequest,
  type HostedActionApprovalResult,
  type HostedActionApprovalReturnContactKind,
} from "@murphai/hosted-execution/action-approval";

import type {
  HostedActionApprovalStatus,
  HostedActionApprovalView,
} from "./action-approvals-shared";
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
const ACTION_APPROVAL_PLACEHOLDER_VERSION = "murph-action-approval-placeholder-v1";
const ACTION_APPROVAL_ID_BYTES = 24;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

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

  const approval = await input.prisma.hostedSensitiveActionChallenge.upsert({
    where: { approvalKey: prepared.approvalId },
    create: buildPendingHostedActionApprovalData(prepared),
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
      prepared,
      prisma: input.prisma,
    }),
    prepared.now,
  );
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

  const consumedBy = normalizeActionApprovalConsumerId(approval.consumedBy);
  if (
    approval.approvalStatus === "approved"
    && consumedBy !== null
    && consumedBy === consumeRequest.consumerId
    && approval.consumedAt !== null
    && approval.expiresAt > prepared.now
    && buildHostedActionApprovalGeneration(approval) === consumeRequest.approvalGeneration
  ) {
    return buildApprovedHostedActionApprovalResult(approval);
  }

  const status = readHostedActionApprovalStatus(approval, prepared.now);
  if (status !== "approved") {
    return buildHostedActionApprovalResult(approval, prepared.now);
  }
  if (buildHostedActionApprovalGeneration(approval) !== consumeRequest.approvalGeneration) {
    return {
      approvalId: prepared.approvalId,
      status: "expired",
    };
  }

  const updated = await input.prisma.hostedSensitiveActionChallenge.updateMany({
    where: {
      actionHash: prepared.actionHash,
      actionId: prepared.request.actionId,
      approvalKey: prepared.approvalId,
      approvalStatus: "approved",
      consumedAt: null,
      consumedBy: null,
      expiresAt: { gt: prepared.now },
      kind: ACTION_APPROVAL_KIND,
      memberId: prepared.memberId,
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
    if (
      current.approvalStatus === "approved"
      && current.consumedAt !== null
      && currentConsumedBy === consumeRequest.consumerId
      && current.expiresAt > prepared.now
      && buildHostedActionApprovalGeneration(current) === consumeRequest.approvalGeneration
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

  return buildHostedActionApprovalView(approval, input.now ?? new Date());
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

  return requireHostedActionApprovalIdentity(approval);
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
}): Promise<HostedActionApprovalView> {
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

  return {
    approvalId: input.approval.approvalId,
    expiresAt: expiresAt.toISOString(),
    presentation: input.approval.presentation,
    returnContactKind: input.approval.returnContactKind,
    status: input.decision,
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

function buildHostedActionApprovalResult(
  approval: HostedSensitiveActionChallenge,
  now: Date,
): HostedActionApprovalResult {
  const identity = requireHostedActionApprovalIdentity(approval);
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

  return {
    actionHash: hashHostedActionApprovalRequest({
      memberId: input.memberId,
      request,
    }),
    approvalId,
    expiresAt: new Date(now.getTime() + ACTION_APPROVAL_TTL_MS),
    memberId: input.memberId,
    now,
    request,
  };
}

function buildPendingHostedActionApprovalData(
  prepared: PreparedHostedActionApprovalRequest,
) {
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
    presentationBody: prepared.request.presentation.body,
    presentationTitle: prepared.request.presentation.title,
    returnContactKind: prepared.request.returnContactKind,
    tokenHash: buildHostedActionApprovalPlaceholderHash(prepared.approvalId),
  };
}

async function refreshHostedActionApprovalRequest(input: {
  approval: HostedSensitiveActionChallenge;
  prepared: PreparedHostedActionApprovalRequest;
  prisma: HostedActionApprovalWriteStore;
}): Promise<HostedSensitiveActionChallenge> {
  const updated = await input.prisma.hostedSensitiveActionChallenge.updateMany({
    where: {
      actionHash: input.prepared.actionHash,
      actionId: input.prepared.request.actionId,
      approvalKey: input.prepared.approvalId,
      kind: ACTION_APPROVAL_KIND,
      memberId: input.prepared.memberId,
      tokenHash: input.approval.tokenHash,
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
    data: buildPendingHostedActionApprovalData(input.prepared),
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
    || approval.actionHash !== prepared.actionHash
    || approval.approvalKey !== prepared.approvalId
  ) {
    throw hostedOnboardingError({
      code: "ACTION_APPROVAL_IDENTITY_CONFLICT",
      httpStatus: 409,
      message: "This action id is already bound to a different sensitive action.",
    });
  }
}

function buildHostedActionApprovalView(
  approval: HostedSensitiveActionChallenge,
  now: Date,
): HostedActionApprovalView {
  const identity = requireHostedActionApprovalIdentity(approval);

  return {
    approvalId: identity.approvalId,
    expiresAt: identity.expiresAt.toISOString(),
    presentation: identity.presentation,
    returnContactKind: identity.returnContactKind,
    status: readHostedActionApprovalStatus(approval, now),
  };
}

function requireHostedActionApprovalIdentity(
  approval: HostedSensitiveActionChallenge,
): PendingHostedActionApprovalIdentity {
  if (
    approval.kind !== ACTION_APPROVAL_KIND
    || !approval.approvalKey
    || !approval.actionId
    || !approval.actionHash
    || !approval.presentationTitle
    || !approval.presentationBody
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
    presentation: parseHostedActionApprovalPresentation({
      body: approval.presentationBody,
      title: approval.presentationTitle,
    }),
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
  const identity = requireHostedActionApprovalIdentity(approval);
  return {
    approvalGeneration: buildHostedActionApprovalGeneration(approval),
    approvalId: identity.approvalId,
    status: "approved",
  };
}

function buildHostedActionApprovalGeneration(
  approval: HostedSensitiveActionChallenge,
): string {
  const identity = requireHostedActionApprovalIdentity(approval);
  return sha256Hex([
    ACTION_APPROVAL_GENERATION_VERSION,
    identity.approvalId,
    identity.actionHash,
    identity.tokenHash,
  ].join("\n"));
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
