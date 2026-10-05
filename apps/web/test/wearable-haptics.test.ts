import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WearableHapticRequest } from "@murphai/hosted-execution/wearable-haptics";
const m = vi.hoisted(() => ({ prisma: vi.fn(), runtime: vi.fn(), access: vi.fn(), consent: vi.fn(), input: vi.fn(), wake: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: m.prisma }));
vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: m.runtime }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: m.access }));
vi.mock("@/src/lib/legal/consent", () => ({ assertHostedHistoricalLaunchConsentGranted: m.consent }));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({ readHostedMailboxConversationInputAuthorityByAssistantInputIdTx: m.input, readHostedMailboxConversationWakeByAssistantInputId: m.wake }));
import { requestWearableHaptic, exchangeWearableCommands, wearableCommandId } from "@/src/lib/wearable-haptics/service";

const memberId = "member-synthetic";
const sessionId = "00000000-0000-4000-8000-000000000001";
const request: WearableHapticRequest = { request: { action: "haptic", wearable: "whoop", operation: "buzz" }, authority: { kind: "accepted_input", assistantInputId: "ain_" + "a".repeat(32) } };
function store() {
  const sessions = { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), delete: vi.fn() };
  const commands = { findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), updateMany: vi.fn() };
  const tx = { hostedMember: { findUniqueOrThrow: vi.fn().mockResolvedValue({ companionLastContactAt: null, companionLastForegroundAt: null }) }, hostedThreadContainer: { findUnique: vi.fn().mockResolvedValue(null) }, companionWearableSession: sessions, companionWearableCommand: commands };
  m.prisma.mockReturnValue({ $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx) });
  sessions.findUnique.mockResolvedValue({ userId: memberId, wearable: "whoop", sessionId, expiresAt: new Date(Date.now() + 20_000) });
  return { tx, sessions, commands };
}
const send = (value = request) => requestWearableHaptic({ memberId, runtimeIdentity: null, request: value });
describe("wearable command admission and claims", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.input.mockResolvedValue({ occurredAt: new Date().toISOString(), causalSeq: "1" });
    m.wake.mockResolvedValue({ kind: "conversation.message", message: { channel: "linq", linqMessage: { threadIsDirect: true } } });
  });
  it("distinguishes app reachability, band readiness and busy without changing legacy wire responses", async () => {
    const { sessions, commands, tx } = store();
    const modern = { ...request, includeAvailability: true as const };
    sessions.findUnique.mockResolvedValue(null);
    expect(await send(modern)).toMatchObject({ status: "unavailable", unavailableReason: "app_unreachable" });
    expect(await send()).not.toHaveProperty("unavailableReason");
    const foregroundAt = new Date();
    tx.hostedMember.findUniqueOrThrow.mockResolvedValue({ companionLastContactAt: foregroundAt, companionLastForegroundAt: foregroundAt });
    expect(await send(modern)).toMatchObject({ status: "unavailable", unavailableReason: "device_disconnected" });
    const saved = commands.create.mock.calls.at(-1)![0].data;
    commands.findUnique.mockResolvedValue(saved);
    tx.hostedMember.findUniqueOrThrow.mockResolvedValue({ companionLastContactAt: null, companionLastForegroundAt: null });
    expect(await send(modern)).toMatchObject({ unavailableReason: "device_disconnected" });
    commands.findUnique.mockResolvedValue(null);
    sessions.findUnique.mockResolvedValue({ sessionId, expiresAt: new Date(Date.now() + 20_000) });
    commands.findMany.mockResolvedValue([{ id: "pending", operation: "buzz", status: "claimed" }]);
    expect(await send(modern)).toMatchObject({ status: "unavailable", unavailableReason: "busy" });
  });
  it("does not mistake recent background contact for a disconnected foreground band", async () => {
    const { sessions, tx } = store();
    sessions.findUnique.mockResolvedValue(null);
    tx.hostedMember.findUniqueOrThrow.mockResolvedValue({ companionLastContactAt: new Date(), companionLastForegroundAt: new Date(Date.now() - 1_000) });
    expect(await send({ ...request, includeAvailability: true })).toMatchObject({ unavailableReason: "app_unreachable" });
  });
  it("retires a foreground lease on newer background contact but accepts a newer lease", async () => {
    const { sessions, tx } = store();
    const now = Date.now();
    const modernStatus: WearableHapticRequest = { ...request, includeAvailability: true, request: { ...request.request, operation: "status" } };
    tx.hostedMember.findUniqueOrThrow.mockResolvedValue({ companionLastContactAt: new Date(now - 1_000), companionLastForegroundAt: new Date(now - 3_000) });
    sessions.findUnique.mockResolvedValue({ sessionId, expiresAt: new Date(now + 18_000) });
    expect(await send(modernStatus)).toMatchObject({ status: "unavailable", unavailableReason: "app_unreachable" });
    sessions.findUnique.mockResolvedValue({ sessionId, expiresAt: new Date(now + 20_000) });
    expect(await send(modernStatus)).toMatchObject({ status: "ready" });
  });
  it.each(["whoop", "garmin"] as const)("queues one immediate command for %s and deduplicates a lost response", async (wearable) => {
    const { commands } = store();
    const value = { ...request, request: { ...request.request, wearable } };
    expect((await send(value)).status).toBe("queued");
    const saved = commands.create.mock.calls[0]![0].data;
    commands.findUnique.mockResolvedValue(saved);
    expect((await send(value)).status).toBe("queued");
    expect(commands.create).toHaveBeenCalledTimes(1);
    expect(saved.sessionId).toBe(sessionId);
  });
  it("does not queue for expired availability, groups, missing input or stale runtime", async () => {
    const { sessions, commands, tx } = store();
    sessions.findUnique.mockResolvedValue(null);
    expect((await send()).status).toBe("unavailable");
    expect(commands.create.mock.calls[0]![0].data.status).toBe("unavailable");
    commands.create.mockClear();
    tx.hostedThreadContainer.findUnique.mockResolvedValue({ memberId });
    await expect(send()).rejects.toThrow(/private member/);
    tx.hostedThreadContainer.findUnique.mockResolvedValue(null);
    m.input.mockResolvedValue(null);
    await expect(send()).rejects.toThrow(/private member input/);
    m.runtime.mockRejectedValue(new Error("stale runtime"));
    await expect(send()).rejects.toThrow("stale runtime");
    expect(commands.create).not.toHaveBeenCalled();
  });
  it("makes status read-only and separates each scheduler occurrence", async () => {
    const { commands } = store();
    expect((await send({ ...request, request: { ...request.request, operation: "status" } })).status).toBe("ready");
    expect(commands.create).not.toHaveBeenCalled();
    const scheduled: WearableHapticRequest = { ...request, authority: { kind: "automation_occurrence", automationId: "synthetic-timer", occurrenceAt: "2026-10-01T12:10:00.000Z" } };
    expect(wearableCommandId(memberId, scheduled)).not.toBe(wearableCommandId(memberId, request));
    expect((await send(scheduled)).status).toBe("queued");
    expect(m.runtime).toHaveBeenCalled();
  });
  it("returns terminal truth for expired and ambiguous commands without requeueing", async () => {
    const { commands } = store();
    for (const [status, result] of [["queued", "expired"], ["claimed", "unknown"], ["acknowledged", "acknowledged"]]) {
      commands.findUnique.mockResolvedValue({ status, expiresAt: new Date(0) });
      expect((await send()).status).toBe(result);
    }
    expect(commands.create).not.toHaveBeenCalled();
  });
  it("commits a bounded claim before returning commands; a retry sees none", async () => {
    const { commands } = store();
    const row = { id: "a".repeat(64), operation: "buzz", expiresAt: new Date(Date.now() + 10_000) };
    commands.findMany.mockResolvedValueOnce([row]).mockResolvedValue([]);
    const poll = { action: "poll", wearable: "whoop", sessionId } as const;
    expect((await exchangeWearableCommands(memberId, poll)).commands).toHaveLength(1);
    expect(commands.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { id: { in: [row.id] } }, data: { status: "claimed" } });
    expect(commands.findMany.mock.calls[0]![0]).toMatchObject({ where: { userId: memberId, sessionId, status: "queued", expiresAt: { gt: expect.any(Date) } }, take: 2 });
    expect((await exchangeWearableCommands(memberId, poll)).commands).toEqual([]);
  });
  it("rejects retired sessions and cannot displace another active phone", async () => {
    const { commands, sessions } = store();
    const otherSession = "00000000-0000-4000-8000-000000000002";
    for (const action of ["connect", "poll", "disconnect"] as const) {
      expect(await exchangeWearableCommands(memberId, { action, wearable: "whoop", sessionId: otherSession })).toEqual({ active: false, commands: [] });
    }
    expect(commands.findMany).not.toHaveBeenCalled();
    expect(sessions.upsert).not.toHaveBeenCalled();
    expect(sessions.delete).not.toHaveBeenCalled();
  });
  it("binds receipts to claimed command, authenticated member and session", async () => {
    const { commands } = store();
    await exchangeWearableCommands(memberId, { action: "receipt", wearable: "whoop", sessionId, commandId: "a".repeat(64), status: "acknowledged" });
    expect(commands.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { id: "a".repeat(64), userId: memberId, wearable: "whoop", sessionId, status: "claimed" }, data: { status: "acknowledged" } });
  });
  it("stop cancels only an unsent buzz; a busy session cannot accumulate buzzes", async () => {
    const { commands } = store();
    commands.findMany.mockResolvedValue([{ id: "a".repeat(64), operation: "buzz", status: "queued" }]);
    expect((await send()).status).toBe("unavailable");
    expect((await send({ ...request, request: { ...request.request, operation: "stop" } })).status).toBe("queued");
    expect(commands.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["a".repeat(64)] } }, data: { status: "cancelled" } });
  });
});
