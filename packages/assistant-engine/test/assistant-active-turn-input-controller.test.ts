import assert from 'node:assert/strict'

import { afterEach, expect, test, vi } from 'vitest'

import {
  AssistantActiveTurnInputCheckpointRejectedError,
  AssistantActiveTurnInputUnavailableError,
} from '../src/assistant/turn-input.js'

type Deferred<T> = {
  promise: Promise<T>
  reject(error: unknown): void
  resolve(value: T): void
}

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.useRealTimers()
})

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return {
    promise,
    reject,
    resolve,
  }
}

test('active-turn controller only steers exact conversations while open', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const controller = createAssistantActiveTurnInputController({
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  try {
    assert.equal(
      steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          sessionId: 'session-test',
          threadId: 'thread-2',
        },
        prompt: 'Different thread',
        sessionId: 'session-test',
        vault: '/vaults/test',
      }),
      null,
    )

    assert.equal(
      steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        prompt: 'Same thread without expected turn id',
        vault: '/vaults/test',
      }),
      null,
    )

    assert.equal(
      steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        expectedActiveTurnId: 'turn-stale',
        prompt: 'Same thread with stale turn id',
        vault: '/vaults/test',
      }),
      null,
    )

    assert.equal(
      steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        expectedActiveTurnId: ' turn-active ',
        prompt: 'Same thread with padded turn id',
        vault: '/vaults/test',
      }),
      null,
    )

    const steered = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-active',
      prompt: 'Same thread',
      vault: '/vaults/test',
    })
    assert.ok(steered)
    steered.catch(() => undefined)
    expect(await controller.admitAvailable()).toEqual({
      acceptedInputs: [
        {
          acceptedAt: expect.any(String),
          id: 'manual-1',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Same thread',
          source: 'manual',
        },
      ],
      kind: 'accepted',
      prompt: 'Same thread',
      transcriptText: null,
      userMessageContent: [
        {
          text: 'Same thread',
          type: 'text',
        },
      ],
    })

    const sessionOnlyController = createAssistantActiveTurnInputController({
      sessionId: 'session-other',
      turnId: 'turn-session-only',
      vault: '/vaults/test',
    })
    try {
      assert.equal(
        steerAssistantActiveTurnInput({
          conversation: {
            sessionId: ' ',
          },
          prompt: 'Session fallback without expected turn id',
          sessionId: 'session-other',
          vault: '/vaults/test',
        }),
        null,
      )

      const sessionSteered = steerAssistantActiveTurnInput({
        conversation: {
          sessionId: ' ',
        },
        expectedActiveTurnId: 'turn-session-only',
        prompt: 'Session fallback',
        sessionId: 'session-other',
        vault: '/vaults/test',
      })
      assert.ok(sessionSteered)
      sessionSteered.catch(() => undefined)
      expect(await sessionOnlyController.admitAvailable()).toEqual({
        acceptedInputs: [
          {
            acceptedAt: expect.any(String),
            id: 'manual-1',
            promptFallbackReason: 'manual-input',
            promptFallbackText: 'Session fallback',
            source: 'manual',
          },
        ],
        kind: 'accepted',
        prompt: 'Session fallback',
        transcriptText: null,
        userMessageContent: [
          {
            text: 'Session fallback',
            type: 'text',
          },
        ],
      })
    } finally {
      sessionOnlyController.fail(new Error('session-only controller test complete'))
      sessionOnlyController.close()
    }

    controller.close()
    assert.equal(
      steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        expectedActiveTurnId: 'turn-active',
        prompt: 'After commit',
        vault: '/vaults/test',
      }),
      null,
    )
  } finally {
    controller.fail(new Error('active-turn controller test complete'))
    controller.close()
  }
})

test('active-turn controller closes admission at the first completed assistant response boundary', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const controller = createAssistantActiveTurnInputController({
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })

  controller.closeInputAdmission()

  expect(steerAssistantActiveTurnInput({
    conversation: {
      channel: 'telegram',
      identityId: 'identity-1',
      threadId: 'thread-1',
    },
    expectedActiveTurnId: 'turn-active',
    prompt: 'Arrived after the first completed response',
    vault: '/vaults/test',
  })).toBeNull()
  await expect(controller.notifyInputAvailable({
    inputIds: ['ain_after_first_response'],
  })).resolves.toBeUndefined()
})

