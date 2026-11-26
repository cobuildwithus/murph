import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import { buildHostedExecutionAssistantNotificationRequestedWake } from "@murphai/hosted-execution";
import { runWithHostedDomainRootProviderCallsDisabled } from "../hosted-crypto/domain-root-unwrap-cache";
import { appendHostedMailboxEnvelopeWithPreparedCryptoTx, runWithPreparedHostedMailboxItemAppendCrypto,
  type PreparedHostedMailboxItemAppendCrypto } from "../hosted-mailbox/store";
import { renderUserFacingMessage } from "../hosted-messages/user-facing-messages";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { hasHostedLinqInboundWithinDays } from "../hosted-onboarding/linq-daily-state";
import { readHostedLinqChatHealth } from "../hosted-onboarding/linq-provider-health-store";
import { HOSTED_ONBOARDING_TRANSACTION_OPTIONS, lockHostedMemberRow } from "../hosted-onboarding/shared";
import { isHostedLinqIMessageService } from "../hosted-onboarding/webhook-provider-linq-shared";
import { signalHostedMailboxAppendRuntime } from "../hosted-orchestration/signal-runtime";
import { resolveHostedAssistantNotificationDestination } from "../hosted-routing/assistant-notification-destination";
import { getPrisma } from "../prisma";
import { MURPH_PUBLIC_SITE_URL } from "../site-metadata";
import { readHealthWinIdentities, type HealthWinObservations } from "./achievement";
import { readHealthWinDetection } from "./detection";
import { healthWinTextMemberIds } from "./flag";
import { assertHealthWinTextAuthority } from "./nudge-authority";
import { healthWinTextKeys, healthWinTextWindow } from "./nudge-delivery";
import { isHealthWinTextPaused } from "./nudge-pause";
import { claimHealthWinDayTx, finishHealthWinEvaluationTx } from "./nudge-state";

const MAX_CLAIMS = 25;
const SWEEP_BUDGET_MS = 240_000;
type Claim = { memberId: string; day: string; startedAt: Date };
type Tx = Prisma.TransactionClient;

async function directRoute(prisma: Tx, memberId: string, signal: AbortSignal) {
  const destination = await resolveHostedAssistantNotificationDestination({ directChannel: "linq", memberId, prisma, signal });
  if (destination?.conversationShape !== "direct-member" || destination.externalThreadRouteAuthority !== null
    || destination.route.channel !== "linq" || destination.route.threadIsDirect !== true
    || destination.route.delivery.kind !== "thread") return null;
  const health = await readHostedLinqChatHealth({ chatId: destination.route.delivery.target, prisma });
  return health?.isGroup !== true && isHostedLinqIMessageService(health?.service) ? destination.route : null;
}

async function checkDelivery(prisma: Tx, claim: Claim, signal: AbortSignal) {
  signal.throwIfAborted();
  const { memberId, day } = claim;
  await assertHealthWinTextAuthority({ memberId, prisma });
  const now = new Date();
  if (!await hasHostedLinqInboundWithinDays({ memberId, now, prisma })) return null;
  if (await isHealthWinTextPaused(prisma, memberId, now)) return null;
  const keys = healthWinTextKeys(memberId, day);
  const existing = await prisma.hostedMailboxItem.findUnique({
    where: { userId_dedupeKey: { userId: memberId, dedupeKey: keys.mailbox } }, select: { id: true },
  });
  if (existing) return null;
  const route = await directRoute(prisma, memberId, signal);
  const profile = await prisma.gameProfile.findUnique({ where: { memberId }, select: { timeZone: true } });
  const window = profile && healthWinTextWindow(new Date(), profile.timeZone);
  return route && window?.day === day ? { route, expiresAt: window.expiresAt, keys } : null;
}

async function finishEvaluation(tx: Tx, claim: Claim, observations: HealthWinObservations,
  prepared: PreparedHostedMailboxItemAppendCrypto, signal: AbortSignal) {
  await lockHostedMemberRow(tx, claim.memberId, { noKeyUpdate: true });
  // The row lock covers both consuming every unseen key and appending the best fresh one.
  const winRef = await finishHealthWinEvaluationTx(tx, { ...claim, observations });
  // Authority loss rolls back suppression history too, even for a silent baseline.
  if (!winRef) {
    await assertHealthWinTextAuthority({ memberId: claim.memberId, prisma: tx });
    return null;
  }
  const dispatch = await checkDelivery(tx, claim, signal);
  if (!dispatch) return null;
  signal.throwIfAborted();
  const { keys, expiresAt, route } = dispatch;
  const { text } = renderUserFacingMessage({ key: "linq.health_win", seed: keys.base,
    context: { winUrl: `${MURPH_PUBLIC_SITE_URL}/wins/${winRef}` } });
  return appendHostedMailboxEnvelopeWithPreparedCryptoTx({
    envelope: buildHostedExecutionAssistantNotificationRequestedWake({
      eventId: keys.mailbox, memberId: claim.memberId, occurredAt: claim.startedAt.toISOString(),
      notification: {
        deliveryDedupeToken: keys.base, deliveryIdempotencyKey: keys.base, deliveryDispatchMode: "queue-only",
        instructions: "Send the exact win notice in responsePolicy.", responsePolicy: { kind: "require_send_exact_text", text }, route,
      },
    }), expiresAt, prepared, tx,
  });
}

