import "server-only";

import { formatTimeZoneDateTimeParts } from "@murphai/contracts";
import { isSourceRecoveryNoticeEligible } from "@murphai/device-syncd/source-staleness";
import { Prisma, type PrismaClient } from "@prisma/client";

import {
  APPLE_PUSH_TOPICS,
  prepareApplePushProviderToken,
  readApplePushCredentials,
  sendApplePush,
  type ApplePushResult,
  type ApplePushTarget,
} from "../apple-push/send";
import { companionPushRouteRegistrationSchema, forgetCompanionPushRoute } from "../companion/push-route";
import { readActiveHostedMemberAccess, readActiveHostedMemberAccessIds } from "../hosted-onboarding/member-access";
import { lockHostedMemberRow } from "../hosted-onboarding/shared";
import { HOSTED_HEALTH_DATA_CONSENT_SCOPE } from "../legal/consent";
import { getPrisma } from "../prisma";

/**
 * The phone uploads Apple Health data only while the Murph app is alive. When a
 * member's Apple Health has delivered nothing for a day and the app has made no
 * contact either, this sends the same "Open Murph" notice the app posts locally
 * when it is quit. It runs on wall time from a Vercel cron, wakes no runner,
 * and observes only: it never changes a source's status.
 *
 * Sources that never delivered are left out. A connect that never streamed is
 * a setup failure, and reopening the app is the wrong advice for it.
 */

/**
 * The identifier and thread of the app's local notice. iOS gives a remote
 * notification its `apns-collapse-id` as identifier, so the app's own clear on
 * open removes this push too, and a newer notice replaces an older one.
 */
export const APPLE_HEALTH_REOPEN_NOTIFICATION_ID = "murph.sync-interruption-reminder";
export const APPLE_HEALTH_REOPEN_PUSH_TITLE = "Open Murph";
export const APPLE_HEALTH_REOPEN_PUSH_BODY = "Reopen Murph so your data can stay up to date.";

/**
 * Days of silence at which one push goes out: daily for three days, then
 * weekly. Nothing follows the last, so an episode goes quiet until data
 * arrives again. A silence first seen past the last day gets that one step.
 */
export const APPLE_HEALTH_REOPEN_PUSH_DAYS = [1, 2, 3, 10, 17, 24] as const;

const SOURCE_PROVIDER_SLUG = "apple_health_kit";
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
/** Silence before the first push, the gap between two pushes, and how long after app contact none is sent. */
const QUIET_MS = DAY_MS;
/** Local hours a push may land in. */
const SEND_HOURS = { start: 9, end: 21 };
/** With no known time zone: inside 9am to 9pm from US Pacific through Central Europe, all year. */
const UNKNOWN_ZONE_SEND_HOURS_UTC = { start: 17, end: 19 };
const PAGE_SIZE = 200;
const SWEEP_BUDGET_MS = 20_000;
const MEMBER_LOCK_TIMEOUT_MS = 2_000;
const CLAIM_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 10_000 };

export type AppleHealthReopenPushOutcome = ApplePushResult | "superseded";

export interface AppleHealthReopenPushSweep {
  /** False when Apple push credentials are absent: nothing is claimed or sent. */
  configured: boolean;
  claimed: number;
  errors: number;
  failed: number;
  sent: number;
  superseded: number;
  unregistered: number;
}

interface DueMember {
  environment: string;
  episodeStartedAt: Date;
  memberId: string;
  reopenReminders: boolean | null;
  step: number;
  timeZone: string | null;
  token: string;
  topic: string;
  /** The member's own "wait N days" for Apple Health check-ins, when set. */
  waitDays: number | null;
}

interface Claim {
  episodeStartedAt: Date;
  memberId: string;
  step: number;
  target: ApplePushTarget;
}

type ReadClient = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * One sweep. Members are nominated in SQL with every gate that needs no second
 * read, so an episode whose step is already claimed never reaches a
 * transaction. Each due member is then claimed under the member lock, and
 * checked once more just before Apple is called.
 */
