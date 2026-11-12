import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleHostedLinqGroupLeaveTool } from "@/src/lib/hosted-groups/linq-group-leave-tool";
import { createHostedExternalThreadIdentityLookupKey, createHostedExternalThreadLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";

const mocks = vi.hoisted(() => ({ prisma: { $transaction: vi.fn(), $queryRaw: vi.fn(), $executeRaw: vi.fn(),
  hostedThreadContainer: { findUnique: vi.fn() }, hostedThreadRoute: { findFirst: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  hostedLinqGroupLeave: { findFirst: vi.fn(), createMany: vi.fn() }, game: { findFirst: vi.fn() }, hostedLinqGroupLineMove: { findFirst: vi.fn() } },
  source: vi.fn(), callback: vi.fn(), access: vi.fn(), provider: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@/src/lib/hosted-mailbox/store", () => ({ readHostedMailboxConversationWakeByAssistantInputId: mocks.source }));
vi.mock("@/src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: mocks.callback }));
vi.mock("@/src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: mocks.access }));
vi.mock("@/src/lib/hosted-onboarding/linq-client", () => ({ leaveHostedLinqChat: mocks.provider }));

describe("accepted-input group departure", () => {
  const memberId = randomUUID(), chatId = randomUUID(), assistantInputId = `ain_${"a".repeat(32)}`;
  const route = { channel: "linq" as const, containerMemberId: memberId, threadId: chatId, accountLookupKey: "synthetic-line-key" };
  const input = { memberId, runtimeIdentity: { userId: memberId, attemptId: "synthetic-attempt", generation: "1", workspaceVersion: "1" },
    request: { action: "leave_group" as const, reason: "bot_loop" as const, origin: { kind: "accepted_input" as const, assistantInputId } } };
  const wake = () => ({ userId: memberId, kind: "conversation.message", message: { channel: "linq", routeAuthority: route,
    linqMessage: { chatId, isFromMe: false, threadIsDirect: false } } });
  let left = false, transactionOpen = false;
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetAllMocks(); left = false; transactionOpen = false;
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v1:${Buffer.alloc(32, 7).toString("base64")}`);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v1");
    mocks.prisma.$transaction.mockImplementation(async work => { transactionOpen = true; try { return await work(mocks.prisma); } finally { transactionOpen = false; } });
    mocks.source.mockImplementation(async () => { expect(transactionOpen).toBe(false); return wake(); });
    mocks.prisma.hostedThreadContainer.findUnique.mockResolvedValue({ memberId });
    const expected = { containerMemberId: memberId, threadIdentityLookupKey: createHostedExternalThreadIdentityLookupKey(route),
      threadLookupKey: createHostedExternalThreadLookupKey(route), accountLookupKey: route.accountLookupKey, deliveryRouteEncrypted: "synthetic", updatedAt: new Date() };
    mocks.prisma.hostedThreadRoute.findFirst.mockResolvedValue(expected);
    mocks.prisma.hostedThreadRoute.findMany.mockResolvedValue([expected]);
    mocks.prisma.hostedThreadRoute.deleteMany.mockResolvedValue({ count: 1 });
    mocks.prisma.hostedLinqGroupLeave.findFirst.mockImplementation(async () => left ? { threadIdentityLookupKey: expected.threadIdentityLookupKey } : null);
    mocks.prisma.hostedLinqGroupLeave.createMany.mockImplementation(async () => { left = true; return { count: 1 }; });
    mocks.prisma.game.findFirst.mockResolvedValue(null);
    mocks.prisma.hostedLinqGroupLineMove.findFirst.mockResolvedValue(null);
    mocks.provider.mockImplementation(async () => { expect(transactionOpen).toBe(false); expect(left).toBe(true); });
  });
  it("leaves once for a participant without looking up a member and replays after route deletion", async () => {
    expect(await handleHostedLinqGroupLeaveTool(input)).toEqual({ action: "leave_group", result: { status: "left" } });
    expect(mocks.source).toHaveBeenCalledWith(expect.objectContaining({ assistantInputId, memberId }));
    expect(mocks.prisma.hostedLinqGroupLeave.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reason: "assistant" }) }));
    mocks.prisma.hostedThreadRoute.findFirst.mockResolvedValue(null).mockClear();
    expect(await handleHostedLinqGroupLeaveTool(input)).toEqual({ action: "leave_group", result: { status: "already_left" } });
    expect(mocks.prisma.hostedThreadRoute.findFirst).not.toHaveBeenCalled();
    expect(mocks.provider).toHaveBeenCalledOnce();
  });
  it.each(["missing", "foreign-input", "foreign-route", "forged-room", "self", "direct", "telegram"])("refuses %s source before a marker or provider call", async kind => {
    const source = wake();
    if (kind === "foreign-input") source.userId = randomUUID();
    if (kind === "foreign-route") source.message.routeAuthority = { ...route, containerMemberId: randomUUID() };
    if (kind === "forged-room") source.message.linqMessage.chatId = randomUUID();
    if (kind === "self") source.message.linqMessage.isFromMe = true;
    if (kind === "direct") source.message.linqMessage.threadIsDirect = true;
    if (kind === "telegram") source.message.channel = "telegram";
    mocks.source.mockResolvedValue(kind === "missing" ? null : source);
    left = true; // Even replays must validate the source first.
    expect(await handleHostedLinqGroupLeaveTool(input)).toMatchObject({ result: { status: "unavailable", reason: "source_unavailable" } });
    expect(mocks.prisma.hostedLinqGroupLeave.findFirst).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("requires callback runtime identity before loading private input", async () => {
    mocks.callback.mockRejectedValue(new Error("stale runtime"));
    await expect(handleHostedLinqGroupLeaveTool({ ...input, runtimeIdentity: null })).rejects.toThrow("stale runtime");
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it("waits for chat admission before acquiring member and runtime locks", async () => {
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const locked = new Promise<void>(resolve => { entered = resolve; });
    mocks.prisma.$executeRaw.mockImplementationOnce(async () => { entered(); await gate; });
    const leaving = handleHostedLinqGroupLeaveTool(input);
    await locked;
    try {
      expect(mocks.callback).toHaveBeenCalledTimes(1); // Released preflight only.
      expect(mocks.access).not.toHaveBeenCalled();
    } finally { release(); }
    expect(await leaving).toMatchObject({ result: { status: "left" } });
    expect(mocks.access.mock.invocationCallOrder[0]).toBeLessThan(mocks.callback.mock.invocationCallOrder[1]!);
  });
  it.each(["invited", "negotiating", "live", "settled", "void"])("refuses any bound game: %s", async status => {
    mocks.prisma.game.findFirst.mockResolvedValue({ id: randomUUID(), status });
    expect(await handleHostedLinqGroupLeaveTool(input)).toMatchObject({ result: { status: "unavailable", reason: "game_bound" } });
    expect(mocks.prisma.game.findFirst).toHaveBeenCalledWith({ where: { chatContainerMemberId: memberId }, select: { id: true } });
    expect(mocks.prisma.hostedLinqGroupLeave.createMany).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("refuses an active move", async () => {
    mocks.prisma.hostedLinqGroupLineMove.findFirst.mockResolvedValue({ id: randomUUID() });
    expect(await handleHostedLinqGroupLeaveTool(input)).toMatchObject({ result: { status: "unavailable", reason: "active_move" } });
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("does not treat a missing route as an unbound leave", async () => {
    mocks.prisma.hostedThreadRoute.findFirst.mockResolvedValue(null);
    expect(await handleHostedLinqGroupLeaveTool(input)).toMatchObject({ result: { status: "unavailable", reason: "route_changed" } });
    expect(mocks.prisma.hostedLinqGroupLeave.createMany).not.toHaveBeenCalled();
  });
  it("keeps local success when the provider fails", async () => {
    mocks.provider.mockRejectedValue(new Error("synthetic provider failure"));
    expect(await handleHostedLinqGroupLeaveTool(input)).toMatchObject({ result: { status: "left" } });
    expect(await handleHostedLinqGroupLeaveTool(input)).toMatchObject({ result: { status: "already_left" } });
    expect(mocks.provider).toHaveBeenCalledOnce();
  });
});