async function evaluate(prisma: PrismaClient, claim: Claim, signal: AbortSignal, computeTimes: number[]) {
  const { memberId, day } = claim;
  if (!await checkDelivery(prisma, claim, signal)) return "ineligible";
  const start = performance.now();
  const result = await readHealthWinDetection({ memberId, today: day, signal,
    checkAuthority: () => assertHealthWinTextAuthority({ memberId, prisma }) });
  const detection = result?.complete ? result.detect() : null;
  computeTimes.push(Math.round(performance.now() - start));
  if (!detection) return "incomplete";
  const { cards, achievements } = detection;
  const descriptors = cards.flatMap(card => achievements.get(card.id) ?? []);
  const observations = readHealthWinIdentities(memberId, descriptors, day);
  if (!observations) return "unavailable";
  if (!observations.items.length) return "suppressed";

  const appended = await runWithPreparedHostedMailboxItemAppendCrypto({
    userId: memberId, prisma, signal,
    // Warm exact route roots outside the lock. A concurrent rotation can only retry preparation.
    prepareExisting: async () => { await directRoute(prisma, memberId, signal); },
    append: prepared => runWithHostedDomainRootProviderCallsDisabled(() => prisma.$transaction(
      tx => finishEvaluation(tx, claim, observations, prepared, signal),
      { ...HOSTED_ONBOARDING_TRANSACTION_OPTIONS, timeout: 10_000 },
    )),
  });
  if (!appended?.inserted) return "suppressed";
  const { item } = appended;
  try {
    await signalHostedMailboxAppendRuntime({ abortSignal: signal, expectedUserId: memberId, mailboxItemId: item.id, prisma,
      knownCheckpoint: { lane: item.lane, laneSeq: item.laneSeq, userId: memberId } });
  } catch {
    // The committed item is eligible for the existing runtime handoff sweep until expiry.
  }
  return "queued";
}

/** Founder-only sweep. Only a composer can create the enrollment row. */
export async function drainHealthWinTexts(input: { prisma?: PrismaClient; signal?: AbortSignal } = {}) {
  const counts = { claimed: 0, queued: 0, suppressed: 0, incomplete: 0, ineligible: 0, unavailable: 0, errors: 0 };
  const computeTimes: number[] = [];
  const members = healthWinTextMemberIds();
  const budget = AbortSignal.timeout(SWEEP_BUDGET_MS);
  const signal = input.signal ? AbortSignal.any([budget, input.signal]) : budget;
  for (let i = 0; i < members.length && !signal.aborted && counts.claimed < MAX_CLAIMS; i += MAX_CLAIMS) {
    const prisma = input.prisma ?? getPrisma();
    const enrolled = await prisma.healthWinNudge.findMany({
      where: { memberId: { in: members.slice(i, i + MAX_CLAIMS) } }, orderBy: { memberId: "asc" },
      select: { memberId: true, lastEvaluatedDay: true, member: { select: { gameProfile: { select: { timeZone: true } } } } },
    });
    for (const { memberId, member, lastEvaluatedDay } of enrolled) {
      if (signal.aborted || counts.claimed >= MAX_CLAIMS) break;
      const startedAt = new Date();
      const window = member.gameProfile && healthWinTextWindow(startedAt, member.gameProfile.timeZone);
      if (!window || (lastEvaluatedDay && lastEvaluatedDay >= window.day)) continue;
      const claim = { memberId, day: window.day, startedAt };
      try {
        if (!await prisma.$transaction(tx => claimHealthWinDayTx(tx, claim))) continue;
        counts.claimed++;
        counts[await evaluate(prisma, claim, signal, computeTimes)]++;
      } catch (error) {
        // A failed evaluation consumes the day. Keep only aggregate diagnostics.
        if (isHostedOnboardingError(error) && [401, 403].includes(error.httpStatus)) counts.ineligible++;
        else counts.errors++;
      }
    }
  }
  computeTimes.sort((a, b) => a - b);
  const percentile = (p: number) => computeTimes[Math.ceil(computeTimes.length * p) - 1] ?? null;
  return { ...counts, computed: computeTimes.length, computeP50Ms: percentile(0.5), computeP95Ms: percentile(0.95) };
}
