import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedGameChatBootstrapRequest } from "@murphai/hosted-execution/runtime-control";

const m = vi.hoisted(() => ({
  writeMetadata: vi.fn(), markReceipt: vi.fn(), countReceipt: vi.fn(), attached: false, skipped: false, game: vi.fn(), updateGame: vi.fn(), receipt: vi.fn(), otherReceipt: vi.fn(), route: vi.fn(), saveReceipt: vi.fn(), wake: vi.fn(), runtime: vi.fn(), access: vi.fn(), identities: vi.fn(), create: vi.fn(), chat: vi.fn(), lines: vi.fn(), capacity: vi.fn(), claim: vi.fn(), accepted: vi.fn(), prepareMailbox: vi.fn(), enqueue: vi.fn(), mailbox: vi.fn(), pendingMailbox: vi.fn(), prepareContainer: vi.fn(), createContainer: vi.fn(), prepareRoute: vi.fn(), attachRoute: vi.fn(), append: vi.fn(), signal: vi.fn(), participants: vi.fn(), sequence: [] as string[], frozen: null as null | Record<string, unknown>,
}));
vi.mock("../src/lib/prisma", () => {
  const tx = { $queryRaw: vi.fn(), $executeRaw: m.writeMetadata, game: { findFirst: m.game, findUnique: m.game, update: m.updateGame }, hostedMember: { count: async () => 2 }, hostedThreadRoute: { findFirst: m.route }, hostedMailboxItem: { findFirst: m.pendingMailbox }, hostedLinqDelivery: { count: m.countReceipt, findFirst: m.otherReceipt, findUnique: m.receipt, update: m.saveReceipt, updateMany: m.markReceipt }, hostedThreadContainerParticipant: { createMany: m.participants } };
  return { getPrisma: () => ({ ...tx, $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) }) };
});
vi.mock("../src/lib/hosted-crypto/domain-root-unwrap-cache", () => ({ runWithHostedDomainRootUnwrapCache: (fn: () => unknown) => fn(), runWithHostedDomainRootProviderCallsDisabled: (fn: () => unknown) => fn() }));
vi.mock("../src/lib/hosted-crypto/secure-box", () => ({ sealHostedUserSecureBoxString: async ({ value }: { value: string }) => value, openHostedUserSecureBoxString: async ({ value }: { value: string }) => value }));
vi.mock("../src/lib/hosted-execution/runtime-owner", () => ({ requireHostedRuntimeCallbackTx: m.runtime }));
vi.mock("../src/lib/hosted-mailbox/runtime-access", () => ({ requireHostedRuntimeActiveAccessForUpdateTx: m.access }));
vi.mock("../src/lib/hosted-mailbox/store", () => ({ readHostedMailboxWakeByDedupeKey: m.wake, appendHostedMailboxEnvelopeTx: m.append, readHostedMailboxItemByDedupeKey: m.mailbox, prepareHostedMailboxEnvelopeAppend: m.prepareMailbox, appendPreparedHostedMailboxEnvelopeTx: m.enqueue }));
vi.mock("../src/lib/hosted-orchestration/signal-runtime", () => ({ signalHostedMailboxAppendRuntime: m.signal }));
vi.mock("../src/lib/hosted-onboarding/hosted-member-identity-store", () => ({ readHostedMemberIdentity: m.identities }));
vi.mock("../src/lib/hosted-onboarding/linq-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/lib/hosted-onboarding/linq-client")>(),
  createHostedLinqChat: m.create, getHostedLinqChatSummary: m.chat,
}));
vi.mock("../src/lib/hosted-onboarding/linq-line-store", () => ({ listHostedLinqHealthyProactiveLines: m.lines, claimHostedLinqProactiveConversationCapacityTx: m.capacity }));
vi.mock("../src/lib/hosted-onboarding/linq-delivery-store", () => ({ buildHostedLinqDeliveryId: () => "delivery", claimHostedLinqDeliveryProviderDispatchTx: m.claim, markHostedLinqDeliveryAcceptedTx: m.accepted }));
vi.mock("../src/lib/hosted-onboarding/linq-observability-identifiers", () => ({ createHostedLinqDeliveryIdempotencyLookupKey: (key: string) => `hash:${key}` }));
vi.mock("../src/lib/hosted-onboarding/linq-participant-contact", () => ({ createHostedLinqParticipantContactLookupKey: () => "phone-key" }));
vi.mock("../src/lib/hosted-routing/thread-container-service", () => ({ prepareHostedThreadContainerBootstrap: m.prepareContainer, createHostedGameThreadContainerTx: m.createContainer, prepareHostedThreadContainerDeliveryRoute: m.prepareRoute, attachHostedThreadContainerBootstrapRouteTx: m.attachRoute }));
vi.mock("../src/lib/game/access", () => ({ isGameOn: () => true }));
vi.mock("../src/lib/game/chat-membership", () => ({ isExactGameChat: (chat: { exact: boolean }) => chat.exact }));
import { handleGameChatBootstrapControl, prepareGameChatBootstrap, reconcileFrozenGameChatBootstrap, reconcileFrozenGameChatBootstrapReceipt } from "../src/lib/game/chat-bootstrap";
const gameId = "game_sample";
const eventId = `game-started:${gameId}`;
const phones = ["+15555550101", "+15555550102"];
const game = (container: string | null = "room") => ({ id: gameId, status: "live", pendingChange: null, chatContainerMemberId: container, players: [{ memberId: "person_a", seat: 0 }, { memberId: "person_b", seat: 1 }] });
const call = (operation: "recover" | "send", text?: string) => handleGameChatBootstrapControl({ memberId: "room", runtimeIdentity: null, request: { action: "game_chat_bootstrap", gameId, eventId, operation, ...(text ? { text } : {}) } as HostedGameChatBootstrapRequest });

