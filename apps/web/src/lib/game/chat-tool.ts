import { uploadRecapMedia } from './recap-media';
import { retireGameRecapGenerationTx } from './recap-witness';
import { buildRecapFallback } from './recap-fallback';
import { readRecapTranscriptPage } from "./recap-transcript";
import { readRecapSourceReferences, readRecapReferenceBytes, publicRecapReferences } from "./recap-inputs";
import { alignSongLyrics, gameRecapWriterSchema, recapShowWriterSchema } from "@murphai/contracts/recap-show";
import "server-only";

import { isGameMemberSet } from "./roster";
import { handleGameChatPhoto } from "./chat-photo";
import type { Prisma } from "@prisma/client";
import { isHostedLinqConversationMessageWake, isHostedTelegramConversationMessageWake } from "@murphai/hosted-execution";
import { parseHostedExecutionWake } from "@murphai/hosted-execution/parsers";
import { GAME_RECAP_GENERATION_RETIRED, parseGameRecapEventId, GAME_LIVE_LORE_GUIDANCE, hostedGameChatStateSchema, type HostedGameChatState, type HostedGameToolRequest, type HostedGameToolResponse, type HostedGameRecap } from "@murphai/hosted-execution/runtime-control";
import type { HostedExecutionExternalThreadRouteAuthority, HostedExecutionConversationMessageWake } from "@murphai/hosted-execution/contracts";
import { requireHostedRuntimeCallbackTx, type HostedRuntimeIdentity } from "../hosted-execution/runtime-owner";
import { buildHostedMailboxLiveItemWhere, decodeHostedMailboxStoredPayloads, readHostedMailboxConversationWakeByAssistantInputId } from "../hosted-mailbox/store";
import { requireHostedRuntimeActiveAccessForUpdateTx } from "../hosted-mailbox/runtime-access";
import { resolveHostedGroupMessageSenderMemberId } from "../hosted-groups/group-message-sender";
import { lockHostedThreadRouteByThreadIdentityTx, assertHostedThreadRouteEgressAuthority } from "../hosted-routing/thread-route-store";
import { getPrisma } from "../prisma";
import { readGameChatState, readGameChatProfiles, readGameRecapMaterial, runGameCommand, runGameChatUpdate, sealGameRecap } from "./service";
import { isGameRecapGenerationRetired } from "./recap-witness";
import { acceptedGameRecapMessage, gameRecapMessage } from "./recap-message";
import { gameRecapToolResult, validateGameRecap, withValidGameSuperlatives, type GameRecapChatMessage } from "./recap";
import { addressedGameRematchWhere, gameChatPlayerIds, gamePairWhere, readGameChatPlayerIds, readGameChatAudience, readGameChatAuthority, type GameChatAudience, hasGameChatRestriction, requireExactGameChat, sameGamePlayers } from "./chat-membership";
import { isGameEnabled } from "./access";
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
    if (update.operation === "set_reminder") return { action: "update_game", result: { status: "ok", reaches: result.reaches ?? "none" } };
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
  if (!previous || audience.threadId !== previous.threadId) return null;
  await assertHostedThreadRouteEgressAuthority({ authority: audience.route, prisma: getPrisma() });
  return { ...input, audience };
}

function supportsGameChatRoster(input: Input, players: readonly string[]): boolean {
  return input.multiplayer === true ? players.length > 0 && new Set(players).size === players.length : isGameMemberSet(players) && players.length === 2;
}

async function gameChatToolResponse(input: Input, playerMemberIds: readonly string[], actor: string,
  dayOutcome: Extract<Awaited<ReturnType<typeof runGameCommand>>, { ok: true }>["dayOutcome"],
  photoResult: Awaited<ReturnType<typeof handleGameChatPhoto>> | null): Promise<HostedGameToolResponse> {
  const state = await readGameToolState(input, input.audience?.memberIds ?? playerMemberIds, actor);
  const lore = input.request.action === "read_game" ? await readGameToolLore(state, input.audience) : {};
  return { action: input.request.action, result: { status: "ok", state, ...lore, ...(dayOutcome ? { dayOutcome } : {}), ...(photoResult?.photoOutcome ? { photoOutcome: photoResult.photoOutcome } : {}) } };
}

