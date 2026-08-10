import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { AssistantResponseMedia } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantResponseCard } from '@murphai/operator-config/assistant-response-cards'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'

import {
  executeMurphDynamicToolRequest,
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
  readMurphDynamicToolRequest,
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

const CARD: AssistantResponseCard = {
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

const CARD_V2: AssistantResponseCard = {
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
    carbsGrams: null,
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

const CHALLENGE_CARD_AUTHORING_INPUT = {
  challengeSlug: 'weird-health-week',
  componentProjectionScopeKeys: [{
    componentId: 'steps',
    projectionScopeKeys: ['steps-days.v0'],
  }],
  scoreInput: {
    format: {
      kind: 'individual',
      objective: { kind: 'ranking' },
    },
    participants: [{
      components: [{
        componentId: 'steps',
        quantity: 4_000,
        status: 'available',
      }],
      participantId: 'participant_maya',
    }],
    scorecard: {
      components: [{
        id: 'steps',
        label: 'Steps',
        perQuantity: 100,
        points: 3,
        quantityUnit: 'steps',
      }],
    },
  },
} as const

const COMPLETE_GROUP_READ_STATE: MurphGroupSharedReadTurnState = {
  invalid: false,
  readProjectionScopeKeyBatches: [['steps-days.v0']],
  roster: [{
    displayName: 'Maya',
    participantId: 'participant_maya',
  }],
}

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, { force: true, recursive: true })
  ))
})

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

async function createChallengeVault(withPage = true): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-challenge-card-tool-'))
  cleanupPaths.push(root)
  await createIntegratedVaultServices().core.init({
    requestId: 'challenge-card-tool-test',
    timezone: 'UTC',
    vault: root,
  })
  if (withPage) {
    await upsertKnowledgePage({
      body: 'The current challenge rules and room canon.',
      slug: 'weird-health-week',
      title: 'Weird Health Week',
      vault: root,
    })
  }
  return root
}

function readCardToolRequest(argumentsValue: unknown) {
  return readMurphDynamicToolRequest({
    id: 1,
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: 'attach_response_card',
    },
  })
}

function readGroupToolRequest(argumentsValue: unknown) {
  return readMurphDynamicToolRequest({
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
    expect(privateSchema).not.toContain('challenge_standings')
    expect(groupSchema).toContain('scoreInput')
    expect(groupSchema).toContain('challengeSlug')
    expect(groupSchema).toContain('componentProjectionScopeKeys')
    expect(groupSchema).not.toContain('participantLabels')
    expect(groupSchema).toContain('individual')
    expect(groupSchema).toContain('collective')
    expect(groupSchema).not.toContain('challenge_standings')
    expect(groupSchema).not.toContain('verifiedPoints')
    expect(groupSchema).not.toContain('coverageCounts')
    expect(groupSchema).not.toContain('daily_nutrition')
    expect(groupSchema).not.toContain('compact_table')
    expect(groupTool!.description).toContain('runs the deterministic scorer')
    expect(groupTool!.description).toContain(
      'persists the exact input and result on that same page before attaching',
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
      'one unchanged ordered participant and authorized-label roster across every batch',
    )
    expect(groupTool!.description).toContain('capacity-omitted')
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
      'single active tracked workout whose table was explicitly established earlier',
    )
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).toContain(
      'with no active table or multiple plausible workouts, do not infer authority',
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
    expect(MURPH_ATTACH_RESPONSE_CARD_TOOL.description).not.toContain(
      'available only to the managed private-direct closeout',
    )
  })

  it('uses the strict card contract at the model-facing boundary', () => {
    expect(readCardToolRequest({ card: CARD })).toEqual({
      card: CARD,
      kind: 'attach-response-card',
    })
    expect(readCardToolRequest({ card: CARD_V2 })).toEqual({
      card: CARD_V2,
      kind: 'attach-response-card',
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
      ...CHALLENGE_CARD_AUTHORING_INPUT,
      entries: CHALLENGE_CARD.entries,
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

    const contradictoryCard = {
      ...CARD_V2,
      totals: {
        ...CARD_V2.totals,
        calories: { total: 2_300, mealCount: 3 },
      },
      goals: {
        ...CARD_V2.goals,
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
        text: 'challenge standings response cards require scorer-owned authoring input',
        type: 'inputText',
      }],
      success: false,
    })

    const groupRequest = readCardToolRequest(CHALLENGE_CARD_AUTHORING_INPUT)
    if (
      !groupRequest
      || groupRequest.kind !== 'attach-group-challenge-response-card'
    ) {
      throw new TypeError('Expected a scorer-owned challenge card request.')
    }
    const vaultRoot = await createChallengeVault()
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

  it('refuses group cards without a complete read, exact roster, backed scopes, or canonical page', async () => {
    const request = readCardToolRequest(CHALLENGE_CARD_AUTHORING_INPUT)
    if (!request || request.kind !== 'attach-group-challenge-response-card') {
      throw new TypeError('Expected a scorer-owned challenge card request.')
    }
    const vaultRoot = await createChallengeVault()
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
        request: readCardToolRequest({
          ...CHALLENGE_CARD_AUTHORING_INPUT,
          componentProjectionScopeKeys: [{
            componentId: 'steps',
            projectionScopeKeys: ['sleep-times.v0'],
          }],
        }),
        state: COMPLETE_GROUP_READ_STATE,
        vaultRoot,
      },
      {
        state: COMPLETE_GROUP_READ_STATE,
        vaultRoot: await createChallengeVault(false),
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
    const request = readCardToolRequest({
      challengeSlug: 'weird-health-week',
      componentProjectionScopeKeys: [
        {
          componentId: 'steps',
          projectionScopeKeys: ['steps-days.v0'],
        },
        {
          componentId: 'sleep',
          projectionScopeKeys: ['sleep-times.v0'],
        },
      ],
      scoreInput: {
        format: {
          kind: 'individual',
          objective: { kind: 'ranking' },
        },
        participants: [{
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
        scorecard: {
          components: [
            {
              id: 'steps',
              label: 'Steps',
              perQuantity: 100,
              points: 3,
              quantityUnit: 'steps',
            },
            {
              id: 'sleep',
              label: 'Sleep',
              perQuantity: 1,
              points: 5,
              quantityUnit: 'hours',
            },
          ],
        },
      },
    })
    if (!request || request.kind !== 'attach-group-challenge-response-card') {
      throw new TypeError('Expected a multi-batch group-card request.')
    }
    const vaultRoot = await createChallengeVault()
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
