import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import type { AssistantResponseMedia } from '@murphai/operator-config/assistant-cli-contracts'
import type { AssistantResponseCard } from '@murphai/operator-config/assistant-response-cards'

import {
  executeMurphDynamicToolRequest,
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'

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
  subtitle: 'Day 4 of 7',
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
  footer: null,
  participantLabels: [{
    label: 'Maya',
    participantId: 'participant_maya',
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
  subtitle: 'Day 4 of 7',
  title: 'Weird Health Week',
} as const

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
  groupSharedReadTurnState?: { capacityPartial: boolean } | null
  privateDirectResponseCardAllowed?: boolean | null
  request?: Parameters<typeof executeMurphDynamicToolRequest>[0]['request']
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
  })
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
    expect(groupSchema).toContain('participantLabels')
    expect(groupSchema).toContain('individual')
    expect(groupSchema).toContain('collective')
    expect(groupSchema).not.toContain('challenge_standings')
    expect(groupSchema).not.toContain('verifiedPoints')
    expect(groupSchema).not.toContain('coverageCounts')
    expect(groupSchema).not.toContain('daily_nutrition')
    expect(groupSchema).not.toContain('compact_table')
    expect(groupTool!.description).toContain('runs the deterministic scorer')
    expect(groupTool!.description).toContain(
      'persist its result on the existing challenge page',
    )
    expect(groupTool!.description).toContain(
      'owns points, target, order, coverage, counts, ranks, and ties',
    )
    expect(groupTool!.description).toContain(
      'entire canonical ranked result contains at most eight entries',
    )
    expect(groupTool!.description).toContain('never truncate the ranking')
    expect(groupTool!.description).toContain('never shorten labels to fit the card')
    expect(groupTool!.description).toContain(
      'Subtitle and footer may only copy exact canonical room-facing challenge text',
    )
    expect(groupTool!.description).toContain(
      'never author score, rank, coverage, missing-data, count, or arithmetic claims there',
    )
    expect(groupTool!.description).toContain('nonempty omittedParticipantIds')
    expect(groupTool!.description).toContain('Collective cards have no row cap')
    expect(groupTool!.description).toContain('empty participantLabels array')
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
      card: CHALLENGE_CARD,
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
    const groupChallenge = await executeCardTool({
      groupChallengeResponseCardAllowed: true,
      privateDirectResponseCardAllowed: false,
      request: groupRequest,
    })
    expect(groupChallenge).toMatchObject({
      responseCardPatch: { card: CHALLENGE_CARD },
      rpcResult: { success: true },
    })

    const incompleteGroupChallenge = await executeCardTool({
      groupChallengeResponseCardAllowed: true,
      groupSharedReadTurnState: { capacityPartial: true },
      privateDirectResponseCardAllowed: false,
      request: groupRequest,
    })
    expect(incompleteGroupChallenge).not.toHaveProperty('responseCardPatch')
    expect(incompleteGroupChallenge.rpcResult).toEqual({
      contentItems: [{
        text: 'challenge standings response cards are unavailable after an incomplete shared read; answer with a truthful ordinary-text incomplete update',
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
