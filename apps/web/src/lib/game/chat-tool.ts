import "server-only";

import { isGameMemberSet } from "./roster";
import { handleGameChatPhoto } from "./chat-photo";
import type { Prisma } from "@prisma/client";
import { isHostedLinqConversationMessageWake, isHostedTelegramConversationMessageWake } from "@murphai/hosted-execution";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import { parseGameRecapEventId, GAME_LIVE_LORE_GUIDANCE, hostedGameChatStateSchema, type HostedGameChatState, type HostedGameToolRequest, type HostedGameToolResponse, type HostedGameRecap } from "@murphai/hosted-execution/runtime-control";
import type { HostedExecutionExternalThreadRouteAuthority, HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
import { requireHostedRuntimeCallbackTx, type HostedRuntimeIdentity } from "../hosted-execution/runtime-owner";
import { buildHostedMailboxLiveItemWhere, decodeHostedMailboxStoredPayloads, readHostedMailboxConversationWakeByAssistantInputId } from "../hosted-mailbox/store";
import { requireHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { resolveHostedGroupMessageSenderMemberId } from "../hosted-groups/group-message-sender";
import { assertHostedThreadRouteEgressAuthority } from "../hosted-routing/thread-route-store";
import { getPrisma } from "../prisma";
import { readGameChatState, readGameChatProfiles, readGameRecapMaterial, runGameCommand, runGameChatUpdate, sealGameRecap } from "./service";
import { gameRecapMessage } from "./recap-message";
import { gameRecapToolResult, validateGameRecap, withValidGameSuperlatives, type GameRecapChatMessage } from "./recap";
import { addressedGameRematchWhere, gameChatPlayerIds, gamePairWhere, readGameChatPlayerIds, readGameChatAudience, readGroupGameChatAuthority, type GameChatAudience, hasGameChatRestriction, requireExactGameChat, sameGamePlayers } from "./chat-membership";
import { isGameEnabled, isGameOn } from "./access";
import { gameGroupLoreFingerprint, gamePairLoreFingerprint } from "./audience";

type Input = { audience?: GameChatAudience; multiplayer?: boolean; memberId: string; runtimeIdentity: HostedRuntimeIdentity | null; request: HostedGameToolRequest; playerMemberIds?: readonly string[] };

/** The signed runtime selects only a game and accepted Message ref, never an actor. */
export async function handleGameChatTool(input: Input): Promise<HostedGameToolResponse> {
  if (!isGameEnabled()) return { action: input.request.action, result: { status: "unavailable", error: "GAME_DISABLED: Games are unavailable right now." } };
  if (input.request.origin.kind !== "accepted_input") return handleNonPlayerOriginGameTool(input);
  const prisma = getPrisma();
  if (input.multiplayer) {
    try { input = { ...input, audience: await readGameChatAudience(input.memberId) }; }
    catch { return { action: input.request.action, result: { status: "unavailable", error: "Game chat sharing is unavailable." } }; }
  }
  const actor = await prisma.$transaction((tx) => authorizeGameChatActorTx(input, tx));
  if (!actor) return { action: input.request.action, result: { status: "unavailable", error: "Use the game’s exact group chat with Murph, or start in the app." } };
  let playerMemberIds: readonly string[];
  try { playerMemberIds = input.audience?.memberIds ?? await requireExactGameChat(input.memberId, input.multiplayer); }
  catch { return { action: input.request.action, result: { status: "unavailable", error: "Use the game’s exact group chat with Murph, or start in the app." } }; }
  if (!supportsGameChatRoster(input, playerMemberIds) || !playerMemberIds.includes(actor)) return { action: input.request.action, result: { status: "unavailable", error: "game_player_unavailable" } };
  if (!isGameOn({ players: playerMemberIds.map(memberId => ({ memberId })) })) return { action: input.request.action, result: { status: "unavailable", error: "GAME_DISABLED: Games are invite-only for now." } };
  let dayOutcome: Extract<Awaited<ReturnType<typeof runGameCommand>>, { ok: true }>["dayOutcome"];
  let photoResult: Awaited<ReturnType<typeof handleGameChatPhoto>> | null = null;
  if (input.request.action === "game_photo") {
    const photo = input.request.photo;
    photoResult = await handleGameChatPhoto({ multiplayer: input.multiplayer, actor, containerMemberId: input.memberId, playerMemberIds,
      messageRef: input.request.origin.assistantInputId, photo,
      authorize: async (tx, messageRef) => {
        const scoped: Input = { audience: input.audience, multiplayer: input.multiplayer, memberId: input.memberId, runtimeIdentity: input.runtimeIdentity, playerMemberIds,
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
    const result = await runGameChatUpdate({
      actorMemberId: actor,
      multiplayer: input.multiplayer,
      chatContainerMemberId: input.memberId,
      chatPlayerMemberIds: playerMemberIds,
      chatAudience: input.audience,
      update,
      beforeMutationTx: async (tx) => {
        if (await authorizeGameChatActorTx({ ...input, playerMemberIds }, tx) !== actor) throw new TypeError("Game player authority changed.");
      },
    });
    // GameView is a personal app view. Never pass it into the shared runtime.
    // Rule messages name only the rule and next step, so Murph can explain a refusal.
    if (!result.ok) return { action: input.request.action, result: { status: "rejected", error: `${result.error.code}: ${result.error.message}`.slice(0, 128) } };
    dayOutcome = result.dayOutcome;
  }
  if (input.request.action !== "read_game") {
    const refreshed = await refreshGameChatAudience(input, playerMemberIds);
    if (!refreshed) throw new TypeError("Game chat participants changed.");
    input = refreshed;
  }
  return gameChatToolResponse(input, playerMemberIds, actor, dayOutcome, photoResult);
}

/** Preserve the fresh complete handle proof through the post-mutation projection. */
async function refreshGameChatAudience(input: Input, players: readonly string[]): Promise<Input | null> {
  if (!input.multiplayer) {
    return sameRoomIdentities(await requireExactGameChat(input.memberId), players) ? input : null;
  }
  const audience = await readGameChatAudience(input.memberId);
  const previous = input.audience;
  if (!previous || audience.threadId !== previous.threadId
    || !audience.keys.candidates.some(key => previous.keys.candidates.includes(key))
    || !sameRoomIdentities(audience.memberIds, players)) return null;
  return { ...input, audience };
}

function supportsGameChatRoster(input: Input, players: readonly string[]): boolean {
  return input.multiplayer === true ? players.length > 0 && players.length <= 10 && new Set(players).size === players.length : isGameMemberSet(players) && players.length === 2;
}

async function gameChatToolResponse(input: Input, playerMemberIds: readonly string[], actor: string,
  dayOutcome: Extract<Awaited<ReturnType<typeof runGameCommand>>, { ok: true }>["dayOutcome"],
  photoResult: Awaited<ReturnType<typeof handleGameChatPhoto>> | null): Promise<HostedGameToolResponse> {
  const state = await readGameToolState(input, playerMemberIds, actor);
  const lore = input.request.action === "read_game" ? await readGameToolLore(state, playerMemberIds) : {};
  return { action: input.request.action, result: { status: "ok", state, ...lore, ...(dayOutcome ? { dayOutcome } : {}), ...(photoResult?.photoOutcome ? { photoOutcome: photoResult.photoOutcome } : {}) } };
}

/** Resolve only authorized returned games, including non-live games; never expose audience keys. */
async function readGameToolLore(state: HostedGameChatState, players: readonly string[]): Promise<{ loreGuidance?: string; loreFingerprint?: string }> {
  if (!state.games.some(game => game.status === "live")) return {};
  const rows = await getPrisma().game.findMany({ where: { id: { in: state.games.map(game => game.id) } },
    select: { id: true, maxPlayers: true, audienceKey: true }, take: state.games.length });
  const keys = state.games.map(game => {
    const row = rows.find(row => row.id === game.id);
    if (row?.maxPlayers === 10) return row.audienceKey ? gameGroupLoreFingerprint(row.audienceKey) : null;
    return row?.maxPlayers === 2 && players.length === 2 ? gamePairLoreFingerprint(players) : null;
  });
  const key = keys[0];
  return key && keys.every(candidate => candidate === key) ? { loreGuidance: GAME_LIVE_LORE_GUIDANCE, loreFingerprint: key } : {};
}

function sameRoomIdentities(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(id => right.includes(id));
}

/** Preserve the unmarked response shape for older strict runtime readers. */
async function readGameToolState(input: Input, playerMemberIds: readonly string[], actor?: string) {
  const state = await readGameChatState(input.memberId, playerMemberIds, actor, input.multiplayer === true, ...(input.audience ? [input.audience] : []));
  const groupRoom = input.multiplayer && (state.games.some(game => game.maxPlayers === 10) || Boolean(await getPrisma().game.findFirst({ where: { maxPlayers: 10, chatContainerMemberId: input.memberId }, select: { id: true } })));
  const visiblePlayers = groupRoom
    ? [...new Set(state.games.flatMap(game => game.players.map(player => player.memberId)))] : playerMemberIds;
  return hostedGameChatStateSchema.parse({ ...state,
    ...(input.request.action === "read_game" && input.request.includePlayers && visiblePlayers.length ? { players: (await readGameChatProfiles(visiblePlayers)).map(player => ({ ...player, isSender: player.memberId === actor })) } : {}),
  });
}

/** Recap and scheduled origins never resolve a player actor. */
function handleNonPlayerOriginGameTool(input: Input): Promise<HostedGameToolResponse> {
  if (input.request.origin.kind === "game_recap") return handleGameRecapTool(input as Input & { request: Extract<HostedGameToolRequest, { action: "read_game" | "write_recap" }> & { origin: { kind: "game_recap" } } });
  return handleScheduledGameRead(input);
}

/** A verified room occurrence can read shared state without acting for a player. */
async function handleScheduledGameRead(input: Input): Promise<HostedGameToolResponse> {
  if (input.request.action !== "read_game") return { action: input.request.action, result: { status: "unavailable", error: "game_player_unavailable" } };
  await getPrisma().$transaction(async (tx) => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
  });
  let players: readonly string[];
  try {
    if (input.multiplayer) input = { ...input, audience: await readGameChatAudience(input.memberId) };
    players = input.audience?.memberIds ?? await requireExactGameChat(input.memberId);
  }
  catch { return { action: "read_game", result: { status: "unavailable", error: "Use the game’s exact group chat with Murph, or start in the app." } }; }
  if (!input.multiplayer && players.length !== 2) return { action: "read_game", result: { status: "unavailable", error: "game_player_unavailable" } };
  if (!isGameOn({ players: players.map(memberId => ({ memberId })) })) return { action: "read_game", result: { status: "unavailable", error: "GAME_DISABLED: Games are invite-only for now." } };
  const state = await readGameToolState(input, players);
  const lore = await readGameToolLore(state, players);
  return { action: "read_game", result: { status: "ok", state, ...lore } };
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
  const players = input.audience?.memberIds ?? await readGameChatPlayerIds(input.memberId, tx);
  if (!players.includes(actor) || (input.playerMemberIds && !sameRoomIdentities(players, input.playerMemberIds))) return null;
  if (!supportsGameChatRoster(input, players)) return null;
  return await canRunGameChatRequestTx(input, players, tx) ? actor : null;
}

/** Reads/creation may precede a game; all other effects require its current room. */
async function canRunGameChatRequestTx(input: Input, players: readonly string[], tx: Prisma.TransactionClient): Promise<boolean> {
  if (input.request.action === "read_game" || (input.request.action === "update_game" && input.request.update.operation === "create")) return true;
  const game = await tx.game.findFirst({
    where: { OR: [{ ...gamePairWhere(players), status: { in: ["negotiating", "live", "settled"] } }, addressedGameRematchWhere(players), ...(input.multiplayer ? [{ maxPlayers: 10, chatContainerMemberId: input.memberId }] : [])], ...(input.request.action === "update_game" ? { id: input.request.update.gameId } : input.request.action === "game_photo" ? { id: input.request.photo.gameId } : {}) },
    include: { invitees: true, players: { take: 11 } },
  });
  if (!game || !isGameOn(game)) return false;
  if (game.maxPlayers === 10) {
    if (!input.multiplayer || !input.audience || game.chatContainerMemberId !== input.memberId || !await readGroupGameChatAuthority(game, input.memberId, input.audience, tx)) return false;
  } else if (input.audience && input.audience.contacts.length !== 2 || !areGamePlayersAllowed(game, players)) return false;
  return true;
}

async function handleGameRecapTool(input: Input & { request: Extract<HostedGameToolRequest, { action: "read_game" | "write_recap" }> & { origin: { kind: "game_recap"; gameId: string; eventId: string } } }): Promise<HostedGameToolResponse> {
  const { gameId, eventId } = input.request.origin;
  if (parseGameRecapEventId(eventId)?.gameId !== gameId) return { action: input.request.action, result: { status: "unavailable", error: "recap_authority_unavailable" } };
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
  });
  const players = await requireExactGameChat(input.memberId, input.multiplayer);
  if (!supportsGameChatRoster(input, players)) return { action: input.request.action, result: { status: "unavailable", error: "recap_authority_unavailable" } };
  const audience = input.multiplayer ? await readGameChatAudience(input.memberId) : undefined;
  const material = await readGameRecapMaterial(gameId, input.memberId, players);
  if (!material || (!input.multiplayer && material.validation.group) || !material.validation.group && audience && (audience.contacts.length !== 2 || await hasGameChatRestriction(prisma, audience.memberIds))) return { action: input.request.action, result: { status: "unavailable", error: "recap_authority_unavailable" } };
  if (input.request.action === "read_game") return { action: "read_game", result: { status: "ok", recapGame: material.game } };
  const authorizeMutation = async (tx: Prisma.TransactionClient) => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
  };
  const replay = await sealGameRecap({ beforeMutationTx: authorizeMutation, containerMemberId: input.memberId,
    eventId, gameId, playerMemberIds: players, recap: null });
  if (replay) return { action: "write_recap", result: { status: "ok", recapOutcome: gameRecapToolResult([]), recap: recapForWriter(replay, input.request.recap), chatLine: gameRecapMessage(gameId, replay.chatLine) } };
  const chatMessages = await readGameRecapChatMessages({ containerMemberId: input.memberId, material });
  const errors = validateGameRecap({ recap: input.request.recap, players: material.players, entries: material.entries,
    chatMessages, priorChatLines: input.request.priorChatLines, result: material.validation.result, group: material.validation.group });
  if (errors.length > 0) return { action: "write_recap", result: { status: "rejected", recapOutcome: gameRecapToolResult(errors) } };
  if (!await refreshGameChatAudience({ ...input, audience }, players)) return { action: "write_recap", result: { status: "unavailable", error: "recap_authority_unavailable" } };
  const saved = await sealGameRecap({ beforeMutationTx: authorizeMutation, containerMemberId: input.memberId, eventId, gameId, playerMemberIds: players, recap: withValidGameSuperlatives(input.request.recap, material.validation.result.map(player => player.memberId)) });
  return saved
    ? { action: "write_recap", result: { status: "ok", recapOutcome: gameRecapToolResult([]), recap: recapForWriter(saved, input.request.recap), chatLine: gameRecapMessage(gameId, saved.chatLine) } }
    : { action: "write_recap", result: { status: "unavailable", error: "recap_authority_unavailable" } };
}

// Older runtime schemas reject unknown fields, including on replay of a newer story.
function recapForWriter(saved: HostedGameRecap, submitted: HostedGameRecap): HostedGameRecap {
  if (submitted.superlatives) return saved;
  const { superlatives: _superlatives, ...legacy } = saved;
  return legacy;
}

export async function readGameRecapChatMessages(input: {
  containerMemberId: string;
  material: NonNullable<Awaited<ReturnType<typeof readGameRecapMaterial>>>;
}): Promise<GameRecapChatMessage[]> {
  return readGameChatTranscript({
    containerMemberId: input.containerMemberId,
    playerNamesByMemberId: input.material.validation.playerNamesByMemberId,
    since: input.material.validation.startedAt,
    // Bound transcript by this game's dates; concurrent tasks still share the room.
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


function areGamePlayersAllowed(game: Parameters<typeof gameChatPlayerIds>[0], expected: readonly string[]): boolean {
  const players = gameChatPlayerIds(game);
  if (!isGameMemberSet(players) || !isGameOn(game)) return false;
  return sameGamePlayers(players, expected);
}
