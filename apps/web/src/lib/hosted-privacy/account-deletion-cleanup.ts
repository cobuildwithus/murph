import { randomBytes } from "node:crypto";

import type {
  HostedAccountDeletionCleanup,
  Prisma,
  PrismaClient,
} from "@prisma/client";

import { getHostedWebCryptoConfig } from "../hosted-crypto/env";
import {
  deleteHostedRunnerUserDataBestEffort,
  type HostedRunnerUserDataDeletionBestEffortResult,
} from "../hosted-execution/user-data-delete";
import { describeHostedExecutionSafeLogErrorCode } from "../hosted-execution/logging";
import { deleteHostedPrivyUser } from "../hosted-onboarding/privy";
import { getHostedOnboardingStripe } from "../hosted-onboarding/runtime";

const CLEANUP_SCHEMA = "murph.hosted-account-deletion-cleanup.v1" as const;
const CLEANUP_BATCH_SIZE = 25;
const CLEANUP_BATCH_CONCURRENCY = 4;
const CLEANUP_LEASE_MS = 5 * 60_000;
const CLEANUP_RETRY_BASE_MS = 5 * 60_000;
const CLEANUP_RETRY_MAX_MS = 24 * 60 * 60_000;
const CLEANUP_IDENTIFIER_LIMIT = 1_024;
const CLEANUP_RECEIPT_SETTLEMENT_BUDGET_MS = 250;
const CLEANUP_TARGET_TIMEOUT_ERROR_CODE = "ACCOUNT_DELETION_CLEANUP_TARGET_TIMEOUT";

export const HOSTED_ACCOUNT_DELETION_IMMEDIATE_ATTEMPT_TIMEOUT_MS = 5_000;
export const HOSTED_ACCOUNT_DELETION_RETRY_ATTEMPT_TIMEOUT_MS = 15_000;

interface CleanupPayload {
  privyUserId: string | null;
  runtimeMemberIds: string[];
  schema: typeof CLEANUP_SCHEMA;
  stripeCustomerIds: string[];
}

export type HostedAccountVendorDeletionStatus =
  | "completed"
  | "failed"
  | "skipped_no_record"
  | "skipped_not_configured";

export interface HostedAccountVendorDeletionResult {
  errorCode: string | null;
  status: HostedAccountVendorDeletionStatus;
}

export interface PreparedHostedAccountDeletionCleanup {
  cloudflareCompletedAt: Date | null;
  environment: string;
  id: string;
  kmsKeyName: string;
  nextAttemptAt: Date;
  payloadCiphertext: string;
  privyCompletedAt: Date | null;
  runtimeMemberIds: readonly string[];
  stripeCompletedAt: Date | null;
}

export interface HostedAccountDeletionCleanupRunResult {
  cleanupPending: boolean;
  cloudflare: HostedRunnerUserDataDeletionBestEffortResult;
  vendorAccounts: {
    privyUser: HostedAccountVendorDeletionResult;
    stripeCustomer: HostedAccountVendorDeletionResult;
  };
}

export interface HostedAccountDeletionCleanupBatchResult {
  completed: number;
  failed: number;
  pending: number;
  selected: number;
}

export async function prepareHostedAccountDeletionCleanup(input: {
  now: Date;
  privyUserId: string | null;
  runtimeMemberIds: readonly string[];
  stripeCustomerIds: readonly string[];
}): Promise<PreparedHostedAccountDeletionCleanup> {
  assertValidDate(input.now);
  const id = `hbadc_${randomBytes(18).toString("base64url")}`;
  const runtimeMemberIds = uniqueIdentifiers(input.runtimeMemberIds, "runtime member");
  if (runtimeMemberIds.length === 0) {
    throw new TypeError("Hosted account deletion cleanup requires a runtime member.");
  }
  const stripeCustomerIds = uniqueIdentifiers(input.stripeCustomerIds, "Stripe customer");
  const privyUserId = optionalIdentifier(input.privyUserId, "Privy user");
  const cryptoConfig = getHostedWebCryptoConfig();
  const encrypted = await cryptoConfig.gcpKms.encrypt({
    additionalAuthenticatedData: cleanupAad({
      environment: cryptoConfig.env,
      id,
    }),
    keyName: cryptoConfig.webWrapKmsKeyName,
    plaintext: new TextEncoder().encode(JSON.stringify({
      privyUserId,
      runtimeMemberIds,
      schema: CLEANUP_SCHEMA,
      stripeCustomerIds,
    } satisfies CleanupPayload)),
  });

  return {
    cloudflareCompletedAt: null,
    environment: cryptoConfig.env,
    id,
    kmsKeyName: encrypted.keyName,
    nextAttemptAt: input.now,
    payloadCiphertext: encrypted.ciphertext,
    privyCompletedAt: privyUserId === null ? input.now : null,
    runtimeMemberIds,
    stripeCompletedAt: stripeCustomerIds.length === 0 ? input.now : null,
  };
}

