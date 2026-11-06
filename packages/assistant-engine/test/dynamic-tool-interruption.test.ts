import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { AssistantWorkspaceArtifactMaterializationError } from '../src/assistant/execution-context.ts'
import { executeMurphDynamicToolRequest, readMurphDynamicToolRequest } from '../src/assistant-codex/dynamic-tools.ts'
import { dynamicToolFailureEndsTurn } from '../src/assistant-codex/tool-failure-diagnostics.ts'

const interrupted = new AssistantWorkspaceArtifactMaterializationError(new Error('Synthetic owner lost'))

describe('dynamic tool interruption', () => {
  it('ends the turn for interruption or a settled request, and reports ordinary failures to the model', () => {
    expect(dynamicToolFailureEndsTurn(false, interrupted)).toBe(true)
    expect(dynamicToolFailureEndsTurn(true, new Error('after settlement'))).toBe(true)
    expect(dynamicToolFailureEndsTurn(false, new Error('ordinary tool failure'))).toBe(false)
  })

  it('does not turn owner loss during image attachment into a tool failure', async () => {
    const request = readMurphDynamicToolRequest({
      id: 'test', method: 'item/tool/call',
      params: { namespace: 'murph', tool: 'attach_response_media', callId: 'call', threadId: 'thread', turnId: 'turn',
        arguments: { media: [{ kind: 'vault_image', ref: 'raw/inbox/synthetic/photo.png', contentType: 'image/png',
          filename: 'photo.png', sha256: 'a'.repeat(64), sizeBytes: 4 }] } },
    })
    if (!request) throw new Error('Missing tool request')
    expect(request.kind).toBe('attach-response-media')
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-tool-interruption-'))
    try {
      await expect(executeMurphDynamicToolRequest({
        request, env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null, vaultRoot,
        materializeWorkspaceArtifacts: async () => { throw interrupted },
      } as Parameters<typeof executeMurphDynamicToolRequest>[0])).rejects.toBe(interrupted)
    } finally { await rm(vaultRoot, { recursive: true, force: true }) }
  })
})
