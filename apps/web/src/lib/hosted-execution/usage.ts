import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  parseAssistantUsageRecord,
  type AssistantUsageCredentialSource,
  type AssistantUsageRecord,
} from "@murphai/runtime-state/node/assistant-usage";

import { readHostedMemberBillingPrivateState } from "../hosted-onboarding/member-private-codecs";
import { getPrisma } from "../prisma";

export interface ImportHostedAiUsageResult {
  recordedIds: string[];
  records: AssistantUsageRecord[];
}

type HostedAiUsageClient = PrismaClient | Prisma.TransactionClient;
export type HostedAiUsageStripeMeterStatus = "failed" | "metered" | "pending" | "skipped";

export interface HostedAiUsageStripeCandidate {
  apiKeyEnv: string | null;
  credentialSource: AssistantUsageCredentialSource;
  id: string;
  inputTokens: number | null;
  memberId: string;
  occurredAt: Date;
  outputTokens: number | null;
  provider: string;
  requestedModel: string | null;
  servedModel: string | null;
  stripeCustomerId: string;
  stripeMeterAttemptCount: number;
  stripeMeterIdentifier: string | null;
  stripeMeterStatus: HostedAiUsageStripeMeterStatus;
  totalTokens: number | null;
}

const HOSTED_AI_USAGE_IMMUTABLE_SELECT = {
  apiKeyEnv: true,
  attemptCount: true,
  baseUrl: true,
  cacheWriteTokens: true,
  cachedInputTokens: true,
  credentialSource: true,
  featureKey: true,
  gatewayTagsJson: true,
  id: true,
  inputTokens: true,
  memberId: true,
  occurredAt: true,
  outputTokens: true,
  provider: true,
  providerName: true,
  reasoningTokens: true,
  reportingUserId: true,
  requestedModel: true,
  routeId: true,
  servedModel: true,
  sessionId: true,
  surface: true,
  totalTokens: true,
  triggerKind: true,
  turnId: true,
} as const satisfies Prisma.HostedAiUsageSelect;

type StoredHostedAiUsageImmutableFields = Prisma.HostedAiUsageGetPayload<{
  select: typeof HOSTED_AI_USAGE_IMMUTABLE_SELECT;
}>;

