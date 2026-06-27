import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  executeGenerateImageTool,
} from '../src/assistant-codex/generate-image-tool.js'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_BYTES_SHA256 = createHash('sha256').update(PNG_BYTES).digest('hex')

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
        authorizedReferenceImageRefs: new Map([
          ['raw/inbox/photo.png', { sha256: PNG_BYTES_SHA256 }],
        ]),
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
})

function openAiPngResponse(): Response {
  return new Response(
    JSON.stringify({
      data: [
        {
          b64_json: Buffer.from(PNG_BYTES).toString('base64'),
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
