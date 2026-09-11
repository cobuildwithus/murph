import { expect, test, vi } from 'vitest'

import { assistantInputCandidateFromStoredEvent } from '../src/assistant/input-source.ts'
import { upsertAssistantInputEvent } from '../src/assistant/input-store.ts'
import { createTempVaultContext } from './test-helpers.ts'
import {
  createAssistantSession,
  createDeferred,
  createHostedMailboxSourceRef,
  createSharedPlan,
  loadLocalServiceModule,
  tempRoots,
} from './assistant-local-service-runtime.harness.ts'

test.each((['linq', 'telegram'] as const).flatMap((channel) =>
  [false, true].map((pending) => ({ channel, pending })),
))('records $channel typing for input staged before typing starts (pending: $pending)', async ({ channel, pending }) => {
  const context = await createTempVaultContext('assistant-typing-admission-')
  tempRoots.push(context.parentRoot)
  const session = createAssistantSession({ binding: {
    actorId: null, channel, conversationKey: null, identityId: null,
    delivery: { kind: 'thread', target: '12345' }, threadId: '12345', threadIsDirect: true,
  } })
  const plan = createSharedPlan()
  plan.conversationPolicy.audience = {
    ...plan.conversationPolicy.audience,
    actorId: null, channel, threadId: '12345', threadIsDirect: true,
  }
  const { mocks, sendAssistantMessageLocal } = await loadLocalServiceModule({
    plan, session, realAcceptedInputPersistence: true,
  })
  const adapters = await vi.importActual<typeof import('../src/assistant/channel-adapters.ts')>(
    '../src/assistant/channel-adapters.ts',
  )
  mocks.getAssistantChannelAdapter.mockImplementation(adapters.getAssistantChannelAdapter)
  const providerReady = createDeferred<void>()
  const stop = vi.fn(async () => undefined)
  const startTyping = vi.fn(async () => {
    if (pending) await providerReady.promise
    return { stop }
  })
  const onTypingAccepted = vi.fn()
  let followup: Awaited<ReturnType<typeof upsertAssistantInputEvent>> | null = null
  // Receipt preparation precedes the typing wrapper and input-controller registration.
  mocks.createAssistantTurnReceipt.mockImplementationOnce(async () => {
    followup = await upsertAssistantInputEvent({ vault: context.vaultRoot, event: {
      content: { text: 'Synthetic follow-up' }, occurredAt: '2026-09-11T00:00:00.000Z',
      sourceRef: createHostedMailboxSourceRef({ eventId: 'evt_pre_typing_followup', laneSeq: '2' }),
    } })
    expect(startTyping).not.toHaveBeenCalled()
    return { turnId: 'turn-1' }
  })
  const activeTurnInput = vi.fn().mockImplementationOnce(async () => {
    if (!followup) throw new Error('Expected staged follow-up')
    return {
      acceptedInputs: [{
        ...assistantInputCandidateFromStoredEvent(followup).acceptedInput,
        promptFallbackText: 'Synthetic follow-up',
      }],
      kind: 'accepted', prompt: 'Synthetic follow-up', transcriptText: 'Synthetic follow-up',
    }
  }).mockResolvedValue({ kind: 'no-new-input' })
  const execute = mocks.executeCodexTurnWithRecovery.getMockImplementation()!
  mocks.executeCodexTurnWithRecovery.mockImplementationOnce(async (input) => {
    expect(activeTurnInput).toHaveBeenCalled()
    expect(startTyping).toHaveBeenCalledOnce()
    if (pending) expect(onTypingAccepted).not.toHaveBeenCalled()
    providerReady.resolve()
    await vi.waitFor(() => expect(onTypingAccepted).toHaveBeenCalledWith({
      acceptedInputIds: [followup!.inputId], at: expect.any(String), channel,
    }))
    return execute(input)
  })
  try {
    await sendAssistantMessageLocal({
      activeTurnInput, channel, deliverResponse: true, prompt: 'Synthetic initial input',
      vault: context.vaultRoot,
      executionContext: { hosted: {
        memberId: 'synthetic-member', userEnvKeys: [],
        channelTypingDependencies: {
          startLinqTyping: startTyping, startTelegramTyping: startTyping, onTypingAccepted,
        },
      } },
    })
    expect(mocks.executeCodexTurnWithRecovery).toHaveBeenCalledOnce()
    expect(startTyping).toHaveBeenCalledOnce()
    expect(stop).toHaveBeenCalledOnce()
  } finally {
    providerReady.resolve()
  }
})