test('active-turn controller lets only an already-started deferred steer settle after admission closes', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const beforeSteerStarted = createDeferred<void>()
  const releaseBeforeSteer = createDeferred<void>()
  const steer = vi.fn(async () => undefined)
  const controller = createAssistantActiveTurnInputController({
    beforeProviderSteer: async () => {
      beforeSteerStarted.resolve()
      await releaseBeforeSteer.promise
    },
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    const first = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-active',
      prompt: 'Already started before the first response',
      vault: '/vaults/test',
    })
    assert.ok(first)
    first.catch(() => undefined)
    await beforeSteerStarted.promise

    const second = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-active',
      prompt: 'Queued behind the in-flight steer',
      vault: '/vaults/test',
    })
    assert.ok(second)
    second.catch(() => undefined)

    controller.closeInputAdmission()
    expect(steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-active',
      prompt: 'Arrived after closure',
      vault: '/vaults/test',
    })).toBeNull()

    const admission = controller.admitLiveSteered()
    releaseBeforeSteer.resolve()

    const acceptedAdmission = await admission
    expect(acceptedAdmission).toEqual({
      acceptedInputs: [
        {
          acceptedAt: expect.any(String),
          id: 'manual-1',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Already started before the first response',
          source: 'manual',
        },
      ],
      kind: 'accepted',
      prompt: 'Already started before the first response',
      providerAlreadySteered: true,
      transcriptText: null,
      userMessageContent: [
        {
          text: 'Already started before the first response',
          type: 'text',
        },
      ],
    })
    assert.equal(acceptedAdmission?.kind, 'accepted')
    if (acceptedAdmission?.kind === 'accepted') {
      controller.commitLiveSteeredLocalAdmission(acceptedAdmission)
    }
    await expect(controller.admitLiveSteered()).resolves.toBeUndefined()
    expect(steer).toHaveBeenCalledTimes(1)
  } finally {
    releaseBeforeSteer.resolve()
    releaseLiveTurn()
    controller.fail(new Error('active-turn deferred steer closure test complete'))
    controller.close()
  }
})

test('active-turn controller keeps an acknowledged manual input queued until local commit', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const steer = vi.fn(async () => undefined)
  const controller = createAssistantActiveTurnInputController({
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    const firstCompletion = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-active',
      prompt: 'First live input',
      vault: '/vaults/test',
    })
    assert.ok(firstCompletion)
    firstCompletion.catch(() => undefined)
    await vi.waitFor(() => {
      expect(steer).toHaveBeenCalledTimes(1)
    })
    const firstAdmission = await controller.admitLiveSteered()
    assert.equal(firstAdmission?.kind, 'accepted')

    const secondCompletion = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-active',
      prompt: 'Second live input',
      vault: '/vaults/test',
    })
    assert.ok(secondCompletion)
    secondCompletion.catch(() => undefined)
    expect(steer).toHaveBeenCalledTimes(1)

    if (firstAdmission?.kind === 'accepted') {
      controller.commitLiveSteeredLocalAdmission(firstAdmission)
    }
    await vi.waitFor(() => {
      expect(steer).toHaveBeenCalledTimes(2)
    })
    const secondAdmission = await controller.admitLiveSteered()
    assert.equal(secondAdmission?.kind, 'accepted')
    if (secondAdmission?.kind === 'accepted') {
      assert.equal(secondAdmission.acceptedInputs[0]?.id, 'manual-2')
      controller.commitLiveSteeredLocalAdmission(secondAdmission)
    }
  } finally {
    releaseLiveTurn()
    controller.fail(new Error('active-turn manual local-commit barrier test complete'))
    controller.close()
  }
})

test('active-turn controller leaves a rejected in-flight steer unaccepted after admission closes', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const steerStarted = createDeferred<void>()
  const steerRejected = createDeferred<void>()
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => ({
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Durable input awaiting provider acknowledgement',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Durable input awaiting provider acknowledgement',
      transcriptText: 'Durable input awaiting provider acknowledgement',
      userMessageContent: [
        {
          text: 'Durable input awaiting provider acknowledgement',
          type: 'text',
        },
      ],
    }),
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer: async () => {
      steerStarted.resolve()
      await steerRejected.promise
      throw new Error('provider rejected steer')
    },
    turnId: 'turn-active',
  })

  try {
    await controller.notifyInputAvailable({ inputIds: ['hook-1'] })
    await steerStarted.promise
    controller.closeInputAdmission()
    steerRejected.resolve()

    await expect(controller.admitLiveSteered()).resolves.toBeUndefined()
  } finally {
    steerRejected.resolve()
    releaseLiveTurn()
    controller.close()
  }
})

test('active-turn controller drains queued manual input before probed hook input', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => ({
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook input',
          source: 'assistant-input',
        },
      ],
      deliveryReplyToMessageId: 'reply-hook',
      kind: 'accepted',
      prompt: 'Hook input',
      receiptMetadata: {
        hook: 'yes',
      },
      transcriptText: 'Hook transcript',
      userMessageContent: [
        {
          text: 'Hook input',
          type: 'text',
        },
      ],
    }),
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  try {
    const steered = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      deliveryReplyToMessageId: 'reply-manual',
      expectedActiveTurnId: 'turn-active',
      prompt: 'Manual input',
      vault: '/vaults/test',
    })
    assert.ok(steered)
    steered.catch(() => undefined)

    expect(await controller.admitAvailable()).toEqual({
      acceptedInputs: [
        {
          acceptedAt: expect.any(String),
          id: 'manual-1',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Manual input',
          source: 'manual',
        },
      ],
      deliveryReplyToMessageId: 'reply-manual',
      kind: 'accepted',
      prompt: 'Manual input',
      transcriptText: null,
      userMessageContent: [
        {
          text: 'Manual input',
          type: 'text',
        },
      ],
    })

    assert.deepEqual(await controller.admitAvailable({ probeIfIdle: true }), {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook input',
          source: 'assistant-input',
        },
      ],
      deliveryReplyToMessageId: 'reply-hook',
      kind: 'accepted',
      prompt: 'Hook input',
      receiptMetadata: {
        hook: 'yes',
      },
      transcriptText: 'Hook transcript',
      userMessageContent: [
        {
          text: 'Hook input',
          type: 'text',
        },
      ],
    })
  } finally {
    controller.fail(new Error('active-turn controller composition test complete'))
    controller.close()
  }
})