export async function sendDueAppleHealthReopenPushes(input: {
  now?: Date;
  prisma?: PrismaClient;
  signal?: AbortSignal;
} = {}): Promise<AppleHealthReopenPushSweep> {
  const sweep: AppleHealthReopenPushSweep = {
    configured: readApplePushCredentials() !== null,
    claimed: 0, errors: 0, failed: 0, sent: 0, superseded: 0, unregistered: 0,
  };
  // A missing key is the kill switch. Claiming here would spend steps on pushes that cannot go out.
  if (!sweep.configured) return sweep;
  const prisma = input.prisma ?? getPrisma();
  const startedAtMs = Date.now();
  const firstNow = input.now ?? new Date(startedAtMs);
  // Real elapsed time on top of the sweep's clock, so a long sweep does not judge late members by a stale instant.
  const clock = () => new Date(firstNow.getTime() + Date.now() - startedAtMs);
  const stopped = () => input.signal?.aborted === true || Date.now() - startedAtMs >= SWEEP_BUDGET_MS;
  let after = "";
  while (!stopped()) {
    const page = await readDueMembers(prisma, { after, now: clock() });
    if (page.length === 0) break;
    after = page[page.length - 1]!.memberId;
    const ready = page.filter((member) => isReadyNow(member, clock()));
    const access = await readActiveHostedMemberAccessIds({ memberIds: ready.map((member) => member.memberId), now: clock(), prisma });
    for (const member of ready) {
      if (stopped()) break;
      // Without hosted access the runner never applies data, so no reopening could end the silence.
      if (!access.has(member.memberId)) continue;
      try {
        const outcome = await claimAndSend(prisma, member.memberId, clock);
        if (!outcome) continue;
        sweep.claimed += 1;
        sweep[outcome] += 1;
      } catch {
        // One member's lock wait or database error must not stop the rest.
        sweep.errors += 1;
      }
    }
    if (page.length < PAGE_SIZE) break;
  }
  if (sweep.claimed > 0 || sweep.errors > 0) {
    console.info("Apple Health reopen push sweep finished.", { ...sweep });
  }
  return sweep;
}

async function claimAndSend(
  prisma: PrismaClient,
  memberId: string,
  clock: () => Date,
): Promise<AppleHealthReopenPushOutcome | null> {
  const claim = await prisma.$transaction(async (tx): Promise<Claim | null> => {
    // The lock heartbeats, companion registration and the text preference take, so none of them can change under the claim.
    await lockHostedMemberRow(tx, memberId, { timeoutMs: MEMBER_LOCK_TIMEOUT_MS });
    const now = clock();
    const [due] = await readDueMembers(tx, { memberId, now });
    const ready = due ? readReady(due, now) : null;
    if (!due || !ready || !(await readActiveHostedMemberAccess({ memberId, now, prisma: tx }))) return null;
    const created = await tx.appleHealthReopenPush.createMany({
      // The sweep's clock, not the database default: the daily gap is measured on the same clock that set it.
      data: [{ createdAt: now, episodeStartedAt: due.episodeStartedAt, outcome: "claimed", step: due.step, userId: memberId }],
      skipDuplicates: true,
    });
    return created.count === 1
      ? { episodeStartedAt: due.episodeStartedAt, memberId, step: due.step, target: ready.target }
      : null;
  }, CLAIM_TRANSACTION_OPTIONS);
  if (!claim) return null;
  // A claim is never released: a failed or superseded send costs this one step, and the next still goes out.
  let outcome: AppleHealthReopenPushOutcome = "failed";
  try {
    outcome = await deliver(prisma, claim, clock);
  } finally {
    await prisma.appleHealthReopenPush.updateMany({
      data: { outcome },
      where: { episodeStartedAt: claim.episodeStartedAt, step: claim.step, userId: memberId },
    }).catch(() => { /* The claimed row still prevents a second send. */ });
  }
  return outcome;
}