/** Resolve only authorized returned games, including non-live games; never expose audience keys. */
async function readGameToolLore(state: HostedGameChatState, audience?: GameChatAudience): Promise<{ loreGuidance?: string; loreFingerprint?: string }> {
  if (!state.games.some(game => game.status === "live")) return {};
  const rows = await getPrisma().game.findMany({ where: { id: { in: state.games.map(game => game.id) } },
    select: { id: true, maxPlayers: true, audienceKey: true }, take: state.games.length });
  const keys = state.games.map(game => {
    const row = rows.find(row => row.id === game.id);
    if (row?.maxPlayers === 10) return row.audienceKey ? gameGroupLoreFingerprint(row.audienceKey) : null;
    const players = game.players.map(player => player.memberId);
    // Pair notebooks can contain app-only recap details; never expose them to bystanders.
    if (audience && (audience.contacts.length > 2 || !sameGamePlayers(audience.memberIds, players))) return null;
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
  const visiblePlayers = input.multiplayer && state.games.length > 0
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
  if (players.length === 0 || !input.multiplayer && players.length !== 2) return { action: "read_game", result: { status: "unavailable", error: "game_player_unavailable" } };
  const state = await readGameToolState(input, players);
  const lore = await readGameToolLore(state, input.audience);
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
  await lockHostedThreadRouteByThreadIdentityTx({ authority: route, prisma: tx });
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
  // The yes that calls off a pair game voids it; a retry of that yes must still reach its recorded outcome.
  const replayableApproval = input.request.action === "update_game" && input.request.update.operation === "approve" && input.request.update.proposalId !== undefined;
  const game = await tx.game.findFirst({
    where: { OR: [{ ...gamePairWhere(players), status: { in: ["negotiating", "live", "settled", ...(replayableApproval ? ["void" as const] : [])] } }, addressedGameRematchWhere(players), ...(input.multiplayer ? [{ chatContainerMemberId: input.memberId }] : [])], ...(input.request.action === "update_game" ? { id: input.request.update.gameId } : input.request.action === "game_photo" ? { id: input.request.photo.gameId } : {}) },
    include: { invitees: true, players: { take: 11 } },
  });
  if (!game || !isGameEnabled()) return false;
  if (input.multiplayer) {
    if (!input.audience || !await readGameChatAuthority(game, input.memberId, input.audience, tx)) return false;
  } else if (game.maxPlayers === 10 || !areGamePlayersAllowed(game, players)) return false;
  return true;
}

async function handleGameRecapTool(input: Input & { request: Extract<HostedGameToolRequest, { action: "read_game" | "write_recap" }> & { origin: { kind: "game_recap"; gameId: string; eventId: string } } }): Promise<HostedGameToolResponse> {
  const { gameId, eventId } = input.request.origin;
  if (parseGameRecapEventId(eventId)?.gameId !== gameId) return { action: input.request.action, result: { status: "unavailable", error: "recap_authority_unavailable" } };
  const prisma = getPrisma();
  const unavailable = async (): Promise<HostedGameToolResponse> => ({ action: input.request.action, result: {
    status: "unavailable", error: await isGameRecapGenerationRetired(prisma, eventId, input.memberId) ? GAME_RECAP_GENERATION_RETIRED : "recap_authority_unavailable",
  } });
  await prisma.$transaction(async (tx) => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
  });
  if (await isGameRecapGenerationRetired(prisma, eventId, input.memberId)) return { action: input.request.action, result: { status: "unavailable", error: GAME_RECAP_GENERATION_RETIRED } };
  const audience = input.multiplayer ? await readGameChatAudience(input.memberId) : undefined;
  const roomPlayers = audience?.memberIds ?? await requireExactGameChat(input.memberId);
  if (!supportsGameChatRoster(input, roomPlayers)) return { action: input.request.action, result: { status: "unavailable", error: "recap_authority_unavailable" } };
  const material = await readGameRecapMaterial(gameId, input.memberId, roomPlayers, eventId, audience);
  if (!material) return unavailable();
  const players = material.validation.playerNamesByMemberId.map(player => player.memberId);
  if (!input.multiplayer && material.validation.group) return { action: input.request.action, result: { status: "unavailable", error: "recap_authority_unavailable" } };
  const authorizeMutation = async (tx: Prisma.TransactionClient) => {
    await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
  };
  const context = { gameId, eventId, players, material, authorizeMutation, unavailable, audience };
  return input.request.action === "read_game" ? handleAuthorizedRecapRead({ ...input, request: input.request }, context)
    : handleAuthorizedRecapWrite({ ...input, request: input.request }, context);
}

type RecapToolInput = Parameters<typeof handleGameRecapTool>[0];
type RecapToolContext = {
  gameId: string; eventId: string; players: string[];
  material: NonNullable<Awaited<ReturnType<typeof readGameRecapMaterial>>>;
  authorizeMutation: (tx: Prisma.TransactionClient) => Promise<void>;
  unavailable: () => Promise<HostedGameToolResponse>;
  audience: Awaited<ReturnType<typeof readGameChatAudience>> | undefined;
};
async function recoverGameRecap(input: RecapToolInput, context: RecapToolContext): Promise<HostedGameToolResponse> {
  const { gameId, eventId, players, material, authorizeMutation, unavailable } = context;
  const prisma = getPrisma();
    if (!material.validation.show) return unavailable();
    const scope = { beforeMutationTx: authorizeMutation, containerMemberId: input.memberId, eventId, gameId, playerMemberIds: players };
    let saved = await sealGameRecap({ ...scope, recap: null });
    if (!saved && input.request.action === 'read_game' && input.request.recapRead?.kind === 'recover' && input.request.recapRead.failed) {
      if (parseGameRecapEventId(eventId)?.regenerationId) {
        await prisma.$transaction(async tx => {
          await authorizeMutation(tx);
          await tx.$queryRaw`SELECT id FROM game WHERE id = ${gameId} FOR UPDATE`;
          const accepted = await tx.gameEvent.findUnique({ where: { commandKey: `${eventId}:accepted` }, select: { id: true } });
          if (!accepted) await retireGameRecapGenerationTx(tx, eventId);
        });
        saved = await sealGameRecap({ ...scope, recap: null });
        if (!saved) return { action: 'read_game', result: { status: 'unavailable', error: GAME_RECAP_GENERATION_RETIRED } };
      } else saved = await sealGameRecap({ ...scope, recap: buildRecapFallback(material.validation.result) });
    }
    if (!saved) return { action: 'read_game', result: { status: 'ok', recapGame: { recovered: false } } };
    return { action: 'read_game', result: { status: 'ok', chatLine: await acceptedGameRecapMessage(gameId, saved.chatLine) } };
}
async function handleAuthorizedRecapRead(input: RecapToolInput & { request: Extract<RecapToolInput['request'], { action: 'read_game' }> }, context: RecapToolContext): Promise<HostedGameToolResponse> {
  const { gameId, eventId, players, material, authorizeMutation, unavailable } = context;
  if (input.request.recapRead?.kind === "recover") return recoverGameRecap(input, context);
  if (input.request.recapRead?.kind === 'upload') {
    if (!material.validation.show) return unavailable();
    return { action: 'read_game', result: { status: 'ok', recapGame: await uploadRecapMedia({
      gameId, eventId, memberId: input.memberId, material, beforeMutationTx: authorizeMutation, file: input.request.recapRead }) } };
  }
  return readRecapForWriter({ material, request: input.request, containerMemberId: input.memberId, playerMemberIds: players, beforeMutationTx: authorizeMutation });
}
function recapShowWriteError(request: Extract<HostedGameToolRequest, { action: 'write_recap' }>, material: RecapToolContext['material'], players: string[]): string | null {
  const parsed = recapShowWriterSchema.safeParse(request.recap);
  const ids = new Set(material.entries.filter(entry => entry.kind === 'photo' && entry.visibleToBoth).map(entry => entry.entryId));
  const invalidPhoto = request.recap.pages.some(page => page.blocks.some(block => (block.entryIds ?? []).some(id => !ids.has(id))));
  const invalidCard = request.recap.superlatives?.some(card => !players.includes(card.memberId));
  const assets = request.assets ?? [];
  const invalidSlot = new Set(assets.map(asset => asset.slot)).size !== assets.length || assets.some(asset => asset.slot === 'song'
    ? asset.kind !== 'song' || !request.recap.song
    : asset.kind !== 'image' || !/^scene-[0-6]$/u.test(asset.slot) || !request.recap.pages[Number(asset.slot.slice(6))]?.blocks.some(block => block.kind === 'scene'));
  const invalidTiming = assets.some(asset => asset.wordsTimestamps && (asset.slot !== 'song' || !asset.durationMs || !request.recap.song
    || !alignSongLyrics(request.recap.song.lyrics, asset.wordsTimestamps, asset.durationMs)));
  if (invalidTiming) return 'Song timings must match the final lyrics and belong to a song with a measured duration.';
  if (!parsed.success || invalidPhoto || invalidCard || invalidSlot) return !parsed.success ? parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      : 'Use this game’s visible photo IDs and player IDs, and select one image per scene slot or the song slot.';
  return null;
}

async function handleAuthorizedRecapWrite(input: RecapToolInput & { request: Extract<RecapToolInput['request'], { action: 'write_recap' }> }, context: RecapToolContext): Promise<HostedGameToolResponse> {
  const { gameId, eventId, players, material, authorizeMutation, unavailable, audience } = context;
  const prisma = getPrisma();

  const replay = await sealGameRecap({ beforeMutationTx: authorizeMutation, containerMemberId: input.memberId,
    eventId, gameId, playerMemberIds: players, recap: null });
  if (replay) return { action: "write_recap", result: { status: "ok", recapOutcome: gameRecapToolResult([]), ...(!material.validation.show ? { recap: replay } : {}), chatLine: material.validation.show ? await acceptedGameRecapMessage(gameId, replay.chatLine) : gameRecapMessage(gameId, replay.chatLine) } };
  if (await isGameRecapGenerationRetired(prisma, eventId, input.memberId)) return { action: "write_recap", result: { status: "unavailable", error: GAME_RECAP_GENERATION_RETIRED } };
  if (material.validation.show) {
    const error = recapShowWriteError(input.request, material, players);
    if (error) return { action: 'write_recap', result: { status: 'rejected', recapOutcome: error } };
  } else {
    gameRecapWriterSchema.parse(input.request.recap);
    const chatMessages = await readGameRecapChatMessages({ containerMemberId: input.memberId, material });
    const errors = validateGameRecap({ recap: input.request.recap, players: material.players, entries: material.entries,
      chatMessages, priorChatLines: input.request.priorChatLines, result: material.validation.result, group: material.validation.group });
    if (errors.length) return { action: 'write_recap', result: { status: 'rejected', recapOutcome: gameRecapToolResult(errors) } };
  }
  if (!await refreshGameChatAudience({ ...input, audience }, players)) return { action: "write_recap", result: { status: "unavailable", error: "recap_authority_unavailable" } };
  const saved = await sealGameRecap({ beforeMutationTx: authorizeMutation, containerMemberId: input.memberId, eventId, gameId, playerMemberIds: players, assets: material.validation.show ? input.request.assets ?? [] : undefined, recap: material.validation.show ? input.request.recap : withValidGameSuperlatives(input.request.recap, material.validation.result.map(player => player.memberId), material.validation.group) });
  return saved
    ? { action: "write_recap", result: { status: "ok", recapOutcome: gameRecapToolResult([]), ...(!material.validation.show ? { recap: saved } : {}), chatLine: material.validation.show ? await acceptedGameRecapMessage(gameId, saved.chatLine) : gameRecapMessage(gameId, saved.chatLine) } }
    : unavailable();
}

export async function readGameRecapChatMessages(input: {
  containerMemberId: string;
  material: NonNullable<Awaited<ReturnType<typeof readGameRecapMaterial>>>;
  eventId?: string;
  beforeMutationTx?: (tx: Prisma.TransactionClient) => Promise<void>;
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
  if (!isGameMemberSet(players) || !isGameEnabled()) return false;
  return sameGamePlayers(players, expected);
}

async function readRecapForWriter(input: {
  material: NonNullable<Awaited<ReturnType<typeof readGameRecapMaterial>>>;
  request: Extract<HostedGameToolRequest, { action: "read_game" }>;
  containerMemberId: string; playerMemberIds: readonly string[];
  beforeMutationTx: (tx: Prisma.TransactionClient) => Promise<void>;
}): Promise<HostedGameToolResponse> {
  if (!input.material.validation.show) return { action: "read_game", result: { status: "ok", recapGame: input.material.game } };
  if (input.request.origin.kind !== "game_recap" || !input.material.validation.settledAt) throw new TypeError("Recap scope is unavailable.");
  const { eventId, gameId } = input.request.origin;
  const read = input.request.recapRead;
  if (read?.kind === "transcript") return { action: "read_game", result: { status: "ok", recapGame: await readRecapTranscriptPage({
    containerMemberId: input.containerMemberId, gameId, eventId, beforeMutationTx: input.beforeMutationTx,
    players: input.material.validation.playerNamesByMemberId, since: input.material.validation.startedAt,
    until: input.material.validation.settledAt, after: read.after,
  }) } };
  const references = await readRecapSourceReferences(input.material, eventId);
  if (read?.kind === "reference") {
    const reference = references.find(reference => reference.id === read.id);
    const bytes = reference ? await readRecapReferenceBytes(reference) : null;
    return { action: "read_game", result: bytes ? { status: "ok", recapGame: bytes } : { status: "unavailable", error: "recap_reference_revoked" } };
  }
  return { action: "read_game", result: { status: "ok", recapGame: { ...input.material.game,
    material: { game: input.material.game, players: input.material.players, entries: input.material.entries,
      result: input.material.validation.result, startedAt: input.material.validation.startedAt.toISOString(),
      settledAt: input.material.validation.settledAt.toISOString(), references: publicRecapReferences(references, input.material) },
  } } };
}
