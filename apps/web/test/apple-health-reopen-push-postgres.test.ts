import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ send: vi.fn(), credentials: vi.fn(), beforeClaim: vi.fn() }));
vi.mock("@/src/lib/apple-push/send", async original => ({
  ...await original<typeof import("@/src/lib/apple-push/send")>(), prepareApplePushProviderToken: async () => ({ issuedAt: Date.now(), value: "test-provider-token" }), sendApplePush: m.send, readApplePushCredentials: m.credentials,
}));
vi.mock("@/src/lib/hosted-onboarding/member-access", async original => {
  const actual = await original<typeof import("@/src/lib/hosted-onboarding/member-access")>();
  return { ...actual, readActiveHostedMemberAccess: async (...args: Parameters<typeof actual.readActiveHostedMemberAccess>) => {
    await m.beforeClaim();
    return actual.readActiveHostedMemberAccess(...args);
  } };
});

import type { ApplePushRequest } from "@/src/lib/apple-push/send";
import { sendDueAppleHealthReopenPushes } from "@/src/lib/device-sync/apple-health-reopen-push";
import { getPrisma } from "@/src/lib/prisma";
import { applePushWireAps } from "./support/apple-push-wire";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Reopen push proof needs a loopback test database.");
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 18:00 UTC: inside the 9am to 9pm window for a UTC profile and inside the window used when no zone is known.
const now = new Date("2026-11-10T18:00:00.000Z");
const at = (days: number, from = now) => new Date(from.getTime() + days * DAY);
const db = getPrisma();
const members: string[] = [];

interface Fixture {
  access?: boolean;
  alertsAllowed?: boolean;
  connectionStatus?: string;
  contactAt?: Date | null;
  lastDataAt?: Date | null;
  reopenReminders?: boolean | null;
  sourceStatus?: string;
  suspended?: boolean;
  timeZone?: string | null;
}

/** A member whose phone last sent Apple Health data 25 hours before `now`, unless told otherwise. */
async function member(fixture: Fixture = {}) {
  const id = `hbm_reopen_${randomUUID()}`;
  members.push(id);
  await db.hostedMember.create({ data: {
    id, billingStatus: fixture.access === false ? "not_started" : "active",
    companionLastContactAt: fixture.contactAt === undefined ? at(-2) : fixture.contactAt,
    suspendedAt: fixture.suspended ? now : null,
  } });
  const connectionId = `dc_${randomUUID()}`;
  await db.deviceConnection.create({ data: {
    id: connectionId, userId: id, provider: "junction", providerAccountBlindIndex: randomUUID(),
    status: fixture.connectionStatus ?? "active", connectedAt: at(-90),
  } });
  await source(connectionId, fixture.lastDataAt === undefined ? new Date(now.getTime() - 25 * HOUR) : fixture.lastDataAt, fixture.sourceStatus);
  await db.companionPushRoute.create({ data: {
    userId: id, installationId: randomUUID(), token: "ab".repeat(32), topic: "ai.withmurph.app", environment: "production",
    alertsAllowed: fixture.alertsAllowed ?? true, reopenReminders: fixture.reopenReminders ?? null, updatedAt: at(-2),
  } });
  if (fixture.timeZone !== null) {
    await db.gameProfile.create({ data: { memberId: id, firstNameEncrypted: "unused", timeZone: fixture.timeZone ?? "UTC" } });
  }
  return { id, connectionId };
}
function source(connectionId: string, lastDataAt: Date | null, status = "connected") {
  return db.deviceConnectionSource.create({ data: {
    id: `dcs_${randomUUID()}`, connectionId, sourceInstanceKey: randomUUID(), sourceProviderSlug: "apple_health_kit",
    status, firstSeenAt: at(-90), lastSeenAt: now, lastDataAt,
  } });
}
const delivered = (connectionId: string, lastDataAt: Date) =>
  db.deviceConnectionSource.updateMany({ where: { connectionId }, data: { lastDataAt } });
const rows = (memberId: string) => db.appleHealthReopenPush.findMany({ where: { userId: memberId }, orderBy: { step: "asc" } });
const sweep = (when = now) => sendDueAppleHealthReopenPushes({ now: when });
const sent = () => m.send.mock.calls.map(([request]) => request as ApplePushRequest);

