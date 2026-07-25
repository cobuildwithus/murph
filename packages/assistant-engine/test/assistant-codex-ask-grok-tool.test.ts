import { describe, expect, it, vi } from 'vitest'

import {
  executeMurphDynamicToolRequest,
  listMurphDynamicToolNames,
  MURPH_ASK_GROK_TOOL,
  readMurphDynamicToolRequest,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  ASK_GROK_MAX_PROVIDER_CALLS_PER_TURN,
  createAskGrokToolRuntimeFromEnv,
  createAskGrokTurnState,
  executeAskGrokTool,
} from '../src/assistant-codex/ask-grok-tool.ts'

function readAskGrokCall(argumentsValue: unknown) {
  return readMurphDynamicToolRequest({
    id: 1,
    method: 'item/tool/call',
    params: { arguments: argumentsValue, namespace: 'murph', tool: 'ask_grok' },
  })
}

function createRuntime(env: NodeJS.ProcessEnv, fetchImpl: typeof fetch) {
  return createAskGrokToolRuntimeFromEnv({ env, fetchImpl })
}

function answerPayload(text: string, status = 'completed'): Response {
  return new Response(
    JSON.stringify({
      status,
      output: [
        { id: 'call_1', name: 'x_keyword_search', status: 'completed', type: 'custom_tool_call' },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        },
      ],
    }),
    { headers: { 'content-type': 'application/json' } },
  )
}

