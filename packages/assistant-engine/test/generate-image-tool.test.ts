import { Buffer } from 'node:buffer'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { initializeVault } from '@murphai/core'
import { describe, expect, it } from 'vitest'

import {
  executeGenerateImageTool,
} from '../src/assistant-codex/generate-image-tool.js'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'murph-generate-image-tool-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

describe('executeGenerateImageTool reference images', () => {
  it('does not require a vault root when no reference image refs are provided', async () => {
    await withTempDir(async (codexHome) => {
      let capturedUrl: string | null = null
      const fetchImpl: typeof fetch = async (url) => {
        capturedUrl = String(url)
        return openAiPngResponse()
      }

      const result = await executeGenerateImageTool({
        args: {
          alt: null,
          outputFormat: 'png',
          prompt: 'Draw a dot.',
          quality: 'low',
          referenceImageRefs: [],
          size: '1024x1024',
        },
        codexHome,
        env: { OPENAI_API_KEY: 'test-key' },
        fetchImpl,
        providerRequestOrdinal: 1,
      })

      expect(result.rpcSuccess).toBe(true)
      expect(capturedUrl).toBe('https://api.openai.com/v1/images/generations')
      expect(result.usageDraft?.usage.usageExtractionSourcePath).toBe(
        'openai.images.generate',
      )
    })
  })

  it('returns a clean tool failure when references are requested without vault authority', async () => {
    const result = await executeGenerateImageTool({
      args: {
        alt: null,
        outputFormat: 'png',
        prompt: 'Use image 1.',
        quality: 'medium',
        referenceImageRefs: ['raw/inbox/photo.png'],
        size: '1024x1024',
      },
      env: { OPENAI_API_KEY: 'test-key' },
      fetchImpl: async () => openAiPngResponse(),
      providerRequestOrdinal: 1,
    })

    expect(result).toMatchObject({
      rpcSuccess: false,
      rpcText: 'image references are unavailable for this turn',
    })
  })

  it('resolves references before calling OpenAI edits and records reference metadata', async () => {
    await withTempDir(async (root) => {
      const vaultRoot = path.join(root, 'vault')
      const codexHome = path.join(root, 'codex-home')
      await initializeVault({ vaultRoot })
      const refPath = path.join(vaultRoot, 'raw', 'inbox', 'photo.png')
      await mkdir(path.dirname(refPath), { recursive: true })
      await writeFile(refPath, PNG_BYTES)

      let capturedUrl: string | null = null
      let capturedBody: BodyInit | null | undefined
      const fetchImpl: typeof fetch = async (url, init) => {
        capturedUrl = String(url)
        capturedBody = init?.body
        return openAiPngResponse()
      }

      const result = await executeGenerateImageTool({
        args: {
          alt: 'Generated image',
          outputFormat: 'png',
          prompt: 'Use image 1 as the subject reference.',
          quality: 'high',
          referenceImageRefs: ['raw/inbox/photo.png'],
          size: '1024x1024',
        },
        codexHome,
        env: { OPENAI_API_KEY: 'test-key' },
        fetchImpl,
        providerRequestOrdinal: 7,
        vaultRoot,
      })

      expect(result.rpcSuccess).toBe(true)
      expect(capturedUrl).toBe('https://api.openai.com/v1/images/edits')
      expect(capturedBody).toBeInstanceOf(FormData)
      const form = capturedBody as FormData
      expect(form.getAll('image[]')).toHaveLength(1)
      expect(form.get('prompt')).toBe(
        [
          'Use the attached reference image in the provided order.',
          'The user prompt may refer to them as image 1, image 2, etc.',
          '',
          'Use image 1 as the subject reference.',
        ].join('\n'),
      )

      expect(result.usageDraft?.usage.usageExtractionSourcePath).toBe(
        'openai.images.edit',
      )
      expect(result.usageDraft?.usage.providerMetadataJson).toMatchObject({
        operation: 'image_generation_with_references',
        referenceImageCount: 1,
        referenceImageTotalBytes: PNG_BYTES.byteLength,
      })
    })
  })

  it('can reuse a generated capture larger than the old per-file reference cap', async () => {
    await withTempDir(async (root) => {
      const vaultRoot = path.join(root, 'vault')
      const codexHome = path.join(root, 'codex-home')
      await initializeVault({ vaultRoot })
      const generatedBytes = new Uint8Array(3 * 1024 * 1024)
      generatedBytes.set(PNG_BYTES, 0)

      const fetchImpl: typeof fetch = async () => openAiPngResponse(generatedBytes)
      const generated = await executeGenerateImageTool({
        args: {
          alt: null,
          outputFormat: 'png',
          prompt: 'Draw a reusable large reference.',
          quality: 'high',
          size: '1024x1024',
        },
        captureIdempotencyKey: 'turn-1:tool-1',
        codexHome,
        env: { OPENAI_API_KEY: 'test-key' },
        fetchImpl,
        providerRequestOrdinal: 1,
        vaultRoot,
      })

      expect(generated.rpcSuccess).toBe(true)
      expect(generated.savedImageRef).toMatch(/^raw\/captures\/.+\.png$/u)

      let capturedBody: BodyInit | null | undefined
      const editFetchImpl: typeof fetch = async (url, init) => {
        expect(String(url)).toBe('https://api.openai.com/v1/images/edits')
        capturedBody = init?.body
        return openAiPngResponse()
      }

      const reused = await executeGenerateImageTool({
        args: {
          alt: null,
          outputFormat: 'png',
          prompt: 'Use image 1 as the main subject.',
          quality: 'medium',
          referenceImageRefs: [generated.savedImageRef!],
          size: '1024x1024',
        },
        codexHome,
        env: { OPENAI_API_KEY: 'test-key' },
        fetchImpl: editFetchImpl,
        providerRequestOrdinal: 2,
        vaultRoot,
      })

      expect(reused.rpcSuccess).toBe(true)
      expect(capturedBody).toBeInstanceOf(FormData)
      expect(reused.usageDraft?.usage.providerMetadataJson).toMatchObject({
        operation: 'image_generation_with_references',
        referenceImageCount: 1,
        referenceImageTotalBytes: generatedBytes.byteLength,
      })
    })
  })

  it('reuses a saved generated capture before reloading transient references', async () => {
    await withTempDir(async (root) => {
      const vaultRoot = path.join(root, 'vault')
      const codexHome = path.join(root, 'codex-home')
      const referencePath = path.join(vaultRoot, 'raw/inbox/reference.png')
      await initializeVault({ vaultRoot })
      await mkdir(path.dirname(referencePath), { recursive: true })
      await writeFile(referencePath, PNG_BYTES)

      let fetchCalls = 0
      const fetchImpl: typeof fetch = async () => {
        fetchCalls += 1
        return openAiPngResponse()
      }
      const args = {
        alt: null,
        outputFormat: 'png' as const,
        prompt: 'Use image 1 as the reference subject.',
        quality: 'medium' as const,
        referenceImageRefs: ['raw/inbox/reference.png'],
        size: '1024x1024' as const,
      }

      const first = await executeGenerateImageTool({
        args,
        captureIdempotencyKey: 'turn-1:tool-with-transient-ref',
        codexHome,
        env: { OPENAI_API_KEY: 'test-key' },
        fetchImpl,
        providerRequestOrdinal: 1,
        vaultRoot,
      })

      expect(first.rpcSuccess).toBe(true)
      expect(fetchCalls).toBe(1)

      await rm(referencePath)

      const second = await executeGenerateImageTool({
        args,
        captureIdempotencyKey: 'turn-1:tool-with-transient-ref',
        codexHome,
        env: { OPENAI_API_KEY: 'test-key' },
        fetchImpl,
        providerRequestOrdinal: 2,
        vaultRoot,
      })

      expect(second.rpcSuccess).toBe(true)
      expect(second.savedImageRef).toBe(first.savedImageRef)
      expect(second.usageDraft).toBeNull()
      expect(fetchCalls).toBe(1)
    })
  })
})

function openAiPngResponse(bytes: Uint8Array = PNG_BYTES): Response {
  return new Response(
    JSON.stringify({
      data: [
        {
          b64_json: Buffer.from(bytes).toString('base64'),
        },
      ],
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 2,
      },
    }),
    {
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_image_123',
      },
      status: 200,
    },
  )
}