describe.skipIf(!enabled)("Apple Health reopen push PostgreSQL", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.send.mockResolvedValue("sent");
    m.credentials.mockReturnValue({});
  });
  afterEach(async () => {
    const ids = members.splice(0);
    await db.deviceSourceNoDataOutreachPreference.deleteMany({ where: { userId: { in: ids } } });
    await db.deviceConnection.deleteMany({ where: { userId: { in: ids } } });
    await db.hostedMember.deleteMany({ where: { id: { in: ids } } });
  });

  it("sends the app's own notice once after a day of silence and records the send", async () => {
    const { id } = await member();
    expect(await sweep()).toMatchObject({ configured: true, claimed: 1, sent: 1 });
    expect(sent()).toEqual([{
      collapseId: "murph.sync-interruption-reminder", threadId: "murph.sync-interruption-reminder",
      data: { notification: "reopen_reminder" },
      message: { kind: "alert", title: "Open Murph", body: "Reopen Murph so your data can stay up to date." },
      target: { environment: "production", token: "ab".repeat(32), topic: "ai.withmurph.app" },
      // The window closes at 9pm in the member's zone, and the push dies with it.
      expiresAt: new Date("2026-11-10T21:00:00.000Z"),
    }]);
    // No interruption level unless the build reported the entitlement; the sound is the sender's own.
    expect(await applePushWireAps(sent()[0]!)).toEqual({
      alert: { title: "Open Murph", body: "Reopen Murph so your data can stay up to date." },
      "content-available": 1, sound: "default", "thread-id": "murph.sync-interruption-reminder",
    });
    expect(await rows(id)).toMatchObject([{ step: 1, outcome: "sent", episodeStartedAt: new Date(now.getTime() - 25 * HOUR) }]);
    expect(await sweep(new Date(now.getTime() + 15 * 60_000))).toMatchObject({ claimed: 0, sent: 0 });
    expect(m.send).toHaveBeenCalledOnce();
  });

  it("pushes daily for three days, weekly through day 24, then stops until data arrives", async () => {
    const { id, connectionId } = await member({ lastDataAt: at(-1) });
    const pushedOn: number[] = [];
    for (let day = 0; day <= 60; day += 1) {
      // One sweep a day, a minute later each day so the daily gap has always passed.
      if ((await sweep(at(day, new Date(now.getTime() + HOUR + day * 60_000)))).sent === 1) pushedOn.push(day + 1);
    }
    expect(pushedOn).toEqual([1, 2, 3, 10, 17, 24]);
    expect((await rows(id)).map(row => row.outcome)).toEqual(Array(6).fill("sent"));
    // New data ends the episode. A day of new silence starts the schedule over.
    await delivered(connectionId, at(61));
    expect((await sweep(at(61.5))).sent).toBe(0);
    expect((await sweep(at(62.05))).sent).toBe(1);
    expect(await rows(id)).toHaveLength(7);
  });

  it("gives a silence first seen past day 30 one push, never a catch-up series", async () => {
    const { id } = await member({ lastDataAt: at(-70) });
    expect((await sweep()).sent).toBe(1);
    for (const day of [1, 2, 7, 30]) expect((await sweep(at(day))).sent).toBe(0);
    expect(await rows(id)).toMatchObject([{ step: 6, outcome: "sent" }]);
  });

  it.each<[string, Fixture, Date?]>([
    ["a source that never delivered", { lastDataAt: null }],
    ["a source that is not connected", { sourceStatus: "disconnected" }],
    ["a connection that is not active", { connectionStatus: "disconnected" }],
    ["under a day of silence", { lastDataAt: new Date(now.getTime() - 23 * HOUR) }],
    ["alerts the phone does not allow", { alertsAllowed: false }],
    ["the reopen reminders switch turned off", { reopenReminders: false }],
    ["a suspended member", { suspended: true }],
    ["a member without hosted access", { access: false }],
    ["an app that made contact in the last day", { contactAt: new Date(now.getTime() - 2 * HOUR) }],
    ["the member's night", { timeZone: "Asia/Tokyo" }],
    ["an unknown zone outside the shared daytime window", { timeZone: null, lastDataAt: at(-3) }, new Date("2026-11-10T12:00:00.000Z")],
  ])("sends nothing and claims nothing for %s", async (_name, fixture, when = now) => {
    const { id } = await member(fixture);
    expect(await sweep(when)).toMatchObject({ claimed: 0, sent: 0, errors: 0 });
    expect(m.send).not.toHaveBeenCalled();
    expect(await rows(id)).toEqual([]);
  });

  it("uses the shared daytime window when no time zone is known and falls back from an unreadable one", async () => {
    await member({ timeZone: null });
    await member({ timeZone: "Not/AZone" });
    expect((await sweep()).sent).toBe(2);
    expect(sent().map(request => request.expiresAt)).toEqual([new Date("2026-11-10T19:00:00.000Z"), new Date("2026-11-10T19:00:00.000Z")]);
  });

  it("stays quiet while a second phone is still delivering", async () => {
    const { connectionId } = await member();
    await source(connectionId, new Date(now.getTime() - HOUR));
    expect((await sweep()).sent).toBe(0);
  });

  it("respects revoked health consent and the member's text choices about Apple Health check-ins", async () => {
    const revoked = await member(), stopped = await member(), waiting = await member({ lastDataAt: at(-4) });
    await db.hostedConsentGrant.create({ data: { memberId: revoked.id, scope: "launch.health-data", status: "revoked",
      documentVersionsJson: {}, source: "test", grantedAt: at(-30), revokedAt: at(-3) } });
    await db.deviceSourceNoDataOutreachPreference.createMany({ data: [
      { userId: stopped.id, sourceProviderSlug: "apple_health_kit", reminderAfterDays: null },
      { userId: waiting.id, sourceProviderSlug: "apple_health_kit", reminderAfterDays: 5 },
    ] });
    expect(await sweep()).toMatchObject({ claimed: 0, sent: 0 });
    // "Wait five days" delays the first push to day five, where the schedule is on its third step.
    expect((await sweep(at(1.01))).sent).toBe(1);
    expect(await rows(waiting.id)).toMatchObject([{ step: 3 }]);
    expect(await rows(revoked.id)).toEqual([]);
    expect(await rows(stopped.id)).toEqual([]);
  });

  it("marks the push Time Sensitive only for a build that reported the switch", async () => {
    await member({ reopenReminders: true });
    await sweep();
    expect(sent()[0]).toMatchObject({ interruptionLevel: "time-sensitive" });
  });

  it("sends once when two sweeps overlap", async () => {
    const { id } = await member();
    const results = await Promise.all([sweep(), sweep(), sweep()]);
    expect(results.reduce((total, result) => total + result.sent, 0)).toBe(1);
    expect(m.send).toHaveBeenCalledOnce();
    expect(await rows(id)).toHaveLength(1);
  });

  it("holds a member to one push a day across episodes", async () => {
    const { id } = await member();
    await db.appleHealthReopenPush.create({ data: { userId: id, episodeStartedAt: at(-9), step: 3, outcome: "sent", createdAt: new Date(now.getTime() - 23 * HOUR) } });
    expect((await sweep()).sent).toBe(0);
    expect((await sweep(new Date(now.getTime() + 61 * 60_000))).sent).toBe(1);
  });

  it("drops the push when data arrives between the claim and the send, and keeps the claim", async () => {
    const { id, connectionId } = await member();
    m.beforeClaim.mockImplementationOnce(async () => { await delivered(connectionId, now); });
    expect(await sweep()).toMatchObject({ claimed: 1, sent: 0, superseded: 1 });
    expect(m.send).not.toHaveBeenCalled();
    expect(await rows(id)).toMatchObject([{ step: 1, outcome: "superseded" }]);
  });

  it("drops the push when the phone's address changes between the claim and the send", async () => {
    const { id } = await member();
    m.beforeClaim.mockImplementationOnce(async () => {
      await db.companionPushRoute.update({ where: { userId: id }, data: { token: "cd".repeat(32) } });
    });
    expect(await sweep()).toMatchObject({ sent: 0, superseded: 1 });
    expect(m.send).not.toHaveBeenCalled();
  });

  it("forgets a token Apple no longer knows and records the outcome", async () => {
    const { id } = await member();
    m.send.mockResolvedValue("unregistered");
    expect(await sweep()).toMatchObject({ claimed: 1, unregistered: 1 });
    expect(await db.companionPushRoute.findUnique({ where: { userId: id } })).toBeNull();
    expect(await rows(id)).toMatchObject([{ outcome: "unregistered" }]);
  });

  it("spends the step on a failed send and still sends the next one", async () => {
    const { id } = await member();
    m.send.mockResolvedValueOnce("failed");
    expect(await sweep()).toMatchObject({ claimed: 1, failed: 1, sent: 0 });
    expect((await sweep(new Date(now.getTime() + 15 * 60_000))).claimed).toBe(0);
    expect((await sweep(new Date(at(1).getTime() + 60_000))).sent).toBe(1);
    expect((await rows(id)).map(row => [row.step, row.outcome])).toEqual([[1, "failed"], [2, "sent"]]);
  });

  it("claims nothing while Apple push credentials are absent", async () => {
    const { id } = await member();
    m.credentials.mockReturnValue(null);
    expect(await sweep()).toMatchObject({ configured: false, claimed: 0 });
    expect(await rows(id)).toEqual([]);
  });
});