export async function persistHostedAccountDeletionCleanupTx(input: {
  cleanup: PreparedHostedAccountDeletionCleanup;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await input.prisma.hostedAccountDeletionCleanup.create({
    data: {
      cloudflareCompletedAt: input.cleanup.cloudflareCompletedAt,
      environment: input.cleanup.environment,
      id: input.cleanup.id,
      kmsKeyName: input.cleanup.kmsKeyName,
      nextAttemptAt: input.cleanup.nextAttemptAt,
      payloadCiphertext: input.cleanup.payloadCiphertext,
      privyCompletedAt: input.cleanup.privyCompletedAt,
      stripeCompletedAt: input.cleanup.stripeCompletedAt,
    },
  });
}

export async function runHostedAccountDeletionCleanup(input: {
  attemptTimeoutMs?: number;
  cleanupId: string;
  now?: Date;
  prisma: PrismaClient;
}): Promise<HostedAccountDeletionCleanupRunResult> {
  const now = input.now ?? new Date();
  assertValidDate(now);
  const attemptTimeoutMs = normalizeAttemptTimeoutMs(input.attemptTimeoutMs);
  return await withinCleanupDeadline({
    operation: runClaimedHostedAccountDeletionCleanup({
      attemptTimeoutMs,
      cleanupId: input.cleanupId,
      now,
      prisma: input.prisma,
    }),
    timeoutMs: attemptTimeoutMs + CLEANUP_RECEIPT_SETTLEMENT_BUDGET_MS,
    timeoutResult: pendingHostedAccountDeletionCleanupResult(
      "ACCOUNT_DELETION_CLEANUP_ATTEMPT_TIMEOUT",
    ),
  });
}

async function runClaimedHostedAccountDeletionCleanup(input: {
  attemptTimeoutMs: number;
  cleanupId: string;
  now: Date;
  prisma: PrismaClient;
}): Promise<HostedAccountDeletionCleanupRunResult> {
  const now = input.now;
  const attemptTimeoutMs = input.attemptTimeoutMs;
  const leaseToken = randomBytes(18).toString("base64url");
  const claimed = await input.prisma.hostedAccountDeletionCleanup.updateMany({
    data: {
      leaseExpiresAt: new Date(now.getTime() + CLEANUP_LEASE_MS),
      leaseToken,
    },
    where: {
      id: input.cleanupId,
      nextAttemptAt: { lte: now },
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lt: now } },
      ],
    },
  });

  if (claimed.count === 0) {
    const existing = await input.prisma.hostedAccountDeletionCleanup.findUnique({
      where: { id: input.cleanupId },
    });
    return existing ? pendingResult(existing) : completedResult();
  }

  const cleanup = await input.prisma.hostedAccountDeletionCleanup.findFirst({
    where: { id: input.cleanupId, leaseToken },
  });
  if (!cleanup) {
    return pendingHostedAccountDeletionCleanupResult(
      "ACCOUNT_DELETION_CLEANUP_CLAIM_LOST",
    );
  }

  try {
    const payload = await decryptCleanupPayload(cleanup);
    const [cloudflare, stripeCustomer, privyUser] = await Promise.all([
      cleanup.cloudflareCompletedAt
        ? completedCloudflareResult()
        : withinCleanupDeadline({
            operation: deleteHostedRunnerData(
              payload.runtimeMemberIds,
              attemptTimeoutMs,
            ),
            timeoutMs: attemptTimeoutMs,
            timeoutResult: timedOutCloudflareResult(),
          }),
      cleanup.stripeCompletedAt
        ? completedOrSkippedVendorResult(payload.stripeCustomerIds.length > 0)
        : withinCleanupDeadline({
            operation: deleteStripeCustomers(payload.stripeCustomerIds),
            timeoutMs: attemptTimeoutMs,
            timeoutResult: timedOutVendorResult(),
          }),
      cleanup.privyCompletedAt
        ? completedOrSkippedVendorResult(payload.privyUserId !== null)
        : withinCleanupDeadline({
            operation: deletePrivyUser(payload.privyUserId),
            timeoutMs: attemptTimeoutMs,
            timeoutResult: timedOutVendorResult(),
          }),
    ]);
    const cloudflareCompletedAt = cleanup.cloudflareCompletedAt
      ?? (cloudflare.deleted ? now : null);
    const stripeCompletedAt = cleanup.stripeCompletedAt
      ?? (isTerminalVendorDeletion(stripeCustomer) ? now : null);
    const privyCompletedAt = cleanup.privyCompletedAt
      ?? (isTerminalVendorDeletion(privyUser) ? now : null);
    let cleanupPending =
      !cloudflareCompletedAt || !stripeCompletedAt || !privyCompletedAt;

    if (cleanupPending) {
      await input.prisma.hostedAccountDeletionCleanup.updateMany({
        data: {
          attemptCount: { increment: 1 },
          cloudflareCompletedAt,
          lastAttemptedAt: now,
          lastErrorCode: pendingErrorCode({
            cloudflare,
            privyUser,
            stripeCustomer,
          }),
          leaseExpiresAt: null,
          leaseToken: null,
          nextAttemptAt: nextAttemptAt(now, cleanup.attemptCount),
          privyCompletedAt,
          stripeCompletedAt,
        },
        where: { id: cleanup.id, leaseToken },
      });
    } else {
      const deleted = await input.prisma.hostedAccountDeletionCleanup.deleteMany({
        where: { id: cleanup.id, leaseToken },
      });
      if (deleted.count === 0) {
        cleanupPending =
          await input.prisma.hostedAccountDeletionCleanup.findUnique({
            select: { id: true },
            where: { id: cleanup.id },
          }) !== null;
      }
    }

    return {
      cleanupPending,
      cloudflare,
      vendorAccounts: { privyUser, stripeCustomer },
    };
  } catch (error) {
    await input.prisma.hostedAccountDeletionCleanup.updateMany({
      data: {
        attemptCount: { increment: 1 },
        lastAttemptedAt: now,
        lastErrorCode: safeErrorCode(error),
        leaseExpiresAt: null,
        leaseToken: null,
        nextAttemptAt: nextAttemptAt(now, cleanup.attemptCount),
      },
      where: { id: cleanup.id, leaseToken },
    });
    throw error;
  }
}

