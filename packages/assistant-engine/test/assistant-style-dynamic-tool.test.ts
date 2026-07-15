import { beforeEach, describe, expect, it, vi } from 'vitest'

const preferenceMocks = vi.hoisted(() => ({
  resetAllAssistantPersonalitySettings: vi.fn(),
  resetAssistantPersonalitySetting: vi.fn(),
  setAssistantPersonalitySetting: vi.fn(),
  showAssistantPersonality: vi.fn(),
}))

const hostedMocks = vi.hoisted(() => ({
  requestPersonalization: vi.fn(),
  resolvePreferenceCausalSeq: vi.fn(),
}))

vi.mock('@murphai/vault-usecases/preferences', () => preferenceMocks)

import {
  executeMurphDynamicToolRequest,
  MURPH_ASSISTANT_STYLE_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.js'

beforeEach(() => {
  for (const mock of Object.values(preferenceMocks)) {
    mock.mockReset()
  }
  hostedMocks.requestPersonalization.mockReset()
  hostedMocks.resolvePreferenceCausalSeq.mockReset()
  hostedMocks.resolvePreferenceCausalSeq.mockResolvedValue('41')
})

describe('assistant style dynamic tool', () => {
  it('is available only when the exact turn is private and direct', () => {
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
    })
    expect(readStyleRequest({
      action: 'set',
      setting: 'humor',
      value: 0,
    })).toEqual({
      args: { action: 'set', setting: 'humor', value: 0 },
      kind: 'assistant-style',
    })
    expect(readStyleRequest({
      action: 'reset',
      setting: 'all',
    })).toEqual({
      args: { action: 'reset', setting: 'all' },
      kind: 'assistant-style',
    })
    expect(readStyleRequest({
      action: 'set',
      setting: 'humor',
      value: 11,
    })?.kind).toBe('invalid-assistant-style-arguments')
  })

  it('fails closed without exact-turn authority before reading preferences', async () => {
    const result = await executeStyleRequest({ action: 'show' }, false)

    expect(result.rpcResult.success).toBe(false)
    expect(result.rpcResult.contentItems[0]?.text).toContain(
      'unavailable outside a private direct conversation',
    )
    expect(preferenceMocks.showAssistantPersonality).not.toHaveBeenCalled()
  })

  it('routes authorized show, set, and reset actions through canonical usecases', async () => {
    preferenceMocks.showAssistantPersonality.mockResolvedValue({
      settings: { humor: { source: 'default', value: 3 } },
      updated: false,
    })
    preferenceMocks.setAssistantPersonalitySetting.mockResolvedValue({
      settings: { humor: { source: 'custom', value: 8 } },
      updated: true,
    })
    preferenceMocks.resetAllAssistantPersonalitySettings.mockResolvedValue({
      settings: { humor: { source: 'default', value: 3 } },
      updated: true,
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
    expect(preferenceMocks.showAssistantPersonality).toHaveBeenCalledWith('/tmp/vault')
    expect(preferenceMocks.setAssistantPersonalitySetting).toHaveBeenCalledWith({
      causalSeq: '41',
      setting: 'humor',
      value: 8,
      vault: '/tmp/vault',
    })
    expect(preferenceMocks.resetAllAssistantPersonalitySettings).toHaveBeenCalledWith({
      causalSeq: '41',
      vault: '/tmp/vault',
    })
    expect(JSON.parse(set.rpcResult.contentItems[0]!.text)).toMatchObject({
      updated: true,
    })
    expect(reset.rpcResult.success).toBe(true)
    expect(hostedMocks.resolvePreferenceCausalSeq).toHaveBeenCalledTimes(2)
    expect(hostedMocks.resolvePreferenceCausalSeq).toHaveBeenCalledWith({
      assistantInputId: 'ain_0123456789abcdef0123456789abcdef',
    })
  })

  it('fails hosted mutations closed without provider-accepted input authority', async () => {
    preferenceMocks.showAssistantPersonality.mockResolvedValue({
      settings: { humor: { source: 'default', value: 3 } },
      updated: false,
    })

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
    expect(preferenceMocks.showAssistantPersonality).toHaveBeenCalledWith('/tmp/vault')
    expect(preferenceMocks.setAssistantPersonalitySetting).not.toHaveBeenCalled()
    expect(preferenceMocks.resetAllAssistantPersonalitySettings).not.toHaveBeenCalled()
    expect(hostedMocks.resolvePreferenceCausalSeq).not.toHaveBeenCalled()
  })

  it('fails a hosted mutation closed when Web authority resolution fails', async () => {
    hostedMocks.resolvePreferenceCausalSeq.mockRejectedValueOnce(
      new Error('unavailable'),
    )

    const result = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      true,
      { hosted: true },
    )

    expect(result.rpcResult.success).toBe(false)
    expect(preferenceMocks.setAssistantPersonalitySetting).not.toHaveBeenCalled()
  })

  it('fails hosted mutations closed when causal resolution is missing or empty', async () => {
    const missingResolver = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      true,
      { hosted: true, resolverAvailable: false },
    )
    hostedMocks.resolvePreferenceCausalSeq.mockResolvedValueOnce(null)
    const emptyResolution = await executeStyleRequest(
      { action: 'reset', setting: 'all' },
      true,
      { hosted: true },
    )

    expect(missingResolver.rpcResult.success).toBe(false)
    expect(emptyResolution.rpcResult.success).toBe(false)
    expect(preferenceMocks.setAssistantPersonalitySetting).not.toHaveBeenCalled()
    expect(preferenceMocks.resetAllAssistantPersonalitySettings).not.toHaveBeenCalled()
  })

  it('does not resolve hosted causal authority before availability and vault guards', async () => {
    const unavailable = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      false,
      { hosted: true },
    )
    const missingVault = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      true,
      { hosted: true, vaultRoot: null },
    )

    expect(unavailable.rpcResult.success).toBe(false)
    expect(missingVault.rpcResult.success).toBe(false)
    expect(hostedMocks.resolvePreferenceCausalSeq).not.toHaveBeenCalled()
    expect(preferenceMocks.setAssistantPersonalitySetting).not.toHaveBeenCalled()
  })

  it('keeps local mutations compatible without hosted causal authority', async () => {
    preferenceMocks.setAssistantPersonalitySetting.mockResolvedValue({
      settings: { humor: { source: 'custom', value: 8 } },
      updated: true,
    })

    const result = await executeStyleRequest(
      { action: 'set', setting: 'humor', value: 8 },
      true,
    )

    expect(result.rpcResult.success).toBe(true)
    expect(preferenceMocks.setAssistantPersonalitySetting).toHaveBeenCalledWith({
      setting: 'humor',
      value: 8,
      vault: '/tmp/vault',
    })
  })
})

