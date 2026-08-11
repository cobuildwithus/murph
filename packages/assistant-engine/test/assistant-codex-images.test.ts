import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildCodexTurnStartParams,
  buildCodexTurnSteerParams,
} from '../src/assistant-codex/app-server-requests.ts'
import {
  extractCodexAppServerUserMessageImages,
  materializeCodexImages,
} from '../src/assistant-codex/images.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootPath) =>
      rm(rootPath, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

async function createTempDir(prefix: string): Promise<string> {
  const rootPath = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(rootPath)
  return rootPath
}

describe('assistant codex image helpers', () => {
  it('preserves requested image detail at the provider boundary', () => {
    const bytes = Buffer.from([0x01, 0x02, 0x03])

    expect(
      extractCodexAppServerUserMessageImages([
        {
          type: 'text',
          text: 'Inspect the image.',
        },
        {
          detail: 'original',
          image: bytes,
          mediaType: 'image/webp',
          type: 'image',
        },
      ]),
    ).toEqual([
      {
        bytes,
        detail: 'original',
        mimeType: 'image/webp',
      },
    ])
  })

  it('emits per-image detail on initial and steered Codex inputs', () => {
    expect(
      buildCodexTurnStartParams({
        codexThreadId: 'thread-detail',
        images: [
          {
            detail: 'original',
            path: '/tmp/first.webp',
          },
          {
            path: '/tmp/second.webp',
          },
        ],
        input: {
          dynamicTools: [],
          prompt: 'Inspect these images.',
          workingDirectory: '/tmp/vault',
        },
      }),
    ).toEqual({
      input: [
        {
          type: 'text',
          text: 'Inspect these images.',
        },
        {
          detail: 'original',
          path: '/tmp/first.webp',
          type: 'localImage',
        },
        {
          path: '/tmp/second.webp',
          type: 'localImage',
        },
      ],
      serviceTier: null,
      threadId: 'thread-detail',
    })

    expect(
      buildCodexTurnSteerParams({
        images: [
          {
            detail: 'high',
            path: '/tmp/follow-up.webp',
          },
        ],
        prompt: 'Inspect the follow-up.',
        threadId: 'thread-detail',
        turnId: 'turn-detail',
      }),
    ).toEqual({
      expectedTurnId: 'turn-detail',
      input: [
        {
          type: 'text',
          text: 'Inspect the follow-up.',
        },
        {
          detail: 'high',
          path: '/tmp/follow-up.webp',
          type: 'localImage',
        },
      ],
      threadId: 'thread-detail',
    })
  })

  it.each([
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
    ['image/heic', '.heic'],
    ['image/heif', '.heif'],
    ['image/bmp', '.bmp'],
    ['image/tiff', '.tiff'],
    [null, '.img'],
  ] as const)(
    'materializes byte-backed %s images with the %s extension',
    async (mimeType, expectedExtension) => {
      const tempRoot = await createTempDir('assistant-codex-images-')
      const bytes = Buffer.from([0x01, 0x02, 0x03, 0x04])

      const [image] = await materializeCodexImages({
        images: [
          {
            bytes,
            mimeType,
          },
        ],
        tempRoot,
      })
      if (!image) {
        throw new Error('Expected one materialized Codex image.')
      }

      expect(image.path).toBe(path.join(tempRoot, `image-1${expectedExtension}`))
      await expect(readFile(image.path)).resolves.toEqual(bytes)
    },
  )

  it('passes through readable local image paths unchanged after resolution', async () => {
    const tempRoot = await createTempDir('assistant-codex-images-readable-')
    const imagePath = path.join(tempRoot, 'existing.png')

    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    await expect(
      materializeCodexImages({
        images: [
          {
            path: imagePath,
          },
        ],
        tempRoot,
      }),
    ).resolves.toEqual([{ path: imagePath }])
  })

  it('rejects image inputs that provide neither bytes nor a readable path', async () => {
    const tempRoot = await createTempDir('assistant-codex-images-invalid-')

    await expect(
      materializeCodexImages({
        images: [{}],
        tempRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_IMAGE_INVALID',
      message: 'Codex app-server image input requires either bytes or a readable path.',
    })
  })
})
