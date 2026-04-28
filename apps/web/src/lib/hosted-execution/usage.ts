import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  normalizeAssistantUsageStripeMeterSource,
  parseAssistantUsageRecord,
  type AssistantUsageCredentialSource,
  type AssistantUsageRecord,
} from "@murphai/runtime-state/node/assistant-usage";

import {
  HOSTED_AI_USAGE_BILLING_DISABLED_MESSAGE,
  readHostedAiUsageBillingMode,
  type HostedAiUsageBillingMode,
} from "@murphai/hosted-execution";
import { readHostedMemberBillingPrivateState } from "../hosted-onboarding/member-private-codecs";
import { getPrisma } from "../prisma";

export interface ImportHostedAiUsageResult {
  recordedIds: string[];
  records: AssistantUsageRecord[];
}

type HostedAiUsageClient = PrismaClient | Prisma.TransactionClient;
export type HostedAiUsageStripeMeterStatus =
  | "delegated"
  | "failed"
  | "metered"
  | "pending"
  | "processing"
  | "skipped";

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
  updatedAt: Date;
}

export interface HostedAiUsageStripeMeterLease {
  attemptCount: number;
  leaseExpiresAt: Date;
  updatedAt: Date;
}

export class HostedAiUsageStripeMeterClaimLostError extends Error {
  constructor(id: string) {
    super(
      `Hosted AI usage ${id} changed while Stripe metering progress was being written.`,
    );
    this.name = "HostedAiUsageStripeMeterClaimLostError";
  }
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
  stripeMeterSource: true,
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
      stripeMeterSource: "murph",
      stripeMeterStatus: {
        in: ["pending", "processing"],
      },
      OR: buildHostedAiUsageStripeMeterDueWhere(now),
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
      updatedAt: true,
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
      updatedAt: record.updatedAt,
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
    value === "delegated"
    || value === "failed"
    || value === "metered"
    || value === "pending"
    || value === "processing"
    || value === "skipped"
  ) {
    return value;
  }

  throw new TypeError(`Unsupported hosted AI usage Stripe meter status: ${value}`);
}

