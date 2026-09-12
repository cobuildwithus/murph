import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setImmediate } from 'node:timers/promises'

import {
  buildExaResearchScoutBatchLaneRequest,
  parseExaResearchScoutRequestBody,
  type ResearchScoutBatchInput,
  type ResearchScoutBatchResult,
} from '@murphai/contracts'
import { Cli } from 'incur'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerResearchCommands } from '../src/commands/research.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { fetchExaResearchScoutBatchCandidates } from '../src/research-scout-client.js'
import { requireData, runInProcessJsonCli } from './cli-test-helpers.js'

const INPUT = {
  lanes: ['sleep', 'recovery', 'nutrition', 'exercise'].map((label) => ({
    label,
    profile: {
      topics: ['sleep'],
      biomarkers: [],
      behaviors: [],
      supplements: [],
      conditionsOrConcerns: [],
      goals: [],
      activeExperiments: [],
    },
  })),
  since: '2026-04-18T00:00:00.000Z',
  until: '2026-06-17T00:00:00.000Z',
  maxCandidatesPerLane: 2,
} satisfies ResearchScoutBatchInput
const ENV = { EXA_API_KEY: 'synthetic-exa-token' }

function payload(index: number) {
  return {
    results: [{ title: 'Synthetic source', url: 'https://example.test/paper' }],
    output: { content: { candidates: [{ resultIndex: 0, lane: index }] } },
    extraProviderField: { retained: index },
  }
}

function response(index: number) {
  return new Response(JSON.stringify(payload(index)))
}

interface PendingRequest {
  signal: AbortSignal
  resolve: (value: Response) => void
  reject: (reason: unknown) => void
}

// Requests settle only under test control; no wall-clock latency assertions.
function controlledFetch(holdAbort = false) {
  const requests: PendingRequest[] = []
  let active = 0
  let peak = 0
  const fetchImpl = vi.fn<typeof fetch>((_target, init) => {
    const signal = init?.signal
    if (!signal) throw new Error('Expected a request signal.')
    active += 1
    peak = Math.max(peak, active)
    return new Promise<Response>((resolve, reject) => {
      let settled = false
      const finish = (effect: () => void) => {
        if (settled) return
        settled = true
        active -= 1
        signal.removeEventListener('abort', onAbort)
        effect()
      }
      const request = {
        signal,
        resolve: (value: Response) => finish(() => resolve(value)),
        reject: (reason: unknown) => finish(() => reject(reason)),
      }
      const onAbort = () => {
        if (!holdAbort) request.reject(signal.reason)
      }
      requests.push(request)
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
    })
  })
  return { fetchImpl, requests, get active() { return active }, get peak() { return peak } }
}

function controlledBody(signal: AbortSignal, holdAbort = false) {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const fail = (error: Error) => {
    signal.removeEventListener('abort', onAbort)
    controller.error(error)
  }
  const onAbort = () => {
    if (!holdAbort) fail(new TypeError('synthetic-body-abort-detail'))
  }
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value },
    cancel() { signal.removeEventListener('abort', onAbort) },
  })
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  return {
    response: new Response(body),
    fail,
    complete(index: number) {
      signal.removeEventListener('abort', onAbort)
      controller.enqueue(new TextEncoder().encode(JSON.stringify(payload(index))))
      controller.close()
    },
  }
}

function observe<T>(promise: Promise<T>) {
  let settled = false
  const result = promise.then(
    (value) => { settled = true; return { value, error: undefined } },
    (error: unknown) => { settled = true; return { value: undefined, error } },
  )
  return { result, get settled() { return settled } }
}

