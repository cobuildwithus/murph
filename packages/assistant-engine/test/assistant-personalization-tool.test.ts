import { describe, expect, it, vi } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  MURPH_PERSONALIZATION_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.js'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.js'

describe('assistant personalization tool', () => {
  it('is available only when the hosted personalization owner is present', () => {
    expect(resolveMurphDynamicTools({
      personalizationAvailable: true,
    })).toContain(MURPH_PERSONALIZATION_TOOL)
    expect(resolveMurphDynamicTools({
      personalizationAvailable: false,
    })).not.toContain(MURPH_PERSONALIZATION_TOOL)
  })

  it('parses and executes an atomic personalization update', async () => {
    const request = readMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          action: 'update',
          tone: 'formal',
          voice: 'upbeat',
        },
        namespace: 'murph',
        tool: 'personalization',
      },
    })

    expect(request).toEqual({
      kind: 'personalization',
      request: {
        action: 'update',
        tone: 'formal',
        voice: 'upbeat',
      },
    })
    if (!request) {
      throw new Error('Expected a personalization dynamic tool request.')
    }

    const personalizationTool = {
      request: vi.fn(async () => ({
        action: 'update' as const,
        result: {
          model: 'gpt-5.6-terra' as const,
          modelChangeAppliesNextRun: false,
          modelUpdated: false,
          rejectionReason: null,
          solAvailable: true,
          status: 'saved' as const,
          styleUpdated: true,
          tone: 'formal' as const,
          updated: true,
          voice: 'upbeat' as const,
        },
      })),
    }
    const hostedToolContext: AssistantHostedToolContext = {
      computerToolsAvailable: false,
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      personalizationTool,
      sendVaultFile: vi.fn(async () => ({
        approvalUrl: 'https://murph.test/approve/unused',
        filename: 'unused.pdf',
        status: 'pending' as const,
      })),
      vaultFileSendAvailable: false,
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })

    expect(personalizationTool.request).toHaveBeenCalledWith({
      action: 'update',
      tone: 'formal',
      voice: 'upbeat',
    })
    expect(result.rpcResult.success).toBe(true)
    expect(result.rpcResult.contentItems[0]?.text).toContain('"status":"saved"')
  })

  it('rejects empty updates and unknown values before calling the owner', () => {
    expect(readMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: { action: 'update' },
        namespace: 'murph',
        tool: 'personalization',
      },
    })?.kind).toBe('invalid-personalization-arguments')

    expect(readMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: { action: 'update', model: 'unknown-model' },
        namespace: 'murph',
        tool: 'personalization',
      },
    })?.kind).toBe('invalid-personalization-arguments')
  })
})
