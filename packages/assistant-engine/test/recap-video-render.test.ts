import { createHash } from 'node:crypto'
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RecapAsset } from '@murphai/contracts/recap-show'
import type { RecapVideoChildRequest } from '@murphai/recap-video'
import { recapVideoParts, renderRecapShowVideo } from '../src/assistant/recap-video-render.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

const ENTRY_REF = '1'.repeat(64), PROFILE_REF = '2'.repeat(64)
const poster = { outcome: { kind: 'won', winnerMemberId: 'player-a', loserMemberId: 'player-b' },
  stake: { kind: 'prize', title: 'Synthetic lunch', owedByMemberId: 'player-b', owedToMemberId: 'player-a' } }
const material = (game: Record<string, unknown> = { id: 'game_synthetic', poster, days: [{ posts: { 'Player A': { entryId: 'entry-a', incomplete: true }, 'Player B': 'missed' } }] }) => ({
  game, players: ['Player A', 'Player B'],
  entries: [{ entryId: 'entry-a', kind: 'photo', playerName: 'Player A', text: null, visibleToBoth: true }],
  result: [{ memberId: 'player-a', name: 'Player A', score: 6 }, { memberId: 'player-b', name: 'Player B', score: 4 }],
  startedAt: '2026-11-01T00:00:00Z', settledAt: '2026-11-08T00:00:00Z',
  references: [{ id: ENTRY_REF, kind: 'entry' as const, memberId: 'player-a', entryId: 'entry-a' }, { id: PROFILE_REF, kind: 'profile' as const, memberId: 'player-a' }],
})
const story = { treatment: 'Mat noir', chatLine: 'The mat week ended.', song: { title: 'Mat song', style: 'Folk', lyrics: ['Leo wins'] },
  pages: [
    { background: 'night' as const, blocks: [{ kind: 'headline' as const, text: 'The mat week' }, { kind: 'scene' as const, scene: { cast: ['Player A'], prompt: 'A synthetic mat' } }] },
    { background: 'paper' as const, blocks: [{ kind: 'photo' as const, entryIds: ['entry-a'] }] },
  ] }
const generation = 'c'.repeat(32)
const assets: RecapAsset[] = [
  { slot: 'scene-0', kind: 'image', recipeId: 'synthetic', storageKey: `recap/${generation}/${'d'.repeat(64)}.jpg`, references: [], hash: 'd'.repeat(64), mediaType: 'image/jpeg', byteLength: 3, width: 1024, height: 1536 },
  { slot: 'song', kind: 'song', recipeId: 'synthetic', storageKey: `recap/${generation}/${'e'.repeat(64)}.mp3`, references: [], hash: 'e'.repeat(64), mediaType: 'audio/mpeg', byteLength: 3,
    durationMs: 30_000, songStartMs: 9800, wordsTimestamps: [{ word: 'Leo', startMs: 10_000, endMs: 10_400 }, { word: 'wins', startMs: 10_500, endMs: 11_000 }] },
]
const media = new Map([['scene-0', Buffer.from('scene')], ['song', Buffer.from('score')]])

/** A stand-in for the renderer's child: it runs `body` with the request in scope, as a real process. */
async function fakeChild(body: string): Promise<{ childPath: string; seen: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'recap-video-fake-')); roots.push(root)
  const seen = path.join(root, 'seen.json'), childPath = path.join(root, 'child.mjs')
  await writeFile(childPath, `import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'))
copyFileSync(process.argv[2], ${JSON.stringify(seen)})
const say = value => process.stdout.write(JSON.stringify(value) + '\\n')
${body}\n`)
  return { childPath, seen }
}

const render = (childPath: string, extra: Partial<Parameters<typeof renderRecapShowVideo>[0]> = {}) => renderRecapShowVideo({
  material: material(), story, assets, media, childPath, timeoutMs: 20_000,
  fetchReference: async id => Buffer.from(`photo ${id.slice(0, 4)}`), ...extra,
})
const workDirectories = async () => (await readdir(os.tmpdir())).filter(name => name.startsWith('murph-recap-video-'))
const groupAlive = (pid: number) => { try { process.kill(-pid, 0); return true } catch { return false } }

