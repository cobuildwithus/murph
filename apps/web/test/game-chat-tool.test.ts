import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ exact: vi.fn(), runtime: vi.fn(), access: vi.fn(), wake: vi.fn(), route: vi.fn(), sender: vi.fn(), game: vi.fn(), run: vi.fn(), read: vi.fn(), players: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ $transaction: (fn: (tx: object) => unknown) => fn({ game: { findFirst: m.game } }) }) }));
vi.mock("../src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: m.runtime }));
vi.mock("../src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: m.access }));
vi.mock("../src/lib/hosted-mailbox/store", () => ({ readHostedMailboxConversationWakeByAssistantInputId: m.wake }));
vi.mock("../src/lib/hosted-groups/group-message-sender", () => ({ resolveHostedGroupMessageSenderMemberId: m.sender }));
vi.mock("../src/lib/hosted-routing/thread-route-store", () => ({ assertHostedThreadRouteEgressAuthority: m.route }));
vi.mock("../src/lib/game/chat-membership", () => ({
  requireExactGameChat: m.exact, readGameChatPlayerIds: m.players,
  sameGamePlayers: (a: string[], b: string[]) => a.length === 2 && b.length === 2 && a.every((id) => b.includes(id)),
  gamePairWhere: (ids: string[]) => ({ AND: ids.map((memberId) => ({ players: { some: { memberId } } })), players: { none: { memberId: { notIn: ids } } } }),
}));
vi.mock("../src/lib/game/service", () => ({ runGameCommand: m.run, readGameChatState: m.read }));
import { handleGameChatTool } from "../src/lib/game/chat-tool";
const group = "container_synthetic";
const actor = "player_synthetic";
const origin = { kind: "accepted_input" as const, assistantInputId: "ain_" + "a".repeat(32) };
const read = { memberId: group, runtimeIdentity: null, request: { action: "read_game" as const, origin } };
const update = { ...read, request: { action: "update_game" as const, origin, update: { operation: "approve" as const, gameId: "game_synthetic", proposalId: "proposal_synthetic" } } };
function wake(overrides: object = {}) {
  return { userId: group, message: { channel: "linq", linqMessage: { isFromMe: false, threadIsDirect: false, chatId: "chat_synthetic" }, routeAuthority: { channel: "linq", containerMemberId: group, threadId: "chat_synthetic" }, ...overrides } };
}
describe("game chat tool authority", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetAllMocks(); m.players.mockResolvedValue([actor, "other_synthetic"]); m.exact.mockResolvedValue([actor, "other_synthetic"]); m.wake.mockResolvedValue(wake()); m.sender.mockResolvedValue(actor); m.game.mockResolvedValue({ id: "game_synthetic", players: [{ memberId: actor }, { memberId: "other_synthetic" }] }); m.read.mockResolvedValue({ games: [] });
    m.run.mockResolvedValue({ ok: true, game: { privateRelationship: "synthetic-private", entries: ["private-image"] } });
  });
  it("disables paid-group reads and mutations when the game flag is off", async () => {
    vi.stubEnv("MURPH_GAME_ENABLED", "false");
    expect((await handleGameChatTool(read)).result.status).toBe("unavailable");
    expect((await handleGameChatTool(update)).result.status).toBe("unavailable");
    expect(m.run).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled(); expect(m.exact).not.toHaveBeenCalled();
  });
  it.each([actor, "other_synthetic"])("requires both players in the restricted game allowlist (%s only)", async (allowed) => {
    vi.stubEnv("MURPH_GAME_ENABLED", "true"); vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", allowed);
    expect((await handleGameChatTool(read)).result.status).toBe("unavailable");
    expect((await handleGameChatTool(update)).result.status).toBe("unavailable");
    expect(m.run).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled();
  });
  it("uses the authenticated sender and exact pair in any room; never forwards the private app view", async () => {
    const result = await handleGameChatTool(update);
    expect(result).toEqual({ action: "update_game", result: { status: "ok", state: { games: [] } } });
    expect(m.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actorMemberId: actor, chatContainerMemberId: group, command: { type: "respondChange", gameId: "game_synthetic", proposalId: "proposal_synthetic", decision: "approve" } }));
    expect(m.game).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      AND: [{ players: { some: { memberId: actor } } }, { players: { some: { memberId: "other_synthetic" } } }],
      id: "game_synthetic",
    }) }));
    expect(m.game.mock.calls[0][0].where).not.toHaveProperty("chatContainerMemberId");
    expect(m.run.mock.calls[0][0].chatPlayerMemberIds).toEqual([actor, "other_synthetic"]);
    expect(m.access).toHaveBeenCalledWith(group, expect.anything());
    expect(m.access).not.toHaveBeenCalledWith(actor, expect.anything());
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it.each([
    { linqMessage: { isFromMe: true, threadIsDirect: false, chatId: "chat_synthetic" } },
    { linqMessage: { isFromMe: false, threadIsDirect: true, chatId: "chat_synthetic" } },
    { routeAuthority: { channel: "linq", containerMemberId: "other", threadId: "chat_synthetic" } },
    { routeAuthority: { channel: "linq", containerMemberId: group, threadId: "other" } },
  ])("rejects non-group, self-authored or mismatched routing %j", async (overrides) => {
    m.wake.mockResolvedValue(wake(overrides));
    expect((await handleGameChatTool(update)).result.status).toBe("unavailable");
    expect(m.run).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled();
  });
  it("rejects a person outside this game's players", async () => {
    m.game.mockResolvedValue(null);
    expect((await handleGameChatTool(update)).result.status).toBe("unavailable");
    expect(m.run).not.toHaveBeenCalled();
  });
  it("rechecks the runtime and actor inside the game mutation transaction", async () => {
    await handleGameChatTool(update);
    const callback = m.run.mock.calls[0]?.[0].beforeMutationTx;
    m.sender.mockResolvedValue("different-player");
    const tx = { game: { findFirst: m.game } };
    await expect(callback(tx)).rejects.toThrow("authority changed");
    expect(m.runtime).toHaveBeenCalledTimes(2);
  });
  it("blocks shared reads and mutations when an extra human joins the provider chat", async () => {
    m.exact.mockRejectedValue(new Error("Game roster changed"));
    await expect(handleGameChatTool(read)).rejects.toThrow("Game roster changed");
    await expect(handleGameChatTool(update)).rejects.toThrow("Game roster changed");
    expect(m.run).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled();
  });
  it("checks the provider roster again after mutation before returning shared words", async () => {
    m.exact.mockResolvedValueOnce([actor, "other_synthetic"]).mockRejectedValueOnce(new Error("Game roster changed"));
    await expect(handleGameChatTool(update)).rejects.toThrow("Game roster changed");
    expect(m.run).toHaveBeenCalledOnce(); expect(m.read).not.toHaveBeenCalled();
  });
  it("passes the provider-proven pair to the shared projection", async () => {
    await handleGameChatTool(read);
    expect(m.read).toHaveBeenCalledExactlyOnceWith(group, [actor, "other_synthetic"]);
  });
  it("rejects an addressed game from a different pair within the same reused container", async () => {
    await handleGameChatTool(update);
    const callback = m.run.mock.calls[0]?.[0].beforeMutationTx;
    m.game.mockResolvedValue({ id: "game_synthetic", players: [{ memberId: actor }, { memberId: "former_player" }] });
    await expect(callback({ game: { findFirst: m.game } })).rejects.toThrow("authority changed");
  });
  it("rejects stale runtime before reading shared state", async () => {
    m.runtime.mockRejectedValue(new Error("Stale runtime"));
    await expect(handleGameChatTool(read)).rejects.toThrow("Stale runtime");
    expect(m.read).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled();
  });
  it("returns a bounded command rejection rather than claiming an edit applied", async () => {
    m.run.mockResolvedValue({ ok: false, error: { code: "CHANGE_EXPIRED", message: "Old proposal" }, status: 409 });
    expect((await handleGameChatTool(update)).result).toEqual({ status: "rejected", error: "CHANGE_EXPIRED" });
    expect(m.read).not.toHaveBeenCalled();
  });
});