describe("generated game chat bootstrap", () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.sequence.length = 0; m.frozen = null; m.attached = false; m.skipped = false;
    m.prepareMailbox.mockResolvedValue({}); m.enqueue.mockResolvedValue({ mailboxItemId: "new_kickoff" }); m.pendingMailbox.mockResolvedValue(null); m.mailbox.mockResolvedValue(null);
    m.game.mockResolvedValue(game()); m.otherReceipt.mockResolvedValue(null); m.route.mockResolvedValue(null);
    m.wake.mockResolvedValue({ kind: "assistant.notification.requested", notification: { gameChatBootstrap: { gameId, eventId }, route: { delivery: { kind: "bootstrap", target: "room" } } } });
    m.receipt.mockImplementation(async () => m.frozen ? { id: "delivery", source: "game_lifecycle", status: "provider_dispatch_started", payloadOwnerMemberId: "room", payloadSchema: "game_chat_bootstrap_v1", payloadCiphertext: JSON.stringify(m.frozen), bootstrapRouteAttachedAt: m.attached ? new Date() : null, skippedAt: m.skipped ? new Date() : null } : null);
    m.saveReceipt.mockImplementation(async ({ data }: { data: { payloadCiphertext?: string; bootstrapRouteAttachedAt?: Date } }) => {
      if (data.payloadCiphertext) { m.sequence.push("persist"); m.frozen = JSON.parse(data.payloadCiphertext); }
      if (data.bootstrapRouteAttachedAt) { m.sequence.push("attached"); m.attached = true; }
    });
    m.markReceipt.mockImplementation(async ({ data }: { data: { skippedAt?: Date; payloadOwnerMemberId?: string } }) => { if (data.skippedAt) m.skipped = true; if (data.payloadOwnerMemberId) m.sequence.push("queue-owner"); return { count: 1 }; });
    m.countReceipt.mockResolvedValue(1);
    m.identities.mockImplementation(async ({ memberId }: { memberId: string }) => ({ phoneNumber: phones[memberId === "person_a" ? 0 : 1], phoneNumberVerifiedAt: new Date() }));
    m.lines.mockResolvedValue([{ phoneNumber: "+15555550100", phoneNumberLookupKey: "line", maxNewConversationsPerDay: 10 }]);
    m.capacity.mockResolvedValue(true); m.claim.mockResolvedValue({ claimed: true, id: "delivery" });
    m.create.mockImplementation(async () => { m.sequence.push("provider"); return { chatId: "external_chat", messageId: "first_message" }; });
    m.chat.mockResolvedValue({ exact: true }); m.prepareRoute.mockResolvedValue({ containerMemberId: "room" });
    m.attachRoute.mockImplementation(async () => { m.sequence.push("attach"); });
    m.prepareContainer.mockResolvedValue({ containerMemberId: "room" }); m.createContainer.mockResolvedValue({ containerMemberId: "room", activationMailboxItemId: "activation" }); m.append.mockResolvedValue({ item: { id: "notification" } });
  });
  it("atomically accepts a real shared workspace and model notification without sending a template", async () => {
    m.game.mockResolvedValue(game(null));
    m.signal.mockImplementation(async () => { m.sequence.push("signal"); });
    await expect(prepareGameChatBootstrap(gameId, eventId, "Announce the agreed challenge and offer optional reminders.")).resolves.toBe("room");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.append).toHaveBeenCalledWith(expect.objectContaining({ envelope: expect.objectContaining({ userId: "room", eventId, notification: expect.objectContaining({ responsePolicy: { kind: "require_send" }, gameChatBootstrap: { gameId, eventId }, route: expect.objectContaining({ threadId: null, threadIsDirect: false, delivery: { kind: "bootstrap", target: "room" } }) }) }) }));
    expect(m.participants).toHaveBeenCalledOnce(); expect(m.signal).toHaveBeenCalledTimes(2);
    expect(m.markReceipt).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "generation_queued", retryAfterAt: expect.any(Date), payloadOwnerMemberId: "room" } }));
    expect(m.sequence).toEqual(["queue-owner", "signal", "signal"]);
  });
  it("does not publish bootstrap work without its reserved lifecycle receipt", async () => {
    m.game.mockResolvedValue(game(null));
    m.markReceipt.mockResolvedValueOnce({ count: 0 });
    m.countReceipt.mockResolvedValueOnce(0);
    await expect(prepareGameChatBootstrap(gameId, eventId, "Announce the agreed challenge.")).rejects.toThrow("requires its pending lifecycle receipt");
    expect(m.signal).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it("queues a newly agreed kickoff in the same route-less workspace after a stale negotiation", async () => {
    await expect(prepareGameChatBootstrap(gameId, eventId, "Announce the now agreed challenge.")).resolves.toBe("room");
    expect(m.createContainer).not.toHaveBeenCalled(); expect(m.enqueue).toHaveBeenCalledOnce();
    expect(m.markReceipt).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "generation_queued", retryAfterAt: expect.any(Date), payloadOwnerMemberId: "room" } }));
    expect(m.create).not.toHaveBeenCalled();
  });
  it.each([null, "room"])("marks bootstrap proposal queued before provider acceptance even if attachment fails: %s", async (container) => {
    const proposal = { v: 1, id: "proposal_sample", proposedByMemberId: "person_a", expectedTermsVersion: 1,
      change: { kind: "edit", lengthDays: 10 }, effectiveFromDay: 1, startsOn: null, origin: "app", deliveryStatus: "pending" };
    const proposalEventId = `game-change:${gameId}:${proposal.id}`;
    m.game.mockResolvedValue({ ...game(container), pendingChange: proposal });
    m.writeMetadata.mockImplementation(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join("?");
      expect(sql).toContain(`jsonb_set(pending_change, '{deliveryStatus}', '"queued"'::jsonb)`);
      expect(values).toEqual([gameId, proposal.id]);
      proposal.deliveryStatus = "queued";
      return 1;
    });
    m.signal.mockImplementation(async () => { expect(proposal.deliveryStatus).toBe("queued"); });
    await expect(prepareGameChatBootstrap(gameId, proposalEventId, "Ask about the requested change.")).resolves.toBe("room");
    expect(m.writeMetadata).toHaveBeenCalledOnce();
    m.game.mockResolvedValue({ ...game(), pendingChange: proposal });
    m.wake.mockResolvedValue({ kind: "assistant.notification.requested", notification: { gameChatBootstrap: { gameId, eventId: proposalEventId }, route: { delivery: { kind: "bootstrap", target: "room" } } } });
    m.attachRoute.mockRejectedValueOnce(new Error("Retry attachment"));
    await expect(handleGameChatBootstrapControl({ memberId: "room", runtimeIdentity: null,
      request: { action: "game_chat_bootstrap", gameId, eventId: proposalEventId, operation: "send", text: "A change was requested." },
    })).rejects.toThrow("Retry attachment");
    expect(m.accepted).toHaveBeenCalledOnce();
    expect(proposal.deliveryStatus).toBe("queued");
  });
  it("does not signal a bootstrap proposal if its queued metadata cannot commit", async () => {
    const proposal = { v: 1, id: "proposal_sample", proposedByMemberId: "person_a", expectedTermsVersion: 1,
      change: { kind: "edit", lengthDays: 10 }, effectiveFromDay: 1, startsOn: null, origin: "app", deliveryStatus: "pending" };
    m.game.mockResolvedValue({ ...game(), pendingChange: proposal }); m.writeMetadata.mockResolvedValue(0);
    await expect(prepareGameChatBootstrap(gameId, `game-change:${gameId}:${proposal.id}`, "Ask about the change.")).rejects.toThrow("no longer current");
    expect(m.signal).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it("queues a cancellation for a negotiating game after its original request is cleared", async () => {
    m.game.mockResolvedValue({ ...game(), status: "negotiating", pendingChange: null });
    const cancellation = `game-change-cancelled:${gameId}:proposal_sample`;
    await expect(prepareGameChatBootstrap(gameId, cancellation, "The earlier change is off.")).resolves.toBe("room");
    expect(m.enqueue).toHaveBeenCalledOnce();
    expect(m.markReceipt).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ idempotencyKey: expect.any(String) }) }));
  });
  it("leaves later lifecycle work reserved while a different first message is already frozen", async () => {
    m.otherReceipt.mockResolvedValue({ id: "original_first_message" });
    await expect(prepareGameChatBootstrap(gameId, eventId, "Later announcement")).resolves.toBeNull();
    expect(m.prepareMailbox).not.toHaveBeenCalled(); expect(m.createContainer).not.toHaveBeenCalled();
  });
  it("does not let completed or terminally skipped first messages block newer lifecycle work", async () => {
    await expect(prepareGameChatBootstrap(gameId, eventId, "Announce the agreed challenge.")).resolves.toBe("room");
    expect(m.otherReceipt).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ bootstrapRouteAttachedAt: null, skippedAt: null }) }));
    expect(m.enqueue).toHaveBeenCalledOnce();
  });
  it("does not queue a second currently valid bootstrap event before the first has frozen", async () => {
    m.pendingMailbox.mockResolvedValue({ id: "current_proposal_bootstrap" });
    await expect(prepareGameChatBootstrap(gameId, eventId, "Later announcement")).resolves.toBeNull();
    expect(m.enqueue).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it("asks for model text only when no message has been frozen", async () => {
    expect(await call("recover")).toMatchObject({ result: { status: "needs_message" } });
    expect(m.create).not.toHaveBeenCalled(); expect(m.saveReceipt).not.toHaveBeenCalled();
  });
  it("terminalizes only a skipped empty reservation owned by this group", async () => {
    const receipt = { id: "delivery", source: "game_lifecycle", template: "game_proposal", status: "skipped", skippedAt: new Date(),
      payloadOwnerMemberId: "room", payloadSchema: null, payloadCiphertext: null,
      acceptedAt: null, lastReceiptAt: null, messageLookupKey: null, phoneNumberLookupKey: null };
    m.receipt.mockResolvedValue(receipt);
    await expect(call("recover")).resolves.toMatchObject({ result: { status: "unavailable" } });
    await expect(call("send", "Must not generate a replacement for the cancelled event")).resolves.toMatchObject({ result: { status: "unavailable" } });
    expect(m.create).not.toHaveBeenCalled(); expect(m.capacity).not.toHaveBeenCalled();
    for (const changed of [{ source: "other" }, { payloadOwnerMemberId: "another-room" }, { template: "game_chat_bootstrap" }, { acceptedAt: new Date() }, { phoneNumberLookupKey: "line" }]) {
      m.receipt.mockResolvedValue({ ...receipt, ...changed });
      await expect(call("recover")).rejects.toThrow("requires reconciliation");
    }
  });
  it.each([
    "Follow https://example.org/workout daily. Want reminders?",
    "Follow http://example.org/workout",
    "https://example.org/workout",
    "Read https://example.org/one then https://example.org/two",
  ])("rejects unsendable first text before freezing or consuming capacity: %s", async (text) => {
    await expect(call("send", text)).rejects.toThrow();
    expect(m.capacity).not.toHaveBeenCalled(); expect(m.claim).not.toHaveBeenCalled();
    expect(m.saveReceipt).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
    expect(m.frozen).toBeNull();
    await expect(call("recover")).resolves.toMatchObject({ result: { status: "needs_message" } });
    await expect(call("send", "Follow the agreed workout daily. Want reminders?")).resolves.toMatchObject({ result: { status: "sent" } });
    expect(m.create).toHaveBeenCalledOnce(); expect(m.capacity).toHaveBeenCalledOnce(); expect(m.attachRoute).toHaveBeenCalledOnce();
  });
  it("persists the generated first message before provider entry and attaches its exact runtime", async () => {
    const result = await call("send", "You are both in for daily reading. Want reminders for the first few days?");
    expect(result).toMatchObject({ result: { status: "sent", chatId: "external_chat", providerMessageId: "first_message" } });
    expect(m.sequence).toEqual(["persist", "provider", "persist", "attach", "attached"]);
    expect(m.create).toHaveBeenCalledExactlyOnceWith({ from: "+15555550100", to: phones, message: "You are both in for daily reading. Want reminders for the first few days?", idempotencyKey: eventId });
    expect(m.attachRoute).toHaveBeenCalledWith(expect.objectContaining({ gameId, prepared: { containerMemberId: "room" } }));
  });
  it("marks an accepted proposal sent without rewriting its sealed terms envelope", async () => {
    await call("send", "Original generated proposal");
    const proposalEventId = `game-change:${gameId}:proposal_sample`;
    const sealed = { v: 2, id: "proposal_sample", deliveryStatus: "queued", termsWordsEncrypted: "sealed-sentinel" };
    m.frozen = { ...m.frozen, eventId: proposalEventId };
    m.game.mockResolvedValue({ ...game(), pendingChange: sealed });
    m.wake.mockResolvedValue({ kind: "assistant.notification.requested", notification: { gameChatBootstrap: { gameId, eventId: proposalEventId }, route: { delivery: { kind: "bootstrap", target: "room" } } } });
    m.updateGame.mockClear();
    await expect(handleGameChatBootstrapControl({ memberId: "room", runtimeIdentity: null, request: { action: "game_chat_bootstrap", gameId, eventId: proposalEventId, operation: "recover" } })).resolves.toMatchObject({ result: { status: "sent" } });
    const [parts, ...values] = m.writeMetadata.mock.calls[0]!;
    expect(parts.join("?")).toContain(`jsonb_set(pending_change, '{deliveryStatus}', '"sent"'::jsonb)`);
    expect(values).toEqual([gameId, "room", "proposal_sample"]);
    expect(m.updateGame).not.toHaveBeenCalled();
    expect(sealed.termsWordsEncrypted).toBe("sealed-sentinel"); expect(sealed.v).toBe(2);
  });
  it("replays only the frozen text and identity after an uncertain provider result", async () => {
    m.create.mockRejectedValueOnce(new Error("Response lost"));
    await expect(call("send", "Original generated kickoff")).rejects.toThrow("Response lost");
    await expect(call("recover")).resolves.toMatchObject({ result: { status: "sent", message: "Original generated kickoff" } });
    expect(m.create.mock.calls.map(([request]) => request)).toEqual([
      { from: "+15555550100", to: phones, message: "Original generated kickoff", idempotencyKey: eventId },
      { from: "+15555550100", to: phones, message: "Original generated kickoff", idempotencyKey: eventId },
    ]);
    expect(m.capacity).toHaveBeenCalledOnce();
  });
  it("recovers a committed provider receipt without a second create when route attachment fails", async () => {
    m.attachRoute.mockRejectedValueOnce(new Error("Retry attachment"));
    await expect(call("send", "Frozen kickoff")).rejects.toThrow("Retry attachment");
    await expect(call("recover")).resolves.toMatchObject({ result: { status: "sent", message: "Frozen kickoff" } });
    expect(m.create).toHaveBeenCalledOnce(); expect(m.attachRoute).toHaveBeenCalledTimes(2);
  });
  it("minute recovery attaches a frozen accepted receipt without a model, runtime lease, or second provider send", async () => {
    m.attachRoute.mockRejectedValueOnce(new Error("Retry attachment"));
    await expect(call("send", "Original kickoff")).rejects.toThrow("Retry attachment");
    m.runtime.mockRejectedValue(new Error("There is no current runtime"));
    await expect(reconcileFrozenGameChatBootstrap(gameId, eventId, "room")).resolves.toBe(true);
    expect(m.create).toHaveBeenCalledOnce();
  });
  it("finishes route attachment after game settlement when the provider already accepted", async () => {
    m.attachRoute.mockRejectedValueOnce(new Error("Retry attachment"));
    await expect(call("send", "Original kickoff")).rejects.toThrow("Retry attachment");
    m.game.mockResolvedValue({ ...game(), status: "settled" });
    await expect(reconcileFrozenGameChatBootstrapReceipt("delivery")).resolves.toBe(true);
    expect(m.attached).toBe(true); expect(m.create).toHaveBeenCalledOnce();
    m.chat.mockClear();
    await expect(reconcileFrozenGameChatBootstrapReceipt("delivery")).resolves.toBe(true);
    expect(m.chat).not.toHaveBeenCalled();
  });
  it("retires an ambiguous create after game cancellation without regenerating or resending", async () => {
    m.create.mockRejectedValueOnce(new Error("Response lost"));
    await expect(call("send", "Original kickoff")).rejects.toThrow("Response lost");
    m.game.mockResolvedValue({ ...game(), status: "void" });
    await expect(reconcileFrozenGameChatBootstrapReceipt("delivery")).resolves.toBe(false);
    expect(m.markReceipt).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ skippedAt: expect.any(Date), skipReason: "game_bootstrap_authority_changed", retryAfterAt: null }) }));
    await expect(call("recover")).resolves.toMatchObject({ result: { status: "unavailable" } });
    await expect(call("send", "Replacement text")).resolves.toMatchObject({ result: { status: "unavailable" } });
    expect(m.create).toHaveBeenCalledOnce(); expect(m.attached).toBe(false);
  });
  it("minute recovery cannot invent a message without an admitted frozen receipt", async () => {
    await expect(reconcileFrozenGameChatBootstrap(gameId, eventId, "room")).resolves.toBe(false);
    expect(m.create).not.toHaveBeenCalled(); expect(m.claim).not.toHaveBeenCalled();
  });
  it("cannot turn an arbitrary or cancelled event into sending authority", async () => {
    m.wake.mockResolvedValueOnce(null);
    expect(await call("send", "Do not send")).toMatchObject({ result: { status: "unavailable" } });
    m.game.mockResolvedValueOnce({ ...game(), status: "void" });
    expect(await call("send", "Do not send")).toMatchObject({ result: { status: "unavailable" } });
    expect(m.create).not.toHaveBeenCalled(); expect(m.claim).not.toHaveBeenCalled();
  });
  it("rejects current runtime authority loss before frozen message dispatch", async () => {
    m.runtime.mockRejectedValue(new Error("Stale runtime"));
    await expect(call("send", "Do not send")).rejects.toThrow("Stale runtime");
    expect(m.create).not.toHaveBeenCalled();
  });
  it("rechecks the current game binding before replaying an ambiguous provider effect", async () => {
    m.create.mockRejectedValueOnce(new Error("Response lost"));
    await expect(call("send", "Original kickoff")).rejects.toThrow("Response lost");
    m.game.mockResolvedValueOnce(game()).mockResolvedValueOnce(null);
    await expect(call("recover")).rejects.toThrow("no longer owns its workspace");
    expect(m.create).toHaveBeenCalledOnce();
  });
  it("never binds a provider room with an extra participant", async () => {
    m.chat.mockResolvedValue({ exact: false });
    await expect(call("send", "Frozen kickoff")).rejects.toThrow("participants could not be verified");
    expect(m.attachRoute).not.toHaveBeenCalled();
  });
});
