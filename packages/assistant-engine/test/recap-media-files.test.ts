import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import * as z from '@murphai/contracts/zod-runtime'
import { afterEach, expect, test, vi } from 'vitest'
import { executeGenerateImageTool } from '../src/assistant-codex/generate-image-tool.ts'
import { executeGenerateSongTool } from '../src/assistant-codex/generate-voice-memo-tool.ts'
import { readRecapFile, saveRecapMediaFile } from '../src/assistant/recap-files.ts'
import { createAssistantHostedToolContext } from '../src/assistant/hosted-tool-context.ts'
import { resolveAssistantSession } from '../src/assistant/store.ts'
import { parseGenerateSongArguments } from '../src/assistant-codex/dynamic-tools/generate-song.ts'
import type { AssistantHostedGroupTool } from '../src/assistant/execution-context.ts'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const relativeRoot = 'tmp/recap/synthetic'
async function vault() { const root = await mkdtemp(path.join(tmpdir(), 'recap-files-')); roots.push(root); return root }

test.each([false, true])('file image uses Sunburst with truthful accounting and no chat media (references=%s)', async withReference => {
  const root = await vault()
  const bytes = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#ddbb77' } }).jpeg().toBuffer()
  const persist = vi.fn()
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toBe(`https://api.openai.com/v1/images/${withReference ? 'edits' : 'generations'}`)
    const request = init?.body instanceof FormData ? Object.fromEntries(init.body) : JSON.parse(String(init?.body))
    expect(request.model).toBe('gpt-image-2.6-sunburst')
    expect(request).not.toHaveProperty('input_fidelity')
    return Response.json({ data: [{ b64_json: bytes.toString('base64') }],
      usage: { input_tokens: 12, output_tokens: 42, total_tokens: 54 } })
  })
  const result = await executeGenerateImageTool({ env: { OPENAI_API_KEY: 'synthetic-key' }, fetchImpl, vaultRoot: root,
    persistGeneratedImageCapture: persist, requireHostedPrivateImageDelivery: true, providerRequestOrdinal: 1,
    args: { outputFormat: 'jpeg', referenceImageRefs: withReference ? ['synthetic-reference'] : [], prompt: 'Synthetic paper theatre.', alt: null, quality: 'medium', size: '1024x1024' },
    fileRuntime: { fetchImpl, resolveReferences: async () => withReference ? [{ bytes, filename: 'reference.jpg', mediaType: 'image/jpeg',
      sourceRef: 'synthetic-reference', sha256: createHash('sha256').update(bytes).digest('hex'), sourceRefSha256: 'a'.repeat(64) }] : [], save: (data, mediaType) => saveRecapMediaFile({ vault: root, relativeRoot, bytes: data, mediaType }) } })
  expect(result.rpcSuccess).toBe(true)
  expect(result.responseMedia).toBeUndefined()
  expect(result.savedCaptureId).toBeUndefined()
  expect(persist).not.toHaveBeenCalled()
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(result.usageDraft).toMatchObject({ provider: 'openai-images', providerRequestOutcome: 'succeeded', usage: { requestedModel: 'gpt-image-2.6-sunburst' } })
  const receipt = JSON.parse(result.rpcText)
  expect(receipt.path).toContain(createHash('sha256').update(bytes).digest('hex'))
  expect(await readFile(path.join(root, receipt.path))).toEqual(bytes)
  expect(result.rpcText).not.toContain(root)
})