/** Last look before Apple: data, app contact, the switch, a new phone or the clock may have moved since the claim. */
async function deliver(prisma: PrismaClient, claim: Claim, clock: () => Date): Promise<AppleHealthReopenPushOutcome> {
  const providerToken = await prepareApplePushProviderToken();
  if (!providerToken) return "failed";
  const now = clock();
  const [current] = await readDueMembers(prisma, { ignoreClaim: claim, memberId: claim.memberId, now });
  const ready = current ? readReady(current, now) : null;
  if (
    !current || !ready
    || current.episodeStartedAt.getTime() !== claim.episodeStartedAt.getTime()
    || current.step !== claim.step
    || ready.target.token !== claim.target.token
    || ready.target.topic !== claim.target.topic
    || ready.target.environment !== claim.target.environment
  ) {
    return "superseded";
  }
  const outcome = await sendApplePush({
    collapseId: APPLE_HEALTH_REOPEN_NOTIFICATION_ID,
    data: { notification: "reopen_reminder" },
    expiresAt: ready.expiresAt,
    message: { kind: "alert", title: APPLE_HEALTH_REOPEN_PUSH_TITLE, body: APPLE_HEALTH_REOPEN_PUSH_BODY },
    target: ready.target,
    threadId: APPLE_HEALTH_REOPEN_NOTIFICATION_ID,
    ...(ready.timeSensitive ? { interruptionLevel: "time-sensitive" as const } : {}),
  }, { providerToken });
  // Apple rejected this exact token. A newer registration is left untouched.
  if (outcome === "unregistered") await forgetCompanionPushRoute(claim.memberId, claim.target.token);
  return outcome;
}

function isReadyNow(member: DueMember, now: Date): boolean {
  return readReady(member, now) !== null;
}

/** The gates that need the clock or the member's zone, plus the address to send to. */
function readReady(
  member: DueMember,
  now: Date,
): { expiresAt: Date; target: ApplePushTarget; timeSensitive: boolean } | null {
  // One definition of a quiet source, shared with the text check-in: a source the catalog expects daily
  // data from, connected, that has delivered before. Only the wait differs: a day here, or the member's
  // own "wait N days" for Apple Health check-ins when that is longer.
  if (!isSourceRecoveryNoticeEligible({
    lastDataAt: member.episodeStartedAt.toISOString(),
    now: now.toISOString(),
    silentHours: Math.max(QUIET_MS / HOUR_MS, (member.waitDays ?? 0) * 24),
    sourceProviderSlug: SOURCE_PROVIDER_SLUG,
    status: "connected",
  })) return null;
  const expiresAt = readSendWindowEnd(now, member.timeZone);
  const target = companionPushRouteRegistrationSchema.pick({ environment: true, token: true, topic: true })
    .safeParse({ environment: member.environment, token: member.token, topic: member.topic });
  if (!expiresAt || !target.success) return null;
  // Only a build that reports the switch is known to hold the Time Sensitive entitlement.
  return { expiresAt, target: target.data, timeSensitive: member.reopenReminders === true };
}

/**
 * When today's send window closes, or null outside it. The push expires then,
 * so a phone that is off does not receive it in the night.
 */
export function readSendWindowEnd(now: Date, timeZone: string | null): Date | null {
  let hours = UNKNOWN_ZONE_SEND_HOURS_UTC;
  let minuteOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (timeZone) {
    try {
      const local = formatTimeZoneDateTimeParts(now, timeZone);
      hours = SEND_HOURS;
      minuteOfDay = local.hour * 60 + local.minute;
    } catch {
      // A zone this runtime cannot read is treated as unknown.
    }
  }
  if (minuteOfDay < hours.start * 60 || minuteOfDay >= hours.end * 60) return null;
  return new Date(now.getTime() + (hours.end * 60 - minuteOfDay) * 60_000 - now.getUTCSeconds() * 1_000 - now.getUTCMilliseconds());
}

