import "server-only";

import { HOSTED_HEALTH_WIN_NOTIFICATION_KEY_PREFIX } from "@murphai/hosted-execution/orchestration-control";
import type { HostedExecutionResolvedLinqDeliveryRoute } from "@murphai/hosted-execution/contracts";
import type { Prisma } from "@prisma/client";
import { hostedOnboardingError, isHostedOnboardingError } from "../hosted-onboarding/errors";
import { isHostedLinqIMessageService } from "../hosted-onboarding/webhook-provider-linq-shared";
import { readHealthWinIdentities } from "./achievement";
import { isHealthWinTextEnabled } from "./flag";
import { assertHealthWinTextAuthority } from "./nudge-authority";
import { HEALTH_WIN_TEXT_MAILBOX_PREFIX, healthWinTextWindow, parseHealthWinTextKey } from "./nudge-delivery";
import { isHealthWinClaimCurrentTx } from "./nudge-state";

function staleWinText() {
  return hostedOnboardingError({ code: "HEALTH_WIN_TEXT_SUPERSEDED", httpStatus: 409,
    message: "The queued win notification is no longer current.", retryable: false });
}

/** Keep this reject-only gate on rollback while imported outbox work can still exist. */
export function healthWinTextEgressKey(value: string | null, memberId: string,
  context?: { answeredMailboxItemIds: readonly string[]; replyToMessageId: string | null; deliveryPurpose: unknown }) {
  if (value?.startsWith(HEALTH_WIN_TEXT_MAILBOX_PREFIX)) throw staleWinText();
  if (!value?.startsWith(HOSTED_HEALTH_WIN_NOTIFICATION_KEY_PREFIX)) return null;
  const key = parseHealthWinTextKey(value);
  if (!key || key.memberId !== memberId || !isHealthWinTextEnabled(memberId)) throw staleWinText();
  if (context && (context.answeredMailboxItemIds.length || context.replyToMessageId || context.deliveryPurpose)) throw staleWinText();
  return key;
}

export function assertHealthWinTextRoute(route: HostedExecutionResolvedLinqDeliveryRoute,
  health: { service: string | null; isGroup?: boolean }) {
  if (route.targetKind !== "thread" || !route.threadIsDirect || health.isGroup || !isHostedLinqIMessageService(health.service)) throw staleWinText();
}

export async function assertHealthWinTextCurrentTx(tx: Prisma.TransactionClient,
  key: NonNullable<ReturnType<typeof healthWinTextEgressKey>>, now?: Date): Promise<void> {
  const { memberId, day } = key;
  const wake = await tx.hostedMailboxItem.findUnique({ where: { userId_dedupeKey: { userId: memberId, dedupeKey: key.mailbox } },
    select: { occurredAt: true, expiresAt: true } });
  const version = readHealthWinIdentities(memberId, [], day)?.version;
  if (!wake?.expiresAt || !version || !await isHealthWinClaimCurrentTx(tx, { memberId, day, startedAt: wake.occurredAt, version })) throw staleWinText();
  try {
    await assertHealthWinTextAuthority({ memberId, prisma: tx });
  } catch (error) {
    if (isHostedOnboardingError(error) && error.httpStatus < 500) throw staleWinText();
    throw error;
  }
  const profile = await tx.gameProfile.findUnique({ where: { memberId }, select: { timeZone: true } });
  const checkedAt = now ?? new Date();
  if (!profile || wake.expiresAt <= checkedAt || healthWinTextWindow(checkedAt, profile.timeZone)?.day !== day) throw staleWinText();
}
