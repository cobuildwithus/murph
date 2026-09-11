import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from 'vitest'
import { compileToolInputSchema } from './support/tool-input-schema-validation.ts'
import { assistantBasePersonaIdValues, assistantTonePreferenceValues, assistantVoiceOptionIdValues } from '@murphai/contracts'

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
    expect(properties.mainPersona.enum).toEqual(assistantBasePersonaIdValues)
    expect(properties.supportingPersona.anyOf[0].enum).toEqual(assistantBasePersonaIdValues)
    expect(properties.tone.enum).toEqual(assistantTonePreferenceValues)
    expect(properties.voice.enum).toEqual(assistantVoiceOptionIdValues)
    const fields = [
      { name: 'mainPersona', schema: properties.mainPersona, values: assistantBasePersonaIdValues, paired: { supportingPersona: null } },
      { name: 'supportingPersona', schema: properties.supportingPersona, values: [...assistantBasePersonaIdValues, null], paired: {} },
      { name: 'tone', schema: properties.tone, values: assistantTonePreferenceValues, paired: {} },
      { name: 'voice', schema: properties.voice, values: assistantVoiceOptionIdValues, paired: {} },
    ]
    for (const field of fields) {
      const advertised = compileToolInputSchema(field.schema)
      for (const value of [...field.values, 'unsupported_value', '', 42, false, {}, []]) {
        const accepted = field.values.some((allowed) => allowed === value)
        expect(advertised(value), `${field.name} advertised value`).toBe(accepted)
        // Satisfy the separate persona-pair constraint when testing an enum.
        const paired = field.name === 'supportingPersona'
          ? { mainPersona: assistantBasePersonaIdValues.find((persona) => persona !== value) }
          : field.paired
        const parsed = readTestMurphDynamicToolRequest({ method: 'item/tool/call', params: {
          namespace: 'murph', tool: 'personalization',
          arguments: { action: 'update', ...paired, [field.name]: value },
        } })
        expect(parsed?.kind, `${field.name} runtime value`).toBe(accepted ? 'personalization' : 'invalid-personalization-arguments')
      }
    }
  })

  it('advertises sparse updates with paired persona fields and preserves runtime admission', () => {
    expect(MURPH_PERSONALIZATION_TOOL.inputSchema.oneOf[1]).toMatchObject({
      type: 'object', additionalProperties: false, required: ['action'], minProperties: 2,
      dependentRequired: {
        mainPersona: ['supportingPersona'], supportingPersona: ['mainPersona'],
      },
    })
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain('send only the fields the user wants changed')
    const fields = ['mainPersona', 'supportingPersona', 'tone', 'voice'] as const
    for (const supportingPersona of ['classic', null]) {
      const values = { mainPersona: 'scientist', supportingPersona, tone: 'formal', voice: 'upbeat' }
      for (let mask = 0; mask < 16; mask += 1) {
        const argumentsValue = { action: 'update', ...Object.fromEntries(
          fields.filter((_field, bit) => mask & (1 << bit)).map((field) => [field, values[field]]),
        ) }
        const valid = mask !== 0 && Boolean(mask & 1) === Boolean(mask & 2)
        expect(advertisedInput(argumentsValue), 'advertised nonempty and paired-field contract').toBe(valid)
        const parsed = readTestMurphDynamicToolRequest({ method: 'item/tool/call', params: {
          arguments: argumentsValue, namespace: 'murph', tool: 'personalization',
        } })
        expect(parsed?.kind, JSON.stringify(argumentsValue)).toBe(valid ? 'personalization' : 'invalid-personalization-arguments')
      }
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
      'rather than an unsupported setting',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'a one-reply formatting request does not persist',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'Persona changes require current accepted user input',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'both mainPersona and supportingPersona',
    )
    expect(MURPH_PERSONALIZATION_TOOL.description).toContain(
      'scheduled automation occurrences may update tone and voice but never personas',
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
          mainPersona: 'scientist',
          supportingPersona: 'classic',
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
        mainPersona: 'scientist',
        supportingPersona: 'classic',
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
          mainPersona: 'scientist' as const,
          model: 'gpt-5.6-terra' as const,
          modelChangeAppliesNextRun: false as const,
          modelUpdated: false as const,
          solAvailable: true,
          status: 'saved' as const,
          supportingPersona: 'classic' as const,
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
        mainPersona: 'scientist',
        supportingPersona: 'classic',
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
      '"mainPersona":"scientist"',
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
