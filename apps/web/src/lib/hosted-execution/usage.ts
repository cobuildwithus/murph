import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  parseAssistantUsageRecord,
  type AssistantUsageRecord,
} from "@murphai/hosted-execution/assistant-usage";

import { getPrisma } from "../prisma";
import { accountHostedAiUsageForAllowanceTx } from "./usage-allowance";
import { sendHostedAiUsageLimitNotice } from "./usage-gate-notice";

export interface RecordHostedAiUsageResult {
  recordedIds: string[];
}

type HostedAiUsageClient = PrismaClient | Prisma.TransactionClient;
const HOSTED_AI_USAGE_STRIPE_EXPORT_DISABLED_MESSAGE =
  "Hosted AI usage is recorded locally; Stripe usage metering is not configured.";

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
  providerRequestId: true,
  providerRequestOutcome: true,
  providerRequestOrdinal: true,
  rawUsageJson: true,
  rawUsageJsonHash: true,
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
  usageExtractionSourcePath: true,
  usageExtractionVersion: true,
} as const satisfies Prisma.HostedAiUsageSelect;

type StoredHostedAiUsageImmutableFields = Prisma.HostedAiUsageGetPayload<{
  select: typeof HOSTED_AI_USAGE_IMMUTABLE_SELECT;
}>;

export async function recordHostedAiUsageRecords(input: {
  accountAllowance?: boolean;
  prisma?: HostedAiUsageClient;
  trustedUserId?: string | null;
  usage: readonly unknown[];
}): Promise<RecordHostedAiUsageResult> {
  const prisma = input.prisma ?? getPrisma();
  const records = dedupeHostedAiUsageRecords(parseHostedAiUsageRecords(input.usage));
  const recordedIds: string[] = [];

  for (const record of records) {
    const memberId = requireHostedAiUsageMemberId(record, input.trustedUserId ?? null);
    const limitCrossing = await runHostedAiUsageRecordTransaction(prisma, async (tx) => {
      const storedRecord = await tx.hostedAiUsage.upsert({
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
      await markHostedAiUsageStripeExportSkippedTx({
        id: storedRecord.id,
        tx,
      });

      if (input.accountAllowance === true) {
        return accountHostedAiUsageForAllowanceTx({
          memberId,
          record,
          tx,
        });
      }

      return null;
    });
    recordedIds.push(record.usageId);

    if (limitCrossing) {
      // Best-effort proactive limit notice on the first crossing. The
      // production route passes a real PrismaClient, so this runs after the
      // per-record transaction commits; the once-per-period claim inside the
      // sender dedupes against the gate-denial notice paths.
      await sendHostedAiUsageLimitNotice({
        memberId,
        notice: limitCrossing.userNotice,
        periodStart: limitCrossing.periodStart,
        prisma,
      });
    }
  }

  return {
    recordedIds,
  };
}

async function runHostedAiUsageRecordTransaction<T>(
  prisma: HostedAiUsageClient,
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const maybeTransaction = prisma as {
    $transaction?: <R>(
      run: (tx: Prisma.TransactionClient) => Promise<R>,
    ) => Promise<R>;
  };

  if (typeof maybeTransaction.$transaction === "function") {
    return maybeTransaction.$transaction(run);
  }

  return run(prisma as Prisma.TransactionClient);
}

function dedupeHostedAiUsageRecords(
  records: readonly AssistantUsageRecord[],
): AssistantUsageRecord[] {
  const recordsByUsageId = new Map<string, AssistantUsageRecord>();

  for (const record of records) {
    const existing = recordsByUsageId.get(record.usageId);

    if (existing && !sameAssistantUsageRecord(existing, record)) {
      throw new TypeError(
        "Hosted AI usage recording contains conflicting records for one usage id.",
      );
    }

    recordsByUsageId.set(record.usageId, record);
  }

  return [...recordsByUsageId.values()];
}

function parseHostedAiUsageRecords(
  usage: readonly unknown[],
): AssistantUsageRecord[] {
  try {
    return usage.map((entry) => parseAssistantUsageRecord(entry));
  } catch {
    throw new TypeError("Hosted AI usage recording contains an invalid usage record.");
  }
}

function sameAssistantUsageRecord(
  left: AssistantUsageRecord,
  right: AssistantUsageRecord,
): boolean {
  return stringifyHostedAiUsageRecordForComparison(left)
    === stringifyHostedAiUsageRecordForComparison(right);
}

function stringifyHostedAiUsageRecordForComparison(
  record: AssistantUsageRecord,
): string {
  const normalized = {
    ...record,
    providerRequestOrdinal: record.providerRequestOrdinal ?? 0,
  };

  return JSON.stringify(
    Object.keys(normalized)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = normalized[key as keyof typeof normalized];
        return result;
      }, {}),
  );
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
    providerRequestOrdinal: record.providerRequestOrdinal ?? 0,
    occurredAt: normalizeHostedAiUsageDate(record.occurredAt, "occurredAt"),
    provider: record.provider,
    routeId: record.routeId,
    requestedModel: record.requestedModel,
    servedModel: record.servedModel,
    providerName: record.providerName,
    providerRequestId: record.providerRequestId,
    rawUsageJson: record.rawUsageJson
      ? normalizeHostedAiUsageJsonObject(record.rawUsageJson, "rawUsageJson")
      : undefined,
    rawUsageJsonHash: record.rawUsageJsonHash,
    turnProfileJson: record.turnProfileJson
      ? normalizeHostedAiUsageJsonObject(record.turnProfileJson, "turnProfileJson")
      : undefined,
    usageExtractionSourcePath: record.usageExtractionSourcePath,
    usageExtractionVersion: record.usageExtractionVersion,
    providerRequestOutcome: record.providerRequestOutcome ?? "succeeded",
    baseUrl: record.baseUrl,
    apiKeyEnv: record.apiKeyEnv,
    credentialSource: record.credentialSource,
    featureKey: record.featureKey,
    gatewayTagsJson: record.gatewayTags,
    reportingUserId: record.reportingUserId,
    surface: record.surface,
    stripeMeterSource: record.stripeMeterSource,
    triggerKind: record.triggerKind,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    reasoningTokens: record.reasoningTokens,
    cachedInputTokens: record.cachedInputTokens,
    cacheWriteTokens: record.cacheWriteTokens,
    totalTokens: record.totalTokens,
    stripeMeterError: HOSTED_AI_USAGE_STRIPE_EXPORT_DISABLED_MESSAGE,
    stripeMeterStatus: "skipped",
  };
}

