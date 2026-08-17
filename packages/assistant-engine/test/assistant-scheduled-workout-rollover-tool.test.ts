import { rm } from 'node:fs/promises'

import { workoutSessionSchema } from '@murphai/contracts'
import { initializeVault } from '@murphai/core'
import type { AssistantResponseCard } from '@murphai/operator-config/assistant-response-cards'
import {
  logLiveWorkoutSet,
  saveWorkoutFormat,
  showActiveLiveWorkout,
  showWorkoutFormat,
  showWorkoutRecord,
  startLiveWorkout,
} from '@murphai/vault-usecases/workouts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
  MURPH_SCHEDULED_WORKOUT_ROLLOVER_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'
import type {
  AssistantHostedInvocationScope,
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.ts'
import type {
  AssistantScheduledWorkoutDirectReplyAuthority,
} from '../src/assistant/service-contracts.ts'
import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { createTempVaultContext } from './test-helpers.ts'

const PRIOR_STARTED_AT = '2026-08-16T18:00:00.000Z'
const PRIOR_FINAL_ACTIVITY_AT = '2026-08-16T18:42:00.000Z'
const SCHEDULED_OCCURRENCE_AT = '2026-08-17T18:00:00.000Z'
const REMINDER_SENT_AT = '2026-08-17T18:00:05.000Z'
const ACCEPTED_AT = '2026-08-17T18:07:00.000Z'
const AUTHORIZED_INPUT_ID = `ain_${'6'.repeat(32)}`
const LATER_INPUT_ID = `ain_${'7'.repeat(32)}`

const cleanupRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(cleanupRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ))
})

describe('scheduled workout rollover dynamic tool', () => {
  it('rejects missing, group, and later-input authority before mutation, then rolls over and attaches the active workout card for the exact reply', async () => {
    const prepared = await createRolloverVault()
    const request = readToolRequest(
      MURPH_SCHEDULED_WORKOUT_ROLLOVER_TOOL.name,
      {
        exerciseName: 'Chest-supported row',
        exerciseOrder: 1,
        previousWorkoutId: prepared.previousWorkoutId,
        reps: 9,
        routineId: prepared.nextRoutineId,
        setOrder: 2,
        weight: 70,
        weightUnit: 'lb',
      },
    )
    expect(request.kind).toBe('scheduled-workout-rollover')

    for (const context of [
      hostedToolContext(null, directScope(AUTHORIZED_INPUT_ID)),
      hostedToolContext(authority(), groupScope(AUTHORIZED_INPUT_ID)),
      hostedToolContext(authority(), directScope(LATER_INPUT_ID)),
    ]) {
      const denied = await executeTool(request, prepared.vaultRoot, context)
      expect(denied.rpcResult).toMatchObject({ success: false })
      expect(denied.rpcResult.contentItems[0]?.text).toContain(
        'requires the exact current direct reminder reply',
      )
    }

    const unchangedActive = await showActiveLiveWorkout({
      vault: prepared.vaultRoot,
    })
    expect(unchangedActive.entity.id).toBe(prepared.previousWorkoutId)
    const unchangedPrior = workoutSessionSchema.parse(
      unchangedActive.entity.data.workout,
    )
    expect(unchangedPrior.endedAt).toBeUndefined()

    const logged = await executeTool(
      request,
      prepared.vaultRoot,
      hostedToolContext(authority(), directScope(AUTHORIZED_INPUT_ID)),
    )
    expect(logged.rpcResult.success).toBe(true)
    expect(JSON.parse(logged.rpcResult.contentItems[0]!.text)).toMatchObject({
      status: 'logged',
      workout: {
        data: {
          workout: {
            routineId: prepared.nextRoutineId,
            scheduledRolloverOperationId: authority().operationId,
          },
        },
      },
    })

    const prior = workoutSessionSchema.parse(
      (await showWorkoutRecord(
        prepared.vaultRoot,
        prepared.previousWorkoutId,
      )).entity.data.workout,
    )
    expect(prior.endedAt).toBe(PRIOR_FINAL_ACTIVITY_AT)

    const active = await showActiveLiveWorkout({ vault: prepared.vaultRoot })
    const activeWorkout = workoutSessionSchema.parse(active.entity.data.workout)
    expect(activeWorkout).toMatchObject({
      routineId: prepared.nextRoutineId,
      scheduledRolloverOperationId: authority().operationId,
      startedAt: SCHEDULED_OCCURRENCE_AT,
    })
    expect(activeWorkout.exercises[0]?.sets[1]).toMatchObject({
      order: 2,
      reps: 9,
      weight: 70,
      weightUnit: 'lb',
    })

    const card: AssistantResponseCard = {
      footer: 'Reply with the exercise, set, and result to log or correct it.',
      kind: 'compact_table',
      subtitle: null,
      title: 'Next Routine',
      tracking: {
        entityId: active.entity.id,
        kind: 'workout',
        snapshotAt: ACCEPTED_AT,
      },
      version: 1,
      workout: {
        exercises: [
          {
            name: 'Chest-supported row',
            sets: [
              { actual: null, status: 'pending', target: '60 lb × 12' },
              { actual: '70 lb × 9', status: 'completed', target: '70 lb × 9' },
            ],
          },
          {
            name: 'Push-up',
            sets: [{ actual: null, status: 'pending', target: '15 reps' }],
          },
        ],
        state: 'active',
        version: 1,
      },
    }
    const cardRequest = readToolRequest(
      MURPH_ATTACH_RESPONSE_CARD_TOOL.name,
      { card },
    )
    expect(cardRequest.kind).toBe('attach-response-card')
    const attached = await executeMurphDynamicToolRequest({
      currentResponseCard: null,
      currentResponseMedia: [],
      env: {},
      fetchImpl: fetch,
      nextUsageOrdinal: () => 0,
      privateDirectResponseCardAllowed: true,
      progressDelivery: null,
      request: cardRequest,
      vaultRoot: prepared.vaultRoot,
    })

    expect(attached.rpcResult.success).toBe(true)
    expect(attached.responseCardPatch?.card).toMatchObject({
      editor: {
        actionBinding: expect.any(String),
        version: 1,
      },
      tracking: { entityId: active.entity.id },
      workout: {
        exercises: [
          {
            name: 'Chest-supported row',
            sets: [
              { actual: null, status: 'pending' },
              { actual: '70 lb × 9', status: 'completed' },
            ],
          },
          {
            name: 'Push-up',
            sets: [{ actual: null, status: 'pending' }],
          },
        ],
        state: 'active',
      },
    })
  })
})

