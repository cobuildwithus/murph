import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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

const QUESTION_PROFILE = {
  question:
    'What do recent randomized trials and systematic reviews show about creatine and cognitive performance in healthy adults?',
} as const

function createQuestionRequestBody() {
  return buildExaResearchScoutRequest({
    profile: {
      ...QUESTION_PROFILE,
      topics: [],
      biomarkers: [],
      behaviors: [],
      supplements: [],
      conditionsOrConcerns: [],
      goals: [],
      activeExperiments: [],
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

describe('hosted Exa egress for focused public questions', () => {
  it('validates and canonicalizes the generalized question before injecting the Worker secret', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T12:00:00.000Z'))

    const requestBody = createQuestionRequestBody()
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

  it('fails closed before upstream fetch when the exact question recipe is mutated with private data', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-06T12:00:00.000Z'))

    const requestBody = createQuestionRequestBody()
    const unsafeRequestBody = {
      ...requestBody,
      query: requestBody.query.replace(
        QUESTION_PROFILE.question,
        'What should I do about my LDL 181 mg/dL?',
      ),
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
})