export async function markHostedAiUsageStripeDelegated(input: {
  id: string;
  message: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const prisma = input.prisma ?? getPrisma();

  await prisma.hostedAiUsage.updateMany({
    where: {
      id: input.id,
      stripeMeterStatus: "pending",
    },
    data: {
      stripeMeterError: input.message,
      stripeMeterIdentifier: null,
      stripeMeterLastAttemptedAt: null,
      stripeMeterNextAttemptAt: null,
      stripeMeterStatus: "delegated",
      stripeMeteredAt: null,
    },
  });
}

export async function claimHostedAiUsageStripeMetering(input: {
  attemptedAt?: Date | string;
  candidate: HostedAiUsageStripeCandidate;
  leaseMs: number;
  prisma?: HostedAiUsageClient;
}): Promise<HostedAiUsageStripeMeterLease | null> {
  const attemptedAt = normalizeHostedAiUsageDate(
    input.attemptedAt ?? new Date().toISOString(),
    "attemptedAt",
  );
  const leaseMs = normalizePositiveInteger(input.leaseMs, "leaseMs");
  const leaseExpiresAt = new Date(attemptedAt.getTime() + leaseMs);
  const prisma = input.prisma ?? getPrisma();

  const claimed = await prisma.hostedAiUsage.updateMany({
    where: {
      id: input.candidate.id,
      stripeMeterIdentifier: normalizeOptionalString(
        input.candidate.stripeMeterIdentifier,
        "stripeMeterIdentifier",
      ),
      stripeMeterStatus: input.candidate.stripeMeterStatus,
      stripeMeterAttemptCount: input.candidate.stripeMeterAttemptCount,
      updatedAt: input.candidate.updatedAt,
      OR: buildHostedAiUsageStripeMeterDueWhere(attemptedAt),
    },
    data: {
      stripeMeterAttemptCount: {
        increment: 1,
      },
      stripeMeterError: null,
      stripeMeterIdentifier: normalizeOptionalString(
        input.candidate.stripeMeterIdentifier,
        "stripeMeterIdentifier",
      ),
      stripeMeterLastAttemptedAt: attemptedAt,
      stripeMeterNextAttemptAt: leaseExpiresAt,
      stripeMeterStatus: "processing",
      stripeMeteredAt: null,
    },
  });

  if (claimed.count !== 1) {
    return null;
  }

  const claimedRow = await prisma.hostedAiUsage.findUnique({
    where: {
      id: input.candidate.id,
    },
    select: {
      stripeMeterAttemptCount: true,
      updatedAt: true,
    },
  });

  if (!claimedRow) {
    throw new HostedAiUsageStripeMeterClaimLostError(input.candidate.id);
  }

  return {
    attemptCount: claimedRow.stripeMeterAttemptCount,
    leaseExpiresAt,
    updatedAt: claimedRow.updatedAt,
  };
}

export async function markHostedAiUsageStripeMetered(input: {
  attemptedAt?: Date | string;
  claim: HostedAiUsageStripeMeterLease;
  expectedIdentifier?: string | null;
  id: string;
  identifier: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const attemptedAt = normalizeHostedAiUsageDate(input.attemptedAt ?? new Date().toISOString(), "attemptedAt");

  await updateHostedAiUsageStripeMeterState({
    claim: input.claim,
    expectedIdentifier: normalizeOptionalString(input.expectedIdentifier, "expectedIdentifier"),
    id: input.id,
    incrementAttemptCount: false,
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
  claim: HostedAiUsageStripeMeterLease;
  expectedIdentifier?: string | null;
  id: string;
  message: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const attemptedAt = normalizeHostedAiUsageDate(input.attemptedAt ?? new Date().toISOString(), "attemptedAt");

  await updateHostedAiUsageStripeMeterState({
    claim: input.claim,
    expectedIdentifier: normalizeOptionalString(input.expectedIdentifier, "expectedIdentifier"),
    id: input.id,
    incrementAttemptCount: false,
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
  claim: HostedAiUsageStripeMeterLease;
  expectedIdentifier?: string | null;
  id: string;
  identifier?: string | null;
  message: string;
  nextAttemptAt: Date | string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const attemptedAt = normalizeHostedAiUsageDate(input.attemptedAt ?? new Date().toISOString(), "attemptedAt");

  await updateHostedAiUsageStripeMeterState({
    claim: input.claim,
    expectedIdentifier: normalizeOptionalString(input.expectedIdentifier, "expectedIdentifier"),
    id: input.id,
    incrementAttemptCount: false,
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
  claim: HostedAiUsageStripeMeterLease;
  expectedIdentifier?: string | null;
  id: string;
  identifier?: string | null;
  message: string;
  prisma?: HostedAiUsageClient;
}): Promise<void> {
  const attemptedAt = normalizeHostedAiUsageDate(input.attemptedAt ?? new Date().toISOString(), "attemptedAt");

  await updateHostedAiUsageStripeMeterState({
    claim: input.claim,
    expectedIdentifier: normalizeOptionalString(input.expectedIdentifier, "expectedIdentifier"),
    id: input.id,
    incrementAttemptCount: false,
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
  claim: HostedAiUsageStripeMeterLease;
  expectedIdentifier?: string | null;
  id: string;
  identifier: string;
  prisma?: HostedAiUsageClient;
}): Promise<HostedAiUsageStripeMeterLease> {
  const attemptedAt = normalizeHostedAiUsageDate(
    input.attemptedAt ?? new Date().toISOString(),
    "attemptedAt",
  );

  return updateHostedAiUsageStripeMeterState({
    claim: input.claim,
    expectedIdentifier: normalizeOptionalString(input.expectedIdentifier, "expectedIdentifier"),
    id: input.id,
    incrementAttemptCount: false,
    prisma: input.prisma,
    stripeMeterError: null,
    stripeMeterIdentifier: normalizeOptionalString(input.identifier, "identifier"),
    stripeMeterLastAttemptedAt: attemptedAt,
    stripeMeterNextAttemptAt: input.claim.leaseExpiresAt,
    stripeMeterStatus: "processing",
    stripeMeteredAt: null,
    returnUpdatedLease: true,
  });
}

async function updateHostedAiUsageStripeMeterState(input: {
  claim?: HostedAiUsageStripeMeterLease;
  expectedIdentifier?: string | null;
  id: string;
  incrementAttemptCount: boolean;
  prisma?: HostedAiUsageClient;
  returnUpdatedLease?: boolean;
  stripeMeterError: string | null;
  stripeMeterIdentifier: string | null;
  stripeMeterLastAttemptedAt: Date | null;
  stripeMeterNextAttemptAt: Date | null;
  stripeMeterStatus: HostedAiUsageStripeMeterStatus;
  stripeMeteredAt: Date | null;
}): Promise<HostedAiUsageStripeMeterLease> {
  const prisma = input.prisma ?? getPrisma();

  const updated = await prisma.hostedAiUsage.updateMany({
    where: {
      id: input.id,
      stripeMeterStatus: input.claim ? "processing" : "pending",
      ...(input.claim
        ? {
            updatedAt: input.claim.updatedAt,
            stripeMeterAttemptCount: input.claim.attemptCount,
            stripeMeterIdentifier: normalizeOptionalString(
              input.expectedIdentifier,
              "expectedIdentifier",
            ),
          }
        : {}),
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

  if (input.claim && updated.count !== 1) {
    throw new HostedAiUsageStripeMeterClaimLostError(input.id);
  }

  if (!input.claim || !input.returnUpdatedLease) {
    return input.claim ?? {
      attemptCount: 0,
      leaseExpiresAt: input.stripeMeterNextAttemptAt ?? new Date(0),
      updatedAt: new Date(0),
    };
  }

  const refreshedRow = await prisma.hostedAiUsage.findUnique({
    where: {
      id: input.id,
    },
    select: {
      stripeMeterAttemptCount: true,
      updatedAt: true,
    },
  });

  if (!refreshedRow) {
    throw new HostedAiUsageStripeMeterClaimLostError(input.id);
  }

  return {
    attemptCount: refreshedRow.stripeMeterAttemptCount,
    leaseExpiresAt: input.claim.leaseExpiresAt,
    updatedAt: refreshedRow.updatedAt,
  };
}

export async function importHostedAiUsageRecords(input: {
  aiUsageBillingMode?: HostedAiUsageBillingMode;
  prisma?: PrismaClient;
  trustedUserId?: string | null;
  usage: readonly unknown[];
}): Promise<ImportHostedAiUsageResult> {
  const prisma = input.prisma ?? getPrisma();
  const aiUsageBillingMode = input.aiUsageBillingMode ?? readHostedAiUsageBillingMode();
  const records = dedupeHostedAiUsageRecords(
    input.usage.map((entry) => parseAssistantUsageRecord(entry)),
  );
  const recordedIds: string[] = [];
  const memberStripeCustomerIdCache = new Map<string, Promise<string | null>>();

  for (const record of records) {
    const memberId = requireHostedAiUsageMemberId(record, input.trustedUserId ?? null);
    const stripeMeterSource = await resolveHostedAiUsageStripeMeterSource({
      memberId,
      prisma,
      record,
      aiUsageBillingMode,
      stripeCustomerIdCache: memberStripeCustomerIdCache,
    });
    const storedRecord = await prisma.hostedAiUsage.upsert({
      where: {
        turnId_attemptCount: {
          attemptCount: record.attemptCount,
          turnId: record.turnId,
        },
      },
      create: buildHostedAiUsageCreateData(
        record,
        memberId,
        stripeMeterSource,
        aiUsageBillingMode,
      ),
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

export async function markHostedAiUsageStripeMeteringDisabled(input: {
  limit?: number;
  message?: string;
  now?: Date | string;
  prisma?: HostedAiUsageClient;
} = {}): Promise<number> {
  const prisma = input.prisma ?? getPrisma();
  const now = normalizeHostedAiUsageDate(input.now ?? new Date().toISOString(), "now");
  const records = await prisma.hostedAiUsage.findMany({
    where: buildHostedAiUsageStripeMeterDisabledWhere(now),
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
    take: normalizePositiveInteger(input.limit ?? 32, "limit"),
    select: {
      id: true,
    },
  });

  const ids = records.map((record) => record.id);

  if (ids.length === 0) {
    return 0;
  }

  const updated = await prisma.hostedAiUsage.updateMany({
    where: {
      id: {
        in: ids,
      },
      ...buildHostedAiUsageStripeMeterDisabledWhere(now),
    },
    data: {
      stripeMeterError: input.message ?? HOSTED_AI_USAGE_BILLING_DISABLED_MESSAGE,
      stripeMeterIdentifier: null,
      stripeMeterLastAttemptedAt: now,
      stripeMeterNextAttemptAt: null,
      stripeMeterStatus: "skipped",
      stripeMeteredAt: null,
    },
  });

  return updated.count;
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
  stripeMeterSource: AssistantUsageRecord["stripeMeterSource"],
  aiUsageBillingMode: HostedAiUsageBillingMode,
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
    stripeMeterSource,
    triggerKind: record.triggerKind,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    reasoningTokens: record.reasoningTokens,
    cachedInputTokens: record.cachedInputTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    totalTokens: record.totalTokens,
    ...(aiUsageBillingMode === "disabled"
      ? {
          stripeMeterError: HOSTED_AI_USAGE_BILLING_DISABLED_MESSAGE,
          stripeMeterStatus: "skipped" as const,
        }
      : {}),
    ...(stripeMeterSource === "vercel-ai-gateway"
      ? {
          stripeMeterError:
            "Delegated Stripe token metering is handled upstream by Vercel AI Gateway.",
          stripeMeterStatus: "delegated" as const,
        }
      : {}),
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
    compareHostedAiUsageField("id", input.storedRecord.id, expected.id),
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

async function resolveHostedAiUsageStripeMeterSource(input: {
  aiUsageBillingMode: HostedAiUsageBillingMode;
  memberId: string;
  prisma: PrismaClient;
  record: AssistantUsageRecord;
  stripeCustomerIdCache: Map<string, Promise<string | null>>;
}): Promise<AssistantUsageRecord["stripeMeterSource"]> {
  if (input.aiUsageBillingMode === "disabled") {
    return "murph";
  }

  const requestedSource = normalizeAssistantUsageStripeMeterSource(input.record.stripeMeterSource);

  if (requestedSource !== "vercel-ai-gateway") {
    return "murph";
  }

  if (
    input.record.credentialSource !== "platform"
    || !isHostedAiUsageVercelAiGatewayRecord(input.record)
  ) {
    return "murph";
  }

  const stripeCustomerId = await readHostedAiUsageMemberStripeCustomerId({
    memberId: input.memberId,
    prisma: input.prisma,
    stripeCustomerIdCache: input.stripeCustomerIdCache,
  });

  return stripeCustomerId ? "vercel-ai-gateway" : "murph";
}

async function readHostedAiUsageMemberStripeCustomerId(input: {
  memberId: string;
  prisma: PrismaClient;
  stripeCustomerIdCache: Map<string, Promise<string | null>>;
}): Promise<string | null> {
  const cached = input.stripeCustomerIdCache.get(input.memberId);

  if (cached) {
    return cached;
  }

  const pendingStripeCustomerId = input.prisma.hostedMemberBillingRef.findUnique({
    where: {
      memberId: input.memberId,
    },
    select: {
      memberId: true,
      stripeCustomerIdEncrypted: true,
      stripeSubscriptionIdEncrypted: true,
    },
  }).then((billingRef) =>
    billingRef ? readHostedMemberBillingPrivateState(billingRef).stripeCustomerId : null,
  );

  input.stripeCustomerIdCache.set(input.memberId, pendingStripeCustomerId);
  return pendingStripeCustomerId;
}

function isHostedAiUsageVercelAiGatewayRecord(record: AssistantUsageRecord): boolean {
  const normalizedProviderName = normalizeOptionalString(record.providerName, "providerName");

  if (record.provider === "codex-cli") {
    return normalizedProviderName?.toLowerCase() === "vercel-ai-gateway";
  }

  if (record.provider !== "openai-compatible") {
    return false;
  }

  if (normalizedProviderName?.toLowerCase() === "vercel-ai-gateway") {
    return true;
  }

  const normalizedBaseUrl = normalizeOptionalString(record.baseUrl, "baseUrl");
  if (!normalizedBaseUrl) {
    return false;
  }

  try {
    const url = new URL(normalizedBaseUrl);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "ai-gateway.vercel.sh";
  } catch {
    return false;
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

function buildHostedAiUsageStripeMeterDueWhere(
  now: Date,
): Prisma.HostedAiUsageWhereInput["OR"] {
  return [
    {
      stripeMeterNextAttemptAt: null,
    },
    {
      stripeMeterNextAttemptAt: {
        lte: now,
      },
    },
  ];
}

function buildHostedAiUsageStripeMeterDisabledWhere(
  now: Date,
): Prisma.HostedAiUsageWhereInput {
  return {
    stripeMeterSource: "murph",
    OR: [
      {
        stripeMeterStatus: "pending",
      },
      {
        stripeMeterStatus: "processing",
        OR: buildHostedAiUsageStripeMeterDueWhere(now),
      },
    ],
  };
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`Hosted AI usage ${label} must be a positive integer.`);
  }

  return value;
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