export async function drainHostedAccountDeletionCleanupBatch(input: {
  now?: Date;
  prisma: PrismaClient;
}): Promise<HostedAccountDeletionCleanupBatchResult> {
  const now = input.now ?? new Date();
  assertValidDate(now);
  const rows = await input.prisma.hostedAccountDeletionCleanup.findMany({
    orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
    select: { id: true },
    take: CLEANUP_BATCH_SIZE,
    where: {
      nextAttemptAt: { lte: now },
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lt: now } },
      ],
    },
  });

  const counts = { completed: 0, failed: 0, pending: 0 };
  for (let index = 0; index < rows.length; index += CLEANUP_BATCH_CONCURRENCY) {
    const outcomes = await Promise.all(
      rows.slice(index, index + CLEANUP_BATCH_CONCURRENCY).map(async (row) => {
        try {
          const result = await runHostedAccountDeletionCleanup({
            attemptTimeoutMs: HOSTED_ACCOUNT_DELETION_RETRY_ATTEMPT_TIMEOUT_MS,
            cleanupId: row.id,
            now,
            prisma: input.prisma,
          });
          return result.cleanupPending ? "pending" : "completed";
        } catch (error) {
          console.error("Hosted account deletion cleanup retry failed.", {
            cleanupIdSuffix: row.id.slice(-8),
            errorCode: safeErrorCode(error),
          });
          return "failed";
        }
      }),
    );
    for (const outcome of outcomes) {
      counts[outcome] += 1;
    }
  }

  return { ...counts, selected: rows.length };
}