async function createRolloverVault(): Promise<{
  nextRoutineId: string
  previousWorkoutId: string
  vaultRoot: string
}> {
  const { parentRoot, vaultRoot } = await createTempVaultContext(
    'assistant-scheduled-workout-rollover-',
  )
  cleanupRoots.push(parentRoot)
  await initializeVault({
    createdAt: '2026-08-16T17:00:00.000Z',
    timezone: 'UTC',
    vaultRoot,
  })
  await saveWorkoutFormat({
    payload: {
      activityType: 'strength-training',
      status: 'active',
      template: {
        exercises: [{
          mode: 'bodyweight',
          name: 'Split squat',
          order: 1,
          plannedSets: [{ order: 1, targetReps: 8 }],
        }],
      },
      title: 'Prior Routine',
    },
    vault: vaultRoot,
  })
  await saveWorkoutFormat({
    payload: {
      activityType: 'strength-training',
      status: 'active',
      template: {
        exercises: [
          {
            mode: 'weight_reps',
            name: 'Chest-supported row',
            order: 1,
            plannedSets: [
              {
                order: 1,
                targetReps: 12,
                targetWeight: 60,
                targetWeightUnit: 'lb',
              },
              {
                order: 2,
                targetReps: 9,
                targetWeight: 70,
                targetWeightUnit: 'lb',
              },
            ],
            unitOverride: 'lb',
          },
          {
            mode: 'bodyweight',
            name: 'Push-up',
            order: 2,
            plannedSets: [{ order: 1, targetReps: 15 }],
          },
        ],
      },
      title: 'Next Routine',
    },
    vault: vaultRoot,
  })
  const priorRoutine = await showWorkoutFormat(vaultRoot, 'prior-routine')
  const nextRoutine = await showWorkoutFormat(vaultRoot, 'next-routine')
  const prior = await startLiveWorkout({
    routine: priorRoutine.entity.data.workoutFormatId,
    startedAt: PRIOR_STARTED_AT,
    vault: vaultRoot,
  })
  vi.useFakeTimers()
  vi.setSystemTime(PRIOR_FINAL_ACTIVITY_AT)
  await logLiveWorkoutSet({
    exerciseOrder: 1,
    reps: 8,
    requireExistingSet: true,
    setOrder: 1,
    vault: vaultRoot,
    workoutId: prior.eventId,
  })
  return {
    nextRoutineId: nextRoutine.entity.data.workoutFormatId,
    previousWorkoutId: prior.eventId,
    vaultRoot,
  }
}

function authority(): AssistantScheduledWorkoutDirectReplyAuthority {
  return {
    acceptedAt: ACCEPTED_AT,
    authorizedAssistantInputId: AUTHORIZED_INPUT_ID,
    operationId: `sha256:${'a'.repeat(64)}`,
    reminderSentAt: REMINDER_SENT_AT,
    scheduledOccurrenceAt: SCHEDULED_OCCURRENCE_AT,
  }
}

function directScope(assistantInputId: string): AssistantHostedInvocationScope {
  return {
    conversationScope: 'direct',
    origin: {
      assistantInputId,
      kind: 'accepted_input',
      sessionId: 'session-workout-rollover',
    },
    originSessionId: 'session-workout-rollover',
  }
}

function groupScope(assistantInputId: string): AssistantHostedInvocationScope {
  return {
    ...directScope(assistantInputId),
    conversationScope: 'group',
  }
}

function hostedToolContext(
  directReplyAuthority: AssistantScheduledWorkoutDirectReplyAuthority | null,
  invocationScope: AssistantHostedInvocationScope,
): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentAssistantInputId: () =>
      invocationScope.origin.kind === 'accepted_input'
        ? invocationScope.origin.assistantInputId
        : null,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    currentInvocationScope: () => invocationScope,
    currentScheduledWorkoutDirectReplyAuthority: () => directReplyAuthority,
    currentUserActionScope: () => null,
    sendVaultFile: async () => {
      throw new Error('unavailable')
    },
    vaultFileSendAvailable: false,
  }
}

function readToolRequest(tool: string, args: unknown) {
  const request = readTestMurphDynamicToolRequest({
    method: 'item/tool/call',
    params: {
      arguments: args,
      namespace: 'murph',
      tool,
    },
  })
  if (!request) {
    throw new Error(`Expected ${tool} request.`)
  }
  return request
}

async function executeTool(
  request: ReturnType<typeof readToolRequest>,
  vaultRoot: string,
  hostedToolContext: AssistantHostedToolContext,
) {
  return await executeMurphDynamicToolRequest({
    env: {},
    fetchImpl: fetch,
    hostedToolContext,
    nextUsageOrdinal: () => 0,
    progressDelivery: null,
    request,
    vaultRoot,
  })
}
