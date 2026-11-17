import { readTestMurphDynamicToolRequest } from './support/codex-app-server.ts'
import { describe, expect, it, vi } from 'vitest'

import type {
  HostedRuntimeLabsLocationsResponse,
  HostedRuntimeLabsOffering,
  HostedRuntimeLabsSearchResponse,
} from '@murphai/hosted-execution/labs'

import {
  executeMurphDynamicToolRequest,
  listMurphDynamicToolNames,
  MURPH_DYNAMIC_TOOLS,
  MURPH_LABS_TOOL,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.js'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.js'

describe('murph.labs dynamic tool', () => {
  it('is exported once and stays default-off', () => {
    expect(resolveMurphDynamicTools({})).not.toContain(MURPH_LABS_TOOL)
    expect(resolveMurphDynamicTools({ labsAvailable: true })).toContain(
      MURPH_LABS_TOOL,
    )
    expect(
      MURPH_DYNAMIC_TOOLS.filter((tool) => tool.name === 'labs'),
    ).toEqual([MURPH_LABS_TOOL])
    expect(
      listMurphDynamicToolNames().filter((name) => name === 'murph.labs'),
    ).toEqual(['murph.labs'])
    expect(MURPH_LABS_TOOL.description).not.toMatch(/junction/iu)
  })

  it('accepts every bounded action', () => {
    expect(readLabsRequest({
      action: 'search',
      kind: 'panel',
      limit: 5,
      query: '  heart health  ',
    })).toEqual({
      kind: 'labs',
      request: {
        action: 'search',
        kind: 'panel',
        limit: 5,
        query: 'heart health',
      },
    })
    expect(readLabsRequest({
      action: 'locations',
      limit: 4,
      radiusMiles: 25,
      zipCode: '10001',
    })).toEqual({
      kind: 'labs',
      request: {
        action: 'locations',
        limit: 4,
        radiusMiles: 25,
        zipCode: '10001',
      },
    })
  })

  it('rejects unknown, unsafe, and out-of-bounds arguments without echoing values', () => {
    for (const argumentsValue of [
      { action: 'search', query: 'x' },
      { action: 'search', limit: 21, query: 'cholesterol' },
      { action: 'search', query: 'private health interest', token: 'raw-secret' },
      { action: 'search', page: 2, query: 'cholesterol' },
      { action: 'show', labId: 10, providerId: 'marker-1' },
      { action: 'locations', labId: 10, zipCode: '10001' },
      { action: 'locations', radiusMiles: 100, zipCode: '10001' },
      { action: 'locations', zipCode: 'private-address' },
    ]) {
      const parsed = readLabsRequest(argumentsValue)
      expect(parsed).toMatchObject({ kind: 'invalid-labs-arguments' })
      const serialized = JSON.stringify(parsed)
      expect(serialized).not.toContain('raw-secret')
      expect(serialized).not.toContain('private health interest')
      expect(serialized).not.toContain('private-address')
    }
  })

  it('forwards cancellation and returns only the strict normalized response', async () => {
    const abortController = new AbortController()
    const labsTool = {
      request: vi.fn(async () => createSearchResponse()),
    }
    const request = readLabsRequest({
      action: 'search',
      limit: 3,
      query: 'cholesterol',
    })
    if (!request || request.kind !== 'labs') {
      throw new Error('Expected a labs request.')
    }

    const result = await executeMurphDynamicToolRequest({
      abortSignal: abortController.signal,
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({ labsTool }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })

    expect(labsTool.request).toHaveBeenCalledWith(
      {
        action: 'search',
        limit: 3,
        query: 'cholesterol',
      },
      { signal: abortController.signal },
    )
    expect(result.rpcResult.success).toBe(true)
    // Discovery-only status and USD are constant and stated by the tool
    // description; markers become names and null fields are omitted.
    expect(readResultPayload(result)).toEqual({
      action: 'search',
      checkedAt: '2026-07-16T12:00:00.000Z',
      items: [{
        name: 'Total cholesterol',
        kind: 'biomarker',
        description: 'A focused cholesterol marker.',
        unit: 'mg/dL',
        catalogPriceUsd: '42.00',
        commonTurnaroundDays: 2,
        maximumTurnaroundDays: 4,
        includedMarkers: ['Total cholesterol'],
        includedMarkerCount: 1,
      }],
    })
    expect(readResultText(result)).not.toMatch(/junction/iu)
    expect(readResultText(result)).not.toMatch(
      /offeringId|providerId|labId|slug|provider/iu,
    )
  })

  it('fails closed with generic text for missing transport, thrown errors, and extra fields', async () => {
    const request = readLabsRequest({
      action: 'search',
      query: 'cholesterol',
    })
    if (!request || request.kind !== 'labs') {
      throw new Error('Expected a labs request.')
    }

    const unavailable = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({}),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })
    expect(unavailable.rpcResult).toMatchObject({ success: false })

    const thrown = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        labsTool: {
          request: vi.fn(async () => {
            throw new Error('raw-secret-provider-error')
          }),
        },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })
    expect(thrown.rpcResult).toMatchObject({ success: false })
    expect(readResultText(thrown)).toBe(
      'lab catalog discovery is temporarily unavailable',
    )
    expect(readResultText(thrown)).not.toContain('raw-secret-provider-error')

    const unsafeResponse = {
      ...createSearchResponse(),
      rawProviderBody: 'raw-secret-provider-body',
    }
    const rejectedExtraField = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        labsTool: {
          request: vi.fn(async () => unsafeResponse),
        },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })
    expect(rejectedExtraField.rpcResult).toMatchObject({ success: false })
    expect(readResultText(rejectedExtraField)).not.toContain(
      'raw-secret-provider-body',
    )

    const locationsRequest = readLabsRequest({
      action: 'locations',
      zipCode: '10001',
    })
    if (!locationsRequest || locationsRequest.kind !== 'labs') {
      throw new Error('Expected a labs locations request.')
    }
    const mismatchedAction = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        labsTool: {
          request: vi.fn(async () => createSearchResponse()),
        },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request: locationsRequest,
    })
    expect(mismatchedAction.rpcResult).toMatchObject({ success: false })
    expect(readResultText(mismatchedAction)).toBe(
      'lab catalog discovery returned an unexpected result',
    )
  })

  it('defaults to five results and bounds descriptions, nulls and coordinates', async () => {
    const labsTool = {
      request: vi.fn(async (request: { action: string }) => request.action === 'search'
        ? {
            ...createSearchResponse(),
            items: Array.from({ length: 20 }, (_, index) => ({
              ...createOffering(),
              catalogPrice: null,
              commonTurnaroundDays: null,
              description: `${index} ${'x'.repeat(7_990)}`,
              name: `Marker ${index}`,
              unit: null,
            })),
          }
        : createLocationsResponse()),
    }
    const search = readLabsRequest({ action: 'search', query: 'cholesterol' })
    if (!search || search.kind !== 'labs') throw new Error('Expected a labs request.')
    const searched = await executeMurphDynamicToolRequest({
      env: {}, fetchImpl: fetch, hostedToolContext: createHostedToolContext({ labsTool }),
      nextUsageOrdinal: () => 0, progressDelivery: null, request: search,
    })
    expect(labsTool.request).toHaveBeenCalledWith(
      { action: 'search', limit: 5, query: 'cholesterol' }, { signal: null },
    )
    // Twenty maximal descriptions used to exceed the result cap and fail.
    expect(searched.rpcResult.success).toBe(true)
    const items = (readResultPayload(searched) as { items: Record<string, unknown>[] }).items
    expect(items).toHaveLength(20)
    expect(items[0]).toEqual({
      name: 'Marker 0', kind: 'biomarker', description: `0 ${'x'.repeat(237)}…`,
      maximumTurnaroundDays: 4, includedMarkers: ['Total cholesterol'], includedMarkerCount: 1,
    })

    const locations = readLabsRequest({ action: 'locations', zipCode: '10001' })
    if (!locations || locations.kind !== 'labs') throw new Error('Expected a labs request.')
    const located = await executeMurphDynamicToolRequest({
      env: {}, fetchImpl: fetch, hostedToolContext: createHostedToolContext({ labsTool }),
      nextUsageOrdinal: () => 0, progressDelivery: null, request: locations,
    })
    expect(labsTool.request).toHaveBeenLastCalledWith(
      { action: 'locations', zipCode: '10001' }, { signal: null },
    )
    expect(readResultPayload(located)).toEqual({
      action: 'locations', checkedAt: '2026-07-16T12:00:00.000Z', status: 'available',
      zipCode: '10001', radiusMiles: 25, homeCollectionAvailable: false,
      locations: [{
        name: 'Synthetic collection site',
        address: { line1: '1 Example St', city: 'New York', state: 'NY', postalCode: '10001' },
        distanceMiles: 0.5,
      }],
    })
  })

  it('fails closed when a valid normalized result exceeds the tool byte cap', async () => {
    const request = readLabsRequest({
      action: 'search',
      limit: 20,
      query: 'cholesterol',
    })
    if (!request || request.kind !== 'labs') {
      throw new Error('Expected a labs request.')
    }
    const oversizedResponse: HostedRuntimeLabsSearchResponse = {
      ...createSearchResponse(),
      items: Array.from({ length: 20 }, (_, index) => ({
        ...createOffering(),
        includedMarkerCount: 40,
        includedMarkers: Array.from({ length: 40 }, (_, marker) => ({
          name: `${marker} ${'x'.repeat(200)}`,
        })),
        name: `Marker ${index}`,
      })),
    }

    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl: fetch,
      hostedToolContext: createHostedToolContext({
        labsTool: {
          request: vi.fn(async () => oversizedResponse),
        },
      }),
      nextUsageOrdinal: () => 0,
      progressDelivery: null,
      request,
    })

    expect(result.rpcResult).toMatchObject({ success: false })
    expect(readResultText(result)).toBe('lab catalog result is too large')
  })
})

