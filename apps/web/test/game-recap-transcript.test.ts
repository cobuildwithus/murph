import { beforeEach, expect, it, vi } from "vitest";
import { readRecapTranscriptPage } from "@/src/lib/game/recap-transcript";
import { createHostedEmailLookupKey } from "@/src/lib/hosted-onboarding/contact-privacy";

const m = vi.hoisted(() => ({ game: vi.fn(), prior: vi.fn(), create: vi.fn(), last: vi.fn(), rows: vi.fn(),
  decode: vi.fn(), sender: vi.fn(), latest: vi.fn(), entries: vi.fn() }));
vi.mock("@/src/lib/prisma", () => {
  const tx = { $queryRaw: vi.fn(), game: { findUnique: m.game }, gameEvent: { findUnique: m.prior, create: m.create },
    hostedMailboxItem: { findFirst: m.last, findMany: m.rows } };
  return { getPrisma: () => ({ ...tx, $transaction: (run: (value: typeof tx) => unknown) => run(tx) }) };
});
vi.mock("@/src/lib/hosted-mailbox/store", () => ({ buildHostedMailboxLiveItemWhere: () => ({ contentExpiredAt: null }), decodeHostedMailboxStoredPayloads: m.decode }));
vi.mock("@/src/lib/hosted-groups/group-message-sender", () => ({ resolveHostedGroupMessageSenderMemberId: m.sender }));
vi.mock("@/src/lib/game/recap-witness", () => ({ readLatestGameRecapEventIdTx: m.latest, readGameRecapEntryIdsTx: m.entries }));

const input = { containerMemberId: "synthetic-room", gameId: "synthetic-game", eventId: "synthetic-event",
  players: [{ memberId: "synthetic-player", name: "Player A" }], since: new Date(Date.now() - 86_400_000), until: new Date(), beforeMutationTx: async () => {} };
const row = (index: number) => ({ id: `synthetic-row-${index}`, userId: input.containerMemberId, dedupeKey: `synthetic-${index}`,
  kind: "conversation.message", lane: "conversation", laneSeq: BigInt(index), occurredAt: input.since, payloadSchema: "synthetic", payload: null });
const wake = () => ({ eventId: "synthetic-ingress", kind: "conversation.message", userId: input.containerMemberId, occurredAt: input.since.toISOString(),
  message: { channel: "linq", contactKind: "email", contactLookupKey: createHostedEmailLookupKey("player@example.test"),
    routeAuthority: { channel: "linq", containerMemberId: input.containerMemberId, threadId: "synthetic-thread" },
    linqMessage: { chatId: "synthetic-thread", from: "player@example.test", isFromMe: false, threadIsDirect: false,
      messageId: "synthetic-message", parts: [{ type: "text", value: "The synthetic mat survived." }] } } });

beforeEach(() => {
  vi.resetAllMocks();
  m.game.mockResolvedValue({ id: input.gameId, status: "settled", chatContainerMemberId: input.containerMemberId,
    players: [{ memberId: "synthetic-player", leftAt: null }] });
  m.latest.mockResolvedValue(input.eventId); m.entries.mockResolvedValue(new Set()); m.prior.mockResolvedValue(null);
  m.last.mockResolvedValue({ laneSeq: 205n }); m.rows.mockResolvedValue([]); m.decode.mockResolvedValue([]);
  m.sender.mockResolvedValue("synthetic-player");
});

it("bounds each page and reuses the settled watermark across pages", async () => {
  m.rows.mockResolvedValue(Array.from({ length: 200 }, (_, index) => row(index + 1)));
  m.decode.mockResolvedValue(Array.from({ length: 200 }, wake));
  const first = await readRecapTranscriptPage(input);
  expect(first).toMatchObject({ through: "205", next: "200", incomplete: false });
  expect(first.messages).toHaveLength(200);
  expect(m.sender).toHaveBeenCalledTimes(1);
  m.prior.mockResolvedValue({ payload: { v: 1, through: "205" } }); m.rows.mockResolvedValue([row(205)]); m.decode.mockResolvedValue([wake()]);
  expect(await readRecapTranscriptPage({ ...input, after: "200" })).toMatchObject({ next: null, through: "205" });
  expect(m.last).toHaveBeenCalledTimes(1);
  expect(m.rows).toHaveBeenLastCalledWith(expect.objectContaining({ take: 200, where: expect.objectContaining({
    userId: input.containerMemberId, contentExpiredAt: null, laneSeq: { gt: 200n, lte: 205n } }) }));
});

it("reports malformed and missing retained content while excluding other rooms and Murph ingress", async () => {
  const foreign = wake(); foreign.message.routeAuthority.containerMemberId = "another-room";
  const ownReply = wake(); ownReply.message.linqMessage.isFromMe = true;
  const payloads = [null, { kind: "obsolete-malformed" }, foreign, ownReply, wake()];
  m.rows.mockResolvedValue(payloads.map((_, index) => row(index + 1))); m.decode.mockResolvedValue(payloads);
  const result = await readRecapTranscriptPage(input);
  expect(result.incomplete).toBe(true);
  expect(result.messages.map(message => message.text)).toEqual(["The synthetic mat survived."]);
  expect(m.sender).toHaveBeenCalledTimes(1);
});

it("revalidates the latest generation before reading ciphertext", async () => {
  m.latest.mockResolvedValue("replacement-generation");
  await expect(readRecapTranscriptPage(input)).rejects.toThrow("authority changed");
  expect(m.rows).not.toHaveBeenCalled(); expect(m.decode).not.toHaveBeenCalled();
});
