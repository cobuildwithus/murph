import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameChange, GamePendingChange } from "../src/lib/game/contract";
const m = vi.hoisted(() => ({
  bootstrap: vi.fn(), updateStatus: vi.fn(), game: vi.fn(), updateGame: vi.fn(), candidates: vi.fn(), identities: vi.fn(), routes: vi.fn(), chat: vi.fn(), create: vi.fn(), claim: vi.fn(), receipt: vi.fn(), saveReceipt: vi.fn(), accepted: vi.fn(), prepare: vi.fn(), ensure: vi.fn(), reconcile: vi.fn(), enqueue: vi.fn(), mailbox: vi.fn(), wake: vi.fn(), prepareMailbox: vi.fn(), routeCheck: vi.fn(), lines: vi.fn(), line: vi.fn(), capacity: vi.fn(), decode: vi.fn(), encode: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => {
  const db = {
    $executeRaw: m.updateStatus,
    game: { findFirst: m.game, findUnique: m.game, updateMany: m.updateGame, update: m.updateGame },
    hostedMember: { count: async () => 2 },
    gameProfile: { findMany: async () => [{ memberId: "person-a", firstNameEncrypted: "Alex" }, { memberId: "person-b", firstNameEncrypted: "Sam" }] },
    hostedThreadContainer: { findMany: m.candidates, findUnique: async () => ({ participants: [{ participantMemberId: "person-a" }, { participantMemberId: "person-b" }] }) },
    hostedLinqDelivery: { findUnique: m.receipt, update: m.saveReceipt, updateMany: m.saveReceipt },
  };
  return { getPrisma: () => ({ ...db, $transaction: async (fn: (tx: typeof db) => unknown) => fn(db) }) };
});
vi.mock("../src/lib/game/chat-bootstrap", () => ({ prepareGameChatBootstrap: m.bootstrap }));
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
import { deliverGameChangeProposal, isExactGameChat, buildGameProposalInstructions, requireExactGameChat } from "../src/lib/game/chat-delivery";
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
    vi.resetAllMocks(); m.bootstrap.mockResolvedValue("room"); m.updateStatus.mockResolvedValue(1);
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
    expect(m.updateStatus).toHaveBeenCalledOnce();
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
    expect(m.candidates).toHaveBeenCalledWith(expect.objectContaining({ relationLoadStrategy: "join", select: expect.objectContaining({
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
  it("hands a new room to the generated first-message bootstrap without sending an opener", async () => {
    await deliverGameChangeProposal("game", "proposal");
    expect(m.bootstrap).toHaveBeenCalledExactlyOnceWith("game", "game-change:game:proposal", expect.stringContaining("one concise conversational message"));
    expect(m.create).not.toHaveBeenCalled(); expect(m.enqueue).not.toHaveBeenCalled();
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
  it("queues model-authored instructions rather than exact announcement text", async () => {
    m.game.mockResolvedValue(game("room"));
    await deliverGameChangeProposal("game", "proposal");
    const notification = m.prepareMailbox.mock.calls[0]![0].envelope.notification;
    expect(notification.responsePolicy).toEqual({ kind: "require_send" });
    expect(notification.instructions).toContain("one concise conversational message");
    const data = JSON.parse(notification.instructions.split("\n").at(-1));
    expect(data).toEqual({ proposer: "Alex", recipient: "Sam", currentLengthDays: 7, change: proposal.change, proposedStartDate: null });
    expect(data).not.toHaveProperty("effectiveFromDay");
  });
  it("does not queue a second announcement for a chat-originated proposal", async () => {
    m.game.mockResolvedValue({ ...game("room"), pendingChange: { v: 1, ...proposal, origin: "chat", deliveryStatus: "conversation" } });
    await deliverGameChangeProposal("game", "proposal");
    expect(m.enqueue).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled(); expect(m.identities).not.toHaveBeenCalled();
  });
  it.each([
    { kind: "start_now" },
    { kind: "edit", lengthDays: 5 },
    { kind: "edit", schedule: { days: [0, 1, 2, 3, 4] } },
    { kind: "edit", schedule: { days: [0, 2, 4] } },
    { kind: "edit", schedule: { count: 4 } },
    { kind: "edit", startsOn: "2030-03-08" },
  ] satisfies GameChange[])("preserves requested change data without deriving a false start date: %j", (change) => {
    const instructions = buildGameProposalInstructions({ ...proposal, change, startsOn: change.kind === "edit" ? change.startsOn ?? null : "2030-03-04" }, { proposerName: "Alex", recipientName: "Sam", lengthDays: 7 });
    expect(JSON.parse(instructions.split("\n").at(-1)!).change).toEqual(change);
    expect(instructions).toContain("pending, not applied");
    expect(instructions).toContain("total calendar days, never additional days");
    expect(instructions).not.toContain("2030-03-06");
  });
});
