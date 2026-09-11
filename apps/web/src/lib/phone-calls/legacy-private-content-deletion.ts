import { Prisma, type PrismaClient } from "@prisma/client";
import { HOSTED_SCHEDULED_PHONE_CALL_REQUEST_KEY_PREFIX } from "@murphai/hosted-execution/phone-calls";

import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { getPrisma } from "../prisma";
import { isHostedPhoneCallProviderCleanupPending } from "./authority";
import {
  createRetellPhoneCallAccountDeletionRuntime,
  type RetellPhoneCallAccountDeletionRuntime,
} from "./retell-runtime";

export const HOSTED_LEGACY_PHONE_CALL_DELETION_MAX_ROWS = 8;
const DELETION_TIMEOUT_MS = 45_000;

// Do not load private JSON or ciphertext, even during an operator dry run.
const candidateSelect = {
  analyzedAt: true,
  endedAt: true,
  id: true,
  memberId: true,
  provider: true,
  providerCallId: true,
  resultDeliveryStatus: true,
  resultNotificationChannel: true,
  status: true,
  updatedAt: true,
} satisfies Prisma.HostedPhoneCallSelect;
type Candidate = Prisma.HostedPhoneCallGetPayload<{ select: typeof candidateSelect }>;

const candidateWhere: Prisma.HostedPhoneCallWhereInput = {
  briefEncrypted: null,
  resultEncrypted: null,
  originSessionId: null,
  NOT: { requestKey: { startsWith: HOSTED_SCHEDULED_PHONE_CALL_REQUEST_KEY_PREFIX } },
  OR: [
    { briefJson: { not: Prisma.AnyNull } },
    { resultJson: { not: Prisma.AnyNull } },
  ],
};

export interface HostedLegacyPhoneCallDeletionOptions {
  mode: "apply" | "dry-run";
  expectedRows?: number;
}

export function parseHostedLegacyPhoneCallDeletionOptions(
  body: Record<string, unknown>,
): HostedLegacyPhoneCallDeletionOptions {
  const mode = body.mode === undefined ? "dry-run" : body.mode;
  if (
    Object.keys(body).some((key) => key !== "mode" && key !== "expectedRows")
    || (mode !== "apply" && mode !== "dry-run")
    || (body.expectedRows !== undefined && (
      typeof body.expectedRows !== "number"
      || !Number.isInteger(body.expectedRows)
      || body.expectedRows < 0
      || body.expectedRows > HOSTED_LEGACY_PHONE_CALL_DELETION_MAX_ROWS
    ))
    || (mode === "apply" && body.expectedRows === undefined)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_LEGACY_PHONE_CALL_DELETION_REQUEST_INVALID",
      httpStatus: 400,
      message: "Use dry-run or apply with an expectedRows integer within the bounded row limit.",
    });
  }
  return {
    mode,
    ...(typeof body.expectedRows === "number" ? { expectedRows: body.expectedRows } : {}),
  };
}

interface HostedLegacyPhoneCallDeletionSummary {
  mode: "apply" | "dry-run";
  selectedRows: number;
  providerRows: number;
  deletedRows: number;
  failedRows: number;
  failureCode: "provider_cleanup_failed" | "row_revalidation_failed" | "deadline_exceeded" | null;
}