describe('murph.ask_grok arguments', () => {
  it('parses a question', () => {
    expect(readAskGrokCall({ question: 'what is @acme posting about?' })).toEqual({
      kind: 'ask-grok',
      args: { question: 'what is @acme posting about?' },
    })
  })

  it('returns validation digests for malformed arguments', () => {
    for (const argumentsValue of [
      {},
      { question: '' },
      { question: 'x'.repeat(501) },
      { question: 'ok', unknown: true },
    ]) {
      const request = readAskGrokCall(argumentsValue)
      expect(request).toMatchObject({ kind: 'invalid-ask-grok-arguments' })
    }
  })

  it('rejects invalid arguments without calling the provider', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const result = await executeMurphDynamicToolRequest({
      env: {},
      fetchImpl,
      nextUsageOrdinal: () => 1,
      progressDelivery: null,
      request: readAskGrokCall({})!,
      askGrokRuntime: createRuntime({ XAI_API_KEY: 'xai-sentinel-key' }, fetchImpl),
    })

    expect(result.rpcResult.success).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('murph.ask_grok availability and framing', () => {
  it('is registered but gated off until an xAI key exists', () => {
    expect(listMurphDynamicToolNames()).toContain('murph.ask_grok')
    expect(resolveMurphDynamicTools({})).not.toContain(MURPH_ASK_GROK_TOOL)
    expect(resolveMurphDynamicTools({ askGrokAvailable: true }))
      .toContain(MURPH_ASK_GROK_TOOL)
  })

  it('creates a runtime only when XAI_API_KEY is present', () => {
    const fetchImpl = vi.fn<typeof fetch>()
    expect(createRuntime({}, fetchImpl)).toBeNull()
    expect(createRuntime({ XAI_API_KEY: '   ' }, fetchImpl)).toBeNull()
    expect(createRuntime({ XAI_API_KEY: 'xai-sentinel-key' }, fetchImpl))
      .toMatchObject({ apiKey: 'xai-sentinel-key', model: 'grok-4.5' })
  })

  it('tells the model the answer is untrusted, unverified, and must be attributed', () => {
    expect(MURPH_ASK_GROK_TOOL.description)
      .toContain('untrusted third-party content')
    expect(MURPH_ASK_GROK_TOOL.description).toContain('not independently verified')
    expect(MURPH_ASK_GROK_TOOL.description)
      .toContain('attribute what it reports to a live X search')
    expect(MURPH_ASK_GROK_TOOL.description).toContain('never claim a search happened')
  })
})

describe('executeAskGrokTool', () => {
  it('sends one fixed-shape request and relays the answer with provenance', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.x.ai/v1/responses')
      expect(init?.method).toBe('POST')
      expect(new Headers(init?.headers).get('authorization'))
        .toBe('Bearer xai-sentinel-key')
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        model: 'grok-4.5',
        max_output_tokens: 2500,
        store: false,
        tools: [{ type: 'x_search' }],
      })
      expect(body.input[0].role).toBe('developer')
      expect(body.input[1]).toEqual({
        role: 'user',
        content: 'what is @acme posting about?',
      })
      return answerPayload('They posted about shipping a new API.')
    })

    const result = await executeAskGrokTool({
      args: { question: 'what is @acme posting about?' },
      runtime: createRuntime({ XAI_API_KEY: 'xai-sentinel-key' }, fetchImpl),
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.rpcSuccess).toBe(true)
    expect(result.rpcText).toContain("Grok's own answer from a live X (Twitter) search")
    expect(result.rpcText).toContain('not independently verified')
    expect(result.rpcText).toContain('They posted about shipping a new API.')
  })

  it('strips control and bidi characters but keeps line breaks', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      answerPayload('First line‮\nSecond line'),
    )

    const result = await executeAskGrokTool({
      args: { question: 'anything' },
      runtime: createRuntime({ XAI_API_KEY: 'xai-sentinel-key' }, fetchImpl),
    })

    expect(result.rpcSuccess).toBe(true)
    expect(result.rpcText).toContain('First line\nSecond line')
    expect(result.rpcText).not.toContain('')
    expect(result.rpcText).not.toContain('‮')
  })

  it('bounds a long answer so one call cannot flood thread context', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      answerPayload('x'.repeat(20000)),
    )

    const result = await executeAskGrokTool({
      args: { question: 'anything' },
      runtime: createRuntime({ XAI_API_KEY: 'xai-sentinel-key' }, fetchImpl),
    })

    expect(result.rpcSuccess).toBe(true)
    expect(result.rpcText).not.toContain('x'.repeat(8001))
    expect(result.rpcText.length).toBeLessThan(8600)
  })

  it('says the answer was cut off when the length bound drops text', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      answerPayload('x'.repeat(20000)),
    )

    const result = await executeAskGrokTool({
      args: { question: 'anything' },
      runtime: createRuntime({ XAI_API_KEY: 'xai-sentinel-key' }, fetchImpl),
    })

    expect(result.rpcText).toContain('was cut off before Grok finished it')
    expect(result.rpcText).toContain('anything it lists is partial')
  })

  it('says the answer was cut off when the provider stopped early', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      answerPayload('They posted about', 'incomplete'),
    )

    const result = await executeAskGrokTool({
      args: { question: 'anything' },
      runtime: createRuntime({ XAI_API_KEY: 'xai-sentinel-key' }, fetchImpl),
    })

    expect(result.rpcSuccess).toBe(true)
    expect(result.rpcText).toContain('They posted about')
    expect(result.rpcText).toContain('was cut off before Grok finished it')
  })

  it('adds no cut-off notice to an answer that finished within the bound', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      answerPayload('x'.repeat(7999)),
    )

    const result = await executeAskGrokTool({
      args: { question: 'anything' },
      runtime: createRuntime({ XAI_API_KEY: 'xai-sentinel-key' }, fetchImpl),
    })

    expect(result.rpcSuccess).toBe(true)
    expect(result.rpcText).not.toContain('cut off')
  })

  it('reports every failure explicitly and never as success', async () => {
    const cases: Array<{ expected: string; response: () => Response | Promise<never> }> = [
      { expected: 'rate-limited', response: () => new Response('', { status: 429 }) },
      { expected: 'unavailable', response: () => new Response('', { status: 503 }) },
      {
        expected: 'no answer',
        response: () => new Response(JSON.stringify({ status: 'completed', output: [] }), {
          headers: { 'content-type': 'application/json' },
        }),
      },
    ]

    for (const testCase of cases) {
      const fetchImpl = vi.fn<typeof fetch>(async () => testCase.response())
      const result = await executeAskGrokTool({
        args: { question: 'anything' },
        runtime: createRuntime({ XAI_API_KEY: 'xai-sentinel-key' }, fetchImpl),
      })
      expect(result.rpcSuccess).toBe(false)
      expect(result.rpcText).toContain(testCase.expected)
    }
  })

  it('fails closed when no xAI key is configured', async () => {
    const result = await executeAskGrokTool({
      args: { question: 'anything' },
      runtime: null,
    })
    expect(result.rpcSuccess).toBe(false)
    expect(result.rpcText).toContain('not configured')
  })

  it('enforces the per-turn provider-call ceiling in trusted turn state', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => answerPayload('an answer'))
    const runtime = createRuntime({ XAI_API_KEY: 'xai-sentinel-key' }, fetchImpl)
    const turnState = createAskGrokTurnState()

    for (let index = 0; index < ASK_GROK_MAX_PROVIDER_CALLS_PER_TURN; index += 1) {
      const allowed = await executeAskGrokTool({
        args: { question: `question ${index}` },
        runtime,
        turnState,
      })
      expect(allowed.rpcSuccess).toBe(true)
    }

    const blocked = await executeAskGrokTool({
      args: { question: 'one too many' },
      runtime,
      turnState,
    })

    expect(blocked.rpcSuccess).toBe(false)
    expect(blocked.rpcText).toContain('limit of 3 searches reached for this turn')
    expect(fetchImpl).toHaveBeenCalledTimes(ASK_GROK_MAX_PROVIDER_CALLS_PER_TURN)
  })
})
