import "server-only";
import { handleGameChatPhoto } from "./chat-photo";
import type { Prisma } from "@prisma/client";
import { isHostedLinqConversationMessageWake, isHostedTelegramConversationMessageWake } from "@murphai/hosted-execution";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import { gameLiveLoreGuidanceForState, hostedGameChatStateSchema, type HostedGameToolRequest, type HostedGameToolResponse } from "@murphai/hosted-execution/runtime-control";
import type { HostedExecutionExternalThreadRouteAuthority, HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
import { requireHostedRuntimeCallbackTx, type HostedRuntimeIdentity } from "../hosted-execution/runtime-owner";
import { buildHostedMailboxLiveItemWhere, decodeHostedMailboxStoredPayloads, readHostedMailboxConversationWakeByAssistantInputId } from "../hosted-mailbox/store";
import { requireHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { resolveHostedGroupMessageSenderMemberId } from "../hosted-groups/group-message-sender";
import { assertHostedThreadRouteEgressAuthority } from "../hosted-routing/thread-route-store";
import { getPrisma } from "../prisma";
import { readGameChatState, readGameRecapMaterial, runGameCommand, sealGameRecap } from "./service";
import { gameRecapMessage } from "./recap-message";
import { gameRecapToolResult, validateGameRecap, type GameRecapChatMessage } from "./recap";
import { gameChatLifecycleEventId } from "./chat-lifecycle-receipt";
import { gamePairWhere, readGameChatPlayerIds, requireExactGameChat, sameGamePlayers } from "./chat-membership";
import { isGameEnabled, isGameOn } from "./access";
import { gamePairLoreFingerprint } from "./pair-fingerprint";

type Input = { memberId: string; runtimeIdentity: HostedRuntimeIdentity | null; request: HostedGameToolRequest; playerMemberIds?: readonly string[] };

/** The signed runtime selects only a game and accepted Message ref, never an actor. */
export async function handleGameChatTool(input: Input): Promise<HostedGameToolResponse> {
  if (!isGameEnabled()) return { action: input.request.action, result: { status: "unavailable", error: "game_unavailable" } };
  if (input.request.origin.kind === "game_recap") return handleGameRecapTool(input as Input & { request: Extract<HostedGameToolRequest, { action: "read_game" | "write_recap" }> & { origin: { kind: "game_recap" } } });
  const prisma = getPrisma();
  const actor = await prisma.$transaction((tx) => authorizeGameChatActorTx(input, tx));
  if (!actor) return { action: input.request.action, result: { status: "unavailable", error: "game_player_unavailable" } };
  const playerMemberIds = await requireExactGameChat(input.memberId);
  if (!playerMemberIds.includes(actor)) return { action: input.request.action, result: { status: "unavailable", error: "game_player_unavailable" } };
  let dayOutcome: Extract<Awaited<ReturnType<typeof runGameCommand>>, { ok: true }>["dayOutcome"];
  let photoResult: Awaited<ReturnType<typeof handleGameChatPhoto>> | null = null;
  if (input.request.action === "game_photo") {
    const photo = input.request.photo;
    photoResult = await handleGameChatPhoto({ actor, containerMemberId: input.memberId, playerMemberIds,
      messageRef: input.request.origin.assistantInputId, photo,
      authorize: async (tx, messageRef) => {
        const scoped: Input = { memberId: input.memberId, runtimeIdentity: input.runtimeIdentity, playerMemberIds,
          request: { action: "game_photo", photo, origin: { kind: "accepted_input", assistantInputId: messageRef } } };
        const sourceActor = await authorizeGameChatActorTx(scoped, tx);
        const wake = sourceActor ? await readHostedMailboxConversationWakeByAssistantInputId({ assistantInputId: messageRef, availableAt: new Date(), memberId: input.memberId, prisma: tx }) : null;
        return { actor: sourceActor, wake };
      },
    });
    if (photoResult.status !== "ok") return { action: input.request.action, result: photoResult };
  }
  if (input.request.action === "update_game") {
    const update = input.request.update;
    const command = "date" in update
      ? { type: "setDayCompletion", gameId: update.gameId, date: update.date, incomplete: update.operation === "mark_incomplete" }
      : update.operation === "cancel_game"
      ? { type: "cancelInvite", gameId: update.gameId }
      : update.operation === "propose"
      ? { type: "proposeChange", gameId: update.gameId, proposalId: update.proposalId, expectedTermsVersion: update.expectedTermsVersion, change: update.change }
      : { type: "respondChange", gameId: update.gameId, proposalId: update.proposalId, decision: update.operation };
    const result = await runGameCommand({
      actorMemberId: actor,
      chatContainerMemberId: input.memberId,
      chatPlayerMemberIds: playerMemberIds,
      command,
      beforeMutationTx: async (tx) => {
        if (await authorizeGameChatActorTx({ ...input, playerMemberIds }, tx) !== actor) throw new TypeError("Game player authority changed.");
      },
    });
    // GameView is a personal app view. Never pass it into the shared runtime.
    // Rule messages name only the rule and next step, so Murph can explain a refusal.
    if (!result.ok) return { action: input.request.action, result: { status: "rejected", error: `${result.error.code}: ${result.error.message}`.slice(0, 128) } };
    dayOutcome = result.dayOutcome;
    const latestPlayers = await requireExactGameChat(input.memberId);
    if (!sameGamePlayers(latestPlayers, playerMemberIds)) throw new TypeError("Game chat participants changed.");
  }
  if (input.request.action === "game_photo" && !sameGamePlayers(await requireExactGameChat(input.memberId), playerMemberIds)) throw new TypeError("Game chat participants changed.");
  const state = hostedGameChatStateSchema.parse(await readGameChatState(input.memberId, playerMemberIds, actor));
  const loreGuidance = input.request.action === "read_game" ? gameLiveLoreGuidanceForState(state) : undefined;
  return { action: input.request.action, result: { status: "ok", state, ...(loreGuidance ? { loreGuidance, loreFingerprint: gamePairLoreFingerprint(playerMemberIds) } : {}), ...(dayOutcome ? { dayOutcome } : {}), ...(photoResult?.photoOutcome ? { photoOutcome: photoResult.photoOutcome } : {}) } };
}

/** A free player may agree to their game without gaining personal AI access. */
export async function authorizeGameChatActorTx(input: Input, tx: Prisma.TransactionClient): Promise<string | null> {
  if (input.request.origin.kind !== "accepted_input") return null;
  await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
  await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
  const wake = await readHostedMailboxConversationWakeByAssistantInputId({
    assistantInputId: input.request.origin.assistantInputId, availableAt: new Date(), memberId: input.memberId, prisma: tx,
  });
  if (!wake || wake.userId !== input.memberId) return null;
  const route = readGameIncomingRoute(wake, input.memberId);
  if (!route) return null;
  await assertHostedThreadRouteEgressAuthority({ authority: route, prisma: tx });
  const actor = await resolveHostedGroupMessageSenderMemberId({ prisma: tx, routeAuthority: route, wake });
  if (!actor) return null;
  const players = await readGameChatPlayerIds(input.memberId, tx);
  if (!players.includes(actor) || (input.playerMemberIds && !sameGamePlayers(players, input.playerMemberIds))) return null;
  const game = await tx.game.findFirst({
    where: { ...gamePairWhere(players), status: { in: ["negotiating", "live", "settled"] }, ...(input.request.action === "update_game" ? { id: input.request.update.gameId } : input.request.action === "game_photo" ? { id: input.request.photo.gameId } : {}) },
    select: { id: true, players: { select: { memberId: true }, take: 3 } },
  });
  if (!game || !areGamePlayersAllowed(game, input.playerMemberIds)) return null;
  return actor;
}

async function handleGameRecapTool(input: Input & { request: Extract<HostedGameToolRequest, { action: "read_game" | "write_recap" }> & { origin: { kind: "game_recap"; gameId: string; eventId: string } } }): Promise<HostedGameToolResponse> {
  const { gameId, eventId } = input.request.origin;
  if (eventId !== gameChatLifecycleEventId(gameId, "recap")) return { action: input.request.action, result: { status: "unavailable", error: "recap_authority_unavailable" } };
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
  });
  const players = await requireExactGameChat(input.memberId);
  if (players.length !== 2) return { action: input.request.action, result: { status: "unavailable", error: "recap_authority_unavailable" } };
  const material = await readGameRecapMaterial(gameId, input.memberId, players);
  if (!material) return { action: input.request.action, result: { status: "unavailable", error: "recap_authority_unavailable" } };
  if (input.request.action === "read_game") return { action: "read_game", result: { status: "ok", recapGame: material.game } };
  const authorizeMutation = async (tx: Prisma.TransactionClient) => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
  };
  const replay = await sealGameRecap({ beforeMutationTx: authorizeMutation, containerMemberId: input.memberId,
    eventId, gameId, playerMemberIds: players, recap: null });
  if (replay) return { action: "write_recap", result: { status: "ok", recapOutcome: gameRecapToolResult([]), recap: replay, chatLine: gameRecapMessage(gameId, replay.chatLine) } };
  const chatMessages = await readGameRecapChatMessages({ containerMemberId: input.memberId, material });
  const errors = validateGameRecap({ recap: input.request.recap, players: material.players, entries: material.entries,
    chatMessages, priorChatLines: input.request.priorChatLines, result: material.validation.result });
  if (errors.length > 0) return { action: "write_recap", result: { status: "rejected", recapOutcome: gameRecapToolResult(errors) } };
  if (!sameGamePlayers(await requireExactGameChat(input.memberId), players)) return { action: "write_recap", result: { status: "unavailable", error: "recap_authority_unavailable" } };
  const saved = await sealGameRecap({ beforeMutationTx: authorizeMutation, containerMemberId: input.memberId, eventId, gameId, playerMemberIds: players, recap: input.request.recap });
  return saved
    ? { action: "write_recap", result: { status: "ok", recapOutcome: gameRecapToolResult([]), recap: saved, chatLine: gameRecapMessage(gameId, saved.chatLine) } }
    : { action: "write_recap", result: { status: "unavailable", error: "recap_authority_unavailable" } };
}

