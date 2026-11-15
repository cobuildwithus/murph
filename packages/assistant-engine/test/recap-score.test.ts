import { expect, test, vi } from 'vitest'
import { gameRecapDraftSchema, presentGameRecap, type GameRecapStory } from '@murphai/contracts/recap-show'
import { inspectMp3Frames } from '@murphai/operator-config/generated-audio'
import { buildRecapScorePlan, executeGenerateRecapSongFile } from '../src/assistant-codex/recap-song.ts'
import { recapScoreSignature } from '../src/assistant/recap-files.ts'

const textPage = (text: string) => ({ background: 'paper' as const, blocks: [{ kind: 'headline' as const, text }] })
const story = gameRecapDraftSchema.parse({ story: { chatLine: 'Synthetic.', pages: [textPage('Cover'), textPage('One'), textPage('Two'),
  { background: 'paper', blocks: [{ kind: 'photo', entryIds: ['photo'] }] },
  { background: 'paper', blocks: [{ kind: 'scene', scene: { cast: ['Player A'], prompt: 'Synthetic stage.' } }] }],
superlatives: [{ memberId: 'a', title: 'Hold the line', line: 'A line.' }, { memberId: 'b', title: 'Keep the beat', line: 'Another line.' }],
song: { title: 'Hello', style: 'Piano comedy', lyrics: ['Hello friend', 'We meet again'] } }, files: [] }).story

function response(audio: Uint8Array, first: number): Response {
  const words = ['Hello', 'friend', 'We', 'meet', 'again'].map((word, i) => ({ word, start_ms: first + i * 300, end_ms: first + i * 300 + 200 }))
  return new Response(Buffer.concat([Buffer.from(`--synthetic\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ words_timestamps: [
    { word: 'direction', start_ms: 0, end_ms: 0 }, { word: 'Hello', start_ms: 10, end_ms: 30 }, ...words,
  ] })}\r\n--synthetic\r\nContent-Type: audio/mpeg\r\n\r\n`), audio, Buffer.from('\r\n--synthetic--\r\n')]),
  { headers: { 'content-type': 'multipart/mixed; boundary=synthetic' } })
}

test('the score uses the fixed cues, and voice only in the sung chunk', () => {
  const plan = buildRecapScorePlan(story, 'Warm baritone')
  expect(plan.map(chunk => chunk.text.split('\n')[0])).toEqual(['[Intro]', '[Breakdown]', '[Breakdown]', '[Groove]', '[Theme]', '[Fanfare]', '[Pre-Chorus]', '[Chorus]'])
  expect(plan.at(-2)?.text).toBe('[Pre-Chorus]\n{drum fill and pickup, the band stops on the last beat for the singer}')
  for (const chunk of plan.slice(0, -1)) {
    expect(chunk).toMatchObject({ durationMs: 5000, contextAdherence: 'high', negativeStyles: ['vocals', 'lyrics', 'singing', 'spoken word'] })
    expect(chunk.positiveStyles.slice(0, 4)).toEqual([story.song!.style, '96 BPM', '4/4', 'instrumental'])
    expect(chunk.positiveStyles).not.toContain('Warm baritone')
  }
  expect(plan.at(-1)).toEqual({ text: '[Chorus]\nHello friend\nWe meet again', durationMs: 20_000, contextAdherence: 'high',
    positiveStyles: [story.song!.style, 'Warm baritone', '96 BPM', '4/4', 'the melody the band has been playing, now sung', 'full band', 'big finish', 'the singer comes in on the very first beat', 'no instrumental intro'],
    negativeStyles: ['instrumental intro', 'long intro', 'instrumental break'] })
  expect(buildRecapScorePlan({ ...story, pages: [story.pages[0]!], superlatives: [] }, 'Voice')[0]?.text).toContain('[Pre-Chorus]')
})

test('only the music kind sequence, style and lyrics bind the generated file', () => {
  const signature = recapScoreSignature(story)
  const changed = (edit: (draft: GameRecapStory) => void) => { const draft = structuredClone(story); edit(draft); return recapScoreSignature(draft) }
  for (const edit of [
    (s: GameRecapStory) => { s.pages.push(textPage('New')) }, (s: GameRecapStory) => { s.pages.pop() },
    (s: GameRecapStory) => { s.superlatives!.pop() }, (s: GameRecapStory) => { s.superlatives!.push({ memberId: 'c', title: 'New card', line: 'New' }) },
    (s: GameRecapStory) => { [s.pages[1], s.pages[3]] = [s.pages[3]!, s.pages[1]!] },
    (s: GameRecapStory) => { s.pages[1]!.blocks = [{ kind: 'photo', entryIds: ['photo'] }] },
    (s: GameRecapStory) => { s.song!.style = 'Jazz' }, (s: GameRecapStory) => { s.song!.lyrics = ['Changed lyrics'] },
  ]) expect(changed(edit)).not.toBe(signature)
  for (const edit of [
    (s: GameRecapStory) => { s.pages[1]!.blocks[0]!.text = 'Edited words' },
    (s: GameRecapStory) => { [s.pages[1], s.pages[2]] = [s.pages[2]!, s.pages[1]!] },
    (s: GameRecapStory) => { s.superlatives!.reverse() }, (s: GameRecapStory) => { s.chatLine = 'New chat' },
  ]) expect(changed(edit)).toBe(signature)
  expect(recapScoreSignature(gameRecapDraftSchema.parse({ story, files: [{ slot: 'song', path: 'song.mp3' }] }).story)).toBe(signature)
})