describe('recap video render step', () => {
  it('draws the show as the app presents it, from trusted inputs only, and hands back one checked file', async () => {
    const { childPath, seen } = await fakeChild(`writeFileSync(request.outPath, 'synthetic mp4'); say({ ok: true, bytes: 13, frames: 1, drawMs: 1, encoder: null })`)
    const before = await workDirectories()
    const rendered = await render(childPath)
    if (rendered.kind !== 'rendered') throw new Error(rendered.reason)
    expect(rendered).toMatchObject({ byteLength: 13, hash: createHash('sha256').update('synthetic mp4').digest('hex') })
    // The sources the video shows, for Web to resolve and check itself.
    expect(rendered.referenceIds.sort()).toEqual([ENTRY_REF, PROFILE_REF])
    const { input } = JSON.parse(await readFile(seen, 'utf8')) as RecapVideoChildRequest
    expect(input.show.pages.map(page => [page.id, page.kind, page.cueMs])).toEqual([['page-0', 'cover', 0], ['page-1', 'print', 5000], ['song', 'song', 10_000], ['result', 'result', undefined]])
    expect(input).toMatchObject({ outcome: { kind: 'won', winnerId: 'player-a', loserId: 'player-b' }, stake: { kind: 'prize', title: 'Synthetic lunch' },
      scores: { 'player-a': 6, 'player-b': 4 }, unfinished: ['entry-a'], score: { durationMs: 30_000, songMs: 20_200 } })
    expect(input.players['player-b']).toEqual({ name: 'Player B' })
    // Every file the renderer reads was written by the host, outside the model's workspace.
    for (const file of [input.scenes['page-0']!, input.photos['entry-a']!, input.players['player-a']!.avatarPath!, input.score.path]) {
      expect(path.dirname(file)).toBe(path.dirname(rendered.file))
    }
    expect(await readFile(input.photos['entry-a']!, 'utf8')).toBe('photo 1111')
    expect(await readFile(input.scenes['page-0']!, 'utf8')).toBe('scene')
    await rendered.dispose()
    await expect(access(path.dirname(rendered.file))).rejects.toThrow()
    expect(await workDirectories()).toEqual(before)
  })

  it.each([
    ['a dare', { ...poster, stake: { ...poster.stake, kind: 'dare' } }, { kind: 'punishment', title: 'Synthetic lunch' }, { kind: 'won' }],
    ['a both-win', { outcome: { kind: 'even', everyDay: true }, stake: { kind: 'both_win', title: 'Dinner out' } }, { kind: 'bothWin', title: 'Dinner out' }, { kind: 'even', everyDay: true }],
    ['an even game', { outcome: { kind: 'even', everyDay: false }, stake: { kind: 'none' } }, { kind: 'none' }, { kind: 'even', everyDay: false }],
  ])('names %s in the renderer\'s words', async (_name, gamePoster, stake, outcome) => {
    const { childPath, seen } = await fakeChild(`say({ ok: false, code: 'unsupported_text' })`)
    await expect(render(childPath, { material: material({ id: 'g', poster: gamePoster, days: [] }) })).resolves.toEqual({ kind: 'refused', reason: 'unsupported_text' })
    expect((JSON.parse(await readFile(seen, 'utf8')) as RecapVideoChildRequest).input).toMatchObject({ stake, outcome })
  })

  it.each([
    ['no poster (Web without the flag)', material({ id: 'g', days: [] }), 'poster'],
    ['a stake the last screen has no drawing for', material({ id: 'g', poster: { ...poster, stake: { kind: 'other' } }, days: [] }), 'poster'],
    ['a ticket owed the other way', material({ id: 'g', poster: { ...poster, stake: { ...poster.stake, owedByMemberId: 'player-a', owedToMemberId: 'player-b' } }, days: [] }), 'poster'],
    ['an even game without its every-day fact', material({ id: 'g', poster: { outcome: { kind: 'even' }, stake: { kind: 'none' } }, days: [] }), 'poster'],
    ['days it cannot read', material({ id: 'g', poster }), 'material'],
  ])('makes no video, and starts no renderer, for %s', async (_name, value, reason) => {
    const { childPath, seen } = await fakeChild(`say({ ok: true })`)
    await expect(render(childPath, { material: value })).resolves.toEqual({ kind: 'refused', reason })
    await expect(access(seen)).rejects.toThrow()
  })

  it('makes no video for a show without a score, or when a photo cannot be fetched again', async () => {
    const { childPath, seen } = await fakeChild(`say({ ok: true })`)
    const songOnly = assets.map(asset => asset.slot === 'song' ? { ...asset, songStartMs: undefined } : asset)
    await expect(render(childPath, { assets: songOnly })).resolves.toEqual({ kind: 'refused', reason: 'score' })
    await expect(render(childPath, { fetchReference: async () => { throw new Error('Synthetic unavailable') } })).resolves.toEqual({ kind: 'refused', reason: 'input' })
    await expect(access(seen)).rejects.toThrow()
  })

  it.each([
    ['a renderer refusal', `say({ ok: false, code: 'does_not_fit' })`, 'does_not_fit'],
    ['a crash', `process.exit(3)`, 'crashed'],
    ['output that is not a result', `process.stdout.write('not json')`, 'crashed'],
    ['a file over the budget', `writeFileSync(request.outPath, Buffer.alloc(8_000_001)); say({ ok: true, bytes: 8_000_001, frames: 1, drawMs: 1, encoder: null })`, 'too_large'],
    ['a success with no file', `say({ ok: true, bytes: 1, frames: 1, drawMs: 1, encoder: null })`, 'too_large'],
  ])('turns %s into no video and leaves nothing behind', async (_name, body, reason) => {
    const { childPath } = await fakeChild(body)
    const before = await workDirectories()
    await expect(render(childPath)).resolves.toEqual({ kind: 'refused', reason })
    expect(await workDirectories()).toEqual(before)
  })

  // The child stands in for the drawing process and its sleeping grandchild for ffmpeg. It records both pids outside its work directory.
  const hanging = async () => {
    const pids = path.join(await mkdtemp(path.join(os.tmpdir(), 'recap-video-pids-')), 'pids.json')
    roots.push(path.dirname(pids))
    const child = await fakeChild(`const encoder = spawn('sleep', ['60'], { stdio: 'ignore' }); writeFileSync(${JSON.stringify(pids)}, JSON.stringify([process.pid, encoder.pid])); setInterval(() => {}, 1000)`)
    return { ...child, pids: async () => JSON.parse(await readFile(pids, 'utf8')) as [number, number] }
  }
  it('stops a render that runs past its time, encoder and all, and carries on without a video', async () => {
    const { childPath, pids } = await hanging()
    const before = await workDirectories()
    const started = Date.now()
    await expect(render(childPath, { timeoutMs: 1500 })).resolves.toEqual({ kind: 'refused', reason: 'timeout' })
    expect(Date.now() - started).toBeLessThan(10_000)
    const [child, encoder] = await pids()
    expect(groupAlive(child)).toBe(false)
    expect(() => process.kill(encoder, 0)).toThrow()
    expect(await workDirectories()).toEqual(before)
  })

  it('stops the render when the turn is cancelled, and the cancellation goes on', async () => {
    const { childPath, pids } = await hanging()
    const controller = new AbortController()
    const before = await workDirectories()
    const pending = render(childPath, { signal: controller.signal })
    await new Promise(resolve => setTimeout(resolve, 800))
    controller.abort(new Error('Synthetic cancel'))
    await expect(pending).rejects.toThrow('Synthetic cancel')
    const [child, encoder] = await pids()
    expect(groupAlive(child)).toBe(false)
    expect(() => process.kill(encoder, 0)).toThrow()
    expect(await workDirectories()).toEqual(before)
  })

  it('renders one show at a time per runner', async () => {
    const { childPath } = await fakeChild(`setTimeout(() => { writeFileSync(request.outPath, 'x'); say({ ok: true, bytes: 1, frames: 1, drawMs: 1, encoder: null }) }, 500)`)
    const [first, second] = await Promise.all([render(childPath), render(childPath)])
    expect(second).toEqual({ kind: 'refused', reason: 'busy' })
    expect(first.kind).toBe('rendered')
    if (first.kind === 'rendered') await first.dispose()
  })

  it('cuts the file into the parts it is stored in, in order', () => {
    const file = Buffer.alloc(5_200_000, 7)
    const parts = recapVideoParts(file)
    expect(parts.map(part => part.length)).toEqual([2_000_000, 2_000_000, 1_200_000])
    expect(Buffer.concat(parts).equals(file)).toBe(true)
    expect(recapVideoParts(Buffer.alloc(8_000_000)).length).toBe(4)
  })
})
