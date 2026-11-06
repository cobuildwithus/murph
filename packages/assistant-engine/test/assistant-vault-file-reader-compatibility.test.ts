import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ASSISTANT_GENERATED_DELIVERY_DIRECTORY } from '../src/assistant/generated-delivery-files.ts'
import { readVerifiedAssistantVaultFileBytes } from '../src/assistant/vault-file-send.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

describe('secure file common-media readers', () => {
  it.each([
    ['photo.JPG', 'image/jpeg'],
    ['recording.mp3', 'audio/mpeg'],
    ['clip.mp4', 'video/mp4'],
    ['book.epub', 'application/epub+zip'],
  ])('reads persisted %s descriptors without weakening hash checks', async (filename, contentType) => {
    const { parentRoot, vaultRoot } = await createTempVaultContext('murph-media-reader-')
    tempRoots.push(parentRoot)
    const bytes = Buffer.from('synthetic immutable attachment')
    for (const directory of ['documents', ASSISTANT_GENERATED_DELIVERY_DIRECTORY]) {
      await mkdir(path.join(vaultRoot, directory), { recursive: true })
      const ref = `${directory}/${filename}`
      const filePath = path.join(vaultRoot, ref)
      await writeFile(filePath, bytes)
      const file = {
        kind: 'vault_file' as const, ref, filename, contentType,
        approvalId: null, approvalGeneration: null,
        sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length,
      }
      await expect(readVerifiedAssistantVaultFileBytes({ file, vaultRoot })).resolves.toEqual(bytes)
      await writeFile(filePath, Buffer.from('modified immutable attachment'))
      await expect(readVerifiedAssistantVaultFileBytes({ file, vaultRoot }))
        .rejects.toMatchObject({ code: 'ASSISTANT_VAULT_FILE_CHANGED_AFTER_APPROVAL' })
    }
  })
})
