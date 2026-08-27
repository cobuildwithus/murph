import { rm } from 'node:fs/promises'

import {
  buildHostedExecutionGroupContextHandoffInstructions,
} from '@murphai/hosted-execution'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import type { AssistantSession } from '@murphai/operator-config/assistant-cli-contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { executeCodexTurnWithRecovery } from '../src/assistant/codex-turn-runner.ts'
import { sendAssistantNotificationLocal } from '../src/assistant/notification-turn.ts'
import { sendAssistantMessageLocal } from '../src/assistant/service.ts'
import {
  listAssistantTranscriptEntries,
  resolveAssistantSession,
  saveAssistantSession,
} from '../src/assistant/store.ts'
import { createTempVaultContext } from './test-helpers.ts'

const boundaries = vi.hoisted(() => ({
  executeProvider: vi.fn<typeof executeCodexTurnWithRecovery>(),
}))

vi.mock('../src/assistant/codex-turn-runner.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/assistant/codex-turn-runner.ts')
  >()
  return {
    ...actual,
    executeCodexTurnWithRecovery: boundaries.executeProvider,
  }
})

const cleanupPaths: string[] = []
const target = createAssistantModelTarget({
  approvalPolicy: 'never',
  model: 'gpt-5.6-terra',
  modelProvider: 'vercel-ai-gateway',
  provider: 'codex-cli',
  reasoningEffort: 'medium',
  sandbox: 'danger-full-access',
})

if (!target) {
  throw new Error('Expected a synthetic assistant model target.')
}

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(cleanupPaths.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ))
})

describe('synthetic group/private handoff flow', () => {
  it('keeps the handoff on the canonical group session for the next follow-up', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'group-private-handoff-flow-',
    )
    cleanupPaths.push(parentRoot)
    const locator = {
      actorId: 'participant-delta',
      bindingDeliveryTarget: 'synthetic-group-thread',
      channel: 'linq' as const,
      deliveryKind: 'thread' as const,
      deliveryTarget: 'synthetic-group-thread',
      identityId: 'synthetic-group-identity',
      threadId: 'synthetic-group-thread',
      threadIsDirect: false,
    }
    const executionContext = {
      hosted: {
        defaultTarget: target,
        memberId: 'synthetic-group-runtime',
        userEnvKeys: [],
      },
    } as const
    const initial = await resolveAssistantSession({
      ...locator,
      target,
      vault: vaultRoot,
    })
    const nativeResume: NonNullable<AssistantSession['codexResume']> = {
      routeFingerprint: 'route-before-handoff',
      threadId: 'native-thread-before-handoff',
    }
    await saveAssistantSession(vaultRoot, {
      ...initial.session,
      codexResume: nativeResume,
      resumeState: nativeResume,
    })

    const handoffText =
      'Member Delta averaged 7,400 steps across 120 synthetic tracked days.'
    boundaries.executeProvider
      .mockImplementationOnce(async (input) => ({
        kind: 'succeeded',
        providerTurn: createProviderTurn({
          input,
          response: handoffText,
          threadId: 'isolated-handoff-thread',
        }),
      }))
      .mockImplementationOnce(async (input) => {
        expect(input.resolvedSession.sessionId).toBe(initial.session.sessionId)
        expect(input.resolvedSession.target).toEqual(target)
        expect(input.resolvedSession.codexResume).toBeNull()
        await expect(listAssistantTranscriptEntries(
          vaultRoot,
          initial.session.sessionId,
        )).resolves.toContainEqual(expect.objectContaining({
          standaloneAssistantContext: true,
          text: handoffText,
        }))
        return {
          kind: 'succeeded',
          providerTurn: createProviderTurn({
            input,
            response:
              'That is a meaningful long-term activity pattern and a useful baseline.',
            threadId: 'ordinary-group-thread',
          }),
        }
      })

    const handoff = await sendAssistantNotificationLocal({
      ...locator,
      deliveryDedupeToken: 'synthetic-group-handoff',
      deliveryDispatchMode: 'queue-only',
      deliveryIdempotencyKey: 'synthetic-group-handoff',
      executionContext,
      instructions: buildHostedExecutionGroupContextHandoffInstructions({
        context:
          'The member averaged 7,400 steps across 120 synthetic tracked days.',
        sourceDisplayName: 'Member Delta',
      }),
      notificationPromptProfile: 'context-handoff',
      outboxExternalThreadRouteAuthority: {
        accountLookupKey: 'synthetic-account',
        channel: 'linq',
        containerMemberId: 'synthetic-group-runtime',
        threadId: 'synthetic-group-thread',
      },
      responsePolicy: { kind: 'require_send' },
      vault: vaultRoot,
      workingDirectory: vaultRoot,
    })

    expect(handoff.session).toMatchObject({
      codexResume: null,
      resumeState: null,
      sessionId: initial.session.sessionId,
      target,
    })
    await expect(listAssistantTranscriptEntries(
      vaultRoot,
      initial.session.sessionId,
    )).resolves.toContainEqual(expect.objectContaining({
      standaloneAssistantContext: true,
      text: handoffText,
    }))

    const followUp = await sendAssistantMessageLocal({
      ...locator,
      deliverResponse: false,
      executionContext,
      includeEarlySessionOnboarding: false,
      persistUserPromptOnFailure: false,
      prompt: 'What do you think about that average over the full period?',
      sessionId: initial.session.sessionId,
      vault: vaultRoot,
      workingDirectory: vaultRoot,
    })

    expect(followUp.response).toMatch(/meaningful long-term activity pattern/iu)
    expect(boundaries.executeProvider).toHaveBeenCalledTimes(2)
  })
})

function createProviderTurn(input: {
  input: Parameters<typeof executeCodexTurnWithRecovery>[0]
  response: string
  threadId: string
}) {
  return {
    assistantContractFingerprint: 'a'.repeat(64),
    attemptCount: 1,
    codexContinuation: { kind: 'explicit-structured-history' as const },
    codexThreadId: input.threadId,
    provider: input.input.route.provider,
    providerOptions: input.input.route.providerOptions,
    rawEvents: [],
    response: input.response,
    responseDeliveryContextOrdinal: 0,
    responseMedia: [],
    route: input.input.route,
    session: input.input.resolvedSession,
    stderr: '',
    stdout: '',
    transcriptResponse: input.response,
    usage: null,
    workingDirectory: input.input.plan.requestedWorkingDirectory,
  }
}
