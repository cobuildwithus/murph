import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import * as z from '@murphai/contracts/zod-runtime';
import { recapAssetSchema, recapFileReceiptSchema } from '@murphai/contracts/recap-show';
import { RECAP_DEADLINE_MS, RECAP_MEDIA_PRICING_VERSION, recapReservationMicrodollars, reserveRecapOperation, type RecapProviderRequest } from '@murphai/contracts/recap-admission';
import type { HostedGameToolRequest } from '@murphai/hosted-execution/runtime-control';
import { getPrisma } from '../prisma';
import { requireHostedRuntimeCallbackTx, type HostedRuntimeIdentity } from '../hosted-execution/runtime-owner';
import { requireHostedRuntimeActiveAccessForUpdateTx } from '../hosted-mailbox/runtime-access';
import { readGameChatAudience, readGameChatAuthority } from './chat-membership';
import { isPairRecapShowEnabled } from './access';
import { isGameRecapGenerationRetired, readGameRecapEntryIdsTx, readLatestGameRecapEventIdTx } from './recap-witness';
import { readRecapReferenceBytes, readRecapSourceReferences, type RecapSourceReference } from './recap-inputs';
import { recapReferencesCurrent } from './recap-asset-access';
import type { readGameRecapMaterial } from './service';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const scopeSchema = z.object({ gameId: z.string(), eventId: z.string(), runId: z.string(), tokenHash: digest }).strict();
export const storedRecapAdmissionSchema = z.object({ v: z.literal(1), deadline: z.string(), runs: z.array(z.string()).max(2),
  operations: z.array(z.object({ id: z.string(), kind: z.enum(['image', 'song']), requestHash: digest,
    reserved: z.number().int(), active: z.boolean(), consumed: z.boolean(), tokenHash: digest,
    pricing: z.literal(RECAP_MEDIA_PRICING_VERSION), referenceIds: z.array(digest), references: recapAssetSchema.shape.references,
    receipt: recapFileReceiptSchema.optional() }).strict()).max(5) }).strict();
export type StoredRecapAdmission = z.infer<typeof storedRecapAdmissionSchema>;
type Identity = { memberId: string; runtimeIdentity: HostedRuntimeIdentity | null; gameId: string; eventId: string };
type Control = NonNullable<Extract<HostedGameToolRequest, { action: 'read_game' }>['recapRead']>;
const commandKey = (eventId: string) => `${eventId}:admission`;

/** Same owner lock order as game writes: runtime/member, then game. */
export async function requireRecapAdmissionAuthorityTx(tx: Prisma.TransactionClient, input: Identity, audience: Awaited<ReturnType<typeof readGameChatAudience>>) {
  const owner = await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
  await requireHostedRuntimeActiveAccessForUpdateTx(input.memberId, { prisma: tx });
  await tx.$queryRaw`SELECT id FROM game WHERE id = ${input.gameId} FOR UPDATE`;
  const game = await tx.game.findUnique({ where: { id: input.gameId }, include: { players: { take: 3 }, invitees: true } });
  if (!game || !isPairRecapShowEnabled(game.maxPlayers) || game.status !== 'settled' || game.players.length !== 2
    || game.players.some(player => !player.memberId || player.leftAt) || !await readGameChatAuthority(game, input.memberId, audience, tx)
    || await readLatestGameRecapEventIdTx(tx, game.id) !== input.eventId
    || await isGameRecapGenerationRetired(tx, input.eventId, input.memberId)
    || !await readGameRecapEntryIdsTx(tx, game, input.eventId)) throw new Error('Recap generation authority is no longer current.');
  return { game, owner };
}

