import { validateGameRecapDetailed, validateRecapFileSelection, RecapRejectionError } from '@murphai/contracts/recap-validation'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { RecapMaterial, RecapTranscriptMessage } from '@murphai/contracts/recap-material'
import { inspectRecapProviderRequest, recapReservationMicrodollars, reserveRecapOperation, RECAP_DEADLINE_MS, type RecapAdmissionState, type RecapProviderRequest } from '@murphai/contracts/recap-admission'
import { gameRecapDraftSchema, recapFileReceiptSchema, type GameRecapDraft, type RecapFileReceipt } from '@murphai/contracts/recap-show'
import type { HostedGameToolResponse, HostedRuntimeGroupToolRequest } from '@murphai/hosted-execution/runtime-control'

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function requireReferenceHashes(photos: ReadonlyMap<string, Buffer>, descriptor: RecapProviderRequest, referenceIds: readonly string[] = []) {
  if (descriptor.kind === 'image' && referenceIds.some((id, index) => !photos.has(id) || hash(photos.get(id)!) !== descriptor.referenceHashes[index])) throw new Error('Unapproved synthetic photo.')
}

/** Synthetic provider boundary shared by the live-model and hosted-container lanes. Media requests stay in process unless the sanctioned live test explicitly supplies mediaFetch. The model still uses the production file tools,
 * real byte decoders, reservation reducer, preview and submission dispatcher. */
