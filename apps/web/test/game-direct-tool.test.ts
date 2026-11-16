import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleMyGameNotForMeTool } from "../src/lib/game/direct-tool";

const mocks = vi.hoisted(() => ({ wake: vi.fn(), callback: vi.fn(), active: vi.fn(), route: vi.fn(), profile: vi.fn(), command: vi.fn() }));
vi.mock("../src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: mocks.callback }));
vi.mock("../src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: mocks.active }));
vi.mock("../src/lib/hosted-mailbox/store", () => ({ readHostedMailboxConversationWakeByAssistantInputId: mocks.wake }));
vi.mock("../src/lib/hosted-routing/assistant-notification-destination", () => ({ assertHostedDirectAssistantNotificationRouteAuthority: mocks.route }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ $transaction: async (fn: (tx: object) => Promise<void>) => fn({}), gameProfile: { findUnique: mocks.profile } }) }));
vi.mock("../src/lib/game/service", () => ({ runGameCommand: mocks.command }));
vi.mock("../src/lib/game/push-delivery", () => ({}));
vi.mock("../src/lib/game/crypto", () => ({}));

const input = { memberId: "member-self", runtimeIdentity: { userId: "member-self", attemptId: "attempt-test", generation: "1", workspaceVersion: "1" },
  request: { action: "my_game_not_for_me" as const, operation: "read" as const, origin: { kind: "accepted_input" as const, assistantInputId: "input-test" } } };
const wake = () => ({ kind: "conversation.message", userId: input.memberId, message: { channel: "linq",
  linqMessage: { isFromMe: false, threadIsDirect: true, chatId: "direct-test" } } });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.wake.mockResolvedValue(wake());
  mocks.profile.mockResolvedValue({ notForMe: ["swimming", "yoga"] });
  mocks.command.mockImplementation(async ({ beforeMutationTx }) => {
    await beforeMutationTx({});
    return { ok: true, profile: { notForMe: ["dance"] } };
  });
});
describe("private game Not for me", () => {
  it("reads the saved canonical list under reminders' runtime, wake and route authority", async () => {
    expect(await handleMyGameNotForMeTool(input)).toEqual({ action: "my_game_not_for_me", result: { status: "ok", activities: ["swimming", "yoga"] } });
    expect(mocks.callback).toHaveBeenCalledWith({}, input.memberId, input.runtimeIdentity);
    expect(mocks.active).toHaveBeenCalledWith(input.memberId, { prisma: {} });
    expect(mocks.route).toHaveBeenCalledWith(expect.objectContaining({ authority: { channel: "linq", containerMemberId: input.memberId, threadId: "direct-test" }, requireThreadDelivery: true }));
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it("sets through the profile command and repeats runtime authority in its transaction", async () => {
    expect(await handleMyGameNotForMeTool({ ...input, request: { ...input.request, operation: "set", activities: ["dance"] } }))
      .toEqual({ action: "my_game_not_for_me", result: { status: "ok", activities: ["dance"] } });
    expect(mocks.command).toHaveBeenCalledWith({ actorMemberId: input.memberId, command: { type: "setProfile", notForMe: ["dance"] }, beforeMutationTx: expect.any(Function) });
    expect(mocks.callback).toHaveBeenCalledTimes(2);
    expect(mocks.active).toHaveBeenCalledTimes(2);
  });
  it("accepts a direct Telegram wake", async () => {
    mocks.wake.mockResolvedValue({ kind: "conversation.message", userId: input.memberId, message: { channel: "telegram", telegramMessage: { threadIsDirect: true, threadId: "telegram-test" } } });
    expect(await handleMyGameNotForMeTool(input)).toMatchObject({ result: { status: "ok" } });
  });
  it.each(["group", "self", "email", "foreign", "missing", "room authority", "stale route"])("refuses %s authority before reading or writing", async failure => {
    const current = wake();
    if (failure === "group") current.message.linqMessage.threadIsDirect = false;
    if (failure === "self") current.message.linqMessage.isFromMe = true;
    if (failure === "email") current.message.channel = "email";
    if (failure === "foreign") current.userId = "someone-else";
    mocks.wake.mockResolvedValue(failure === "missing" ? null : failure === "room authority" ? { ...current, message: { ...current.message, routeAuthority: {} } } : current);
    if (failure === "stale route") mocks.route.mockRejectedValue(new Error("Unavailable"));
    expect(await handleMyGameNotForMeTool({ ...input, request: { ...input.request, operation: "set", activities: [] } })).toMatchObject({ result: { status: "unavailable" } });
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.command).not.toHaveBeenCalled();
  });
  it("refuses read or set without a game profile", async () => {
    mocks.profile.mockResolvedValue(null);
    expect(await handleMyGameNotForMeTool(input)).toMatchObject({ result: { status: "rejected" } });
    mocks.command.mockResolvedValue({ ok: false, error: { code: "PROFILE_REQUIRED", message: "Add your first name and time zone first." } });
    expect(await handleMyGameNotForMeTool({ ...input, request: { ...input.request, operation: "set", activities: [] } }))
      .toMatchObject({ result: { status: "rejected", error: "Add your first name and time zone first." } });
  });
});