export async function handleRecapAdmission(input: Identity & { command: Control; material: NonNullable<Awaited<ReturnType<typeof readGameRecapMaterial>>> }) {
  const command = input.command;
  const audience = await readGameChatAudience(input.memberId);
  // Normalize private reference bytes outside the transaction, then recheck their
  // canonical keys and the generation witness under the game lock.
  const references = command.kind === 'reserve' && command.providerRequest.kind === 'image'
    ? await readRecapSourceReferences(input.material, input.eventId) : [];
  const selected: RecapSourceReference[] = [];
  if (command.kind === 'reserve' && command.providerRequest.kind === 'image') {
    const wanted = new Set(command.providerRequest.referenceHashes);
    // At most the three reference IDs requested by the host; the manifest itself
    // does not grant authority. Avoid normalizing every photo in a long game.
    const ids = command.referenceIds ?? [];
    for (const id of ids) {
      const ref = references.find(reference => reference.id === id);
      if (!ref) throw new Error('Recap reference was revoked.');
      const bytes = await readRecapReferenceBytes(ref);
      if (!bytes || !wanted.has(bytes.hash)) throw new Error('Recap reference bytes changed.');
      wanted.delete(bytes.hash); selected.push(ref);
    }
    if (wanted.size) throw new Error('Unapproved recap reference bytes.');
  }
  return getPrisma().$transaction(async tx => {
    const { owner } = await requireRecapAdmissionAuthorityTx(tx, input, audience);
    const prior = await tx.gameEvent.findUnique({ where: { commandKey: commandKey(input.eventId) }, select: { payload: true } });
    let state: StoredRecapAdmission = prior ? storedRecapAdmissionSchema.parse(prior.payload)
      : { v: 1, deadline: new Date(Date.now() + RECAP_DEADLINE_MS).toISOString(), runs: [], operations: [] };
    let result: unknown;
    if (command.kind === 'admit') {
      if (state.runs.includes(command.runId) || state.runs.length >= 2 || Date.now() >= Date.parse(state.deadline)) return { admitted: false, deadline: state.deadline };
      const token = randomBytes(32).toString('hex');
      state = { ...state, runs: [...state.runs, command.runId] };
      await tx.hostedRuntimeOwner.update({ where: { userId: input.memberId }, data: {
        recapMediaScope: { gameId: input.gameId, eventId: input.eventId, runId: command.runId, tokenHash: hash(token) } } });
      result = { admitted: true, deadline: state.deadline, runId: command.runId, token };
    } else if (command.kind === 'end') {
      const scope = scopeSchema.safeParse(owner.recapMediaScope);
      if (scope.success && scope.data.eventId === input.eventId && scope.data.runId === command.runId && scope.data.tokenHash === hash(command.token)) {
        await tx.hostedRuntimeOwner.update({ where: { userId: input.memberId }, data: { recapMediaScope: Prisma.DbNull } });
      }
      return { ended: true };
    } else if (command.kind === 'lore_checkpointed') {
      await tx.gameEvent.updateMany({ where: { gameId: input.gameId, commandKey: `${input.eventId}:lore`, type: 'recap_lore_pending' }, data: { type: 'recap_lore_stamped' } });
      return { checkpointed: true };
    } else if (command.kind === 'reserve') {
      const scope = scopeSchema.parse(owner.recapMediaScope);
      if (scope.eventId !== input.eventId || scope.runId !== command.runId) throw new Error('Wrong recap run.');
      if (!await referencesCurrent(tx, input.gameId, selected)) throw new Error('Recap references were revoked.');
      const configured = Number(process.env.MURPH_RECAP_IMAGE_INPUT_TOKEN_CEILING ?? '');
      const reserved = recapReservationMicrodollars(command.providerRequest, Number.isSafeInteger(configured) && configured > 0 ? configured : null);
      const next = reserveRecapOperation(state, { id: command.operationId, runId: command.runId, request: command.providerRequest, reserved, now: new Date() });
      const token = randomBytes(32).toString('hex');
      state = { ...next, operations: [...state.operations, { ...next.operations.at(-1)!, tokenHash: hash(token),
        pricing: RECAP_MEDIA_PRICING_VERSION, referenceIds: selected.map(reference => reference.id), references: selected.map(({ id: _id, ...reference }) => reference) }] };
      result = { token, deadline: state.deadline };
    } else if (command.kind === 'finished') {
      const operation = state.operations.find(operation => operation.id === command.operationId && operation.tokenHash === hash(command.token));
      if (!operation || !operation.consumed) throw new Error('Media reservation was not consumed.');
      if (command.receipt && (command.receipt.operationId !== operation.id || command.receipt.mediaType !== (operation.kind === 'image' ? 'image/jpeg' : 'audio/mpeg'))) throw new Error('Media receipt does not match its reservation.');
      if (operation.receipt && JSON.stringify(operation.receipt) !== JSON.stringify(command.receipt)) throw new Error('Media receipt is immutable.');
      operation.active = false;
      if (command.receipt) operation.receipt = command.receipt;
      result = { finished: true };
    } else throw new Error('Unsupported recap control.');
    await tx.gameEvent.upsert({ where: { commandKey: commandKey(input.eventId) },
      create: { gameId: input.gameId, actor: 'system', type: 'recap_admission', commandKey: commandKey(input.eventId), payload: state }, update: { payload: state } });
    return result;
  });
}