function readStyleRequest(argumentsValue: unknown) {
  return readMurphDynamicToolRequest({
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: 'assistant_style',
    },
  })
}

async function executeStyleRequest(
  argumentsValue: unknown,
  assistantStyleSettingsAvailable: boolean,
  options: {
    assistantInputId?: string | null
    hosted?: boolean
    resolverAvailable?: boolean
    vaultRoot?: string | null
  } = {},
) {
  const request = readStyleRequest(argumentsValue)
  if (!request) {
    throw new Error('Expected an assistant style dynamic tool request.')
  }

  return await executeMurphDynamicToolRequest({
    assistantStyleSettingsAvailable,
    env: {},
    fetchImpl: fetch,
    hostedToolContext: options.hosted !== true
      ? null
      : {
          computerToolsAvailable: false,
          currentAssistantPersonalizationInputId: () =>
            options.assistantInputId === undefined
              ? 'ain_0123456789abcdef0123456789abcdef'
              : options.assistantInputId,
          currentHostedDeliveryContext: () => null,
          currentHostedMailboxItemIds: () => [],
          personalizationTool: {
            request: hostedMocks.requestPersonalization,
            ...(options.resolverAvailable === false
              ? {}
              : {
                  resolvePreferenceCausalSeq:
                    hostedMocks.resolvePreferenceCausalSeq,
                }),
          },
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
