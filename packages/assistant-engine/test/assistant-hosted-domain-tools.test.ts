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
      'pass schedule.kind=at with schedule.localAt.time, schedule.localAt.timeZone, and exactly one of schedule.localAt.date or schedule.localAt.relativeDay',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'preserve that wording as relativeDay (today for tonight) so the host resolves it against the named timezone',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'state the explicit host-resolved date returned by the tool while asking for another time',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'echo the exact returned localAtRecoveryKey',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'omitting it leaves that clarification pending and treats the call as an independent reminder',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'action=dismiss_local_at_recovery',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'unknown or wrong-date keys are rejected before mutation',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'raw exact ISO schedule.at is not accepted on generic save or patch',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'Generic save is create-only',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'Inspect is read-only and returns the authoritative stored version plus scheduler timing projection',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'pass expectedUpdatedAt from that readback',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'For an active one-shot with that verified null result, say its requested time is no longer deliverable and offer to reschedule it',
    )
    expect(MURPH_AUTOMATION_TOOL.description).toContain(
      'a replacement recurring wall-clock schedule that omits schedule.timeZone preserves the stored explicit timezone',
    )
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
      slug: 'spring-reminder',
      title: 'Spring reminder',
    }, referenceWindow('2026-03-08T04:59:00.000Z'))
    if (gapRequest?.kind !== 'invalid-automation-arguments') {
      throw new TypeError('Expected a daylight-saving gap failure.')
    }
    expect(gapRequest).toMatchObject({
      localAtTargetLabel: 'Spring reminder (spring-reminder)',
      resolvedLocalDate: '2026-03-08',
      safeFailureCode: 'local_at_gap',
    })
    expect(gapRequest.localAtTargetKey).toMatch(/^[a-f0-9]{64}$/u)
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
      slug: 'spring-reminder',
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
      slug: 'morning-meds',
      title: 'Morning meds',
    })
    expect(repeatedGapRequest).toMatchObject({
      kind: 'invalid-automation-arguments',
      localAtRecovery: {
        recoveryKey: gapRequest.localAtTargetKey,
        resolvedLocalDate: '2026-03-08',
      },
      localAtTargetKey: gapRequest.localAtTargetKey,
      localAtTargetLabel: 'Morning meds (morning-meds)',
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
            nextOccurrenceAt: '2026-03-08T07:30:00.000Z',
            routeBinding: 'current_conversation',
            schedule: request.action === 'patch' && request.schedule
              ? request.schedule
              : { at: '2026-03-08T07:30:00.000Z', kind: 'at' },
            status: 'active',
            timingVerified: true,
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

  it('keeps recovery correlation private while patching and renaming', async () => {
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
      slug: 'morning-meds',
    }, referenceWindow('2026-03-08T04:59:00.000Z'))
    const recovery = readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      localAtRecoveryKey: failedPatch?.kind === 'invalid-automation-arguments'
        ? failedPatch.localAtTargetKey
        : undefined,
      lookup: 'medication-reminder',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '03:30',
          timeZone: 'America/New_York',
        },
      },
      slug: 'morning-meds',
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
            nextOccurrenceAt: '2026-03-08T07:30:00.000Z',
            routeBinding: 'current_conversation',
            schedule: request.action === 'patch' && request.schedule
              ? request.schedule
              : { at: '2026-03-08T07:30:00.000Z', kind: 'at' },
            status: 'active',
            timingVerified: true,
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
      slug: 'medication-reminder',
      title: 'Medication reminder',
    }, referenceWindow('2026-03-08T04:59:00.000Z'))
    const recoveryPatch = readToolRequest('automation', {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      localAtRecoveryKey: failedSave?.kind === 'invalid-automation-arguments'
        ? failedSave.localAtTargetKey
        : undefined,
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
            nextOccurrenceAt: '2026-03-08T07:30:00.000Z',
            routeBinding: 'current_conversation',
            schedule: request.action === 'patch' && request.schedule
              ? request.schedule
              : { at: '2026-03-08T07:30:00.000Z', kind: 'at' },
            status: 'active',
            timingVerified: true,
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

  it('contains local one-shot slug derivation failures for a recoverable retry', async () => {
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
      kind: 'invalid-automation-arguments',
    })
    if (localizedRequest?.kind !== 'invalid-automation-arguments') {
      throw new TypeError('Expected a recoverable invalid automation request.')
    }
    const invalidResult = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({}),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: localizedRequest,
    })
    expect(invalidResult.rpcResult.success).toBe(false)

    expect(readToolRequest('automation', {
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
      slug: 'take-medicine',
      title: '薬を飲む',
    })).toMatchObject({
      kind: 'automation',
      request: {
        action: 'save',
        slug: 'take-medicine',
      },
    })
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
        updatedAt: '2026-08-10T00:00:00.000Z',
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
      updatedAt: '2026-08-10T00:00:00.000Z',
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
        automationId: 'automation-1',
        effectiveTimeZone: 'America/Chicago',
        lookupId: 'evening-wind-down',
        nextOccurrenceAt: '2026-08-11T03:30:00.000Z',
        routeBinding: 'preserved' as const,
        schedule: {
          kind: 'dailyLocal' as const,
          localTime: '22:30',
          timeZone: 'America/Chicago',
        },
        status: 'active' as const,
        timingVerified: true,
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
      automationId: 'automation-1',
      effectiveTimeZone: 'America/Chicago',
      lookupId: 'evening-wind-down',
      nextOccurrenceAt: '2026-08-11T03:30:00.000Z',
      routeBinding: 'preserved',
      schedule: {
        kind: 'dailyLocal',
        localTime: '22:30',
        timeZone: 'America/Chicago',
      },
      status: 'active',
      timingVerified: true,
      updatedAt: '2026-08-10T00:00:00.000Z',
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
