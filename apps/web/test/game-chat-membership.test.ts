import { linqRoster } from "./support/linq-roster";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ container: vi.fn(), games: vi.fn(), identity: vi.fn(), route: vi.fn(), chat: vi.fn(), resolve: vi.fn(), currentRoute: vi.fn(), block: vi.fn(), restriction: vi.fn() }));
vi.mock("../src/lib/hosted-routing/linq-group-line-move-store", () => ({ readHostedLinqGroupMoveServicePhones: async () => [] }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ hostedThreadContainer: { findUnique: m.container }, game: { findMany: m.games }, hostedMemberIdentity: { findMany: async () => [] }, gameBlock: { findFirst: m.block }, hostedMember: { findFirst: m.restriction } }) }));
vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", () => ({ readHostedMemberIdentity: m.identity }));
vi.mock("../src/lib/hosted-onboarding/contact-privacy", async original => ({ ...await original<typeof import("../src/lib/hosted-onboarding/contact-privacy")>(), createHostedPhoneLookupKeyReadCandidates: () => ["line-key"] }));
vi.mock("../src/lib/hosted-groups/participant-member", () => ({ lookupHostedGroupParticipantMemberIdsByHandles: m.resolve }));
vi.mock("../src/lib/hosted-groups/thread-container-participants", () => ({ reconcileHostedThreadContainerParticipants: async () => {} }));
vi.mock("../src/lib/hosted-routing/thread-route-store", () => ({ readHostedThreadRouteByThreadIdentity: m.currentRoute }));
vi.mock("../src/lib/hosted-routing/assistant-notification-destination", () => ({ readHostedThreadContainerLinqRouteAuthorities: m.route }));
vi.mock("../src/lib/hosted-onboarding/linq-client", () => ({ getHostedLinqChatSummary: m.chat }));
vi.mock("../src/lib/hosted-onboarding/linq-line-store", () => ({ readHostedLinqIncomingLineState: async () => ({ kind: "assignable" }) }));

import { addressedGameRematchWhere, gamePairWhere, readGameChatAudience, readGameChatAuthority, gameChatContextCurrent, readGameChatCandidateIds, requireExactGameChat } from "../src/lib/game/chat-membership";

const players = ["player-a", "player-b"];
const phones = ["+15555550101", "+15555550102"];
const chat = linqRoster({ isGroup: true, handlesComplete: true, handles: [
  ...phones.map((handle) => ({ handle, isMe: false, status: "active" })),
  { handle: "+15555550100", isMe: true, status: "active" },
] });

