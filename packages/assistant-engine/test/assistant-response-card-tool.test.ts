import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { AssistantResponseMedia } from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantResponseCard,
  CompactTableWorkoutResponseCardV1,
} from '@murphai/operator-config/assistant-response-cards'
import {
  sendLinqIMessageAppCard,
  type LinqFetch,
} from '@murphai/operator-config/linq-runtime'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'
import { addStructuredWorkoutRecord } from '@murphai/vault-usecases/workouts'

import {
  executeMurphDynamicToolRequest,
  MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL,
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
  MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL,
  resolveMurphDynamicTools,
  type MurphGroupSharedReadTurnState,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  getKnowledgePage,
  upsertKnowledgePage,
} from '../src/knowledge/service.ts'
import type {
  AssistantHostedGroupSharedReadResponse,
} from '../src/assistant/execution-context.ts'
import {
  digestGroupChallengeDefinition,
  renderGroupChallengeDefinitionSection,
} from '../src/assistant/group-challenge-response-card-schema.ts'
import {
  createAssistantOutboxIntent,
  readAssistantOutboxIntent,
} from '../src/assistant/outbox.ts'

const LEGACY_CARD_V1: AssistantResponseCard = {
  kind: 'daily_nutrition',
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
  },
}

const CARD: AssistantResponseCard = {
  kind: 'daily_nutrition',
  version: 2,
  localDate: '2026-07-28',
  mealCount: 3,
  totals: {
    calories: { total: 1_490.25, mealCount: 3 },
    proteinGrams: { total: 94.5, mealCount: 3 },
    carbsGrams: { total: 193.125, mealCount: 3 },
    fatGrams: { total: 34.75, mealCount: 3 },
    fiberGrams: { total: 26.5, mealCount: 3 },
  },
  goals: {
    calories: { target: 2_100, status: 'under_target' },
    proteinGrams: { target: 100, status: 'on_target' },
    carbsGrams: { target: 220, status: 'on_target' },
    fatGrams: { target: 40, status: 'on_target' },
    fiberGrams: { target: 30, status: 'under_target' },
  },
}

const ROUTINE_CARD: AssistantResponseCard = {
  exercises: [{
    dose: '8 repetitions',
    estimatedSeconds: 45,
    images: [{
      alt: 'Person with a forearm resting on a door frame.',
      source: 'exercise_catalog:ST170:1',
      step: 'Setup',
      url: 'https://cdn.example.test/doorway-stretch.png',
    }],
    instructions: ['Take a small step forward.', 'Keep the ribs quiet.'],
    name: 'Doorway stretch',
  }],
  footer: null,
  intensity: 'Easy',
  kind: 'exercise_routine',
  labels: {
    dose: 'Dose',
    exercise: 'Exercise',
    time: 'Time',
    visualGuide: 'Visual guide',
  },
  safety: 'Stop if pain increases.',
  subtitle: null,
  title: 'Short reset',
  totalSeconds: 60,
  transitionSeconds: 15,
  version: 1,
}

const TELEGRAM_RICH_CONTENT_CARD: AssistantResponseCard = {
  kind: 'telegram_rich_content',
  version: 1,
  html: '<h2>Mobility session</h2><ol><li>Move through a comfortable range.</li></ol><blockquote>Stop if pain increases.</blockquote>',
}

const CHALLENGE_CARD: AssistantResponseCard = {
  kind: 'challenge_standings',
  version: 1,
  format: 'individual',
  title: 'Weird Health Week',
  subtitle: null,
  objective: { kind: 'ranking' },
  entries: [{
    label: 'Maya',
    points: 120,
    coverage: 'complete',
    detail: null,
  }],
  footer: null,
}

const CHALLENGE_DEFINITION = {
  format: {
    kind: 'individual',
    objective: { kind: 'ranking' },
  },
  participants: [{
    participantId: 'participant_maya',
    state: 'in',
  }],
  rulesRevision: 1,
  scorecard: {
    components: [{
      evaluationRule: 'Sum settled shared steps in the challenge window.',
      id: 'steps',
      label: 'Steps',
      perQuantity: 100,
      points: 3,
      projectionScopeKeys: ['steps-days.v0'],
      quantityUnit: 'steps',
      settlementMode: 'window-total',
    }],
  },
  version: 1,
} as const

const CHALLENGE_CARD_AUTHORING_INPUT = {
  challengeSlug: 'weird-health-week',
  pageRevisionDigest: '0'.repeat(64),
  participantObservations: [{
    components: [{
      componentId: 'steps',
      quantity: 4_000,
      status: 'available',
    }],
    participantId: 'participant_maya',
  }],
} as const

const COMPLETE_GROUP_READ_STATE: MurphGroupSharedReadTurnState = {
  invalid: false,
  readProjectionScopeKeyBatches: [['steps-days.v0']],
  roster: [
    {
      displayName: 'Room member, not in challenge',
      participantId: 'participant_room_only',
    },
    {
      displayName: 'Maya',
      participantId: 'participant_maya',
    },
  ],
}

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, { force: true, recursive: true })
  ))
})

const REALISTIC_LATE_WORKOUT_CARD: AssistantResponseCard = {
  kind: 'compact_table',
  version: 1,
  title: 'Lower body strength',
  subtitle: null,
  footer: 'Reply with the exercise, set, and result to log or correct it.',
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-09T19:45:00.000Z',
  },
  workout: {
    version: 1,
    state: 'active',
    exercises: [
      'Dumbbell Single-Leg Romanian Deadlift',
      'Dumbbell Bulgarian Split Squat',
      'Dumbbell Walking Lunge in Place',
      'Split Squat with Front Heel Lift',
      'Dumbbell Reverse Lunge',
      'Dumbbell Step-Up',
    ].map((name, exerciseIndex) => ({
      name,
      sets: [
        ['55 lb × 8–10', '55 lb × 9'],
        ['55 lb × 10', '55 lb × 10'],
        ['65 lb × 10–12', '65 lb × 11'],
        ['65 lb × 12', '65 lb × 12'],
      ].map(([target, actual], setIndex) => {
        const isCompleted = exerciseIndex * 4 + setIndex < 18
        return {
          status: isCompleted ? 'completed' : 'pending',
          target: target ?? null,
          actual: isCompleted ? actual ?? null : null,
        }
      }),
    })),
  },
}

const OVERSIZED_WORKOUT_CARD: CompactTableWorkoutResponseCardV1 = {
  kind: 'compact_table',
  version: 1,
  title: 'Full workout recovery',
  subtitle: null,
  footer: 'Reply with the exercise, set, and result to log or correct it.',
  tracking: {
    kind: 'workout',
    entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
    snapshotAt: '2026-08-09T19:45:00.000Z',
  },
  workout: {
    version: 1,
    state: 'active',
    exercises: Array.from({ length: 16 }, (_, exerciseIndex) => ({
      name: `Capacity exercise ${exerciseIndex + 1}`,
      sets: Array.from({ length: 16 }, (_, setIndex) => ({
        status: 'pending',
        target: `Exercise ${exerciseIndex + 1} set ${setIndex + 1} target ${'x'.repeat(12)}`,
        actual: null,
      })),
    })),
  },
}

const IMAGE: AssistantResponseMedia = {
  alt: null,
  kind: 'image',
  source: null,
  url: 'https://cdn.example.test/nutrition.png',
}

function executeCardTool(input: {
  currentResponseCard?: AssistantResponseCard | null
  currentResponseMedia?: readonly AssistantResponseMedia[] | null
  groupChallengeResponseCardAllowed?: boolean | null
  groupSharedReadTurnState?: MurphGroupSharedReadTurnState | null
  knowledgePageReadTextFile?: (filePath: string) => Promise<string>
  privateDirectResponseCardAllowed?: boolean | null
  telegramPresentationResponseCardAllowed?: boolean | null
  request?: Parameters<typeof executeMurphDynamicToolRequest>[0]['request']
  vaultRoot?: string | null
}) {
  return executeMurphDynamicToolRequest({
    currentResponseCard: input.currentResponseCard ?? null,
    currentResponseMedia: input.currentResponseMedia ?? [],
    env: {},
    fetchImpl: fetch,
    groupChallengeResponseCardAllowed:
      input.groupChallengeResponseCardAllowed ?? false,
    groupSharedReadTurnState: input.groupSharedReadTurnState ?? null,
    knowledgePageReadTextFile: input.knowledgePageReadTextFile ?? null,
    nextUsageOrdinal: () => 0,
    privateDirectResponseCardAllowed:
      input.privateDirectResponseCardAllowed ?? true,
    telegramPresentationResponseCardAllowed:
      input.telegramPresentationResponseCardAllowed ?? false,
    progressDelivery: null,
    request: input.request ?? {
      card: CARD,
      kind: 'attach-response-card',
    },
    vaultRoot: input.vaultRoot ?? null,
  })
}

