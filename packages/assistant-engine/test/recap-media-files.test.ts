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
const relativeRoot = '.runtime/tmp/recap/synthetic'
async function vault() { const root = await mkdtemp(path.join(tmpdir(), 'recap-files-')); roots.push(root); return root }

test('file image uses normal provider accounting and creates no capture or response media', async () => {
  const root = await vault()
  const bytes = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#ddbb77' } }).jpeg().toBuffer()
  const persist = vi.fn()
  const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ data: [{ b64_json: bytes.toString('base64') }],
    usage: { input_tokens: 12, output_tokens: 42, total_tokens: 54 } }))
  const result = await executeGenerateImageTool({ env: { OPENAI_API_KEY: 'synthetic-key' }, fetchImpl, vaultRoot: root,
    persistGeneratedImageCapture: persist, requireHostedPrivateImageDelivery: true, providerRequestOrdinal: 1,
    args: { output: 'file', operationId: 'cover', outputFormat: 'jpeg', prompt: 'Synthetic paper theatre.', alt: null, quality: 'medium', size: '1024x1024' },
    fileRuntime: { fetchImpl, resolveReferences: async () => [], save: (data, mediaType) => saveRecapMediaFile({ vault: root, relativeRoot, operationId: 'cover', bytes: data, mediaType }) } })
  expect(result.rpcSuccess).toBe(true)
  expect(result.responseMedia).toBeUndefined()
  expect(result.savedCaptureId).toBeUndefined()
  expect(persist).not.toHaveBeenCalled()
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(result.usageDraft).toMatchObject({ provider: 'openai-images', providerRequestOutcome: 'succeeded' })
  const receipt = JSON.parse(result.rpcText)
  expect(receipt).toMatchObject({ width: 64, height: 96, hash: createHash('sha256').update(bytes).digest('hex') })
  expect(await readFile(path.join(root, receipt.path))).toEqual(bytes)
  expect(result.rpcText).not.toContain(root)
})

test('file song works without a voice-memo channel and never uploads a chat attachment', async () => {
  const bytes = await readFile(new URL('../../../fixtures/generated-audio/music.mp3', import.meta.url))
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(bytes))
  const save = vi.fn(async () => ({ operationId: 'theme', path: `${relativeRoot}/media/theme.mp3`, hash: 'a'.repeat(64), byteLength: bytes.length, mediaType: 'audio/mpeg' as const, durationMs: 20_000 }))
  const result = await executeGenerateSongTool({ env: { ELEVENLABS_API_KEY: 'synthetic-key' },
    args: { output: 'file', operationId: 'theme', durationSeconds: 20, instrumental: false, prompt: 'An original playful song for Player A and Player B.' },
    fileRuntime: { fetchImpl, resolveReferences: async () => [], save } })
  expect(result.rpcSuccess).toBe(true)
  expect(result.responseMedia).toBeUndefined()
  expect(fetchImpl).toHaveBeenCalledTimes(1)
  expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/v1/music')
  expect(save).toHaveBeenCalledWith(new Uint8Array(bytes), 'audio/mpeg')
})

test('candidate files reject traversal, symlinks, oversized bytes and tampering', async () => {
  const root = await vault()
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: 'white' } }).jpeg().toBuffer()
  const input = { vault: root, relativeRoot, operationId: 'cover', bytes, mediaType: 'image/jpeg' as const }
  const receipt = await saveRecapMediaFile(input)
  await expect(saveRecapMediaFile(input)).resolves.toEqual(receipt)
  await expect(readRecapFile({ vault: root, relativeRoot, file: `${relativeRoot}/../private`, maxBytes: 100 })).rejects.toThrow('outside')
  await expect(saveRecapMediaFile({ ...input, bytes: new Uint8Array(2 * 1024 * 1024 + 1) })).rejects.toThrow('byte limit')
  await writeFile(path.join(root, receipt.path), 'tampered')
  await expect(saveRecapMediaFile(input)).rejects.toThrow('integrity')
  await symlink(path.join(root, receipt.path), path.join(root, relativeRoot, 'media/link.jpg'))
  await expect(readRecapFile({ vault: root, relativeRoot, file: `${relativeRoot}/media/link.jpg`, maxBytes: 2000 })).rejects.toThrow()
})
