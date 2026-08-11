import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createAssistantModelTarget,
  type AssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import {
  parseAssistantSessionRecord,
  type AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  buildCodexResumeState,
} from '@murphai/operator-config/assistant/codex-resume-state'
import type {
  AssistantTurnSharedPlan,
  ExecutedAssistantProviderTurnResult,
} from '../src/assistant/service-contracts.ts'

const runtimeState = vi.hoisted(() => ({
  sessionsSave: vi.fn(async (session: AssistantSession) => session),
  transcriptsAppend: vi.fn(async () => undefined),
  transcriptsList: vi.fn(async () => []),
  turnsAppendEvent: vi.fn(async () => undefined),
}))

vi.mock('../src/assistant/runtime-state-service.js', () => ({
  createAssistantRuntimeStateService: () => ({
    sessions: {
      save: runtimeState.sessionsSave,
    },
    transcripts: {
      append: runtimeState.transcriptsAppend,
      list: runtimeState.transcriptsList,
    },
    turns: {
      appendEvent: runtimeState.turnsAppendEvent,
    },
  }),
}))

import { createAssistantBinding } from '../src/assistant/bindings.ts'
import {
  readCodexThreadCompatibilityFingerprint,
  readCodexThreadRouteFingerprint,
  type CodexThreadIdentity,
} from '../src/assistant/codex-thread-route.ts'
import { resolveAssistantExecutionPlan } from '../src/assistant/execution-plan.ts'
import {
  persistAssistantTurnAndSession,
} from '../src/assistant/turn-finalizer.ts'

beforeEach(() => {
  runtimeState.sessionsSave.mockClear()
  runtimeState.transcriptsAppend.mockClear()
  runtimeState.transcriptsList.mockClear()
  runtimeState.turnsAppendEvent.mockClear()
})

describe('skipped automation continuity', () => {
  it('preserves the attended thread when a turn-scoped automation commits no history', async () => {
    const solTarget = requireTarget('gpt-5.6-sol', 'low')
    const attendedThreadId = 'provider-attended-sol-thread'
    const session = createGroupSession(
      solTarget,
      createResumeState(solTarget, attendedThreadId),
    )
    const lunaRoute = resolveAssistantExecutionPlan({
      defaults: null,
      override: {
        model: 'gpt-5.6-luna',
        reasoningEffort: 'high',
      },
      sessionTarget: solTarget,
    }).codexRoute

    const saved = await persistAssistantTurnAndSession({
      assistantTranscriptText: null,
      input: {
        assistantTargetOverride: {
          model: 'gpt-5.6-luna',
        },
        prompt: 'Decide whether the scheduled reminder is still useful.',
        turnTrigger: 'automation-cron',
        vault: '/vault',
      },
      persistUserPromptToTranscript: false,
      plan: {
        persistUserPromptOnFailure: false,
      } as AssistantTurnSharedPlan,
      providerResult: createProviderResult({
        route: lunaRoute,
        session,
        text: JSON.stringify({
          kind: 'skip',
          privateSummary: 'The reminder is no longer useful.',
        }),
        threadId: 'provider-isolated-luna-thread',
      }),
      providerResumeStateAction: 'preserve-existing',
      session,
      turnCreatedAt: '2026-08-07T01:00:00.000Z',
      turnId: 'turn-skipped-automation',
    })

    expect(runtimeState.transcriptsAppend).not.toHaveBeenCalled()
    expect(saved.target).toEqual(solTarget)
    expect(saved.resumeState?.threadId).toBe(attendedThreadId)
    expect(saved.codexResume?.threadId).toBe(attendedThreadId)
  })
})

function createGroupSession(
  target: AssistantModelTarget,
  resumeState: AssistantSession['resumeState'],
): AssistantSession {
  return parseAssistantSessionRecord({
    schema: 'murph.assistant-conversation.v2',
    alias: null,
    binding: createAssistantBinding({
      actorId: 'group-member',
      channel: 'linq',
      deliveryKind: 'thread',
      deliveryTarget: 'group-thread',
      identityId: 'linq-line',
      threadId: 'group-thread',
      threadIsDirect: false,
    }),
    codexResume: resumeState,
    codexTarget: target,
    conversationId: 'conversation-group',
    createdAt: '2026-08-07T00:00:00.000Z',
    lastTurnAt: '2026-08-07T00:30:00.000Z',
    turnCount: 3,
    updatedAt: '2026-08-07T00:30:00.000Z',
  })
}

function createResumeState(
  target: AssistantModelTarget,
  threadId: string,
): AssistantSession['resumeState'] {
  const route = resolveAssistantExecutionPlan({
    defaults: null,
    sessionTarget: target,
  }).codexRoute
  return buildCodexResumeState({
    assistantContractFingerprint: 'a'.repeat(64),
    rolloutRelativePath: null,
    routeFingerprint: readCodexThreadRouteFingerprint(route),
    threadCompatibilityFingerprint:
      readCodexThreadCompatibilityFingerprint(route),
    threadId,
  })
}

function createProviderResult(input: {
  route: CodexThreadIdentity
  session: AssistantSession
  text: string
  threadId: string
}): ExecutedAssistantProviderTurnResult {
  return {
    acceptedNoReplyDeliveryContextOrdinals: [],
    additionalUsages: [],
    assistantContractFingerprint: 'b'.repeat(64),
    attemptCount: 1,
    codexContinuation: {
      kind: 'provider-state-optimization',
    },
    codexRolloutRelativePath: null,
    codexThreadId: input.threadId,
    provider: 'codex-cli',
    providerOptions: input.route.providerOptions,
    rawEvents: [],
    response: input.text,
    responseCard: null,
    responseDeliveryContextOrdinal: 0,
    responseMedia: [],
    route: input.route,
    session: input.session,
    stderr: '',
    stdout: '',
    transcriptResponse: input.text,
    usage: null,
    workingDirectory: '/vault',
  }
}

function requireTarget(
  model: string,
  reasoningEffort: string,
  modelProvider = 'vercel-ai-gateway',
): AssistantModelTarget {
  const target = createAssistantModelTarget({
    model,
    modelProvider,
    provider: 'codex-cli',
    reasoningEffort,
  })
  if (!target) {
    throw new TypeError(`Expected a target for ${model}.`)
  }
  return target
}