function readLabsRequest(argumentsValue: unknown) {
  return readTestMurphDynamicToolRequest({
    method: 'item/tool/call',
    params: {
      arguments: argumentsValue,
      namespace: 'murph',
      tool: 'labs',
      turnId: 'turn-labs-test',
    },
  })
}

function createOffering(): HostedRuntimeLabsOffering {
  return {
    catalogPrice: {
      amount: '42.00',
      currency: 'USD',
    },
    commonTurnaroundDays: 2,
    description: 'A focused cholesterol marker.',
    includedMarkerCount: 1,
    includedMarkers: [{ name: 'Total cholesterol' }],
    kind: 'biomarker',
    maximumTurnaroundDays: 4,
    name: 'Total cholesterol',
    unit: 'mg/dL',
  }
}

function createSearchResponse(): HostedRuntimeLabsSearchResponse {
  return {
    action: 'search',
    checkedAt: '2026-07-16T12:00:00.000Z',
    items: [createOffering()],
    orderableThroughMurph: false,
    orderingStatus: 'discovery_only',
  }
}

function createLocationsResponse(): HostedRuntimeLabsLocationsResponse {
  return {
    action: 'locations',
    checkedAt: '2026-07-16T12:00:00.000Z',
    homeCollectionAvailable: false,
    locations: [{
      address: { city: 'New York', line1: '1 Example St', line2: null, postalCode: '10001', state: 'NY' },
      coordinates: { latitude: 40.75, longitude: -73.99 },
      distanceMiles: 0.5,
      name: 'Synthetic collection site',
      phoneNumber: null,
    }],
    orderableThroughMurph: false,
    orderingStatus: 'discovery_only',
    radiusMiles: 25,
    status: 'available',
    zipCode: '10001',
  }
}

function createHostedToolContext(input: {
  labsTool?: AssistantHostedToolContext['labsTool']
}): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    labsTool: input.labsTool ?? null,
    sendVaultFile: vi.fn(async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    }),
    vaultFileSendAvailable: false,
  }
}

function readResultPayload(
  result: Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>,
): unknown {
  return JSON.parse(readResultText(result))
}

function readResultText(
  result: Awaited<ReturnType<typeof executeMurphDynamicToolRequest>>,
): string {
  const text = result.rpcResult.contentItems[0]?.text
  if (!text) {
    throw new Error('Expected labs tool result text.')
  }
  return text
}
