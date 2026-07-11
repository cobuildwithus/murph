import { beforeEach, describe, expect, it, vi } from 'vitest'

const preferenceMocks = vi.hoisted(() => ({
  resetAllAssistantPersonalitySettings: vi.fn(),
  resetAssistantPersonalitySetting: vi.fn(),
  setAssistantPersonalitySetting: vi.fn(),
  showAssistantPersonality: vi.fn(),
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

    const show = await executeStyleRequest({ action: 'show' }, true)
    const set = await executeStyleRequest({
      action: 'set',
      setting: 'humor',
      value: 8,
    }, true)
    const reset = await executeStyleRequest({
      action: 'reset',
      setting: 'all',
    }, true)

    expect(show.rpcResult.success).toBe(true)
    expect(preferenceMocks.showAssistantPersonality).toHaveBeenCalledWith('/tmp/vault')
    expect(preferenceMocks.setAssistantPersonalitySetting).toHaveBeenCalledWith({
      setting: 'humor',
      value: 8,
      vault: '/tmp/vault',
    })
    expect(preferenceMocks.resetAllAssistantPersonalitySettings).toHaveBeenCalledWith({
      vault: '/tmp/vault',
    })
    expect(JSON.parse(set.rpcResult.contentItems[0]!.text)).toMatchObject({
      updated: true,
    })
    expect(reset.rpcResult.success).toBe(true)
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
) {
  const request = readStyleRequest(argumentsValue)
  if (!request) {
    throw new Error('Expected an assistant style dynamic tool request.')
  }

  return await executeMurphDynamicToolRequest({
    assistantStyleSettingsAvailable,
    env: {},
    fetchImpl: fetch,
    nextUsageOrdinal: () => 0,
    progressDelivery: null,
    request,
    vaultRoot: '/tmp/vault',
  })
}
