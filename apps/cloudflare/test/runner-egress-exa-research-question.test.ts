import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildExaResearchScoutBatchLaneRequest,
  buildExaResearchScoutRequest,
} from '@murphai/contracts'

import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
  hostedRunnerIntercept,
} from '../src/runner-egress-intercept.ts'
import {
  HOSTED_RUNTIME_ATTEMPT_ID_HEADER,
  HOSTED_RUNTIME_LEASE_GENERATION_HEADER,
  HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER,
  HOSTED_RUNNER_BOUND_USER_ID_HEADER,
} from '../src/runner-outbound/headers.ts'
import type {
  RunnerOutboundEnvironmentSource,
} from '../src/runner-outbound/shared.ts'
import {
  createHostedExecutionTestEnv,
} from './hosted-execution-fixtures.ts'

const WRITE_FENCE_HEADERS = {
  [HOSTED_RUNTIME_ATTEMPT_ID_HEADER]: 'attempt_1',
  [HOSTED_RUNTIME_LEASE_GENERATION_HEADER]: '7',
  [HOSTED_RUNTIME_WORKSPACE_VERSION_HEADER]: '4',
  [HOSTED_RUNNER_BOUND_USER_ID_HEADER]: 'member_123',
} as const

const FOCUSED_QUERY_LABELS_BY_FIELD = {
  topics: 'Topics',
  biomarkers: 'Biomarkers',
  behaviors: 'Behaviors',
  supplements: 'Supplements',
  conditionsOrConcerns: 'Conditions or concerns',
  goals: 'Goals',
  activeExperiments: 'Active experiments',
} as const

const PRIVATE_FOCUSED_VALUES = [
  'sampleperson recurring headaches',
  'TeSt SuBjEcT supplement use'.toLowerCase(),
  'examplelab staff sleep',
  'participant 7304 headache',
  'tenant at 456 sample boulevard',
  'passphrase demo-access',
  'intake summary persistent sleeplessness',
] as const

function createFocusedRequestBody() {
  return buildExaResearchScoutRequest({
    profile: {
      mode: 'focused',
      topics: ['cognition'],
      biomarkers: [],
      behaviors: [],
      supplements: ['creatine'],
      conditionsOrConcerns: ['healthy adults'],
      goals: ['cognitive performance'],
      activeExperiments: [],
    },
    since: '2021-01-01T00:00:00.000Z',
    until: '2026-08-06T00:00:00.000Z',
    maxCandidates: 6,
  })
}

function createLegacyBatchLaneRequestBody() {
  return buildExaResearchScoutBatchLaneRequest({
    profile: {
      topics: ['sleep'],
      biomarkers: ['hs-crp'],
      behaviors: ['morning light'],
      supplements: ['creatine'],
      conditionsOrConcerns: ['healthy adults'],
      goals: ['sleep quality'],
      activeExperiments: ['screen curfew'],
    },
    since: '2021-01-01T00:00:00.000Z',
    until: '2026-08-06T00:00:00.000Z',
    maxCandidates: 6,
  })
}

