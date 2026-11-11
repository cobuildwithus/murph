import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import type { RecapMaterial, RecapTranscriptMessage } from '@murphai/contracts/recap-material'
import { inspectRecapProviderRequest, recapReservationMicrodollars, reserveRecapOperation, type RecapAdmissionState, type RecapProviderRequest } from '@murphai/contracts/recap-admission'
import { gameRecapDraftSchema, recapFileReceiptSchema, type GameRecapDraft, type RecapFileReceipt } from '@murphai/contracts/recap-show'
import type { HostedGameToolResponse, HostedRuntimeGroupToolRequest } from '@murphai/hosted-execution/runtime-control'

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Synthetic provider boundary for the sanctioned real-model lane. No media
 * request leaves this process. The model still uses the production file tools,
 * real byte decoders, reservation reducer, preview and submission dispatcher. */
export async function createRecapShowLiveProviders(input: {
  game: unknown; players: { name: string; memberId: string }[];
  entries: RecapMaterial['entries']; result: RecapMaterial['result'];
  chat: { playerName: string; text: string }[];
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
  const song = await readFile(new URL('../../../../fixtures/generated-audio/recap-synthetic-20s.mp3', import.meta.url))
  let state: RecapAdmissionState = { v: 1, deadline: new Date(Date.now() + 600_000).toISOString(), runs: [], operations: [] }
  const reservations = new Map<string, { id: string; descriptor: RecapProviderRequest; consumed: boolean }>()
  const receipts = new Map<string, RecapFileReceipt>()
  const staged = new Set<string>()
  const providerCalls: RecapProviderRequest[] = []
  let frozen: GameRecapDraft | null = null
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
    else if (command.kind === 'transcript') recapGame = { messages: chat, next: null, through: String(chat.length), since: startedAt, until: settledAt, retainedSince: startedAt, incomplete: false }
    else if (command.kind === 'reference') {
      const bytes = photos.get(command.id)
      if (!bytes) throw new Error('Unknown synthetic photo.')
      const meta = await sharp(bytes).metadata()
      recapGame = { id: command.id, bytes: bytes.toString('base64'), hash: hash(bytes), mediaType: 'image/jpeg', byteLength: bytes.length, width: meta.width, height: meta.height }
    } else if (command.kind === 'reserve') {
      const descriptor = command.providerRequest
      if (descriptor.kind === 'image' && (command.referenceIds ?? []).some((id, index) => !photos.has(id) || hash(photos.get(id)!) !== descriptor.referenceHashes[index])) throw new Error('Unapproved synthetic photo.')
      state = reserveRecapOperation(state, { id: command.operationId, runId: command.runId, request: descriptor,
        reserved: recapReservationMicrodollars(descriptor, 20_000), now: new Date() })
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
    providerCalls.push(descriptor)
    return descriptor.kind === 'song' ? new Response(song, { headers: { 'content-type': 'audio/mpeg' } })
      : Response.json({ data: [{ b64_json: image.toString('base64') }], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } })
  }
  return { material, control, providerFetch, providerCalls,
    prepare(draft: unknown) {
      const parsed = gameRecapDraftSchema.parse(draft)
      for (const file of parsed.files) if (JSON.stringify(receipts.get(file.receipt.operationId)) !== JSON.stringify(file.receipt)) throw new Error('Unknown provider receipt.')
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
