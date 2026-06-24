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
  parseHostedActionApprovalPresentation,
  parseHostedActionApprovalRequest,
  serializeHostedActionApprovalRequest,
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

type HostedActionApprovalReadStore = Pick<
  PrismaClient,
  "hostedSensitiveActionChallenge"
>;

export function requireHostedActionApprovalId(value: unknown): string {
  if (!isHostedActionApprovalId(value)) {
    throw actionApprovalNotFound();
  }
  return value;
}

export async function requestHostedActionApproval(input: {
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  request: HostedActionApprovalRequest | unknown;
}): Promise<HostedActionApprovalResult> {
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
  const expiresAt = new Date(now.getTime() + ACTION_APPROVAL_TTL_MS);

  const approval = await input.prisma.hostedSensitiveActionChallenge.upsert({
    where: { approvalKey: approvalId },
    create: {
      actionHash,
      actionId: request.actionId,
      approvalKey: approvalId,
      approvalStatus: "pending",
      bindingHash: actionHash,
      createdAt: now,
      expiresAt,
      kind: ACTION_APPROVAL_KIND,
      memberId: input.memberId,
      presentationBody: request.presentation.body,
      presentationTitle: request.presentation.title,
      returnContactKind: request.returnContactKind,
      tokenHash: buildHostedActionApprovalPlaceholderHash(approvalId),
    },
    update: {},
  });

  if (
    approval.kind !== ACTION_APPROVAL_KIND
    || approval.memberId !== input.memberId
    || approval.actionId !== request.actionId
    || approval.actionHash !== actionHash
    || approval.approvalKey !== approvalId
  ) {
    throw hostedOnboardingError({
      code: "ACTION_APPROVAL_IDENTITY_CONFLICT",
      httpStatus: 409,
      message: "This action id is already bound to a different sensitive action.",
    });
  }

  return buildHostedActionApprovalResult(approval, now);
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
      decidedAt: now,
    },
  });

  if (updated.count !== 1) {
    throw actionApprovalUnavailable();
  }

  return {
    approvalId: input.approval.approvalId,
    expiresAt: input.approval.expiresAt.toISOString(),
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
  if (
    approval.approvalStatus === "approved"
    || approval.approvalStatus === "denied"
  ) {
    return approval.approvalStatus;
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
