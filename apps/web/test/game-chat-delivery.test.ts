import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameChange, GamePendingChange } from "../src/lib/game/contract";
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
const game = (container: string | null = null) => ({ id: "game", lengthDays: 7, status: "live", pendingChange: { v: 1, ...proposal }, chatContainerMemberId: container, players: [{ memberId: "person-a", seat: 0, timeZone: "UTC", dayOne: new Date("2030-03-04T00:00:00Z") }, { memberId: "person-b", seat: 1, timeZone: "UTC", dayOne: new Date("2030-03-04T00:00:00Z") }] });
const candidate = (memberId: string, name: string | null = null, activity: string | null = "2030-03-04T12:00:00Z", created = "2030-03-01T12:00:00Z") => ({
  memberId, createdAt: new Date(created), member: {
    hostedGroupRuntime: { displayName: name },
    hostedMailboxItems: activity ? [{ createdAt: new Date(activity) }] : [],
  },
  participants: ["person-a", "person-b"].map((participantMemberId) => ({ participantMemberId })),
});
describe("game proposal chat delivery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.game.mockResolvedValue(game()); m.updateGame.mockResolvedValue({ count: 1 }); m.candidates.mockResolvedValue([]);
    m.identities.mockImplementation(async ({ memberId }: { memberId: string }) => ({ phoneNumber: phones[memberId === "person-a" ? 0 : 1], phoneNumberVerifiedAt: new Date() }));
    m.routes.mockImplementation(async ({ containerMemberIds }: { containerMemberIds: string[] }) => ({ authorities: new Map(containerMemberIds.map((id) => [id, { threadId: id === "room" ? "chat" : `${id}-chat`, channel: "linq" }])) })); m.chat.mockResolvedValue(chat); m.line.mockResolvedValue({ kind: "assignable" });
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
    m.candidates.mockResolvedValue([candidate("room")]);
    await deliverGameChangeProposal("game", "proposal");
    expect(m.create).not.toHaveBeenCalled(); expect(m.enqueue).toHaveBeenCalledOnce(); expect(m.routeCheck).toHaveBeenCalledOnce();
    expect(m.updateGame).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pendingChange: expect.objectContaining({ deliveryStatus: "queued" }) }) }));
  });
  it("prefers the most recently active room before its name or creation date", async () => {
    m.candidates.mockResolvedValue([
      candidate("new-room", "Reading buddies", "2030-03-04T12:00:00Z", "2030-03-03T12:00:00Z"),
      candidate("room", null, "2030-03-05T12:00:00Z"),
    ]);
    await deliverGameChangeProposal("game", "proposal");
    expect(m.routes).toHaveBeenCalledTimes(1);
    expect(m.routes).toHaveBeenCalledWith(expect.objectContaining({ containerMemberIds: ["room"] }));
    expect(m.updateGame).toHaveBeenCalledWith(expect.objectContaining({ data: { chatContainerMemberId: "room" } }));
    expect(m.create).not.toHaveBeenCalled();
    expect(m.candidates).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({
      member: { select: expect.objectContaining({ hostedMailboxItems: {
        where: { kind: "conversation.message" }, orderBy: { createdAt: "desc" }, select: { createdAt: true }, take: 1,
      } }) },
      participants: { where: { removedAt: null }, select: { participantMemberId: true }, take: 3 },
    }) }));
  });
  it.each([null, "2030-03-04T12:00:00Z"])("prefers a named room when conversation activity ties (%s)", async (activity) => {
    m.candidates.mockResolvedValue([
      candidate("new-room", "  ", activity, "2030-03-03T12:00:00Z"),
      candidate("room", "Reading buddies", activity),
    ]);
    await deliverGameChangeProposal("game", "proposal");
    expect(m.routes).toHaveBeenCalledTimes(1);
    expect(m.routes).toHaveBeenCalledWith(expect.objectContaining({ containerMemberIds: ["room"] }));
    expect(m.create).not.toHaveBeenCalled();
  });
  it("prefers a conversation with message history over a newer named room without messages", async () => {
    m.candidates.mockResolvedValue([
      candidate("new-room", "Reading buddies", null, "2030-03-05T12:00:00Z"),
      candidate("room"),
    ]);
    await deliverGameChangeProposal("game", "proposal");
    expect(m.routes).toHaveBeenCalledWith(expect.objectContaining({ containerMemberIds: ["room"] }));
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each([null, "Reading buddies"])("uses creation date when activity and naming status tie (%s)", async (name) => {
    m.candidates.mockResolvedValue([
      candidate("older-room", name),
      candidate("room", name, "2030-03-04T12:00:00Z", "2030-03-03T12:00:00Z"),
    ]);
    await deliverGameChangeProposal("game", "proposal");
    expect(m.routes).toHaveBeenCalledTimes(1);
    expect(m.routes).toHaveBeenCalledWith(expect.objectContaining({ containerMemberIds: ["room"] }));
    expect(m.create).not.toHaveBeenCalled();
  });
  it("fails closed when discovery exceeds its candidate bound", async () => {
    m.candidates.mockResolvedValue(Array.from({ length: 21 }, (_, index) => candidate(`room-${index}`)));
    await expect(deliverGameChangeProposal("game", "proposal")).rejects.toThrow("narrower existing conversation");
    expect(m.routes).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });
  it("skips a named room whose current provider audience includes another person", async () => {
    m.candidates.mockResolvedValue([candidate("room"), candidate("named-room", "Reading buddies")]);
    m.routes.mockResolvedValue({ authorities: new Map([["named-room", { threadId: "named-chat", channel: "linq" }], ["room", { threadId: "chat", channel: "linq" }]]) });
    m.chat.mockResolvedValueOnce({ ...chat, handles: [...chat.handles, { handle: "+15555550103", isMe: false, status: "active" }] }).mockResolvedValueOnce(chat);
    await deliverGameChangeProposal("game", "proposal");
    expect(m.chat.mock.calls.map(([input]) => input.chatId)).toEqual(["named-chat", "chat"]);
    expect(m.updateGame).toHaveBeenCalledWith(expect.objectContaining({ data: { chatContainerMemberId: "room" } }));
    expect(m.create).not.toHaveBeenCalled();
  });
  it("keeps an already-bound room without rediscovering another conversation", async () => {
    m.game.mockResolvedValue(game("room"));
    await deliverGameChangeProposal("game", "proposal");
    expect(m.candidates).not.toHaveBeenCalled();
    expect(m.enqueue).toHaveBeenCalledOnce();
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
    expect(notification.responsePolicy.text).toContain("21 days total");
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
  it("keeps a start-now proposal short without announcing the daily cutoff", async () => {
    m.game.mockResolvedValue({ ...game("room"), pendingChange: { v: 1, ...proposal, effectiveFromDay: 0, startsOn: "2030-03-04", change: { kind: "start_now" } } });
    await deliverGameChangeProposal("game", "proposal");
    expect(m.prepareMailbox.mock.calls[0]![0].envelope.notification.responsePolicy.text).toBe("Alex wants to start the game now. Sam, good with that?");
  });
  it("describes a duration edit without presenting the next terms day as a new game start", async () => {
    m.game.mockResolvedValue({ ...game("room"), pendingChange: { v: 1, ...proposal, change: { kind: "edit", lengthDays: 10 } } });
    await deliverGameChangeProposal("game", "proposal");
    const message = m.prepareMailbox.mock.calls[0]![0].envelope.notification.responsePolicy.text;
    expect(message).toContain("extend the game to 10 days total");
    expect(message).not.toMatch(/Mar 6|2030-03-06|starting|new check-in schedule/i);
    expect(message).toContain("Sam, good with that?");
  });
  it.each([
    { change: { kind: "edit" as const, lengthDays: 5 }, startsOn: null, expected: "shorten the game to 5 days total" },
    { change: { kind: "edit" as const, schedule: { days: [0, 1, 2, 3, 4] } }, startsOn: null, expected: "switch to weekday check-ins" },
    { change: { kind: "edit" as const, schedule: { days: [0, 2, 4] } }, startsOn: null, expected: "switch to Monday, Wednesday, and Friday check-ins" },
    { change: { kind: "edit" as const, schedule: { days: [0, 1, 2, 3, 4, 5, 6] } }, startsOn: null, expected: "switch to daily check-ins" },
    { change: { kind: "edit" as const, schedule: { count: 4 } }, startsOn: null, expected: "do 4 check-ins total, on any days" },
    { change: { kind: "edit" as const, startsOn: "2030-03-08" }, startsOn: "2030-03-08", expected: "move the start to Mar 8" },
  ] satisfies Array<{ change: GameChange; startsOn: string | null; expected: string }>)("keeps proposal wording concise: $expected", ({ change, startsOn, expected }) => {
    const message = gameChangeProposalMessage({ ...proposal, change, startsOn, effectiveFromDay: 0 }, { proposerName: "Alex", recipientName: "Sam", lengthDays: 7 });
    expect(message).toBe(`Alex wants to ${expected}. Sam, good with that?`);
    expect(message).not.toMatch(/3 AM|keeping previous|2030-/);
  });
  it("describes future schedule changes without private labels or exact-phrase demands", () => {
    expect(gameChangeProposalMessage(proposal, { proposerName: "Alex", recipientName: "Sam", lengthDays: 7 })).toContain("switch to weekend check-ins");
    expect(gameChangeProposalMessage(proposal, { proposerName: "Alex", recipientName: "Sam", lengthDays: 7 })).not.toMatch(/Mar 6|2030-03-06|starting|3 AM/i);
    expect(gameChangeProposalMessage(proposal, { proposerName: "Alex", recipientName: "Sam", lengthDays: 7 })).toContain("extend the game to 14 days total");
  });
});
