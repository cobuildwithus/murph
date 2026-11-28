import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeHostedNativeSessionToken } from "../src/lib/better-auth/transport";
import { readHealthWinInputs } from "../src/lib/health-wins/inputs";
import type { SessionType } from "../src/lib/health-wins/engine";
import { healthWinTextKeys } from "../src/lib/health-wins/nudge-delivery";
import { assertHealthWinTextCurrentTx, healthWinTextEgressKey } from "../src/lib/health-wins/nudge-egress";
import { drainHealthWinTexts } from "../src/lib/health-wins/nudge-job";
import { readHealthWins } from "../src/lib/health-wins/wins";
import { provisionActiveHostedDomainRootEnvelopeForUserOnly } from "../src/lib/hosted-crypto/domain-root-store";
import { readHostedMailboxWakeByDedupeKey } from "../src/lib/hosted-mailbox/store";
import { createHostedLinqChatLookupKey, createHostedPhoneLookupKey } from "../src/lib/hosted-onboarding/contact-privacy";
import { incrementHostedLinqInboundDailyState } from "../src/lib/hosted-onboarding/linq-daily-state";
import { buildHostedMemberRoutingPrivateColumns } from "../src/lib/hosted-onboarding/member-private-codecs";
import { requireHostedMemberAuthFromBearerToken } from "../src/lib/hosted-onboarding/request-auth";
import { signalHostedMailboxAppendRuntime } from "../src/lib/hosted-orchestration/signal-runtime";
import { recordHostedLaunchRequiredConsent } from "../src/lib/legal/consent";
import { getPrisma } from "../src/lib/prisma";
import { issueHostedAppSession } from "./support/hosted-auth-session";
import { localRosterCrypto, rosterPhoneIdentity, syntheticPhone } from "./support/roster-postgres";

vi.mock("../src/lib/health-wins/inputs", () => ({ readHealthWinInputs: vi.fn() }));
vi.mock("../src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: vi.fn() }));

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:localhost|127\.0\.0\.1):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Win text delivery proof requires a local test database.");
}

const db = getPrisma();
const memberId = randomUUID();
const threadId = `fixture-thread-${memberId}`;
const readOptions = { signal: new AbortController().signal };

function recordedSessions(types: SessionType[]) {
  vi.mocked(readHealthWinInputs).mockImplementation(async (_memberId, checkAuthority, today) => {
    await checkAuthority();
    const sessions = types.flatMap(type => ["02", "03", "04"].map(day => ({
      type, minutes: 16, date: `${today.slice(0, 7)}-${day}`,
    })));
    return { input: { member: { today, age: null, sex: null, wearableProvider: null }, sessions },
      milestones: [], sourceRevision: types.join("-"), complete: true, distanceArtUrl: null };
  });
}

async function seedMember() {
  localRosterCrypto();
  vi.stubEnv("MURPH_HEALTH_FEED_MEMBER_IDS", memberId);
  vi.stubEnv("MURPH_HEALTH_WIN_TEXT_MEMBER_IDS", "*");
  vi.stubEnv("MURPH_HEALTH_WINS_RANKING", "false");
  vi.stubEnv("HOSTED_BETTER_AUTH_SECRET", Buffer.alloc(32, 29).toString("base64url"));
  vi.stubEnv("HOSTED_AUTH_STORAGE_KEY", Buffer.alloc(32, 71).toString("base64url"));

  await db.hostedMember.create({ data: { id: memberId, billingStatus: "active",
    gameProfile: { create: { firstNameEncrypted: "synthetic", timeZone: "UTC" } } } });
  for (const domain of ["control", "ingress"] as const) {
    await provisionActiveHostedDomainRootEnvelopeForUserOnly({ domain, userId: memberId, prisma: db });
  }
  for (const scope of ["launch.legal", "launch.health-data"] as const) {
    await recordHostedLaunchRequiredConsent({ memberId, scope, prisma: db });
  }
  const phone = syntheticPhone(), line = syntheticPhone();
  await rosterPhoneIdentity(db, memberId, phone);
  const route = await buildHostedMemberRoutingPrivateColumns({ memberId, prisma: db, linqChatId: threadId,
    linqRecipientPhone: line, pendingLinqChatId: null, pendingLinqRecipientPhone: null, telegramThreadId: null, telegramUserId: null });
  await db.hostedMemberRouting.create({ data: { ...route, memberId, linqChatLookupKey: createHostedLinqChatLookupKey(threadId),
    linqParticipantContactKind: "phone", linqParticipantContactLookupKey: createHostedPhoneLookupKey(phone),
    linqRecipientPhoneLookupKey: createHostedPhoneLookupKey(line) } });
  await db.hostedLinqChatHealth.create({ data: { linqChatLookupKey: createHostedLinqChatLookupKey(threadId)!,
    providerObservedAt: new Date(), providerUpdatedAt: new Date(), providerStatus: "healthy", isGroup: false, service: "iMessage" } });
  await incrementHostedLinqInboundDailyState({ memberId, occurredAt: new Date(), prisma: db });

  const { token } = await issueHostedAppSession({ memberId });
  return requireHostedMemberAuthFromBearerToken(new Request("https://fixture.example.test", {
    headers: { authorization: `Bearer ${serializeHostedNativeSessionToken(token)}` },
  }));
}

