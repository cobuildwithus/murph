import { afterEach, describe, expect, it } from 'vitest'

import type { AssistantModelSpec } from '../src/model-harness/model-spec.ts'
import {
  applyAssistantResponsesRequestPolicy,
  createAssistantResponsesFetch,
  maybeMutateAssistantResponsesRequest,
  resolveAssistantApiKey,
  resolveAssistantGatewayRequestOptions,
  shouldMutateAssistantResponsesRequest,
} from '../src/model-harness/responses-policy.ts'
import { restoreEnvironmentVariable } from './test-helpers.js'

const TEST_API_KEY_ENV = 'MURPH_ASSISTANT_ENGINE_RESPONSES_POLICY_TEST_KEY'
const previousTestApiKey = process.env[TEST_API_KEY_ENV]

afterEach(() => {
  restoreEnvironmentVariable(TEST_API_KEY_ENV, previousTestApiKey)
})

describe('assistant Responses API request policy', () => {
  it('adds compaction and normalized gateway request options to Responses payloads', () => {
    const nextPayload = applyAssistantResponsesRequestPolicy(
      {
        model: 'gpt-test',
        providerOptions: {
          gateway: {
            existing: 'preserved',
          },
          otherProviderOption: true,
        },
      },
      {
        gatewayOnlyProviders: [
          ' OpenAI ',
          'openai',
          'bad provider slug',
          'anthropic-1',
        ],
        gatewayReporting: {
          tags: [' alpha ', 'alpha', '', 'beta'],
          user: ' user-1 ',
        },
        gatewayZeroDataRetention: true,
      },
    )

    expect(nextPayload).toEqual({
      context_management: [
        {
          compact_threshold: 200_000,
          type: 'compaction',
        },
      ],
      model: 'gpt-test',
      providerOptions: {
        gateway: {
          existing: 'preserved',
          only: ['openai', 'anthropic-1'],
          tags: ['alpha', 'beta'],
          user: 'user-1',
          zeroDataRetention: true,
        },
        otherProviderOption: true,
      },
    })
  })

  it('preserves explicit context management and skips payload rewrites without policy work', () => {
    expect(
      applyAssistantResponsesRequestPolicy(
        {
          context_management: [
            {
              type: 'manual',
            },
          ],
        },
        undefined,
      ),
    ).toBeNull()

    expect(
      applyAssistantResponsesRequestPolicy(
        {
          context_management: false,
          providerOptions: {
            gateway: 'not-an-object',
          },
        },
        {
          gatewayOnlyProviders: ['OpenAI'],
        },
      ),
    ).toEqual({
      context_management: false,
      providerOptions: {
        gateway: {
          only: ['openai'],
        },
      },
    })

    expect(resolveAssistantGatewayRequestOptions(undefined)).toBeNull()
  })

  it('only mutates POST requests to Responses endpoints with readable JSON bodies', async () => {
    expect(
      shouldMutateAssistantResponsesRequest('https://api.example.test/v1/responses', {
        method: 'GET',
      }),
    ).toBe(false)
    expect(
      shouldMutateAssistantResponsesRequest('not-a-valid-url'),
    ).toBe(false)
    expect(
      shouldMutateAssistantResponsesRequest(
        new Request('https://api.example.test/v1/responses', {
          method: 'POST',
        }),
      ),
    ).toBe(true)

    const noBodyInit = {
      method: 'POST',
    }
    await expect(
      maybeMutateAssistantResponsesRequest(
        undefined,
        'https://api.example.test/v1/responses',
        noBodyInit,
      ),
    ).resolves.toBe(noBodyInit)

    const invalidJsonInit = {
      body: 'not-json',
      method: 'POST',
    }
    await expect(
      maybeMutateAssistantResponsesRequest(
        undefined,
        'https://api.example.test/v1/responses',
        invalidJsonInit,
      ),
    ).resolves.toBe(invalidJsonInit)

    const noPolicyWorkInit = {
      body: JSON.stringify({
        context_management: [
          {
            type: 'manual',
          },
        ],
      }),
      method: 'POST',
    }
    await expect(
      maybeMutateAssistantResponsesRequest(
        undefined,
        'https://api.example.test/v1/responses',
        noPolicyWorkInit,
      ),
    ).resolves.toBe(noPolicyWorkInit)

    const request = new Request('https://api.example.test/v1/responses', {
      body: JSON.stringify({
        model: 'gpt-test',
      }),
      method: 'POST',
    })
    const mutated = await maybeMutateAssistantResponsesRequest(undefined, request)
    expect(JSON.parse(String(mutated?.body))).toMatchObject({
      context_management: [
        {
          compact_threshold: 200_000,
          type: 'compaction',
        },
      ],
      model: 'gpt-test',
    })
  })

  it('wraps fetch with the same Responses request mutation policy', async () => {
    const calls: Array<{
      body: string | null
      input: Parameters<typeof fetch>[0]
    }> = []
    const debugEvents: Array<{
      gatewayZeroDataRetention: boolean | null
      inputTextLength: number
      model: string | null
      requestBody: string
      requestBodyHash: string
      toolNames: string[]
    }> = []
    const baseFetch: typeof fetch = async (input, init) => {
      calls.push({
        body: typeof init?.body === 'string' ? init.body : null,
        input,
      })
      return new Response('ok')
    }
    const fetchWithPolicy = createAssistantResponsesFetch(
      {
        debugObserver(event) {
          debugEvents.push({
            gatewayZeroDataRetention: event.gatewayZeroDataRetention,
            inputTextLength: event.inputTextLength,
            model: event.model,
            requestBody: event.requestBody,
            requestBodyHash: event.requestBodyHash,
            toolNames: event.toolNames,
          })
        },
        gatewayReporting: {
          tags: ['member:test'],
          user: 'member_test',
        },
        gatewayZeroDataRetention: true,
      },
      baseFetch,
    )

    const response = await fetchWithPolicy('https://api.example.test/v1/responses', {
      body: JSON.stringify({
        input: [
          {
            content: [
              {
                text: 'Send the signup welcome.',
                type: 'input_text',
              },
            ],
            role: 'user',
          },
        ],
        model: 'gpt-test',
        tools: [
          {
            name: 'vault.show',
            type: 'function',
          },
        ],
      }),
      method: 'POST',
    })

    await expect(response.text()).resolves.toBe('ok')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      providerOptions: {
        gateway: {
          zeroDataRetention: true,
        },
      },
    })
    expect(debugEvents).toHaveLength(1)
    expect(debugEvents[0]).toMatchObject({
      gatewayZeroDataRetention: true,
      inputTextLength: 'Send the signup welcome.'.length,
      model: 'gpt-test',
      toolNames: ['vault.show'],
    })
    expect(debugEvents[0]?.requestBodyHash).toHaveLength(64)
    expect(debugEvents[0]?.requestBody).toContain('Send the signup welcome.')
    expect(debugEvents[0]?.requestBody).toContain('"zeroDataRetention":true')
    expect(debugEvents[0]?.requestBody).toContain('"user":"[redacted]"')
    expect(debugEvents[0]?.requestBody).toContain('"tags":"[redacted]"')
    expect(debugEvents[0]?.requestBody).not.toContain('member_test')
    expect(debugEvents[0]?.requestBody).not.toContain('member:test')
  })

  it('resolves assistant API keys by explicit, injected, and environment sources', () => {
    expect(
      resolveAssistantApiKey({
        apiKey: 'direct-key',
        model: 'gpt-test',
      }),
    ).toBe('direct-key')
    expect(
      resolveAssistantApiKey({
        apiKeyEnvValue: 'injected-key',
        model: 'gpt-test',
      }),
    ).toBe('injected-key')
    expect(
      resolveAssistantApiKey({
        apiKeyEnvValue: '',
        model: 'gpt-test',
      }),
    ).toBeUndefined()

    process.env[TEST_API_KEY_ENV] = 'env-key'
    const envSpec: AssistantModelSpec = {
      apiKeyEnv: TEST_API_KEY_ENV,
      model: 'gpt-test',
    }
    expect(resolveAssistantApiKey(envSpec)).toBe('env-key')

    process.env[TEST_API_KEY_ENV] = ''
    expect(resolveAssistantApiKey(envSpec)).toBeUndefined()
    expect(
      resolveAssistantApiKey({
        model: 'gpt-test',
      }),
    ).toBeUndefined()
  })
})