test('active-turn controller does not admit probed hook input after provider release', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const liveSteeredPrompts: string[] = []
  const providerSteerOrder: string[] = []
  const controller = createAssistantActiveTurnInputController({
    beforeProviderSteer: async ({ acceptedInputs }) => {
      expect(acceptedInputs.map((item) => item.id)).toEqual(['manual-1'])
      providerSteerOrder.push('causal-seq')
    },
    admissionHook: async (input) => {
      if (input.knownInputIds?.includes('hook-1')) {
        return {
          kind: 'no-new-input',
        }
      }
      return {
        acceptedInputs: [
          {
            id: 'hook-1',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Boundary hook input',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Boundary hook input',
        transcriptText: 'Boundary hook transcript',
        userMessageContent: [
          {
            text: 'Boundary hook input',
            type: 'text',
          },
        ],
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer: async (input) => {
      providerSteerOrder.push('provider')
      liveSteeredPrompts.push(input.prompt)
    },
    turnId: 'turn-active',
  })
  try {
    const steered = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-active',
      prompt: 'Live-steered input',
      vault: '/vaults/test',
    })
    assert.ok(steered)
    steered.catch(() => undefined)
    await vi.waitFor(() => {
      expect(liveSteeredPrompts).toEqual(['Live-steered input'])
    })
    expect(providerSteerOrder).toEqual(['causal-seq', 'provider'])
    releaseLiveTurn()

    const acceptedAdmission = await controller.admitLiveSteered()
    expect(acceptedAdmission).toEqual({
      acceptedInputs: [
        {
          acceptedAt: expect.any(String),
          id: 'manual-1',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Live-steered input',
          source: 'manual',
        },
      ],
      kind: 'accepted',
      prompt: 'Live-steered input',
      providerAlreadySteered: true,
      transcriptText: null,
      userMessageContent: [
        {
          text: 'Live-steered input',
          type: 'text',
        },
      ],
    })
    assert.equal(acceptedAdmission?.kind, 'accepted')
    if (acceptedAdmission?.kind === 'accepted') {
      controller.commitLiveSteeredLocalAdmission(acceptedAdmission)
    }
    assert.equal(await controller.admitAvailable({ probeIfIdle: true }), undefined)
  } finally {
    releaseLiveTurn()
    controller.fail(new Error('active-turn controller ordering test complete'))
    controller.close()
  }
})

test('active-turn controller validates hook input before live steering it to the provider', async () => {
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputAvailable,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const validationError = new Error('missing assistant input event')
  const steer = vi.fn(async () => undefined)
  const acceptedInputValidator = vi.fn(async () => {
    throw validationError
  })
  const controller = createAssistantActiveTurnInputController({
    acceptedInputValidator,
    admissionHook: async () => ({
      acceptedInputs: [
        {
          contentRef: {
            kind: 'assistant-input-event',
            refId: 'ain_00000000000000000000000000000006',
            version: 'murph.assistant-input-event.v1',
          },
          id: 'ain_00000000000000000000000000000006',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'Unvalidated live input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Unvalidated live input',
      transcriptText: 'Unvalidated live input',
    }),
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    await expect(
      notifyAssistantActiveTurnInputAvailable({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        sessionId: 'session-test',
        vault: '/vaults/test',
      }),
    ).rejects.toThrow(/missing assistant input event/u)
    expect(acceptedInputValidator).toHaveBeenCalledWith({
      acceptedInputs: [
        expect.objectContaining({
          id: 'ain_00000000000000000000000000000006',
          source: 'assistant-input',
        }),
      ],
    })
    expect(steer).not.toHaveBeenCalled()
  } finally {
    releaseLiveTurn()
    controller.fail(new Error('active-turn controller validator test complete'))
    controller.close()
  }
})

test('active-turn controller can notify every active turn in one vault', async () => {
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputsAvailableForVault,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const steer = vi.fn(async () => undefined)
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => ({
      acceptedInputs: [
        {
          acceptedAt: '2031-02-15T09:59:59.900Z',
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Vault-level hook input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Vault-level hook input',
      transcriptText: 'Vault-level hook transcript',
      userMessageContent: [
        {
          text: 'Vault-level hook input',
          type: 'text',
        },
      ],
    }),
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const otherController = createAssistantActiveTurnInputController({
    admissionHook: async () => {
      throw new Error('other vault should not be notified')
    },
    conversationKeys: ['channel:telegram|identity:identity-2|audience:indeterminate|thread:thread-2'],
    sessionId: 'session-other',
    turnId: 'turn-other',
    vault: '/vaults/other',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    await expect(
      notifyAssistantActiveTurnInputsAvailableForVault({
        vault: '/vaults/test',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: 'accepted',
        prompt: 'Vault-level hook input',
      }),
    ])
    expect(steer).toHaveBeenCalledWith({
      prompt: 'Vault-level hook input',
      relativeDateReferenceWindow: {
        earliestAt: '2031-02-15T09:59:59.900Z',
        latestAt: '2031-02-15T09:59:59.900Z',
      },
      userMessageContent: [
        {
          text: 'Vault-level hook input',
          type: 'text',
        },
      ],
    })
  } finally {
    releaseLiveTurn()
    controller.fail(new Error('active-turn controller vault notify test complete'))
    controller.close()
    otherController.close()
  }
})

test('active-turn controller drains in-flight live steer input without post-release probe admission', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const steerStarted = createDeferred<void>()
  const steerRelease = createDeferred<void>()
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      if (input.knownInputIds?.includes('hook-1')) {
        return {
          kind: 'no-new-input',
        }
      }
      return {
        acceptedInputs: [
          {
            id: 'hook-1',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Boundary hook input',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Boundary hook input',
        transcriptText: 'Boundary hook transcript',
        userMessageContent: [
          {
            text: 'Boundary hook input',
            type: 'text',
          },
        ],
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer: async () => {
      steerStarted.resolve()
      await steerRelease.promise
    },
    turnId: 'turn-active',
  })
  try {
    const steered = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-active',
      prompt: 'In-flight live steer input',
      vault: '/vaults/test',
    })
    assert.ok(steered)
    steered.catch(() => undefined)
    await steerStarted.promise
    releaseLiveTurn()

    const admission = controller.admitLiveSteered()
    steerRelease.resolve()

    const acceptedAdmission = await admission
    expect(acceptedAdmission).toEqual({
      acceptedInputs: [
        {
          acceptedAt: expect.any(String),
          id: 'manual-1',
          promptFallbackReason: 'manual-input',
          promptFallbackText: 'In-flight live steer input',
          source: 'manual',
        },
      ],
      kind: 'accepted',
      prompt: 'In-flight live steer input',
      providerAlreadySteered: true,
      transcriptText: null,
      userMessageContent: [
        {
          text: 'In-flight live steer input',
          type: 'text',
        },
      ],
    })
    assert.equal(acceptedAdmission?.kind, 'accepted')
    if (acceptedAdmission?.kind === 'accepted') {
      controller.commitLiveSteeredLocalAdmission(acceptedAdmission)
    }
    assert.equal(await controller.admitAvailable({ probeIfIdle: true }), undefined)
  } finally {
    steerRelease.resolve()
    releaseLiveTurn()
    controller.fail(new Error('active-turn controller in-flight ordering test complete'))
    controller.close()
  }
})

test('active-turn controller interrupts live provider when input-available checkpoint is rejected', async () => {
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputAvailable,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const checkpointRejected = new AssistantActiveTurnInputCheckpointRejectedError(
    'Active turn input checkpoint was rejected; retry from durable state.',
  )
  const interrupt = vi.fn(async () => undefined)
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => {
      throw checkpointRejected
    },
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  try {
    controller.registerLiveProviderTurn({
      interrupt,
      codexThreadId: 'provider-session',
      providerTurnId: 'provider-turn',
      sessionId: 'session-test',
      steer: async () => undefined,
      turnId: 'turn-active',
    })
    await assert.rejects(
      () => notifyAssistantActiveTurnInputAvailable({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        vault: '/vaults/test',
      }),
      AssistantActiveTurnInputCheckpointRejectedError,
    )
    expect(interrupt).toHaveBeenCalledTimes(1)
    await assert.rejects(
      () => controller.admitAvailable(),
      AssistantActiveTurnInputCheckpointRejectedError,
    )
    assert.equal(
      steerAssistantActiveTurnInput({
        conversation: {
          channel: 'telegram',
          identityId: 'identity-1',
          threadId: 'thread-1',
        },
        expectedActiveTurnId: 'turn-active',
        prompt: 'After rejected checkpoint',
        vault: '/vaults/test',
      }),
      null,
    )
  } finally {
    controller.close()
  }
})

test('active-turn controller retries input-available admission after non-fatal input-available failure', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const unavailable = new AssistantActiveTurnInputUnavailableError(
    'Active turn input source is temporarily unavailable.',
  )
  let failedOnce = false
  let probeAdmissions = 0
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => {
      if (!failedOnce) {
        failedOnce = true
        throw unavailable
      }
      probeAdmissions += 1
      return {
        acceptedInputs: [
          {
            id: 'hook-1',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Boundary hook input',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Boundary hook input',
        transcriptText: 'Boundary hook transcript',
        userMessageContent: [
          {
            text: 'Boundary hook input',
            type: 'text',
          },
        ],
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  try {
    const notification = controller.notifyInputAvailable().catch(() => undefined)
    assert.deepEqual(await controller.admitAvailable({ probeIfIdle: true }), {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Boundary hook input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Boundary hook input',
      transcriptText: 'Boundary hook transcript',
      userMessageContent: [
        {
          text: 'Boundary hook input',
          type: 'text',
        },
      ],
    })
    await notification
    assert.equal(probeAdmissions, 1)
  } finally {
    controller.close()
  }
})

test('active-turn controller only probes input after explicit notification or provider boundary', async () => {
  vi.useFakeTimers()
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputAvailable,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const steer = vi.fn(async () => undefined)
  let admissionCount = 0
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => {
      admissionCount += 1
      return {
        acceptedInputs: [
          {
            id: 'hook-1',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Notification hook input',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Notification hook input',
        transcriptText: 'Notification hook transcript',
        userMessageContent: [
          {
            text: 'Notification hook input',
            type: 'text',
          },
        ],
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    assert.equal(vi.getTimerCount(), 0)
    await vi.advanceTimersByTimeAsync(1500)
    assert.equal(admissionCount, 0)
    expect(steer).not.toHaveBeenCalled()

    assert.equal(await controller.admitAvailable(), undefined)
    assert.equal(admissionCount, 0)

    await notifyAssistantActiveTurnInputAvailable({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      vault: '/vaults/test',
    })

    assert.equal(admissionCount, 1)
    expect(steer).toHaveBeenCalledWith({
      prompt: 'Notification hook input',
      relativeDateReferenceWindow: null,
      userMessageContent: [
        {
          text: 'Notification hook input',
          type: 'text',
        },
      ],
    })
    assert.deepEqual(await controller.admitLiveSteered(), {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Notification hook input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Notification hook input',
      providerAlreadySteered: true,
      transcriptText: 'Notification hook transcript',
      userMessageContent: [
        {
          text: 'Notification hook input',
          type: 'text',
        },
      ],
    })
  } finally {
    releaseLiveTurn()
    controller.close()
  }
})

test('active-turn controller re-steers pending input into a replacement live provider turn', async () => {
  const {
    createAssistantActiveTurnInputController,
    steerAssistantActiveTurnInput,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const steerCalls: Array<{
    prompt: string
    providerTurnId: string
  }> = []
  const controller = createAssistantActiveTurnInputController({
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releasePrimary = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn-primary',
    sessionId: 'session-test',
    steer: async (input) => {
      steerCalls.push({
        prompt: input.prompt,
        providerTurnId: 'provider-turn-primary',
      })
    },
    turnId: 'turn-active',
  })

  try {
    const steered = steerAssistantActiveTurnInput({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      expectedActiveTurnId: 'turn-active',
      prompt: 'Re-steer me',
      vault: '/vaults/test',
    })
    assert.ok(steered)
    steered.catch(() => undefined)
    await vi.waitFor(() => {
      expect(steerCalls).toEqual([
        {
          prompt: 'Re-steer me',
          providerTurnId: 'provider-turn-primary',
        },
      ])
    })

    releasePrimary()
    const releaseFallback = controller.registerLiveProviderTurn({
      interrupt: async () => undefined,
      codexThreadId: 'provider-session',
      providerTurnId: 'provider-turn-fallback',
      sessionId: 'session-test',
      steer: async (input) => {
        steerCalls.push({
          prompt: input.prompt,
          providerTurnId: 'provider-turn-fallback',
        })
      },
      turnId: 'turn-active',
    })
    try {
      await vi.waitFor(() => {
        expect(steerCalls).toEqual([
          {
            prompt: 'Re-steer me',
            providerTurnId: 'provider-turn-primary',
          },
          {
            prompt: 'Re-steer me',
            providerTurnId: 'provider-turn-fallback',
          },
        ])
      })
      expect(await controller.admitLiveSteered()).toEqual({
        acceptedInputs: [
          {
            acceptedAt: expect.any(String),
            id: 'manual-1',
            promptFallbackReason: 'manual-input',
            promptFallbackText: 'Re-steer me',
            source: 'manual',
          },
        ],
        kind: 'accepted',
        prompt: 'Re-steer me',
        providerAlreadySteered: true,
        transcriptText: null,
        userMessageContent: [
          {
            text: 'Re-steer me',
            type: 'text',
          },
        ],
      })
    } finally {
      releaseFallback()
    }
  } finally {
    releasePrimary()
    controller.fail(new Error('active-turn provider replacement test complete'))
    controller.close()
  }
})

test('active-turn controller drops in-flight hook input that resolves after provider release', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const admissionStarted = createDeferred<void>()
  const admissionRelease = createDeferred<void>()
  const steer = vi.fn(async () => undefined)
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => {
      admissionStarted.resolve()
      await admissionRelease.promise
      return {
        acceptedInputs: [
          {
            id: 'hook-after-release',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Hook after release',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Hook after release',
        transcriptText: 'Hook after release',
        userMessageContent: [
          {
            text: 'Hook after release',
            type: 'text',
          },
        ],
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    const notification = controller.notifyInputAvailable()
    await admissionStarted.promise
    releaseLiveTurn()
    admissionRelease.resolve()

    await expect(notification).resolves.toEqual({
      kind: 'no-new-input',
    })
    expect(steer).not.toHaveBeenCalled()
    assert.equal(await controller.admitLiveSteered(), undefined)
    assert.equal(await controller.admitAvailable(), undefined)
  } finally {
    admissionRelease.resolve()
    releaseLiveTurn()
    controller.close()
  }
})

test('active-turn controller reruns input-available admission for in-flight notifications', async () => {
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputAvailable,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const firstAdmissionStarted = createDeferred<void>()
  const firstAdmissionRelease = createDeferred<void>()
  let admissionCount = 0
  const steer = vi.fn(async () => undefined)
  let ordinal = 0
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => {
      admissionCount += 1
      ordinal += 1
      if (ordinal === 1) {
        firstAdmissionStarted.resolve()
        await firstAdmissionRelease.promise
        return {
          kind: 'no-new-input',
        }
      }

      return {
        acceptedInputs: [
          {
            id: 'hook-2',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Rerun hook input',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Rerun hook input',
        transcriptText: 'Rerun hook transcript',
        userMessageContent: [
          {
            text: 'Rerun hook input',
            type: 'text',
          },
        ],
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    const firstNotification = notifyAssistantActiveTurnInputAvailable({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      vault: '/vaults/test',
    })
    await firstAdmissionStarted.promise
    const secondNotification = notifyAssistantActiveTurnInputAvailable({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      vault: '/vaults/test',
    })
    await Promise.resolve()
    assert.equal(admissionCount, 1)

    firstAdmissionRelease.resolve()
    const [firstResult, secondResult] = await Promise.all([
      firstNotification,
      secondNotification,
    ])
    assert.equal(admissionCount, 2)
    assert.equal(firstResult?.kind, 'accepted')
    assert.equal(secondResult?.kind, 'accepted')
    expect(steer).toHaveBeenCalledTimes(1)
    expect(steer).toHaveBeenCalledWith({
      prompt: 'Rerun hook input',
      relativeDateReferenceWindow: null,
      userMessageContent: [
        {
          text: 'Rerun hook input',
          type: 'text',
        },
      ],
    })
    assert.deepEqual(await controller.admitLiveSteered(), {
      acceptedInputs: [
        {
          id: 'hook-2',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Rerun hook input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Rerun hook input',
      providerAlreadySteered: true,
      transcriptText: 'Rerun hook transcript',
      userMessageContent: [
        {
          text: 'Rerun hook input',
          type: 'text',
        },
      ],
    })
  } finally {
    firstAdmissionRelease.resolve()
    releaseLiveTurn()
    controller.close()
  }
})

test('active-turn notifier preserves A-B-A staged ids for one shared group route', async () => {
  const actorByInputId = new Map([
    ['ain_61616161616161616161616161616161', 'actor-a'],
    ['ain_62626262626262626262626262626262', 'actor-b'],
    ['ain_63636363636363636363636363636363', 'actor-a'],
  ])
  vi.doMock('../src/assistant/input-store.js', () => ({
    readAssistantInputEvent: vi.fn(async (input: { inputId: string }) => ({
      conversation: {
        accountId: 'account-group-order',
        actorId: actorByInputId.get(input.inputId) ?? null,
        actorIsSelf: false,
        source: 'linq',
        threadId: 'thread-group-order',
        threadIsDirect: false,
      },
    })),
  }))
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputAvailableForInputIds,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const admittedInputIds: Array<readonly string[] | undefined> = []
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      admittedInputIds.push(input.availableInputIds)
      return { kind: 'no-new-input' }
    },
    conversationKeys: [
      'channel:linq|identity:account-group-order|audience:group|thread:thread-group-order',
    ],
    sessionId: 'session-group-order',
    turnId: 'turn-group-order',
    vault: '/vaults/test',
  })
  const inputIds = [...actorByInputId.keys()]

  try {
    await notifyAssistantActiveTurnInputAvailableForInputIds({
      inputIds,
      vault: '/vaults/test',
    })
    const laterInputId = 'ain_64646464646464646464646464646464'
    actorByInputId.set(laterInputId, 'actor-a')
    await notifyAssistantActiveTurnInputAvailableForInputIds({
      inputIds: [laterInputId],
      vault: '/vaults/test',
    })
    assert.deepEqual(admittedInputIds, [
      inputIds,
      [...inputIds, laterInputId],
    ])
  } finally {
    controller.close()
    vi.doUnmock('../src/assistant/input-store.js')
  }
})

test('active-turn controller admits an exact notified batch one successor at a time', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const firstInputId = 'ain_71717171717171717171717171717171'
  const secondInputId = 'ain_72727272727272727272727272727272'
  const admittedInputIds: Array<readonly string[] | undefined> = []
  const steer = vi.fn(async () => undefined)
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      admittedInputIds.push(input.availableInputIds)
      const inputId = input.availableInputIds?.[0]
      return inputId
        ? {
            acceptedInputs: [{
              id: inputId,
              promptFallbackReason: 'missing-content-ref' as const,
              promptFallbackText: inputId,
              source: 'assistant-input' as const,
            }],
            kind: 'accepted' as const,
            prompt: inputId,
            transcriptText: inputId,
          }
        : { kind: 'no-new-input' as const }
    },
    conversationKeys: [
      'channel:linq|identity:account-batch|audience:direct|thread:thread-batch',
    ],
    sessionId: 'session-exact-batch',
    turnId: 'turn-exact-batch',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session-exact-batch',
    providerTurnId: 'provider-turn-exact-batch',
    sessionId: 'session-exact-batch',
    steer,
    turnId: 'turn-exact-batch',
  })

  try {
    await controller.notifyInputAvailable({
      inputIds: [firstInputId, secondInputId],
    })
    await vi.waitFor(() => {
      expect(steer).toHaveBeenCalledTimes(1)
    })
    assert.deepEqual(admittedInputIds, [
      [firstInputId, secondInputId],
      [secondInputId],
    ])
    const firstAdmission = await controller.admitLiveSteered()
    expect(steer).toHaveBeenCalledTimes(1)
    if (firstAdmission?.kind === 'accepted') {
      controller.commitLiveSteeredLocalAdmission(firstAdmission)
    }
    await vi.waitFor(() => {
      expect(steer).toHaveBeenCalledTimes(2)
    })
    const secondAdmission = await controller.admitLiveSteered()
    assert.equal(firstAdmission?.kind, 'accepted')
    assert.equal(secondAdmission?.kind, 'accepted')
    if (firstAdmission?.kind === 'accepted' && secondAdmission?.kind === 'accepted') {
      assert.equal(firstAdmission.acceptedInputs[0]?.id, firstInputId)
      assert.equal(secondAdmission.acceptedInputs[0]?.id, secondInputId)
    }
  } finally {
    releaseLiveTurn()
    controller.close()
  }
})

test('active-turn controller reruns input-available admission after an accepted in-flight notification', async () => {
  const {
    createAssistantActiveTurnInputController,
    notifyAssistantActiveTurnInputAvailable,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const firstAdmissionStarted = createDeferred<void>()
  const firstAdmissionRelease = createDeferred<void>()
  let admissionCount = 0
  const knownInputSnapshots: string[][] = []
  const steer = vi.fn(async () => undefined)
  let ordinal = 0
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      admissionCount += 1
      knownInputSnapshots.push([...(input.knownInputIds ?? [])])
      ordinal += 1
      const id = `hook-${ordinal}`
      const prompt = `Rerun accepted hook input ${ordinal}`
      const result = {
        acceptedInputs: [
          {
            id,
            promptFallbackReason: 'missing-content-ref' as const,
            promptFallbackText: prompt,
            source: 'assistant-input' as const,
          },
        ],
        kind: 'accepted' as const,
        prompt,
        transcriptText: `Rerun accepted hook transcript ${ordinal}`,
        userMessageContent: [
          {
            text: prompt,
            type: 'text' as const,
          },
        ],
      }
      if (ordinal === 1) {
        firstAdmissionStarted.resolve()
        await firstAdmissionRelease.promise
      }
      return result
    },
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })
  const releaseLiveTurn = controller.registerLiveProviderTurn({
    interrupt: async () => undefined,
    codexThreadId: 'provider-session',
    providerTurnId: 'provider-turn',
    sessionId: 'session-test',
    steer,
    turnId: 'turn-active',
  })

  try {
    const firstNotification = notifyAssistantActiveTurnInputAvailable({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      vault: '/vaults/test',
    })
    await firstAdmissionStarted.promise
    const secondNotification = notifyAssistantActiveTurnInputAvailable({
      conversation: {
        channel: 'telegram',
        identityId: 'identity-1',
        threadId: 'thread-1',
      },
      vault: '/vaults/test',
    })
    await Promise.resolve()
    assert.equal(admissionCount, 1)

    firstAdmissionRelease.resolve()
    const [firstResult, secondResult] = await Promise.all([
      firstNotification,
      secondNotification,
    ])
    assert.equal(admissionCount, 2)
    assert.deepEqual(knownInputSnapshots, [[], ['hook-1']])
    assert.equal(firstResult?.kind, 'accepted')
    assert.equal(secondResult?.kind, 'accepted')
    expect(steer).toHaveBeenCalledTimes(1)
    const firstAdmission = await controller.admitLiveSteered()
    assert.deepEqual(firstAdmission, {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Rerun accepted hook input 1',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Rerun accepted hook input 1',
      providerAlreadySteered: true,
      transcriptText: 'Rerun accepted hook transcript 1',
      userMessageContent: [
        {
          text: 'Rerun accepted hook input 1',
          type: 'text',
        },
      ],
    })
    if (firstAdmission?.kind === 'accepted') {
      controller.commitLiveSteeredLocalAdmission(firstAdmission)
    }
    await vi.waitFor(() => {
      expect(steer).toHaveBeenCalledTimes(2)
    })
    const secondAdmission = await controller.admitLiveSteered()
    assert.deepEqual(secondAdmission, {
      acceptedInputs: [
        {
          id: 'hook-2',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Rerun accepted hook input 2',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Rerun accepted hook input 2',
      providerAlreadySteered: true,
      transcriptText: 'Rerun accepted hook transcript 2',
      userMessageContent: [
        {
          text: 'Rerun accepted hook input 2',
          type: 'text',
        },
      ],
    })
    if (secondAdmission?.kind === 'accepted') {
      controller.commitLiveSteeredLocalAdmission(secondAdmission)
    }
    assert.equal(await controller.admitAvailable(), undefined)
  } finally {
    firstAdmissionRelease.resolve()
    releaseLiveTurn()
    controller.close()
  }
})

test('active-turn controller can probe store-backed input before provider execution', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  let admissionCount = 0
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => {
      admissionCount += 1
      return {
        acceptedInputs: [
          {
            id: 'hook-polled',
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: 'Polled hook input',
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: 'Polled hook input',
        transcriptText: 'Polled hook transcript',
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    eventAdmissionEnabled: false,
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })

  try {
    assert.deepEqual(await controller.admitAvailable({ probeIfIdle: true }), {
      acceptedInputs: [
        {
          id: 'hook-polled',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Polled hook input',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Polled hook input',
      transcriptText: 'Polled hook transcript',
    })
    assert.equal(admissionCount, 1)
  } finally {
    controller.close()
  }
})

test('active-turn controller preserves delivery idempotency across merged admissions', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  let ordinal = 0
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => {
      ordinal += 1
      return {
        acceptedInputs: [
          {
            id: `hook-${ordinal}`,
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: `Hook input ${ordinal}`,
            source: 'assistant-input',
          },
        ],
        deliveryIdempotencyKey: `idem-${ordinal}`,
        kind: 'accepted',
        prompt: `Hook input ${ordinal}`,
        transcriptText: `Hook transcript ${ordinal}`,
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })

  try {
    await controller.notifyInputAvailable()
    await controller.notifyInputAvailable()

    assert.deepEqual(await controller.admitAvailable(), {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook input 1',
          source: 'assistant-input',
        },
        {
          id: 'hook-2',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook input 2',
          source: 'assistant-input',
        },
      ],
      deliveryIdempotencyKey: 'idem-2',
      kind: 'accepted',
      prompt: 'Hook input 1\n\nHook input 2',
      receiptMetadata: undefined,
      transcriptText: 'Hook transcript 1\n\nHook transcript 2',
      userMessageContent: undefined,
    })
  } finally {
    controller.close()
  }
})

test('active-turn controller ignores hook-authored provider steering acknowledgement', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async () => ({
      acceptedInputs: [
        {
          id: 'hook-steered',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook claims already steered',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Hook claims already steered',
      providerAlreadySteered: true,
      transcriptText: 'Hook transcript',
    }),
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })

  try {
    assert.deepEqual(await controller.admitAvailable({ probeIfIdle: true }), {
      acceptedInputs: [
        {
          id: 'hook-steered',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook claims already steered',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Hook claims already steered',
      transcriptText: 'Hook transcript',
    })
  } finally {
    controller.close()
  }
})

test('active-turn controller serializes overlapping input-available hook admission', async () => {
  const {
    createAssistantActiveTurnInputController,
  } = await import('../src/assistant/active-turn-input-controller.ts')
  const releaseFirst = createDeferred<void>()
  let admissionCount = 0
  const knownInputSnapshots: string[][] = []
  let ordinal = 0
  const controller = createAssistantActiveTurnInputController({
    admissionHook: async (input) => {
      admissionCount += 1
      knownInputSnapshots.push([...(input.knownInputIds ?? [])])
      ordinal += 1
      const currentOrdinal = ordinal
      if (currentOrdinal === 1) {
        await releaseFirst.promise
      }
      return {
        acceptedInputs: [
          {
            id: `hook-${currentOrdinal}`,
            promptFallbackReason: 'missing-content-ref',
            promptFallbackText: `Hook input ${currentOrdinal}`,
            source: 'assistant-input',
          },
        ],
        kind: 'accepted',
        prompt: `Hook input ${currentOrdinal}`,
        transcriptText: `Hook transcript ${currentOrdinal}`,
      }
    },
    conversationKeys: ['channel:telegram|identity:identity-1|audience:indeterminate|thread:thread-1'],
    sessionId: 'session-test',
    turnId: 'turn-active',
    vault: '/vaults/test',
  })

  try {
    const notified = controller.notifyInputAvailable().catch(() => undefined)
    await vi.waitFor(() => {
      expect(admissionCount).toBe(1)
    })
    const probe = controller.admitAvailable({ probeIfIdle: true })
    await Promise.resolve()
    assert.equal(admissionCount, 1)

    releaseFirst.resolve()
    assert.deepEqual(await probe, {
      acceptedInputs: [
        {
          id: 'hook-1',
          promptFallbackReason: 'missing-content-ref',
          promptFallbackText: 'Hook input 1',
          source: 'assistant-input',
        },
      ],
      kind: 'accepted',
      prompt: 'Hook input 1',
      transcriptText: 'Hook transcript 1',
    })
    await notified
    assert.equal(admissionCount, 1)
    assert.deepEqual(knownInputSnapshots, [[]])
  } finally {
    releaseFirst.resolve()
    controller.close()
  }
})