async function markHostedAiUsageStripeExportSkippedTx(input: {
  id: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.hostedAiUsage.updateMany({
    where: {
      id: input.id,
      stripeMeterSource: "murph",
      stripeMeterStatus: {
        in: ["pending", "processing"],
      },
    },
    data: {
      stripeMeterError: HOSTED_AI_USAGE_STRIPE_EXPORT_DISABLED_MESSAGE,
      stripeMeterNextAttemptAt: null,
      stripeMeterStatus: "skipped",
    },
  });
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
    compareHostedAiUsageField(
      "providerRequestOrdinal",
      input.storedRecord.providerRequestOrdinal,
      expected.providerRequestOrdinal ?? 0,
    ),
    compareHostedAiUsageField("occurredAt", input.storedRecord.occurredAt.toISOString(), expected.occurredAt),
    compareHostedAiUsageField("provider", input.storedRecord.provider, expected.provider),
    compareHostedAiUsageField("routeId", input.storedRecord.routeId, expected.routeId),
    compareHostedAiUsageField("requestedModel", input.storedRecord.requestedModel, expected.requestedModel),
    compareHostedAiUsageField("servedModel", input.storedRecord.servedModel, expected.servedModel),
    compareHostedAiUsageField("providerName", input.storedRecord.providerName, expected.providerName),
    compareHostedAiUsageField(
      "providerRequestId",
      input.storedRecord.providerRequestId,
      expected.providerRequestId,
    ),
    compareHostedAiUsageJsonField(
      "rawUsageJson",
      input.storedRecord.rawUsageJson,
      expected.rawUsageJson
        ? normalizeHostedAiUsageJsonObject(expected.rawUsageJson, "rawUsageJson")
        : null,
    ),
    compareHostedAiUsageField(
      "rawUsageJsonHash",
      input.storedRecord.rawUsageJsonHash,
      expected.rawUsageJsonHash,
    ),
    compareHostedAiUsageField(
      "usageExtractionSourcePath",
      input.storedRecord.usageExtractionSourcePath,
      expected.usageExtractionSourcePath,
    ),
    compareHostedAiUsageField(
      "usageExtractionVersion",
      input.storedRecord.usageExtractionVersion,
      expected.usageExtractionVersion,
    ),
    compareHostedAiUsageField(
      "providerRequestOutcome",
      input.storedRecord.providerRequestOutcome,
      expected.providerRequestOutcome ?? "succeeded",
    ),
    compareHostedAiUsageField("baseUrl", input.storedRecord.baseUrl, expected.baseUrl),
    compareHostedAiUsageField("apiKeyEnv", input.storedRecord.apiKeyEnv, expected.apiKeyEnv),
    compareHostedAiUsageField("credentialSource", input.storedRecord.credentialSource, expected.credentialSource),
    compareHostedAiUsageField("featureKey", input.storedRecord.featureKey, expected.featureKey),
    compareHostedAiUsageJsonField("gatewayTagsJson", input.storedRecord.gatewayTagsJson, expected.gatewayTags),
    compareHostedAiUsageField("reportingUserId", input.storedRecord.reportingUserId, expected.reportingUserId),
    compareHostedAiUsageField("surface", input.storedRecord.surface, expected.surface),
    compareHostedAiUsageField(
      "stripeMeterSource",
      input.storedRecord.stripeMeterSource,
      expected.stripeMeterSource,
    ),
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
      `Hosted AI usage already exists with different immutable fields: ${mismatchedFields.join(", ")}.`,
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
  return stringifyHostedAiUsageJsonForComparison(actual)
    === stringifyHostedAiUsageJsonForComparison(expected)
    ? null
    : fieldName;
}

function stringifyHostedAiUsageJsonForComparison(
  value: Prisma.JsonValue | null,
): string {
  return JSON.stringify(normalizeHostedAiUsageJsonForComparison(value));
}

function normalizeHostedAiUsageJsonForComparison(
  value: Prisma.JsonValue | null,
): Prisma.JsonValue | null {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeHostedAiUsageJsonForComparison(entry));
  }

  if (isHostedAiUsageJsonObject(value)) {
    const normalized: Prisma.JsonObject = {};

    for (const [key, entry] of Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (entry === undefined) {
        continue;
      }

      normalized[key] = normalizeHostedAiUsageJsonForComparison(entry);
    }

    return normalized;
  }

  return value;
}

