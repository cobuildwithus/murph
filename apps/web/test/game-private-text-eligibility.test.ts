import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const m = vi.hoisted(() => ({ access: vi.fn(), usage: vi.fn(), destination: vi.fn(), assertRoute: vi.fn() }));
vi.mock("@/src/lib/hosted-onboarding/member-access", async original => ({
  ...await original<typeof import("@/src/lib/hosted-onboarding/member-access")>(), readHostedRuntimeAiAccessDecision: m.access,
}));
vi.mock("@/src/lib/hosted-orchestration/runtime-usage-decision", async original => ({
  ...await original<typeof import("@/src/lib/hosted-orchestration/runtime-usage-decision")>(), resolveHostedRuntimeAiUsageGate: m.usage,
}));
vi.mock("@/src/lib/hosted-routing/assistant-notification-destination", async original => ({
  ...await original<typeof import("@/src/lib/hosted-routing/assistant-notification-destination")>(),
  resolveHostedAssistantNotificationDestination: m.destination, assertHostedDirectAssistantNotificationRouteAuthority: m.assertRoute,
}));

import { canTextGameReminders, readGameReminders, runGameCommand } from "@/src/lib/game/service";
import { getPrisma } from "@/src/lib/prisma";

const route = { actorId: null, channel: "linq", delivery: { kind: "thread", target: "synthetic-chat" },
  identityId: "synthetic-identity", threadId: "synthetic-chat", threadIsDirect: true };

describe("private game text eligibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MURPH_GAME_PRIVATE_REMINDERS_ENABLED", "true");
    m.access.mockResolvedValue({ allowed: true });
    m.usage.mockResolvedValue({ status: "allowed" });
    m.destination.mockResolvedValue({ conversationShape: "direct-member", route });
    m.assertRoute.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("requires the exact flag, AI access, usage, an existing direct thread, and deliverable route", async () => {
    const memberId = "member-synthetic";
    expect(await canTextGameReminders(memberId)).toBe(true);
    expect(m.assertRoute).toHaveBeenCalledWith(expect.objectContaining({ requireThreadDelivery: true,
      authority: { channel: "linq", containerMemberId: memberId, threadId: "synthetic-chat" } }));
    vi.stubEnv("MURPH_GAME_PRIVATE_REMINDERS_ENABLED", "TRUE");
    expect(await canTextGameReminders(memberId)).toBe(false);
    vi.stubEnv("MURPH_GAME_PRIVATE_REMINDERS_ENABLED", "true");
    m.access.mockResolvedValueOnce({ allowed: false });
    expect(await canTextGameReminders(memberId)).toBe(false);
    m.usage.mockResolvedValueOnce({ status: "exhausted" });
    expect(await canTextGameReminders(memberId)).toBe(false);
    m.destination.mockResolvedValueOnce({ conversationShape: "direct-member", route: { ...route, channel: "telegram" } });
    expect(await canTextGameReminders(memberId)).toBe(false);
    m.destination.mockResolvedValueOnce(null);
    expect(await canTextGameReminders(memberId)).toBe(false);
    m.destination.mockResolvedValueOnce({ conversationShape: "thread-container", route });
    expect(await canTextGameReminders(memberId)).toBe(false);
    m.destination.mockResolvedValueOnce({ conversationShape: "direct-member", route: { ...route, threadIsDirect: false } });
    expect(await canTextGameReminders(memberId)).toBe(false);
    m.assertRoute.mockRejectedValueOnce(new Error("No deliverable thread"));
    expect(await canTextGameReminders(memberId)).toBe(false);
  });
});

const databaseEnabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (databaseEnabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test(?:_[a-z0-9_]+)?$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Private text proof needs a loopback test database.");
describe.skipIf(!databaseEnabled)("private game text setting PostgreSQL", () => {
  const db = getPrisma();
  const memberId = `hbm_game_text_${randomUUID()}`;
  beforeEach(async () => {
    vi.clearAllMocks(); vi.stubEnv("MURPH_GAME_PRIVATE_REMINDERS_ENABLED", "true");
    m.access.mockResolvedValue({ allowed: true }); m.usage.mockResolvedValue({ status: "allowed" });
    m.destination.mockResolvedValue({ conversationShape: "direct-member", route }); m.assertRoute.mockResolvedValue(undefined);
    await db.hostedMember.create({ data: { id: memberId } });
    expect(await runGameCommand({ actorMemberId: memberId, command: { type: "setProfile", firstName: "Alex", timeZone: "UTC" } })).toMatchObject({ ok: true });
  });
  afterEach(async () => {
    await db.hostedMember.delete({ where: { id: memberId } });
    vi.unstubAllEnvs();
  });
  it("accepts text only with the live gate and preserves push on a refused write", async () => {
    const choice = { type: "setReminders", minutes: 1080, push: true, text: true, offGameIds: [] };
    expect(await runGameCommand({ actorMemberId: memberId, command: choice })).toMatchObject({ ok: true, reminders: { text: true, canText: true } });
    expect(await readGameReminders(memberId)).toMatchObject({ minutes: 1080, push: true, text: true, canText: true });
    m.usage.mockResolvedValue({ status: "exhausted" });
    expect(await runGameCommand({ actorMemberId: memberId, command: { ...choice, minutes: 1200 } })).toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(await runGameCommand({ actorMemberId: memberId, command: { ...choice, text: false } })).toMatchObject({ ok: true, reminders: { text: false, push: true } });
  });
});
