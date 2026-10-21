import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from 'vitest'
import { compileToolInputSchema } from './support/tool-input-schema-validation.ts'
import { assistantTonePreferenceValues, assistantVoiceOptionIdValues } from '@murphai/contracts'

import {
  executeMurphDynamicToolRequest,
  MURPH_PERSONALIZATION_TOOL,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.js'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.js'

const advertisedInput = compileToolInputSchema(MURPH_PERSONALIZATION_TOOL.inputSchema)

describe('assistant personalization tool', () => {
  it('keeps every advertised enum value and invalid field type aligned with runtime admission', () => {
    const properties = MURPH_PERSONALIZATION_TOOL.inputSchema.oneOf[1].properties
    expect(properties.tone.enum).toEqual(assistantTonePreferenceValues)
    expect(properties.voice.enum).toEqual(assistantVoiceOptionIdValues)
    const fields = [
      { name: 'tone', schema: properties.tone, values: assistantTonePreferenceValues, paired: {} },
      { name: 'voice', schema: properties.voice, values: assistantVoiceOptionIdValues, paired: {} },
    ]
    for (const field of fields) {
      const advertised = compileToolInputSchema(field.schema)
      for (const value of [...field.values, 'unsupported_value', '', 42, false, {}, []]) {
        const accepted = field.values.some((allowed) => allowed === value)
        expect(advertised(value), `${field.name} advertised value`).toBe(accepted)
        const parsed = readTestMurphDynamicToolRequest({ method: 'item/tool/call', params: {
          namespace: 'murph', tool: 'personalization',
          arguments: { action: 'update', [field.name]: value },
        } })
        expect(parsed?.kind, `${field.name} runtime value`).toBe(accepted ? 'personalization' : 'invalid-personalization-arguments')
      }
    }
  })

  it('advertises only sparse tone and voice updates', () => {
    const properties = MURPH_PERSONALIZATION_TOOL.inputSchema.oneOf[1].properties
    expect(Object.keys(properties)).toEqual(['action', 'message_ref', 'tone', 'voice'])
    for (const args of [
      { action: 'update' },
      { action: 'update', mainPersona: 'classic', supportingPersona: null },
      { action: 'update', tone: 'formal', mainPersona: 'classic' },
    ]) {
      expect(advertisedInput(args)).toBe(false)
      expect(readTestMurphDynamicToolRequest({ method: 'item/tool/call', params: {
        arguments: args, namespace: 'murph', tool: 'personalization',
      } })?.kind).toBe('invalid-personalization-arguments')
    }
    expect(advertisedInput({ action: 'update', tone: 'formal' })).toBe(true)
    expect(advertisedInput({ action: 'update', voice: 'warm' })).toBe(true)
  })

  it.each([
    { messageRef: `ain_${'1'.repeat(32)}`, accepted: true },
    { messageRef: `ain_${'2'.repeat(32)}`, accepted: true },
    { messageRef: `ain_${'3'.repeat(32)}`, accepted: false },
    { messageRef: undefined, accepted: false },
  ])('binds a personalization batch update to selected source $messageRef', async ({ messageRef, accepted }) => {
    const args = {
      action: 'update', tone: 'formal',
      ...(messageRef === undefined ? {} : { message_ref: messageRef }),
    }
    expect(advertisedInput(args)).toBe(true)
    const request = readTestMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: { arguments: args, namespace: 'murph', tool: 'personalization' },
    })
    if (!request) throw new Error('Expected a personalization request.')
    const personalizationTool = { request: vi.fn(async () => ({ action: 'read' as const, result: {
      mainPersona: "classic" as const,
      supportingPersona: null,
      model: 'gpt-6-sol' as const, solAvailable: true, tone: 'formal' as const, voice: 'warm' as const,
    } })) }
    const result = await executeMurphDynamicToolRequest({
      env: {}, fetchImpl: fetch, nextUsageOrdinal: () => 0, progressDelivery: null, request,
      hostedToolContext: {
        computerToolsAvailable: false,
        currentAssistantInputId: () => `ain_${'2'.repeat(32)}`,
        currentUserActionScope: () => ({
          acceptedInputIds: [`ain_${'1'.repeat(32)}`, `ain_${'2'.repeat(32)}`],
          conversationId: 'conversation_personalization', conversationScope: 'direct',
          inboundMailboxItemIds: [], originSessionId: 'session_personalization', recipientKey: null,
        }),
        currentHostedDeliveryContext: () => null, currentHostedMailboxItemIds: () => [],
        personalizationTool, vaultFileSendAvailable: false,
        sendVaultFile: async () => { throw new Error('unavailable') },
      },
    })
    expect(result.rpcResult.success).toBe(accepted)
    if (accepted) {
      expect(personalizationTool.request).toHaveBeenCalledExactlyOnceWith(
        { action: 'update', tone: 'formal' },
        { assistantInputId: messageRef, toolCallId: 'call-test' },
      )
    } else {
      expect(personalizationTool.request).not.toHaveBeenCalled()
    }
  })

  it('rejects source-only updates, malformed refs, and refs on reads', () => {
    for (const args of [
      { action: 'update', message_ref: `ain_${'1'.repeat(32)}` },
      { action: 'update', tone: 'casual', message_ref: 'invalid' },
      { action: 'read', message_ref: `ain_${'1'.repeat(32)}` },
    ]) {
      expect(advertisedInput(args)).toBe(false)
      expect(readTestMurphDynamicToolRequest({
        method: 'item/tool/call',
        params: { arguments: args, namespace: 'murph', tool: 'personalization' },
      })?.kind).toBe('invalid-personalization-arguments')
    }
  })

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
      'Confirm casing as sentence case or lowercase in the reply.',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'rather than an unsupported setting',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'a one-reply formatting request does not persist',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).not.toMatch(/mainPersona|supportingPersona|persona changes/iu)
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
          mainPersona: "classic" as const,
          supportingPersona: null,
          model: 'gpt-6-sol' as const,
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
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      '"voice":"upbeat"',
    )
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
        arguments: {
          action: 'update',
          mainPersona: 'scientist',
        },
        namespace: 'murph',
        tool: 'personalization',
      },
    })?.kind).toBe('invalid-personalization-arguments')

    expect(readTestMurphDynamicToolRequest({
      method: 'item/tool/call',
      params: {
        arguments: {
          action: 'update',
          mainPersona: 'scientist',
          supportingPersona: 'scientist',
        },
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