export async function listHostedAiUsagePendingStripeMetering(input: {
  limit?: number;
  now?: Date | string;
  prisma?: PrismaClient;
} = {}): Promise<HostedAiUsageStripeCandidate[]> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeHostedAiUsageDate(input.now ?? new Date().toISOString(), "now");

  const records = await prisma.hostedAiUsage.findMany({
    where: {
      credentialSource: {
        not: null,
      },
      stripeMeterStatus: "pending",
      OR: [
        {
          stripeMeterNextAttemptAt: null,
        },
        {
          stripeMeterNextAttemptAt: {
            lte: now,
          },
        },
      ],
      member: {
        billingRef: {
          is: {
            stripeCustomerLookupKey: {
              not: null,
            },
          },
        },
      },
    },
    orderBy: [
      {
        stripeMeterNextAttemptAt: "asc",
      },
      {
        occurredAt: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
    take: Math.max(1, input.limit ?? 32),
    select: {
      apiKeyEnv: true,
      credentialSource: true,
      id: true,
      inputTokens: true,
      member: {
        select: {
          billingRef: {
            select: {
              memberId: true,
              stripeCustomerIdEncrypted: true,
              stripeSubscriptionIdEncrypted: true,
            },
          },
        },
      },
      memberId: true,
      occurredAt: true,
      outputTokens: true,
      provider: true,
      requestedModel: true,
      servedModel: true,
      stripeMeterAttemptCount: true,
      stripeMeterIdentifier: true,
      stripeMeterStatus: true,
      totalTokens: true,
    },
  });

  const candidates = await Promise.all(records.map(async (record) => {
    const stripeCustomerId = record.member.billingRef
      ? readHostedMemberBillingPrivateState(record.member.billingRef).stripeCustomerId
      : null;

    if (!stripeCustomerId || !isAssistantUsageCredentialSource(record.credentialSource)) {
      return null;
    }

    return {
      apiKeyEnv: record.apiKeyEnv,
      credentialSource: record.credentialSource,
      id: record.id,
      inputTokens: record.inputTokens,
      memberId: record.memberId,
      occurredAt: record.occurredAt,
      outputTokens: record.outputTokens,
      provider: record.provider,
      requestedModel: record.requestedModel,
      servedModel: record.servedModel,
      stripeCustomerId,
      stripeMeterAttemptCount: record.stripeMeterAttemptCount,
      stripeMeterIdentifier: normalizeOptionalString(
        record.stripeMeterIdentifier,
        "stripeMeterIdentifier",
      ),
      stripeMeterStatus: normalizeHostedAiUsageStripeMeterStatus(record.stripeMeterStatus),
      totalTokens: record.totalTokens,
    } satisfies HostedAiUsageStripeCandidate;
  }));

  return candidates.flatMap((candidate) => candidate ? [candidate] : []);
}

function isAssistantUsageCredentialSource(
  value: string | null,
): value is AssistantUsageCredentialSource {
  return value === "member" || value === "platform" || value === "unknown";
}

function normalizeHostedAiUsageStripeMeterStatus(
  value: string,
): HostedAiUsageStripeMeterStatus {
  if (
    value === "failed"
    || value === "metered"
    || value === "pending"
    || value === "skipped"
  ) {
    return value;
  }

  throw new TypeError(`Unsupported hosted AI usage Stripe meter status: ${value}`);
}

export async function markHostedAiUsageStripeMetered(input: {
  attemptedAt?: Date | string;
  id: string;
  identifier: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const attemptedAt = normalizeHostedAiUsageDate(input.attemptedAt ?? new Date().toISOString(), "attemptedAt");

  await updateHostedAiUsageStripeMeterState({
    id: input.id,
    incrementAttemptCount: true,
    prisma: input.prisma,
    stripeMeterError: null,
    stripeMeterIdentifier: input.identifier,
    stripeMeterLastAttemptedAt: attemptedAt,
    stripeMeterNextAttemptAt: null,
    stripeMeterStatus: "metered",
    stripeMeteredAt: attemptedAt,
  });
}

export async function markHostedAiUsageStripeSkipped(input: {
  attemptedAt?: Date | string;
  id: string;
  message: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const attemptedAt = normalizeHostedAiUsageDate(input.attemptedAt ?? new Date().toISOString(), "attemptedAt");

  await updateHostedAiUsageStripeMeterState({
    id: input.id,
    incrementAttemptCount: true,
    prisma: input.prisma,
    stripeMeterError: input.message,
    stripeMeterIdentifier: null,
    stripeMeterLastAttemptedAt: attemptedAt,
    stripeMeterNextAttemptAt: null,
    stripeMeterStatus: "skipped",
    stripeMeteredAt: null,
  });
}

export async function markHostedAiUsageStripeRetryableFailure(input: {
  attemptedAt?: Date | string;
  id: string;
  identifier?: string | null;
  message: string;
  nextAttemptAt: Date | string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const attemptedAt = normalizeHostedAiUsageDate(input.attemptedAt ?? new Date().toISOString(), "attemptedAt");

  await updateHostedAiUsageStripeMeterState({
    id: input.id,
    incrementAttemptCount: true,
    prisma: input.prisma,
    stripeMeterError: input.message,
    stripeMeterIdentifier: normalizeOptionalString(input.identifier, "identifier"),
    stripeMeterLastAttemptedAt: attemptedAt,
    stripeMeterNextAttemptAt: normalizeHostedAiUsageDate(input.nextAttemptAt, "nextAttemptAt"),
    stripeMeterStatus: "pending",
    stripeMeteredAt: null,
  });
}

export async function markHostedAiUsageStripeFailed(input: {
  attemptedAt?: Date | string;
  id: string;
  identifier?: string | null;
  message: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const attemptedAt = normalizeHostedAiUsageDate(input.attemptedAt ?? new Date().toISOString(), "attemptedAt");

  await updateHostedAiUsageStripeMeterState({
    id: input.id,
    incrementAttemptCount: true,
    prisma: input.prisma,
    stripeMeterError: input.message,
    stripeMeterIdentifier: normalizeOptionalString(input.identifier, "identifier"),
    stripeMeterLastAttemptedAt: attemptedAt,
    stripeMeterNextAttemptAt: null,
    stripeMeterStatus: "failed",
    stripeMeteredAt: null,
  });
}

export async function markHostedAiUsageStripeProgress(input: {
  attemptedAt?: Date | string;
  id: string;
  identifier: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const attemptedAt = normalizeHostedAiUsageDate(
    input.attemptedAt ?? new Date().toISOString(),
    "attemptedAt",
  );

  await updateHostedAiUsageStripeMeterState({
    id: input.id,
    incrementAttemptCount: false,
    prisma: input.prisma,
    stripeMeterError: null,
    stripeMeterIdentifier: normalizeOptionalString(input.identifier, "identifier"),
    stripeMeterLastAttemptedAt: attemptedAt,
    stripeMeterNextAttemptAt: null,
    stripeMeterStatus: "pending",
    stripeMeteredAt: null,
  });
}

async function updateHostedAiUsageStripeMeterState(input: {
  id: string;
  incrementAttemptCount: boolean;
  prisma?: HostedAiUsageClient;
  stripeMeterError: string | null;
  stripeMeterIdentifier: string | null;
  stripeMeterLastAttemptedAt: Date | null;
  stripeMeterNextAttemptAt: Date | null;
  stripeMeterStatus: HostedAiUsageStripeMeterStatus;
  stripeMeteredAt: Date | null;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();

  await prisma.hostedAiUsage.updateMany({
    where: {
      id: input.id,
      stripeMeterStatus: "pending",
    },
    data: {
      stripeMeterError: input.stripeMeterError,
      stripeMeterIdentifier: input.stripeMeterIdentifier,
      stripeMeterLastAttemptedAt: input.stripeMeterLastAttemptedAt,
      stripeMeterNextAttemptAt: input.stripeMeterNextAttemptAt,
      stripeMeterStatus: input.stripeMeterStatus,
      stripeMeteredAt: input.stripeMeteredAt,
      ...(input.incrementAttemptCount
        ? {
            stripeMeterAttemptCount: {
              increment: 1,
            },
          }
        : {}),
    },
  });
}

export async function importHostedAiUsageRecords(input: {
  prisma?: PrismaClient;
  trustedUserId?: string | null;
  usage: readonly unknown[];
}): Promise<ImportHostedAiUsageResult> {
  const prisma = input.prisma ?? getPrisma();
  const records = dedupeHostedAiUsageRecords(
    input.usage.map((entry) => parseAssistantUsageRecord(entry)),
  );
  const recordedIds: string[] = [];

  for (const record of records) {
    const memberId = requireHostedAiUsageMemberId(record, input.trustedUserId ?? null);
    const storedRecord = await prisma.hostedAiUsage.upsert({
      where: {
        id: record.usageId,
      },
      create: buildHostedAiUsageCreateData(record, memberId),
      update: {},
      select: HOSTED_AI_USAGE_IMMUTABLE_SELECT,
    });

    assertStoredHostedAiUsageMatchesRecord({
      memberId,
      record,
      storedRecord,
    });
    recordedIds.push(record.usageId);
  }

  return {
    recordedIds,
    records,
  };
}

function dedupeHostedAiUsageRecords(
  records: readonly AssistantUsageRecord[],
): AssistantUsageRecord[] {
  const recordsByUsageId = new Map<string, AssistantUsageRecord>();

  for (const record of records) {
    const existing = recordsByUsageId.get(record.usageId);

    if (existing && !sameAssistantUsageRecord(existing, record)) {
      throw new TypeError(
        `Hosted AI usage import contains conflicting records for usage id ${record.usageId}.`,
      );
    }

    recordsByUsageId.set(record.usageId, record);
  }

  return [...recordsByUsageId.values()];
}

function sameAssistantUsageRecord(
  left: AssistantUsageRecord,
  right: AssistantUsageRecord,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildHostedAiUsageCreateData(
  record: AssistantUsageRecord,
  memberId: string,
): Prisma.HostedAiUsageUncheckedCreateInput {
  return {
    id: record.usageId,
    memberId,
    sessionId: record.sessionId,
    turnId: record.turnId,
    attemptCount: record.attemptCount,
    occurredAt: normalizeHostedAiUsageDate(record.occurredAt, "occurredAt"),
    provider: record.provider,
    routeId: record.routeId,
    requestedModel: record.requestedModel,
    servedModel: record.servedModel,
    providerName: record.providerName,
    baseUrl: record.baseUrl,
    apiKeyEnv: record.apiKeyEnv,
    credentialSource: record.credentialSource,
    featureKey: record.featureKey,
    gatewayTagsJson: record.gatewayTags,
    reportingUserId: record.reportingUserId,
    surface: record.surface,
    triggerKind: record.triggerKind,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    reasoningTokens: record.reasoningTokens,
    cachedInputTokens: record.cachedInputTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    totalTokens: record.totalTokens,
  };
}

function assertStoredHostedAiUsageMatchesRecord(input: {
  memberId: string;
  record: AssistantUsageRecord;
  storedRecord: StoredHostedAiUsageImmutableFields;
}): void {
  const expected = {
    ...input.record,
    id: input.record.usageId,
    memberId: input.memberId,
    occurredAt: normalizeHostedAiUsageDate(input.record.occurredAt, "occurredAt").toISOString(),
  };
  const mismatchedFields = [
    compareHostedAiUsageField("memberId", input.storedRecord.memberId, expected.memberId),
    compareHostedAiUsageField("sessionId", input.storedRecord.sessionId, expected.sessionId),
    compareHostedAiUsageField("turnId", input.storedRecord.turnId, expected.turnId),
    compareHostedAiUsageField("attemptCount", input.storedRecord.attemptCount, expected.attemptCount),
    compareHostedAiUsageField("occurredAt", input.storedRecord.occurredAt.toISOString(), expected.occurredAt),
    compareHostedAiUsageField("provider", input.storedRecord.provider, expected.provider),
    compareHostedAiUsageField("routeId", input.storedRecord.routeId, expected.routeId),
    compareHostedAiUsageField("requestedModel", input.storedRecord.requestedModel, expected.requestedModel),
    compareHostedAiUsageField("servedModel", input.storedRecord.servedModel, expected.servedModel),
    compareHostedAiUsageField("providerName", input.storedRecord.providerName, expected.providerName),
    compareHostedAiUsageField("baseUrl", input.storedRecord.baseUrl, expected.baseUrl),
    compareHostedAiUsageField("apiKeyEnv", input.storedRecord.apiKeyEnv, expected.apiKeyEnv),
    compareHostedAiUsageField("credentialSource", input.storedRecord.credentialSource, expected.credentialSource),
    compareHostedAiUsageField("featureKey", input.storedRecord.featureKey, expected.featureKey),
    compareHostedAiUsageJsonField("gatewayTagsJson", input.storedRecord.gatewayTagsJson, expected.gatewayTags),
    compareHostedAiUsageField("reportingUserId", input.storedRecord.reportingUserId, expected.reportingUserId),
    compareHostedAiUsageField("surface", input.storedRecord.surface, expected.surface),
    compareHostedAiUsageField("triggerKind", input.storedRecord.triggerKind, expected.triggerKind),
    compareHostedAiUsageField("inputTokens", input.storedRecord.inputTokens, expected.inputTokens),
    compareHostedAiUsageField("outputTokens", input.storedRecord.outputTokens, expected.outputTokens),
    compareHostedAiUsageField("reasoningTokens", input.storedRecord.reasoningTokens, expected.reasoningTokens),
    compareHostedAiUsageField("cachedInputTokens", input.storedRecord.cachedInputTokens, expected.cachedInputTokens),
    compareHostedAiUsageField("cacheWriteTokens", input.storedRecord.cacheWriteTokens, expected.cacheWriteTokens),
    compareHostedAiUsageField("totalTokens", input.storedRecord.totalTokens, expected.totalTokens),
  ].filter((field): field is string => field !== null);

  if (mismatchedFields.length > 0) {
    throw new TypeError(
      `Hosted AI usage id ${input.record.usageId} already exists with different immutable fields: ${mismatchedFields.join(", ")}.`,
    );
  }
}

function compareHostedAiUsageField(
  fieldName: string,
  actual: number | string | null,
  expected: number | string | null,
): string | null {
  return actual === expected ? null : fieldName;
}

function compareHostedAiUsageJsonField(
  fieldName: string,
  actual: Prisma.JsonValue | null,
  expected: Prisma.JsonValue,
): string | null {
  return JSON.stringify(actual) === JSON.stringify(expected) ? null : fieldName;
}

function normalizeHostedAiUsageDate(value: Date | string, label: string): Date {
  const date = value instanceof Date ? value : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`Hosted AI usage ${label} must be a valid date.`);
  }

  return date;
}

function requireHostedAiUsageMemberId(
  record: AssistantUsageRecord,
  trustedUserId: string | null,
): string {
  if (!record.memberId) {
    throw new TypeError(
      `Hosted AI usage ${record.usageId} is missing memberId and cannot be imported into the hosted usage ledger.`,
    );
  }

  if (trustedUserId && record.memberId !== trustedUserId) {
    throw new TypeError(
      `Hosted AI usage ${record.usageId} memberId ${record.memberId} does not match the authenticated hosted execution user ${trustedUserId}.`,
    );
  }

  return record.memberId;
}

function normalizeOptionalString(
  value: string | null | undefined,
  label: string,
): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`Hosted AI usage ${label} must be a string when provided.`);
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