function createExaTestEnv(validateRuntimeWriteFence: () => Promise<boolean>) {
  return {
    ...createHostedExecutionTestEnv(),
    EXA_API_KEY: 'exa-worker-secret',
    USER_RUNNER: {
      getByName: () => ({
        validateRuntimeWriteFence,
      }),
    },
  } as unknown as RunnerOutboundEnvironmentSource
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('hosted Exa egress for focused structured scopes', () => {
  it('validates and canonicalizes compact focus before injecting the Worker secret', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T12:00:00.000Z'))

    const requestBody = createFocusedRequestBody()
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)
    const validateRuntimeWriteFence = vi.fn(async () => true)

    const response = await hostedRunnerIntercept(
      new Request('https://api.exa.ai/search', {
        body: JSON.stringify(requestBody),
        headers: {
          ...WRITE_FENCE_HEADERS,
          authorization: 'Bearer caller-supplied-token',
          cookie: 'session=caller-cookie',
          'content-type': 'application/json; charset=utf-8',
          'x-api-key': HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
        },
        method: 'POST',
      }),
      createExaTestEnv(validateRuntimeWriteFence),
      { containerId: 'opaque-container-id' },
    )

    expect(response.status).toBe(200)
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: 'attempt_1',
      generation: '7',
      userId: 'member_123',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const forwarded = fetchMock.mock.calls[0]?.[0]
    expect(forwarded).toBeInstanceOf(Request)
    const forwardedRequest = forwarded as Request
    expect(forwardedRequest.url).toBe('https://api.exa.ai/search')
    expect(forwardedRequest.headers.get('x-api-key')).toBe('exa-worker-secret')
    expect(forwardedRequest.headers.has('authorization')).toBe(false)
    expect(forwardedRequest.headers.has('cookie')).toBe(false)
    await expect(forwardedRequest.json()).resolves.toEqual(requestBody)
  })

  it.each([
    "What evidence applies to sampleperson's recurring migraines?",
    "What evidence applies to SAMPLEPERSON's recurring migraines?",
    "What evidence applies to SaMpLePeRsOn's recurring migraines?",
    'What evidence applies to sampleperson taking lithium?',
    'What evidence applies to s a m p l e p e r s o n with recurring migraines?',
  ])('rejects injected arbitrary question prose before upstream fetch: %s', async (privateQuestion) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T12:00:00.000Z'))

    const requestBody = createFocusedRequestBody()
    const unsafeRequestBody = {
      ...requestBody,
      query: `${requestBody.query}\nQuestion: ${privateQuestion}`,
    }
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('unexpected'))
    vi.stubGlobal('fetch', fetchMock)
    const validateRuntimeWriteFence = vi.fn(async () => true)

    const response = await hostedRunnerIntercept(
      new Request('https://api.exa.ai/search', {
        body: JSON.stringify(unsafeRequestBody),
        headers: {
          ...WRITE_FENCE_HEADERS,
          'content-type': 'application/json; charset=utf-8',
          'x-api-key': HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
        },
        method: 'POST',
      }),
      createExaTestEnv(validateRuntimeWriteFence),
      { containerId: 'opaque-container-id' },
    )

    expect(response.status).toBe(403)
    expect(validateRuntimeWriteFence).toHaveBeenCalledWith({
      attemptId: 'attempt_1',
      generation: '7',
      userId: 'member_123',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects private-shaped values in every focused query field before upstream fetch', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T12:00:00.000Z'))

    const requestBody = createFocusedRequestBody()
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('unexpected'))
    vi.stubGlobal('fetch', fetchMock)
    const validateRuntimeWriteFence = vi.fn(async () => true)

    for (const [field, label] of Object.entries(FOCUSED_QUERY_LABELS_BY_FIELD)) {
      for (const value of PRIVATE_FOCUSED_VALUES) {
        const linePrefix = `${label}: `
        const unsafeRequestBody = {
          ...requestBody,
          query: requestBody.query
            .split('\n')
            .map((line) =>
              line.startsWith(linePrefix) ? `${linePrefix}${value}` : line
            )
            .join('\n'),
        }
        const response = await hostedRunnerIntercept(
          new Request('https://api.exa.ai/search', {
            body: JSON.stringify(unsafeRequestBody),
            headers: {
              ...WRITE_FENCE_HEADERS,
              'content-type': 'application/json; charset=utf-8',
              'x-api-key': HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
            },
            method: 'POST',
          }),
          createExaTestEnv(validateRuntimeWriteFence),
          { containerId: `opaque-${field}-container-id` },
        )

        expect(response.status).toBe(403)
      }
    }

    expect(validateRuntimeWriteFence).toHaveBeenCalledTimes(
      Object.keys(FOCUSED_QUERY_LABELS_BY_FIELD).length
        * PRIVATE_FOCUSED_VALUES.length,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects private-shaped values in every legacy batch query field before upstream fetch', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T12:00:00.000Z'))

    const requestBody = createLegacyBatchLaneRequestBody()
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('unexpected'))
    vi.stubGlobal('fetch', fetchMock)
    const validateRuntimeWriteFence = vi.fn(async () => true)

    for (const [field, label] of Object.entries(FOCUSED_QUERY_LABELS_BY_FIELD)) {
      for (const value of PRIVATE_FOCUSED_VALUES) {
        const linePrefix = `${label}: `
        const unsafeRequestBody = {
          ...requestBody,
          query: requestBody.query
            .split('\n')
            .map((line) =>
              line.startsWith(linePrefix) ? `${linePrefix}${value}` : line
            )
            .join('\n'),
        }
        const response = await hostedRunnerIntercept(
          new Request('https://api.exa.ai/search', {
            body: JSON.stringify(unsafeRequestBody),
            headers: {
              ...WRITE_FENCE_HEADERS,
              'content-type': 'application/json; charset=utf-8',
              'x-api-key': HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
            },
            method: 'POST',
          }),
          createExaTestEnv(validateRuntimeWriteFence),
          { containerId: `legacy-${field}-container-id` },
        )

        expect(response.status).toBe(403)
      }
    }

    expect(validateRuntimeWriteFence).toHaveBeenCalledTimes(
      Object.keys(FOCUSED_QUERY_LABELS_BY_FIELD).length
        * PRIVATE_FOCUSED_VALUES.length,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
