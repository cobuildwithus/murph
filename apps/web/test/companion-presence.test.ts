import { beforeEach, describe, expect, it, vi } from "vitest";
import { companionPresence, companionHeartbeatSchema } from "@murphai/hosted-execution/companion-presence";
const m = vi.hoisted(() => ({ prisma: vi.fn(), access: vi.fn(), consent: vi.fn(), runtime: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: m.prisma }));
vi.mock("@/src/lib/hosted-onboarding/member-access", () => ({ assertActiveHostedMemberAccessAllowed: m.access }));
vi.mock("@/src/lib/legal/consent", () => ({ assertHostedHistoricalLaunchConsentGranted: m.consent }));
vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: m.runtime }));
import { recordCompanionHeartbeat, readRuntimeCompanionPresence } from "@/src/lib/companion/presence";

describe("companion contact evidence", () => {
  it("rejects a sponsored thread target after runtime and access checks", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]), hostedThreadContainer: { findUnique: vi.fn().mockResolvedValue({ memberId: "hbm_room_synthetic" }) } };
    m.prisma.mockReturnValue({ $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(tx) });
    await expect(readRuntimeCompanionPresence("hbm_room_synthetic", { userId: "hbm_room_synthetic", attemptId: "run_synthetic", generation: "1" }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST", httpStatus: 400, message: "Companion access requires a private member conversation." });
    expect(m.runtime).toHaveBeenCalled();
    expect(m.access).toHaveBeenCalled();
    expect(m.consent).not.toHaveBeenCalled();
  });

  beforeEach(() => vi.resetAllMocks());
  it("keeps missing, expired, future and background contact separate from foreground evidence", () => {
    const now = new Date("2026-10-01T12:00:00.000Z");
    expect(companionPresence(null, null, now).status).toBe("unknown");
    expect(companionPresence(new Date(now.getTime() - 45_000), null, now).status).toBe("unreachable");
    expect(companionPresence(new Date(now.getTime() + 1), null, now).status).toBe("unreachable");
    expect(companionPresence(now, null, now)).toEqual({ status: "recently_active", lastContactAt: now.toISOString(), lastForegroundAt: null });
    expect(companionHeartbeatSchema.safeParse({ state: "foreground", memberId: "other" }).success).toBe(false);
    expect(companionHeartbeatSchema.safeParse({ state: "foreground", observedAt: now.toISOString() }).success).toBe(false);
  });
  it("uses server receipt time under member authority and preserves foreground evidence on background contact", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]), hostedThreadContainer: { findUnique: vi.fn().mockResolvedValue(null) },
      hostedMember: { update: vi.fn().mockResolvedValue({ runtimeDormantAt: null }), findUniqueOrThrow: vi.fn().mockResolvedValue({ companionLastContactAt: null, companionLastForegroundAt: null }) } };
    m.prisma.mockReturnValue({ $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(tx) });
    await recordCompanionHeartbeat("synthetic", "foreground");
    expect(tx.hostedMember.update).toHaveBeenLastCalledWith({ select: { runtimeDormantAt: true }, where: { id: "synthetic" }, data: { companionLastContactAt: expect.any(Date), companionLastForegroundAt: expect.any(Date) } });
    await recordCompanionHeartbeat("synthetic", "background");
    expect(tx.hostedMember.update).toHaveBeenLastCalledWith({ select: { runtimeDormantAt: true }, where: { id: "synthetic" }, data: { companionLastContactAt: expect.any(Date) } });
    expect(await readRuntimeCompanionPresence("synthetic", null)).toEqual({ status: "unknown", lastContactAt: null, lastForegroundAt: null });
    expect(m.runtime).toHaveBeenCalledExactlyOnceWith(tx, "synthetic", null);
    tx.hostedMember.update.mockClear();
    m.consent.mockRejectedValue(new Error("consent withdrawn"));
    await expect(recordCompanionHeartbeat("synthetic", "background")).rejects.toThrow("consent withdrawn");
    expect(tx.hostedMember.update).not.toHaveBeenCalled();
  });
  it("writes client info in the contact update, preserves it for legacy heartbeats, and clears absent optional values", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]), hostedThreadContainer: { findUnique: vi.fn().mockResolvedValue(null) },
      hostedMember: { update: vi.fn().mockResolvedValue({ runtimeDormantAt: null }) } };
    m.prisma.mockReturnValue({ $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(tx) });
    const clientInfo = { platform: "ios" as const, version: "1.1.22", build: "109", osVersion: "18.1.0", deviceModel: "iPhone16,2" };
    await recordCompanionHeartbeat("synthetic", "foreground", clientInfo);
    expect(tx.hostedMember.update).toHaveBeenCalledExactlyOnceWith({ select: { runtimeDormantAt: true }, where: { id: "synthetic" }, data: {
      companionLastContactAt: expect.any(Date), companionLastForegroundAt: expect.any(Date),
      companionAppPlatform: "ios", companionAppVersion: "1.1.22", companionAppBuild: "109",
      companionOsVersion: "18.1.0", companionDeviceModel: "iPhone16,2",
    } });
    await recordCompanionHeartbeat("synthetic", "background", null);
    expect(tx.hostedMember.update).toHaveBeenLastCalledWith({ select: { runtimeDormantAt: true }, where: { id: "synthetic" }, data: { companionLastContactAt: expect.any(Date) } });
    await recordCompanionHeartbeat("synthetic", "background", { ...clientInfo, osVersion: null, deviceModel: null });
    expect(tx.hostedMember.update).toHaveBeenLastCalledWith({ select: { runtimeDormantAt: true }, where: { id: "synthetic" }, data: {
      companionLastContactAt: expect.any(Date), companionAppPlatform: "ios", companionAppVersion: "1.1.22", companionAppBuild: "109",
      companionOsVersion: null, companionDeviceModel: null,
    } });
  });
});