describe.skipIf(!enabled)("health win text delivery through PostgreSQL", () => {
  afterEach(async () => {
    vi.useRealTimers();
    await db.hostedLinqChatHealth.deleteMany({ where: { linqChatLookupKey: createHostedLinqChatLookupKey(threadId)! } });
    await db.hostedMember.deleteMany({ where: { id: memberId } });
    vi.unstubAllEnvs();
  });

  it("silently baselines, queues one fresh linked win, and rejects queued follow-ups after disablement, expiry or presentation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2032-07-10T11:00:00Z"));
    const auth = await seedMember();
    recordedSessions(["walk"]);
    const sweep = () => drainHealthWinTexts({ prisma: db });
    expect(await sweep()).toMatchObject({ claimed: 0 });
    const original = await readHealthWins(auth, readOptions);
    const mailbox = () => db.hostedMailboxItem.findMany({ where: { userId: memberId, kind: "assistant.notification.requested" } });
    const seen = () => db.healthWinNudge.findUniqueOrThrow({ where: { memberId }, select: { seenKeys: true } });
    expect((await seen()).seenKeys).toHaveLength(1);
    await sweep();
    expect(await mailbox()).toHaveLength(0);

    vi.setSystemTime(new Date("2032-07-11T11:03:00Z"));
    recordedSessions(["walk", "run", "sauna"]);
    const overlapping = await Promise.all([sweep(), sweep()]);
    expect(overlapping.map(run => run.claimed).sort()).toEqual([0, 1]);
    expect(overlapping.map(run => run.queued).sort()).toEqual([0, 1]);
    expect((await seen()).seenKeys).toHaveLength(3);
    const keys = healthWinTextKeys(memberId, "2032-07-11");
    const queued = await mailbox();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ dedupeKey: keys.mailbox, expiresAt: new Date("2032-07-11T13:30:00Z") });
    expect(signalHostedMailboxAppendRuntime).toHaveBeenCalledOnce();
    expect(await db.healthWinSet.findMany({ where: { memberId }, select: { revision: true } })).toEqual([{ revision: original.setRevision }]);

    const wake = await readHostedMailboxWakeByDedupeKey({ userId: memberId, dedupeKey: keys.mailbox, prisma: db });
    expect(wake).toMatchObject({ kind: "assistant.notification.requested", notification: {
      deliveryDedupeToken: keys.base, deliveryIdempotencyKey: keys.base, deliveryDispatchMode: "queue-only",
      route: { channel: "linq", delivery: { kind: "thread", target: threadId }, threadIsDirect: true },
      responsePolicy: { kind: "require_send_exact_text" },
    } });
    if (wake?.kind !== "assistant.notification.requested" || wake.notification.responsePolicy?.kind !== "require_send_exact_text") {
      throw new Error("Expected an exact-text wake");
    }
    const copy = wake.notification.responsePolicy.text;
    expect(copy).toMatch(/^[^\n\d—]{1,80}\?\nhttps:\/\/www\.withmurph\.ai\/wins\/[\w-]{43}$/u);
    const ref = copy.slice(copy.lastIndexOf("/") + 1);

    const check = (deliveryKey: string, at = new Date()) => db.$transaction(async tx => {
      const key = healthWinTextEgressKey(deliveryKey, memberId);
      if (!key) throw new Error("Expected health win egress");
      await assertHealthWinTextCurrentTx(tx, key, at);
    });
    const fallback = `${keys.base}:link:fallback`;
    await check(keys.base);
    await check(fallback);
    await expect(check(fallback, new Date("2032-07-11T13:30:00Z"))).rejects.toMatchObject({ httpStatus: 409 });
    vi.stubEnv("MURPH_HEALTH_WIN_TEXT_MEMBER_IDS", "");
    await expect(check(fallback)).rejects.toMatchObject({ httpStatus: 409 });
    vi.stubEnv("MURPH_HEALTH_WIN_TEXT_MEMBER_IDS", memberId);

    vi.setSystemTime(new Date("2032-07-11T11:04:00Z"));
    const presented = await readHealthWins(auth, readOptions);
    expect(presented.candidates.map(card => card.winRef)).toContain(ref);
    expect(original.candidates.map(card => card.winRef)).not.toContain(ref);
    await expect(check(fallback)).rejects.toMatchObject({ httpStatus: 409 });

    vi.setSystemTime(new Date("2032-07-12T10:12:00Z"));
    await sweep();
    expect(await mailbox()).toHaveLength(1);
  });
});
