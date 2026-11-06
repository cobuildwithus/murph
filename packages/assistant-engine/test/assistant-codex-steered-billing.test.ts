import {
  MockChildProcess,
  codexMocks,
  createDeferred,
  createHostedToolContext,
  createTempDir,
  executeCodexAppServerTurn,
  jsonLine,
  waitForRpcMethod,
  waitForRpcResponse,
} from './assistant-codex-runtime.harness.ts'

import { afterEach, expect, it, vi } from 'vitest'
import type { CodexAppServerLiveTurn } from '../src/assistant-codex.ts'
import { resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.ts'

const imageWrite = vi.hoisted(() => ({
  hold: null as Promise<void> | null,
  started: null as (() => void) | null,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (imageWrite.hold && String(args[0]).includes('image-1')) {
        imageWrite.started?.()
        await imageWrite.hold
      }
      return await actual.writeFile(...args)
    },
  }
})

afterEach(() => {
  imageWrite.hold = null
  imageWrite.started = null
})

async function callSubscriptionDuringSteeredImage(input: {
  // Settles the held image write and returns once the steer has finished.
  duringToolCall: (control: {
    child: MockChildProcess
    release: ReturnType<typeof createDeferred<void>>
    steering: Promise<void>
    toolCall: () => Promise<Record<string, unknown>>
  }) => Promise<Record<string, unknown>>
}) {
  const workingDirectory = await createTempDir('murph-steered-billing-')
  const release = createDeferred<void>()
  const imageStarted = createDeferred<void>()
  const liveTurnReady = createDeferred<CodexAppServerLiveTurn>()
  imageWrite.hold = release.promise
  imageWrite.started = imageStarted.resolve
  const subscriptionRequest = vi.fn(async () => ({
    action: 'change_plan' as const,
    plan: {
      code: 'launch_edge_monthly',
      displayName: 'Edge',
      interval: 'month',
      recurringAmountUsdCents: 2_000,
    } as const,
    status: 'completed' as const,
  }))
  const claimSubscriptionAssistantInputId = vi.fn(() => `ain_${'b'.repeat(32)}`)
  let toolResponse: Record<string, unknown> | null = null

  codexMocks.spawn.mockImplementation(() => {
    const child = new MockChildProcess()
    queueMicrotask(() => {
      void (async () => {
        await waitForRpcMethod(child, 'initialize')
        child.stdout.write(jsonLine({ id: 1, result: {} }))
        await waitForRpcMethod(child, 'thread/start')
        child.stdout.write(jsonLine({ id: 2, result: { thread: { id: 'thread-steered-billing' } } }))
        await waitForRpcMethod(child, 'turn/start')
        child.stdout.write(jsonLine({ id: 3, result: { turn: { id: 'turn-steered-billing' } } }))
        child.stdout.write(jsonLine({
          method: 'turn/started',
          params: { threadId: 'thread-steered-billing', turn: { id: 'turn-steered-billing' } },
        }))
        const liveTurn = await liveTurnReady.promise
        const steering = liveTurn.steer({
          images: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }],
          prompt: 'Keep my current plan.',
        })
        await imageStarted.promise
        try {
          toolResponse = await input.duringToolCall({
            child,
            release,
            steering,
            toolCall: async () => {
              child.stdout.write(jsonLine({
                id: 73,
                method: 'item/tool/call',
                params: {
                  arguments: {
                    action: 'change_plan',
                    quoteId: 'quote_synthetic',
                    targetPlanCode: 'launch_edge_monthly',
                  },
                  namespace: 'murph',
                  tool: 'subscription',
                },
              }))
              return await waitForRpcResponse(child, 73)
            },
          })
        } finally {
          release.resolve()
          child.stdout.write(jsonLine({
            method: 'item/completed',
            params: { item: { id: 'assistant-steered-billing', text: 'Handled.', type: 'agentMessage' } },
          }))
          child.stdout.write(jsonLine({
            method: 'turn/completed',
            params: { turn: { id: 'turn-steered-billing', status: 'completed' } },
          }))
        }
      })()
    })
    return child
  })

  await executeCodexAppServerTurn({
    dynamicTools: resolveMurphDynamicTools({
      progressUpdatesAvailable: false,
      subscriptionAvailable: true,
    }),
    env: { OPENAI_API_KEY: 'openai-test-key' },
    hostedToolContext: {
      ...createHostedToolContext(),
      claimSubscriptionAssistantInputId,
      subscriptionTool: { request: subscriptionRequest },
    },
    onLiveTurn: (turn) => {
      liveTurnReady.resolve(turn)
      return () => {}
    },
    prompt: 'Apply the quoted change.',
    workingDirectory,
  })

  return { claimSubscriptionAssistantInputId, subscriptionRequest, toolResponse }
}

it('refuses a subscription change while a steered image is still being prepared', async () => {
  const outcome = await callSubscriptionDuringSteeredImage({
    duringToolCall: async ({ child, release, steering, toolCall }) => {
      const response = await toolCall()
      release.resolve()
      const steer = await waitForRpcMethod(child, 'turn/steer')
      child.stdout.write(jsonLine({ id: steer.id, result: {} }))
      await steering
      return response
    },
  })

  expect(outcome.toolResponse).toMatchObject({ id: 73, result: { success: false } })
  expect(outcome.subscriptionRequest).not.toHaveBeenCalled()
  expect(outcome.claimSubscriptionAssistantInputId).not.toHaveBeenCalled()
})

it('refuses a subscription change after a steered image fails to prepare', async () => {
  const outcome = await callSubscriptionDuringSteeredImage({
    duringToolCall: async ({ release, steering, toolCall }) => {
      release.reject(new Error('Synthetic image write failure.'))
      await expect(steering).rejects.toThrow('Synthetic image write failure.')
      return await toolCall()
    },
  })

  expect(outcome.toolResponse).toMatchObject({ id: 73, result: { success: false } })
  expect(outcome.subscriptionRequest).not.toHaveBeenCalled()
  expect(outcome.claimSubscriptionAssistantInputId).not.toHaveBeenCalled()
})
