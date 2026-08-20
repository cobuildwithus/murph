import assert from 'node:assert/strict'

import { afterEach, expect, test, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

test('a held group draft keeps event admission open without reopening manual steering', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const admissionHook = vi.fn(async () => ({
    acceptedInputs: [
      {
        acceptedAt: '2026-08-20T18:00:01.000Z',
        id: 'late-group-input',
        promptFallbackReason: 'missing-content-ref' as const,
        promptFallbackText: 'One more thing',
        source: 'assistant-input' as const,
      },
    ],
    kind: 'accepted' as const,
    prompt: 'One more thing',
    transcriptText: 'One more thing',
    userMessageContent: [
      {
        text: 'One more thing',
        type: 'text' as const,
      },
    ],
  }))
  const controller = createAssistantActiveTurnInputController({
    admissionHook,
    allowPostResponseEventAdmission: true,
    sessionId: 'session-1',
    turnId: 'turn-1',
    vault: '/vaults/test',
  })
  const releaseFirstProviderTurn = controller.registerLiveProviderTurn({
    codexThreadId: 'provider-thread-1',
    interrupt: async () => undefined,
    providerTurnId: 'provider-turn-1',
    sessionId: 'session-1',
    steer: async () => undefined,
    turnId: 'turn-1',
  })

  try {
    controller.closeInputAdmission()
    releaseFirstProviderTurn()

    expect(steerAssistantActiveTurnInput({
      expectedActiveTurnId: 'turn-1',
      prompt: 'Manual input after the held draft',
      sessionId: 'session-1',
      vault: '/vaults/test',
    })).toBeNull()

    await controller.notifyInputAvailable({
      inputIds: ['late-group-input'],
    })
    expect(admissionHook).toHaveBeenCalledOnce()
    await expect(controller.admitAvailable()).resolves.toEqual({
      acceptedInputs: [
        {
          acceptedAt: '2026-08-20T18:00:01.000Z',
          id: 'late-group-input',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'One more thing',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'One more thing',
      transcriptText: 'One more thing',
      userMessageContent: [
        {
          text: 'One more thing',
          type: 'text',
        },
      ],
    })

    const secondProviderSteer = vi.fn(async () => undefined)
    const releaseSecondProviderTurn = controller.registerLiveProviderTurn({
      codexThreadId: 'provider-thread-1',
      interrupt: async () => undefined,
      providerTurnId: 'provider-turn-2',
      sessionId: 'session-1',
      steer: secondProviderSteer,
      turnId: 'turn-1',
    })
    try {
      const completion = steerAssistantActiveTurnInput({
        expectedActiveTurnId: 'turn-1',
        prompt: 'Input while reconsideration is running',
        sessionId: 'session-1',
        vault: '/vaults/test',
      })
      assert.ok(completion)
      completion.catch(() => undefined)
      await vi.waitFor(() => {
        expect(secondProviderSteer).toHaveBeenCalledOnce()
      })
    } finally {
      releaseSecondProviderTurn()
    }
  } finally {
    controller.fail(new Error('group draft input controller test complete'))
    controller.close()
  }
})
