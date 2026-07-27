import { randomBytes } from "node:crypto";

import type {
  HostedAccountDeletionCleanup,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { sanitizeHostedRuntimeErrorCode } from "@murphai/device-syncd/hosted-runtime";

import { getHostedWebCryptoConfig } from "../hosted-crypto/env";
import {
  deleteHostedRunnerUserDataBestEffort,
  type HostedRunnerUserDataDeletionBestEffortResult,
} from "../hosted-execution/user-data-delete";
import { deleteHostedPrivyUser } from "../hosted-onboarding/privy";
import { getHostedOnboardingStripe } from "../hosted-onboarding/runtime";
import { logHostedStripeFailure } from "../hosted-onboarding/stripe-error-log";

const HOSTED_ACCOUNT_DELETION_CLEANUP_SCHEMA =
  "murph.hosted-account-deletion-cleanup.v1" as const;
const HOSTED_ACCOUNT_DELETION_CLEANUP_BATCH_SIZE = 5;
const HOSTED_ACCOUNT_DELETION_CLEANUP_TARGET_TIMEOUT_MS = 5_000;
const HOSTED_ACCOUNT_DELETION_CLEANUP_RETRY_MS = 60 * 60_000;
const HOSTED_ACCOUNT_DELETION_CLEANUP_IDENTIFIER_MAX = 1_024;

interface HostedAccountDeletionCleanupPayload {
  privyUserId: string | null;
  runtimeMemberIds: string[];
  schema: typeof HOSTED_ACCOUNT_DELETION_CLEANUP_SCHEMA;
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
  const now = normalizeDate(input.now);
  const id = `hbadc_${randomBytes(18).toString("base64url")}`;
  const runtimeMemberIds = uniqueIdentifiers(input.runtimeMemberIds, "runtime member");
  if (runtimeMemberIds.length === 0) {
    throw new TypeError("Hosted account deletion cleanup requires a runtime member.");
  }
  const stripeCustomerIds = uniqueIdentifiers(input.stripeCustomerIds, "Stripe customer");
  const privyUserId = normalizeOptionalIdentifier(input.privyUserId, "Privy user");
  const config = getHostedWebCryptoConfig();
  const payload: HostedAccountDeletionCleanupPayload = {
    privyUserId,
    runtimeMemberIds,
    schema: HOSTED_ACCOUNT_DELETION_CLEANUP_SCHEMA,
    stripeCustomerIds,
  };
  const encrypted = await config.gcpKms.encrypt({
    additionalAuthenticatedData: buildCleanupAad({
      environment: config.env,
      id,
    }),
    keyName: config.webWrapKmsKeyName,
    plaintext: new TextEncoder().encode(JSON.stringify(payload)),
  });

  return {
    cloudflareCompletedAt: null,
    environment: config.env,
    id,
    kmsKeyName: encrypted.keyName,
    nextAttemptAt: now,
    payloadCiphertext: encrypted.ciphertext,
    privyCompletedAt: privyUserId === null ? now : null,
    runtimeMemberIds,
    stripeCompletedAt: stripeCustomerIds.length === 0 ? now : null,
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

/**
 * Runs one idempotent cleanup receipt.
 *
 * No second concurrency owner is needed: every external operation treats
 * confirmed absence as success, and each successful target only moves its own
 * completion timestamp from null to a value. Overlapping immediate/retention
 * runs may duplicate a delete, but they cannot erase another target's progress
 * or report completion while the durable receipt remains.
 */
export async function runHostedAccountDeletionCleanup(input: {
  cleanupId: string;
  now?: Date;
  prisma: PrismaClient;
}): Promise<HostedAccountDeletionCleanupRunResult> {
  const now = normalizeDate(input.now ?? new Date());
  const cleanup = await input.prisma.hostedAccountDeletionCleanup.findUnique({
    where: { id: input.cleanupId },
  });
  if (!cleanup) {
    return completedCleanupResult();
  }

  try {
    const payload = await decryptCleanupPayload(cleanup);
    const [cloudflare, stripeCustomer, privyUser] = await Promise.all([
      cleanup.cloudflareCompletedAt
        ? Promise.resolve(completedCloudflareResult())
        : withCleanupDeadline(
            deleteHostedRunnerData(payload.runtimeMemberIds),
            pendingHostedAccountDeletionCleanupResult(
              "ACCOUNT_DELETION_CLEANUP_TIMEOUT",
            ).cloudflare,
          ),
      cleanup.stripeCompletedAt
        ? Promise.resolve(completedOrSkippedVendorResult(
            payload.stripeCustomerIds.length > 0,
          ))
        : withCleanupDeadline(
            deleteStripeCustomers(payload.stripeCustomerIds),
            timedOutVendorDeletionResult(),
          ),
      cleanup.privyCompletedAt
        ? Promise.resolve(completedOrSkippedVendorResult(
            payload.privyUserId !== null,
          ))
        : withCleanupDeadline(
            deletePrivyUser(payload.privyUserId),
            timedOutVendorDeletionResult(),
          ),
    ]);
    const updateData = buildProgressUpdate({
      cleanup,
      cloudflare,
      now,
      privyUser,
      stripeCustomer,
    });

    await input.prisma.hostedAccountDeletionCleanup.updateMany({
      data: updateData,
      where: { id: cleanup.id },
    });

    const current = await input.prisma.hostedAccountDeletionCleanup.findUnique({
      where: { id: cleanup.id },
    });
    if (!current) {
      return completedCleanupResult();
    }

    if (hasCompletedAllTargets(current)) {
      const deleted = await input.prisma.hostedAccountDeletionCleanup.deleteMany({
        where: {
          cloudflareCompletedAt: { not: null },
          id: current.id,
          privyCompletedAt: { not: null },
          stripeCompletedAt: { not: null },
        },
      });
      if (
        deleted.count > 0
        || await input.prisma.hostedAccountDeletionCleanup.findUnique({
          where: { id: current.id },
        }) === null
      ) {
        return {
          cleanupPending: false,
          cloudflare,
          vendorAccounts: {
            privyUser,
            stripeCustomer,
          },
        };
      }
    }

    return {
      cleanupPending: true,
      cloudflare,
      vendorAccounts: {
        privyUser,
        stripeCustomer,
      },
    };
  } catch (error) {
    await input.prisma.hostedAccountDeletionCleanup.updateMany({
      data: {
        lastAttemptedAt: now,
        lastErrorCode: safeCleanupErrorCode(error),
        nextAttemptAt: nextAttemptAt(now),
      },
      where: { id: cleanup.id },
    });
    throw error;
  }
}

export async function drainHostedAccountDeletionCleanupBatch(input: {
  now?: Date;
  prisma: PrismaClient;
}): Promise<HostedAccountDeletionCleanupBatchResult> {
  const now = normalizeDate(input.now ?? new Date());
  const rows = await input.prisma.hostedAccountDeletionCleanup.findMany({
    orderBy: [
      { nextAttemptAt: "asc" },
      { createdAt: "asc" },
    ],
    select: { id: true },
    take: HOSTED_ACCOUNT_DELETION_CLEANUP_BATCH_SIZE,
    where: {
      nextAttemptAt: { lte: now },
    },
  });

  const outcomes = await Promise.all(rows.map(async (row) => {
    try {
      const result = await runHostedAccountDeletionCleanup({
        cleanupId: row.id,
        now,
        prisma: input.prisma,
      });
      if (result.cleanupPending) {
        return "pending" as const;
      }
      return "completed" as const;
    } catch (error) {
      console.error("Hosted account deletion cleanup retry failed.", {
        cleanupIdSuffix: row.id.slice(-8),
        errorCode: safeCleanupErrorCode(error),
      });
      return "failed" as const;
    }
  }));
  let completed = 0;
  let failed = 0;
  let pending = 0;
  for (const outcome of outcomes) {
    if (outcome === "completed") {
      completed += 1;
    } else if (outcome === "failed") {
      failed += 1;
    } else {
      pending += 1;
    }
  }

  return {
    completed,
    failed,
    pending,
    selected: rows.length,
  };
}

function withCleanupDeadline<TResult>(
  operation: Promise<TResult>,
  timedOutResult: TResult,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => resolve(timedOutResult),
      HOSTED_ACCOUNT_DELETION_CLEANUP_TARGET_TIMEOUT_MS,
    );
    operation.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function timedOutVendorDeletionResult(): HostedAccountVendorDeletionResult {
  return {
    errorCode: "ACCOUNT_DELETION_CLEANUP_TIMEOUT",
    status: "failed",
  };
}

export function pendingHostedAccountDeletionCleanupResult(
  errorCode = "ACCOUNT_DELETION_CLEANUP_PENDING",
): HostedAccountDeletionCleanupRunResult {
  return {
    cleanupPending: true,
    cloudflare: {
      alarmCleared: null,
      configured: false,
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

function buildProgressUpdate(input: {
  cleanup: HostedAccountDeletionCleanup;
  cloudflare: HostedRunnerUserDataDeletionBestEffortResult;
  now: Date;
  privyUser: HostedAccountVendorDeletionResult;
  stripeCustomer: HostedAccountVendorDeletionResult;
}): Prisma.HostedAccountDeletionCleanupUpdateManyMutationInput {
  return {
    ...(input.cleanup.cloudflareCompletedAt || !input.cloudflare.deleted
      ? {}
      : { cloudflareCompletedAt: input.now }),
    lastAttemptedAt: input.now,
    lastErrorCode: firstPendingErrorCode(input),
    nextAttemptAt: nextAttemptAt(input.now),
    ...(input.cleanup.privyCompletedAt || !isTerminalVendorDeletion(input.privyUser)
      ? {}
      : { privyCompletedAt: input.now }),
    ...(input.cleanup.stripeCompletedAt || !isTerminalVendorDeletion(input.stripeCustomer)
      ? {}
      : { stripeCompletedAt: input.now }),
  };
}

async function decryptCleanupPayload(
  cleanup: HostedAccountDeletionCleanup,
): Promise<HostedAccountDeletionCleanupPayload> {
  const config = getHostedWebCryptoConfig();
  if (cleanup.environment !== config.env) {
    throw new TypeError("Hosted account deletion cleanup environment does not match.");
  }
  const decrypted = await config.gcpKms.decrypt({
    additionalAuthenticatedData: buildCleanupAad({
      environment: cleanup.environment,
      id: cleanup.id,
    }),
    ciphertext: cleanup.payloadCiphertext,
    keyName: cleanup.kmsKeyName,
  });
  const parsed: unknown = JSON.parse(new TextDecoder().decode(decrypted.plaintext));
  return parseCleanupPayload(parsed);
}

function parseCleanupPayload(value: unknown): HostedAccountDeletionCleanupPayload {
  if (!isRecord(value) || value.schema !== HOSTED_ACCOUNT_DELETION_CLEANUP_SCHEMA) {
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
    privyUserId: normalizeOptionalIdentifier(value.privyUserId, "Privy user"),
    runtimeMemberIds,
    schema: HOSTED_ACCOUNT_DELETION_CLEANUP_SCHEMA,
    stripeCustomerIds: uniqueIdentifiers(value.stripeCustomerIds, "Stripe customer"),
  };
}

async function deleteHostedRunnerData(
  runtimeMemberIds: readonly string[],
): Promise<HostedRunnerUserDataDeletionBestEffortResult> {
  const results = await Promise.all(runtimeMemberIds.map((userId) =>
    deleteHostedRunnerUserDataBestEffort({
      context: "account-deletion-cleanup",
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

  let firstFailure: HostedAccountVendorDeletionResult | null = null;
  for (const stripeCustomerId of stripeCustomerIds) {
    try {
      await stripe.customers.del(stripeCustomerId);
    } catch (error) {
      if (isStripeResourceMissingError(error)) {
        continue;
      }
      logHostedStripeFailure({
        error,
        operationName: "customers.del.account-deletion-cleanup",
      });
      firstFailure ??= {
        errorCode: safeCleanupErrorCode(error),
        status: "failed",
      };
    }
  }

  return firstFailure ?? { errorCode: null, status: "completed" };
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
      : { errorCode: safeCleanupErrorCode(error), status: "failed" };
  }
}

function mergeCloudflareDeletionResults(
  results: readonly HostedRunnerUserDataDeletionBestEffortResult[],
): HostedRunnerUserDataDeletionBestEffortResult {
  return {
    alarmCleared: mergeNullableBooleans(results.map((result) => result.alarmCleared)),
    configured: results.some((result) => result.configured),
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

function completedCleanupResult(): HostedAccountDeletionCleanupRunResult {
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
    deleted: true,
    errorCode: null,
    r2DeletedObjectCount: null,
    r2SkippedUserScopedPrefixes: false,
    r2Supported: true,
    r2UserScopedSkipReason: null,
    runnerStateDeleted: true,
  };
}

function completedOrSkippedVendorResult(
  hadRecord: boolean,
): HostedAccountVendorDeletionResult {
  return hadRecord
    ? { errorCode: null, status: "completed" }
    : { errorCode: null, status: "skipped_no_record" };
}

function hasCompletedAllTargets(cleanup: HostedAccountDeletionCleanup): boolean {
  return cleanup.cloudflareCompletedAt !== null
    && cleanup.stripeCompletedAt !== null
    && cleanup.privyCompletedAt !== null;
}

function isTerminalVendorDeletion(result: HostedAccountVendorDeletionResult): boolean {
  return result.status === "completed" || result.status === "skipped_no_record";
}

function firstPendingErrorCode(input: {
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
  for (const result of [input.stripeCustomer, input.privyUser]) {
    if (!isTerminalVendorDeletion(result)) {
      return result.errorCode
        ?? (result.status === "skipped_not_configured"
          ? "VENDOR_NOT_CONFIGURED"
          : "VENDOR_DELETION_INCOMPLETE");
    }
  }
  return null;
}

function nextAttemptAt(now: Date): Date {
  return new Date(now.getTime() + HOSTED_ACCOUNT_DELETION_CLEANUP_RETRY_MS);
}

function buildCleanupAad(input: { environment: string; id: string }): string {
  return JSON.stringify({
    environment: input.environment,
    id: input.id,
    schema: HOSTED_ACCOUNT_DELETION_CLEANUP_SCHEMA,
  });
}

function uniqueIdentifiers(values: readonly unknown[], label: string): string[] {
  if (values.length > HOSTED_ACCOUNT_DELETION_CLEANUP_IDENTIFIER_MAX) {
    throw new TypeError(`Hosted account deletion cleanup has too many ${label} identifiers.`);
  }
  return [...new Set(values.map((value) => {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) {
      throw new TypeError(`Hosted account deletion cleanup ${label} identifier is invalid.`);
    }
    return value.trim();
  }))];
}

function normalizeOptionalIdentifier(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return uniqueIdentifiers([value], label)[0] ?? null;
}

function normalizeDate(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new TypeError("Hosted account deletion cleanup time must be valid.");
  }
  return value;
}

function isStripeResourceMissingError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  const type = error.type;
  return error.code === "resource_missing"
    && typeof type === "string"
    && type.startsWith("Stripe");
}

function isExplicitResourceMissingError(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }
  const status = error.status ?? error.statusCode;
  const code = error.code;
  return status === 404
    || code === "NOT_FOUND"
    || code === "not_found"
    || code === "resource_missing";
}

function safeCleanupErrorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string") {
    return sanitizeHostedRuntimeErrorCode(error.code) ?? "ERROR";
  }
  if (error instanceof Error) {
    return sanitizeHostedRuntimeErrorCode(error.name) ?? "ERROR";
  }
  return "UNKNOWN_ERROR";
}

function mergeNullableBooleans(values: readonly (boolean | null)[]): boolean | null {
  const present = values.filter((value): value is boolean => value !== null);
  return present.length === 0 ? null : present.every(Boolean);
}

function mergeNullableAnyBooleans(values: readonly (boolean | null)[]): boolean | null {
  const present = values.filter((value): value is boolean => value !== null);
  return present.length === 0 ? null : present.some(Boolean);
}

function sumNullableNumbers(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length === 0
    ? null
    : present.reduce((sum, value) => sum + value, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