export function pendingHostedAccountDeletionCleanupResult(
  errorCode = "ACCOUNT_DELETION_CLEANUP_PENDING",
): HostedAccountDeletionCleanupRunResult {
  return {
    cleanupPending: true,
    cloudflare: {
      alarmCleared: null,
      configured: false,
      deleteAllCompleted: null,
      deleted: false,
      errorCode,
      r2DeletedObjectCount: null,
      r2SkippedUserScopedPrefixes: null,
      r2Supported: null,
      r2UserScopedSkipReason: null,
      runnerStateDeleted: null,
    },
    vendorAccounts: {
      privyUser: { errorCode, status: "failed" },
      stripeCustomer: { errorCode, status: "failed" },
    },
  };
}

async function decryptCleanupPayload(
  cleanup: HostedAccountDeletionCleanup,
): Promise<CleanupPayload> {
  const cryptoConfig = getHostedWebCryptoConfig();
  if (cleanup.environment !== cryptoConfig.env) {
    throw new TypeError("Hosted account deletion cleanup environment does not match.");
  }
  const decrypted = await cryptoConfig.gcpKms.decrypt({
    additionalAuthenticatedData: cleanupAad({
      environment: cleanup.environment,
      id: cleanup.id,
    }),
    ciphertext: cleanup.payloadCiphertext,
    keyName: cleanup.kmsKeyName,
  });
  return parseCleanupPayload(
    JSON.parse(new TextDecoder().decode(decrypted.plaintext)),
  );
}

function parseCleanupPayload(value: unknown): CleanupPayload {
  if (!isRecord(value) || value.schema !== CLEANUP_SCHEMA) {
    throw new TypeError("Hosted account deletion cleanup payload is invalid.");
  }
  if (!Array.isArray(value.runtimeMemberIds) || !Array.isArray(value.stripeCustomerIds)) {
    throw new TypeError("Hosted account deletion cleanup identifiers are invalid.");
  }
  const runtimeMemberIds = uniqueIdentifiers(value.runtimeMemberIds, "runtime member");
  if (runtimeMemberIds.length === 0) {
    throw new TypeError("Hosted account deletion cleanup runtime members are invalid.");
  }

  return {
    privyUserId: optionalIdentifier(value.privyUserId, "Privy user"),
    runtimeMemberIds,
    schema: CLEANUP_SCHEMA,
    stripeCustomerIds: uniqueIdentifiers(value.stripeCustomerIds, "Stripe customer"),
  };
}

async function deleteHostedRunnerData(
  runtimeMemberIds: readonly string[],
  timeoutMs: number,
): Promise<HostedRunnerUserDataDeletionBestEffortResult> {
  const results = await Promise.all(runtimeMemberIds.map((userId) =>
    deleteHostedRunnerUserDataBestEffort({
      context: "account-deletion-cleanup",
      timeoutMs,
      userId,
    })
  ));
  return mergeCloudflareDeletionResults(results);
}

async function deleteStripeCustomers(
  stripeCustomerIds: readonly string[],
): Promise<HostedAccountVendorDeletionResult> {
  if (stripeCustomerIds.length === 0) {
    return { errorCode: null, status: "skipped_no_record" };
  }
  const stripe = getHostedOnboardingStripe();
  if (!stripe) {
    return { errorCode: null, status: "skipped_not_configured" };
  }

  for (const customerId of stripeCustomerIds) {
    try {
      await stripe.customers.del(customerId);
    } catch (error) {
      if (!isStripeResourceMissingError(error)) {
        return { errorCode: safeErrorCode(error), status: "failed" };
      }
    }
  }
  return { errorCode: null, status: "completed" };
}