async function referencesCurrent(tx: Prisma.TransactionClient, gameId: string, references: readonly RecapSourceReference[]) {
  return recapReferencesCurrent(tx, gameId, references.length ? [{ references: references.map(reference => ({ ...reference, key: reference.key })) }] : []);
}

/** Called only by the signed outbound Worker with its native runtime fence.
 * Omitted token never opts a scoped runtime out of admission. */
export async function consumeRecapProviderReservation(input: {
  memberId: string; runtimeIdentity: HostedRuntimeIdentity; token?: string | null;
  providerRequest?: RecapProviderRequest | null; opaque?: boolean; nativeImage?: boolean;
}): Promise<{ scoped: boolean; allowed: boolean }> {
  const db = getPrisma();
  const initial = await db.hostedRuntimeOwner.findUnique({ where: { userId: input.memberId }, select: { recapMediaScope: true } });
  if (!initial?.recapMediaScope) return db.$transaction(async tx => {
    const owner = await requireHostedRuntimeCallbackTx(tx, input.memberId, input.runtimeIdentity);
    return { scoped: Boolean(owner.recapMediaScope), allowed: !owner.recapMediaScope };
  });
  const scope = scopeSchema.safeParse(initial.recapMediaScope);
  if (!scope.success) return { scoped: true, allowed: false };
  const identity = { ...input, gameId: scope.data.gameId, eventId: scope.data.eventId };
  const audience = await readGameChatAudience(input.memberId);
  return db.$transaction(async tx => {
    const { owner } = await requireRecapAdmissionAuthorityTx(tx, identity, audience);
    if (JSON.stringify(owner.recapMediaScope) !== JSON.stringify(initial.recapMediaScope)) return { scoped: true, allowed: false };
    if (input.opaque || input.nativeImage) return { scoped: true, allowed: false };
    if (!input.providerRequest) return { scoped: true, allowed: true };
    if (!input.token) return { scoped: true, allowed: false };
    const row = await tx.gameEvent.findUnique({ where: { commandKey: commandKey(scope.data.eventId) }, select: { payload: true } });
    const state = storedRecapAdmissionSchema.parse(row?.payload);
    const operation = state.operations.find(operation => operation.tokenHash === hash(input.token!));
    if (!operation || operation.consumed || !operation.active || operation.requestHash !== input.providerRequest.requestHash
      || operation.kind !== input.providerRequest.kind || Date.now() >= Date.parse(state.deadline)) return { scoped: true, allowed: false };
    if (!await recapReferencesCurrent(tx, scope.data.gameId, [operation])) return { scoped: true, allowed: false };
    operation.consumed = true;
    await tx.gameEvent.update({ where: { commandKey: commandKey(scope.data.eventId) }, data: { payload: state } });
    return { scoped: true, allowed: true };
  });
}