test.each(['environment', 'host-only runtime'] as const)('file song uses %s credentials without a voice-memo channel or chat attachment', async credentialSource => {
  const bytes = await readFile(new URL('../../../fixtures/generated-audio/music.mp3', import.meta.url))
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(bytes))
  const save = vi.fn(async () => `${relativeRoot}/media/theme.mp3`)
  const result = await executeGenerateSongTool({ env: credentialSource === 'environment' ? { ELEVENLABS_API_KEY: 'synthetic-key' } : {},
    args: { durationSeconds: 20, instrumental: false, prompt: 'An original playful song for Player A and Player B.' },
    fileRuntime: { elevenLabsApiKey: credentialSource === 'host-only runtime' ? 'synthetic-key' : undefined, fetchImpl, resolveReferences: async () => [], save } })
  expect(result.rpcSuccess).toBe(true)
  expect(result.responseMedia).toBeUndefined()
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/v1/music')
  expect(new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('xi-api-key')).toBe('synthetic-key')
  expect(result.rpcText).not.toContain('synthetic-key')
  expect(save).toHaveBeenCalledWith(new Uint8Array(bytes), 'audio/mpeg')
})

test('candidate files reject traversal, symlinks, oversized bytes and tampering', async () => {
  const root = await vault()
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).jpeg().toBuffer()
  const input = { vault: root, relativeRoot, bytes, mediaType: 'image/jpeg' as const }
  const receipt = await saveRecapMediaFile(input)
  await expect(saveRecapMediaFile(input)).resolves.toEqual(receipt)
  await expect(readRecapFile({ vault: root, relativeRoot, file: `${relativeRoot}/../private`, maxBytes: 100 })).rejects.toThrow('outside')
  await expect(saveRecapMediaFile({ ...input, bytes: new Uint8Array(2 * 1024 * 1024 + 1) })).rejects.toThrow('2 MiB')
  await symlink(path.join(root, receipt), path.join(root, relativeRoot, 'media/link.jpg'))
  await expect(readRecapFile({ vault: root, relativeRoot, file: `${relativeRoot}/media/link.jpg`, maxBytes: 2000 })).rejects.toThrow()
})