function isHostedAiUsageJsonObject(
  value: Prisma.JsonValue | null,
): value is Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeHostedAiUsageJsonObject(
  value: Record<string, unknown>,
  label: string,
): Prisma.JsonObject {
  const normalized: Prisma.JsonObject = {};

  for (const [key, entry] of Object.entries(value)) {
    const normalizedEntry = normalizeHostedAiUsageJsonValue(entry, `${label}.${key}`);

    if (normalizedEntry !== undefined) {
      normalized[key] = normalizedEntry;
    }
  }

  return normalized;
}

function normalizeHostedAiUsageJsonValue(
  value: unknown,
  label: string,
): Prisma.JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Hosted AI usage ${label} must be a finite JSON number.`);
    }

    return value;
  }

  if (Array.isArray(value)) {
    const normalized: Prisma.JsonArray = [];

    for (const [index, entry] of value.entries()) {
      normalized.push(normalizeHostedAiUsageJsonValue(entry, `${label}[${index}]`) ?? null);
    }

    return normalized;
  }

  if (typeof value === "object") {
    return normalizeHostedAiUsageJsonObject(value as Record<string, unknown>, label);
  }

  throw new TypeError(`Hosted AI usage ${label} must be JSON-serializable.`);
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
      "Hosted AI usage is missing memberId and cannot be recorded into the hosted usage ledger.",
    );
  }

  if (trustedUserId && record.memberId !== trustedUserId) {
    throw new TypeError(
      "Hosted AI usage memberId does not match the authenticated hosted execution user.",
    );
  }

  return record.memberId;
}
