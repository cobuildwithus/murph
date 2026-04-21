import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  NativeLocalCapabilityHost,
  createAssistantCapabilityRegistry,
  defineAssistantCapability,
  type AssistantAiSdkToolEvent,
} from '../src/model-harness.js'

type ExecutableAiSdkTool = {
  execute(input: Record<string, unknown>): Promise<unknown>
}

function readExecutableAiSdkTool(
  tools: Record<string, unknown>,
  name: string,
): ExecutableAiSdkTool {
  const candidate = tools[name]
  if (!candidate || typeof candidate !== 'object' || !('execute' in candidate)) {
    throw new Error(`Missing executable tool ${name}.`)
  }

  const execute = (candidate as { execute: unknown }).execute
  if (typeof execute !== 'function') {
    throw new Error(`Tool ${name} is not executable.`)
  }

  return {
    execute(input) {
      return execute(input) as Promise<unknown>
    },
  }
}

function createTestToolCatalog(input: {
  execute(input: { value: string }): Promise<{ echoed: string }>
}) {
  return createAssistantCapabilityRegistry([
    defineAssistantCapability({
      name: 'test.echo',
      description: 'Echo a test value.',
      inputSchema: z.object({
        value: z.string(),
      }),
      outputSchema: z.object({
        echoed: z.string(),
      }),
      executionBindings: {
        'native-local': input.execute,
      },
    }),
  ]).createToolCatalog([new NativeLocalCapabilityHost()])
}

describe('AssistantToolCatalog AI SDK tools', () => {
  it('returns the same structured result envelope used by direct tool execution', async () => {
    const catalog = createTestToolCatalog({
      async execute(input) {
        return { echoed: input.value }
      },
    })
    const events: AssistantAiSdkToolEvent[] = []
    const tools = catalog.createAiSdkTools('apply', {
      onToolEvent(event) {
        events.push(event)
      },
    })

    const aiSdkResult = await readExecutableAiSdkTool(
      tools,
      'test.echo',
    ).execute({ value: 'hello' })
    const [directResult] = await catalog.executeCalls({
      calls: [{ tool: 'test.echo', input: { value: 'hello' } }],
      mode: 'apply',
    })

    expect(aiSdkResult).toEqual(directResult)
    expect(aiSdkResult).toEqual({
      tool: 'test.echo',
      input: { value: 'hello' },
      status: 'succeeded',
      result: { echoed: 'hello' },
      errorCode: null,
      errorMessage: null,
    })
    expect(events).toEqual([
      {
        input: { value: 'hello' },
        kind: 'started',
        mode: 'apply',
        tool: 'test.echo',
      },
      {
        input: { value: 'hello' },
        kind: 'succeeded',
        mode: 'apply',
        result: { echoed: 'hello' },
        tool: 'test.echo',
      },
    ])
  })

  it('returns failed tool execution as model-visible output instead of throwing', async () => {
    const catalog = createTestToolCatalog({
      async execute() {
        throw new Error('simulated tool failure')
      },
    })
    const events: AssistantAiSdkToolEvent[] = []
    const tools = catalog.createAiSdkTools('apply', {
      onToolEvent(event) {
        events.push(event)
      },
    })

    const result = await readExecutableAiSdkTool(tools, 'test.echo').execute({
      value: 'hello',
    })

    expect(result).toEqual({
      tool: 'test.echo',
      input: { value: 'hello' },
      status: 'failed',
      result: null,
      errorCode: 'ASSISTANT_TOOL_EXECUTION_FAILED',
      errorMessage: 'simulated tool failure',
    })
    expect(events).toEqual([
      {
        input: { value: 'hello' },
        kind: 'started',
        mode: 'apply',
        tool: 'test.echo',
      },
      {
        errorCode: 'ASSISTANT_TOOL_EXECUTION_FAILED',
        errorMessage: 'simulated tool failure',
        input: { value: 'hello' },
        kind: 'failed',
        mode: 'apply',
        tool: 'test.echo',
      },
    ])
  })
})
