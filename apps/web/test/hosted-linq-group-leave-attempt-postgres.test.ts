import { randomUUID } from "node:crypto";
import { APIConnectionTimeoutError, APIError } from "@linqapp/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPrisma } from "@/src/lib/prisma";
import { prepareHostedLinqGroupLeave, requestHostedLinqGroupLeaveAfterCommit, rotateHostedLinqGroupLeaveBatch, sweepHostedLinqGroupLeaves } from "@/src/lib/hosted-routing/linq-group-leave";
import { observeHostedLinqGroupRiskTx } from "@/src/lib/hosted-routing/linq-group-risk-ledger";
const provider = vi.hoisted(() => ({ leave: vi.fn(), read: vi.fn() }));
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled && !/^postgres(?:ql)?:\/\/[^/]*@(?:127\.0\.0\.1|localhost):\d+\/murph_test_linq_group_risk$/u.test(process.env.DATABASE_URL ?? "")) throw new Error("Attempt proof requires its isolated local test database.");
describe.skipIf(!enabled)("marker-owned provider attempts", () => {
  const prisma = getPrisma();
  let chatId: string;
  const start = new Date("2026-11-10T00:00:00Z");
  const later = (hours: number) => new Date(start.getTime() + hours * 3600_000);
  beforeEach(async () => {
    vi.stubEnv("LINQ_API_TOKEN", "synthetic-token");
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v1:${Buffer.alloc(32, 7).toString("base64")}`);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v1");
    vi.stubGlobal("fetch", async (request: string | URL | Request) => {
      const url = new URL(request instanceof Request ? request.url : request);
      try {
        const isLeave = url.pathname.endsWith("/leave");
        const value = await (isLeave ? provider.leave() : provider.read());
        return new Response(JSON.stringify(value), { status: isLeave ? 202 : 200, headers: { "Content-Type": "application/json" } });
      } catch (error) {
        if (error instanceof APIError && error.status) return new Response(JSON.stringify(error.error), { status: error.status });
        throw error;
      }
    });
    provider.leave.mockReset().mockResolvedValue({ status: "queued" }); provider.read.mockReset(); chatId = randomUUID();
    const { chatId: ignored, ...prepared } = prepareHostedLinqGroupLeave(chatId, "oversized"); void ignored;
    await prisma.hostedLinqGroupLeave.create({ data: prepared });
  });
  afterEach(async () => {
    await prisma.hostedLinqGroupSighting.deleteMany(); await prisma.hostedLinqGroupLeave.deleteMany(); vi.unstubAllEnvs();
  });
  const marker = () => prisma.hostedLinqGroupLeave.findFirstOrThrow();
  const attempt = (now = start) => requestHostedLinqGroupLeaveAfterCommit({ chatId }, prisma, now);
  it("races two sweeps and immediate dispatch on a legacy zero/null marker", async () => {
    expect(await marker()).toMatchObject({ providerLeaveAttempts: 0, providerLeaveLastAttemptAt: null });
    await Promise.all([attempt(), sweepHostedLinqGroupLeaves({ prisma, now: start }), sweepHostedLinqGroupLeaves({ prisma, now: start })]);
    expect(provider.leave).toHaveBeenCalledOnce();
    expect(await marker()).toMatchObject({ providerLeaveAttempts: 1, providerLeaveLastAttemptAt: start, providerRemovedAt: null });
  });
  it("counts an interrupted reservation and lost response, retries after cooldown and caps at five", async () => {
    await prisma.hostedLinqGroupLeave.updateMany({ data: { providerLeaveAttempts: 1, providerLeaveLastAttemptAt: start } });
    expect(await attempt()).toBe("not_attempted");
    provider.leave.mockRejectedValue(new APIConnectionTimeoutError());
    for (let hour = 1; hour < 5; hour++) expect(await attempt(later(hour))).toBe("unconfirmed");
    expect(provider.leave).toHaveBeenCalledTimes(4);
    expect((await marker()).providerLeaveAttempts).toBe(5);
    expect(await attempt(later(4))).toBe("not_attempted");
    provider.read.mockResolvedValue({ id: chatId, is_group: true, handles: [{ handle: "self@example.invalid", is_me: true, status: "active" }] });
    await Promise.all([attempt(later(5)), sweepHostedLinqGroupLeaves({ prisma, now: later(5) })]);
    expect(provider.read).toHaveBeenCalledOnce();
    expect((await marker()).providerLeaveTerminalCode).toBe("verified_still_active");
    expect(await attempt(later(6))).toBe("not_attempted");
  });
  it.each([
    [2013, "removed", null], [2015, "fewer_than_four", "fewer_than_four"], [2099, "unconfirmed", null],
  ])("preserves provider code %s", async (code, outcome, terminal) => {
    provider.leave.mockRejectedValue(new APIError(409, { error: { code } }, "synthetic", new Headers()));
    expect(await attempt()).toBe(outcome);
    expect((await marker()).providerLeaveTerminalCode).toBe(terminal);
    expect(Boolean((await marker()).providerRemovedAt)).toBe(code === 2013);
    await attempt(later(1));
    expect(provider.leave).toHaveBeenCalledTimes(code === 2099 ? 2 : 1);
  });
  it("keeps an exhausted failed read unconfirmed and never repeats the diagnostic read", async () => {
    await prisma.hostedLinqGroupLeave.updateMany({ data: { providerLeaveAttempts: 5, providerLeaveLastAttemptAt: start } });
    provider.read.mockRejectedValue(new APIConnectionTimeoutError());
    expect(await attempt(later(1))).toBe("unconfirmed"); expect(await attempt(later(2))).toBe("not_attempted");
    expect(provider.read).toHaveBeenCalledOnce(); expect(provider.leave).not.toHaveBeenCalled();
    expect((await marker()).providerLeaveTerminalCode).toBe("unconfirmed");
  });
  it("does not replace self-removal evidence when provider completion races it", async () => {
    provider.leave.mockImplementation(async () => {
      await prisma.$transaction(tx => observeHostedLinqGroupRiskTx({ chatId, observedAt: later(1), selfRemovedAt: later(1), handles: [], prisma: tx }));
      throw new APIError(409, { error: { code: 2013 } }, "synthetic", new Headers());
    });
    expect(await attempt()).toBe("removed");
    expect((await marker()).providerRemovedAt).toEqual(later(1));
  });
  it("lands completion on a marker rotated after the claim", async () => {
    provider.leave.mockImplementation(async () => {
      vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v2:${Buffer.alloc(32, 8).toString("base64")},v1:${Buffer.alloc(32, 7).toString("base64")}`);
      vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v2");
      expect(await rotateHostedLinqGroupLeaveBatch(prisma)).toBe(1);
      throw new APIError(409, { error: { code: 2015 } }, "synthetic", new Headers());
    });
    expect(await attempt()).toBe("fewer_than_four");
    expect(await marker()).toMatchObject({ providerLeaveAttempts: 1, providerLeaveTerminalCode: "fewer_than_four" });
  });
});
