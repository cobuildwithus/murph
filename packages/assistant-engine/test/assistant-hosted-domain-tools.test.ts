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
import {
  createAssistantAppointmentReminderSourceRef,
  resolveAssistantAppointmentReminderSourceInputIds,
} from '../src/assistant/appointment-reminder-source-ref.js'

const APPOINTMENT_INPUT_A = `ain_${'a'.repeat(32)}`
const APPOINTMENT_INPUT_B = `ain_${'b'.repeat(32)}`
const APPOINTMENT_SOURCE_REF_A =
  createAssistantAppointmentReminderSourceRef(APPOINTMENT_INPUT_A)
const APPOINTMENT_SOURCE_REF_B =
  createAssistantAppointmentReminderSourceRef(APPOINTMENT_INPUT_B)

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
      'createOnlyEffectKey=appointment-reminder:<one-based ordinal',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'createOnlySourceRef=<the exact opaque Appointment source ref beside the accepted input>',
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
      action: 'save',
      createOnly: true,
      instructions: 'Missing the stable effect discriminator.',
      schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
      title: 'Invalid create-only reminder',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'save',
      createOnlyEffectKey: 'appointment-reminder:1',
      instructions: 'Effect discriminator without create-only ownership.',
      schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
      title: 'Invalid ordinary reminder',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'save',
      createOnly: true,
      createOnlyEffectKey: 'appointment:1',
      createOnlySourceRef: APPOINTMENT_SOURCE_REF_A,
      instructions: 'Uses a noncanonical effect discriminator.',
      schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
      title: 'Invalid create-only reminder',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'save',
      createOnly: true,
      createOnlyEffectKey: 'appointment-reminder:1',
      createOnlySourceRef: APPOINTMENT_INPUT_A,
      instructions: 'Uses a raw accepted input id as authority.',
      schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
      title: 'Invalid create-only reminder',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
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
      createOnlyEffectKey: 'appointment-reminder:1',
      createOnlySourceRef: APPOINTMENT_SOURCE_REF_A,
      instructions: 'Send one private appointment reminder.',
      schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
      tags: ['appointment-reminder'],
      title: 'Midtown appointment on August 12 at 9:30 AM',
    })).toEqual({
      createOnlySourceRef: APPOINTMENT_SOURCE_REF_A,
      kind: 'automation',
      request: {
        action: 'save',
        createOnly: true,
        createOnlyEffectKey: 'appointment-reminder:1',
        instructions: 'Send one private appointment reminder.',
        schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
        tags: ['appointment-reminder'],
        title: 'Midtown appointment on August 12 at 9:30 AM',
      },
    })
    expect(readToolRequest('automation', {
      action: 'save',
      createOnly: true,
      createOnlyEffectKey: 'appointment-reminder:1',
      createOnlySourceRef: APPOINTMENT_SOURCE_REF_A,
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

  it('keeps each create-only owner bound to its source when later input joins and results replay', async () => {
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
    const createRequest = (input: {
      instructions: string
      sourceRef: string
      title: string
    }) => readToolRequest('automation', {
      action: 'save',
      createOnly: true,
      createOnlyEffectKey: 'appointment-reminder:1',
      createOnlySourceRef: input.sourceRef,
      instructions: input.instructions,
      schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
      tags: ['appointment-reminder'],
      title: input.title,
    })
    let acceptedInputIds = [APPOINTMENT_INPUT_A]
    let inboundMailboxItemIds = ['mailbox-appointment-a']
    const hostedToolContext = createHostedToolContext({
      automationTool,
      currentUserActionScope: () => ({
        acceptedInputIds,
        conversationId: 'conversation-appointment',
        conversationScope: 'direct',
        inboundMailboxItemIds,
        originSessionId: 'session-appointment',
        recipientKey: 'recipient-appointment',
      }),
    })

    const requestA = createRequest({
      instructions: 'Send the Midtown appointment reminder.',
      sourceRef: APPOINTMENT_SOURCE_REF_A,
      title: 'Midtown appointment on August 12 at 9:30 AM',
    })
    if (!requestA) {
      throw new Error('Expected the first create-only automation request.')
    }
    // The write result is intentionally discarded to model commit success with
    // a lost provider result before another accepted input joins this turn.
    await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: requestA,
    })

    acceptedInputIds = [APPOINTMENT_INPUT_A, APPOINTMENT_INPUT_B]
    inboundMailboxItemIds = ['mailbox-appointment-a', 'mailbox-appointment-b']
    const regeneratedRequestA = createRequest({
      instructions: 'Regenerated copy for the Midtown reminder.',
      sourceRef: APPOINTMENT_SOURCE_REF_A,
      title: 'Regenerated Midtown appointment title',
    })
    if (!regeneratedRequestA) {
      throw new Error('Expected a regenerated create-only automation request.')
    }
    await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: regeneratedRequestA,
    })
    const requestB = createRequest({
      instructions: 'Send the Lakeside appointment reminder.',
      sourceRef: APPOINTMENT_SOURCE_REF_B,
      title: 'Lakeside appointment on August 12 at 3 PM',
    })
    if (!requestB) {
      throw new Error('Expected a second create-only automation request.')
    }
    await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: requestB,
    })

    acceptedInputIds = [APPOINTMENT_INPUT_B, APPOINTMENT_INPUT_A]
    inboundMailboxItemIds = ['mailbox-appointment-b', 'mailbox-appointment-a']
    for (const request of [requestA, requestB]) {
      await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 0,
        progressDelivery: null,
        request,
      })
    }

    const keyA = automationRequest.mock.calls[0]?.[1]?.createOnlyReplayKey
    const replayKeyA = automationRequest.mock.calls[1]?.[1]?.createOnlyReplayKey
    const keyB = automationRequest.mock.calls[2]?.[1]?.createOnlyReplayKey
    const recomposedKeyA = automationRequest.mock.calls[3]?.[1]?.createOnlyReplayKey
    const recomposedKeyB = automationRequest.mock.calls[4]?.[1]?.createOnlyReplayKey
    expect(keyA).toMatch(/^automation_create_[a-f0-9]{64}$/u)
    expect(replayKeyA).toBe(keyA)
    expect(recomposedKeyA).toBe(keyA)
    expect(keyB).toMatch(/^automation_create_[a-f0-9]{64}$/u)
    expect(recomposedKeyB).toBe(keyB)
    expect(keyB).not.toBe(keyA)
    for (const [request] of automationRequest.mock.calls) {
      expect(request).not.toHaveProperty('createOnlySourceRef')
    }

    const unknownSourceRequest = createRequest({
      instructions: 'Do not accept an unjournaled source reference.',
      sourceRef: createAssistantAppointmentReminderSourceRef(`ain_${'c'.repeat(32)}`),
      title: 'Unjournaled appointment',
    })
    if (!unknownSourceRequest) {
      throw new Error('Expected the unjournaled source request to parse.')
    }
    const unknownSourceResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: unknownSourceRequest,
    })
    expect(unknownSourceResult.rpcResult.success).toBe(false)
    expect(automationRequest).toHaveBeenCalledTimes(5)
  })

  it('authorizes trusted correction lineage without trusting a cross-actor target', async () => {
    const correctionInputId = `ain_${'c'.repeat(32)}`
    const forgedCorrectionInputId = `ain_${'d'.repeat(32)}`
    const conversation = {
      accountId: 'account-1',
      actorId: 'actor-1',
      actorIsSelf: false,
      source: 'linq',
      threadId: 'thread-1',
      threadIsDirect: true,
    }
    const ordinaryMetadata = {
      externalThreadRouteAuthorityPresent: false,
      kind: 'linq' as const,
      partCount: 1,
      reactionEligible: false,
      replyToMessageId: null,
      service: 'iMessage',
    }
    const events = new Map([
      [APPOINTMENT_INPUT_A, {
        conversation,
        inputId: APPOINTMENT_INPUT_A,
        sourceMetadata: ordinaryMetadata,
      }],
      [correctionInputId, {
        conversation,
        inputId: correctionInputId,
        sourceMetadata: {
          ...ordinaryMetadata,
          editedSourceInputId: APPOINTMENT_INPUT_A,
          editedTextPartIndex: 0,
        },
      }],
      [forgedCorrectionInputId, {
        conversation: { ...conversation, actorId: 'actor-2' },
        inputId: forgedCorrectionInputId,
        sourceMetadata: {
          ...ordinaryMetadata,
          editedSourceInputId: APPOINTMENT_INPUT_A,
          editedTextPartIndex: 0,
        },
      }],
    ])

    await expect(resolveAssistantAppointmentReminderSourceInputIds({
      acceptedInputIds: [correctionInputId],
      readInputEvent: async (inputId) => events.get(inputId) ?? null,
    })).resolves.toEqual([correctionInputId, APPOINTMENT_INPUT_A])
    await expect(resolveAssistantAppointmentReminderSourceInputIds({
      acceptedInputIds: [forgedCorrectionInputId],
      readInputEvent: async (inputId) => events.get(inputId) ?? null,
    })).resolves.toEqual([forgedCorrectionInputId])
  })

  it('keeps a trusted correction on the original replay scope and separates genuine additions', async () => {
    const correctionInputId = `ain_${'c'.repeat(32)}`
    const correctionSourceRef =
      createAssistantAppointmentReminderSourceRef(correctionInputId)
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
    let acceptedInputIds = [APPOINTMENT_INPUT_A]
    let sourceInputIds = [APPOINTMENT_INPUT_A]
    const hostedToolContext = createHostedToolContext({
      automationTool: { request: automationRequest },
      currentAppointmentReminderSourceInputIds: async () => sourceInputIds,
      currentUserActionScope: () => ({
        acceptedInputIds,
        conversationId: 'conversation-appointment',
        conversationScope: 'direct',
        inboundMailboxItemIds: [],
        originSessionId: 'session-appointment',
        recipientKey: 'recipient-appointment',
      }),
    })
    const createRequest = (sourceRef: string) => readToolRequest('automation', {
      action: 'save',
      createOnly: true,
      createOnlyEffectKey: 'appointment-reminder:1',
      createOnlySourceRef: sourceRef,
      instructions: 'Send the appointment reminder.',
      schedule: { at: '2026-08-12T00:00:00.000Z', kind: 'at' },
      title: 'Appointment reminder',
    })
    const initialRequest = createRequest(APPOINTMENT_SOURCE_REF_A)
    if (!initialRequest) {
      throw new Error('Expected the initial appointment request.')
    }
    await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext,
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: initialRequest,
    })

    acceptedInputIds = [correctionInputId]
    sourceInputIds = [correctionInputId, APPOINTMENT_INPUT_A]
    const correctionRequest = createRequest(APPOINTMENT_SOURCE_REF_A)
    const addedAppointmentRequest = createRequest(correctionSourceRef)
    if (!correctionRequest || !addedAppointmentRequest) {
      throw new Error('Expected correction appointment requests.')
    }
    for (const request of [correctionRequest, addedAppointmentRequest]) {
      await executeMurphDynamicToolRequest({
        env: {},
        fetchImpl: fetch,
        hostedToolContext,
        nextUsageOrdinal: () => 0,
        progressDelivery: null,
        request,
      })
    }

    const originalKey = automationRequest.mock.calls[0]?.[1]?.createOnlyReplayKey
    const correctionKey = automationRequest.mock.calls[1]?.[1]?.createOnlyReplayKey
    const addedKey = automationRequest.mock.calls[2]?.[1]?.createOnlyReplayKey
    expect(correctionKey).toBe(originalKey)
    expect(addedKey).toMatch(/^automation_create_[a-f0-9]{64}$/u)
    expect(addedKey).not.toBe(originalKey)
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
  currentAppointmentReminderSourceInputIds?:
    AssistantHostedToolContext['currentAppointmentReminderSourceInputIds']
  currentUserActionScope?: AssistantHostedToolContext['currentUserActionScope']
  deviceTool?: AssistantHostedToolContext['deviceTool']
}): AssistantHostedToolContext {
  return {
    automationTool: input.automationTool ?? null,
    computerToolsAvailable: false,
    currentAppointmentReminderSourceInputIds:
      input.currentAppointmentReminderSourceInputIds
      ?? (async () => input.currentUserActionScope?.()?.acceptedInputIds ?? []),
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