test('recap media and trusted song timing belong only to the attempt that generated them', async () => {
  const root = await vault()
  const { session } = await resolveAssistantSession({ vault: root })
  const startedAt = '2026-11-01T00:00:00Z', settledAt = '2026-11-08T00:00:00Z'
  const eventId = 'game-recap:game_synthetic'
  const createContext = () => createAssistantHostedToolContext({ session, messageInput: { vault: root, prompt: '', channel: 'linq' }, executionContext: {
    memberId: 'synthetic-member', userEnvKeys: [],
    gameRecapScope: { gameId: 'game_synthetic', eventId, pairFingerprint: 'a'.repeat(32), show: true },
    groupTool: { request: async () => ({ action: 'read_game', result: { status: 'ok', recapGame: {
      messages: [], next: null, through: '0', since: startedAt, until: settledAt, retainedSince: startedAt, incomplete: false,
    } } }) },
  } })
  const context = createContext()
  const material = { game: { id: 'game_synthetic', days: [] }, players: ['Leo', 'Ava'], entries: [],
    result: [{ memberId: 'leo', name: 'Leo', score: 4 }, { memberId: 'ava', name: 'Ava', score: 3 }], startedAt, settledAt, references: [] }
  await context.prepareGameRecapInputs!(material)
  const args = { durationSeconds: 20, instrumental: false, prompt: 'Playful piano', lyrics: ['Leo goes', 'Ava stays'] }
  const bytes = await readFile(new URL('../../../fixtures/generated-audio/music.mp3', import.meta.url))
  const words = [{ word: 'Leo', start_ms: 100, end_ms: 300 }, { word: 'goes', start_ms: 400, end_ms: 600 }]
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(Buffer.concat([
    Buffer.from(`--synthetic\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ words_timestamps: words })}\r\n--synthetic\r\nContent-Type: audio/mpeg\r\n\r\n`),
    bytes, Buffer.from('\r\n--synthetic--\r\n'),
  ]), { headers: { 'content-type': 'multipart/mixed; boundary=synthetic' } }))
  const fileRuntime = await context.prepareRecapMedia!({ kind: 'song', args }, fetchImpl)
  const result = await executeGenerateSongTool({ env: { ELEVENLABS_API_KEY: 'synthetic-key' }, args, fileRuntime })
  expect(result.rpcSuccess).toBe(true)
  const receipt = JSON.parse(result.rpcText)
  expect(Object.keys(receipt)).toEqual(['path'])
  expect(await context.readGameRecapMedia!(receipt.path)).toEqual({ bytes: bytes.toString('base64'), referenceIds: [], mediaType: 'audio/mpeg',
    wordsTimestamps: [{ word: 'Leo', startMs: 100, endMs: 300 }, { word: 'goes', startMs: 400, endMs: 600 }] })
  const other = await fileRuntime.save(new Uint8Array([1, 2, 3]), 'audio/mpeg', [{ word: 'Ava', startMs: 900, endMs: 1100 }])
  expect((await context.readGameRecapMedia!(receipt.path)).wordsTimestamps?.[0].word).toBe('Leo')
  expect((await context.readGameRecapMedia!(other)).wordsTimestamps?.[0].word).toBe('Ava')
  const imageRuntime = await context.prepareRecapMedia!({ kind: 'image', args: {
    outputFormat: 'jpeg', referenceImageRefs: [], prompt: 'Synthetic paper theatre.',
    alt: null, quality: 'medium', size: '1024x1024',
  } }, fetchImpl)
  const imageBytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).jpeg().toBuffer()
  const imageFile = await imageRuntime.save(imageBytes, 'image/jpeg')
  expect(await context.readGameRecapMedia!(imageFile)).toEqual({ bytes: imageBytes.toString('base64'), referenceIds: [], mediaType: 'image/jpeg' })
  const retry = createContext()
  await retry.prepareGameRecapInputs!(material)
  // A resumed native thread can remember file paths, but cannot carry media authority.
  expect(await readFile(path.join(root, receipt.path))).toEqual(bytes)
  await expect(retry.readGameRecapMedia!(receipt.path)).rejects.toThrow('Select a file')
  await expect(retry.readGameRecapMedia!(imageFile)).rejects.toThrow('Select a file')
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  const retryRuntime = await retry.prepareRecapMedia!({ kind: 'song', args }, fetchImpl)
  const regenerated = await executeGenerateSongTool({ env: { ELEVENLABS_API_KEY: 'synthetic-key' }, args, fileRuntime: retryRuntime })
  expect(regenerated.rpcSuccess).toBe(true)
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  expect(await retry.readGameRecapMedia!(JSON.parse(regenerated.rpcText).path)).toEqual(await context.readGameRecapMedia!(receipt.path))
  await writeFile(path.join(root, receipt.path), 'tampered')
  await expect(context.readGameRecapMedia!(receipt.path)).rejects.toThrow('Select a file')
})

