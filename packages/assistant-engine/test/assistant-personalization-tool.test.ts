import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  MURPH_PERSONALIZATION_TOOL,
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

  it('describes callback-bound direct or room ownership without a member target', () => {
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'current hosted conversation runtime',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'synthetic room Murph',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'never a participant',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'Reply casing maps to the existing tone field',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'sentence case means formal',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'lowercase means casual',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'rather than an unsupported setting',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'a one-reply formatting request does not persist',
    )
    expect(JSON.stringify(MURPH_PERSONALIZATION_TOOL.inputSchema)).not.toContain(
      'memberId',
    )
  })

  it('parses and executes an atomic personalization update', async () => {
    const request = readTestMurphDynamicToolRequest({
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
      toolCallId: 'call-test',
    })
    if (!request) {
      throw new Error('Expected a personalization dynamic tool request.')
    }

    const personalizationTool = {
      request: vi.fn(async () => ({
        action: 'update' as const,
        result: {
          model: 'gpt-5.6-terra' as const,
          modelChangeAppliesNextRun: false as const,
          modelUpdated: false as const,
          solAvailable: true,
          status: 'saved' as const,
          tone: 'formal' as const,
          voice: 'upbeat' as const,
        },
      })),
    }
    const hostedToolContext: AssistantHostedToolContext = {
      computerToolsAvailable: false,
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      currentAssistantInputId: () =>
        'ain_11111111111111111111111111111111',
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

    expect(personalizationTool.request).toHaveBeenCalledWith(
      {
        action: 'update',
        tone: 'formal',
        voice: 'upbeat',
      },
      {
        assistantInputId: 'ain_11111111111111111111111111111111',
        toolCallId: 'call-test',
      },
    )
    expect(result.rpcResult.success).toBe(true)
    expect(result.rpcResult.contentItems[0]?.text).toContain('"status":"saved"')
  })

  it('fails closed when an update has no provider-accepted input authority', async () => {
    const request = readTestMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          action: 'update',
          tone: 'formal',
        },
        namespace: 'murph',
        tool: 'personalization',
      },
    })
    if (!request) {
      throw new Error('Expected a personalization dynamic tool request.')
    }

    const personalizationTool = {
      request: vi.fn(),
    }
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: {
        computerToolsAvailable: false,
        currentAssistantInputId: () => null,
        currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [],
        personalizationTool,
        sendVaultFile: vi.fn(async () => ({
          approvalUrl: 'https://murph.test/approve/unused',
          filename: 'unused.pdf',
          status: 'pending' as const,
        })),
        vaultFileSendAvailable: false,
      },
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })

    expect(personalizationTool.request).not.toHaveBeenCalled()
    expect(result.rpcResult.success).toBe(false)
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      'personalization is unavailable for this turn',
    )
  })

  it('rejects empty updates and unknown values before calling the owner', () => {
    expect(readTestMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: { action: 'update' },
        namespace: 'murph',
        tool: 'personalization',
      },
    })?.kind).toBe('invalid-personalization-arguments')

    expect(readTestMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: { action: 'update', model: 'unknown-model' },
        namespace: 'murph',
        tool: 'personalization',
      },
    })?.kind).toBe('invalid-personalization-arguments')

    expect(readTestMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          action: 'update_personality',
          personality: { humor: 8 },
        },
        namespace: 'murph',
        tool: 'personalization',
      },
    })?.kind).toBe('invalid-personalization-arguments')

    for (const selector of [
      { memberId: 'member_other' },
      { participantMemberId: 'participant_other' },
    ]) {
      expect(readTestMurphDynamicToolRequest({
        method: 'item/tool/call',
        params: {
          arguments: {
            action: 'update',
            tone: 'casual',
            ...selector,
          },
          namespace: 'murph',
          tool: 'personalization',
        },
      })?.kind).toBe('invalid-personalization-arguments')
    }
  })
})
