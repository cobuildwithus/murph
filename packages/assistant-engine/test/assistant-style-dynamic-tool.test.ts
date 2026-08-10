import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const preferenceMocks = vi.hoisted(() => ({
  resetAllAssistantPersonalitySettings: vi.fn(),
  resetAssistantPersonalitySetting: vi.fn(),
  setAssistantPersonalitySetting: vi.fn(),
  showAssistantPersonality: vi.fn(),
}))

const hostedMocks = vi.hoisted(() => ({
  requestPersonalization: vi.fn(),
}))

vi.mock('@murphai/vault-usecases/preferences', () => preferenceMocks)

import {
  executeMurphDynamicToolRequest,
  MURPH_ASSISTANT_STYLE_TOOL,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.js'

beforeEach(() => {
  for (const mock of Object.values(preferenceMocks)) {
    mock.mockReset()
  }
  hostedMocks.requestPersonalization.mockReset()
  preferenceMocks.showAssistantPersonality.mockResolvedValue({
    settings: personalitySettings(),
    updated: false,
  })
})

describe('assistant style dynamic tool', () => {
  it('is available only when the planner grants current-conversation authority', () => {
    expect(resolveMurphDynamicTools({
      assistantStyleSettingsAvailable: true,
    })).toContain(MURPH_ASSISTANT_STYLE_TOOL)
    expect(resolveMurphDynamicTools({
      assistantStyleSettingsAvailable: false,
    })).not.toContain(MURPH_ASSISTANT_STYLE_TOOL)
    expect(resolveMurphDynamicTools({})).not.toContain(MURPH_ASSISTANT_STYLE_TOOL)
  })

  it('parses only the closed show, set, and reset contract', () => {
    expect(readStyleRequest({ action: 'show' })).toEqual({
      args: { action: 'show' },
      kind: 'assistant-style',
      toolCallId: 'call-test',
    })
    expect(readStyleRequest({
      action: 'set',
      setting: 'humor',
      value: 0,
    })).toEqual({
      args: { action: 'set', setting: 'humor', value: 0 },
      kind: 'assistant-style',
      toolCallId: 'call-test',
    })
    expect(readStyleRequest({
      action: 'reset',
      setting: 'all',
    })).toEqual({
      args: { action: 'reset', setting: 'all' },
      kind: 'assistant-style',
      toolCallId: 'call-test',
    })
    expect(readStyleRequest({
      action: 'set',
      setting: 'humor',
      value: 11,
    })?.kind).toBe('invalid-assistant-style-arguments')
    expect(readStyleRequest({
      action: 'set',
      memberId: 'member_other',
      setting: 'humor',
      value: 8,
    })?.kind).toBe('invalid-assistant-style-arguments')
    expect(readStyleRequest({
      action: 'show',
      participantMemberId: 'participant_other',
    })?.kind).toBe('invalid-assistant-style-arguments')
  })

  it('fails closed without exact-turn authority before reading preferences', async () => {
    const result = await executeStyleRequest({ action: 'show' }, false)

    expect(result.rpcResult.success).toBe(false)
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      'unavailable for this conversation',
    )
    expect(preferenceMocks.showAssistantPersonality).not.toHaveBeenCalled()
  })

  it('describes direct-member and synthetic-room ownership without a target selector', () => {
    expect(MURPH_ASSISTANT_STYLE_TOOL.description).toContain(
      'current conversation runtime',
    )
    expect(MURPH_ASSISTANT_STYLE_TOOL.description).toContain(
      'synthetic room Murph',
    )
    expect(MURPH_ASSISTANT_STYLE_TOOL.description).toContain(
      'never to a participant',
    )
    // The tool contract must agree with the prompt: a bare directional request
    // reads the current score first and steps from it, rather than jumping to
    // an endpoint the member never asked for.
    expect(MURPH_ASSISTANT_STYLE_TOOL.description).toContain(
      'show first, then set a bounded step from the reported score',
    )
    expect(MURPH_ASSISTANT_STYLE_TOOL.description).not.toContain('endpoint')
    expect(MURPH_ASSISTANT_STYLE_TOOL.description).not.toContain('Never guess or clamp')
    expect(MURPH_ASSISTANT_STYLE_TOOL.inputSchema).not.toHaveProperty(
      'properties.memberId',
    )
  })

  it('reads hosted show canonically and routes mutations through the Web owner', async () => {
    hostedMocks.requestPersonalization
      .mockResolvedValueOnce({
        action: 'update_personality',
        result: {
          outcomes: { humor: 'saved' },
          settings: personalitySettings({ humor: { source: 'custom', value: 8 } }),
        },
      })
      .mockResolvedValueOnce({
        action: 'update_personality',
        result: {
          outcomes: {
            detail: 'unchanged',
            humor: 'saved',
            push: 'unchanged',
            unhinged: 'unchanged',
          },
          settings: personalitySettings(),
        },
      })

    const show = await executeStyleRequest(
      { action: 'show' },
      true,
      { hosted: true },
    )
    const set = await executeStyleRequest({
      action: 'set',
      setting: 'humor',
      value: 8,
    }, true, { hosted: true })
    const reset = await executeStyleRequest({
      action: 'reset',
      setting: 'all',
    }, true, { hosted: true })

    expect(show.rpcResult.success).toBe(true)
    expect(hostedMocks.requestPersonalization).toHaveBeenNthCalledWith(1, {
      action: 'update_personality',
      personality: { humor: 8 },
    }, {
      assistantInputId: 'ain_0123456789abcdef0123456789abcdef',
      toolCallId: 'call-test',
    })
    expect(hostedMocks.requestPersonalization).toHaveBeenNthCalledWith(2, {
      action: 'update_personality',
      personality: { detail: null, humor: null, push: null, unhinged: null },
    }, {
      assistantInputId: 'ain_0123456789abcdef0123456789abcdef',
      toolCallId: 'call-test',
    })
    expect(JSON.parse(show.rpcResult.contentItems[0]!.text)).toMatchObject({
      settings: personalitySettings(),
      updated: false,
    })
    expect(JSON.parse(set.rpcResult.contentItems[0]!.text)).toMatchObject({
      outcomes: { humor: 'saved' },
      settings: { humor: { source: 'custom', value: 8 } },
      updated: true,
    })
    expect(reset.rpcResult.success).toBe(true)
    expect(preferenceMocks.showAssistantPersonality).toHaveBeenCalledTimes(3)
    expect(preferenceMocks.showAssistantPersonality).toHaveBeenCalledWith('/tmp/vault')
    expect(preferenceMocks.setAssistantPersonalitySetting).not.toHaveBeenCalled()
    expect(preferenceMocks.resetAllAssistantPersonalitySettings).not.toHaveBeenCalled()
  })

  it('maps one hosted reset to an explicit null update', async () => {
    hostedMocks.requestPersonalization.mockResolvedValue({
      action: 'update_personality',
      result: {
        outcomes: { push: 'saved' },
        settings: personalitySettings(),
      },
    })

    const result = await executeStyleRequest(
      { action: 'reset', setting: 'push' },
      true,
      { hosted: true },
    )

    expect(result.rpcResult.success).toBe(true)
    expect(hostedMocks.requestPersonalization).toHaveBeenCalledWith({
      action: 'update_personality',
      personality: { push: null },
    }, {
      assistantInputId: 'ain_0123456789abcdef0123456789abcdef',
      toolCallId: 'call-test',
    })
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toMatchObject({
      outcomes: { push: 'saved' },
      updated: false,
    })
  })

  it('forwards the exact tool call identity with hosted mutations', async () => {
    hostedMocks.requestPersonalization.mockResolvedValue({
      action: 'update_personality',
      result: {
        outcomes: { humor: 'saved' },
        settings: personalitySettings({ humor: { source: 'custom', value: 8 } }),
      },
    })

    const result = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      true,
      { hosted: true, toolCallId: 'call_style_one' },
    )

    expect(result.rpcResult.success).toBe(true)
    expect(hostedMocks.requestPersonalization).toHaveBeenCalledWith({
      action: 'update_personality',
      personality: { humor: 8 },
    }, {
      assistantInputId: 'ain_0123456789abcdef0123456789abcdef',
      toolCallId: 'call_style_one',
    })
  })

  it('sets the conversational-only Unhinged dial through the Web owner', async () => {
    hostedMocks.requestPersonalization.mockResolvedValue({
      action: 'update_personality',
      result: {
        outcomes: { unhinged: 'saved' },
        settings: personalitySettings({ unhinged: { source: 'custom', value: 8 } }),
      },
    })

    const set = await executeStyleRequest(
      { action: 'set', setting: 'unhinged', value: 8 },
      true,
      { hosted: true },
    )

    expect(set.rpcResult.success).toBe(true)
    expect(hostedMocks.requestPersonalization).toHaveBeenCalledWith({
      action: 'update_personality',
      personality: { unhinged: 8 },
    }, {
      assistantInputId: 'ain_0123456789abcdef0123456789abcdef',
      toolCallId: 'call-test',
    })
    expect(JSON.parse(set.rpcResult.contentItems[0]!.text)).toMatchObject({
      outcomes: { unhinged: 'saved' },
      settings: { unhinged: { source: 'custom', value: 8 } },
      updated: true,
    })
  })

  it('parses the Unhinged setting in the closed set/reset contract', () => {
    expect(readStyleRequest({ action: 'set', setting: 'unhinged', value: 9 })).toEqual({
      args: { action: 'set', setting: 'unhinged', value: 9 },
      kind: 'assistant-style',
      toolCallId: 'call-test',
    })
    expect(readStyleRequest({ action: 'reset', setting: 'unhinged' })).toEqual({
      args: { action: 'reset', setting: 'unhinged' },
      kind: 'assistant-style',
      toolCallId: 'call-test',
    })
  })

  it('fails hosted mutations closed without provider-accepted input authority', async () => {
    const hostedWithoutInput = { assistantInputId: null, hosted: true }
    const show = await executeStyleRequest({ action: 'show' }, true, hostedWithoutInput)
    const set = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      true,
      hostedWithoutInput,
    )
    const reset = await executeStyleRequest(
      { action: 'reset', setting: 'all' },
      true,
      hostedWithoutInput,
    )

    expect(show.rpcResult.success).toBe(true)
    expect(set.rpcResult.success).toBe(false)
    expect(reset.rpcResult.success).toBe(false)
    expect(hostedMocks.requestPersonalization).not.toHaveBeenCalled()
    expect(preferenceMocks.showAssistantPersonality).toHaveBeenCalledOnce()
    expect(preferenceMocks.setAssistantPersonalitySetting).not.toHaveBeenCalled()
    expect(preferenceMocks.resetAllAssistantPersonalitySettings).not.toHaveBeenCalled()
  })

  it('fails a hosted mutation closed when the Web owner fails', async () => {
    hostedMocks.requestPersonalization.mockRejectedValueOnce(new Error('unavailable'))

    const result = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      true,
      { hosted: true },
    )

    expect(result.rpcResult.success).toBe(false)
    expect(preferenceMocks.setAssistantPersonalitySetting).not.toHaveBeenCalled()
  })

  it('keeps canonical show available when the Web mutation port is missing', async () => {
    const missingShow = await executeStyleRequest(
      { action: 'show' },
      true,
      { hosted: true, personalizationAvailable: false },
    )
    const missingSet = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      true,
      { hosted: true, personalizationAvailable: false },
    )

    expect(missingShow.rpcResult.success).toBe(true)
    expect(missingSet.rpcResult.success).toBe(false)
    expect(hostedMocks.requestPersonalization).not.toHaveBeenCalled()
    expect(preferenceMocks.setAssistantPersonalitySetting).not.toHaveBeenCalled()
  })

  it('does not call the hosted owner before the availability guard', async () => {
    const unavailable = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      false,
      { hosted: true },
    )

    expect(unavailable.rpcResult.success).toBe(false)
    expect(hostedMocks.requestPersonalization).not.toHaveBeenCalled()
    expect(preferenceMocks.setAssistantPersonalitySetting).not.toHaveBeenCalled()
  })

  it('uses canonical siblings and the actual requested field when superseded', async () => {
    preferenceMocks.showAssistantPersonality.mockResolvedValue({
      settings: personalitySettings({
        detail: { source: 'custom', value: 9 },
        push: { source: 'custom', value: 7 },
      }),
      updated: false,
    })
    hostedMocks.requestPersonalization.mockResolvedValue({
      action: 'update_personality',
      result: {
        outcomes: { humor: 'superseded' },
        settings: personalitySettings({
          humor: { source: 'custom', value: 4 },
        }),
      },
    })

    const result = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      true,
      { hosted: true },
    )

    expect(result.rpcResult.success).toBe(true)
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toEqual({
      outcomes: { humor: 'superseded' },
      settings: personalitySettings({
        detail: { source: 'custom', value: 9 },
        humor: { source: 'custom', value: 4 },
        push: { source: 'custom', value: 7 },
      }),
      updated: false,
    })
    expect(preferenceMocks.setAssistantPersonalitySetting).not.toHaveBeenCalled()
  })

  it('retains hosted mutation results for a later show in the same turn', async () => {
    const settingsOverlay = { settings: {} }
    hostedMocks.requestPersonalization.mockResolvedValue({
      action: 'update_personality',
      result: {
        outcomes: { humor: 'saved' },
        settings: personalitySettings({
          humor: { source: 'custom', value: 8 },
        }),
      },
    })

    const set = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      true,
      { hosted: true, settingsOverlay },
    )
    const show = await executeStyleRequest(
      { action: 'show' },
      true,
      { hosted: true, settingsOverlay },
    )

    expect(set.rpcResult.success).toBe(true)
    expect(JSON.parse(show.rpcResult.contentItems[0]!.text)).toMatchObject({
      settings: {
        humor: { source: 'custom', value: 8 },
      },
      updated: false,
    })
    expect(hostedMocks.requestPersonalization).toHaveBeenCalledOnce()
  })

  it('reports durable acceptance without a visible change as not updated', async () => {
    const settingsOverlay = {
      settings: {
        humor: { source: 'custom' as const, value: 8 },
      },
    }
    hostedMocks.requestPersonalization.mockResolvedValue({
      action: 'update_personality',
      result: {
        outcomes: { humor: 'saved' },
        settings: personalitySettings({
          humor: { source: 'custom', value: 8 },
        }),
      },
    })

    const result = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      true,
      { hosted: true, settingsOverlay },
    )

    expect(result.rpcResult.success).toBe(true)
    expect(JSON.parse(result.rpcResult.contentItems[0]!.text)).toMatchObject({
      outcomes: { humor: 'saved' },
      updated: false,
    })
  })

  it('rejects missing, extra, or mismatched hosted field outcomes', async () => {
    for (const result of [
      {
        outcomes: { push: 'saved' },
        settings: personalitySettings({ humor: { source: 'custom', value: 8 } }),
      },
      {
        outcomes: { humor: 'saved', push: 'unchanged' },
        settings: personalitySettings({ humor: { source: 'custom', value: 8 } }),
      },
      {
        outcomes: { humor: 'saved' },
        settings: personalitySettings(),
      },
    ]) {
      hostedMocks.requestPersonalization.mockResolvedValueOnce({
        action: 'update_personality',
        result,
      })

      const response = await executeStyleRequest(
        { action: 'set', setting: 'humor', value: 8 },
        true,
        { hosted: true },
      )

      expect(response.rpcResult.success).toBe(false)
    }
  })

  it('keeps local show and mutations on canonical vault usecases', async () => {
    preferenceMocks.showAssistantPersonality.mockResolvedValue({
      settings: personalitySettings(),
      updated: false,
    })
    preferenceMocks.setAssistantPersonalitySetting.mockResolvedValue({
      settings: personalitySettings({ humor: { source: 'custom', value: 8 } }),
      updated: true,
    })
    preferenceMocks.resetAllAssistantPersonalitySettings.mockResolvedValue({
      settings: personalitySettings(),
      updated: true,
    })

    const show = await executeStyleRequest({ action: 'show' }, true)
    const set = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      true,
    )
    const reset = await executeStyleRequest(
      { action: 'reset', setting: 'all' },
      true,
    )

    expect(show.rpcResult.success).toBe(true)
    expect(set.rpcResult.success).toBe(true)
    expect(reset.rpcResult.success).toBe(true)
    expect(preferenceMocks.showAssistantPersonality).toHaveBeenCalledWith('/tmp/vault')
    expect(preferenceMocks.setAssistantPersonalitySetting).toHaveBeenCalledWith({
      setting: 'humor',
      value: 8,
      vault: '/tmp/vault',
    })
    expect(preferenceMocks.resetAllAssistantPersonalitySettings).toHaveBeenCalledWith({
      vault: '/tmp/vault',
    })
    expect(hostedMocks.requestPersonalization).not.toHaveBeenCalled()
  })

  it('requires a vault for hosted and local style actions', async () => {
    const hosted = await executeStyleRequest(
      { action: 'show' },
      true,
      { hosted: true, vaultRoot: null },
    )
    const local = await executeStyleRequest(
      { action: 'show' },
      true,
      { vaultRoot: null },
    )

    expect(hosted.rpcResult.success).toBe(false)
    expect(local.rpcResult.success).toBe(false)
    expect(hosted.rpcResult.contentItems[0]?.text).toContain('require a vault')
    expect(local.rpcResult.contentItems[0]?.text).toContain('require a vault')
    expect(hostedMocks.requestPersonalization).not.toHaveBeenCalled()
  })
})

