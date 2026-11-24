import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import * as z from '@murphai/contracts/zod-runtime'
import type { RecapMaterial } from '@murphai/contracts/recap-material'
import {
  RECAP_VIDEO_MAX_BYTES, RECAP_VIDEO_PART_MAX_BYTES, presentGameRecap,
  type GameRecapEnvelope, type RecapAsset, type RecapVideoDraft, type RecapVideoIdentity,
} from '@murphai/contracts/recap-show'
import type { RecapVideoChildRequest, RecapVideoChildResult, RecapVideoInput, RecapVideoOutcome, RecapVideoStake } from '@murphai/recap-video'

/** All the optional video work (photo fetches, the render, the part uploads) that has not finished by now is "no video".
 * Slice 2 measured the render at 19.9 s at two CPUs and 39.4 s emulated. */
export const RECAP_VIDEO_BUDGET_MS = 180_000
/** The drawing process's own heap. Pictures and the encoder live outside it; slice 2 measured 271 MB for the whole process. */
const CHILD_HEAP_MB = 512
const CHILD_OUTPUT_MAX_CHARS = 4096

export type RecapVideoRender =
  | { kind: 'rendered'; file: string; hash: string; byteLength: number; referenceIds: string[]; dispose(): Promise<void> }
  | { kind: 'refused'; reason: string }

const id = z.string().min(1).max(128)
const posterSchema = z.object({
  outcome: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('won'), winnerMemberId: id, loserMemberId: id }),
    z.object({ kind: z.literal('even'), everyDay: z.boolean() }),
  ]),
  stake: z.discriminatedUnion('kind', [
    z.object({ kind: z.enum(['prize', 'dare']), title: z.string().min(1).max(500), owedByMemberId: id, owedToMemberId: id }),
    z.object({ kind: z.literal('both_win'), title: z.string().min(1).max(500) }),
    z.object({ kind: z.literal('none') }),
    z.object({ kind: z.literal('other') }),
  ]),
})
// The material's days, for the posts a player gave back: their prints carry "Didn't finish".
const daysSchema = z.object({ days: z.array(z.object({ posts: z.record(z.string(), z.unknown()) })).max(400) })

/** The last screen's facts, from Web's `game.poster`, in the renderer's words. The runner never works out a winner. */
function lastScreen(game: unknown): { outcome: RecapVideoOutcome; stake: RecapVideoStake } | null {
  const poster = posterSchema.safeParse(game && typeof game === 'object' ? (game as { poster?: unknown }).poster : undefined).data
  if (!poster) return null
  const { outcome, stake } = poster
  if (stake.kind === 'other') return null
  if (stake.kind === 'prize' || stake.kind === 'dare') {
    // Third person: "Ava owes Leo". A ticket owed any other way would draw the wrong sentence.
    if (outcome.kind !== 'won' || stake.owedByMemberId !== outcome.loserMemberId || stake.owedToMemberId !== outcome.winnerMemberId) return null
  }
  return {
    outcome: outcome.kind === 'won' ? { kind: 'won', winnerId: outcome.winnerMemberId, loserId: outcome.loserMemberId } : { kind: 'even', everyDay: outcome.everyDay },
    stake: stake.kind === 'none' ? { kind: 'none' } : stake.kind === 'both_win' ? { kind: 'bothWin', title: stake.title }
      : { kind: stake.kind === 'dare' ? 'punishment' : 'prize', title: stake.title },
  }
}

function unfinishedEntryIds(game: unknown): string[] | null {
  const days = daysSchema.safeParse(game).data
  if (!days) return null
  return days.days.flatMap(day => Object.values(day.posts).flatMap(post =>
    post && typeof post === 'object' && 'incomplete' in post && post.incomplete === true && 'entryId' in post && typeof post.entryId === 'string' ? [post.entryId] : []))
}

/**
 * The renderer's input, from what is trusted at write time: the draft story presented exactly as
 * the app's payload is, the verified files the media tools made, the photos fetched again by
 * reference into this host-only directory, and the material's names, scores and poster.
 */
