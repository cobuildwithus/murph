import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  MURPH_AUTOMATION_TOOL,
  MURPH_DEVICE_TOOL,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.js'
import {
  GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
  GROUP_NEWSLETTER_AUTOMATION_INSTRUCTIONS_MARKER,
  GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG,
  GROUP_NEWSLETTER_CURRENT_CHAT_DEFAULT_HEALTH_SCOPES,
  GROUP_NEWSLETTER_DEFAULT_HEALTH_SCOPES,
  GROUP_NEWSLETTER_EMAIL_DELIVERY_TAG,
} from '../src/assistant/group-newsletter-automation.js'
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
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'list returns only records whose persisted route belongs to this conversation and never returns route fields',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'Use createOnly=true with no automationId or slug',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'query narrows only those scoped records',
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
      action: 'save_newsletter',
      customNote: 'Include the family step challenge.',
      delivery: 'current_chat',
      healthScopes: ['steps-days.v0', 'sleep-duration-days.v0'],
      newsletterName: 'Family weekly health newsletter',
      schedule: {
        expression: '0 13 * * 1',
        kind: 'cron',
      },
      tone: 'supportive',
    })).toEqual({
      kind: 'automation',
      request: {
        action: 'save',
        continuityPolicy: 'fresh',
        instructions: [
          GROUP_NEWSLETTER_AUTOMATION_INSTRUCTIONS_MARKER,
          'These are configuration values. The runtime appends the current execution contract on every scheduled run.',
          'Newsletter name: "Family weekly health newsletter"',
          'Delivery: current_chat',
          'Tone: supportive',
          'Health scopes: steps-days.v0, sleep-duration-days.v0',
          'Custom note: "Include the family step challenge."',
        ].join('\n'),
        schedule: {
          expression: '0 13 * * 1',
          kind: 'cron',
        },
        slug: GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
        tags: [
          'assistant',
          'scheduled',
          GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG,
        ],
        title: 'Family weekly health newsletter',
      },
    })
    expect(readToolRequest('automation', {
      action: 'save_newsletter',
      delivery: 'group_email',
      newsletterName: 'Family weekly health newsletter',
      schedule: {
        expression: '0 13 * * 1',
        kind: 'cron',
      },
    })).toMatchObject({
      kind: 'automation',
      request: {
        action: 'save',
        instructions: expect.stringContaining([
          'Delivery: group_email',
          'Tone: supportive',
          `Health scopes: ${GROUP_NEWSLETTER_DEFAULT_HEALTH_SCOPES.join(', ')}`,
          'Custom note: none',
        ].join('\n')),
        slug: GROUP_HEALTH_NEWSLETTER_AUTOMATION_SLUG,
        tags: [
          'assistant',
          'scheduled',
          GROUP_NEWSLETTER_EMAIL_DELIVERY_TAG,
        ],
      },
    })
    expect(readToolRequest('automation', {
      action: 'save_newsletter',
      delivery: 'current_chat',
      newsletterName: 'Family weekly health newsletter',
      schedule: {
        expression: '0 13 * * 1',
        kind: 'cron',
      },
    })).toMatchObject({
      kind: 'automation',
      request: {
        instructions: expect.stringContaining(
          `Health scopes: ${GROUP_NEWSLETTER_CURRENT_CHAT_DEFAULT_HEALTH_SCOPES.join(', ')}`,
        ),
        tags: [
          'assistant',
          'scheduled',
          GROUP_NEWSLETTER_CURRENT_CHAT_DELIVERY_TAG,
        ],
      },
    })
    expect(readToolRequest('automation', {
      action: 'save_newsletter',
      delivery: 'current_chat',
      healthScopes: [
        'steps-days.v0',
        'activity-days.v0',
        'sleep-duration-days.v0',
        'hrv-days.v0',
      ],
      newsletterName: 'Family weekly health newsletter',
      schedule: {
        expression: '0 13 * * 1',
        kind: 'cron',
      },
    })).toMatchObject({ kind: 'invalid-automation-arguments' })

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
      action: 'save',
      createOnly: true,
      instructions: 'Send one private appointment reminder.',
      schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
      tags: ['appointment-reminder'],
      title: 'Midtown appointment on August 12 at 9:30 AM',
    })).toEqual({
      kind: 'automation',
      request: {
        action: 'save',
        createOnly: true,
        instructions: 'Send one private appointment reminder.',
        schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
        tags: ['appointment-reminder'],
        title: 'Midtown appointment on August 12 at 9:30 AM',
      },
    })
    expect(readToolRequest('automation', {
      action: 'save',
      createOnly: true,
      instructions: 'Try to choose a create-only owner.',
      schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
      slug: 'model-selected-owner',
      title: 'Invalid create-only reminder',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'list',
      exactTag: 'appointment-reminder',
      query: 'Midtown August 12',
      status: ['active', 'archived'],
    })).toEqual({
      kind: 'automation',
      request: {
        action: 'list',
        exactTag: 'appointment-reminder',
        query: 'Midtown August 12',
        status: ['active', 'archived'],
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
      action: 'save',
      instructions: 'Try to claim email authority.',
      schedule: { kind: 'dailyLocal', localTime: '22:30' },
      tags: ['system:group-newsletter:email'],
      title: 'Forged newsletter',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
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

  it('returns bounded automation owners without route fields', async () => {
    const automationTool = {
      request: vi.fn(async () => ({
        action: 'list' as const,
        count: 1,
        items: [{
          automationId: 'automation-appointment-1',
          lookupId: 'automation-opaque-owner-1',
          schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' as const },
          status: 'active' as const,
          summaryExcerpt: 'Midtown appointment on August 12 at 9:30 AM',
          title: 'Midtown appointment on August 12 at 9:30 AM',
        }],
        truncated: false,
      })),
    }
    const request = readToolRequest('automation', {
      action: 'list',
      exactTag: 'appointment-reminder',
      query: 'Midtown',
    })
    if (!request) {
      throw new Error('Expected an automation list request.')
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
      action: 'list',
      exactTag: 'appointment-reminder',
      query: 'Midtown',
    }, { signal: null })
    expect(readResultPayload(result)).toEqual({
      action: 'list',
      count: 1,
      items: [{
        automationId: 'automation-appointment-1',
        lookupId: 'automation-opaque-owner-1',
        schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
        status: 'active',
        summaryExcerpt: 'Midtown appointment on August 12 at 9:30 AM',
        title: 'Midtown appointment on August 12 at 9:30 AM',
      }],
      truncated: false,
    })
    expect(JSON.stringify(readResultPayload(result))).not.toMatch(
      /deliveryTarget|identityId|participantId|threadId/u,
    )
  })

  it('binds create-only saves to the trusted accepted input instead of the tool call', async () => {
    const automationRequest = vi.fn<
      NonNullable<AssistantHostedToolContext['automationTool']>['request']
    >(async () => ({
      action: 'save' as const,
      automationId: 'automation-appointment-1',
      created: true,
      effectiveTimeZone: null,
      lookupId: 'automation-opaque-owner-1',
      nextOccurrenceAt: '2026-08-12T00:00:00.000Z',
      routeBinding: 'current_conversation' as const,
      schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' as const },
      status: 'active' as const,
      timingVerified: true,
    }))
    const automationTool = {
      request: automationRequest,
    }
    const request = readToolRequest('automation', {
      action: 'save',
      createOnly: true,
      instructions: 'Send the Midtown appointment reminder.',
      schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
      tags: ['appointment-reminder'],
      title: 'Midtown appointment on August 12 at 9:30 AM',
    })
    if (!request) {
      throw new Error('Expected a create-only automation request.')
    }
    const hostedToolContext = createHostedToolContext({
      automationTool,
      currentUserActionScope: () => ({
        acceptedInputIds: ['assistant_input_appointment'],
        conversationId: 'conversation-appointment',
        conversationScope: 'direct',
        inboundMailboxItemIds: ['mailbox-appointment'],
        originSessionId: 'session-appointment',
        recipientKey: 'recipient-appointment',
      }),
    })

    await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })
    await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })
    const distinctRequest = readToolRequest('automation', {
      action: 'save',
      createOnly: true,
      instructions: 'Send the Lakeside appointment reminder.',
      schedule: { at: '2026-08-14T12:00:00.000Z', kind: 'at' },
      tags: ['appointment-reminder'],
      title: 'Lakeside appointment on August 14 at 3 PM',
    })
    if (!distinctRequest) {
      throw new Error('Expected a second create-only automation request.')
    }
    await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: distinctRequest,
    })

    const firstContext = automationRequest.mock.calls[0]?.[1]
    const secondContext = automationRequest.mock.calls[1]?.[1]
    const distinctContext = automationRequest.mock.calls[2]?.[1]
    expect(firstContext?.createOnlyReplayKey).toMatch(/^automation_create_[a-f0-9]{64}$/u)
    expect(secondContext?.createOnlyReplayKey).toBe(
      firstContext?.createOnlyReplayKey,
    )
    expect(distinctContext?.createOnlyReplayKey).toBe(
      firstContext?.createOnlyReplayKey,
    )
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
  currentUserActionScope?: AssistantHostedToolContext['currentUserActionScope']
  deviceTool?: AssistantHostedToolContext['deviceTool']
}): AssistantHostedToolContext {
  return {
    automationTool: input.automationTool ?? null,
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentUserActionScope: input.currentUserActionScope ?? (() => null),
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