export async function createRecapShowLiveProviders(input: {
  game: unknown; players: { name: string; memberId: string }[];
  entries: RecapMaterial['entries']; result: RecapMaterial['result'];
  chat: { playerName: string; text: string }[];
  mediaFetch?: typeof fetch;
}) {
  const photos = new Map<string, Buffer>()
  const references: RecapMaterial['references'] = []
  for (const [index, player] of input.players.entries()) {
    const id = hash(`synthetic-profile:${player.memberId}`)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="${index ? '#c8d7c2' : '#dfc7a9'}"/><circle cx="240" cy="200" r="90" fill="#6b6560"/><path d="M110 560V400Q240 280 370 400V560" fill="#766e91"/></svg>`
    photos.set(id, await sharp(Buffer.from(svg)).jpeg().toBuffer())
    references.push({ id, kind: 'profile', memberId: player.memberId })
  }
  for (const entry of input.entries.filter(entry => entry.kind === 'photo')) {
    const player = input.players.find(player => player.name === entry.playerName)!
    const id = hash(`synthetic-entry:${entry.entryId}`)
    photos.set(id, photos.get(hash(`synthetic-profile:${player.memberId}`))!)
    references.push({ id, kind: 'entry', memberId: player.memberId, entryId: entry.entryId })
  }
  const startedAt = new Date(Date.now() - 8 * 86_400_000).toISOString()
  const settledAt = new Date().toISOString()
  const material: RecapMaterial = { game: input.game, players: input.players.map(player => player.name), entries: input.entries,
    result: input.result, references, startedAt, settledAt }
  const chat: RecapTranscriptMessage[] = input.chat.map((message, index) => ({ ...message, id: `synthetic-message-${index}`,
    at: new Date(Date.now() - 86_400_000 + index * 1000).toISOString(), source: 'player', laneSeq: String(index + 1) }))
  const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="768" height="1024"><rect width="768" height="1024" fill="#2d3436"/><path d="M0 0H768V250Q384 80 0 250Z" fill="#9e5743"/><rect x="100" y="780" width="568" height="80" fill="#d4c4a8"/><circle cx="260" cy="490" r="70" fill="#d4c4a8"/><circle cx="510" cy="490" r="70" fill="#7a8c6e"/><path d="M180 780V600H340V780M430 780V600H590V780" fill="#d4c4a8"/></svg>')).jpeg().toBuffer()
  const song = await readFile(new URL('../../../fixtures/generated-audio/recap-synthetic-20s.mp3', import.meta.url))
  let state: RecapAdmissionState = { v: 1, deadline: new Date(Date.now() + RECAP_DEADLINE_MS).toISOString(), runs: [], operations: [] }
  const reservations = new Map<string, { id: string; descriptor: RecapProviderRequest; consumed: boolean }>()
  const receipts = new Map<string, RecapFileReceipt>()
  const operationReferences = new Map<string, RecapMaterial['references']>()
  const staged = new Set<string>()
  const providerCalls: RecapProviderRequest[] = []
  let frozen: GameRecapDraft | null = null
  const transcriptPage = (after?: string) => {
    const start = Number(after ?? 0), messages = chat.slice(start, start + 200)
    return { messages, next: start + messages.length < chat.length ? String(start + messages.length) : null, through: String(chat.length), since: startedAt, until: settledAt, retainedSince: startedAt, incomplete: false }
  }
  const control = async (request: HostedRuntimeGroupToolRequest): Promise<HostedGameToolResponse> => {
    if (request.action !== 'read_game') throw new Error('Expected a synthetic recap read.')
    const command = request.recapRead
    let recapGame: unknown
    if (!command) recapGame = { ...(typeof input.game === 'object' ? input.game : {}), material, pendingRecapUsages: [] }
    else if (command.kind === 'recover') recapGame = { recovered: false }
    else if (command.kind === 'admit') {
      state = { ...state, runs: [...state.runs, command.runId] }
      recapGame = { admitted: true, runId: command.runId, token: 'a'.repeat(64), deadline: state.deadline }
    } else if (command.kind === 'end') recapGame = { ended: true }
    else if (command.kind === 'transcript') recapGame = transcriptPage(command.after)
    else if (command.kind === 'reference') {
      const bytes = photos.get(command.id)
      if (!bytes) throw new Error('Unknown synthetic photo.')
      const meta = await sharp(bytes).metadata()
      recapGame = { id: command.id, bytes: bytes.toString('base64'), hash: hash(bytes), mediaType: 'image/jpeg', byteLength: bytes.length, width: meta.width, height: meta.height }
    } else if (command.kind === 'reserve') {
      const descriptor = command.providerRequest
      requireReferenceHashes(photos, descriptor, command.referenceIds)
      state = reserveRecapOperation(state, { id: command.operationId, runId: command.runId, request: descriptor,
        reserved: recapReservationMicrodollars(descriptor), now: new Date() })
      operationReferences.set(command.operationId, (command.referenceIds ?? []).map(id => references.find(reference => reference.id === id)!))
      const token = hash(command.operationId)
      reservations.set(token, { id: command.operationId, descriptor, consumed: false })
      recapGame = { token, deadline: state.deadline }
    } else if (command.kind === 'finished') {
      const reservation = reservations.get(command.token)
      if (!reservation?.consumed) throw new Error('Unconsumed reservation.')
      state.operations.find(operation => operation.id === command.operationId)!.active = false
      if (command.receipt) receipts.set(command.operationId, recapFileReceiptSchema.parse(command.receipt))
      recapGame = { finished: true }
    } else if (command.kind === 'stage') {
      if (!frozen?.files.some(file => JSON.stringify(file.receipt) === JSON.stringify(command.receipt)) || hash(Buffer.from(command.bytes, 'base64')) !== command.receipt.hash) throw new Error('Unselected or changed upload.')
      staged.add(command.receipt.hash)
      recapGame = { staged: true }
    } else throw new Error('Unexpected synthetic control.')
    return { action: 'read_game', result: { status: 'ok', recapGame } }
  }
  const providerFetch: typeof fetch = async (url, init) => {
    const request = new Request(url, init)
    const descriptor = await inspectRecapProviderRequest(request.clone())
    const reservation = reservations.get(request.headers.get('x-murph-recap-reservation') ?? '')
    if (!reservation || reservation.consumed || descriptor.requestHash !== reservation.descriptor.requestHash) throw new Error('Synthetic provider rejected unreserved media.')
    reservation.consumed = true
    state.operations.find(operation => operation.id === reservation.id)!.consumed = true
    providerCalls.push(descriptor)
    if (input.mediaFetch) return input.mediaFetch(url, init)
    return descriptor.kind === 'song' ? new Response(song, { headers: { 'content-type': 'audio/mpeg' } })
      : Response.json({ data: [{ b64_json: image.toString('base64') }], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } })
  }
  const validate = (draft: GameRecapDraft) => [
    ...validateGameRecapDetailed({ recap: draft.story, players: material.players, entries: material.entries, result: material.result, chatMessages: input.chat, show: true }),
    ...validateRecapFileSelection({ draft, players: input.players, operations: state.operations.map(operation => ({ ...operation, receipt: receipts.get(operation.id), references: operationReferences.get(operation.id) ?? [] })) }),
  ]
  return { material, control, providerFetch, providerCalls, validate,
    prepare(draft: unknown) {
      const parsed = gameRecapDraftSchema.parse(draft)
      const errors = validate(parsed)
      if (errors.length) throw new RecapRejectionError(errors)
      if (frozen && JSON.stringify(frozen) !== JSON.stringify(parsed)) throw new Error('Frozen draft changed.')
      frozen = parsed
      return { prepared: true }
    },
    accept() {
      if (!frozen || frozen.files.some(file => !staged.has(file.receipt.hash))) throw new Error('Selected upload is missing.')
      return frozen
    },
  }
}

// Composed provider-boundary probes use the production host and file tool.
export { createRecapMediaRuntime, recapRunAdmissionSchema } from './assistant/recap-media-runtime.js'
export { materializeRecapWorkspace } from './assistant/recap-workspace.js'
export { executeGenerateSongTool } from './assistant-codex/generate-voice-memo-tool.js'

/** Deliberately synthetic, production-shaped long pair game: pagination, replacement photos and opaque names. */
export function createLongPairRecapFixture() {
  const players = [{ memberId: 'player_first', name: 'Céleste Marín 🌿', task: '10 minutes of abs' }, { memberId: 'player_second', name: 'Noé Dupré', task: '100 pushups' }]
  const entries = Array.from({ length: 20 }, (_, index) => ({ entryId: `synthetic-photo-${index}`, kind: 'photo',
    playerName: players[index % 2]!.name, text: index % 2 ? 'Pushups beside the laundry basket' : 'Purple mat, still here', visibleToBoth: true }))
  const days = Array.from({ length: 7 }, (_, day) => ({ dayNumber: day + 1,
    posts: Object.fromEntries(players.map((player, seat) => [player.name, day === 3 && seat === 1 ? 'missed' : {
      entryId: entries[day * 2 + seat]!.entryId, kind: 'photo', text: entries[day * 2 + seat]!.text,
      postedAt: { local: `2026-10-${String(day + 12)}T${day === 5 ? '23:57' : '08:12'}:00`, timeZone: 'America/New_York', instant: `2026-10-${String(day + 12)}T12:12:00Z` },
      data: null, incomplete: false, proveIt: null,
    }])) }))
  const chat = Array.from({ length: 300 }, (_, index) => ({ playerName: players[index % 2]!.name,
    text: index === 135 ? 'The laundry basket is my personal trainer.' : index === 140 ? 'I folded the towel instead of doing pushups.'
      : index % 19 === 0 ? '[Voice note: no transcript available]' : index % 17 === 0 ? 'Route idea: https://example.test/walk 🌳'
        : index % 11 === 0 ? 'Mat report: still purple 🟣' : `Day ${Math.min(7, Math.floor(index / 43) + 1)} check-in chat, message ${index + 1}.` }))
  const result = players.map((player, index) => ({ memberId: player.memberId, name: player.name, score: 7 - index }))
  return { players, entries, chat, result, game: { id: 'game_recap_synthetic', recapShow: true, maxPlayers: 2, players, lengthDays: 7,
    schedule: { days: [0, 1, 2, 3, 4, 5, 6] }, stakes: [{ kind: 'prize', item: 'breakfast in bed' }], score: result, days } }
}
