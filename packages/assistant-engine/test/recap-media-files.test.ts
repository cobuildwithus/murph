import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, expect, test, vi } from 'vitest'
import { executeGenerateImageTool } from '../src/assistant-codex/generate-image-tool.ts'
import { executeGenerateSongTool } from '../src/assistant-codex/generate-voice-memo-tool.ts'
import { readRecapFile, saveRecapMediaFile } from '../src/assistant/recap-files.ts'

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
    args: { output: 'file', outputFormat: 'jpeg', referenceImageRefs: withReference ? ['synthetic-reference'] : [], prompt: 'Synthetic paper theatre.', alt: null, quality: 'medium', size: '1024x1024' },
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
    args: { output: 'file', durationSeconds: 20, instrumental: false, prompt: 'An original playful song for Player A and Player B.' },
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