export async function deleteHostedLegacyPhoneCalls(input: {
  options: HostedLegacyPhoneCallDeletionOptions;
  prisma?: PrismaClient;
  runtime?: Pick<RetellPhoneCallAccountDeletionRuntime, "deleteProviderCall">;
  signal?: AbortSignal;
}) {
  const options = parseHostedLegacyPhoneCallDeletionOptions({ ...input.options });
  const prisma = input.prisma ?? getPrisma();
  const signal = AbortSignal.any([
    AbortSignal.timeout(DELETION_TIMEOUT_MS),
    ...(input.signal ? [input.signal] : []),
  ]);
  signal.throwIfAborted();
  const selected = await prisma.hostedPhoneCall.findMany({
    orderBy: { id: "asc" },
    select: candidateSelect,
    take: HOSTED_LEGACY_PHONE_CALL_DELETION_MAX_ROWS + 1,
    where: candidateWhere,
  });
  if (
    selected.length > HOSTED_LEGACY_PHONE_CALL_DELETION_MAX_ROWS
    || (options.expectedRows !== undefined && selected.length !== options.expectedRows)
  ) {
    throw deletionConflict("SELECTION_CHANGED");
  }

  // Validate the entire bounded selection before any external deletion.
  for (const candidate of selected) {
    signal.throwIfAborted();
    await prisma.$transaction((tx) => assertCandidateReadyTx(tx, candidate));
  }
  const summary: HostedLegacyPhoneCallDeletionSummary = {
    mode: options.mode,
    selectedRows: selected.length,
    providerRows: selected.filter((call) => call.providerCallId !== null).length,
    deletedRows: 0,
    failedRows: 0,
    failureCode: null,
  };
  if (options.mode === "dry-run") {
    return summary;
  }

  const runtime = input.runtime ?? createRetellPhoneCallAccountDeletionRuntime();
  for (const candidate of selected) {
    let providerCleanupInProgress = false;
    try {
      signal.throwIfAborted();
      await prisma.$transaction((tx) => assertCandidateReadyTx(tx, candidate));
      if (candidate.providerCallId !== null) {
        // No database transaction remains open across provider I/O. A failed or
        // uncertain provider deletion retains the row and exact retry authority.
        providerCleanupInProgress = true;
        await runtime.deleteProviderCall(candidate.providerCallId, { signal });
        providerCleanupInProgress = false;
      }
      signal.throwIfAborted();
      await prisma.$transaction(async (tx) => {
        await assertCandidateReadyTx(tx, candidate);
        const deleted = await tx.hostedPhoneCall.deleteMany({
          where: candidateSnapshotWhere(candidate),
        });
        if (deleted.count !== 1) {
          throw deletionConflict("ROW_CHANGED");
        }
      });
      summary.deletedRows += 1;
    } catch {
      // Partial progress is intentional and retryable after a fresh dry run.
      // Never serialize provider errors, identifiers, or private content.
      summary.failedRows += 1;
      summary.failureCode = signal.aborted
        ? "deadline_exceeded"
        : providerCleanupInProgress
          ? "provider_cleanup_failed"
          : "row_revalidation_failed";
      break;
    }
  }
  return summary;
}

function candidateSnapshotWhere(candidate: Candidate): Prisma.HostedPhoneCallWhereInput {
  return {
    AND: [
      candidateWhere,
      candidate,
    ],
  };
}

async function assertCandidateReadyTx(
  tx: Prisma.TransactionClient,
  candidate: Candidate,
): Promise<void> {
  // Reservations and notification append use this same member-first order.
  await lockHostedMemberRow(tx, candidate.memberId);
  const current = await tx.hostedPhoneCall.findFirst({
    select: candidateSelect,
    where: candidateSnapshotWhere(candidate),
  });
  if (!current) {
    throw deletionConflict("ROW_CHANGED");
  }
  if (
    current.provider !== "retell"
    || !["completed", "needs_user", "failed"].includes(current.status)
    || isHostedPhoneCallProviderCleanupPending(current)
    || (current.resultDeliveryStatus !== null && current.resultDeliveryStatus !== "delivered")
    || (current.resultNotificationChannel === "telegram" && current.resultDeliveryStatus !== "delivered")
  ) {
    throw deletionConflict("CALL_NOT_SETTLED");
  }
  const key = `assistant.notification.requested:phone-call-result:${candidate.id}`;
  const pending = await tx.hostedMailboxItem.findFirst({
    select: { id: true },
    where: {
      userId: candidate.memberId,
      consumedAt: null,
      OR: [{ dedupeKey: key }, { dedupeKey: { startsWith: `${key}:` } }],
    },
  });
  if (pending) {
    throw deletionConflict("NOTIFICATION_PENDING");
  }
}

function deletionConflict(reason: string) {
  return hostedOnboardingError({
    code: `HOSTED_LEGACY_PHONE_CALL_DELETION_${reason}`,
    httpStatus: 409,
    message: "Legacy phone-call deletion is blocked. Recheck the hosted operation prerequisites and dry run.",
  });
}