function controlledTimeouts() {
  const deadlines: AbortController[] = []
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
    const deadline = new AbortController()
    deadlines.push(deadline)
    return deadline.signal
  })
  return { deadlines, timeout }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('research scout batch scheduling', () => {
  it('admits at most two requests, refills slots, and preserves ordered full envelopes', async () => {
    const harness = controlledFetch()
    const { timeout } = controlledTimeouts()
    const result = fetchExaResearchScoutBatchCandidates(INPUT, { env: ENV, ...harness })
    await setImmediate()
    expect(harness.requests).toHaveLength(2)
    expect(harness.active).toBe(2)
    expect(timeout.mock.calls).toEqual([[60_000], [60_000]])

    // The second worker admits both remaining lanes while lane zero is pending.
    harness.requests[1].resolve(response(1))
    await setImmediate()
    expect(harness.requests).toHaveLength(3)
    harness.requests[2].resolve(response(2))
    await setImmediate()
    expect(harness.requests).toHaveLength(4)
    harness.requests[3].resolve(response(3))
    harness.requests[0].resolve(response(0))
    const output = await result
    expect(output.lanes).toEqual(INPUT.lanes.map((lane, index) => ({
      label: lane.label, response: payload(index),
    })))
    expect(harness.peak).toBe(2)
    expect(harness.active).toBe(0)
    expect(timeout.mock.calls).toEqual(Array.from({ length: 4 }, () => [60_000]))
    for (const [target, init] of harness.fetchImpl.mock.calls) {
      expect(String(target)).toBe('https://api.exa.ai/search')
      expect(init?.method).toBe('POST')
      expect(init?.redirect).toBe('error')
      expect(new Headers(init?.headers).get('x-api-key')).toBe(ENV.EXA_API_KEY)
      expect(parseExaResearchScoutRequestBody(JSON.parse(String(init?.body)))).not.toBeNull()
    }
  })

  it('keeps a slot until its response body is consumed', async () => {
    const harness = controlledFetch()
    const result = fetchExaResearchScoutBatchCandidates(INPUT, { env: ENV, ...harness })
    await setImmediate()
    const body = controlledBody(harness.requests[0].signal)
    harness.requests[0].resolve(body.response)
    await setImmediate()
    expect(harness.requests).toHaveLength(2)
    harness.requests[1].resolve(response(1))
    await setImmediate()
    expect(harness.requests).toHaveLength(3)
    body.complete(0)
    await setImmediate()
    expect(harness.requests).toHaveLength(4)
    harness.requests[2].resolve(response(2))
    harness.requests[3].resolve(response(3))
    expect((await result).lanes.map((lane) => lane.response)).toEqual([0, 1, 2, 3].map(payload))
  })

  it('keeps the one-lane recipe and result envelope unchanged', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => response(0))
    const input = { ...INPUT, lanes: INPUT.lanes.slice(0, 1) }
    const result = await fetchExaResearchScoutBatchCandidates(input, { env: ENV, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body))).toEqual(
      buildExaResearchScoutBatchLaneRequest({
        profile: input.lanes[0].profile,
        since: input.since,
        until: input.until,
        maxCandidates: input.maxCandidatesPerLane,
      }),
    )
    expect(result).toEqual({
      provider: { name: 'exa', endpoint: 'search', mode: 'deep-reasoning' },
      privacy: {
        tokenSource: 'env', persistedByTool: false,
        sentProfileKind: 'tag_profile', rawVaultValuesSent: false,
      },
      lanes: [{ label: 'sleep', response: payload(0) }],
    })
  })

  it.each([
    { name: 'missing token', input: INPUT, env: {} },
    { name: 'blank token', input: INPUT, env: { EXA_API_KEY: '  ' } },
    { name: 'fifth lane', input: { ...INPUT, lanes: [...INPUT.lanes, INPUT.lanes[0]] }, env: ENV },
    { name: 'empty lanes', input: { ...INPUT, lanes: [] }, env: ENV },
    { name: 'invalid last lane', input: {
      ...INPUT,
      lanes: INPUT.lanes.map((lane, index) => index === 3
        ? { ...lane, profile: { ...lane.profile, topics: ['unsupported synthetic concept'] } }
        : lane),
    }, env: ENV },
  ])('validates the entire batch before any egress: $name', async ({ input, env }) => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(fetchExaResearchScoutBatchCandidates(input, { env, fetchImpl })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('makes no request for a pre-aborted batch', async () => {
    const caller = new AbortController()
    caller.abort(new Error('synthetic-caller-detail'))
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(fetchExaResearchScoutBatchCandidates(INPUT, {
      env: ENV, fetchImpl, signal: caller.signal,
    })).rejects.toMatchObject({
      code: 'research_exa_aborted',
      context: { abortedByCaller: true, retryable: false, failureStage: 'request' },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    { index: 0, status: 401, code: 'research_exa_auth_failed', retryable: false },
    { index: 1, status: 429, code: 'research_exa_rate_limited', retryable: true },
    { index: 2, status: 503, code: 'research_exa_unavailable', retryable: true },
  ])('preserves lane $index failure, cancels and joins sibling bodies, and closes admission', async ({ index, status, code, retryable }) => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const harness = controlledFetch()
      const request = observe(fetchExaResearchScoutBatchCandidates(INPUT, { env: ENV, ...harness }))
      await setImmediate()
      if (index === 2) {
        harness.requests[0].resolve(response(0))
        await setImmediate()
      }
      const sibling = harness.requests[index === 0 ? 1 : index === 1 ? 0 : 1]
      const body = controlledBody(sibling.signal, true)
      sibling.resolve(body.response)
      await setImmediate()
      harness.requests[index].resolve(new Response('synthetic-provider-secret', { status }))
      await setImmediate()
      expect(sibling.signal.aborted).toBe(true)
      expect(request.settled).toBe(false)
      expect(harness.requests).toHaveLength(index === 2 ? 3 : 2)
      body.fail(new TypeError('synthetic-late-sibling-detail'))
      const outcome = await request.result
      expect(outcome.value).toBeUndefined()
      expect(outcome.error).toMatchObject({
        name: 'VaultCliError', code,
        context: { status, retryable, failureStage: 'response', stage: 'response',
          abortedByCaller: false, timedOut: false },
      })
      expect(JSON.stringify(outcome.error)).not.toMatch(/synthetic-provider-secret|synthetic-late-sibling-detail/)
      await setImmediate()
      expect(harness.requests).toHaveLength(index === 2 ? 3 : 2)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.removeListener('unhandledRejection', unhandled)
    }
  })

  it('preserves a transport failure while awaiting a delayed sibling rejection', async () => {
    const harness = controlledFetch(true)
    const request = observe(fetchExaResearchScoutBatchCandidates(INPUT, { env: ENV, ...harness }))
    await setImmediate()
    harness.requests[0].reject(new TypeError('synthetic-first-transport-detail'))
    await setImmediate()
    expect(harness.requests[1].signal.aborted).toBe(true)
    expect(request.settled).toBe(false)
    expect(harness.requests).toHaveLength(2)
    harness.requests[1].reject(harness.requests[1].signal.reason)
    const outcome = await request.result
    expect(outcome.error).toMatchObject({
      code: 'research_exa_unavailable',
      context: { failureStage: 'request', stage: 'transport', retryable: true,
        abortedByCaller: false, timedOut: false, transportErrorName: 'TypeError' },
    })
    expect(JSON.stringify(outcome.error)).not.toContain('synthetic-first-transport-detail')
    expect(harness.requests).toHaveLength(2)
  })

  it.each(['request', 'response_body'] as const)('preserves caller abort during %s without starting queued lanes', async (stage) => {
    const caller = new AbortController()
    const harness = controlledFetch()
    const request = observe(fetchExaResearchScoutBatchCandidates(INPUT, {
      env: ENV, ...harness, signal: caller.signal,
    }))
    await setImmediate()
    if (stage === 'response_body') {
      for (const pending of harness.requests) pending.resolve(controlledBody(pending.signal).response)
      await setImmediate()
    }
    caller.abort(new Error('synthetic-caller-detail'))
    const outcome = await request.result
    expect(outcome.error).toMatchObject({
      code: 'research_exa_aborted',
      context: { failureStage: stage, abortedByCaller: true, timedOut: false, retryable: false },
    })
    expect(JSON.stringify(outcome.error)).not.toMatch(/synthetic-caller-detail|synthetic-body-abort-detail/)
    expect(harness.requests).toHaveLength(2)
    expect(harness.requests.every(({ signal }) => signal.aborted)).toBe(true)
  })

  it.each(['request', 'response_body'] as const)('preserves the per-request timeout during %s and joins cancellation', async (stage) => {
    const harness = controlledFetch()
    const { deadlines, timeout } = controlledTimeouts()
    const request = observe(fetchExaResearchScoutBatchCandidates(INPUT, {
      env: ENV, ...harness, timeoutMs: 17,
    }))
    await setImmediate()
    if (stage === 'response_body') {
      for (const pending of harness.requests) pending.resolve(controlledBody(pending.signal).response)
      await setImmediate()
    }
    expect(timeout.mock.calls).toEqual([[17], [17]])
    deadlines[0].abort(new DOMException('Synthetic deadline', 'TimeoutError'))
    const outcome = await request.result
    expect(outcome.error).toMatchObject({
      code: 'research_exa_timeout',
      context: { failureStage: stage, abortedByCaller: false, timedOut: true, retryable: true },
    })
    expect(harness.requests).toHaveLength(2)
    expect(harness.requests.every(({ signal }) => signal.aborted)).toBe(true)
  })

  it('does not return success or admit more work when an aborted transport completes anyway', async () => {
    const caller = new AbortController()
    const harness = controlledFetch(true)
    const request = observe(fetchExaResearchScoutBatchCandidates(INPUT, {
      env: ENV, ...harness, signal: caller.signal,
    }))
    await setImmediate()
    caller.abort()
    expect(request.settled).toBe(false)
    harness.requests.forEach((pending, index) => pending.resolve(response(index)))
    expect((await request.result).error).toMatchObject({ code: 'research_exa_aborted' })
    expect(harness.requests).toHaveLength(2)
  })

  it('composes the registered CLI parser, date normalization, client, and ordered JSON output', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'research-batch-'))
    try {
      const file = path.join(directory, 'lanes.json')
      await writeFile(file, JSON.stringify({ lanes: INPUT.lanes }))
      const harness = controlledFetch()
      vi.stubEnv('EXA_API_KEY', ENV.EXA_API_KEY)
      vi.stubGlobal('fetch', harness.fetchImpl)
      const cli = Cli.create('vault-cli', { version: '0.0.0-test' })
      cli.use(incurErrorBridge)
      registerResearchCommands(cli)
      const run = runInProcessJsonCli<ResearchScoutBatchResult>(cli, [
        'research', 'scout-batch', '--input', `@${file}`,
        '--since', '2026-04-18', '--until', '2026-06-17',
      ])
      // File input is asynchronous; wait for admission, not elapsed performance.
      await vi.waitFor(() => expect(harness.requests).toHaveLength(2))
      harness.requests[1].resolve(response(1))
      await setImmediate()
      harness.requests[2].resolve(response(2))
      await setImmediate()
      harness.requests[3].resolve(response(3))
      harness.requests[0].resolve(response(0))
      const result = await run
      expect(requireData(result.envelope).lanes).toEqual(INPUT.lanes.map((lane, index) => ({
        label: lane.label, response: payload(index),
      })))
      expect(harness.peak).toBe(2)
      expect(harness.fetchImpl).toHaveBeenCalledTimes(4)
      for (const [, init] of harness.fetchImpl.mock.calls) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          startPublishedDate: INPUT.since,
          endPublishedDate: '2026-06-17T23:59:59.999Z',
          numResults: 5,
        })
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
