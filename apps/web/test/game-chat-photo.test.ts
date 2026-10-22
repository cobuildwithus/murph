import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ profile: vi.fn(), update: vi.fn(), posting: vi.fn(), run: vi.fn(), download: vi.fn(), put: vi.fn(), entry: vi.fn() }));
const tx = { $queryRaw: async () => [], gameProfile: { findUnique: m.profile, update: m.update }, gameEntry: { findUnique: m.entry } };
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({ ...tx, $transaction: (fn: (tx: object) => unknown) => fn(tx) }) }));
vi.mock("../src/lib/game/service", () => ({ readGamePhotoPostingStateTx: m.posting, runGameCommand: m.run }));
vi.mock("../src/lib/game/media", async (original) => ({ ...await original<typeof import("../src/lib/game/media")>(), putGameMedia: m.put }));
vi.mock("../src/lib/game/chat-photo-media", async (original) => ({ ...await original<typeof import("../src/lib/game/chat-photo-media")>(), downloadGameChatPhoto: m.download }));
import { handleGameChatPhoto } from "../src/lib/game/chat-photo";
import type { HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
const now = new Date("2030-03-04T12:00:00Z");
const ref = "ain_" + "a".repeat(32), yesRef = "ain_" + "b".repeat(32);
const offer = { v: 1, gameId: "game_synthetic", containerMemberId: "room_synthetic", sourceMessageRef: ref, attachmentOrdinal: 1, dayIndex: 0, expiresAt: "2030-03-04T12:30:00.000Z", resolutionMessageRef: null };
function wake(): HostedExecutionConversationMessageWake {
  return { eventId: "event_synthetic", kind: "conversation.message", occurredAt: now.toISOString(), userId: "room_synthetic", message: {
    channel: "linq", phoneLookupKey: "synthetic-phone-key", linqMessage: { chatId: "chat_synthetic", from: "+15555550101", isFromMe: false, messageId: "message_synthetic", threadIsDirect: false, parts: [{ type: "media", mimeType: "image/jpeg", url: "https://cdn.linqapp.com/synthetic.jpg" }] },
  } };
}
const authorize = vi.fn<(tx: object, messageRef: string) => Promise<{ actor: string; wake: HostedExecutionConversationMessageWake }>>().mockResolvedValue({ actor: "player_synthetic", wake: wake() });
function input(operation: "offer" | "save" | "dismiss" = "offer", explicit = true) {
  return { actor: "player_synthetic", containerMemberId: "room_synthetic", messageRef: explicit ? ref : yesRef, authorize,
    photo: { operation, gameId: "game_synthetic", ...(explicit ? { sourceMessageRef: ref, attachmentOrdinal: 1 } : {}) } };
}
describe("game photo accepted-source bridge", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
    m.profile.mockResolvedValue({ chatPhotoIntroducedAt: null, chatPhotoOffer: null });
    m.posting.mockResolvedValue({ now, dayIndex: 0, player: { dayOne: "2030-03-04", timeZone: "UTC" }, scheduled: true, checkInKind: "photo", currentEntryId: null, attemptsRemaining: 2 });
    m.entry.mockResolvedValue(null); m.download.mockResolvedValue({ bytes: new Uint8Array([255,216,255]), contentType: "image/jpeg" }); m.put.mockResolvedValue("owned/key.jpg");
    m.run.mockImplementation(async (request) => { await request.beforeMutationTx(tx); return { ok: true, game: null }; });
    authorize.mockResolvedValue({ actor: "player_synthetic", wake: wake() });
  });
  afterEach(() => vi.useRealTimers());
  it("offers once per person and stores one exact photo without downloading or posting", async () => {
    expect(await handleGameChatPhoto(input())).toEqual({ status: "ok", photoOutcome: "offer" });
    expect(m.update).toHaveBeenCalledWith({ where: { memberId: "player_synthetic" }, data: { chatPhotoIntroducedAt: now, chatPhotoOffer: offer } });
    expect(m.run).not.toHaveBeenCalled(); expect(m.download).not.toHaveBeenCalled();
    m.profile.mockResolvedValue({ chatPhotoIntroducedAt: now, chatPhotoOffer: offer });
    expect(await handleGameChatPhoto({ ...input(), photo: { ...input().photo, gameId: "different_game" } })).toEqual({ status: "ok", photoOutcome: "suppressed" });
  });
  it("does not offer if already posted, and explicit save requires replacement consent", async () => {
    m.posting.mockResolvedValue({ ...(await m.posting()), currentEntryId: "existing_entry" });
    expect(await handleGameChatPhoto(input())).toMatchObject({ photoOutcome: "suppressed" });
    expect(await handleGameChatPhoto(input("save"))).toMatchObject({ error: "replacement_confirmation_required" });
    expect(m.run).not.toHaveBeenCalled();
    expect(await handleGameChatPhoto({ ...input("save"), photo: { ...input("save").photo, replaceEntryId: "existing_entry" } })).toMatchObject({ photoOutcome: "saved" });
    expect(m.run.mock.calls[0][0].postGuard).toEqual({ dayIndex: 0, replaceEntryId: "existing_entry" });
  });
  it("a contextual yes saves only the offered sender's photo through the canonical command", async () => {
    m.profile.mockResolvedValue({ chatPhotoIntroducedAt: now, chatPhotoOffer: offer });
    expect(await handleGameChatPhoto(input("save", false))).toEqual({ status: "ok", photoOutcome: "saved" });
    expect(authorize).toHaveBeenCalledWith(tx, ref); expect(authorize).toHaveBeenCalledWith(tx, yesRef);
    expect(m.run).toHaveBeenCalledWith(expect.objectContaining({ actorMemberId: "player_synthetic", command: expect.objectContaining({ type: "post", kind: "photo", mediaKeys: ["owned/key.jpg"] }), postGuard: { dayIndex: 0, replaceEntryId: null } }));
  });
  it.each([
    { expiresAt: "2030-03-04T11:59:00Z" }, { containerMemberId: "other_room" }, { gameId: "other_game" }, { dayIndex: 1 }, { resolutionMessageRef: "another_yes" },
  ])("does not refresh an expired or changed implicit offer %j", async (change) => {
    m.profile.mockResolvedValue({ chatPhotoIntroducedAt: now, chatPhotoOffer: { ...offer, ...change } });
    expect(await handleGameChatPhoto(input("save", false))).toMatchObject({ error: "photo_offer_expired" });
    expect(m.download).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled();
  });
  it("does not save another speaker's photo", async () => {
    m.profile.mockResolvedValue({ chatPhotoIntroducedAt: now, chatPhotoOffer: offer });
    authorize.mockImplementation(async (_tx, messageRef) => ({ actor: messageRef === ref ? "other_player" : "player_synthetic", wake: wake() }));
    await expect(handleGameChatPhoto(input("save", false))).rejects.toThrow("sender authority changed");
    expect(m.download).not.toHaveBeenCalled();
  });
  it("rechecks pending selection after download before mutation", async () => {
    m.profile.mockResolvedValueOnce({ chatPhotoIntroducedAt: now, chatPhotoOffer: offer }).mockResolvedValue({ chatPhotoIntroducedAt: now, chatPhotoOffer: { ...offer, sourceMessageRef: "another_source" } });
    await expect(handleGameChatPhoto(input("save", false))).rejects.toThrow("selection changed");
  });
  it("does not claim a withdrawn or retaken photo was saved again", async () => {
    m.entry.mockResolvedValue({ memberId: "player_synthetic", dayIndex: 0, withdrawnAt: now });
    expect(await handleGameChatPhoto(input("save"))).toMatchObject({ error: "photo_already_used_choose_another" });
    expect(m.download).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled();
  });
  it("deduplicates the same still-live check-in without consuming an attempt", async () => {
    m.entry.mockResolvedValue({ memberId: "player_synthetic", dayIndex: 0, withdrawnAt: null });
    expect(await handleGameChatPhoto(input("save"))).toMatchObject({ photoOutcome: "saved" });
    expect(m.run).not.toHaveBeenCalled(); expect(m.download).not.toHaveBeenCalled();
  });
  it("does not accept a past-day source or a heart-rate game", async () => {
    const old = wake(); old.occurredAt = "2030-03-03T12:00:00Z"; authorize.mockResolvedValue({ actor: "player_synthetic", wake: old });
    expect(await handleGameChatPhoto(input("save"))).toMatchObject({ error: "photo_is_not_from_current_game_day" });
    m.posting.mockResolvedValue({ ...(await m.posting()), checkInKind: "heart_rate" });
    expect(await handleGameChatPhoto(input("save"))).toMatchObject({ error: "photo_check_in_unavailable" });
    expect(m.run).not.toHaveBeenCalled();
  });
  it("reports unavailable bytes without claiming a save", async () => {
    m.download.mockRejectedValueOnce(new Error("expired"));
    expect(await handleGameChatPhoto(input("save"))).toMatchObject({ error: "photo_unavailable_resend_or_use_app" });
    expect(m.run).not.toHaveBeenCalled();
  });
});
