import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ container: vi.fn(), games: vi.fn(), identity: vi.fn(), route: vi.fn(), chat: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ hostedThreadContainer: { findUnique: m.container }, game: { findMany: m.games } }) }));
vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", () => ({ readHostedMemberIdentity: m.identity }));
vi.mock("../src/lib/hosted-onboarding/contact-privacy", () => ({ createHostedPhoneLookupKeyReadCandidates: () => ["line-key"] }));
vi.mock("../src/lib/hosted-routing/assistant-notification-destination", () => ({ readHostedThreadContainerLinqRouteAuthorities: m.route }));
vi.mock("../src/lib/hosted-onboarding/linq-client", () => ({ getHostedLinqChatSummary: m.chat }));
vi.mock("../src/lib/hosted-onboarding/linq-line-store", () => ({ readHostedLinqIncomingLineState: async () => ({ kind: "assignable" }) }));

import { gamePairWhere, readGameChatCandidateIds, requireExactGameChat } from "../src/lib/game/chat-membership";

const players = ["player-a", "player-b"];
const phones = ["+15555550101", "+15555550102"];
const chat = { isGroup: true, handlesComplete: true, handles: [
  ...phones.map((handle) => ({ handle, isMe: false, status: "active" })),
  { handle: "+15555550100", isMe: true, status: "active" },
] };

describe("game pair discovery", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetAllMocks();
    m.container.mockResolvedValue({ participants: players.map((participantMemberId) => ({ participantMemberId })) });
    m.identity.mockImplementation(async ({ memberId }: { memberId: string }) => ({ phoneNumber: phones[players.indexOf(memberId)], phoneNumberVerifiedAt: new Date() }));
    m.route.mockImplementation(async ({ containerMemberIds }: { containerMemberIds: string[] }) => ({ authorities: new Map(containerMemberIds.map((id) => [id, { threadId: id, channel: "linq" }])) }));
    m.chat.mockResolvedValue(chat);
    m.games.mockResolvedValue([{ id: "active-game" }, { id: "finished-game" }]);
  });

  it("proves the same pair in either room without requiring a game binding", async () => {
    await expect(requireExactGameChat("named-room")).resolves.toEqual(players);
    await expect(requireExactGameChat("other-room")).resolves.toEqual(players);
    expect(m.chat.mock.calls.map(([input]) => input.chatId)).toEqual(["named-room", "other-room"]);
    expect(m.games).not.toHaveBeenCalled();
  });

  it("reads a bounded canonical history for the exact pair including finished games", async () => {
    await expect(readGameChatCandidateIds(players)).resolves.toEqual(["active-game", "finished-game"]);
    expect(m.games).toHaveBeenCalledExactlyOnceWith({
      where: { ...gamePairWhere(players), status: { in: ["negotiating", "live", "settled"] } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 5, select: { id: true },
    });
    expect(m.games.mock.calls[0][0].where).not.toHaveProperty("chatContainerMemberId");
  });

  it.each([[], ["player-a"], ["player-a", "player-a"], [...players, "player-c"]].map((ids) => ({ ids })))("does not discover from an invalid local roster $ids", async ({ ids }) => {
    m.container.mockResolvedValue({ participants: ids.map((participantMemberId) => ({ participantMemberId })) });
    await expect(requireExactGameChat("room")).rejects.toThrow("exactly two");
    await expect(readGameChatCandidateIds(ids)).resolves.toEqual([]);
    expect(m.games).not.toHaveBeenCalled(); expect(m.chat).not.toHaveBeenCalled();
  });

  it("has no game chat when neither player is on the game list", async () => {
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "player-c");
    await expect(requireExactGameChat("room")).rejects.toThrow("exactly two");
    await expect(readGameChatCandidateIds(players)).resolves.toEqual([]);
    expect(m.chat).not.toHaveBeenCalled(); expect(m.games).not.toHaveBeenCalled();
  });

  it.each(["player-a", "player-b"])("opens the pair's game chat when one player is listed (%s only)", async (only) => {
    vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", only);
    await expect(requireExactGameChat("room")).resolves.toEqual(players);
    await expect(readGameChatCandidateIds(players)).resolves.toEqual(["active-game", "finished-game"]);
  });

  it("rejects stale local membership when the provider has an additional person", async () => {
    m.chat.mockResolvedValue({ ...chat, handles: [...chat.handles, { handle: "+15555550103", isMe: false, status: "active" }] });
    await expect(requireExactGameChat("room")).rejects.toThrow("participants have changed");
  });

  it("rejects duplicate or unverified phone identities", async () => {
    m.identity.mockResolvedValue({ phoneNumber: phones[0], phoneNumberVerifiedAt: new Date() });
    await expect(requireExactGameChat("room")).rejects.toThrow("verified players");
    m.identity.mockResolvedValue({ phoneNumber: phones[0], phoneNumberVerifiedAt: null });
    await expect(requireExactGameChat("room")).rejects.toThrow("verified players");
    expect(m.chat).not.toHaveBeenCalled();
  });
});
