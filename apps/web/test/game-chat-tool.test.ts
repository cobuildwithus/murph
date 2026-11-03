import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ audience: vi.fn(), groupAuthority: vi.fn(), exact: vi.fn(), runtime: vi.fn(), access: vi.fn(), wake: vi.fn(), route: vi.fn(), sender: vi.fn(), game: vi.fn(), run: vi.fn(), read: vi.fn(), profiles: vi.fn(), players: vi.fn(), photo: vi.fn(), recapMaterial: vi.fn(), sealRecap: vi.fn(), mailbox: vi.fn(), decodeMailbox: vi.fn() }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ game: { findFirst: m.game }, $transaction: (fn: (tx: object) => unknown) => fn({ game: { findFirst: m.game } }), hostedMailboxItem: { findMany: m.mailbox } }) }));
vi.mock("../src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: m.runtime }));
vi.mock("../src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: m.access }));
vi.mock("../src/lib/hosted-mailbox/store", () => ({
  buildHostedMailboxLiveItemWhere: () => ({}),
  decodeHostedMailboxStoredPayloads: m.decodeMailbox,
  readHostedMailboxConversationWakeByAssistantInputId: m.wake,
}));
vi.mock("../src/lib/hosted-groups/group-message-sender", () => ({ resolveHostedGroupMessageSenderMemberId: m.sender }));
vi.mock("../src/lib/hosted-routing/thread-route-store", () => ({ assertHostedThreadRouteEgressAuthority: m.route }));
vi.mock("../src/lib/game/chat-membership", async (importOriginal) => ({
  ...await importOriginal<object>(), requireExactGameChat: m.exact, readGameChatPlayerIds: m.players,
  readGameChatAudience: m.audience, readGroupGameChatAuthority: m.groupAuthority,
}));
vi.mock("../src/lib/game/service", () => ({
  readGameRecapMaterial: m.recapMaterial,
  runGameCommand: m.run,
  runGameChatUpdate: m.run,
  readGameChatState: m.read,
  readGameChatProfiles: m.profiles,
  sealGameRecap: m.sealRecap,
}));
vi.mock("../src/lib/game/chat-photo", () => ({ handleGameChatPhoto: m.photo }));
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
    vi.resetAllMocks(); vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://recaps.murph.test"); m.players.mockResolvedValue([actor, "other_synthetic"]); m.exact.mockResolvedValue([actor, "other_synthetic"]); m.wake.mockResolvedValue(wake()); m.sender.mockResolvedValue(actor); m.game.mockResolvedValue({ id: "game_synthetic", invitees: [], players: [{ memberId: actor }, { memberId: "other_synthetic" }] }); m.read.mockResolvedValue({ games: [] }); m.mailbox.mockResolvedValue([]); m.decodeMailbox.mockResolvedValue([]);
    m.run.mockResolvedValue({ ok: true, game: { privateRelationship: "synthetic-private", entries: ["private-image"] } });
  });
  it("disables paid-group reads and mutations when the game flag is off", async () => {
    vi.stubEnv("MURPH_GAME_ENABLED", "false");
    expect((await handleGameChatTool(read)).result.status).toBe("unavailable");
    expect((await handleGameChatTool(update)).result.status).toBe("unavailable");
    expect(m.run).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled(); expect(m.exact).not.toHaveBeenCalled();
  });
  it("is unavailable when neither player is on the game list", async () => {
    vi.stubEnv("MURPH_GAME_ENABLED", "true"); vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "third_synthetic");
    expect((await handleGameChatTool(read)).result).toEqual({ status: "unavailable", error: "GAME_DISABLED: Games are invite-only for now." });
    expect((await handleGameChatTool(update)).result.status).toBe("unavailable");
    const creation = { operation: "create" as const, gameId: "game_disabled", terms: {
      tasks: [{ memberId: actor, text: "Walk" }, { memberId: "other_synthetic", text: "Read" }],
      schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize" as const, item: "Lunch" }],
    } };
    expect((await handleGameChatTool({ ...read, request: { action: "update_game", origin, update: creation } })).result).toEqual({ status: "unavailable", error: "GAME_DISABLED: Games are invite-only for now." });
    expect(m.run).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled(); expect(m.profiles).not.toHaveBeenCalled();
  });
  it.each([actor, "other_synthetic"])("lets either player act when one of them is listed (%s only)", async (allowed) => {
    vi.stubEnv("MURPH_GAME_ENABLED", "true"); vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", allowed);
    expect((await handleGameChatTool(update)).result.status).toBe("ok");
    expect(m.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actorMemberId: actor }));
  });
  it("returns player references only to marked reads, preserving old strict readers", async () => {
    const players = [{ memberId: actor, firstName: "Ava", timeZone: "UTC" }, { memberId: "other_synthetic", firstName: null, timeZone: null }];
    m.profiles.mockResolvedValue(players);
    const legacy = await handleGameChatTool(read);
    expect(legacy.result).not.toHaveProperty("state.players");
    expect(m.profiles).not.toHaveBeenCalled();
    const next = await handleGameChatTool({ ...read, request: { ...read.request, includePlayers: true } });
    expect(next.result).toHaveProperty("state.players", players.map(p => ({ ...p, isSender: p.memberId === actor })));
    expect(m.profiles).toHaveBeenCalledExactlyOnceWith([actor, "other_synthetic"]);
    expect(m.read).toHaveBeenLastCalledWith(group, [actor, "other_synthetic"], actor, false);
  });
  it("reads a scheduled exact pair neutrally without sender or photo authority", async () => {
    const players = [{ memberId: actor, firstName: "Ava", timeZone: "UTC" }, { memberId: "other_synthetic", firstName: "Sam", timeZone: "UTC" }];
    m.profiles.mockResolvedValue(players);
    const result = await handleGameChatTool({ ...read, request: { action: "read_game", origin: { kind: "automation_occurrence", automationId: "automation_game_read", occurrenceAt: "2030-04-01T20:00:00Z" }, includePlayers: true } });
    expect(result).toEqual({ action: "read_game", result: { status: "ok", state: { games: [], players: players.map(p => ({ ...p, isSender: false })) } } });
    expect(result.result).not.toHaveProperty("state.photoCheckIn");
    expect(m.read).toHaveBeenCalledExactlyOnceWith(group, [actor, "other_synthetic"], undefined, false);
    expect(m.runtime).toHaveBeenCalledExactlyOnceWith(expect.anything(), group, null);
    expect(m.access).toHaveBeenCalledExactlyOnceWith(group, expect.anything());
    expect(m.wake).not.toHaveBeenCalled(); expect(m.sender).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled(); expect(m.photo).not.toHaveBeenCalled();
  });
  it.each(["changed", "extra", "disabled", "runtime", "access"])("refuses a scheduled read when %s authority fails", async (failure) => {
    const request = { ...read, request: { action: "read_game" as const, origin: { kind: "automation_occurrence" as const, automationId: "automation_game_read", occurrenceAt: "2030-04-01T20:00:00Z" }, includePlayers: true as const } };
    if (failure === "changed") m.exact.mockRejectedValue(new Error("Roster changed"));
    if (failure === "extra") m.exact.mockResolvedValue([actor, "other_synthetic", "third_synthetic"]);
    if (failure === "disabled") { vi.stubEnv("MURPH_GAME_ENABLED", "true"); vi.stubEnv("MURPH_GAME_MEMBER_ALLOWLIST", "third_synthetic"); }
    if (failure === "runtime" || failure === "access") {
      m[failure].mockRejectedValue(new Error("Authority expired"));
      await expect(handleGameChatTool(request)).rejects.toThrow("Authority expired");
    } else expect((await handleGameChatTool(request)).result.status).toBe("unavailable");
    expect(m.read).not.toHaveBeenCalled(); expect(m.profiles).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled(); expect(m.photo).not.toHaveBeenCalled();
  });
  it("allows an exact-pair read and create before any game but no other write", async () => {
    m.game.mockResolvedValue(null);
    expect((await handleGameChatTool(read)).result.status).toBe("ok");
    const creation = { operation: "create" as const, gameId: "game_new_chat", terms: {
      tasks: [{ memberId: actor, text: "Walk" }, { memberId: "other_synthetic", text: "Read" }],
      schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: "prize" as const, item: "Lunch" }],
    } };
    expect((await handleGameChatTool({ ...read, request: { action: "update_game", origin, update: creation } })).result.status).toBe("ok");
    expect(m.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actorMemberId: actor, update: creation }));
    expect((await handleGameChatTool(update)).result.status).toBe("unavailable");
    expect(m.run).toHaveBeenCalledTimes(1);
  });
  it("authorizes an addressed rematch's signed invitee, never an unknown bearer or wrong pair", async () => {
    m.game.mockResolvedValue({ id: "game_rematch", status: "invited", previousGameId: "game_previous", createdBy: "other_synthetic", invitees: [{ memberId: actor }], players: [{ memberId: "other_synthetic" }] });
    const request = { ...read, request: { action: "update_game" as const, origin, update: { operation: "approve" as const, gameId: "game_rematch", expectedTermsVersion: 1 } } };
    expect((await handleGameChatTool(request)).result.status).toBe("ok");
    expect(m.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actorMemberId: actor, update: request.request.update }));
    for (const inviteeMemberId of [null, "third_synthetic"]) {
      m.game.mockResolvedValue({ id: "game_rematch", status: "invited", previousGameId: "game_previous", createdBy: "other_synthetic", invitees: [{ memberId: inviteeMemberId }], players: [{ memberId: "other_synthetic" }] });
      expect((await handleGameChatTool(request)).result.status).toBe("unavailable");
    }
    expect(m.run).toHaveBeenCalledTimes(1);
  });
  it("refuses create in a three-person room and when the signed sender is outside the pair", async () => {
    const request = { ...read, request: { action: "update_game" as const, origin, update: { operation: "create" as const, gameId: "game_new_chat", terms: {
      tasks: [{ memberId: actor, text: "Walk" }, { memberId: "other_synthetic", text: "Read" }], schedule: { days: [0] }, stakes: [{ kind: "dare" as const, item: "Sing" }],
    } } } };
    m.players.mockResolvedValue([actor, "other_synthetic", "third_synthetic"]);
    expect((await handleGameChatTool(request)).result.status).toBe("unavailable");
    m.players.mockResolvedValue([actor, "other_synthetic"]);
    m.sender.mockResolvedValue("third_synthetic");
    expect((await handleGameChatTool(request)).result.status).toBe("unavailable");
    expect(m.run).not.toHaveBeenCalled();
  });
  it("uses the authenticated sender and exact pair in any room; never forwards the private app view", async () => {
    const result = await handleGameChatTool(update);
    expect(result).toEqual({ action: "update_game", result: { status: "ok", state: { games: [] } } });
    expect(m.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actorMemberId: actor, chatContainerMemberId: group, update: { operation: "approve", gameId: "game_synthetic", proposalId: "proposal_synthetic" } }));
    expect(m.game).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      OR: expect.arrayContaining([expect.objectContaining({ AND: [{ players: { some: { memberId: actor } } }, { players: { some: { memberId: "other_synthetic" } } }] })]),
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
    expect((await handleGameChatTool(read)).result.status).toBe("unavailable");
    expect((await handleGameChatTool(update)).result.status).toBe("unavailable");
    expect(m.run).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled();
  });
  it("checks the provider roster again after mutation before returning shared words", async () => {
    m.exact.mockResolvedValueOnce([actor, "other_synthetic"]).mockRejectedValueOnce(new Error("Game roster changed"));
    await expect(handleGameChatTool(update)).rejects.toThrow("Game roster changed");
    expect(m.run).toHaveBeenCalledOnce(); expect(m.read).not.toHaveBeenCalled();
  });
  it("passes only the provider-proven pair and rechecks accepted source actors for a photo save", async () => {
    m.photo.mockResolvedValue({ status: "ok", photoOutcome: "saved" });
    const request = { action: "game_photo" as const, origin, photo: { operation: "save" as const, gameId: "game_synthetic", sourceMessageRef: origin.assistantInputId, attachmentOrdinal: 1 } };
    expect((await handleGameChatTool({ ...read, request })).result).toMatchObject({ status: "ok", photoOutcome: "saved" });
    const bridge = m.photo.mock.calls[0][0];
    expect(bridge).toMatchObject({ actor, containerMemberId: group, playerMemberIds: [actor, "other_synthetic"] });
    expect(m.game.mock.calls[0][0].where).toMatchObject({ id: "game_synthetic" });
    expect(m.game.mock.calls[0][0].where).not.toHaveProperty("chatContainerMemberId");
    const tx = { game: { findFirst: m.game } };
    expect((await bridge.authorize(tx, origin.assistantInputId)).actor).toBe(actor);
    m.players.mockResolvedValue([actor, "new_person"]);
    expect((await bridge.authorize(tx, origin.assistantInputId)).actor).toBeNull();
  });
  it.each(["update_game", "game_photo"] as const)("keeps the complete fresh audience after %s", async action => {
    const initial = { memberIds: [actor, "other_synthetic"], threadId: "chat_synthetic", contacts: [{ kind: "email", value: "a@example.test" }, { kind: "email", value: "b@example.test" }], keys: { current: "key-old", candidates: ["key-old"] } };
    const photo = { operation: "save" as const, gameId: "game_synthetic", sourceMessageRef: origin.assistantInputId, attachmentOrdinal: 1 };
    const request = action === "update_game" ? update.request : { action, origin, photo };
    m.photo.mockResolvedValue({ status: "ok", photoOutcome: "saved" });
    for (const change of ["addition", "replacement", "unchanged", "rotation"] as const) {
      m.read.mockClear(); m.run.mockClear(); m.photo.mockClear();
      const groupGame = change === "replacement";
      const before = groupGame ? { ...initial, contacts: [...initial.contacts, { kind: "email", value: "unjoined@example.test" }] } : initial;
      m.game.mockResolvedValue({ id: "game_synthetic", maxPlayers: groupGame ? 10 : 2, chatContainerMemberId: group, invitees: [], players: initial.memberIds.map(memberId => ({ memberId })) });
      m.groupAuthority.mockResolvedValue(before);
      const after = { ...before, keys: change === "rotation" ? { current: "key-new", candidates: ["key-new", "key-old"] } : change === "unchanged" ? before.keys : { current: "different-audience", candidates: ["different-audience"] },
        contacts: change === "addition" ? [...before.contacts, { kind: "email", value: "outside@example.test" }] : change === "replacement" ? [...initial.contacts, { kind: "email", value: "replacement@example.test" }] : before.contacts };
      m.audience.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
      if (change === "addition" || change === "replacement") {
        await expect(handleGameChatTool({ ...read, multiplayer: true, request })).rejects.toThrow("participants changed");
        expect(m.read).not.toHaveBeenCalled();
      } else {
        expect((await handleGameChatTool({ ...read, multiplayer: true, request })).result.status).toBe("ok");
        expect(m.read).toHaveBeenCalledExactlyOnceWith(group, initial.memberIds, actor, true, after);
      }
      expect(action === "update_game" ? m.run : m.photo).toHaveBeenCalledOnce();
    }
  });
  it("passes the provider-proven pair to the shared projection", async () => {
    await handleGameChatTool(read);
    expect(m.read).toHaveBeenCalledExactlyOnceWith(group, [actor, "other_synthetic"], actor, false);
  });
  it("returns lore guidance only when this room's shared game is live", async () => {
    const game = { id: "game_synthetic", status: "live" as const, startsOn: null, lengthDays: 7,
      terms: { n: 1, fromDay: 0, tasks: [], schedule: { count: 3 }, stakes: [] }, players: [], pendingChange: null,
      changeControls: { canStartNow: false, canEdit: false, canEditSchedule: false, canEditStartDate: false, editableFromDay: null } };
    m.read.mockResolvedValue({ games: [game] });
    expect((await handleGameChatTool(read)).result).toMatchObject({ status: "ok", loreGuidance: expect.stringContaining("murph.game_lore"), loreFingerprint: expect.stringMatching(/^[a-f0-9]{32}$/u) });
    m.read.mockResolvedValue({ games: [{ ...game, status: "settled" }] });
    expect((await handleGameChatTool(read)).result).not.toHaveProperty("loreGuidance");
  });
  it.each(["", ":synthetic_request"])("validates, saves and replays a recap without scoreLine", async (suffix) => {
    const recap = {
      pages: [
        { background: "night" as const, blocks: [{ kind: "headline" as const, text: "Ava opened the week on the mat" }] },
        { background: "sage" as const, blocks: [{ kind: "headline" as const, text: "Leo found the sauna clause" }] },
        { background: "paper" as const, blocks: [{ kind: "headline" as const, text: "Breakfast changed hands" }] },
      ],
      chatLine: "Sauna citizenship held. Open the week for the paperwork.",
    };
    m.recapMaterial.mockResolvedValue({
      entries: [], game: {}, players: ["Ava", "Leo"],
      validation: { playerNamesByMemberId: [{ memberId: actor, name: "Ava" }, { memberId: "other_synthetic", name: "Leo" }],
        result: [{ memberId: actor, name: "Ava", score: 3 }, { memberId: "other_synthetic", name: "Leo", score: 2 }],
        startedAt: new Date("2030-03-01T00:00:00.000Z"), settledAt: new Date("2030-03-09T09:00:00.000Z") },
    });
    const request = { action: "write_recap" as const,
      origin: { kind: "game_recap" as const, gameId: "game_synthetic", eventId: `game-recap:game_synthetic${suffix}` },
      priorChatLines: ["Sauna citizenship held. Earlier evidence arrived."], recap };

    const rejected = await handleGameChatTool({ memberId: group, request, runtimeIdentity: null });
    expect(rejected.result).toMatchObject({ status: "rejected", recapOutcome: expect.stringContaining('chatLine: repeats "sauna citizenship held"') });
    // A recap written after the game reads only that game's chat, never the next game's.
    expect(m.mailbox).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      occurredAt: { gte: new Date("2030-03-01T00:00:00.000Z"), lte: new Date("2030-03-09T09:00:00.000Z") } }) }));
    expect(m.sealRecap).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ recap: null }));

    const saved = { ...recap, chatLine: "Purple mat court adjourned. The week has the receipts." };
    m.sealRecap.mockReset();
    m.sealRecap.mockResolvedValueOnce(null).mockResolvedValueOnce(saved);
    const accepted = await handleGameChatTool({ memberId: group, request: { ...request, recap: saved }, runtimeIdentity: null });
    expect(accepted.result).toMatchObject({ status: "ok", recap: saved, chatLine: `${saved.chatLine}\nWatch the recap: https://recaps.murph.test/recap/game_synthetic` });
    expect(m.sealRecap.mock.calls[1][0].recap).toEqual(saved);
    const superlatives = [
      { memberId: actor, title: "Give the mat tenure", line: "The mat had a full week." },
      { memberId: "other_synthetic", title: "Book the sauna again", line: "The sauna kept its regular." },
    ];
    m.sealRecap.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...saved, superlatives });
    const rich = await handleGameChatTool({ memberId: group, request: { ...request, recap: { ...saved, superlatives } }, runtimeIdentity: null });
    expect(rich.result.recap?.superlatives).toEqual(superlatives);
    expect(m.sealRecap.mock.calls[3][0].recap).toEqual({ ...saved, superlatives });
    m.sealRecap.mockResolvedValueOnce(null).mockResolvedValueOnce(saved);
    await handleGameChatTool({ memberId: group, request: { ...request, recap: { ...saved, superlatives: [superlatives[0], { ...superlatives[1], memberId: "outsider" }] } }, runtimeIdentity: null });
    expect(m.sealRecap.mock.calls[5][0].recap).toEqual(saved);
    // An old writer may replay a story written by a new runtime.
    m.sealRecap.mockResolvedValueOnce({ ...saved, superlatives });
    const replay = await handleGameChatTool({ memberId: group, request: { ...request, recap: { ...saved, chatLine: "Ignore this retry candidate." } }, runtimeIdentity: null });
    expect(replay).toEqual(accepted);
    expect(m.sealRecap).toHaveBeenCalledTimes(7);
  });
  it("returns the authorized stored recap on replay and records its server chat line", async () => {
    const stored = {
      pages: [
        { background: "night" as const, blocks: [{ kind: "headline" as const, text: "Stored page one" }] },
        { background: "sage" as const, blocks: [{ kind: "headline" as const, text: "Stored page two" }] },
        { background: "paper" as const, blocks: [{ kind: "headline" as const, text: "Stored page three" }] },
      ],
      scoreLine: "Leo owes Ava breakfast in bed.",
      chatLine: "The server kept this exact line.",
    };
    m.recapMaterial.mockResolvedValue({ entries: [], game: {}, players: ["Ava", "Leo"], validation: {
      playerNamesByMemberId: [{ memberId: actor, name: "Ava" }, { memberId: "other_synthetic", name: "Leo" }],
      result: [{ memberId: actor, name: "Ava", score: 3 }, { memberId: "other_synthetic", name: "Leo", score: 2 }],
      startedAt: new Date("2030-03-01T00:00:00.000Z"),
    } });
    m.sealRecap.mockResolvedValue(stored);
    const result = await handleGameChatTool({ memberId: group, runtimeIdentity: null, request: {
      action: "write_recap", origin: { kind: "game_recap", gameId: "game_synthetic", eventId: "game-recap:game_synthetic" },
      priorChatLines: [], recap: { ...stored, pages: [] },
    } });
    expect(result.result).toMatchObject({ status: "ok", recap: stored, chatLine: `${stored.chatLine}\nWatch the recap: https://recaps.murph.test/recap/game_synthetic` });
    expect(m.sealRecap).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ recap: null, beforeMutationTx: expect.any(Function) }));
    const authorize = m.sealRecap.mock.calls[0][0].beforeMutationTx;
    await authorize({});
    expect(m.runtime).toHaveBeenCalledTimes(2);
    expect(m.access).toHaveBeenCalledTimes(2);
  });
  it("rejects an addressed game from a different pair within the same reused container", async () => {
    await handleGameChatTool(update);
    const callback = m.run.mock.calls[0]?.[0].beforeMutationTx;
    m.game.mockResolvedValue({ id: "game_synthetic", invitees: [], players: [{ memberId: actor }, { memberId: "former_player" }] });
    await expect(callback({ game: { findFirst: m.game } })).rejects.toThrow("authority changed");
  });
  it("rejects stale runtime before reading shared state", async () => {
    m.runtime.mockRejectedValue(new Error("Stale runtime"));
    await expect(handleGameChatTool(read)).rejects.toThrow("Stale runtime");
    expect(m.read).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled();
  });
  it("returns a bounded command rejection rather than claiming an edit applied", async () => {
    m.run.mockResolvedValue({ ok: false, error: { code: "CHANGE_EXPIRED", message: "The proposed start date has passed. Propose a new date." }, status: 409 });
    expect((await handleGameChatTool(update)).result).toEqual({ status: "rejected", error: "CHANGE_EXPIRED: The proposed start date has passed. Propose a new date." });
    expect(m.read).not.toHaveBeenCalled();
  });
  it("returns each refusal's plain rule with its code so Murph can explain it", async () => {
    m.run.mockResolvedValue({ ok: false, error: { code: "INVALID_REQUEST", message: "Choose a start date from tomorrow to 60 days out, or use Start now." }, status: 400 });
    expect((await handleGameChatTool(update)).result).toEqual({ status: "rejected", error: "INVALID_REQUEST: Choose a start date from tomorrow to 60 days out, or use Start now." });
    m.run.mockResolvedValue({ ok: false, error: { code: "INVALID_REQUEST", message: "x".repeat(300) }, status: 400 });
    expect((await handleGameChatTool(update)).result.error).toHaveLength(128);
  });
  it("cancels a not-yet-started game through the app's cancel command", async () => {
    m.run.mockClear();
    await handleGameChatTool({ ...update, request: { action: "update_game", origin, update: { operation: "cancel_game", gameId: "game_synthetic" } } });
    expect(m.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actorMemberId: actor, chatContainerMemberId: group, update: { operation: "cancel_game", gameId: "game_synthetic" } }));
  });
});


it("uses accepted speaker authority for day corrections and returns only the shared receipt", async () => {
  m.sender.mockResolvedValue(actor); m.wake.mockResolvedValue(wake()); m.players.mockResolvedValue([actor, "other_synthetic"]);
  m.exact.mockResolvedValue([actor, "other_synthetic"]); m.game.mockResolvedValue({ id: "game_synthetic", invitees: [], players: [{ memberId: actor }, { memberId: "other_synthetic" }] });
  m.read.mockResolvedValue({ games: [] }); m.run.mockClear();
  const dayOutcome = { date: "2030-04-01", status: "marked_incomplete" };
  m.run.mockResolvedValue({ ok: true, game: { private: "never shared" }, dayOutcome });
  const result = await handleGameChatTool({ ...read, request: { action: "update_game", origin, update: { gameId: "game_synthetic", operation: "mark_incomplete", date: "2030-04-01" } } });
  expect(m.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ actorMemberId: actor, chatContainerMemberId: group, update: { operation: "mark_incomplete", gameId: "game_synthetic", date: "2030-04-01" } }));
  expect(result).toEqual({ action: "update_game", result: { status: "ok", state: { games: [] }, dayOutcome } });
});