async function createChallengeVault(input: {
  body?: string
  definition?: unknown
  pageType?: string
  withPage?: boolean
} = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-challenge-card-tool-'))
  cleanupPaths.push(root)
  await createIntegratedVaultServices().core.init({
    requestId: 'challenge-card-tool-test',
    timezone: 'UTC',
    vault: root,
  })
  if (input.withPage ?? true) {
    const definition = input.definition ?? CHALLENGE_DEFINITION
    await upsertKnowledgePage({
      body: input.body ?? [
        'The current challenge rules and room canon.',
        '',
        renderGroupChallengeDefinitionSection(definition),
      ].join('\n'),
      pageType: input.pageType ?? 'challenge',
      slug: 'weird-health-week',
      title: 'Weird Health Week',
      vault: root,
    })
  }
  return root
}

async function createLiveWorkoutCardVault(input: {
  ambiguousDuplicate?: boolean
  hiddenNote?: string
  unsupportedSet?: {
    actual: string
    canonical: Record<string, number | string | undefined>
    mode?:
      | 'assisted_bodyweight'
      | 'bodyweight'
      | 'cardio'
      | 'duration'
      | 'weighted_bodyweight'
  }
} = {}): Promise<{
  card: AssistantResponseCard
  root: string
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-workout-card-tool-'))
  cleanupPaths.push(root)
  await createIntegratedVaultServices().core.init({
    requestId: 'workout-card-tool-test',
    timezone: 'UTC',
    vault: root,
  })
  const shown = await addStructuredWorkoutRecord({
    vault: root,
    draft: {
      activityType: 'strength-training',
      durationMinutes: 1,
      occurredAt: '2026-08-12T14:00:00.000Z',
      recordedAt: '2026-08-12T14:00:00.000Z',
      title: 'Strength',
      workout: {
        sourceApp: 'murph-live',
        startedAt: '2026-08-12T14:00:00.000Z',
        exercises: input.ambiguousDuplicate === true
          ? [8, 12].map((reps, index) => ({
              mode: 'bodyweight' as const,
              name: 'Single-arm row',
              order: index + 1,
              sets: [{ order: 1, reps }],
            }))
          : input.unsupportedSet !== undefined
          ? [{
              ...(input.unsupportedSet.mode === undefined
                ? {}
                : { mode: input.unsupportedSet.mode }),
              name: 'Exercise',
              order: 1,
              sets: [{ ...input.unsupportedSet.canonical, order: 1 }],
            }]
          : input.hiddenNote === undefined
          ? [{
              mode: 'weight_reps',
              name: 'Leg press',
              order: 1,
              unitOverride: 'lb',
              sets: [
                { order: 1, reps: 0, weight: 0 },
                { order: 2, reps: 8, weight: 185, weightUnit: 'lb' },
                { order: 3 },
              ],
            }]
          : [{
              name: 'Plank',
              order: 1,
              sets: [{ note: input.hiddenNote, order: 1 }],
            }],
      },
    },
  })
  return {
    root,
    card: {
      kind: 'compact_table',
      version: 1,
      title: 'Strength',
      subtitle: null,
      footer: null,
      tracking: {
        kind: 'workout',
        entityId: shown.eventId,
        snapshotAt: '2026-08-12T14:00:00.000Z',
      },
      workout: {
        version: 1,
        state: 'active',
        exercises: input.ambiguousDuplicate === true
          ? [8, 12].map((reps) => ({
              name: 'Single-arm row',
              sets: [{
                status: 'completed' as const,
                target: null,
                actual: `${reps} reps`,
              }],
            }))
          : input.unsupportedSet !== undefined
          ? [{
              name: 'Exercise',
              sets: [{
                status: 'completed',
                target: null,
                actual: input.unsupportedSet.actual,
              }],
            }]
          : input.hiddenNote === undefined
          ? [{
              name: 'Leg press',
              sets: [
                { status: 'completed', target: '185 lb × 8', actual: '0 lb × 0' },
                { status: 'completed', target: '185 lb × 8', actual: '185 lb × 8' },
                { status: 'pending', target: '185 lb × 8', actual: null },
              ],
            }]
          : [{
              name: 'Plank',
              sets: [{ status: 'completed', target: null, actual: 'Logged' }],
            }],
      },
    },
  }
}

async function persistWorkoutCardThroughLinq(input: {
  card: AssistantResponseCard
  idSuffix: string
  vaultRoot: string
}) {
  const intent = await createAssistantOutboxIntent({
    actorId: '+15550001',
    card: input.card,
    channel: 'linq',
    dedupeToken: `workout-card-${input.idSuffix}`,
    message: 'ignored model prose',
    sessionId: `session-${input.idSuffix}`,
    threadId: `thread-${input.idSuffix}`,
    threadIsDirect: true,
    turnId: `turn-${input.idSuffix}`,
    vault: input.vaultRoot,
  })
  const persisted = await readAssistantOutboxIntent(
    input.vaultRoot,
    intent.intentId,
  )
  const persistedCard = persisted?.card
  if (
    !persistedCard
    || persistedCard.kind !== 'compact_table'
    || !('workout' in persistedCard)
  ) {
    throw new TypeError('Expected the persisted workout card.')
  }

  const requests: unknown[] = []
  const fetchImplementation: LinqFetch = async (_url, init) => {
    requests.push(
      typeof init.body === 'string' ? JSON.parse(init.body) : null,
    )
    return {
      arrayBuffer: async () => new ArrayBuffer(0),
      json: async () => ({ message: { id: 'msg_workout_card' } }),
      ok: true,
      status: 200,
      text: async () => '',
    }
  }
  await sendLinqIMessageAppCard({
    card: persistedCard,
    chatId: 'chat_workout_card',
    idempotencyKey: `workout-card-${input.idSuffix}`,
  }, {
    env: { LINQ_API_TOKEN: 'test-token' },
    fetchImplementation,
  })

  const request = requests[0] as {
    message: { parts: Array<{ fallback_text: string; url: string }> }
  }
  const encoded = request.message.parts[0]?.url.split('#murph-card=')[1]
  if (encoded === undefined) {
    throw new TypeError('Expected the encoded workout card URL.')
  }
  return {
    envelope: JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as { card?: unknown; schemaVersion?: unknown },
    persisted,
    persistedCard,
    request,
  }
}

function readCardToolRequest(
  argumentsValue: unknown,
  tool = 'attach_response_card',
) {
  return readTestMurphDynamicToolRequest({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool,
    },
  })
}

async function readCurrentChallengeCardToolRequest(
  vaultRoot: string,
  input: Record<string, unknown> = CHALLENGE_CARD_AUTHORING_INPUT,
) {
  const page = await getKnowledgePage({
    slug: 'weird-health-week',
    vault: vaultRoot,
  })
  return readCardToolRequest({
    ...input,
    pageRevisionDigest: page.page.pageRevisionDigest,
  })
}

function readGroupToolRequest(argumentsValue: unknown) {
  return readTestMurphDynamicToolRequest({
    id: 2,
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: 'group',
    },
  })
}

async function executeGroupRead(input: {
  response: AssistantHostedGroupSharedReadResponse | Error
  state: MurphGroupSharedReadTurnState
  projectionKind?: 'sleep-times.v0' | 'steps-days.v0'
}) {
  const projectionKind = input.projectionKind ?? 'steps-days.v0'
  const request = readGroupToolRequest({
    action: 'read_shared',
    projectionScopes: [{ projectionKind }],
  })
  if (!request || request.kind !== 'group') {
    throw new TypeError('Expected a group shared-read request.')
  }
  return await executeMurphDynamicToolRequest({
    currentResponseCard: null,
    currentResponseMedia: [],
    env: {},
    fetchImpl: fetch,
    groupChallengeResponseCardAllowed: true,
    groupSharedReadTurnState: input.state,
    hostedToolContext: {
      computerToolsAvailable: false,
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      groupSharedReader: {
        request: async () => {
          if (input.response instanceof Error) {
            throw input.response
          }
          return input.response
        },
      },
      sendVaultFile: async () => {
        throw new Error('Vault file sends are unavailable in this test.')
      },
      vaultFileSendAvailable: false,
    },
    nextUsageOrdinal: () => 0,
    privateDirectResponseCardAllowed: false,
    progressDelivery: null,
    request,
  })
}

