import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ member: vi.fn(), read: vi.fn(), upsert: vi.fn() }));
vi.mock("@/src/lib/companion/member-access", () => ({ requirePersonalMember: m.member }));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: async (run: (tx: object) => Promise<void>) =>
      run({ companionPushRoute: { findUnique: m.read, upsert: m.upsert } }),
  }),
}));
import { companionPushRouteRegistrationSchema, registerCompanionPushRoute } from "@/src/lib/companion/push-route";

const address = {
  installationId: "00000000-0000-4000-8000-000000000001",
  token: "ab".repeat(32), topic: "ai.withmurph.app" as const,
  environment: "production" as const, alertsAllowed: true,
};
describe("shared companion address game enrollment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.read.mockResolvedValue({ ...address, userId: "member-one", gameSessionId: "session-a", gameReminders: true });
  });
  it("does not accept reminder capability on the wearable wire", () => {
    expect(companionPushRouteRegistrationSchema.safeParse({ ...address, gameReminders: true }).success).toBe(false);
  });
  it("keeps game enrollment for permission updates to the same address", async () => {
    await registerCompanionPushRoute("member-one", { ...address, alertsAllowed: false });
    expect(m.upsert.mock.calls[0]?.[0].update).toMatchObject({ gameSessionId: "session-a", gameReminders: true, alertsAllowed: false });
  });
  it.each([
    { installationId: "00000000-0000-4000-8000-000000000002" },
    { token: "cd".repeat(32) },
    { environment: "development" as const },
    { topic: "ai.withmurph.app.dev" as const },
  ])("does not carry session A's game enrollment to a changed target", async (change) => {
    await registerCompanionPushRoute("member-one", { ...address, ...change });
    expect(m.upsert.mock.calls[0]?.[0].update.gameSessionId).toBeNull();
    expect(m.upsert.mock.calls[0]?.[0].update.gameReminders).toBe(false);
  });
  it("keeps the same phone's reopen reminders choice when a registration does not report it", async () => {
    m.read.mockResolvedValue({ ...address, userId: "member-one", gameSessionId: "session-a", gameReminders: true, reopenReminders: false });
    await registerCompanionPushRoute("member-one", address);
    expect(m.upsert.mock.calls[0]?.[0].update.reopenReminders).toBe(false);
  });
  it("records a reported reopen reminders choice and forgets it for a changed address", async () => {
    m.read.mockResolvedValue({ ...address, userId: "member-one", gameSessionId: "session-a", gameReminders: true, reopenReminders: false });
    await registerCompanionPushRoute("member-one", { ...address, reopenReminders: true });
    expect(m.upsert.mock.calls[0]?.[0].update.reopenReminders).toBe(true);
    await registerCompanionPushRoute("member-one", { ...address, token: "cd".repeat(32) });
    expect(m.upsert.mock.calls[1]?.[0].update.reopenReminders).toBeNull();
  });
  it("does not enroll games through a new wearable-only address", async () => {
    m.read.mockResolvedValue(null);
    await registerCompanionPushRoute("member-one", address);
    expect(m.upsert.mock.calls[0]?.[0].create.gameSessionId).toBeNull();
    expect(m.upsert.mock.calls[0]?.[0].create.gameReminders).toBe(false);
  });
});