test.each([1, 3])('cuts on and off the 24 ms grid for %s pages, opens the song on the planned start and shares one lyric clock', async count => {
  const draft = { story: { ...story, pages: story.pages.slice(0, count), superlatives: [] }, files: [] }
  // Real-shaped MPEG-1 Layer III, 48 kHz / 192 kbps silence frames: 24 ms each.
  const duration = count * 5000 + 20_000, planned = count * 5000
  const frame = Buffer.alloc(576); frame.set([0xff, 0xfb, 0xb4, 0])
  const audio = Buffer.concat(Array.from({ length: Math.round(duration / 24) }, () => frame))
  for (const delay of [0, 25, 150, 200, 201, 2500, 5000, 5600]) {
    const first = planned + delay
    const save = vi.fn<import('../src/assistant-codex/generated-media-file.ts').GeneratedMediaFileRuntime['save']>(async () => 'song.mp3')
    const fetchImpl = vi.fn<typeof fetch>(async () => response(audio, first))
    expect(await executeGenerateRecapSongFile({ draft, voice: 'Warm voice', fileRuntime: { elevenLabsApiKey: 'synthetic', fetchImpl, save, resolveReferences: async () => [] } })).toMatchObject({ rpcSuccess: true })
    // A singer more than a second late is retaken twice; these takes are all equally late, so the first is kept.
    expect(fetchImpl).toHaveBeenCalledTimes(delay > 1000 ? 3 : 1)
    const [bytes, , words, score] = save.mock.calls[0]!
    expect(Buffer.from(bytes).equals(audio)).toBe(true)
    const cut = inspectMp3Frames(audio).frames.find(f => f.timeMs === score!.songStartMs)!
    expect(cut.byteOffset % 576).toBe(0)
    // On time, the song starts 200 ms before its first word, as it always has; late, it starts by the planned start.
    const origin = Math.min(first - 200, planned)
    expect(cut.timeMs).toBeLessThanOrEqual(origin)
    expect(origin - cut.timeMs).toBeLessThan(24)
    if (delay <= 200) expect(first - cut.timeMs).toBeGreaterThanOrEqual(200)
    const view = presentGameRecap({ stored: { version: 1, generationId: 'synthetic', story: draft.story, acceptedAt: '2026-11-14T00:00:00Z',
      preview: { token: 'synthetic-preview-token-with-no-authority', expiresAt: '2026-12-14T00:00:00Z' }, assets: [{ slot: 'song', kind: 'song', recipeId: 'synthetic', storageKey: 'synthetic', hash: 'a'.repeat(64), references: [], byteLength: audio.length, mediaType: 'audio/mpeg', durationMs: Math.round(inspectMp3Frames(audio).durationMs), songStartMs: cut.timeMs, wordsTimestamps: words }] },
    permittedPhotoIds: new Set(), mediaUrl: slot => `/synthetic/${slot}` })
    const pages = view.show!.pages, song = pages.find(page => page.kind === 'song')!
    // Every story page keeps its five seconds: the song page opens on the planned start, however late the singer.
    expect(pages.flatMap(page => page.cueMs === undefined ? [] : [page.cueMs])).toEqual([...Array.from({ length: count }, (_, index) => index * 5000), planned])
    // Its first word lights when it is sung, on the song's own clock.
    expect(song.song!.lines![0]!.words[0]!.startMs).toBe(Math.round(first - cut.timeMs))
    if (song.media?.status !== 'ready' || view.show!.score!.media.status !== 'ready') throw new Error('Missing media')
    const songOrigin = view.show!.score!.media.durationMs! - song.media.durationMs!
    expect(songOrigin).toBeCloseTo(cut.timeMs, -1)
    expect(songOrigin).toBeLessThanOrEqual(song.cueMs!)
    expect(view.show!.pages.at(-1)).not.toHaveProperty('cueMs')
  }
})

// The full story has seven music pages, so the singing is planned to start at 35 s.
const planned = 35_000
// Each take's audio carries its own marker byte, so the saved file names the take that was kept.
const takeAudio = (marker: number) => {
  const frame = Buffer.alloc(576); frame.set([0xff, 0xfb, 0xb4, 0]); frame[100] = marker
  return Buffer.concat(Array.from({ length: Math.round((planned + 20_000) / 24) }, () => frame))
}
// A refused, failed or malformed response; valid MP3 that is too short; or valid MP3 whose words all come before the song.
type Take = number | 'denied' | 'failed' | 'malformed' | 'short' | 'unsung' | 'cancel'

