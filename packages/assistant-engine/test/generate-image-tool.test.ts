import { Buffer } from 'node:buffer'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { deleteEvent, initializeVault } from '@murphai/core'
import { describe, expect, it } from 'vitest'

import {
  executeGenerateImageTool,
} from '../src/assistant-codex/generate-image-tool.js'
import {
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
} from '../src/assistant-skill-assets.js'

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

  it('requires an owning vault before private hosted image delivery', async () => {
    const result = await executeGenerateImageTool({
      args: {
        alt: null,
        outputFormat: 'png',
        prompt: 'Draw a dot.',
        quality: 'low',
        referenceImageRefs: [],
        size: '1024x1024',
      },
      env: { OPENAI_API_KEY: 'test-key' },
      fetchImpl: async () => openAiPngResponse(),
      providerRequestOrdinal: 1,
      requireHostedPrivateImageDelivery: true,
    })

    expect(result).toEqual({
      rpcSuccess: false,
      rpcText: 'hosted private image delivery requires the owning vault',
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

  it('uses skill asset refs without vault authority and does not save a capture', async () => {
    await withTempDir(async (root) => {
      const codexHome = path.join(root, 'codex-home')
      const skillsRoot = path.join(root, 'skills')
      await mkdir(path.join(skillsRoot, 'shared'), { recursive: true })
      await writeFile(
        path.join(skillsRoot, 'shared', 'murph-character-sheet-v1.png'),
        PNG_BYTES,
      )

      const originalSkillsRoot = process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]
      let capturedUrl: string | null = null
      let capturedBody: BodyInit | null | undefined
      try {
        process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = skillsRoot
        const fetchImpl: typeof fetch = async (url, init) => {
          capturedUrl = String(url)
          capturedBody = init?.body
          return openAiPngResponse()
        }

        const result = await executeGenerateImageTool({
          args: {
            alt: null,
            outputFormat: 'png',
            prompt: 'Use image 1 as the canonical Murph character reference.',
            quality: 'medium',
            referenceImageRefs: ['skill-assets/murph-character-sheet-v1.png'],
            size: '1024x1024',
          },
          codexHome,
          env: { OPENAI_API_KEY: 'test-key' },
          fetchImpl,
          providerRequestOrdinal: 2,
        })

        expect(result.rpcSuccess).toBe(true)
        expect(capturedUrl).toBe('https://api.openai.com/v1/images/edits')
        expect(capturedBody).toBeInstanceOf(FormData)
        expect((capturedBody as FormData).getAll('image[]')).toHaveLength(1)
        expect(result.savedCaptureId).toBeNull()
        expect(result.savedImageRef).toBeNull()
        expect(result.rpcText).toMatch(
          /^generated image saved at CODEX_HOME\/generated_images\//u,
        )
        expect(result.usageDraft?.usage.usageExtractionSourcePath).toBe(
          'openai.images.edit',
        )
      } finally {
        if (originalSkillsRoot === undefined) {
          delete process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]
        } else {
          process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = originalSkillsRoot
        }
      }
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

  it('returns actionable provider diagnostics for failed reference edits', async () => {
    await withTempDir(async (root) => {
      const vaultRoot = path.join(root, 'vault')
      await initializeVault({ vaultRoot })
      const refPath = path.join(vaultRoot, 'raw', 'inbox', 'photo.png')
      await mkdir(path.dirname(refPath), { recursive: true })
      await writeFile(refPath, PNG_BYTES)

      const result = await executeGenerateImageTool({
        args: {
          alt: null,
          outputFormat: 'png',
          prompt: 'Use image 1 as the edit target and change only the subject.',
          quality: 'high',
          referenceImageRefs: ['raw/inbox/photo.png'],
          size: '1024x1024',
        },
        env: { OPENAI_API_KEY: 'test-key' },
        fetchImpl: async () => new Response(JSON.stringify({
          error: {
            code: 'invalid_image',
            message: 'The reference image could not be decoded.',
            type: 'invalid_request_error',
          },
        }), {
          headers: {
            'content-type': 'application/json',
            'x-request-id': 'req_image_edit_failed',
          },
          status: 400,
        }),
        providerRequestOrdinal: 8,
        vaultRoot,
      })

      expect(result).toEqual({
        rpcSuccess: false,
        rpcText:
          'image edit failed: ASSISTANT_IMAGE_GENERATION_FAILED (http 400, invalid_image, request req_image_edit_failed): The reference image could not be decoded.',
      })
    })
  })

  it('passes the assistant skills root through for package skill asset references', async () => {
    await withTempDir(async (root) => {
      const vaultRoot = path.join(root, 'vault')
      const codexHome = path.join(root, 'codex-home')
      const skillsRoot = path.join(root, 'skills')
      await initializeVault({ vaultRoot })
      await mkdir(path.join(skillsRoot, 'shared'), { recursive: true })
      await writeFile(
        path.join(skillsRoot, 'shared', 'murph-character-sheet-v1.png'),
        PNG_BYTES,
      )

      const originalSkillsRoot = process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]
      let capturedUrl: string | null = null
      let capturedBody: BodyInit | null | undefined
      try {
        process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = skillsRoot
        const fetchImpl: typeof fetch = async (url, init) => {
          capturedUrl = String(url)
          capturedBody = init?.body
          return openAiPngResponse()
        }

        const result = await executeGenerateImageTool({
          args: {
            alt: 'Generated image',
            outputFormat: 'png',
            prompt: 'Use image 1 as the canonical Murph character reference.',
            quality: 'high',
            referenceImageRefs: ['skill-assets/murph-character-sheet-v1.png'],
            size: '1024x1024',
          },
          codexHome,
          env: { OPENAI_API_KEY: 'test-key' },
          fetchImpl,
          providerRequestOrdinal: 8,
          vaultRoot,
        })

        expect(result.rpcSuccess).toBe(true)
        expect(capturedUrl).toBe('https://api.openai.com/v1/images/edits')
        expect(capturedBody).toBeInstanceOf(FormData)
        expect((capturedBody as FormData).getAll('image[]')).toHaveLength(1)
        expect(result.usageDraft?.usage.providerMetadataJson).toMatchObject({
          operation: 'image_generation_with_references',
          referenceImageCount: 1,
          referenceImageTotalBytes: PNG_BYTES.byteLength,
        })
      } finally {
        if (originalSkillsRoot === undefined) {
          delete process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]
        } else {
          process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = originalSkillsRoot
        }
      }
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

  it('does not reuse or regenerate a deleted generated capture replay', async () => {
    await withTempDir(async (root) => {
      const vaultRoot = path.join(root, 'vault')
      const codexHome = path.join(root, 'codex-home')
      await initializeVault({ vaultRoot })

      let fetchCalls = 0
      const fetchImpl: typeof fetch = async () => {
        fetchCalls += 1
        return openAiPngResponse()
      }
      const args = {
        alt: null,
        outputFormat: 'png' as const,
        prompt: 'Draw a replay-sensitive generated image.',
        quality: 'medium' as const,
        size: '1024x1024' as const,
      }

      const first = await executeGenerateImageTool({
        args,
        captureIdempotencyKey: 'turn-1:deleted-tool-replay',
        codexHome,
        env: { OPENAI_API_KEY: 'test-key' },
        fetchImpl,
        providerRequestOrdinal: 1,
        vaultRoot,
      })
      expect(first.rpcSuccess).toBe(true)
      expect(first.savedCaptureId).toMatch(/^evt_/u)
      expect(fetchCalls).toBe(1)

      await deleteEvent({
        vaultRoot,
        eventId: first.savedCaptureId!,
      })

      const replay = await executeGenerateImageTool({
        args,
        captureIdempotencyKey: 'turn-1:deleted-tool-replay',
        codexHome,
        env: { OPENAI_API_KEY: 'test-key' },
        fetchImpl,
        providerRequestOrdinal: 2,
        vaultRoot,
      })

      expect(replay).toMatchObject({
        rpcSuccess: false,
        rpcText: 'saved generated image was deleted; make a new image request',
      })
      expect(fetchCalls).toBe(1)
    })
  })

  it('reuses the winning saved capture when same-key generated image saves overlap', async () => {
    await withTempDir(async (root) => {
      const vaultRoot = path.join(root, 'vault')
      const codexHome = path.join(root, 'codex-home')
      await initializeVault({ vaultRoot })

      let fetchCalls = 0
      let releaseFetches!: () => void
      const bothFetchesStarted = new Promise<void>((resolve) => {
        releaseFetches = resolve
      })
      const fetchImpl: typeof fetch = async () => {
        fetchCalls += 1
        if (fetchCalls === 2) {
          releaseFetches()
        }
        await bothFetchesStarted
        return openAiPngResponse()
      }
      const args = {
        alt: null,
        outputFormat: 'png' as const,
        prompt: 'Draw a concurrently replayed generated image.',
        quality: 'medium' as const,
        size: '1024x1024' as const,
      }

      const results = await Promise.all([
        executeGenerateImageTool({
          args,
          captureIdempotencyKey: 'turn-1:overlapping-tool-call',
          codexHome,
          env: { OPENAI_API_KEY: 'test-key' },
          fetchImpl,
          providerRequestOrdinal: 1,
          vaultRoot,
        }),
        executeGenerateImageTool({
          args,
          captureIdempotencyKey: 'turn-1:overlapping-tool-call',
          codexHome,
          env: { OPENAI_API_KEY: 'test-key' },
          fetchImpl,
          providerRequestOrdinal: 2,
          vaultRoot,
        }),
      ])

      expect(fetchCalls).toBe(2)
      expect(results).toEqual([
        expect.objectContaining({ rpcSuccess: true }),
        expect.objectContaining({ rpcSuccess: true }),
      ])
      expect(new Set(results.map((result) => result.savedCaptureId)).size).toBe(1)
      expect(new Set(results.map((result) => result.savedImageRef)).size).toBe(1)
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
