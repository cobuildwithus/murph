import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from 'vitest'
import type { AssistantHostedAutomationToolRequest } from '../src/assistant/execution-context.js'

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
  it('takes automation accepted inputs only from the trusted current host scope', async () => {
    const modelArguments = { action: 'save', title: 'Daily stretch', instructions: 'Stretch gently.',
      schedule: { kind: 'dailyLocal', localTime: '09:00', timeZone: 'UTC' },
      acceptedInputIds: ['ain_model_forged'] }
    const request = readToolRequest('automation', modelArguments)
    expect(request).toMatchObject({ kind: 'invalid-automation-arguments' })
    const { acceptedInputIds: _forged, ...validArguments } = modelArguments
    const parsed = readToolRequest('automation', validArguments)
    if (!parsed || parsed.kind !== 'automation') throw new Error('Expected automation request.')
    expect(parsed.request).not.toHaveProperty('acceptedInputIds')
    const automationTool = { request: vi.fn(async () => ({
      action: 'save' as const, automationId: 'automation_synthetic', created: true,
      effectiveTimeZone: 'UTC', lookupId: 'synthetic', routeBinding: 'current_conversation' as const,
      schedule: { kind: 'dailyLocal' as const, localTime: '09:00', timeZone: 'UTC' }, status: 'active' as const,
      occurrenceProjection: { status: 'resolved' as const, nextOccurrenceAt: null }, updatedAt: '2030-01-15T10:00:00.000Z',
    })) }
    const result = await executeMurphDynamicToolRequest({ env: {}, fetchImpl: fetch,
      nextUsageOrdinal: () => 0, progressDelivery: null, request: parsed,
      hostedToolContext: { ...createHostedToolContext({ automationTool }), currentUserActionScope: () => ({
        acceptedInputIds: ['ain_host_owned'], conversationId: 'synthetic-conversation', conversationScope: 'direct',
        inboundMailboxItemIds: ['synthetic-mailbox'], originSessionId: 'synthetic-session', recipientKey: null,
      }) },
    })
    expect(result.rpcResult.success).toBe(true)
    expect(automationTool.request).toHaveBeenCalledWith(parsed.request, { signal: null, acceptedInputIds: ['ain_host_owned'] })
    expect(JSON.stringify(automationTool.request.mock.calls)).not.toContain('ain_model_forged')
  })

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
  })

  it('admits the documented group newsletter stable recipe through the parser', () => {
    expect(readToolRequest('automation', {
      action: 'save',
      continuityPolicy: 'fresh',
      instructions: 'Open and follow the group newsletter skill.',
      schedule: {
        expression: '0 9 * * 0',
        kind: 'cron',
        timeZone: 'America/New_York',
      },
      slug: 'group-health-newsletter',
      title: 'Weekly health',
    })).toMatchObject({
      kind: 'automation',
      request: {
        action: 'save',
        slug: 'group-health-newsletter',
      },
    })
  })

  it('anchors relative one-shot days to accepted input across a named-zone midnight', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2031-02-15T10:00:00.100Z'))
      expect(readToolRequest('automation', {
        action: 'save',
        instructions: 'Send the reminder tonight.',
        schedule: {
          kind: 'at',
          localAt: {
            relativeDay: 'today',
            time: '23:20',
            timeZone: 'Pacific/Honolulu',
          },
        },
        title: 'Tonight reminder',
      }, referenceWindow('2031-02-15T09:59:59.900Z'))).toEqual({
        kind: 'automation',
        request: {
          action: 'save',
          instructions: 'Send the reminder tonight.',
          schedule: {
            at: '2031-02-15T09:20:00.000Z',
            kind: 'at',
          },
          title: 'Tonight reminder',
        },
      })
      expect(readToolRequest('automation', {
        action: 'save',
        instructions: 'Send the reminder tomorrow.',
        schedule: {
          kind: 'at',
          localAt: {
            relativeDay: 'tomorrow',
            time: '23:20',
            timeZone: 'Pacific/Honolulu',
          },
        },
        title: 'Tomorrow reminder',
      }, referenceWindow('2031-02-15T09:59:59.900Z'))).toMatchObject({
        kind: 'automation',
        request: {
          schedule: {
            at: '2031-02-16T09:20:00.000Z',
            kind: 'at',
          },
        },
      })
      expect(readToolRequest('automation', {
        action: 'save',
        instructions: 'Do not guess the relative date.',
        schedule: {
          kind: 'at',
          localAt: {
            relativeDay: 'today',
            time: '23:20',
            timeZone: 'Pacific/Honolulu',
          },
        },
        title: 'Unanchored reminder',
      }, null)).toMatchObject({
        kind: 'invalid-automation-arguments',
        safeFailureCode: 'local_at_reference_unavailable',
      })
      expect(readToolRequest('automation', {
        action: 'save',
        instructions: 'Ask for an explicit calendar date.',
        schedule: {
          kind: 'at',
          localAt: {
            relativeDay: 'today',
            time: '23:20',
            timeZone: 'Pacific/Honolulu',
          },
        },
        title: 'Ambiguous accepted input date',
      }, {
        earliestAt: '2031-02-15T09:59:59.900Z',
        latestAt: '2031-02-15T10:00:00.100Z',
      })).toMatchObject({
        kind: 'invalid-automation-arguments',
        safeFailureCode: 'local_at_reference_spans_dates',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns the host-resolved date for post-midnight gap and fold recovery', async () => {
    const gapRequest = readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the reminder tomorrow.',
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: '02:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'Spring reminder',
    }, referenceWindow('2026-03-08T04:59:00.000Z'))
    if (gapRequest?.kind !== 'invalid-automation-arguments') {
      throw new TypeError('Expected a daylight-saving gap failure.')
    }
    expect(gapRequest).toMatchObject({
      localAtTargetLabel: 'Spring reminder',
      resolvedLocalDate: '2026-03-08',
      safeFailureCode: 'local_at_gap',
    })
    expect(gapRequest.localAtTargetKey).toMatch(/^[a-f0-9]{64}$/u)
    const sameTitleGapRequest = readToolRequest('automation', {
      action: 'save',
      instructions: 'Send a different reminder tomorrow.',
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: '02:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'Spring reminder',
    }, referenceWindow('2026-03-08T04:59:00.000Z'))
    if (sameTitleGapRequest?.kind !== 'invalid-automation-arguments') {
      throw new TypeError('Expected a second daylight-saving gap failure.')
    }
    expect(sameTitleGapRequest.localAtTargetKey).not.toBe(
      gapRequest.localAtTargetKey,
    )
    const gapResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({}),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: gapRequest,
    })
    expect(gapResult.rpcResult.contentItems[0]?.text).toContain(
      `schedule.localAt.date=2026-03-08 instead of relativeDay and localAtRecoveryKey=${gapRequest.localAtTargetKey}`,
    )
    const gapRecoveryRequest = readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the reminder tomorrow.',
      localAtRecoveryKey: gapRequest.localAtTargetKey,
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '03:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'Spring reminder',
    }, {
      earliestAt: '2026-03-08T04:59:00.000Z',
      latestAt: '2026-03-08T05:01:00.000Z',
    })
    expect(gapRecoveryRequest).toMatchObject({
      kind: 'automation',
      localAtRecovery: {
        recoveryKey: gapRequest.localAtTargetKey,
        resolvedLocalDate: '2026-03-08',
      },
      request: {
        action: 'save',
        schedule: { at: '2026-03-08T07:30:00.000Z', kind: 'at' },
      },
    })
    expect(gapRecoveryRequest).not.toHaveProperty(
      'request.localAtRecoveryKey',
    )
    const repeatedGapRequest = readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the renamed reminder tomorrow.',
      localAtRecoveryKey: gapRequest.localAtTargetKey,
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '02:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'Morning meds',
    })
    expect(repeatedGapRequest).toMatchObject({
      kind: 'invalid-automation-arguments',
      localAtRecovery: {
        recoveryKey: gapRequest.localAtTargetKey,
        resolvedLocalDate: '2026-03-08',
      },
      localAtTargetKey: gapRequest.localAtTargetKey,
      localAtTargetLabel: 'Morning meds',
      resolvedLocalDate: '2026-03-08',
      safeFailureCode: 'local_at_gap',
    })

    const foldRequest = readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the reminder tomorrow.',
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: '01:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'Fall reminder',
    }, referenceWindow('2026-11-01T03:59:00.000Z'))
    if (foldRequest?.kind !== 'invalid-automation-arguments') {
      throw new TypeError('Expected a daylight-saving fold failure.')
    }
    expect(foldRequest).toMatchObject({
      localAtTargetLabel: 'Fall reminder',
      resolvedLocalDate: '2026-11-01',
      safeFailureCode: 'local_at_fold',
    })
    expect(foldRequest.localAtTargetKey).toMatch(/^[a-f0-9]{64}$/u)
    const foldResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({}),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: foldRequest,
    })
    expect(foldResult.rpcResult.contentItems[0]?.text).toContain(
      `schedule.localAt.date=2026-11-01, schedule.localAt.fold, and localAtRecoveryKey=${foldRequest.localAtTargetKey} instead of relativeDay`,
    )
    const foldRecoveryRequest = readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the reminder tomorrow.',
      localAtRecoveryKey: foldRequest.localAtTargetKey,
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-11-01',
          fold: 'later',
          time: '01:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'Fall reminder',
    }, {
      earliestAt: '2026-11-01T03:59:00.000Z',
      latestAt: '2026-11-01T04:01:00.000Z',
    })
    expect(foldRecoveryRequest).toMatchObject({
      kind: 'automation',
      localAtRecovery: {
        recoveryKey: foldRequest.localAtTargetKey,
        resolvedLocalDate: '2026-11-01',
      },
      request: {
        action: 'save',
        schedule: { at: '2026-11-01T06:30:00.000Z', kind: 'at' },
      },
    })
    expect(foldRecoveryRequest).not.toHaveProperty(
      'request.localAtRecoveryKey',
    )
  })

  it('parses DST recovery dismissal as root-turn-only state', async () => {
    const recoveryKey = 'a'.repeat(64)
    const dismissal = readToolRequest('automation', {
      action: 'dismiss_local_at_recovery',
      localAtRecoveryKey: recoveryKey,
      resolvedLocalDate: '2026-03-08',
    })
    expect(dismissal).toEqual({
      kind: 'automation-local-at-recovery-dismissal',
      recoveryKey,
      resolvedLocalDate: '2026-03-08',
    })
    expect(readToolRequest('automation', {
      action: 'dismiss_local_at_recovery',
      localAtRecoveryKey: recoveryKey,
      resolvedLocalDate: 'March 8',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'dismiss_local_at_recovery',
      localAtRecoveryKey: 'not-a-recovery-key',
      resolvedLocalDate: '2026-03-08',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    if (dismissal?.kind !== 'automation-local-at-recovery-dismissal') {
      throw new TypeError('Expected a parsed recovery dismissal.')
    }
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({}),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: dismissal,
    })
    expect(result.rpcResult).toEqual({
      contentItems: [{
        text:
          'local-time recovery dismissal is unavailable outside the active root turn',
        type: 'inputText',
      }],
      success: false,
    })
  })

  it('binds DST recovery only to the echoed root-turn correlation', () => {
    const failedPatch = readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      lookup: 'medication-reminder',
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: '02:30',
          timeZone: 'America/New_York',
        },
      },
    }, referenceWindow('2026-03-08T04:59:00.000Z'))
    if (failedPatch?.kind !== 'invalid-automation-arguments') {
      throw new TypeError('Expected a daylight-saving gap failure.')
    }
    expect(failedPatch.localAtTargetLabel).toBe('medication-reminder')

    const matchingRecovery = readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      localAtRecoveryKey: failedPatch.localAtTargetKey,
      lookup: 'medication-reminder',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '03:30',
          timeZone: 'America/New_York',
        },
      },
    })
    const unrelatedRecovery = readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      lookup: 'breakfast-reminder',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '03:30',
          timeZone: 'America/New_York',
        },
      },
    })

    expect(matchingRecovery).toMatchObject({
      kind: 'automation',
      localAtRecovery: {
        recoveryKey: failedPatch.localAtTargetKey,
        resolvedLocalDate: '2026-03-08',
      },
    })
    expect(unrelatedRecovery).toMatchObject({
      kind: 'automation',
    })
    if (
      matchingRecovery?.kind !== 'automation' ||
      unrelatedRecovery?.kind !== 'automation'
    ) {
      throw new TypeError('Expected explicit-date automation recoveries.')
    }
    expect(unrelatedRecovery.localAtRecovery).toBeUndefined()
    expect(readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      localAtRecoveryKey: failedPatch.localAtTargetKey,
      lookup: 'medication-reminder',
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: '03:30',
          timeZone: 'America/New_York',
        },
      },
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
  })

  it.each([
    {
      failedLookup: 'medication-reminder',
      recoveryLookup: 'automation-medication-reminder',
    },
    {
      failedLookup: 'automation-medication-reminder',
      recoveryLookup: 'medication-reminder',
    },
  ])('carries patch DST correlation across mutable canonical lookups', async ({
    failedLookup,
    recoveryLookup,
  }) => {
    const failedPatch = readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      lookup: failedLookup,
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: '02:30',
          timeZone: 'America/New_York',
        },
      },
    }, referenceWindow('2026-03-08T04:59:00.000Z'))
    const recovery = readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      localAtRecoveryKey: failedPatch?.kind === 'invalid-automation-arguments'
        ? failedPatch.localAtTargetKey
        : undefined,
      lookup: recoveryLookup,
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '03:30',
          timeZone: 'America/New_York',
        },
      },
    })
    if (
      failedPatch?.kind !== 'invalid-automation-arguments' ||
      recovery?.kind !== 'automation'
    ) {
      throw new TypeError('Expected a failed patch and explicit-date recovery.')
    }
    expect(recovery.localAtRecovery?.recoveryKey).toBe(
      failedPatch.localAtTargetKey,
    )

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        automationTool: {
          request: async (request) => ({
            action: 'patch',
            automationId: 'automation-medication-reminder',
            created: false,
            effectiveTimeZone: 'America/New_York',
            lookupId: 'medication-reminder',
            occurrenceProjection: {
              nextOccurrenceAt: '2026-03-08T07:30:00.000Z',
              status: 'resolved' as const,
            },
            routeBinding: 'current_conversation',
            schedule: request.action === 'patch' && request.schedule
              ? request.schedule
              : { at: '2026-03-08T07:30:00.000Z', kind: 'at' },
            status: 'active',
            updatedAt: '2026-03-08T05:01:00.000Z',
          }),
        },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: recovery,
    })

    expect(result.rpcResult.success).toBe(true)
  })

  it('keeps recovery correlation private while patching by id', async () => {
    const failedPatch = readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      lookup: 'automation-medication-reminder',
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: '02:30',
          timeZone: 'America/New_York',
        },
      },
    }, referenceWindow('2026-03-08T04:59:00.000Z'))
    const recovery = readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      localAtRecoveryKey: failedPatch?.kind === 'invalid-automation-arguments'
        ? failedPatch.localAtTargetKey
        : undefined,
      lookup: 'automation-medication-reminder',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '03:30',
          timeZone: 'America/New_York',
        },
      },
    })
    if (
      failedPatch?.kind !== 'invalid-automation-arguments' ||
      recovery?.kind !== 'automation'
    ) {
      throw new TypeError('Expected a failed patch and explicit-date recovery.')
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        automationTool: {
          request: async (request) => ({
            action: 'patch',
            automationId: 'automation-medication-reminder',
            created: false,
            effectiveTimeZone: 'America/New_York',
            lookupId: 'morning-meds',
            occurrenceProjection: {
              nextOccurrenceAt: '2026-03-08T07:30:00.000Z',
              status: 'resolved' as const,
            },
            routeBinding: 'current_conversation',
            schedule: request.action === 'patch' && request.schedule
              ? request.schedule
              : { at: '2026-03-08T07:30:00.000Z', kind: 'at' },
            status: 'active',
            updatedAt: '2026-03-08T05:01:00.000Z',
          }),
        },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: recovery,
    })

    expect(result.rpcResult.success).toBe(true)
    expect(recovery.localAtRecovery?.recoveryKey).toBe(
      failedPatch.localAtTargetKey,
    )
  })

  it('carries save recovery correlation into a later versioned patch', async () => {
    const failedSave = readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the medication reminder tomorrow.',
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: '02:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'Medication reminder',
    }, referenceWindow('2026-03-08T04:59:00.000Z'))
    const recoveryPatch = readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      localAtRecoveryKey: failedSave?.kind === 'invalid-automation-arguments'
        ? failedSave.localAtTargetKey
        : undefined,
      lookup: 'automation-medication-reminder',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '03:30',
          timeZone: 'America/New_York',
        },
      },
    })
    if (
      failedSave?.kind !== 'invalid-automation-arguments' ||
      recoveryPatch?.kind !== 'automation'
    ) {
      throw new TypeError('Expected a failed save and explicit-date patch.')
    }
    expect(recoveryPatch.localAtRecovery?.recoveryKey).toBe(
      failedSave.localAtTargetKey,
    )

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        automationTool: {
          request: async (request) => ({
            action: 'patch',
            automationId: 'automation-medication-reminder',
            created: false,
            effectiveTimeZone: 'America/New_York',
            lookupId: 'medication-reminder',
            occurrenceProjection: {
              nextOccurrenceAt: '2026-03-08T07:30:00.000Z',
              status: 'resolved' as const,
            },
            routeBinding: 'current_conversation',
            schedule: request.action === 'patch' && request.schedule
              ? request.schedule
              : { at: '2026-03-08T07:30:00.000Z', kind: 'at' },
            status: 'active',
            updatedAt: '2026-03-08T05:01:00.000Z',
          }),
        },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: recoveryPatch,
    })
    expect(result.rpcResult.success).toBe(true)
  })

  it('accepts localized reminder titles without a separate slug', async () => {
    const localizedRequest = readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the reminder.',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '03:30',
          timeZone: 'America/New_York',
        },
      },
      title: '薬を飲む',
    })
    expect(localizedRequest).toMatchObject({
      kind: 'automation',
      request: {
        action: 'save',
        title: '薬を飲む',
      },
    })
  })

  it('documents canonical automation calls without weakening strict validation', () => {
    for (const schedule of [
      { kind: 'every', everyMs: 3_600_000 },
      {
        kind: 'cron',
        expression: '0 9 * * 1-5',
        timeZone: 'America/Chicago',
      },
      {
        kind: 'dailyLocal',
        localTime: '09:00',
        timeZone: 'America/Chicago',
      },
    ]) {
      expect(readToolRequest('automation', {
        action: 'save',
        instructions: 'Send a short reminder.',
        schedule,
        title: 'Scheduled reminder',
      })).toMatchObject({
        kind: 'automation',
        request: { schedule },
      })
    }

    for (const invalidArguments of [
      {
        action: 'save',
        instructions: 'Send a short reminder.',
        schedule: { kind: 'at', at: '2030-01-15T15:30:00Z' },
        title: 'Scheduled reminder',
      },
      {
        action: 'update',
        lookup: 'scheduled-reminder',
        status: 'paused',
      },
      {
        action: 'patch',
        status: 'paused',
      },
      {
        action: 'patch',
        lookup: 'scheduled-reminder',
        update: { status: 'paused' },
      },
      {
        action: 'save',
        instructions: 'Send a short reminder.',
        schedule: {
          kind: 'cron',
          expression: '0 9 * * 1-5',
          timezone: 'America/Chicago',
        },
        title: 'Scheduled reminder',
      },
      {
        action: 'save',
        instructions: 'Send a short reminder.',
        schedule: {
          kind: 'at',
          at: '2030-01-15T15:30:00Z',
          timeZone: 'America/Chicago',
        },
        title: 'Scheduled reminder',
      },
      {
        action: 'save',
        instructions: 'Send a short reminder.',
        schedule: {
          kind: 'every',
          everyMs: 3_600_000,
          timeZone: 'America/Chicago',
        },
        title: 'Scheduled reminder',
      },
      {
        action: 'save',
        instructions: 'Send a short reminder.',
        schedule: {
          kind: 'dailyLocal',
          localTime: '09:00',
        },
        timeZone: 'America/Chicago',
        title: 'Scheduled reminder',
      },
    ]) {
      expect(readToolRequest('automation', invalidArguments)).toMatchObject({
        kind: 'invalid-automation-arguments',
      })
    }
  })

  it('returns complete automation validation reasons without calling the port', async () => {
    const privateMarker = 'synthetic-private-automation-marker'
    const request = readToolRequest('automation', {
      action: 'inspect',
      lookup: { privateMarker },
    })
    expect(request).toMatchObject({ kind: 'invalid-automation-arguments' })
    if (!request || request.kind !== 'invalid-automation-arguments') {
      throw new Error('Expected invalid automation arguments.')
    }

    const automationRequest = vi.fn(async () => {
      throw new Error('Automation port must not be called for invalid arguments.')
    })
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        automationTool: { request: automationRequest },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })
    const feedback = result.rpcResult.contentItems[0]?.text ?? ''

    expect(result.rpcResult.success).toBe(false)
    expect(feedback).toContain('"error":"invalid_automation_arguments"')
    expect(JSON.parse(feedback)).toMatchObject({
      error: 'invalid_automation_arguments',
      validationIssues: [expect.objectContaining({
        code: 'invalid_type',
        expected: 'string',
        path: ['lookup'],
      })],
    })
    expect(feedback).not.toContain(privateMarker)
    expect(feedback).not.toContain('privateMarker')
    expect(feedback).not.toContain('"received"')
    expect(automationRequest).not.toHaveBeenCalled()
  })

  it('explains paired automation support fields without calling the port', async () => {
    const request = readToolRequest('automation', {
      action: 'save',
      instructions: 'Ask how the weekly check-in went.',
      schedule: {
        kind: 'cron',
        expression: '0 19 * * 0',
        timeZone: 'America/New_York',
      },
      supportKind: 'check_in',
      title: 'Weekly check-in',
    })
    expect(request).toMatchObject({ kind: 'invalid-automation-arguments' })
    if (!request || request.kind !== 'invalid-automation-arguments') {
      throw new Error('Expected invalid automation arguments.')
    }

    const automationRequest = vi.fn(async () => {
      throw new Error('Automation port must not be called for invalid arguments.')
    })
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        automationTool: { request: automationRequest },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })
    const feedback = result.rpcResult.contentItems[0]?.text ?? ''

    expect(JSON.parse(feedback)).toMatchObject({
      error: 'invalid_automation_arguments',
      validationIssues: [expect.objectContaining({
        message: 'Plan-owned support requires supportKind and supportSeriesId together.',
        path: ['supportSeriesId'],
      })],
    })
    expect(automationRequest).not.toHaveBeenCalled()
  })

  it('saves an ordinary hosted weekly check-in without plan-owned support fields', async () => {
    const request = readToolRequest('automation', {
      action: 'save',
      instructions: 'Ask how the weekly check-in went.',
      schedule: {
        kind: 'cron',
        expression: '0 19 * * 0',
        timeZone: 'America/New_York',
      },
      status: 'active',
      title: 'Weekly check-in',
    })
    expect(request).toMatchObject({ kind: 'automation' })
    if (!request || request.kind !== 'automation') {
      throw new Error('Expected a valid ordinary check-in automation request.')
    }

    const automationRequest = vi.fn(async () => ({
      action: 'save' as const,
      automationId: 'automation-weekly-check-in',
      created: true,
      deliveryChannel: 'telegram',
      contextReferences: [],
      effectiveTimeZone: 'America/New_York',
      lookupId: 'weekly-check-in',
      occurrenceProjection: {
        nextOccurrenceAt: '2026-08-31T23:00:00.000Z',
        status: 'resolved' as const,
      },
      path: '/internal/automations/weekly-check-in.md',
      routeBinding: 'current_conversation' as const,
      schedule: {
        kind: 'cron' as const,
        expression: '0 19 * * 0',
        timeZone: 'America/New_York',
      },
      status: 'active' as const,
      updatedAt: '2026-08-24T00:00:00.000Z',
    }))
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        automationTool: { request: automationRequest },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })

    expect(automationRequest).toHaveBeenCalledWith({
      action: 'save',
      instructions: 'Ask how the weekly check-in went.',
      schedule: {
        kind: 'cron',
        expression: '0 19 * * 0',
        timeZone: 'America/New_York',
      },
      status: 'active',
      title: 'Weekly check-in',
    }, { signal: null })
    expect(readResultPayload(result)).toMatchObject({
      action: 'save',
      effectiveTimeZone: 'America/New_York',
      deliveryChannel: 'telegram',
      occurrenceProjection: {
        status: 'resolved',
      },
      schedule: {
        kind: 'cron',
        expression: '0 19 * * 0',
        timeZone: 'America/New_York',
      },
      status: 'active',
    })
    // Binding a save to this conversation is the default and is not repeated.
    expect(readResultPayload(result)).not.toHaveProperty('routeBinding')
  })

  it('keeps privileged and generic execution fields out of both schemas', () => {
    const propertyKeys = new Set([
      ...collectJsonSchemaPropertyKeys(MURPH_AUTOMATION_TOOL.inputSchema),
      ...collectJsonSchemaPropertyKeys(MURPH_DEVICE_TOOL.inputSchema),
    ])
    for (const forbidden of [
      'argv',
      'automationId',
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
      action: 'inspect',
      lookup: 'evening-wind-down',
    })).toEqual({
      kind: 'automation',
      request: {
        action: 'inspect',
        lookup: 'evening-wind-down',
      },
    })

    expect(readToolRequest('automation', {
      action: 'save',
      activeUntil: '2026-08-01T00:00:00.000Z',
      contextReferences: [
        {
          entityKind: 'workout_format',
          entityId: 'wfmt_01JQ8PWXP5A68SQM1W0GYM41WA',
        },
        {
          entityKind: 'experiment',
          entityId: 'exp_01JQ8PWXP5A68SQM1W0GYM41WB',
        },
      ],
      instructions: 'Send a short reminder to wind down.',
      plannedOccurrenceOffsetMs: 900_000,
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
        contextReferences: [
          {
            entityKind: 'workout_format',
            entityId: 'wfmt_01JQ8PWXP5A68SQM1W0GYM41WA',
          },
          {
            entityKind: 'experiment',
            entityId: 'exp_01JQ8PWXP5A68SQM1W0GYM41WB',
          },
        ],
        instructions: 'Send a short reminder to wind down.',
        plannedOccurrenceOffsetMs: 900_000,
        schedule: { kind: 'dailyLocal', localTime: '22:30' },
        status: 'paused',
        supportKind: 'reminder',
        supportSeriesId: 'habit:sleep-wind-down',
        title: 'Evening wind-down',
      },
    })

    expect(readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the one-shot reminder.',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2031-02-14',
          time: '23:20',
          timeZone: 'Pacific/Honolulu',
        },
      },
      title: 'One-shot reminder',
    })).toMatchObject({
      kind: 'automation',
      request: {
        action: 'save',
        instructions: 'Send the one-shot reminder.',
        schedule: {
          at: '2031-02-15T09:20:00.000Z',
          kind: 'at',
        },
        title: 'One-shot reminder',
      },
    })
    expect(readToolRequest('automation', {
      action: 'save',
      instructions: 'Reject two date sources.',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2031-02-14',
          relativeDay: 'today',
          time: '23:20',
          timeZone: 'Pacific/Honolulu',
        },
      },
      title: 'Conflicting date reminder',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'save',
      instructions: 'Reject a missing date source.',
      schedule: {
        kind: 'at',
        localAt: {
          time: '23:20',
          timeZone: 'Pacific/Honolulu',
        },
      },
      title: 'Missing date reminder',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'save',
      instructions: 'Send an untrusted exact reminder.',
      schedule: {
        at: '2031-02-15T09:20:00.000Z',
        kind: 'at',
      },
      title: 'Untrusted exact reminder',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2031-02-14T12:00:00.000Z',
      lookup: 'synthetic-reminder',
      schedule: {
        at: '2031-02-15T09:20:00.000Z',
        kind: 'at',
      },
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'save',
      automationId: 'model-selected-id',
      instructions: 'Replace an existing reminder.',
      schedule: { kind: 'dailyLocal', localTime: '09:00' },
      title: 'Replacement reminder',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the nonexistent one-shot reminder.',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '02:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'DST gap reminder',
    })).toMatchObject({
      kind: 'invalid-automation-arguments',
      resolvedLocalDate: '2026-03-08',
      safeFailureCode: 'local_at_gap',
    })
    expect(readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the ambiguous one-shot reminder.',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-11-01',
          time: '01:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'DST fold reminder',
    })).toMatchObject({
      kind: 'invalid-automation-arguments',
      resolvedLocalDate: '2026-11-01',
      safeFailureCode: 'local_at_fold',
    })
    expect(readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the timezone-safe one-shot reminder.',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2031-02-14',
          time: '08:00',
          timeZone: 'Not/A_Timezone',
        },
      },
      title: 'Invalid timezone reminder',
    })).toMatchObject({
      kind: 'invalid-automation-arguments',
      safeFailureCode: 'local_at_invalid_timezone',
    })
    expect(readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the earlier one-shot reminder.',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-11-01',
          fold: 'earlier',
          time: '01:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'Earlier DST fold reminder',
    })).toMatchObject({
      kind: 'automation',
      request: { schedule: { at: '2026-11-01T05:30:00.000Z', kind: 'at' } },
    })
    expect(readToolRequest('automation', {
      action: 'save',
      instructions: 'Send the later one-shot reminder.',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-11-01',
          fold: 'later',
          time: '01:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'Later DST fold reminder',
    })).toMatchObject({
      kind: 'automation',
      request: { schedule: { at: '2026-11-01T06:30:00.000Z', kind: 'at' } },
    })
    expect(readToolRequest('automation', {
      action: 'save',
      instructions: 'Send one plan-owned reminder.',
      schedule: { kind: 'dailyLocal', localTime: '22:30' },
      supportKind: 'reminder',
      title: 'Unowned plan reminder',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'save',
      instructions: 'Send one plan-owned reminder.',
      schedule: { kind: 'dailyLocal', localTime: '22:30' },
      supportSeriesId: 'experiment:exp_synthetic_owner',
      title: 'Untyped plan reminder',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
    expect(readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-08-10T00:00:00.000Z',
      lookup: 'evening-wind-down',
      supportKind: 'reminder',
    })).toEqual({
      kind: 'automation',
      request: {
        action: 'patch',
        expectedUpdatedAt: '2026-08-10T00:00:00.000Z',
        lookup: 'evening-wind-down',
        supportKind: 'reminder',
      },
    })
    expect(readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-08-10T00:00:00.000Z',
      lookup: 'evening-wind-down',
      supportSeriesId: 'habit:sleep-wind-down',
    })).toEqual({
      kind: 'automation',
      request: {
        action: 'patch',
        expectedUpdatedAt: '2026-08-10T00:00:00.000Z',
        lookup: 'evening-wind-down',
        supportSeriesId: 'habit:sleep-wind-down',
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
      expectedUpdatedAt: '2026-08-10T00:00:00.000Z',
      lookup: 'evening-wind-down',
      retargetToCurrentConversation: true,
      status: 'active',
    })).toEqual({
      kind: 'automation',
      request: {
        action: 'patch',
        expectedUpdatedAt: '2026-08-10T00:00:00.000Z',
        lookup: 'evening-wind-down',
        retargetToCurrentConversation: true,
        status: 'active',
      },
    })
    expect(readToolRequest('automation', {
      action: 'patch',
      lookup: 'evening-wind-down',
      status: 'archived',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })

    expect(readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-08-10T00:00:00.000Z',
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
      expectedUpdatedAt: '2026-08-10T00:00:00.000Z',
      lookup: 'evening-wind-down',
      token: 'not-allowed',
    })).toMatchObject({ kind: 'invalid-automation-arguments' })
  })

  it('uses accountId for bounded device actions and rejects credentials', () => {
    expect(readToolRequest('device', {
      action: 'configure_no_data_outreach', mode: 'off', sourceProvider: 'apple_health_kit',
    })).toMatchObject({ kind: 'device' })
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
      accountId: 'device-account-1',
      action: 'reconcile',
      token: 'not-allowed',
    })).toMatchObject({ kind: 'invalid-device-arguments' })
    expect(readToolRequest('device', {
      action: 'connect',
      password: 'not-allowed',
      provider: 'whoop',
      token: 'not-allowed',
    })).toMatchObject({ kind: 'invalid-device-arguments' })
    expect(readToolRequest('device', {
      action: 'configure_no_data_outreach',
      afterDays: 10,
      mode: 'after_days',
      sourceProvider: 'garmin',
    })).toEqual({
      kind: 'device',
      request: {
        action: 'configure_no_data_outreach',
        afterDays: 10,
        mode: 'after_days',
        sourceProvider: 'garmin',
      },
    })
    expect(readToolRequest('device', {
      action: 'configure_no_data_outreach',
      mode: 'off',
      sourceProvider: 'garmin',
    })).toMatchObject({ kind: 'device' })
    for (const afterDays of [4, 31]) {
      expect(readToolRequest('device', {
        action: 'configure_no_data_outreach',
        afterDays,
        mode: 'after_days',
        sourceProvider: 'garmin',
      })).toMatchObject({ kind: 'invalid-device-arguments' })
    }
  })

  it('passes a stable skill recipe key through the parser and injected port', async () => {
    const abortController = new AbortController()
    const automationTool = {
      request: vi.fn(async () => ({
        action: 'save' as const,
        automationId: 'automation-1',
        created: true,
        contextReferences: [
          {
            entityKind: 'workout_format',
            entityId: 'wfmt_01JQ8PWXP5A68SQM1W0GYM41WA',
          },
        ],
        effectiveTimeZone: 'America/Chicago',
        lookupId: 'evening-wind-down',
        occurrenceProjection: {
          nextOccurrenceAt: null,
          status: 'resolved' as const,
        },
        path: '/internal/automations/evening-wind-down.md',
        routeBinding: 'current_conversation' as const,
        schedule: {
          kind: 'dailyLocal' as const,
          localTime: '22:30',
          timeZone: 'America/Chicago',
        },
        status: 'paused' as const,
        updatedAt: '2026-08-10T00:00:00.000Z',
      })),
    }
    const request = readToolRequest('automation', {
      action: 'save',
      contextReferences: [
        {
          entityKind: 'workout_format',
          entityId: 'wfmt_01JQ8PWXP5A68SQM1W0GYM41WA',
        },
      ],
      instructions: 'Send a short reminder to wind down.',
      schedule: {
        kind: 'dailyLocal',
        localTime: '22:30',
        timeZone: 'America/Chicago',
      },
      slug: 'experiment-session-support-evening-session-1',
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
      contextReferences: [
        {
          entityKind: 'workout_format',
          entityId: 'wfmt_01JQ8PWXP5A68SQM1W0GYM41WA',
        },
      ],
      instructions: 'Send a short reminder to wind down.',
      schedule: {
        kind: 'dailyLocal',
        localTime: '22:30',
        timeZone: 'America/Chicago',
      },
      slug: 'experiment-session-support-evening-session-1',
      status: 'paused',
      title: 'Evening wind-down',
    }, { signal: abortController.signal })
    expect(readResultPayload(result)).toEqual({
      action: 'save',
      automationId: 'automation-1',
      created: true,
      contextReferences: [
        {
          entityKind: 'workout_format',
          entityId: 'wfmt_01JQ8PWXP5A68SQM1W0GYM41WA',
        },
      ],
      effectiveTimeZone: 'America/Chicago',
      occurrenceProjection: {
        nextOccurrenceAt: null,
        status: 'resolved' as const,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '22:30',
        timeZone: 'America/Chicago',
      },
      status: 'paused',
      updatedAt: '2026-08-10T00:00:00.000Z',
    })
    const mismatchedTool = {
      request: vi.fn(async () => ({
        action: 'patch' as const,
        automationId: 'automation-1',
        created: false,
        effectiveTimeZone: 'America/Chicago',
        lookupId: 'evening-wind-down',
        occurrenceProjection: {
          nextOccurrenceAt: '2026-08-10T03:30:00.000Z',
          status: 'resolved' as const,
        },
        routeBinding: 'preserved' as const,
        schedule: {
          kind: 'dailyLocal' as const,
          localTime: '22:30',
          timeZone: 'America/Chicago',
        },
        status: 'active' as const,
        updatedAt: '2026-08-10T00:01:00.000Z',
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

  it('executes read-only automation inspection through the injected port', async () => {
    const automationTool = {
      request: vi.fn(async () => ({
        action: 'inspect' as const,
        executionInspection: { status: 'unavailable' as const },
        automationId: 'automation-1',
        effectiveTimeZone: 'America/Chicago',
        lookupId: 'evening-wind-down',
        occurrenceProjection: {
          nextOccurrenceAt: '2026-08-11T03:30:00.000Z',
          status: 'resolved' as const,
        },
        routeBinding: 'preserved' as const,
        schedule: {
          kind: 'dailyLocal' as const,
          localTime: '22:30',
          timeZone: 'America/Chicago',
        },
        status: 'active' as const,
        updatedAt: '2026-08-10T00:00:00.000Z',
      })),
    }
    const request = readToolRequest('automation', {
      action: 'inspect',
      lookup: 'evening-wind-down',
    })
    if (!request) {
      throw new Error('Expected an automation inspection request.')
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
      action: 'inspect',
      lookup: 'evening-wind-down',
    }, { signal: null })
    expect(readResultPayload(result)).toEqual({
      action: 'inspect',
      executionInspection: { status: 'unavailable' },
      automationId: 'automation-1',
      effectiveTimeZone: 'America/Chicago',
      occurrenceProjection: {
        nextOccurrenceAt: '2026-08-11T03:30:00.000Z',
        status: 'resolved' as const,
      },
      schedule: {
        kind: 'dailyLocal',
        localTime: '22:30',
        timeZone: 'America/Chicago',
      },
      status: 'active',
      updatedAt: '2026-08-10T00:00:00.000Z',
    })
  })

  it.each([false, true])('preserves complete model-review readbacks (managed=%s)', async managed => {
    const response = {
      action: 'inspect' as const, view: 'model_review' as const,
      automationId: 'automation_synthetic', lookupId: 'synthetic', managed,
      assistantTargetOverride: { model: 'gpt-6.1-sol' as const, reasoningEffort: 'medium' as const },
      contextReferences: [], title: 'Synthetic review', routeBinding: 'preserved' as const,
      schedule: { kind: 'dailyLocal' as const, localTime: '09:00', timeZone: 'UTC' },
      status: 'active' as const, updatedAt: '2026-10-01T00:00:00.000Z',
      ...(managed ? { instructionsOmitted: 'managed_model_preserved' as const }
        : { instructions: 'Keep complete instructions. '.repeat(1500) }),
    }
    const automationTool = { request: vi.fn(async () => response) }
    const request = readToolRequest('automation', {
      action: 'inspect', lookup: 'automation_synthetic', view: 'model_review',
    })
    if (!request) throw new Error('Expected model-review request.')
    const result = await executeMurphDynamicToolRequest({
      env: {}, fetchImpl: fetch, hostedToolContext: createHostedToolContext({ automationTool }),
      nextUsageOrdinal: () => 0, progressDelivery: null, request,
    })
    expect(automationTool.request).toHaveBeenCalledWith({
      action: 'inspect', lookup: 'automation_synthetic', view: 'model_review',
    }, { signal: null })
    // The weekly usage optimizer needs managed, the override and references
    // even when false or empty; only the always-preserved binding is omitted.
    const { lookupId: _lookupId, routeBinding: _routeBinding, ...expected } = response
    expect(readResultPayload(result)).toEqual(expected)
    expect(readResultPayload(result)).toMatchObject({ managed, contextReferences: [] })
  })

  it('batches model reviews once per id with whole-record byte bounds and explicit omissions', async () => {
    const automationTool = { request: vi.fn(async (request: AssistantHostedAutomationToolRequest) => {
      if (request.action !== 'inspect') throw new Error('Only inspection is allowed.')
      if (request.lookup === 'missing') throw Object.assign(new Error('Missing'), { code: 'automation_not_found' })
      return {
        action: 'inspect' as const, view: 'model_review' as const,
        automationId: request.lookup, lookupId: request.lookup, managed: false,
        assistantTargetOverride: null, instructions: request.lookup === 'large' ? '漢'.repeat(20_000) : 'Keep this complete cue.',
        contextReferences: [], title: 'Synthetic review', routeBinding: 'preserved' as const,
        schedule: { kind: 'dailyLocal' as const, localTime: '09:00', timeZone: 'UTC' },
        status: 'active' as const, updatedAt: '2026-10-01T00:00:00.000Z',
      }
    }) }
    const request = readToolRequest('automation', {
      action: 'inspect_models', lookups: ['small', 'large', 'missing', 'small'],
    })
    if (!request) throw new Error('Expected model-review batch.')
    const result = await executeMurphDynamicToolRequest({
      env: {}, fetchImpl: fetch, hostedToolContext: createHostedToolContext({ automationTool }),
      nextUsageOrdinal: () => 0, progressDelivery: null, request,
    })
    expect(automationTool.request.mock.calls.map(([request]) => request)).toEqual([
      { action: 'inspect', view: 'model_review', lookup: 'small' },
      { action: 'inspect', view: 'model_review', lookup: 'large' },
      { action: 'inspect', view: 'model_review', lookup: 'missing' },
    ])
    const payload = readResultPayload(result)
    expect(payload).toEqual({ action: 'inspect_models', requiresIndividualInspection: ['large'],
      results: [{
        automationId: 'small', assistantTargetOverride: null, managed: false, contextReferences: [],
        instructions: 'Keep this complete cue.', title: 'Synthetic review',
        schedule: { kind: 'dailyLocal', localTime: '09:00', timeZone: 'UTC' },
        status: 'active', updatedAt: '2026-10-01T00:00:00.000Z',
      }, { lookup: 'missing', found: false }] })
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(24_000)
    expect(JSON.stringify(payload)).not.toContain('漢')
  })

  it('does not present failed batch inspection as missing or complete', async () => {
    const request = readToolRequest('automation', { action: 'inspect_models', lookups: ['unavailable'] })
    if (!request) throw new Error('Expected model-review batch.')
    const result = await executeMurphDynamicToolRequest({
      env: {}, fetchImpl: fetch, hostedToolContext: createHostedToolContext({
        automationTool: { request: vi.fn(async () => { throw new Error('Synthetic read failure') }) },
      }), nextUsageOrdinal: () => 0, progressDelivery: null, request,
    })
    expect(result.rpcResult.success).toBe(false)
    expect(JSON.stringify(result.rpcResult)).not.toContain('found')
    expect(result.failureDiagnostic).toMatchObject({ failureReason: 'handler_exception' })
  })

  it('treats only a missing automation inspection as a successful absent read', async () => {
    const lookup = 'weekly-summary'
    const missingError = Object.assign(
      new Error('private automation lookup detail'),
      { code: 'automation_not_found' as const },
    )
    const missingTool = {
      request: vi.fn(async () => {
        throw missingError
      }),
    }
    const inspectRequest = readToolRequest('automation', {
      action: 'inspect',
      lookup,
    })
    if (!inspectRequest) {
      throw new Error('Expected a missing automation inspection request.')
    }

    const missingInspection = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ automationTool: missingTool }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: inspectRequest,
    })

    expect(missingInspection.rpcResult.success).toBe(true)
    expect(readResultPayload(missingInspection)).toEqual({
      action: 'inspect',
      found: false,
    })
    expect(missingInspection.rpcResult.contentItems[0]?.text).not.toContain(
      'private automation lookup detail',
    )

    const patchRequest = readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-08-10T00:00:00.000Z',
      lookup,
      status: 'paused',
    })
    if (!patchRequest) {
      throw new Error('Expected a missing automation patch request.')
    }
    const missingPatch = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ automationTool: missingTool }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: patchRequest,
    })
    expect(missingPatch.rpcResult).toEqual({
      contentItems: [{
        text: 'automation operation is unavailable',
        type: 'inputText',
      }],
      success: false,
    })

    const failedInspection = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        automationTool: {
          request: vi.fn(async () => {
            throw new Error('private storage failure')
          }),
        },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: inspectRequest,
    })
    expect(failedInspection.rpcResult).toEqual({
      contentItems: [{
        text: 'automation operation is unavailable',
        type: 'inputText',
      }],
      success: false,
    })
  })

  it('returns safe recovery instructions for local-time and write-conflict failures', async () => {
    const gapRequest = readToolRequest('automation', {
      action: 'save',
      instructions: 'Send a reminder.',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '02:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'Gap reminder',
    })
    if (!gapRequest) {
      throw new Error('Expected an invalid gap request.')
    }
    const gapResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({}),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: gapRequest,
    })
    expect(gapResult.rpcResult).toMatchObject({ success: false })
    expect(gapResult.rpcResult.contentItems[0]?.text).toContain(
      'ask for another local time',
    )

    const spanningDateRequest = readToolRequest('automation', {
      action: 'save',
      instructions: 'Send a reminder.',
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: '09:00',
          timeZone: 'Pacific/Honolulu',
        },
      },
      title: 'Ambiguous relative-date reminder',
    }, {
      earliestAt: '2031-02-15T09:59:59.900Z',
      latestAt: '2031-02-15T10:00:00.100Z',
    })
    if (!spanningDateRequest) {
      throw new Error('Expected an invalid spanning-date request.')
    }
    const spanningDateResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({}),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: spanningDateRequest,
    })
    expect(spanningDateResult.rpcResult).toMatchObject({ success: false })
    expect(spanningDateResult.rpcResult.contentItems[0]?.text).toContain(
      'ask the user for an explicit calendar date',
    )

    const conflict = Object.assign(new Error('private conflict detail'), {
      code: 'VAULT_AUTOMATION_CONFLICT',
    })
    const automationTool = {
      request: vi.fn(async () => {
        throw conflict
      }),
    }
    const patchRequest = readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2031-02-14T12:00:00.000Z',
      lookup: 'synthetic-reminder',
      title: 'Updated synthetic reminder',
    })
    if (!patchRequest) {
      throw new Error('Expected a patch request.')
    }
    const conflictResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ automationTool }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: patchRequest,
    })
    expect(conflictResult.rpcResult).toMatchObject({ success: false })
    expect(conflictResult.rpcResult.contentItems[0]?.text).toContain(
      'inspect it again and decide from the current stored schedule',
    )
    expect(conflictResult.rpcResult.contentItems[0]?.text).not.toContain(
      'private conflict detail',
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

  it('binds no-data outreach changes to accepted private member input', async () => {
    const deviceTool = {
      request: vi.fn(async () => ({
        action: 'configure_no_data_outreach' as const,
        effectiveAfterDays: 10,
        setting: 'custom' as const,
        sourceProvider: 'garmin',
        status: 'saved' as const,
      })),
    }
    const request = readToolRequest('device', {
      action: 'configure_no_data_outreach',
      afterDays: 10,
      mode: 'after_days',
      sourceProvider: 'garmin',
    })
    if (!request) {
      throw new Error('Expected a device no-data outreach request.')
    }
    const acceptedInputId = 'ain_00000000000000000000000000000001'
    const directResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        currentInvocationScope: () => ({
          conversationScope: 'direct',
          origin: {
            assistantInputId: acceptedInputId,
            kind: 'accepted_input',
            sessionId: 'session-synthetic',
          },
        }),
        deviceTool,
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })

    expect(deviceTool.request).toHaveBeenCalledWith({
      action: 'configure_no_data_outreach',
      afterDays: 10,
      mode: 'after_days',
      sourceProvider: 'garmin',
    }, {
      acceptedInputAuthority: { assistantInputId: acceptedInputId },
      signal: null,
    })
    expect(readResultPayload(directResult)).toMatchObject({
      effectiveAfterDays: 10,
      setting: 'custom',
    })

    deviceTool.request.mockClear()
    const groupResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        currentInvocationScope: () => ({
          conversationScope: 'group',
          origin: {
            assistantInputId: acceptedInputId,
            kind: 'accepted_input',
            sessionId: 'session-synthetic',
          },
        }),
        deviceTool,
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })
    expect(groupResult.rpcResult.success).toBe(false)
    expect(deviceTool.request).not.toHaveBeenCalled()
  })
})

function readToolRequest(
  tool: 'automation' | 'device',
  argumentsValue: unknown,
  automationRelativeDateReferenceWindow: {
    earliestAt: string
    latestAt: string
  } | null = referenceWindow(new Date().toISOString()),
) {
  return readTestMurphDynamicToolRequest(
    {
      method: 'item/tool/call',
      params: {
        arguments: argumentsValue,
        namespace: 'murph',
        tool,
        turnId: 'turn-active-root-1',
      },
    },
    { automationRelativeDateReferenceWindow },
  )
}

function referenceWindow(at: string): {
  earliestAt: string
  latestAt: string
} {
  return {
    earliestAt: at,
    latestAt: at,
  }
}

function createHostedToolContext(input: {
  automationTool?: AssistantHostedToolContext['automationTool']
  currentInvocationScope?: AssistantHostedToolContext['currentInvocationScope']
  deviceTool?: AssistantHostedToolContext['deviceTool']
}): AssistantHostedToolContext {
  return {
    automationTool: input.automationTool ?? null,
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentInvocationScope: input.currentInvocationScope,
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