test('a scene names its references by photo path or id, and anything else is refused before any request', async () => {
  const root = await vault()
  const { session } = await resolveAssistantSession({ vault: root })
  const startedAt = '2026-11-01T00:00:00Z', settledAt = '2026-11-08T00:00:00Z'
  const referenceIds = ['a'.repeat(64), 'b'.repeat(64)]
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).jpeg().toBuffer()
  const hash = createHash('sha256').update(bytes).digest('hex')
  const request = vi.fn<AssistantHostedGroupTool['request']>(async input => {
    if (input.action !== 'read_game') throw new Error('Unexpected action')
    return { action: 'read_game', result: { status: 'ok', recapGame: input.recapRead?.kind === 'reference'
      ? { id: input.recapRead.id, bytes: bytes.toString('base64'), hash, mediaType: 'image/jpeg', byteLength: bytes.length, width: 64, height: 64 }
      : { messages: [], next: null, through: '0', since: startedAt, until: settledAt, retainedSince: startedAt, incomplete: false } } }
  })
  const context = createAssistantHostedToolContext({ session, messageInput: { vault: root, prompt: '', channel: 'linq' }, executionContext: {
    memberId: 'synthetic-member', userEnvKeys: [], groupTool: { request },
    gameRecapScope: { gameId: 'game_synthetic', eventId: 'game-recap:game_synthetic', pairFingerprint: 'a'.repeat(32), show: true },
  } })
  const manifest = z.object({ files: z.object({ game: z.string() }) }).parse(await context.prepareGameRecapInputs!({ game: { id: 'game_synthetic' }, players: ['Player A', 'Player B'], entries: [],
    result: [{ memberId: 'a', name: 'Player A', score: 4 }, { memberId: 'b', name: 'Player B', score: 3 }], startedAt, settledAt,
    references: [{ id: referenceIds[0]!, kind: 'profile', memberId: 'a' }, { id: referenceIds[1]!, kind: 'murph' }] }))
  const photoPath = z.object({ references: z.array(z.object({ path: z.string() })) }).parse(JSON.parse(await readFile(path.join(root, manifest.files.game), 'utf8'))).references[0]!.path
  request.mockClear()
  const fetchImpl = vi.fn<typeof fetch>()
  const args = { outputFormat: 'jpeg' as const, prompt: 'Synthetic paper theatre.', alt: null, quality: 'high' as const, size: '1024x1536' as const }
  const unknownRefs = ['skill-assets/murph-character-sheet-v1.png', 'c'.repeat(64), 'x'.repeat(200)]
  await expect(context.prepareRecapMedia!({ kind: 'image', args: { ...args, referenceImageRefs: [photoPath, ...unknownRefs] } }, fetchImpl))
    .rejects.toMatchObject({ shapes: ['skill_asset', 'unlisted_reference', 'other'] })
  await expect(context.prepareRecapMedia!({ kind: 'image', args: { ...args, referenceImageRefs: [photoPath, ...unknownRefs] } }, fetchImpl))
    .rejects.toThrow(`Nothing was generated and no media request was used. referenceImageRefs takes the path of a photo listed under references in game.json. Not one of them: "skill-assets/murph-character-sheet-v1.png", "${'c'.repeat(64)}", "${'x'.repeat(120)}".`)
  expect(request).not.toHaveBeenCalled()
  expect(fetchImpl).not.toHaveBeenCalled()

  const refs = [photoPath, referenceIds[1]!]
  const runtime = await context.prepareRecapMedia!({ kind: 'image', args: { ...args, referenceImageRefs: refs } }, fetchImpl)
  expect(request).not.toHaveBeenCalled()
  expect(await runtime.resolveReferences(refs)).toEqual(referenceIds.map(id => expect.objectContaining({ sourceRef: id, bytes, sha256: hash })))
  expect(request.mock.calls.map(([input]) => input.action === 'read_game' && input.recapRead)).toEqual(referenceIds.map(id => ({ kind: 'reference', id })))
  expect(fetchImpl).not.toHaveBeenCalled()
})

test('explicit lyrics guard conflicting modes and propagate cancellation without saving', async () => {
  const args = { durationSeconds: 20, instrumental: false, prompt: 'Playful piano', lyrics: ['Leo goes'] }
  expect(parseGenerateSongArguments(args).ok).toBe(true)
  for (const override of [{ output: 'file' }, { lyrics: ['two\nlines'] }, { lyrics: [] }]) {
    expect(parseGenerateSongArguments({ ...args, ...override }).ok).toBe(false)
  }
  // Outside a recap there is no file runtime, and a song that ignored its lyrics would be a silent wrong answer.
  expect(await executeGenerateSongTool({ args, env: { ELEVENLABS_API_KEY: 'synthetic-key' } })).toMatchObject({ rpcSuccess: false, rpcText: 'Exact lyrics are sung only in a recap show.' })
  const controller = new AbortController()
  const reason = new Error('Synthetic cancellation')
  controller.abort(reason)
  const save = vi.fn(), fetchImpl = vi.fn<typeof fetch>()
  await expect(executeGenerateSongTool({ args, env: { ELEVENLABS_API_KEY: 'synthetic-key' }, abortSignal: controller.signal,
    fileRuntime: { fetchImpl, save, resolveReferences: async () => [] } })).rejects.toBe(reason)
  expect(save).not.toHaveBeenCalled()
  expect(fetchImpl).not.toHaveBeenCalled()
})
