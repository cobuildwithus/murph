import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { AssistantResponseMedia } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantResponseCard } from '@murphai/operator-config/assistant-response-cards'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'

import {
  executeMurphDynamicToolRequest,
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
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
  subtitle: '18 of 24 sets complete',
  footer: 'Tap an exercise to log or correct a set.',
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

function readCardToolRequest(argumentsValue: unknown) {
  return readTestMurphDynamicToolRequest({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: 'attach_response_card',
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

    for (const tool of [MURPH_ATTACH_RESPONSE_CARD_TOOL, groupTool!]) {
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

  it('describes the private on-demand canonical-read contract', () => {
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'saved instructions for the exact scheduled automation occurrence explicitly request it',
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
    expect(readCardToolRequest({ card: CHALLENGE_CARD })).toEqual({
      card: CHALLENGE_CARD,
      kind: 'attach-response-card',
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

  it('enforces audience-specific card kinds without weakening duplicate checks', async () => {
    const groupNutrition = await executeCardTool({
      privateDirectResponseCardAllowed: false,
    })
    expect(groupNutrition.rpcResult).toEqual({
      contentItems: [{
        text: 'response cards require a private direct conversation',
        type: 'inputText',
      }],
      success: false,
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