function buildSharedReadResponse(input: {
  displayName?: string
  participantIds?: readonly string[]
  projectionScopeKey?: string
} = {}): AssistantHostedGroupSharedReadResponse {
  const participantIds = input.participantIds ?? ['participant_maya']
  const projectionScopeKey = input.projectionScopeKey ?? 'steps-days.v0'
  return {
    members: participantIds.map((participantId) => ({
      currentTurnHandles: [],
      displayName: input.displayName
        ?? (participantId === 'participant_maya' ? 'Maya' : 'Jon'),
      memberId: `member_${participantId}`,
      participantId,
      projections: [],
    })),
    requestedProjectionScopeKeys: [projectionScopeKey],
    status: 'ok',
  }
}

function createEmptyGroupReadState(): MurphGroupSharedReadTurnState {
  return {
    invalid: false,
    readProjectionScopeKeyBatches: [],
    roster: null,
  }
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeCodexSchemaForSize(value: unknown): unknown {
  if (!isSchemaObject(value)) {
    return value
  }
  if ('$ref' in value || '$defs' in value || 'definitions' in value) {
    throw new TypeError('The response-card tool schema must remain inline.')
  }

  const normalized: Record<string, unknown> = {}
  for (const key of ['type', 'description', 'encrypted'] as const) {
    if (key in value) {
      normalized[key] = value[key]
    }
  }
  if ('const' in value) {
    normalized.enum = [value.const]
  } else if ('enum' in value) {
    normalized.enum = value.enum
  }
  if ('items' in value) {
    normalized.items = normalizeCodexSchemaForSize(value.items)
  }
  if (isSchemaObject(value.properties)) {
    normalized.properties = Object.fromEntries(
      Object.entries(value.properties).map(([key, schema]) => [
        key,
        normalizeCodexSchemaForSize(schema),
      ]),
    )
  }
  if ('required' in value) {
    normalized.required = value.required
  }
  if ('additionalProperties' in value) {
    normalized.additionalProperties = isSchemaObject(value.additionalProperties)
      ? normalizeCodexSchemaForSize(value.additionalProperties)
      : value.additionalProperties
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const variants = value[key]
    if (Array.isArray(variants)) {
      normalized[key] = variants.map(normalizeCodexSchemaForSize)
    }
  }
  return normalized
}

describe('murph.attach_response_card', () => {
  it('keeps each audience-scoped schema below the Codex compaction boundary', () => {
    const groupTool = resolveMurphDynamicTools({
      groupChallengeResponseCardsAvailable: true,
      responseCardsAvailable: false,
    }).find((tool) => tool.name === 'attach_response_card')
    expect(groupTool).toBeDefined()

    for (const tool of [
      MURPH_ATTACH_RESPONSE_CARD_TOOL,
      MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL,
      MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL,
      groupTool!,
    ]) {
      const serializedBytes = Buffer.byteLength(
        JSON.stringify(normalizeCodexSchemaForSize(tool.inputSchema)),
        'utf8',
      )
      expect(serializedBytes).toBeLessThan(5_000)
    }

    const privateSchema = JSON.stringify(
      MURPH_ATTACH_RESPONSE_CARD_TOOL.inputSchema,
    )
    const groupSchema = JSON.stringify(groupTool!.inputSchema)
    expect(privateSchema).toContain('daily_nutrition')
    expect(privateSchema).toContain('compact_table')
    expect(privateSchema).toContain('fiberGrams')
    expect(privateSchema).not.toContain('editor')
    expect(privateSchema).not.toContain('challenge_standings')
    expect(groupSchema).toContain('participantObservations')
    expect(groupSchema).toContain('challengeSlug')
    expect(groupSchema).toContain('pageRevisionDigest')
    expect(groupSchema).not.toContain('definitionDigest')
    expect(groupSchema).not.toContain('componentProjectionScopeKeys')
    expect(groupSchema).not.toContain('scoreInput')
    expect(groupSchema).not.toContain('participantLabels')
    expect(groupSchema).not.toContain('perQuantity')
    expect(groupSchema).not.toContain('targetPoints')
    expect(groupSchema).not.toContain('challenge_standings')
    expect(groupSchema).not.toContain('verifiedPoints')
    expect(groupSchema).not.toContain('coverageCounts')
    expect(groupSchema).not.toContain('daily_nutrition')
    expect(groupSchema).not.toContain('compact_table')
    expect(readCardToolRequest({
      card: {
        ...REALISTIC_LATE_WORKOUT_CARD,
        editor: {
          exercises: [],
          version: 1,
        },
      },
    })).toMatchObject({ kind: 'invalid-response-card-arguments' })
    expect(readCardToolRequest({
      ...CHALLENGE_CARD_AUTHORING_INPUT,
      scoreInput: {
        format: { kind: 'individual', objective: { kind: 'ranking' } },
        participants: CHALLENGE_CARD_AUTHORING_INPUT.participantObservations,
        scorecard: CHALLENGE_DEFINITION.scorecard,
      },
    })).toMatchObject({ kind: 'invalid-response-card-arguments' })
    expect(groupTool!.description).toContain('runs the deterministic scorer')
    expect(groupTool!.description).toContain(
      'persists the exact page-derived input and result on that same page before attaching',
    )
    expect(groupTool!.description).toContain(
      'owns points, target, order, coverage, counts, ranks, and ties',
    )
    expect(groupTool!.description).toContain(
      'entire canonical ranked result contains at most eight entries',
    )
    expect(groupTool!.description).toContain('never truncate the ranking')
    expect(groupTool!.description).toContain(
      'derives individual labels from the trusted read',
    )
    expect(groupTool!.description).toContain(
      'one complete stable room-member and authorized-label roster',
    )
    expect(groupTool!.description).toContain('capacity-omitted')
    expect(groupTool!.description).toContain(
      'rejects observations when any canonical page content changed after normalization',
    )
    expect(groupTool!.description).toContain('Collective cards have no row cap')
  })

  it('describes Telegram cards as flexible presentation options', () => {
    expect(MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL.description).toContain(
      'direct or group Telegram conversation',
    )
    expect(MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL.description).toContain(
      'Normal conversation can remain ordinary text, even when it needs several paragraphs',
    )
    expect(MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL.description).toContain(
      'useful presentation examples, not exclusive content owners',
    )
    expect(MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL.description).toContain(
      'custom or mixed layout is clearer',
    )
    expect(MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL.description).toContain(
      'Do not use presentation to invent or bypass canonical reads, writes, or safety workflows',
    )
    expect(MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL.description).toContain(
      'keep safety limits and stop conditions visible',
    )
    expect(MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL.description).toContain(
      'under 1,500 visible characters',
    )
    expect(MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL.description).toContain(
      'Do not repeat the same facts in a summary, table, and details',
    )
    expect(MURPH_ATTACH_TELEGRAM_RICH_CONTENT_TOOL.description).toContain(
      '<details><summary>Exercise notes</summary>',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'a request to repeat or improve an earlier routine',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'one useful presentation option, not the only valid rich layout',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'images are recommended, not required',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'Use attach_telegram_rich_content when a custom or mixed layout is clearer.',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'Never promise images for an exercise that has none.',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'put each useful returned image on its matching movement item',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'An exercise list result is not enough: run vault-cli exercise show for every named movement',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'Represent every named movement as its own card.exercises item',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'A phase is not an exercise.',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'becomes four exercise items in one card, not two.',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'correct the reported fields and retry this tool once',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'preserve every valid movement, instruction, and image; change only the reported invalid fields',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'Do not switch to separate response media on Telegram.',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'use one complete attach_telegram_rich_content card without images and keep every named movement separate',
    )
    expect(MURPH_ATTACH_EXERCISE_ROUTINE_CARD_TOOL.description).toContain(
      'After either card tool succeeds, stop and send no final text.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'saved instructions for the exact scheduled automation occurrence request a structured answer that the card alone can represent',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'a structured plan or schedule that the table alone can fully represent within its bounds',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Occurrence authority alone is not card intent',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'verified initial card after starting or resuming one canonical live workout',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'with multiple plausible workouts, do not infer authority',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'card replaces the entire final response',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'compound requests with complete ordinary text and no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'vault-cli meal totals --from <date> --to <same-date>',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'never calculate or reuse totals',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Workout footers span native and static cards; never promise native-only taps',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'let input validation decide whether its actual encoded envelope fits',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'never refuse from an estimated exercise or set count',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'use the full deterministic text recovery',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'New authoring uses V2 with fiber and five required goal snapshots; nullable V2 goals and nutrition V1 remain legacy replay and rendering compatibility only',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).not.toContain(
      'V2 adds fiber and nullable goal snapshots',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Before every goal-aware daily_nutrition card, first run vault-cli goal list --status active --limit 200 --format json',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'If it returns 200 records, fail closed with ordinary text, no Goal or measurement mutation, and no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'run vault-cli goal show <goal-id> --format json for every returned active Goal whose list item reports a nonzero data.metricTargetsCount',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'never select detail reads by title, slug, domain, context-snapshot visibility, or the default list prefix',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Keep this active-target authority read separate from any all-status lookup used to reuse or honor Murph\'s managed paused or abandoned proposal',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Require exactly one unambiguous applicable exact point target in each fixed card unit: dietary-calories in kcal, and protein-grams, carbs-grams, fat-grams, and fiber-grams in g, resolved across active canonical Goals',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Each target must use selected-value comparator between with identical numeric value and highValue',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A one-sided threshold, non-identical range, or other shape remains authoritative but makes the bundle comparator-incompatible',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'never expose, compare, copy, or derive from its bound or create, replace, or remove a managed target around it',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A target in another unit likewise remains authoritative but makes the bundle incompatible: never compare, convert, copy, or derive from its raw value',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'use ordinary text with no card or managed Goal mutation, and ask no question on a scheduled closeout',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      "For the exact card localDate, require the containing active Goal window and each target's optional startAt/targetAt interval to include that date, with inclusive boundaries",
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'use the selected capture date for a scheduled closeout, which may differ from the occurrence date for a historical catch-up, or the explicitly requested date, never wall-clock today',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Ignore out-of-window targets for current authority and conflicts, and never expose, compare, copy, derive from, or mutate a Goal because of them.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'nutrition-strategy/references/daily-nutrition-card-safety.md',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'before every daily_nutrition attachment, even with five active goals or on a scheduled closeout',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Before deriving, saving, or surfacing numeric nutrition goals, before activating a paused nutrition proposal, and before every daily_nutrition attachment',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'First run vault-cli memory show --format json and inspect the complete canonical Identity, Preferences, Instructions, and Context memory document for explicit, unambiguous safety facts; the context snapshot does not inject it',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'vault-cli measurement entry list --metric pregnancy-test --from <300-days-before-today> --to <today> --limit 200 --format json',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'vault-cli event list --kind test --from <300-days-before-today> --to <today> --limit 200 --format json',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'vault-cli event list --kind procedure --limit 200 --format json',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'vault-cli event list --kind encounter --limit 200 --format json',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'use event show for every item whose list data reports nonzero diagnosesCount',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A safety-relevant active diagnosis with documented or suspected certainty suppresses numeric output.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A failed, unreadable, or exactly 200-record encounter read, or a failed required detail read, fails closed with no Goal or measurement mutation and no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Inspect every returned item; use event show for an item whose procedure or status is missing or truncated.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A completed gastric bypass, Roux-en-Y, sleeve gastrectomy, gastric sleeve, biliopancreatic diversion, duodenal switch, adjustable gastric band, lap band, or other explicit bariatric surgery suppresses numeric output.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A failed, unreadable, or exactly 200-record procedure read, or a failed required detail read, fails closed with no Goal or measurement mutation and no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'any such positive wins over negative evidence from either pregnancy-evidence owner in the window and suppresses numeric output without diagnosing pregnancy',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A failed, unreadable, or exactly 200-record pregnancy-test read fails closed with no Goal or measurement mutation and no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Otherwise event show every returned test because list output compacts results and can truncate summaries',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'as positive evidence unless resultStatus is pending',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Canonical resultStatus unknown classifies the result rather than source lifecycle and may qualify only with that strict identity plus explicit text.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Do not infer pregnancy from numeric hCG, reference ranges, abnormal or unknown status/flags alone, titles, notes, or ambiguous or negated text.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A failed or unreadable memory read fails closed with ordinary non-numeric text, no Goal or measurement mutation, and no card; leave an existing paused proposal unchanged',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A clearly current saved age under 18 or clearly current intuitive-eating or number-sensitive preference uses the same suppression path',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Missing, stale, ambiguous, or conflicting age alone is unavailable evidence, not a universal block; scheduled occurrences never ask',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Run both vault-cli condition list --status active --limit 200 --format json and vault-cli regimen list --status active --limit 200 --format json',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'If either read fails or returns exactly 200 records, run no condition or regimen detail reads and fail closed with ordinary non-numeric text, no Goal or measurement mutation, and no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'run vault-cli condition show <condition-id> --format json for every returned active condition and vault-cli regimen show <regimen-id> --format json for every returned active regimen',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'never select by title, substance, severity, context-snapshot visibility, or the default list prefix',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'If any required detail read fails or is unreadable, use the same fail-closed behavior',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'As part of that same pre-numeric and pre-activation gate, also run its bounded lossless vault-cli measurement entry list read over the canonical 45-day window',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A usable adult BMI below 18.5, including height and weight rows sharing one eventId, suppresses numeric proposal derivation or presentation, every Goal write or activation, and the card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'A failed read, or a saturated read that cannot resolve usable BMI evidence, fails closed with ordinary non-numeric text, no Goal or measurement mutation, and no card; leave an existing paused proposal unchanged',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'known underweight, frailty, malnutrition risk, glucose-lowering medication, safety-relevant disease or clinician-managed nutrition context, and calorie targets below 1,200 kcal/day without flooring them upward',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'nutrition-strategy/references/daily-nutrition-card-goals.md',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Save one paused canonical proposal',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'explain its values, reasoning, and effective date in ordinary text with no card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'On first creation, set Goal window.startAt explicitly: use a member-requested effective date when present, otherwise the selected card localDate for a dated card request, otherwise the engine-supplied current vault-local date; never rely on the write-day default',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Preserve that window on every later edit, activation, or card request and never silently rebase it to another card date',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'An explicit numeric-card request or the one first eligible managed closeout authorizes only the goal-aware workflow\'s paused canonical proposal, not activation or use',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'hold applicable, compatible exact point targets fixed, derive missing macros from residual calories, and require every AMDR plus a 50 kcal energy tolerance before any Goal write',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'an infeasible bundle means ordinary text and no mutation',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'activate it only after member acceptance',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Any derived target addition or change atomically pauses the complete managed bundle until acceptance',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'its next unambiguous acceptance may complete that pending request only after the complete safety recheck passes, then activation and readback, and a fresh same-date totals read',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Scheduled authority never permits questions or activation; only the first eligible managed meal closeout may create and explain one paused proposal',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'if the complete all-status Goal read proves the stable managed slug has never existed and already-known inputs pass the complete safety and derivation contracts',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'once that Goal exists in any status, scheduled turns never create, change, or automatically repeat it.',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'Explicit active targets win metric by metric',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'one consolidated question, never a goal-less card',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'conflicts, thresholds, ranges, unsafe numbers, or missing responsible calorie inputs',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).not.toContain(
      'available only to the managed private-direct closeout',
    )
  })

  it('uses the strict card contract at the model-facing boundary', () => {
    expect(readCardToolRequest({ card: CARD })).toEqual({
      card: CARD,
      kind: 'attach-response-card',
    })
    expect(readCardToolRequest({ card: LEGACY_CARD_V1 })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest({ card: CHALLENGE_CARD })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest(CHALLENGE_CARD_AUTHORING_INPUT)).toEqual({
      input: CHALLENGE_CARD_AUTHORING_INPUT,
      kind: 'attach-group-challenge-response-card',
    })
    expect(readCardToolRequest({
      challengeSlug: CHALLENGE_CARD_AUTHORING_INPUT.challengeSlug,
      participantObservations:
        CHALLENGE_CARD_AUTHORING_INPUT.participantObservations,
    })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest({
      ...CHALLENGE_CARD_AUTHORING_INPUT,
      entries: CHALLENGE_CARD.entries,
    })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest({ card: REALISTIC_LATE_WORKOUT_CARD })).toEqual({
      card: REALISTIC_LATE_WORKOUT_CARD,
      kind: 'attach-response-card',
    })
    expect(readCardToolRequest(
      { card: ROUTINE_CARD },
      'attach_exercise_routine_card',
    )).toEqual({
      card: ROUTINE_CARD,
      kind: 'attach-response-card',
    })
    expect(readCardToolRequest(
      { card: CARD },
      'attach_exercise_routine_card',
    )).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest(
      { card: TELEGRAM_RICH_CONTENT_CARD },
      'attach_telegram_rich_content',
    )).toEqual({
      card: TELEGRAM_RICH_CONTENT_CARD,
      kind: 'attach-response-card',
    })
    expect(readCardToolRequest(
      { card: TELEGRAM_RICH_CONTENT_CARD },
      'attach_response_card',
    )).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest(
      {
        card: {
          ...TELEGRAM_RICH_CONTENT_CARD,
          html: '<h2>Travel prep</h2><img src="https://example.test/a.png">',
        },
      },
      'attach_telegram_rich_content',
    )).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    const ordinaryTable = {
      kind: 'compact_table',
      version: 1,
      title: 'Weekly plan',
      subtitle: 'Three sessions',
      rowHeader: 'Day',
      columns: ['Focus'],
      rows: [{ label: 'Monday', values: ['Upper body'] }],
      footer: null,
      tracking: null,
    } satisfies AssistantResponseCard
    expect(readCardToolRequest({ card: ordinaryTable })).toEqual({
      card: ordinaryTable,
      kind: 'attach-response-card',
    })
    expect(readCardToolRequest({
      card: {
        ...REALISTIC_LATE_WORKOUT_CARD,
        subtitle: '18/24 sets complete',
      },
    })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest({ card: CARD, extra: true })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest({
      card: {
        ...CARD,
        kind: 'unknown_card',
      },
    })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })

    for (const metric of [
      'calories',
      'proteinGrams',
      'carbsGrams',
      'fatGrams',
      'fiberGrams',
    ] as const) {
      expect(readCardToolRequest({
        card: {
          ...CARD,
          goals: {
            ...CARD.goals,
            [metric]: null,
          },
        },
      })).toMatchObject({ kind: 'invalid-response-card-arguments' })
    }
    expect(readCardToolRequest({
      card: {
        ...CARD,
        goals: {
          calories: null,
          proteinGrams: null,
          carbsGrams: null,
          fatGrams: null,
          fiberGrams: null,
        },
      },
    })).toMatchObject({ kind: 'invalid-response-card-arguments' })

    const contradictoryCard = {
      ...CARD,
      totals: {
        ...CARD.totals,
        calories: { total: 2_300, mealCount: 3 },
      },
      goals: {
        ...CARD.goals,
        calories: { target: 2_000, status: 'under_target' },
      },
    }
    expect(readCardToolRequest({ card: contradictoryCard })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
    expect(readCardToolRequest({
      card: {
        ...contradictoryCard,
        goals: {
          ...contradictoryCard.goals,
          calories: { target: 2_000, status: 'over_target' },
        },
      },
    })).toMatchObject({
      kind: 'attach-response-card',
    })
  })

  it('selects trusted full-text recovery only for a semantic workout that exceeds the envelope', async () => {
    const request = readCardToolRequest({ card: OVERSIZED_WORKOUT_CARD })
    expect(request).toEqual({
      card: OVERSIZED_WORKOUT_CARD,
      kind: 'response-card-envelope-too-large',
    })
    if (request === null) {
      throw new TypeError('Expected an oversized workout card request.')
    }

    const result = await executeCardTool({ request })
    expect(result).toMatchObject({
      responseCardTextFallbackPatch: { card: OVERSIZED_WORKOUT_CARD },
      rpcResult: {
        contentItems: [{
          text: 'workout card envelope too large; full text recovery selected',
          type: 'inputText',
        }],
        success: true,
      },
    })
    expect(result).not.toHaveProperty('responseCardPatch')

    const invalidWorkout = {
      ...OVERSIZED_WORKOUT_CARD,
      workout: {
        ...OVERSIZED_WORKOUT_CARD.workout,
        exercises: Array.from({ length: 17 }, (_, exerciseIndex) => ({
          name: `Invalid exercise ${exerciseIndex + 1}`,
          sets: [{ status: 'pending', target: null, actual: null }],
        })),
      },
    }
    expect(readCardToolRequest({ card: invalidWorkout })).toMatchObject({
      kind: 'invalid-response-card-arguments',
    })
  })

  it('enforces audience-specific card kinds without weakening duplicate checks', async () => {
    const groupNutrition = await executeCardTool({
      privateDirectResponseCardAllowed: false,
      telegramPresentationResponseCardAllowed: true,
    })
    expect(groupNutrition.rpcResult).toEqual({
      contentItems: [{
        text: 'response cards require a private direct conversation',
        type: 'inputText',
      }],
      success: false,
    })

    const groupRoutine = await executeCardTool({
      privateDirectResponseCardAllowed: false,
      request: {
        card: ROUTINE_CARD,
        kind: 'attach-response-card',
      },
      telegramPresentationResponseCardAllowed: true,
    })
    expect(groupRoutine).toMatchObject({
      responseCardPatch: { card: ROUTINE_CARD },
      rpcResult: { success: true },
    })

    const groupRichContent = await executeCardTool({
      privateDirectResponseCardAllowed: false,
      request: {
        card: TELEGRAM_RICH_CONTENT_CARD,
        kind: 'attach-response-card',
      },
      telegramPresentationResponseCardAllowed: true,
    })
    expect(groupRichContent).toMatchObject({
      responseCardPatch: { card: TELEGRAM_RICH_CONTENT_CARD },
      rpcResult: { success: true },
    })

    const privateChallenge = await executeCardTool({
      request: {
        card: CHALLENGE_CARD,
        kind: 'attach-response-card',
      },
    })
    expect(privateChallenge.rpcResult).toEqual({
      contentItems: [{
        text: 'challenge standings response cards require page-authorized observation input',
        type: 'inputText',
      }],
      success: false,
    })

    const vaultRoot = await createChallengeVault()
    const groupRequest = await readCurrentChallengeCardToolRequest(vaultRoot)
    if (
      !groupRequest
      || groupRequest.kind !== 'attach-group-challenge-response-card'
    ) {
      throw new TypeError('Expected a page-authorized challenge card request.')
    }
    const groupChallenge = await executeCardTool({
      groupChallengeResponseCardAllowed: true,
      groupSharedReadTurnState: COMPLETE_GROUP_READ_STATE,
      privateDirectResponseCardAllowed: false,
      request: groupRequest,
      vaultRoot,
    })
    expect(groupChallenge).toMatchObject({
      responseCardPatch: { card: CHALLENGE_CARD },
      rpcResult: { success: true },
    })
    const persisted = await getKnowledgePage({
      slug: 'weird-health-week',
      vault: vaultRoot,
    })
    expect(persisted.page.body).toContain(
      'murph:challenge-standings-snapshot:v1:start',
    )
    expect(persisted.page.body).toContain('"rulesRevision": 1')
    expect(persisted.page.body).toContain('"verifiedPoints": 120')

    const incompleteGroupChallenge = await executeCardTool({
      groupChallengeResponseCardAllowed: true,
      groupSharedReadTurnState: {
        ...COMPLETE_GROUP_READ_STATE,
        invalid: true,
      },
      privateDirectResponseCardAllowed: false,
      request: groupRequest,
      vaultRoot,
    })
    expect(incompleteGroupChallenge).not.toHaveProperty('responseCardPatch')
    expect(incompleteGroupChallenge.rpcResult).toEqual({
      contentItems: [{
        text: 'challenge standings response cards require one complete stable shared-read proof and a successfully persisted canonical snapshot; answer with a truthful ordinary-text update',
        type: 'inputText',
      }],
      success: false,
    })

    const first = await executeCardTool({})
    expect(first).toMatchObject({
      responseCardPatch: { card: CARD },
      rpcResult: { success: true },
    })
    expect(JSON.stringify(first.rpcResult)).not.toContain('1490.25')

    const second = await executeCardTool({ currentResponseCard: CARD })
    expect(second.rpcResult).toEqual({
      contentItems: [{
        text: 'a response card is already attached',
        type: 'inputText',
      }],
      success: false,
    })
  })

  it('hydrates active workout cards with trusted exact editor state', async () => {
    const fixture = await createLiveWorkoutCardVault()
    const result = await executeCardTool({
      request: {
        card: fixture.card,
        kind: 'attach-response-card',
      },
      vaultRoot: fixture.root,
    })

    expect(result.responseCardPatch?.card).toMatchObject({
      editor: {
        version: 1,
        exercises: [{
          unitOverride: 'lb',
          sets: [
            {
              logged: true,
              result: {
                kind: 'weight_reps',
                reps: 0,
                weight: 0,
                weightUnit: null,
              },
            },
            {
              logged: true,
              result: {
                kind: 'weight_reps',
                reps: 8,
                weight: 185,
                weightUnit: 'lb',
              },
            },
            {
              logged: false,
              result: null,
            },
          ],
        }],
      },
    })
  })

  it('keeps ambiguous duplicate exercise coordinates on the V4 card', async () => {
    const fixture = await createLiveWorkoutCardVault({
      ambiguousDuplicate: true,
    })
    const attached = await executeCardTool({
      request: {
        card: fixture.card,
        kind: 'attach-response-card',
      },
      vaultRoot: fixture.root,
    })
    const card = attached.responseCardPatch?.card
    if (!card || card.kind !== 'compact_table' || !('workout' in card)) {
      throw new TypeError('Expected the attached workout card.')
    }

    expect(card).not.toHaveProperty('editor')
    const delivery = await persistWorkoutCardThroughLinq({
      card,
      idSuffix: 'ambiguous-duplicate',
      vaultRoot: fixture.root,
    })
    expect(delivery.envelope.schemaVersion).toBe(4)
  })

  it('keeps a hidden canonical note out of the persisted card and Linq request', async () => {
    const hiddenNote = 'n'.repeat(41)
    const fixture = await createLiveWorkoutCardVault({ hiddenNote })
    const attached = await executeCardTool({
      request: {
        card: fixture.card,
        kind: 'attach-response-card',
      },
      vaultRoot: fixture.root,
    })
    const card = attached.responseCardPatch?.card
    if (!card || card.kind !== 'compact_table' || !('workout' in card)) {
      throw new TypeError('Expected the attached workout card.')
    }

    expect(card).not.toHaveProperty('editor')
    expect(JSON.stringify(card)).not.toContain(hiddenNote)

    const delivery = await persistWorkoutCardThroughLinq({
      card,
      idSuffix: 'note-privacy',
      vaultRoot: fixture.root,
    })

    expect(delivery.persistedCard).not.toHaveProperty('editor')
    expect(JSON.stringify(delivery.persistedCard)).not.toContain(hiddenNote)
    expect(JSON.stringify(delivery.request)).not.toContain(hiddenNote)
    expect(delivery.envelope.schemaVersion).toBe(4)
    expect(JSON.stringify(delivery.envelope)).not.toContain(hiddenNote)
  })

  it.each([
    {
      actual: '60 seconds',
      canonical: { durationSeconds: 60 },
      label: 'duration',
      mode: 'duration' as const,
    },
    {
      actual: '500 meters in 120 seconds',
      canonical: { distanceMeters: 500, durationSeconds: 120 },
      label: 'distance and duration',
      mode: 'cardio' as const,
    },
    {
      actual: '8 reps with 20 kg assistance',
      canonical: { assistanceKg: 20, reps: 8 },
      label: 'assistance',
      mode: 'assisted_bodyweight' as const,
    },
    {
      actual: '8 reps at 80 kg bodyweight',
      canonical: { bodyweightKg: 80, reps: 8 },
      label: 'bodyweight',
      mode: 'bodyweight' as const,
    },
    {
      actual: '8 reps with 10 kg added',
      canonical: { addedWeightKg: 10, reps: 8 },
      label: 'added load',
      mode: 'weighted_bodyweight' as const,
    },
    {
      actual: 'RPE 8',
      canonical: { rpe: 8 },
      label: 'RPE',
    },
    {
      actual: '100 kg × 8 at RPE 8',
      canonical: { reps: 8, rpe: 8, weight: 100 },
      label: 'mixed RPE',
    },
    {
      actual: '8 reps · Slow tempo',
      canonical: { note: 'Slow tempo', reps: 8 },
      label: 'mixed note',
    },
  ])('preserves a canonical $label result through the V4 delivery path', async (fixtureInput, testIndex) => {
    const fixture = await createLiveWorkoutCardVault({
      unsupportedSet: fixtureInput,
    })
    const attached = await executeCardTool({
      request: {
        card: fixture.card,
        kind: 'attach-response-card',
      },
      vaultRoot: fixture.root,
    })
    const card = attached.responseCardPatch?.card
    if (!card || card.kind !== 'compact_table' || !('workout' in card)) {
      throw new TypeError('Expected the attached workout card.')
    }
    expect(card).not.toHaveProperty('editor')
    expect(card.workout.exercises[0]?.sets[0]?.actual)
      .toBe(fixtureInput.actual)

    const delivery = await persistWorkoutCardThroughLinq({
      card,
      idSuffix: `unsupported-${testIndex}`,
      vaultRoot: fixture.root,
    })
    expect(delivery.persistedCard).not.toHaveProperty('editor')
    expect(delivery.persistedCard.workout.exercises[0]?.sets[0]?.actual)
      .toBe(fixtureInput.actual)
    expect(delivery.persisted?.message).toContain(fixtureInput.actual)
    expect(delivery.request.message.parts[0]?.fallback_text).toContain('workout')
    expect(delivery.envelope.schemaVersion).toBe(4)
    expect(JSON.stringify(delivery.envelope)).toContain(fixtureInput.actual)
  })

  it('refuses group cards without a complete read, authorized participants, backed definition scopes, or canonical page', async () => {
    const vaultRoot = await createChallengeVault()
    const request = await readCurrentChallengeCardToolRequest(vaultRoot)
    if (!request || request.kind !== 'attach-group-challenge-response-card') {
      throw new TypeError('Expected a page-authorized challenge card request.')
    }
    const unbackedScopeDefinition = {
      ...CHALLENGE_DEFINITION,
      scorecard: {
        components: [{
          ...CHALLENGE_DEFINITION.scorecard.components[0],
          projectionScopeKeys: ['sleep-times.v0'],
        }],
      },
    }
    const unbackedScopeVault = await createChallengeVault({
      definition: unbackedScopeDefinition,
    })
    const unbackedScopeRequest = await readCurrentChallengeCardToolRequest(
      unbackedScopeVault,
    )
    if (
      !unbackedScopeRequest
      || unbackedScopeRequest.kind !== 'attach-group-challenge-response-card'
    ) {
      throw new TypeError('Expected a page-authorized challenge card request.')
    }
    const cases = [
      {
        state: createEmptyGroupReadState(),
        vaultRoot,
      },
      {
        state: {
          ...COMPLETE_GROUP_READ_STATE,
          roster: [{ displayName: 'Jon', participantId: 'participant_jon' }],
        },
        vaultRoot,
      },
      {
        request: unbackedScopeRequest,
        state: COMPLETE_GROUP_READ_STATE,
        vaultRoot: unbackedScopeVault,
      },
      {
        state: COMPLETE_GROUP_READ_STATE,
        vaultRoot: await createChallengeVault({ withPage: false }),
      },
    ]

    for (const scenario of cases) {
      if (
        scenario.request
        && scenario.request.kind !== 'attach-group-challenge-response-card'
      ) {
        throw new TypeError('Expected a valid group-card request shape.')
      }
      const result = await executeCardTool({
        groupChallengeResponseCardAllowed: true,
        groupSharedReadTurnState: scenario.state,
        privateDirectResponseCardAllowed: false,
        request: scenario.request ?? request,
        vaultRoot: scenario.vaultRoot,
      })
      expect(result).not.toHaveProperty('responseCardPatch')
      expect(result.rpcResult).toMatchObject({
        contentItems: [{
          text: expect.stringContaining('complete stable shared-read proof'),
        }],
        success: false,
      })
    }
  })

  it('requires one structured challenge page and leaves rejected pages byte-identical', async () => {
    const request = readCardToolRequest(CHALLENGE_CARD_AUTHORING_INPUT)
    if (!request || request.kind !== 'attach-group-challenge-response-card') {
      throw new TypeError('Expected a page-authorized group-card request.')
    }
    const mismatchedDigestSection = renderGroupChallengeDefinitionSection(
      CHALLENGE_DEFINITION,
    ).replace(
      digestGroupChallengeDefinition(CHALLENGE_DEFINITION),
      'f'.repeat(64),
    )
    const vaults = [
      await createChallengeVault({ pageType: 'concept' }),
      await createChallengeVault({
        body: 'A legacy challenge page without a structured definition.',
      }),
      await createChallengeVault({
        body: [
          'Malformed prospective definition.',
          '',
          '<!-- murph:group-challenge-definition:v1:start -->',
          '## Challenge definition',
          '',
          '```json',
          '{"version":1}',
          '```',
          '<!-- murph:group-challenge-definition:v1:end -->',
        ].join('\n'),
      }),
      await createChallengeVault({
        body: [
          'A challenge page with a mismatched definition digest.',
          '',
          mismatchedDigestSection,
        ].join('\n'),
      }),
    ]

    for (const vaultRoot of vaults) {
      const before = await getKnowledgePage({
        slug: 'weird-health-week',
        vault: vaultRoot,
      })
      const result = await executeCardTool({
        groupChallengeResponseCardAllowed: true,
        groupSharedReadTurnState: COMPLETE_GROUP_READ_STATE,
        privateDirectResponseCardAllowed: false,
        request,
        vaultRoot,
      })
      const after = await getKnowledgePage({
        slug: 'weird-health-week',
        vault: vaultRoot,
      })
      expect(result).not.toHaveProperty('responseCardPatch')
      expect(result.rpcResult.success).toBe(false)
      expect(after.page.markdown).toBe(before.page.markdown)
    }
  })

  it('binds normalized observations to one exact same-shape definition revision', async () => {
    const vaultRoot = await createChallengeVault()
    const request = await readCurrentChallengeCardToolRequest(vaultRoot)
    if (!request || request.kind !== 'attach-group-challenge-response-card') {
      throw new TypeError('Expected a page-authorized group-card request.')
    }
    const revisionBDefinition = {
      ...CHALLENGE_DEFINITION,
      rulesRevision: 2,
      scorecard: {
        components: [{
          ...CHALLENGE_DEFINITION.scorecard.components[0],
          evaluationRule: 'Sum settled shared steps in the revised window.',
          points: 4,
        }],
      },
    }
    let winningMarkdown: string | null = null
    let replaced = false
    const result = await executeCardTool({
      groupChallengeResponseCardAllowed: true,
      groupSharedReadTurnState: COMPLETE_GROUP_READ_STATE,
      knowledgePageReadTextFile: async (filePath) => {
        if (!replaced) {
          replaced = true
          await upsertKnowledgePage({
            body: [
              'A concurrent ruling changed the challenge.',
              '',
              renderGroupChallengeDefinitionSection(revisionBDefinition),
            ].join('\n'),
            pageType: 'challenge',
            slug: 'weird-health-week',
            title: 'Updated Weird Health Week',
            vault: vaultRoot,
          })
          winningMarkdown = await readFile(filePath, 'utf8')
        }
        return await readFile(filePath, 'utf8')
      },
      privateDirectResponseCardAllowed: false,
      request,
      vaultRoot,
    })

    expect(replaced).toBe(true)
    expect(result).not.toHaveProperty('responseCardPatch')
    expect(result.rpcResult.success).toBe(false)
    const current = await getKnowledgePage({
      slug: 'weird-health-week',
      vault: vaultRoot,
    })
    expect(current.page.markdown).toBe(winningMarkdown)
    expect(current.page.title).toBe('Updated Weird Health Week')
    expect(current.page.body).toContain('"rulesRevision": 2')
    expect(current.page.body).not.toContain(
      'murph:challenge-standings-snapshot:v1:start',
    )

    const revisionBRequest = await readCurrentChallengeCardToolRequest(
      vaultRoot,
      {
        ...CHALLENGE_CARD_AUTHORING_INPUT,
        participantObservations: [{
          components: [{
            componentId: 'steps',
            quantity: 5_000,
            status: 'available',
          }],
          participantId: 'participant_maya',
        }],
      },
    )
    if (
      !revisionBRequest
      || revisionBRequest.kind !== 'attach-group-challenge-response-card'
    ) {
      throw new TypeError('Expected a revision-bound group-card request.')
    }
    const retried = await executeCardTool({
      groupChallengeResponseCardAllowed: true,
      groupSharedReadTurnState: COMPLETE_GROUP_READ_STATE,
      privateDirectResponseCardAllowed: false,
      request: revisionBRequest,
      vaultRoot,
    })
    expect(retried.responseCardPatch?.card).toMatchObject({
      entries: [{ label: 'Maya', points: 200 }],
      kind: 'challenge_standings',
      title: 'Updated Weird Health Week',
    })
    const retriedPage = await getKnowledgePage({
      slug: 'weird-health-week',
      vault: vaultRoot,
    })
    expect(retriedPage.page.body).toContain(
      `"definitionDigest": "${digestGroupChallengeDefinition(revisionBDefinition)}"`,
    )
    expect(retriedPage.page.body).toContain('"rulesRevision": 2')
  })

  it.each([
    {
      afterLines: [
        '## Cumulative settlement',
        '',
        '- participant: participant_maya',
        '- settledThroughDate: 2026-08-09',
        '- cumulativeQuantity: 60000',
      ],
      beforeLines: [
        '## Cumulative settlement',
        '',
        '- participant: participant_maya',
        '- settledThroughDate: 2026-08-08',
        '- cumulativeQuantity: 50000',
      ],
      expectedAfter: 'cumulativeQuantity: 60000',
      stateKind: 'cumulative settlement',
    },
    {
      afterLines: [
        '## Baselines',
        '',
        '- participant_maya steps baseline: 41000',
      ],
      beforeLines: [
        '## Baselines',
        '',
        '- participant_maya steps baseline: 40000',
      ],
      expectedAfter: 'steps baseline: 41000',
      stateKind: 'baseline',
    },
    {
      afterLines: [
        '## Window & publishing',
        '',
        '- scoringThroughDate: 2026-08-09',
        '- publishAfter: 2026-08-10T13:00:00Z',
      ],
      beforeLines: [
        '## Window & publishing',
        '',
        '- scoringThroughDate: 2026-08-08',
        '- publishAfter: 2026-08-09T13:00:00Z',
      ],
      expectedAfter: 'publishAfter: 2026-08-10T13:00:00Z',
      stateKind: 'window and publishing cutoff',
    },
  ])('rejects observations from an older same-definition $stateKind page revision', async ({
    afterLines,
    beforeLines,
    expectedAfter,
  }) => {
    const vaultRoot = await createChallengeVault({
      body: [
        'The current challenge rules and room canon.',
        '',
        renderGroupChallengeDefinitionSection(CHALLENGE_DEFINITION),
        '',
        ...beforeLines,
      ].join('\n'),
    })
    const request = await readCurrentChallengeCardToolRequest(vaultRoot)
    if (!request || request.kind !== 'attach-group-challenge-response-card') {
      throw new TypeError('Expected a page-authorized group-card request.')
    }
    let winningMarkdown: string | null = null
    let replaced = false
    const result = await executeCardTool({
      groupChallengeResponseCardAllowed: true,
      groupSharedReadTurnState: COMPLETE_GROUP_READ_STATE,
      knowledgePageReadTextFile: async (filePath) => {
        if (!replaced) {
          replaced = true
          await upsertKnowledgePage({
            body: [
              'The current challenge rules and room canon.',
              '',
              renderGroupChallengeDefinitionSection(CHALLENGE_DEFINITION),
              '',
              ...afterLines,
            ].join('\n'),
            pageType: 'challenge',
            slug: 'weird-health-week',
            title: 'Weird Health Week',
            vault: vaultRoot,
          })
          winningMarkdown = await readFile(filePath, 'utf8')
        }
        return await readFile(filePath, 'utf8')
      },
      privateDirectResponseCardAllowed: false,
      request,
      vaultRoot,
    })

    expect(replaced).toBe(true)
    expect(result).not.toHaveProperty('responseCardPatch')
    expect(result.rpcResult.success).toBe(false)
    const current = await getKnowledgePage({
      slug: 'weird-health-week',
      vault: vaultRoot,
    })
    expect(current.page.markdown).toBe(winningMarkdown)
    expect(current.page.body).toContain(expectedAfter)
    expect(current.page.body).not.toContain(
      'murph:challenge-standings-snapshot:v1:start',
    )

    const currentRequest = await readCurrentChallengeCardToolRequest(
      vaultRoot,
      {
        ...CHALLENGE_CARD_AUTHORING_INPUT,
        participantObservations: [{
          components: [{
            componentId: 'steps',
            quantity: 5_000,
            status: 'available',
          }],
          participantId: 'participant_maya',
        }],
      },
    )
    if (!currentRequest || currentRequest.kind !== 'attach-group-challenge-response-card') {
      throw new TypeError('Expected a current-page group-card request.')
    }
    const retried = await executeCardTool({
      groupChallengeResponseCardAllowed: true,
      groupSharedReadTurnState: COMPLETE_GROUP_READ_STATE,
      privateDirectResponseCardAllowed: false,
      request: currentRequest,
      vaultRoot,
    })
    expect(retried.responseCardPatch?.card).toMatchObject({
      entries: [{ label: 'Maya', points: 150 }],
      kind: 'challenge_standings',
    })
  })

  it('keeps page-owned participants as a scorer-ordered subset of a larger room', async () => {
    const participantObservations = Array.from({ length: 5 }, (_, index) => ({
      components: [{
        componentId: 'steps',
        quantity: 100,
        status: 'available' as const,
      }],
      participantId: `participant_${index + 1}`,
    }))
    const subsetDefinition = {
      ...CHALLENGE_DEFINITION,
      participants: participantObservations.map((participant) => ({
        participantId: participant.participantId,
        state: 'in' as const,
      })),
    }
    const roomRoster = [
      ...Array.from({ length: 4 }, (_, index) => ({
        displayName: `Room only ${index + 1}`,
        participantId: `participant_room_only_${index + 1}`,
      })),
      ...[...participantObservations].reverse().map((participant) => ({
        displayName: `Challenge ${participant.participantId.slice(-1)}`,
        participantId: participant.participantId,
      })),
    ]
    const vaultRoot = await createChallengeVault({
      definition: subsetDefinition,
    })
    const request = await readCurrentChallengeCardToolRequest(vaultRoot, {
      ...CHALLENGE_CARD_AUTHORING_INPUT,
      participantObservations: [...participantObservations].reverse(),
    })
    if (!request || request.kind !== 'attach-group-challenge-response-card') {
      throw new TypeError('Expected a subset group-card request.')
    }
    const result = await executeCardTool({
      groupChallengeResponseCardAllowed: true,
      groupSharedReadTurnState: {
        invalid: false,
        readProjectionScopeKeyBatches: [['steps-days.v0']],
        roster: roomRoster,
      },
      privateDirectResponseCardAllowed: false,
      request,
      vaultRoot,
    })
    expect(result.responseCardPatch?.card).toMatchObject({
      entries: participantObservations.map((participant) => ({
        label: `Challenge ${participant.participantId.slice(-1)}`,
      })),
      kind: 'challenge_standings',
    })
    const persisted = await getKnowledgePage({
      slug: 'weird-health-week',
      vault: vaultRoot,
    })
    expect(persisted.page.body).toContain('"participant_5"')
    expect(persisted.page.body).not.toContain('participant_room_only')
    const snapshotBody = persisted.page.body.slice(
      persisted.page.body.indexOf('murph:challenge-standings-snapshot:v1:start'),
    )
    expect(snapshotBody.indexOf('participant_1')).toBeLessThan(
      snapshotBody.indexOf('participant_5'),
    )
  })

  it('rejects duplicate, missing, or nonparticipant observations', async () => {
    const vaultRoot = await createChallengeVault()
    const cases = [
      [
        CHALLENGE_CARD_AUTHORING_INPUT.participantObservations[0],
        CHALLENGE_CARD_AUTHORING_INPUT.participantObservations[0],
      ],
      [{
        ...CHALLENGE_CARD_AUTHORING_INPUT.participantObservations[0],
        participantId: 'participant_unknown',
      }],
      [
        CHALLENGE_CARD_AUTHORING_INPUT.participantObservations[0],
        {
          ...CHALLENGE_CARD_AUTHORING_INPUT.participantObservations[0],
          participantId: 'participant_room_only',
        },
      ],
    ]
    for (const participantObservations of cases) {
      const request = await readCurrentChallengeCardToolRequest(vaultRoot, {
        ...CHALLENGE_CARD_AUTHORING_INPUT,
        participantObservations,
      })
      if (!request || request.kind !== 'attach-group-challenge-response-card') {
        throw new TypeError('Expected a valid group-card request shape.')
      }
      const result = await executeCardTool({
        groupChallengeResponseCardAllowed: true,
        groupSharedReadTurnState: COMPLETE_GROUP_READ_STATE,
        privateDirectResponseCardAllowed: false,
        request,
        vaultRoot,
      })
      expect(result).not.toHaveProperty('responseCardPatch')
      expect(result.rpcResult.success).toBe(false)
    }

    const waitingDefinition = {
      ...CHALLENGE_DEFINITION,
      participants: [
        CHALLENGE_DEFINITION.participants[0],
        { participantId: 'participant_jon', state: 'in' as const },
      ],
    }
    const waitingVault = await createChallengeVault({
      definition: waitingDefinition,
    })
    const waitingRequest = await readCurrentChallengeCardToolRequest(waitingVault)
    if (
      !waitingRequest
      || waitingRequest.kind !== 'attach-group-challenge-response-card'
    ) {
      throw new TypeError('Expected a waiting-participant group-card request.')
    }
    const missingWaiting = await executeCardTool({
      groupChallengeResponseCardAllowed: true,
      groupSharedReadTurnState: {
        ...COMPLETE_GROUP_READ_STATE,
        roster: [
          ...(COMPLETE_GROUP_READ_STATE.roster ?? []),
          { displayName: 'Jon', participantId: 'participant_jon' },
        ],
      },
      privateDirectResponseCardAllowed: false,
      request: waitingRequest,
      vaultRoot: waitingVault,
    })
    expect(missingWaiting).not.toHaveProperty('responseCardPatch')
    expect(missingWaiting.rpcResult.success).toBe(false)
  })

  it('invalidates failed and roster-inconsistent shared-read sequences', async () => {
    const failedState = createEmptyGroupReadState()
    await executeGroupRead({
      response: new Error('shared read failed'),
      state: failedState,
    })
    expect(failedState.invalid).toBe(true)

    const changedRosterState = createEmptyGroupReadState()
    await executeGroupRead({
      response: buildSharedReadResponse(),
      state: changedRosterState,
    })
    await executeGroupRead({
      projectionKind: 'sleep-times.v0',
      response: buildSharedReadResponse({
        participantIds: ['participant_maya', 'participant_jon'],
        projectionScopeKey: 'sleep-times.v0',
      }),
      state: changedRosterState,
    })
    expect(changedRosterState).toMatchObject({
      invalid: true,
      readProjectionScopeKeyBatches: [['steps-days.v0']],
    })

    const changedLabelState = createEmptyGroupReadState()
    await executeGroupRead({
      response: buildSharedReadResponse(),
      state: changedLabelState,
    })
    await executeGroupRead({
      projectionKind: 'sleep-times.v0',
      response: buildSharedReadResponse({
        displayName: 'Different label',
        projectionScopeKey: 'sleep-times.v0',
      }),
      state: changedLabelState,
    })
    expect(changedLabelState.invalid).toBe(true)
  })

  it('persists one stable complete multi-batch proof before attaching', async () => {
    const state = createEmptyGroupReadState()
    await executeGroupRead({
      response: buildSharedReadResponse(),
      state,
    })
    await executeGroupRead({
      projectionKind: 'sleep-times.v0',
      response: buildSharedReadResponse({
        projectionScopeKey: 'sleep-times.v0',
      }),
      state,
    })
    const multiBatchDefinition = {
      ...CHALLENGE_DEFINITION,
      scorecard: {
        components: [
          CHALLENGE_DEFINITION.scorecard.components[0],
          {
            evaluationRule: 'Use settled shared sleep duration.',
            id: 'sleep',
            label: 'Sleep',
            perQuantity: 1,
            points: 5,
            projectionScopeKeys: ['sleep-times.v0'],
            quantityUnit: 'hours',
            settlementMode: 'window-total' as const,
          },
        ],
      },
    }
    const vaultRoot = await createChallengeVault({
      definition: multiBatchDefinition,
    })
    const request = await readCurrentChallengeCardToolRequest(vaultRoot, {
      challengeSlug: 'weird-health-week',
      participantObservations: [{
        components: [
          {
            componentId: 'steps',
            quantity: 4_000,
            status: 'available',
          },
          {
            componentId: 'sleep',
            quantity: 8,
            status: 'available',
          },
        ],
        participantId: 'participant_maya',
      }],
    })
    if (!request || request.kind !== 'attach-group-challenge-response-card') {
      throw new TypeError('Expected a multi-batch group-card request.')
    }
    const result = await executeCardTool({
      groupChallengeResponseCardAllowed: true,
      groupSharedReadTurnState: state,
      privateDirectResponseCardAllowed: false,
      request,
      vaultRoot,
    })
    expect(result).toMatchObject({
      responseCardPatch: {
        card: {
          entries: [{ label: 'Maya', points: 160 }],
          kind: 'challenge_standings',
        },
      },
      rpcResult: { success: true },
    })
    const persisted = await getKnowledgePage({
      slug: 'weird-health-week',
      vault: vaultRoot,
    })
    expect(persisted.page.body).toContain('"steps-days.v0"')
    expect(persisted.page.body).toContain('"sleep-times.v0"')
    expect(persisted.page.body).toContain('"verifiedPoints": 160')
  })

  it('rejects card and response media in either attachment order', async () => {
    const cardAfterMedia = await executeCardTool({ currentResponseMedia: [IMAGE] })
    expect(cardAfterMedia.rpcResult).toEqual({
      contentItems: [{
        text: 'response cards cannot be combined with response media',
        type: 'inputText',
      }],
      success: false,
    })

    const mediaAfterCard = await executeCardTool({
      currentResponseCard: CARD,
      request: {
        kind: 'attach-response-media',
        media: [IMAGE],
      },
    })
    expect(mediaAfterCard.rpcResult).toEqual({
      contentItems: [{
        text: 'response media cannot be combined with a response card',
        type: 'inputText',
      }],
      success: false,
    })
  })
})
