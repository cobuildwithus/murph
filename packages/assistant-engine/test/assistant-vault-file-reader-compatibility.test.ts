import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ASSISTANT_GENERATED_DELIVERY_DIRECTORY } from '../src/assistant/generated-delivery-files.ts'
import { listAssistantOutboxIntents } from '../src/assistant/outbox.ts'
import { readVerifiedAssistantVaultFileBytes, requestAssistantVaultFileSend } from '../src/assistant/vault-file-send.ts'
import { createTempVaultContext } from './test-helpers.ts'

const tempRoots: string[] = []
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

describe('secure file reader-only rollout', () => {
  it.each([
    ['photo.JPG', 'image/jpeg'],
    ['recording.mp3', 'audio/mpeg'],
    ['clip.mp4', 'video/mp4'],
    ['book.epub', 'application/epub+zip'],
  ])('reads future %s descriptors while rejecting new sends before adoption', async (filename, contentType) => {
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
      const actionApprovalPort = { read: vi.fn(), request: vi.fn() }
      await expect(requestAssistantVaultFileSend({
        actionApprovalPort, bindingDelivery: { kind: 'thread', target: 'synthetic-chat' },
        channel: 'linq', deliveryTransportIdempotent: true, ref,
        sessionId: 'synthetic-session', threadId: 'synthetic-chat', threadIsDirect: true,
        toolCallId: 'synthetic-call', turnId: 'synthetic-turn', vault: vaultRoot,
      })).rejects.toMatchObject({ code: 'ASSISTANT_VAULT_FILE_TYPE_UNSUPPORTED' })
      expect(actionApprovalPort.request).not.toHaveBeenCalled()
      expect(actionApprovalPort.read).not.toHaveBeenCalled()
      expect(await listAssistantOutboxIntents(vaultRoot)).toEqual([])
      expect(await readFile(filePath)).toEqual(bytes)
      await writeFile(filePath, Buffer.from('modified immutable attachment'))
      await expect(readVerifiedAssistantVaultFileBytes({ file, vaultRoot }))
        .rejects.toMatchObject({ code: 'ASSISTANT_VAULT_FILE_CHANGED_AFTER_APPROVAL' })
    }
  })
})