describe("game pair discovery", () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetAllMocks();
    m.container.mockResolvedValue({ participants: players.map((participantMemberId) => ({ participantMemberId })) });
    m.identity.mockImplementation(async ({ memberId }: { memberId: string }) => ({ phoneNumber: phones[players.indexOf(memberId)], phoneNumberVerifiedAt: new Date() }));
    m.route.mockImplementation(async ({ containerMemberIds }: { containerMemberIds: string[] }) => ({ authorities: new Map(containerMemberIds.map((id) => [id, { threadId: id, channel: "linq" }])) }));
    m.chat.mockResolvedValue(chat);
    m.games.mockImplementation(async ({ where }) => where.status === "settled" ? [{ id: "finished-game" }] : [{ id: "active-game" }]);
  });

  it("proves the same pair in either room without requiring a game binding", async () => {
    await expect(requireExactGameChat("named-room")).resolves.toEqual(players);
    await expect(requireExactGameChat("other-room")).resolves.toEqual(players);
    expect(m.chat.mock.calls.map(([input]) => input.chatId)).toEqual(["named-room", "other-room"]);
    expect(m.games).not.toHaveBeenCalled();
  });

  it("reads a bounded canonical history for the exact pair including finished games", async () => {
    await expect(readGameChatCandidateIds(players)).resolves.toEqual(["active-game", "finished-game"]);
    expect(m.games).toHaveBeenCalledWith({
      where: { maxPlayers: 2, OR: [{ ...gamePairWhere(players), status: { in: ["negotiating", "live"] } }, expect.objectContaining({ ...addressedGameRematchWhere(players), AND: expect.any(Array) })] },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 10, select: { id: true },
    });
    expect(m.games.mock.calls[0][0].where).not.toHaveProperty("chatContainerMemberId");
    expect(m.games.mock.calls[1][0].where).toMatchObject({ maxPlayers: 2, status: "settled" });
  });

  it.each([[], ["player-a"], ["player-a", "player-a"], Array.from({ length: 11 }, (_, i) => `person-${i}`)].map((ids) => ({ ids })))("does not discover from an invalid local roster $ids", async ({ ids }) => {
    m.container.mockResolvedValue({ participants: ids.map((participantMemberId) => ({ participantMemberId })) });
    await expect(requireExactGameChat("room")).rejects.toThrow("2 to 10");
    await expect(readGameChatCandidateIds(ids)).resolves.toEqual([]);
    expect(m.games).not.toHaveBeenCalled(); expect(m.chat).not.toHaveBeenCalled();
  });

  it("does not discover group games from an empty room roster", async () => {
    expect(await readGameChatCandidateIds([], true, "room")).toEqual([]);
    expect(m.games).not.toHaveBeenCalled();
  });

  it("has no game chat when the global switch is off", async () => {
    vi.stubEnv("MURPH_GAME_ENABLED", "false");
    await expect(requireExactGameChat("room")).rejects.toThrow("2 to 10");
    await expect(readGameChatCandidateIds(players)).resolves.toEqual([]);
    expect(m.chat).not.toHaveBeenCalled(); expect(m.games).not.toHaveBeenCalled();
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

describe("exact multi-person provider audiences", () => {
  it("requires every person once, one Murph handle, and a complete roster", async () => {
    const { isExactGameChat, gameChatNames } = await import("../src/lib/game/chat-membership");
    for (const size of [2, 3, 10]) {
      const people = Array.from({ length: size }, (_, i) => `+1555555${String(i + 101).padStart(4, "0")}`);
      const room = linqRoster({ isGroup: true, handlesComplete: true, handles: [
        { handle: "+15555550100", isMe: true, status: "active" },
        ...people.map(handle => ({ handle, isMe: false, status: "active" })),
      ] });
      expect(isExactGameChat(room, [...people].reverse())).toBe(true);
      expect(isExactGameChat({ ...room, handlesComplete: false }, people)).toBe(false);
      expect(isExactGameChat({ ...room, handles: room.handles.slice(1) }, people)).toBe(false);
      expect(isExactGameChat({ ...room, handles: room.handles.slice(0, -1) }, people)).toBe(false);
      expect(isExactGameChat({ ...room, handles: [...room.handles, room.handles[1]] }, people)).toBe(false);
      expect(isExactGameChat({ ...room, handles: [...room.handles, { handle: "+15555550999", isMe: false, status: "active" }] }, people)).toBe(false);
    }
    expect([...gameChatNames([{ memberId: "b", firstName: "Sam" }, { memberId: "a", firstName: "Sam" }, { memberId: "c", firstName: "Ava" }]).values()]).toEqual(["Sam (1)", "Sam (2)", "Ava"]);
  });
});


describe("current game room authority through the provider reader", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_KEYS", `v1:${Buffer.alloc(32, 7).toString("base64url")}`);
    vi.stubEnv("HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION", "v1");
    m.route.mockResolvedValue({ authorities: new Map([["room", { channel: "linq", threadId: "thread", containerMemberId: "room" }]]) });
    m.currentRoute.mockResolvedValue({ containerMemberId: "room" });
    m.block.mockResolvedValue(null); m.restriction.mockResolvedValue(null);
  });
  afterEach(() => vi.unstubAllEnvs());
  function room(playerCount: number, bystanders: number, registered: boolean) {
    const members = Array.from({ length: playerCount }, (_, i) => `player-${i}`);
    const extras = Array.from({ length: bystanders }, (_, i) => `bystander-${i}`);
    const handles = [...members, ...extras].map(id => `${id}@example.test`);
    m.resolve.mockResolvedValue(new Map([...members, ...(registered ? extras : [])].map(id => [`${id}@example.test`, id])));
    m.chat.mockResolvedValue(linqRoster({ isGroup: true, handlesComplete: true, handles: [
      { handle: "+15555550100", isMe: true, status: "active" },
      ...handles.map(handle => ({ handle, isMe: false, status: "active" })),
    ] }));
    return { maxPlayers: playerCount === 2 ? 2 : 10, audienceKey: "original-key", chatContainerMemberId: "room",
      status: "live", previousGameId: null, createdBy: members[0], invitees: [],
      players: members.map((memberId, seat) => ({ memberId, seat, leftAt: null })) };
  }
  it.each([false, true])("admits bound pairs and ten-player games with bystanders (registered: %s)", async registered => {
    for (const [size, extras] of [[2, 1], [2, 9], [10, 1]]) {
      const game = room(size, extras, registered);
      const audience = await readGameChatAudience("room");
      expect(audience.contacts).toHaveLength(size + extras);
      if (size + extras > 10) expect(audience.keys.candidates).toEqual([]);
      expect(await readGameChatAuthority(game, "room", audience)).toBe(audience);
      expect(await gameChatContextCurrent(game, { chatContainerMemberId: "room", chatAudience: audience })).toBe(true);
      for (const chatContainerMemberId of [null, "elsewhere"]) {
        expect(await readGameChatAuthority({ ...game, chatContainerMemberId }, "room", audience)).toBeNull();
      }
    }
  });
  it("keeps exact pair discovery and exact unbound group claiming", async () => {
    const pair = room(2, 0, true);
    const audience = await readGameChatAudience("room");
    for (const chatContainerMemberId of [null, "elsewhere"]) expect(await readGameChatAuthority({ ...pair, chatContainerMemberId }, "room", audience)).toBe(audience);
    const group = { ...pair, maxPlayers: 10, audienceKey: audience.keys.current, chatContainerMemberId: null };
    expect(await readGameChatAuthority(group, "room", audience)).toBe(audience);
    expect(await readGameChatAuthority({ ...group, audienceKey: "other-key" }, "room", audience)).toBeNull();
    expect(await readGameChatAuthority({ ...group, chatContainerMemberId: "elsewhere" }, "room", audience)).toBeNull();
  });
  it("accepts an in-room link joiner and includes a rematch addressee in pair authority", async () => {
    const game = room(3, 1, true);
    game.players[2].seat = 10;
    expect(await readGameChatAuthority(game, "room")).not.toBeNull();
    const pair = room(2, 1, false);
    const rematch = { ...pair, status: "invited", previousGameId: "previous", players: pair.players.slice(0, 1), invitees: [{ memberId: pair.players[1].memberId }] };
    expect(await readGameChatAuthority(rematch, "room")).not.toBeNull();
    m.resolve.mockResolvedValue(new Map([["player-0@example.test", "player-0"]]));
    expect(await readGameChatAuthority(rematch, "room")).toBeNull();
  });
  it("keeps route, missing-player, block and restriction rejection over room people and players", async () => {
    const game = room(2, 1, true);
    const audience = await readGameChatAudience("room");
    m.currentRoute.mockResolvedValueOnce({ containerMemberId: "elsewhere" });
    expect(await readGameChatAuthority(game, "room", audience)).toBeNull();
    expect(await readGameChatAuthority(game, "room", { ...audience, memberIds: ["player-0", "bystander-0"] })).toBeNull();
    m.block.mockResolvedValueOnce({ blockerMemberId: "bystander-0" });
    expect(await readGameChatAuthority(game, "room", audience)).toBeNull();
    m.restriction.mockResolvedValueOnce({ id: "bystander-0" });
    expect(await readGameChatAuthority(game, "room", audience)).toBeNull();
    expect(m.restriction).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["player-0", "player-1", "bystander-0"] } }) }));
  });
  it("rejects incomplete, malformed, duplicate and ambiguous room evidence", async () => {
    room(10, 1, true);
    const valid = await m.chat();
    for (const invalid of [
      { ...valid, handlesComplete: false }, { ...valid, isGroup: false },
      { ...valid, handles: valid.handles.slice(1) },
      { ...valid, handles: [...valid.handles, valid.handles[0]] },
      { ...valid, handles: [...valid.handles, valid.handles[1]] },
      { ...valid, handles: [...valid.handles, { handle: "invalid", isMe: false, status: "active" }] },
    ]) {
      m.chat.mockResolvedValueOnce(invalid);
      await expect(readGameChatAudience("room")).rejects.toThrow("participants have changed");
    }
    m.resolve.mockResolvedValue(new Map([["player-0@example.test", "player-0"], ["player-1@example.test", "player-0"]]));
    await expect(readGameChatAudience("room")).rejects.toThrow("identity is ambiguous");
  });
});
