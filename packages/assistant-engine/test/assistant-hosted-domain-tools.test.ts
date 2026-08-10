import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  MURPH_AUTOMATION_TOOL,
  MURPH_DEVICE_TOOL,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.js'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.js'

describe('hosted domain dynamic tools', () => {
  it('keeps device and automation default-off', () => {
    expect(resolveMurphDynamicTools({})).not.toContain(MURPH_DEVICE_TOOL)
    expect(resolveMurphDynamicTools({})).not.toContain(MURPH_AUTOMATION_TOOL)
    expect(MURPH_AUTOMATION_TOOL.deferLoading).toBe(true)

    const enabled = resolveMurphDynamicTools({
      automationAvailable: true,
      deviceAvailable: true,
    })
    expect(enabled).toContain(MURPH_DEVICE_TOOL)
    expect(enabled).toContain(MURPH_AUTOMATION_TOOL)
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'For an active deviceActivity schedule, confirm the persisted event trigger directly',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'a null nextOccurrenceAt means no clock occurrence is knowable until a matching activity arrives, not that future delivery is exhausted',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'For time-based schedules, verify any user-facing timing confirmation against timingVerified',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'For an active one-shot with that verified null result, say its requested time is no longer deliverable and offer to reschedule it',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'On patch, a replacement recurring wall-clock schedule that omits schedule.timeZone preserves the stored explicit timezone',
    )
  })

  it('keeps privileged and generic execution fields out of both schemas', () => {
    const propertyKeys = new Set([
      ...collectJsonSchemaPropertyKeys(MURPH_AUTOMATION_TOOL.inputSchema),
      ...collectJsonSchemaPropertyKeys(MURPH_DEVICE_TOOL.inputSchema),
    ])
    for (const forbidden of [
      'argv',
      'channel',
      'command',
      'credential',
      'credentials',
      'deliveryTarget',
      'env',
      'path',
      'route',
      'threadId',
      'token',
      'vault',
    ]) {
      expect(propertyKeys).not.toContain(forbidden)
    }
  })

  it('accepts typed automation writes without exposing model-controlled routes', () => {
    expect(readToolRequest('automation', {
      action: 'save',
      activeUntil: '2026-08-01T00:00:00.000Z',
      instructions: 'Send a short reminder to wind down.',
      schedule: { kind: 'dailyLocal', localTime: '22:30' },
      status: 'paused',
      supportKind: 'reminder',
      supportSeriesId: 'habit:sleep-wind-down',
      title: 'Evening wind-down',
    })).toEqual({
      kind: 'automation',
      request: {
        action: 'save',
        activeUntil: '2026-08-01T00:00:00.000Z',
        instructions: 'Send a short reminder to wind down.',
        schedule: { kind: 'dailyLocal', localTime: '22:30' },
        status: 'paused',
        supportKind: 'reminder',
        supportSeriesId: 'habit:sleep-wind-down',
        title: 'Evening wind-down',
      },
    })

    expect(readToolRequest('automation', {
      action: 'reconcile',
      desiredAutomationIds: ['automation-1'],
      supportSeriesId: 'habit:sleep-wind-down',
    })).toEqual({
      kind: 'automation',
      request: {
        action: 'reconcile',
        desiredAutomationIds: ['automation-1'],
        supportSeriesId: 'habit:sleep-wind-down',
      },
    })
    expect(readToolRequest('automation', {
      action: 'patch',
      lookup: 'evening-wind-down',
      retargetToCurrentConversation: true,
      status: 'active',
    })).toEqual({
      kind: 'automation',
      request: {
        action: 'patch',
        lookup: 'evening-wind-down',
        retargetToCurrentConversation: true,
        status: 'active',
      },
    })

    expect(readToolRequest('automation', {
      action: 'patch',
      lookup: 'evening-wind-down',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'save',
      instructions: 'Send a reminder.',
      retargetToCurrentConversation: true,
      route: { channel: 'linq', deliveryTarget: 'model-controlled' },
      schedule: { kind: 'dailyLocal', localTime: '22:30' },
      title: 'Evening wind-down',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'patch',
      command: 'vault-cli automation patch',
      lookup: 'evening-wind-down',
      token: 'not-allowed',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
  })

  it('uses accountId for bounded device actions and rejects credentials', () => {
    expect(readToolRequest('device', {
      accountId: 'device-account-1',
      action: 'reconcile',
    })).toEqual({
      kind: 'device',
      request: {
        accountId: 'device-account-1',
        action: 'reconcile',
      },
    })
    expect(readToolRequest('device', {
      action: 'connect',
      password: 'not-allowed',
      provider: 'whoop',
      token: 'not-allowed',
    })).toMatchObject({ kind: 'invalid-device-arguments' })
  })

  it('executes automation through the injected port and returns verified timing fields', async () => {
    const abortController = new AbortController()
    const automationTool = {
      request: vi.fn(async () => ({
        action: 'save' as const,
        automationId: 'automation-1',
        created: true,
        effectiveTimeZone: 'America/Chicago',
        lookupId: 'evening-wind-down',
        nextOccurrenceAt: null,
        path: '/internal/automations/evening-wind-down.md',
        routeBinding: 'current_conversation' as const,
        schedule: {
          kind: 'dailyLocal' as const,
          localTime: '22:30',
          timeZone: 'America/Chicago',
        },
        status: 'paused' as const,
        timingVerified: true,
      })),
    }
    const request = readToolRequest('automation', {
      action: 'save',
      instructions: 'Send a short reminder to wind down.',
      schedule: {
        kind: 'dailyLocal',
        localTime: '22:30',
        timeZone: 'America/Chicago',
      },
      status: 'paused',
      title: 'Evening wind-down',
    })
    if (!request) {
      throw new Error('Expected an automation request.')
    }

    const result = await executeMurphDynamicToolRequest({
      abortSignal: abortController.signal,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ automationTool }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })

    expect(automationTool.request).toHaveBeenCalledWith({
      action: 'save',
      instructions: 'Send a short reminder to wind down.',
      schedule: {
        kind: 'dailyLocal',
        localTime: '22:30',
        timeZone: 'America/Chicago',
      },
      status: 'paused',
      title: 'Evening wind-down',
    }, { signal: abortController.signal })
    expect(readResultPayload(result)).toEqual({
      action: 'save',
      automationId: 'automation-1',
      created: true,
      effectiveTimeZone: 'America/Chicago',
      lookupId: 'evening-wind-down',
      nextOccurrenceAt: null,
      routeBinding: 'current_conversation',
      schedule: {
        kind: 'dailyLocal',
        localTime: '22:30',
        timeZone: 'America/Chicago',
      },
      status: 'paused',
      timingVerified: true,
    })

    const mismatchedTool = {
      request: vi.fn(async () => ({
        action: 'patch' as const,
        automationId: 'automation-1',
        created: false,
        effectiveTimeZone: 'America/Chicago',
        lookupId: 'evening-wind-down',
        nextOccurrenceAt: '2026-08-10T03:30:00.000Z',
        routeBinding: 'preserved' as const,
        schedule: {
          kind: 'dailyLocal' as const,
          localTime: '22:30',
          timeZone: 'America/Chicago',
        },
        status: 'active' as const,
        timingVerified: true,
      })),
    }
    const mismatched = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ automationTool: mismatchedTool }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })
    expect(mismatched.rpcResult).toMatchObject({ success: false })

    const unavailable = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({}),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })
    expect(unavailable.rpcResult).toMatchObject({ success: false })
  })

  it('executes support-series reconciliation through the injected port', async () => {
    const automationTool = {
      request: vi.fn(async () => ({
        action: 'reconcile' as const,
        archivedCount: 1,
        matchedCount: 2,
        missingDesiredAutomationIds: ['automation-missing'],
        supportSeriesId: 'habit:sleep-wind-down',
        unchangedCount: 1,
      })),
    }
    const request = readToolRequest('automation', {
      action: 'reconcile',
      desiredAutomationIds: ['automation-keep', 'automation-missing'],
      supportSeriesId: 'habit:sleep-wind-down',
    })
    if (!request) {
      throw new Error('Expected an automation reconciliation request.')
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ automationTool }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })

    expect(automationTool.request).toHaveBeenCalledWith({
      action: 'reconcile',
      desiredAutomationIds: ['automation-keep', 'automation-missing'],
      supportSeriesId: 'habit:sleep-wind-down',
    }, { signal: null })
    expect(readResultPayload(result)).toEqual({
      action: 'reconcile',
      archivedCount: 1,
      matchedCount: 2,
      missingDesiredAutomationIds: ['automation-missing'],
      supportSeriesId: 'habit:sleep-wind-down',
      unchangedCount: 1,
    })
  })

  it('executes device actions through the injected port and fails closed without it', async () => {
    const abortController = new AbortController()
    const deviceTool = {
      request: vi.fn(async () => ({
        action: 'connect' as const,
        link: {
          authorizationUrl: 'https://connect.example.test/authorize',
          connectUrl: 'https://connect.example.test/start',
          expiresAt: '2026-07-16T12:05:00.000Z',
          provider: 'whoop',
          providerLabel: 'WHOOP',
          secret: 'not-model-visible',
        },
      })),
    }
    const request = readToolRequest('device', {
      action: 'connect',
      provider: 'whoop',
    })
    if (!request) {
      throw new Error('Expected a device request.')
    }

    const result = await executeMurphDynamicToolRequest({
      abortSignal: abortController.signal,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ deviceTool }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })

    expect(deviceTool.request).toHaveBeenCalledWith({
      action: 'connect',
      provider: 'whoop',
    }, { signal: abortController.signal })
    expect(readResultPayload(result)).toEqual({
      action: 'connect',
      link: {
        authorizationUrl: 'https://connect.example.test/authorize',
        connectUrl: 'https://connect.example.test/start',
        expiresAt: '2026-07-16T12:05:00.000Z',
        provider: 'whoop',
        providerLabel: 'WHOOP',
      },
    })

    const unavailable = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({}),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })
    expect(unavailable.rpcResult).toMatchObject({ success: false })
  })
})