async function generate(takes: readonly Take[], { abortFirst = false } = {}) {
  const controller = new AbortController(), reason = new Error('Synthetic cancellation')
  if (abortFirst) controller.abort(reason)
  let calls = 0, requestAborted = false
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
    const take = takes[calls++]
    if (take === undefined) throw new Error('Unexpected take')
    // The request itself must see the cancellation: it rejects only when its own signal aborts.
    if (take === 'cancel') return await new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => { requestAborted = true; reject(init.signal!.reason) }, { once: true })
      controller.abort(reason)
    })
    if (take === 'denied') return new Response('Recap media request limit reached.', { status: 429 })
    if (take === 'failed') throw new Error('Synthetic transport failure')
    if (take === 'malformed') return response(new Uint8Array([1, 2]), planned)
    if (take === 'short') return response(takeAudio(calls).subarray(0, 576 * Math.round(50_000 / 24)), planned)
    if (take === 'unsung') return response(takeAudio(calls), planned - 10_000)
    return response(takeAudio(calls), planned + take)
  })
  const save = vi.fn<import('../src/assistant-codex/generated-media-file.ts').GeneratedMediaFileRuntime['save']>(async () => 'song.mp3')
  const result = executeGenerateRecapSongFile({ draft: { story, files: [] }, voice: 'Warm voice', abortSignal: controller.signal,
    fileRuntime: { elevenLabsApiKey: 'synthetic', fetchImpl, save, resolveReferences: async () => [] } })
  return { result, reason, fetchImpl, save, requestAborted: () => requestAborted,
    /** Which take was saved, counting from 1, and how late its singer is. */
    kept: () => ({ take: Buffer.from(save.mock.calls[0]![0])[100], lateMs: save.mock.calls[0]![2]![1]!.startMs - planned }) }
}

test.each<[string, Take[], number, number]>([
  ['an on-time singer is kept with no retake', [0], 1, 0],
  ['a singer exactly a second late is still on time', [1000], 1, 1000],
  ['a late first take is retaken and the on-time retake kept', [5000, 300], 2, 300],
  ['a retake that is only earlier is retaken again', [5000, 2500, 0], 3, 0],
  ['when every take is late the earliest singer is kept', [5000, 2500, 4960], 2, 2500],
  ['a later retake never replaces an earlier take', [2500, 5000, 5600], 1, 2500],
  ['a refused retake leaves the valid first take and ends the retakes', [5000, 'denied'], 1, 5000],
  ['a failed retake leaves the valid first take', [5000, 'failed'], 1, 5000],
  ['a malformed retake leaves the valid first take', [5000, 'malformed'], 1, 5000],
  ['a retake of the wrong length leaves the valid first take', [5000, 'short'], 1, 5000],
  ['a retake with no sung word after the planned start leaves the valid first take', [5000, 'unsung'], 1, 5000],
  ['a failed second retake leaves the earliest valid take', [5000, 2500, 'failed'], 2, 2500],
])('%s', async (_, takes, keptTake, lateMs) => {
  const run = await generate(takes)
  expect(await run.result).toMatchObject({ rpcSuccess: true })
  expect(run.fetchImpl).toHaveBeenCalledTimes(takes.length)
  expect(run.save).toHaveBeenCalledTimes(1)
  expect(run.kept()).toEqual({ take: keptTake, lateMs })
  // The saved file, its timings and its song start are all from the kept take: the 24 ms frame at or before
  // 200 ms ahead of its first word, and never after the planned start.
  expect(run.save.mock.calls[0]![3]!.songStartMs).toBe(Math.floor(Math.min(planned + lateMs - 200, planned) / 24) * 24)
})

test('a song call makes at most three music requests', async () => {
  // The recap's seven media requests hold four scenes and these three takes.
  const run = await generate([5600, 5600, 5600])
  expect(await run.result).toMatchObject({ rpcSuccess: true })
  expect(run.fetchImpl).toHaveBeenCalledTimes(3)
  expect(run.kept()).toEqual({ take: 1, lateMs: 5600 })
})

test('a first take that fails is not retaken here: the writer decides', async () => {
  const run = await generate(['failed'])
  expect(await run.result).toMatchObject({ rpcSuccess: false })
  expect(run.fetchImpl).toHaveBeenCalledTimes(1)
  expect(run.save).not.toHaveBeenCalled()
})

test.each<[string, Take[]]>([
  ['the first take', ['cancel']],
  ['a retake', [5000, 'cancel']],
  ['the last retake', [5000, 2500, 'cancel']],
])('cancellation during %s propagates and saves nothing', async (_, takes) => {
  const run = await generate(takes)
  await expect(run.result).rejects.toBe(run.reason)
  expect(run.requestAborted()).toBe(true)
  expect(run.save).not.toHaveBeenCalled()
  expect(run.fetchImpl).toHaveBeenCalledTimes(takes.length)
})

test('a song call that is already cancelled makes no request', async () => {
  const run = await generate([0], { abortFirst: true })
  await expect(run.result).rejects.toBe(run.reason)
  expect(run.fetchImpl).not.toHaveBeenCalled()
  expect(run.save).not.toHaveBeenCalled()
})