function personalitySettings(overrides: Partial<{
  detail: { source: 'custom' | 'default'; value: number }
  humor: { source: 'custom' | 'default'; value: number }
  push: { source: 'custom' | 'default'; value: number }
  unhinged: { source: 'custom' | 'default'; value: number }
}> = {}) {
  return {
    detail: { source: 'default' as const, value: 5 },
    humor: { source: 'default' as const, value: 3 },
    push: { source: 'default' as const, value: 3 },
    unhinged: { source: 'default' as const, value: 0 },
    ...overrides,
  }
}

function readStyleRequest(argumentsValue: unknown, toolCallId?: string) {
  return readTestMurphDynamicToolRequest({
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: 'assistant_style',
      ...(toolCallId ? { callId: toolCallId } : {}),
    },
  })
}

async function executeStyleRequest(
  argumentsValue: unknown,
  assistantStyleSettingsAvailable: boolean,
  options: {
    assistantInputId?: string | null
    hosted?: boolean
    personalizationAvailable?: boolean
    settingsOverlay?: {
      settings: Partial<ReturnType<typeof personalitySettings>>
    }
    toolCallId?: string
    vaultRoot?: string | null
  } = {},
) {
  const request = readStyleRequest(argumentsValue, options.toolCallId)
  if (!request) {
    throw new Error('Expected an assistant style dynamic tool request.')
  }

  return await executeMurphDynamicToolRequest({
    assistantStyleSettingsOverlay: options.settingsOverlay,
    assistantStyleSettingsAvailable,
    env: {},
    fetchImpl: fetch,
    hostedToolContext: options.hosted !== true
      ? null
      : {
          computerToolsAvailable: false,
          currentAssistantInputId: () =>
            options.assistantInputId === undefined
              ? 'ain_0123456789abcdef0123456789abcdef'
              : options.assistantInputId,
          currentHostedDeliveryContext: () => null,
          currentHostedMailboxItemIds: () => [],
          ...(options.personalizationAvailable === false
            ? {}
            : {
                personalizationTool: {
                  request: hostedMocks.requestPersonalization,
                },
              }),
          sendVaultFile: async () => {
            throw new Error('unavailable')
          },
          vaultFileSendAvailable: false,
        },
    nextUsageOrdinal: () => 0,
    progressDelivery: null,
    request,
    vaultRoot: options.vaultRoot === undefined ? '/tmp/vault' : options.vaultRoot,
  })
}