/**
 * Members whose current step is due and unclaimed. The same statement serves
 * the page read, the locked recheck (`memberId`) and the last look before
 * sending (`ignoreClaim`), so the three cannot disagree about a gate.
 */
async function readDueMembers(db: ReadClient, input: {
  after?: string;
  ignoreClaim?: { episodeStartedAt: Date; step: number };
  memberId?: string;
  now: Date;
}): Promise<DueMember[]> {
  const quietSince = new Date(input.now.getTime() - QUIET_MS);
  // Episode = the member's newest delivery across their Apple Health sources: a second phone still sending keeps it fresh.
  const step = Prisma.join(APPLE_HEALTH_REOPEN_PUSH_DAYS.map((days) =>
    Prisma.sql`(silent.episode_started_at <= ${new Date(input.now.getTime() - days * DAY_MS)}::timestamp)::int`), " + ");
  const members = input.memberId === undefined
    ? Prisma.sql`route.user_id > ${input.after ?? ""}`
    : Prisma.sql`route.user_id = ${input.memberId}`;
  const ownClaim = input.ignoreClaim
    ? Prisma.sql`AND NOT (push.episode_started_at = ${input.ignoreClaim.episodeStartedAt}::timestamp AND push.step = ${input.ignoreClaim.step})`
    : Prisma.empty;
  return db.$queryRaw<DueMember[]>`
    WITH silent AS (
      SELECT route.user_id AS member_id, max(source.last_data_at) AS episode_started_at
      FROM companion_push_route route
      JOIN device_connection connection ON connection.user_id = route.user_id AND connection.status = 'active'
      JOIN device_connection_source source ON source.connection_id = connection.id
        AND source.source_provider_slug = ${SOURCE_PROVIDER_SLUG} AND source.status = 'connected' AND source.last_data_at IS NOT NULL
      WHERE ${members}
      GROUP BY route.user_id
      HAVING max(source.last_data_at) <= ${quietSince}::timestamp
    ), due AS (
      SELECT silent.member_id, silent.episode_started_at, (${step}) AS step FROM silent
    )
    SELECT due.member_id AS "memberId", due.episode_started_at AS "episodeStartedAt", due.step,
      route.token, route.topic, route.environment, route.reopen_reminders AS "reopenReminders",
      profile.time_zone AS "timeZone", preference.reminder_after_days AS "waitDays"
    FROM due
    JOIN companion_push_route route ON route.user_id = due.member_id
    JOIN hosted_member member ON member.id = due.member_id
    LEFT JOIN game_profile profile ON profile.member_id = due.member_id
    LEFT JOIN device_source_no_data_outreach_preference preference
      ON preference.user_id = due.member_id AND preference.source_provider_slug = ${SOURCE_PROVIDER_SLUG}
    WHERE route.alerts_allowed AND route.reopen_reminders IS NOT FALSE AND route.topic = ANY(${[...APPLE_PUSH_TOPICS]}::text[])
      AND member.suspended_at IS NULL
      AND (member.companion_last_contact_at IS NULL OR member.companion_last_contact_at <= ${quietSince}::timestamp)
      AND (preference.user_id IS NULL OR preference.reminder_after_days IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM hosted_consent_grant consent
        WHERE consent.member_id = due.member_id AND consent.scope = ${HOSTED_HEALTH_DATA_CONSENT_SCOPE} AND consent.status = 'revoked')
      AND NOT EXISTS (SELECT 1 FROM apple_health_reopen_push push
        WHERE push.user_id = due.member_id
          AND (push.created_at > ${quietSince}::timestamp OR (push.episode_started_at = due.episode_started_at AND push.step >= due.step))
          ${ownClaim})
    ORDER BY due.member_id
    LIMIT ${PAGE_SIZE}`;
}