export async function readGameRecapChatMessages(input: {
  containerMemberId: string;
  material: NonNullable<Awaited<ReturnType<typeof readGameRecapMaterial>>>;
}): Promise<GameRecapChatMessage[]> {
  return readGameChatTranscript({
    containerMemberId: input.containerMemberId,
    playerNamesByMemberId: input.material.validation.playerNamesByMemberId,
    since: input.material.validation.startedAt,
    // The game's own chat: a recap written later never reads the next game's.
    until: input.material.validation.settledAt ?? undefined,
  });
}

export async function readGameChatTranscript(input: {
  containerMemberId: string;
  playerNamesByMemberId: readonly { memberId: string; name: string }[];
  since: Date;
  until?: Date;
}): Promise<GameRecapChatMessage[]> {
  const prisma = getPrisma();
  const availableAt = new Date();
  const rows = await prisma.hostedMailboxItem.findMany({
    orderBy: { laneSeq: "desc" }, take: 100,
    where: { ...buildHostedMailboxLiveItemWhere(availableAt), userId: input.containerMemberId,
      kind: "conversation.message", lane: "conversation", occurredAt: { gte: input.since, ...(input.until ? { lte: input.until } : {}) } },
    select: { id: true, userId: true, dedupeKey: true, kind: true, lane: true, laneSeq: true, occurredAt: true,
      payloadInlineCiphertext: true, payloadSchema: true, payload: { select: { payloadCiphertext: true } } },
  });
  const decoded = await decodeHostedMailboxStoredPayloads({ prisma, entries: rows.map((row) => ({
    dedupeKey: row.dedupeKey, kind: row.kind, lane: row.lane, laneSeq: row.laneSeq, mailboxItemId: row.id,
    occurredAt: row.occurredAt.toISOString(), payloadCiphertext: row.payload?.payloadCiphertext,
    payloadInlineCiphertext: row.payloadInlineCiphertext, payloadSchema: row.payloadSchema, userId: row.userId,
  })) });
  const names = new Map(input.playerNamesByMemberId.map((player) => [player.memberId, player.name]));
  const senderIds = new Map<string, Promise<string | null>>();
  const messages: GameRecapChatMessage[] = [];
  for (const payload of decoded.reverse()) {
    if (!payload) continue;
    const wake = parseHostedExecutionWake(payload);
    if (wake.kind !== "conversation.message") continue;
    let routeAuthority: HostedExecutionExternalThreadRouteAuthority | null;
    let senderKey: string;
    let text: string;
    if (isHostedLinqConversationMessageWake(wake)) {
      routeAuthority = wake.message.routeAuthority ?? null;
      senderKey = `linq:${wake.message.linqMessage.from}`;
      text = wake.message.linqMessage.parts.filter((part) => part.type === "text").map((part) => part.value).join("\n");
    } else if (isHostedTelegramConversationMessageWake(wake)) {
      routeAuthority = wake.message.routeAuthority ?? null;
      senderKey = `telegram:${wake.message.telegramMessage.from ?? ""}`;
      text = wake.message.telegramMessage.text?.trim() ?? "";
    } else continue;
    if (!routeAuthority) continue;
    const existing = senderIds.get(senderKey);
    const pending = existing ?? resolveHostedGroupMessageSenderMemberId({ prisma, routeAuthority, wake });
    if (!existing) senderIds.set(senderKey, pending);
    const senderMemberId = await pending;
    const playerName = senderMemberId ? names.get(senderMemberId) : undefined;
    if (!playerName) continue;
    if (text) messages.push({ playerName, text });
  }
  return messages;
}

function readGameIncomingRoute(wake: HostedExecutionConversationMessageWake, containerMemberId: string): HostedExecutionExternalThreadRouteAuthority | null {
  const message = wake.message;
  if (message.channel !== "linq" && message.channel !== "telegram") return null;
  const route = message.routeAuthority;
  if (!route || route.containerMemberId !== containerMemberId) return null;
  if (message.channel === "linq") {
    return message.linqMessage.isFromMe === false && message.linqMessage.threadIsDirect === false && route.channel === "linq" && route.threadId === message.linqMessage.chatId ? route : null;
  }
  if (message.channel === "telegram") {
    return message.telegramMessage.threadIsDirect === false && route.channel === "telegram" && route.threadId === message.telegramMessage.threadId ? route : null;
  }
  return null;
}


function areGamePlayersAllowed(game: { players: readonly { memberId: string }[] }, expected?: readonly string[]): boolean {
  if (game.players.length !== 2 || !isGameOn(game)) return false;
  return expected === undefined || sameGamePlayers(game.players.map((player) => player.memberId), expected);
}
