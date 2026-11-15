import { gameRecapDraftSchema, recapMusicPageKinds, recapFirstSungWordMs, recapSongLines, type GameRecapStory } from '@murphai/contracts/recap-show'
import { inspectMp3Frames } from '@murphai/operator-config/generated-audio'
import { generateElevenLabsMusic, resolveElevenLabsApiKey, ELEVENLABS_MUSIC_MODEL_ID, ELEVENLABS_MUSIC_OUTPUT_FORMAT, type ElevenLabsMusicChunk } from '@murphai/operator-config/elevenlabs-runtime'
import { recapScoreSignature } from '../assistant/recap-files.js'
import type { GeneratedMediaFileRuntime } from './generated-media-file.js'
import type { GenerateVoiceMemoToolResult } from './generate-voice-memo-tool.js'
import { toolFailureDiagnostic } from './tool-failure-diagnostics.js'

const cues = {
  cover: ['Intro', 'sparse opening', 'one instrument states the main melody', 'curtain rising'],
  scene: ['Theme', 'full band', 'the lead instrument carries the main melody'],
  text: ['Breakdown', 'the band drops out', 'one held chord', 'a comic pause'],
  print: ['Groove', 'rhythm section locks in', 'the main melody carried quietly', 'a little busier than before'],
  superlative: ['Fanfare', 'a short fanfare on the main melody', 'drums pushing'],
  last: ['Pre-Chorus', 'full band rising', 'building anticipation', 'ends on a held dominant chord'],
} as const

export function buildRecapScorePlan(story: GameRecapStory, voice: string): ElevenLabsMusicChunk[] {
  const kinds = recapMusicPageKinds(story), song = story.song
  if (!song || kinds.length < 1 || kinds.length > 9) throw new Error('The draft needs music pages, a style and lyrics.')
  if (song.lyrics.some(line => /[\r\n]/u.test(line) || line.length > 200)) throw new Error('Each lyric must be one line of at most 200 characters.')
  return [...kinds.map((kind, index): ElevenLabsMusicChunk => {
    const last = index === kinds.length - 1
    const [name, ...styles] = cues[last ? 'last' : kind]
    return { text: `[${name}]` + (last ? '\n{drum fill and pickup, the band stops on the last beat for the singer}' : ''),
      positiveStyles: [song.style, '96 BPM', '4/4', 'instrumental', ...styles],
      negativeStyles: ['vocals', 'lyrics', 'singing', 'spoken word'], durationMs: 5000, contextAdherence: 'high' }
  }), { text: '[Chorus]\n' + song.lyrics.join('\n'), positiveStyles: [song.style, voice, '96 BPM', '4/4',
    'the melody the band has been playing, now sung', 'full band', 'big finish',
    'the singer comes in on the very first beat', 'no instrumental intro'],
  negativeStyles: ['instrumental intro', 'long intro', 'instrumental break'], durationMs: 20_000, contextAdherence: 'high' }]
}

export async function executeGenerateRecapSongFile(input: {
  draft: unknown; voice: string; fileRuntime: GeneratedMediaFileRuntime; env?: NodeJS.ProcessEnv; abortSignal?: AbortSignal | null
}): Promise<GenerateVoiceMemoToolResult> {
  try {
    input.abortSignal?.throwIfAborted()
    const { story } = gameRecapDraftSchema.parse(input.draft)
    const chunks = buildRecapScorePlan(story, input.voice)
    const durationMs = chunks.reduce((sum, chunk) => sum + chunk.durationMs, 0), sungStartMs = durationMs - 20_000
    const runtime = input.fileRuntime
    const apiKey = runtime.elevenLabsApiKey ?? resolveElevenLabsApiKey(input.env ?? {})
    if (!apiKey) throw new Error('Song generation is unavailable.')
    const result = await generateElevenLabsMusic({ apiKey, chunks, durationMs, forceInstrumental: false,
      modelId: ELEVENLABS_MUSIC_MODEL_ID, outputFormat: ELEVENLABS_MUSIC_OUTPUT_FORMAT, prompt: story.song!.style,
      fetchImplementation: (url, init) => runtime.fetchImpl(url, init), signal: input.abortSignal ?? undefined })
    const stream = inspectMp3Frames(result.bytes)
    const firstWordMs = recapFirstSungWordMs(result.wordsTimestamps ?? [], sungStartMs)
    // The song starts 200 ms before its first word, and never after the planned start: a singer who comes in
    // late lengthens the song's own opening, never the page before it, so one take is always enough.
    const cut = firstWordMs === undefined ? undefined
      : [...stream.frames].reverse().find(frame => frame.timeMs <= Math.min(firstWordMs - 200, sungStartMs))
    if (Math.abs(stream.durationMs - durationMs) > 500 || firstWordMs === undefined || firstWordMs >= stream.durationMs || !cut
      || !recapSongLines(story.song!.lyrics, { ...result, durationMs: stream.durationMs, songStartMs: cut.timeMs }, sungStartMs)) {
      throw new Error('Generated music has no usable sung part or does not fit these pages.')
    }
    input.abortSignal?.throwIfAborted()
    const file = await runtime.save(result.bytes, 'audio/mpeg', result.wordsTimestamps,
      { songStartMs: cut.timeMs, signature: recapScoreSignature(story) })
    return { rpcSuccess: true, rpcText: JSON.stringify({ path: file }) }
  } catch (error) {
    if (input.abortSignal?.aborted) throw input.abortSignal.reason ?? error
    return { rpcSuccess: false, rpcText: error instanceof Error ? error.message : 'Song generation failed.', failureDiagnostic: toolFailureDiagnostic('handler_exception', error) }
  }
}
