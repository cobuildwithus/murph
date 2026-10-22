import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ member: vi.fn(), current: vi.fn(), upsert: vi.fn() }));
vi.mock("@/src/lib/game/http/auth", () => ({ requireGameMemberAuth: m.member }));
vi.mock("@/src/lib/better-auth/native-auth", () => ({ assertHostedNativeMemberAuthCurrentTx: m.current }));
vi.mock("@/src/lib/prisma", () => ({
  getPrisma: () => ({ $transaction: async (run: (tx: object) => Promise<void>) => run({ companionPushRoute: { upsert: m.upsert } }) }),
}));
import { POST } from "../app/api/game/v1/push-route/route";
import { gameHttpError } from "@/src/lib/game/http/errors";

const registration = {
  alertsAllowed: true, environment: "development",
  installationId: "00000000-0000-4000-8000-000000000001",
  token: "ab".repeat(32), topic: "ai.withmurph.app.dev",
};
const request = (body: unknown) => new Request("https://backend.test/api/game/v1/push-route", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
});
describe("game push registration", () => {
  beforeEach(() => { vi.resetAllMocks(); m.member.mockResolvedValue({ member: { id: "free-game-player" }, sessionId: "game-session" }); });
  it("binds the address to the game-authenticated member without a paid assistant requirement", async () => {
    expect((await POST(request(registration))).status).toBe(200);
    expect(m.upsert).toHaveBeenCalledExactlyOnceWith({
      where: { userId: "free-game-player" },
      create: { ...registration, gameSessionId: "game-session", userId: "free-game-player", updatedAt: expect.any(Date) },
      update: { ...registration, gameSessionId: "game-session", updatedAt: expect.any(Date) },
    });
  });
  it.each([
    { ...registration, memberId: "another-member" },
    { ...registration, topic: "unrelated.app" },
    { ...registration, token: "not-a-token" },
  ])("rejects forged authority and invalid addresses", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("preserves the game auth and feature gate", async () => {
    m.member.mockRejectedValue(gameHttpError("GAME_DISABLED", 404, "Not found."));
    expect((await POST(request(registration))).status).toBe(404);
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("refuses a session revoked between admission and registration", async () => {
    m.current.mockRejectedValue(gameHttpError("UNAUTHENTICATED", 401, "Sign in to continue."));
    expect((await POST(request(registration))).status).toBe(401);
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it("records revoked alert permission without erasing the wearable background address", async () => {
    expect((await POST(request({ ...registration, alertsAllowed: false }))).status).toBe(200);
    expect(m.upsert.mock.calls[0]?.[0].update.alertsAllowed).toBe(false);
  });
});
