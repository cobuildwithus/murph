import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { materializeCodexImagePaths } from '../src/assistant-codex/images.ts'

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

      const [imagePath] = await materializeCodexImagePaths({
        images: [
          {
            bytes,
            mimeType,
          },
        ],
        tempRoot,
      })

      expect(imagePath).toBe(path.join(tempRoot, `image-1${expectedExtension}`))
      await expect(readFile(imagePath)).resolves.toEqual(bytes)
    },
  )

  it('passes through readable local image paths unchanged after resolution', async () => {
    const tempRoot = await createTempDir('assistant-codex-images-readable-')
    const imagePath = path.join(tempRoot, 'existing.png')

    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    await expect(
      materializeCodexImagePaths({
        images: [
          {
            path: imagePath,
          },
        ],
        tempRoot,
      }),
    ).resolves.toEqual([imagePath])
  })

  it('rejects image inputs that provide neither bytes nor a readable path', async () => {
    const tempRoot = await createTempDir('assistant-codex-images-invalid-')

    await expect(
      materializeCodexImagePaths({
        images: [{}],
        tempRoot,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_IMAGE_INVALID',
      message: 'Codex app-server image input requires either bytes or a readable path.',
    })
  })
})