async function deletePrivyUser(
  privyUserId: string | null,
): Promise<HostedAccountVendorDeletionResult> {
  if (!privyUserId) {
    return { errorCode: null, status: "skipped_no_record" };
  }
  try {
    const deleted = await deleteHostedPrivyUser(privyUserId);
    return deleted
      ? { errorCode: null, status: "completed" }
      : { errorCode: null, status: "skipped_not_configured" };
  } catch (error) {
    return isExplicitResourceMissingError(error)
      ? { errorCode: null, status: "completed" }
      : { errorCode: safeErrorCode(error), status: "failed" };
  }
}

function mergeCloudflareDeletionResults(
  results: readonly HostedRunnerUserDataDeletionBestEffortResult[],
): HostedRunnerUserDataDeletionBestEffortResult {
  return {
    alarmCleared: mergeNullableBooleans(results.map((result) => result.alarmCleared)),
    configured: results.some((result) => result.configured),
    deleteAllCompleted: mergeNullableBooleans(
      results.map((result) => result.deleteAllCompleted),
    ),
    deleted: results.length > 0 && results.every((result) => result.deleted),
    errorCode: results.find((result) => result.errorCode)?.errorCode ?? null,
    r2DeletedObjectCount: sumNullableNumbers(
      results.map((result) => result.r2DeletedObjectCount),
    ),
    r2SkippedUserScopedPrefixes: mergeNullableAnyBooleans(
      results.map((result) => result.r2SkippedUserScopedPrefixes),
    ),
    r2Supported: mergeNullableBooleans(results.map((result) => result.r2Supported)),
    r2UserScopedSkipReason: results.find((result) => result.r2UserScopedSkipReason)
      ?.r2UserScopedSkipReason ?? null,
    runnerStateDeleted: mergeNullableBooleans(
      results.map((result) => result.runnerStateDeleted),
    ),
  };
}

function pendingResult(
  cleanup: HostedAccountDeletionCleanup,
): HostedAccountDeletionCleanupRunResult {
  const errorCode =
    cleanup.lastErrorCode ?? "ACCOUNT_DELETION_CLEANUP_IN_PROGRESS";
  return {
    cleanupPending: true,
    cloudflare: cleanup.cloudflareCompletedAt
      ? completedCloudflareResult()
      : pendingHostedAccountDeletionCleanupResult(errorCode).cloudflare,
    vendorAccounts: {
      privyUser: cleanup.privyCompletedAt
        ? { errorCode: null, status: "completed" }
        : { errorCode, status: "failed" },
      stripeCustomer: cleanup.stripeCompletedAt
        ? { errorCode: null, status: "completed" }
        : { errorCode, status: "failed" },
    },
  };
}

function completedResult(): HostedAccountDeletionCleanupRunResult {
  return {
    cleanupPending: false,
    cloudflare: completedCloudflareResult(),
    vendorAccounts: {
      privyUser: { errorCode: null, status: "completed" },
      stripeCustomer: { errorCode: null, status: "completed" },
    },
  };
}

function completedCloudflareResult(): HostedRunnerUserDataDeletionBestEffortResult {
  return {
    alarmCleared: true,
    configured: true,
    deleteAllCompleted: true,
    deleted: true,
    errorCode: null,
    r2DeletedObjectCount: null,
    r2SkippedUserScopedPrefixes: false,
    r2Supported: true,
    r2UserScopedSkipReason: null,
    runnerStateDeleted: true,
  };
}

function timedOutCloudflareResult(): HostedRunnerUserDataDeletionBestEffortResult {
  return {
    alarmCleared: null,
    configured: true,
    deleteAllCompleted: null,
    deleted: false,
    errorCode: CLEANUP_TARGET_TIMEOUT_ERROR_CODE,
    r2DeletedObjectCount: null,
    r2SkippedUserScopedPrefixes: null,
    r2Supported: null,
    r2UserScopedSkipReason: null,
    runnerStateDeleted: null,
  };
}

function timedOutVendorResult(): HostedAccountVendorDeletionResult {
  return {
    errorCode: CLEANUP_TARGET_TIMEOUT_ERROR_CODE,
    status: "failed",
  };
}