async function buildInput(input: {
  directory: string; material: RecapMaterial; story: GameRecapEnvelope['story']; assets: readonly RecapAsset[]
  media: ReadonlyMap<string, Buffer>; fetchReference(id: string, signal: AbortSignal): Promise<Buffer>; signal: AbortSignal
}): Promise<{ input: RecapVideoInput; referenceIds: string[] } | string> {
  const closing = lastScreen(input.material.game)
  if (!closing) return 'poster'
  const unfinished = unfinishedEntryIds(input.material.game)
  if (!unfinished) return 'material'
  const song = input.assets.find(asset => asset.slot === 'song')
  const songBytes = input.media.get('song')
  // A show with only a twenty-second song, from before shows had a score, gets no video.
  if (!song?.durationMs || song.songStartMs === undefined || !songBytes) return 'score'
  const generationId = /^recap\/([a-f0-9]{32})\//u.exec(song.storageKey)?.[1] ?? '0'.repeat(32)
  const photoIds = new Set(input.material.entries.filter(entry => entry.kind === 'photo' && entry.visibleToBoth).map(entry => entry.entryId))
  const presented = presentGameRecap({
    stored: { version: 1, generationId, story: input.story, acceptedAt: new Date().toISOString(), assets: [...input.assets],
      preview: { token: '0'.repeat(32), expiresAt: new Date().toISOString() } },
    permittedPhotoIds: photoIds, mediaUrl: () => '', mediaVisible: true,
  }).show
  if (!presented?.score) return 'score'
  const files = hostFiles(input.directory, id => input.fetchReference(id, input.signal))
  const scenes = await writeScenes(presented.pages, input.media, files)
  if (!scenes) return 'scene'
  const photos: Record<string, string | null> = {}
  // A scene's fallback photo is drawn, and so fetched and declared, only when the scene itself is not.
  for (const entryId of new Set(presented.pages.flatMap(page => [...page.blocks.flatMap(block => block.entryIds ?? []),
    ...(page.media?.status === 'ready' ? [] : page.fallback?.entryIds ?? [])]))) {
    const reference = input.material.references.find(item => item.kind === 'entry' && item.entryId === entryId)
    // A post with no photo left is drawn as the app draws it, a "missed" print. A photo that cannot be fetched is no video.
    photos[entryId] = reference ? await files.fetched(reference.id, `photo-${Object.keys(photos).length}.jpg`) : null
  }
  const players: RecapVideoInput['players'] = {}, scores: RecapVideoInput['scores'] = {}
  for (const [index, player] of input.material.result.entries()) {
    const profile = input.material.references.find(item => item.kind === 'profile' && item.memberId === player.memberId)
    players[player.memberId] = { name: player.name, ...(profile ? { avatarPath: await files.fetched(profile.id, `avatar-${index}.jpg`) } : {}) }
    scores[player.memberId] = player.score
  }
  return {
    referenceIds: [...files.referenceIds],
    input: {
      show: { treatment: presented.treatment, pages: presented.pages },
      players, scores, ...closing, scenes, photos,
      ...(unfinished.length ? { unfinished: unfinished.filter(entryId => entryId in photos) } : {}),
      score: { path: await files.save('score.mp3', songBytes), durationMs: song.durationMs, songMs: song.durationMs - song.songStartMs },
    },
  }
}

/** Files only the host writes, and the references whose photos it fetched again. */
function hostFiles(directory: string, fetchReference: (id: string) => Promise<Buffer>) {
  const referenceIds = new Set<string>()
  const save = async (name: string, bytes: Buffer) => {
    const file = path.join(directory, name)
    await writeFile(file, bytes, { flag: 'wx', mode: 0o600 })
    return file
  }
  const fetched = async (referenceId: string, name: string) => {
    referenceIds.add(referenceId)
    return save(name, await fetchReference(referenceId))
  }
  return { referenceIds, save, fetched }
}

/** Each ready scene's verified file by page, or null when one the page shows is missing. */
async function writeScenes(pages: readonly { id: string; kind: string; media?: { status: string } }[], media: ReadonlyMap<string, Buffer>,
  files: ReturnType<typeof hostFiles>): Promise<Record<string, string> | null> {
  const scenes: Record<string, string> = {}
  for (const page of pages) {
    if (page.media?.status !== 'ready' || page.kind === 'song') continue
    const bytes = media.get(`scene-${page.id.slice('page-'.length)}`)
    if (!bytes) return null
    scenes[page.id] = await files.save(`${page.id}.jpg`, bytes)
  }
  return scenes
}

