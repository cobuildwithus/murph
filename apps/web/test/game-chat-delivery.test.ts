import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GamePendingChange } from "../src/lib/game/contract";
const m = vi.hoisted(() => ({
  game: vi.fn(), updateGame: vi.fn(), candidates: vi.fn(), identities: vi.fn(), routes: vi.fn(), chat: vi.fn(), create: vi.fn(), claim: vi.fn(), receipt: vi.fn(), saveReceipt: vi.fn(), accepted: vi.fn(), prepare: vi.fn(), ensure: vi.fn(), reconcile: vi.fn(), enqueue: vi.fn(), mailbox: vi.fn(), wake: vi.fn(), prepareMailbox: vi.fn(), routeCheck: vi.fn(), lines: vi.fn(), line: vi.fn(), capacity: vi.fn(), decode: vi.fn(), encode: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => {
  const db = {
    game: { findFirst: m.game, findUnique: m.game, updateMany: m.updateGame, update: m.updateGame },
    hostedMember: { count: async () => 2 },
    gameProfile: { findMany: async () => [{ memberId: "person-a", firstNameEncrypted: "Alex" }, { memberId: "person-b", firstNameEncrypted: "Sam" }] },
    hostedThreadContainer: { findMany: m.candidates },
    hostedLinqDelivery: { findUnique: m.receipt, update: m.saveReceipt },
  };
  return { getPrisma: () => ({ ...db, $transaction: async (fn: (tx: typeof db) => unknown) => fn(db) }) };
});
vi.mock("../src/lib/game/crypto", () => ({ openGameTexts: async (items: Array<{ value: string }>) => items.map((item) => item.value) }));
vi.mock("../src/lib/hosted-crypto/secure-box", () => ({ openHostedUserSecureBoxString: m.decode, sealHostedUserSecureBoxString: m.encode }));
vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", () => ({ readHostedMemberIdentity: m.identities }));
vi.mock("../src/lib/hosted-onboarding/contact-privacy", () => ({ createHostedPhoneLookupKeyReadCandidates: () => ["line-key"] }));
vi.mock("../src/lib/hosted-onboarding/linq-observability-identifiers", () => ({ createHostedLinqDeliveryIdempotencyLookupKey: (key: string) => `hash:${key}` }));
vi.mock("../src/lib/hosted-onboarding/linq-client", () => ({ createHostedLinqChat: m.create, getHostedLinqChatSummary: m.chat }));
vi.mock("../src/lib/hosted-onboarding/linq-delivery-store", () => ({ buildHostedLinqDeliveryId: () => "delivery", claimHostedLinqDeliveryProviderDispatchTx: m.claim, markHostedLinqDeliveryAcceptedTx: m.accepted }));
vi.mock("../src/lib/hosted-onboarding/linq-line-store", () => ({ claimHostedLinqProactiveConversationCapacityTx: m.capacity, listHostedLinqHealthyProactiveLines: m.lines, readHostedLinqIncomingLineState: m.line }));
vi.mock("../src/lib/hosted-routing/thread-container-service", () => ({ prepareHostedThreadContainerCreation: m.prepare, ensureHostedThreadContainerRouteTx: m.ensure }));
vi.mock("../src/lib/hosted-groups/thread-container-participants", () => ({ reconcileHostedThreadContainerParticipants: m.reconcile }));
vi.mock("../src/lib/hosted-mailbox/store", () => ({ appendPreparedHostedMailboxEnvelopeTx: m.enqueue, prepareHostedMailboxEnvelopeAppend: m.prepareMailbox, readHostedMailboxItemByDedupeKey: m.mailbox }));
vi.mock("../src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: m.wake }));
vi.mock("../src/lib/hosted-routing/assistant-notification-destination", () => ({ readHostedThreadContainerLinqRouteAuthorities: m.routes, assertHostedAssistantNotificationRouteAuthority: m.routeCheck, resolveHostedAssistantNotificationDestination: async () => ({ conversationShape: "thread-container", route: { channel: "linq" } }), bindHostedAssistantNotificationDestination: () => ({ route: { channel: "linq", delivery: { kind: "thread", target: "chat" }, accountId: "line" }, externalThreadRouteAuthority: { channel: "linq", containerMemberId: "room", threadId: "chat", accountLookupKey: "line-key" } }) }));
import { deliverGameChangeProposal, isExactGameChat, gameChangeProposalMessage, requireExactGameChat } from "../src/lib/game/chat-delivery";
const phones = ["+15555550101", "+15555550102"];
const proposal: GamePendingChange = { id: "proposal", proposedByMemberId: "person-a", expectedTermsVersion: 1, change: { kind: "edit", schedule: { days: [5, 6] }, lengthDays: 14 }, effectiveFromDay: 2, deliveryStatus: "pending", startsOn: null };
const chat = { isGroup: true, handlesComplete: true, handles: [...phones.map((handle) => ({ handle, isMe: false, status: "active" })), { handle: "+15555550100", isMe: true, status: "active" }] };
const game = (container: string | null = null) => ({ id: "game", status: "live", pendingChange: { v: 1, ...proposal }, chatContainerMemberId: container, players: [{ memberId: "person-a", seat: 0, timeZone: "UTC", dayOne: new Date("2030-03-04T00:00:00Z") }, { memberId: "person-b", seat: 1, timeZone: "UTC", dayOne: new Date("2030-03-04T00:00:00Z") }] });
describe("game proposal chat delivery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.game.mockResolvedValue(game()); m.updateGame.mockResolvedValue({ count: 1 }); m.candidates.mockResolvedValue([]);
    m.identities.mockImplementation(async ({ memberId }: { memberId: string }) => ({ phoneNumber: phones[memberId === "person-a" ? 0 : 1], phoneNumberVerifiedAt: new Date() }));
    m.routes.mockResolvedValue({ authorities: new Map([["room", { threadId: "chat", channel: "linq" }]]) }); m.chat.mockResolvedValue(chat); m.line.mockResolvedValue({ kind: "assignable" });
    m.lines.mockResolvedValue([{ phoneNumber: "+15555550100", phoneNumberLookupKey: "line-key", maxNewConversationsPerDay: 20 }]);
    m.claim.mockResolvedValue({ claimed: true, id: "delivery" }); m.capacity.mockResolvedValue(true); m.create.mockResolvedValue({ chatId: "chat", messageId: "message" });
    m.prepare.mockResolvedValue({}); m.ensure.mockResolvedValue({ containerMemberId: "room", activationMailboxItemId: "activate" }); m.receipt.mockResolvedValue(null); m.encode.mockResolvedValue("encrypted");
    m.mailbox.mockResolvedValue(null); m.enqueue.mockResolvedValue({ mailboxItemId: "notify" }); m.prepareMailbox.mockResolvedValue({});
  });
  it("requires the complete exact provider roster including Murph", () => {
    expect(isExactGameChat(chat, phones)).toBe(true);
    expect(isExactGameChat({ ...chat, handlesComplete: false }, phones)).toBe(false);
    expect(isExactGameChat({ ...chat, handles: [...chat.handles, { handle: "+15555550103", isMe: false, status: "active" }] }, phones)).toBe(false);
    expect(isExactGameChat({ ...chat, handles: chat.handles.filter((handle) => !handle.isMe) }, phones)).toBe(false);
  });
  it("reuses a verified existing room and enqueues through the existing outbox", async () => {
    m.candidates.mockResolvedValue([{ memberId: "room", participants: [{ participantMemberId: "person-a" }, { participantMemberId: "person-b" }] }]);
    await deliverGameChangeProposal("game", "proposal");
    expect(m.create).not.toHaveBeenCalled(); expect(m.enqueue).toHaveBeenCalledOnce(); expect(m.routeCheck).toHaveBeenCalledOnce();
    expect(m.updateGame).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pendingChange: expect.objectContaining({ deliveryStatus: "queued" }) }) }));
  });
  it("creates and binds a group automatically after reserving one provider identity", async () => {
    await deliverGameChangeProposal("game", "proposal");
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ to: phones, idempotencyKey: "game-chat:game" }));
    expect(m.claim).toHaveBeenCalledWith(expect.objectContaining({ status: "provider_dispatch_started" }));
    expect(m.saveReceipt).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payloadCiphertext: "encrypted" }) }));
    expect(m.ensure).toHaveBeenCalledWith(expect.objectContaining({ gameProposal: { gameId: "game", proposalId: "proposal" } }));
    expect(m.enqueue).toHaveBeenCalledOnce(); expect(m.reconcile).toHaveBeenCalledOnce();
  });
  it("never repeats a creation with an ambiguous provider receipt", async () => {
    m.receipt.mockResolvedValue({ id: "delivery", payloadCiphertext: null });
    await expect(deliverGameChangeProposal("game", "proposal")).rejects.toThrow("awaiting a confirmed");
    expect(m.create).not.toHaveBeenCalled();
  });
  it("safely replays a timed-out creation with the frozen key, audience and text", async () => {
    m.create.mockRejectedValueOnce(new Error("timeout"));
    await expect(deliverGameChangeProposal("game", "proposal")).rejects.toThrow("timeout");
    const first = m.create.mock.calls[0]![0];
    m.receipt.mockResolvedValue({ id: "delivery", payloadCiphertext: "frozen-request", payloadOwnerMemberId: "person-a", payloadSchema: "game_chat_v1" });
    m.decode.mockResolvedValue(JSON.stringify({ from: first.from, to: first.to, message: first.message, accountLookupKey: "line-key" }));
    await deliverGameChangeProposal("game", "proposal");
    expect(m.create).toHaveBeenCalledTimes(2); expect(m.create.mock.calls[1]![0]).toEqual(first);
    expect(m.claim).toHaveBeenCalledOnce(); expect(m.capacity).toHaveBeenCalledOnce();
  });
  it.each(["cancelled", "expired"])("replays the same neutral opener after the previous proposal was %s", async () => {
    m.create.mockRejectedValueOnce(new Error("timeout"));
    await expect(deliverGameChangeProposal("game", "proposal")).rejects.toThrow("timeout");
    const first = m.create.mock.calls[0]![0];
    expect(first.message).not.toContain("Saturday"); expect(first.message).not.toContain("Alex");
    m.receipt.mockResolvedValue({ id: "delivery", payloadCiphertext: "frozen-request", payloadOwnerMemberId: "person-a", payloadSchema: "game_chat_v1" });
    m.decode.mockResolvedValue(JSON.stringify({ from: first.from, to: first.to, message: first.message, accountLookupKey: "line-key" }));
    m.game.mockResolvedValue({ ...game(), pendingChange: { v: 1, ...proposal, id: "replacement", change: { kind: "edit", lengthDays: 21 } } });
    await deliverGameChangeProposal("game", "replacement");
    expect(m.create.mock.calls[1]![0]).toEqual(first);
    expect(m.prepareMailbox).toHaveBeenCalledOnce();
    const notification = m.prepareMailbox.mock.calls[0]![0].envelope.notification;
    expect(notification.deliveryIdempotencyKey).toBe("game-change:game:replacement");
    expect(notification.responsePolicy.text).toContain("21 calendar days");
    expect(notification.responsePolicy.text).not.toContain("Saturday");
  });
  it("recovers a provider receipt left before binding and announces only the current proposal", async () => {
    m.receipt.mockResolvedValue({ id: "delivery", payloadCiphertext: "encrypted-receipt", payloadOwnerMemberId: "person-a", payloadSchema: "game_chat_v1" });
    m.decode.mockResolvedValue(JSON.stringify({ chatId: "chat", accountLookupKey: "line-key" }));
    m.game.mockResolvedValue({ ...game(), pendingChange: { v: 1, ...proposal, id: "replacement", change: { kind: "edit", lengthDays: 21 } } });
    await deliverGameChangeProposal("game", "replacement");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.prepareMailbox.mock.calls[0]![0].envelope.notification.deliveryIdempotencyKey).toBe("game-change:game:replacement");
    expect(m.updateGame).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pendingChange: expect.objectContaining({ deliveryStatus: "sent" }) }) }));
  });
  it("tries the next healthy line when the first has no capacity", async () => {
    m.lines.mockResolvedValue([{ phoneNumber: "+15555550109", phoneNumberLookupKey: "full" }, { phoneNumber: "+15555550100", phoneNumberLookupKey: "line-key" }]);
    m.capacity.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await deliverGameChangeProposal("game", "proposal");
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ from: "+15555550100" }));
    expect(m.claim).toHaveBeenCalledOnce();
  });
  it("recovers an accepted creation from its encrypted delivery receipt without sending twice", async () => {
    m.receipt.mockResolvedValue({ id: "delivery", payloadCiphertext: "encrypted", payloadOwnerMemberId: "person-a", payloadSchema: "game_chat_v1" });
    m.decode.mockResolvedValue(JSON.stringify({ chatId: "chat", accountLookupKey: "line-key" }));
    await deliverGameChangeProposal("game", "proposal");
    expect(m.create).not.toHaveBeenCalled(); expect(m.ensure).toHaveBeenCalledOnce(); expect(m.enqueue).toHaveBeenCalledOnce();
  });
  it("does not send to an expanded bound room or to unverified identities", async () => {
    m.game.mockResolvedValue(game("room")); m.chat.mockResolvedValue({ ...chat, handles: [...chat.handles, { handle: "+15555550103", isMe: false, status: "active" }] });
    await expect(deliverGameChangeProposal("game", "proposal")).rejects.toThrow("participants have changed");
    expect(m.enqueue).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
    m.identities.mockResolvedValue({ phoneNumber: phones[0], phoneNumberVerifiedAt: null });
    await expect(deliverGameChangeProposal("game", "proposal")).rejects.toThrow("verified phone");
  });
  it("re-signals the same queued notification rather than queueing a second one", async () => {
    m.game.mockResolvedValue(game("room")); m.mailbox.mockResolvedValue({ id: "existing", consumedAt: null });
    await deliverGameChangeProposal("game", "proposal");
    expect(m.enqueue).not.toHaveBeenCalled(); expect(m.wake).toHaveBeenCalledWith({ expectedUserId: "room", mailboxItemId: "existing" });
  });
  it("requires a fresh exact roster before runtime game tools read shared terms", async () => {
    m.game.mockResolvedValue(game("room"));
    await requireExactGameChat("room");
    expect(m.chat).toHaveBeenCalledWith({ chatId: "chat", timeoutMs: 3_000 });
    m.chat.mockResolvedValue({ ...chat, handlesComplete: false });
    await expect(requireExactGameChat("room")).rejects.toThrow("participants have changed");
  });
  it("does not invent a check-in deadline on an unscheduled start date", async () => {
    m.game.mockResolvedValue({ ...game(), lengthDays: 7, terms: { v: 1, versions: [{ n: 1, fromDay: 0, schedule: { days: [5, 6] }, stakes: [] }] }, pendingChange: { v: 1, ...proposal, startsOn: "2030-03-04", change: { kind: "start_now" } } });
    await deliverGameChangeProposal("game", "proposal");
    expect(m.prepareMailbox.mock.calls[0]![0].envelope.notification.responsePolicy.text).toContain("2030-03-10 at 3 AM");
    expect(m.prepareMailbox.mock.calls[0]![0].envelope.notification.responsePolicy.text).not.toContain("2030-03-05 at 3 AM");
  });
  it("names both players and states the first deadline for starting now", () => {
    const message = gameChangeProposalMessage({ ...proposal, change: { kind: "start_now" }, effectiveFromDay: 0, startsOn: "2030-03-04" }, { proposerName: "Alex", recipientName: "Sam", effectiveOn: "2030-03-04", timeZones: ["America/New_York", "America/Los_Angeles"], deadline: { day: "2030-03-05", kind: "first_check_in" } });
    expect(message).toContain("Alex proposed"); expect(message).toContain("Sam, does that work for you?");
    expect(message).toContain("2030-03-05 at 3 AM"); expect(message).toContain("America/Los_Angeles");
  });
  it("describes future schedule changes without private labels or exact-phrase demands", () => {
    expect(gameChangeProposalMessage(proposal, { proposerName: "Alex", recipientName: "Sam", effectiveOn: "2030-03-06", timeZones: ["UTC"] })).toContain("Saturday, Sunday");
    expect(gameChangeProposalMessage(proposal, { proposerName: "Alex", recipientName: "Sam", effectiveOn: "2030-03-06", timeZones: ["UTC"] })).toContain("2030-03-06");
    expect(gameChangeProposalMessage(proposal, { proposerName: "Alex", recipientName: "Sam", effectiveOn: "2030-03-06", timeZones: ["UTC"] })).toContain("14 calendar days");
  });
});