async function withinCleanupDeadline<T>(input: {
  operation: Promise<T>;
  timeoutMs: number;
  timeoutResult: T;
}): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.operation,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(input.timeoutResult), input.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function completedOrSkippedVendorResult(
  hadRecord: boolean,
): HostedAccountVendorDeletionResult {
  return hadRecord
    ? { errorCode: null, status: "completed" }
    : { errorCode: null, status: "skipped_no_record" };
}

function isTerminalVendorDeletion(
  result: HostedAccountVendorDeletionResult,
): boolean {
  return result.status === "completed" || result.status === "skipped_no_record";
}

function pendingErrorCode(input: {
  cloudflare: HostedRunnerUserDataDeletionBestEffortResult;
  privyUser: HostedAccountVendorDeletionResult;
  stripeCustomer: HostedAccountVendorDeletionResult;
}): string | null {
  if (!input.cloudflare.deleted) {
    return input.cloudflare.errorCode
      ?? (input.cloudflare.configured
        ? "CLOUDFLARE_DELETION_INCOMPLETE"
        : "CLOUDFLARE_NOT_CONFIGURED");
  }
  const vendor = [input.stripeCustomer, input.privyUser]
    .find((result) => !isTerminalVendorDeletion(result));
  if (!vendor) {
    return null;
  }
  return vendor.errorCode
    ?? (vendor.status === "skipped_not_configured"
      ? "VENDOR_NOT_CONFIGURED"
      : "VENDOR_DELETION_INCOMPLETE");
}

function nextAttemptAt(now: Date, priorAttemptCount: number): Date {
  const exponent = Math.min(Math.max(priorAttemptCount, 0), 8);
  return new Date(now.getTime() + Math.min(
    CLEANUP_RETRY_MAX_MS,
    CLEANUP_RETRY_BASE_MS * 2 ** exponent,
  ));
}

function cleanupAad(input: { environment: string; id: string }): string {
  return JSON.stringify({
    environment: input.environment,
    id: input.id,
    schema: CLEANUP_SCHEMA,
  });
}

function uniqueIdentifiers(values: readonly unknown[], label: string): string[] {
  if (values.length > CLEANUP_IDENTIFIER_LIMIT) {
    throw new TypeError(`Hosted account deletion cleanup has too many ${label} identifiers.`);
  }
  return [...new Set(values.map((value) => {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) {
      throw new TypeError(`Hosted account deletion cleanup ${label} identifier is invalid.`);
    }
    return value.trim();
  }))];
}

function optionalIdentifier(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return uniqueIdentifiers([value], label)[0] ?? null;
}

function safeErrorCode(error: unknown): string {
  return describeHostedExecutionSafeLogErrorCode(error);
}

function isStripeResourceMissingError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  return error.code === "resource_missing"
    && typeof error.type === "string"
    && error.type.startsWith("Stripe");
}

function isExplicitResourceMissingError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  const status = error.status ?? error.statusCode;
  return status === 404
    || error.code === "NOT_FOUND"
    || error.code === "not_found"
    || error.code === "resource_missing";
}

function mergeNullableBooleans(
  values: readonly (boolean | null)[],
): boolean | null {
  const present = values.filter((value): value is boolean => value !== null);
  return present.length === 0 ? null : present.every(Boolean);
}

function mergeNullableAnyBooleans(
  values: readonly (boolean | null)[],
): boolean | null {
  const present = values.filter((value): value is boolean => value !== null);
  return present.length === 0 ? null : present.some(Boolean);
}

function sumNullableNumbers(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0
    ? null
    : present.reduce((sum, value) => sum + value, 0);
}

function assertValidDate(value: Date): void {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError("Hosted account deletion cleanup time must be valid.");
  }
}

function normalizeAttemptTimeoutMs(value: number | undefined): number {
  const timeoutMs = value ?? HOSTED_ACCOUNT_DELETION_RETRY_ATTEMPT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("Hosted account deletion cleanup timeout must be a positive integer.");
  }
  return timeoutMs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
