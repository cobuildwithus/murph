import { beforeEach, describe, expect, it, vi } from "vitest";
import { companionPresence, companionHeartbeatSchema } from "@murphai/hosted-execution/companion-presence";
const m = vi.hoisted(() => ({ prisma: vi.fn(), access: vi.fn(), consent: vi.fn(), runtime: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: m.prisma }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: m.access }));
vi.mock("@/src/lib/legal/consent", () => ({ assertHostedHistoricalLaunchConsentGranted: m.consent }));
vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: m.runtime }));
import { recordCompanionHeartbeat, readRuntimeCompanionPresence } from "@/src/lib/companion/presence";

describe("companion contact evidence", () => {
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
    const tx = { hostedThreadContainer: { findUnique: vi.fn().mockResolvedValue(null) },
      hostedMember: { update: vi.fn(), findUniqueOrThrow: vi.fn().mockResolvedValue({ companionLastContactAt: null, companionLastForegroundAt: null }) } };
    m.prisma.mockReturnValue({ $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(tx) });
    await recordCompanionHeartbeat("synthetic", "foreground");
    expect(tx.hostedMember.update).toHaveBeenLastCalledWith({ where: { id: "synthetic" }, data: { companionLastContactAt: expect.any(Date), companionLastForegroundAt: expect.any(Date) } });
    await recordCompanionHeartbeat("synthetic", "background");
    expect(tx.hostedMember.update).toHaveBeenLastCalledWith({ where: { id: "synthetic" }, data: { companionLastContactAt: expect.any(Date) } });
    expect(await readRuntimeCompanionPresence("synthetic", null)).toEqual({ status: "unknown", lastContactAt: null, lastForegroundAt: null });
    expect(m.runtime).toHaveBeenCalledExactlyOnceWith(tx, "synthetic", null);
    tx.hostedMember.update.mockClear();
    m.consent.mockRejectedValue(new Error("consent withdrawn"));
    await expect(recordCompanionHeartbeat("synthetic", "background")).rejects.toThrow("consent withdrawn");
    expect(tx.hostedMember.update).not.toHaveBeenCalled();
  });
});
