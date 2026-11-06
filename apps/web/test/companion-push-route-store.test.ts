import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ member: vi.fn(), read: vi.fn(), upsert: vi.fn() }));
vi.mock("@/src/lib/companion/member-access", () => ({ requirePersonalMember: m.member }));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({
    $transaction: async (run: (tx: object) => Promise<void>) =>
      run({ companionPushRoute: { findUnique: m.read, upsert: m.upsert } }),
  }),
}));
import { registerCompanionPushRoute } from "@/src/lib/companion/push-route";

const address = {
  installationId: "00000000-0000-4000-8000-000000000001",
  token: "ab".repeat(32), topic: "ai.withmurph.app" as const,
  environment: "production" as const, alertsAllowed: true,
};
describe("shared companion address game enrollment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.read.mockResolvedValue({ ...address, userId: "member-one", gameSessionId: "session-a" });
  });
  it("keeps game enrollment for permission updates to the same address", async () => {
    await registerCompanionPushRoute("member-one", { ...address, alertsAllowed: false });
    expect(m.upsert.mock.calls[0]?.[0].update).toMatchObject({ gameSessionId: "session-a", alertsAllowed: false });
  });
  it.each([
    { installationId: "00000000-0000-4000-8000-000000000002" },
    { token: "cd".repeat(32) },
    { environment: "development" as const },
    { topic: "ai.withmurph.app.dev" as const },
  ])("does not carry session A's game enrollment to a changed target", async (change) => {
    await registerCompanionPushRoute("member-one", { ...address, ...change });
    expect(m.upsert.mock.calls[0]?.[0].update.gameSessionId).toBeNull();
  });
  it("does not enroll games through a new wearable-only address", async () => {
    m.read.mockResolvedValue(null);
    await registerCompanionPushRoute("member-one", address);
    expect(m.upsert.mock.calls[0]?.[0].create.gameSessionId).toBeNull();
  });
});