function readToolRequest(tool: 'automation' | 'device', argumentsValue: unknown) {
  return readTestMurphDynamicToolRequest({
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool,
      turnId: 'turn-active-root-1',
    },
  })
}

function createHostedToolContext(input: {
  automationTool?: AssistantHostedToolContext['automationTool']
  deviceTool?: AssistantHostedToolContext['deviceTool']
}): AssistantHostedToolContext {
  return {
    automationTool: input.automationTool ?? null,
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    deviceTool: input.deviceTool ?? null,
    sendVaultFile: vi.fn(async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    }),
    vaultFileSendAvailable: false,
  }
}

function readResultPayload(
  result: Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>,
): unknown {
  const text = result.rpcResult.contentItems[0]?.text
  if (!text) {
    throw new Error('Expected tool result text.')
  }
  return JSON.parse(text)
}

function collectJsonSchemaPropertyKeys(
  value: unknown,
  keys = new Set<string>(),
): ReadonlySet<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonSchemaPropertyKeys(item, keys)
    }
    return keys
  }
  if (!value || typeof value !== 'object') {
    return keys
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === 'properties' && child && typeof child === 'object') {
      for (const propertyKey of Object.keys(child)) {
        keys.add(propertyKey)
      }
    }
    collectJsonSchemaPropertyKeys(child, keys)
  }
  return keys
}