const RENDER_PREFIX = 'render-'

/**
 * Where renders live: under the runner's own home, which the model's permission profile neither
 * reads nor writes (it grants the vault and the temporary directories only). Inputs, the request
 * and ffmpeg's output must not be reachable from the model's shell, or a planted link could make
 * the encoder overwrite a file outside the sandbox. Null when no such place can be proven.
 */
export function recapVideoScratchRoot(vault?: string): string | null {
  const home = [process.env.HOSTED_HOME, process.env.HOME, homedir()].map(value => value?.trim()).find(value => value && path.isAbsolute(value))
  if (!home) return null
  const root = path.join(path.resolve(home), '.murph-recap-video')
  const inside = (parent: string) => {
    const relative = path.relative(path.resolve(parent), root)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }
  return inside(tmpdir()) || inside('/tmp') || (vault !== undefined && inside(vault)) ? null : root
}

/** Render directories no runner is using any more: a process that died mid-render left them. */
async function sweepStaleRenders(root: string): Promise<void> {
  const now = Date.now()
  for (const name of await readdir(root).catch(() => [] as string[])) {
    if (!name.startsWith(RENDER_PREFIX)) continue
    const directory = path.join(root, name)
    const modified = await stat(directory).then(info => info.mtimeMs, () => now)
    if (now - modified > 2 * RECAP_VIDEO_BUDGET_MS) await rm(directory, { recursive: true, force: true })
  }
}

/** The installed renderer's own child entry, beside its index, so nothing of it loads into this process. */
function rendererChildPath(): string {
  return path.join(path.dirname(createRequire(import.meta.url).resolve('@murphai/recap-video')), 'child.js')
}

/** Runs one render in a new process group and reaps the whole group on every path. */
async function runChild(input: { childPath: string; requestPath: string; directory: string; timeoutMs: number; signal?: AbortSignal }): Promise<RecapVideoChildResult | 'timeout' | 'aborted' | 'crashed'> {
  if (input.signal?.aborted) return 'aborted'
  const child = spawn(process.execPath, [`--max-old-space-size=${CHILD_HEAP_MB}`, input.childPath, input.requestPath], {
    cwd: input.directory, detached: true, stdio: ['pipe', 'pipe', 'ignore'],
    // Only what it needs to find ffmpeg: no credentials or runtime settings reach the renderer.
    env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: input.directory, LANG: 'C.UTF-8' },
  })
  let stopped: 'timeout' | 'aborted' | null = null
  const stopGroup = () => {
    try { if (child.pid) process.kill(-child.pid, 'SIGKILL') } catch { /* The group is already gone. */ }
  }
  const stop = (reason: 'timeout' | 'aborted') => { stopped ??= reason; stopGroup() }
  const onAbort = () => stop('aborted')
  const timer = setTimeout(() => stop('timeout'), input.timeoutMs)
  input.signal?.addEventListener('abort', onAbort, { once: true })
  let output = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output = (output + chunk).slice(0, CHILD_OUTPUT_MAX_CHARS) })
  child.stdin.on('error', () => {})
  const exit = await new Promise<number | null>(resolve => {
    child.once('error', () => resolve(null))
    child.once('close', code => resolve(code))
  })
  clearTimeout(timer)
  input.signal?.removeEventListener('abort', onAbort)
  // Whatever happened to the drawing process, its encoder goes with it.
  stopGroup()
  child.stdin.destroy()
  if (stopped) return stopped
  if (exit !== 0) return 'crashed'
  try {
    const result = JSON.parse(output.trim().split('\n').at(-1) ?? '') as RecapVideoChildResult
    return typeof result === 'object' && result !== null && typeof result.ok === 'boolean' ? result : 'crashed'
  } catch {
    return 'crashed'
  }
}

let rendering = false

/**
 * One recap video for a show, or the reason there is none. Nothing here can fail the recap:
 * every error, refusal, timeout and oversized file is "no video", and the work directory, the
 * drawing process and ffmpeg are gone by the time this returns, except the finished file, which
 * belongs to the caller until it calls `dispose`. Photo fetches and the render share the caller's
 * deadline. A cancelled turn throws its reason.
 */
export async function renderRecapShowVideo(input: {
  vault: string; material: RecapMaterial; story: GameRecapEnvelope['story']; assets: readonly RecapAsset[]
  media: ReadonlyMap<string, Buffer>; fetchReference(id: string, signal: AbortSignal): Promise<Buffer>
  signal?: AbortSignal; deadlineAt: number; childPath?: string; scratchRoot?: string
}): Promise<RecapVideoRender> {
  // One render per runner at a time: a second recap at once goes without a video rather than doubling the encoder's memory.
  if (rendering) return { kind: 'refused', reason: 'busy' }
  rendering = true
  let directory: string | null = null
  let kept = false
  const budget = AbortSignal.timeout(Math.max(1, Math.floor(input.deadlineAt - Date.now()) || 1))
  const signal = input.signal ? AbortSignal.any([input.signal, budget]) : budget
  try {
    const root = input.scratchRoot ?? recapVideoScratchRoot(input.vault)
    if (!root) return { kind: 'refused', reason: 'scratch' }
    await mkdir(root, { recursive: true, mode: 0o700 })
    await sweepStaleRenders(root)
    directory = await mkdtemp(path.join(root, RENDER_PREFIX))
    const rendered = await renderInDirectory({ ...input, directory, fetchSignal: signal, budget })
    if (rendered.kind === 'refused') return rendered
    kept = true
    const owned = directory
    return { ...rendered, dispose: () => rm(owned, { recursive: true, force: true }).catch(() => {}) }
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason ?? error
    return { kind: 'refused', reason: 'error' }
  } finally {
    rendering = false
    if (directory && !kept) await rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

/** Build the input, run the child and check its file, inside a render directory the caller owns. */
async function renderInDirectory(input: Parameters<typeof renderRecapShowVideo>[0] & { directory: string; fetchSignal: AbortSignal; budget: AbortSignal }): Promise<
  Omit<Extract<RecapVideoRender, { kind: 'rendered' }>, 'dispose'> | Extract<RecapVideoRender, { kind: 'refused' }>> {
  const built = await buildInput({ ...input, signal: input.fetchSignal }).catch(() => 'input')
  if (input.signal?.aborted) throw input.signal.reason
  if (typeof built === 'string') return { kind: 'refused', reason: input.budget.aborted ? 'timeout' : built }
  const outPath = path.join(input.directory, 'recap.mp4'), requestPath = path.join(input.directory, 'request.json')
  const timeoutMs = Math.max(1, input.deadlineAt - Date.now())
  const request: RecapVideoChildRequest = { input: built.input, outPath, deadlineMs: timeoutMs }
  await writeFile(requestPath, JSON.stringify(request), { flag: 'wx', mode: 0o600 })
  const result = await runChild({ childPath: input.childPath ?? rendererChildPath(), requestPath, directory: input.directory, timeoutMs, signal: input.signal })
  if (result === 'aborted') throw new Error('The recap turn was cancelled.')
  if (typeof result === 'string') return { kind: 'refused', reason: result }
  if (!result.ok) return { kind: 'refused', reason: result.code }
  const size = (await stat(outPath).catch(() => null))?.size ?? 0
  if (size < 1 || size > RECAP_VIDEO_MAX_BYTES) return { kind: 'refused', reason: 'too_large' }
  const hash = createHash('sha256').update(await readFile(outPath)).digest('hex')
  return { kind: 'rendered', file: outPath, hash, byteLength: size, referenceIds: built.referenceIds }
}

/**
 * For the runner image smoke: start the installed renderer exactly as a recap does, on a show whose
 * cover it lays out by measuring text with its own fonts on the native canvas, and whose song title
 * it then refuses because those fonts cannot draw it. Returns the refusal.
 */
export async function probeRecapVideoRenderer(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'murph-recap-video-probe-'))
  try {
    const requestPath = path.join(directory, 'request.json')
    const request: RecapVideoChildRequest = { outPath: path.join(directory, 'recap.mp4'), deadlineMs: 60_000, input: {
      show: { treatment: 'Probe', pages: [
        { id: 'page-0', kind: 'cover', background: 'night', blocks: [{ kind: 'headline', text: 'M'.repeat(64) }], cueMs: 0 },
        { id: 'song', kind: 'song', background: 'night', blocks: [], cueMs: 5200, song: { title: 'Probe \u30e8\u30ac', lyrics: ['La'] } },
        { id: 'result', kind: 'result', background: 'paper', blocks: [] },
      ] },
      players: { a: { name: 'A' }, b: { name: 'B' } }, scores: { a: 1, b: 0 },
      outcome: { kind: 'won', winnerId: 'a', loserId: 'b' }, stake: { kind: 'prize', title: 'Lunch' },
      scenes: {}, photos: {}, score: { path: path.join(directory, 'none.mp3'), durationMs: 25_000, songMs: 20_000 },
    } }
    await writeFile(requestPath, JSON.stringify(request), { flag: 'wx', mode: 0o600 })
    const result = await runChild({ childPath: rendererChildPath(), requestPath, directory, timeoutMs: 60_000 })
    return typeof result === 'string' ? result : result.ok ? 'rendered' : result.code
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const HANDOFF_PREFIX = 'accepted-'
const HANDOFF_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * The accepted video for delivery: Web's identity, with the file only when this host holds those
 * exact bytes. A candidate whose hash, length and generation equal the identity is moved beside
 * the renders, named by the identity (so a retried turn on this runner finds it); otherwise a file
 * an earlier attempt moved there is used. It stays out of the model's reach, like the renders, and
 * the sender checks the bytes again before it uploads them. Files older than a day that no outbox
 * took are removed here.
 */
export async function handOverRecapVideo(identity: RecapVideoIdentity | null, candidate: { draft: RecapVideoDraft; file: string } | null): Promise<(RecapVideoIdentity & { file: string }) | undefined> {
  if (!identity) return undefined
  const target = await recapVideoHandoffPath(identity)
  const root = target && path.dirname(target)
  const accepted = { generationId: identity.generationId, hash: identity.hash, byteLength: identity.byteLength }
  if (!root || !target) return undefined
  const matches = candidate && candidate.draft.hash === identity.hash && candidate.draft.byteLength === identity.byteLength
    && candidate.draft.parts.every(part => part.storageKey.startsWith(`recap/${identity.generationId}/`))
  if (matches && path.dirname(path.dirname(candidate.file)) === root) await rename(candidate.file, target)
  await sweepHandoffs(root, target)
  // Without the accepted bytes here there is nothing to send: the recap goes as its line and link.
  const held = await stat(target).then(file => file.isFile() && file.size === identity.byteLength, () => false)
  return held ? { ...accepted, file: target } : undefined
}

/**
 * The one place an accepted video's file can be: derived from the identity, inside the runner's own
 * directory. The outbox intent names only the identity, because the model's shell can edit it; a
 * path read from it could make the host read or delete any file. Null for an identity of any other shape.
 */
export async function recapVideoHandoffPath(identity: { generationId: string; hash: string }): Promise<string | null> {
  const root = recapVideoScratchRoot()
  if (!root || !/^[a-f0-9]{32}$/u.test(identity.generationId) || !/^[a-f0-9]{64}$/u.test(identity.hash)) return null
  return path.join(root, `${HANDOFF_PREFIX}${identity.generationId}-${identity.hash}.mp4`)
}

async function sweepHandoffs(root: string, keep: string): Promise<void> {
  const now = Date.now()
  for (const name of await readdir(root).catch(() => [] as string[])) {
    const file = path.join(root, name)
    if (!name.startsWith(HANDOFF_PREFIX) || file === keep) continue
    const modified = await stat(file).then(info => info.mtimeMs, () => now)
    if (now - modified > HANDOFF_MAX_AGE_MS) await rm(file, { force: true })
  }
}

/** The file as the stored parts it travels in, in order. */
export function recapVideoParts(bytes: Buffer): Buffer[] {
  const parts: Buffer[] = []
  for (let offset = 0; offset < bytes.length; offset += RECAP_VIDEO_PART_MAX_BYTES) parts.push(bytes.subarray(offset, offset + RECAP_VIDEO_PART_MAX_BYTES))
  return parts
}
