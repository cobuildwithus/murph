import { rm } from 'node:fs/promises'

import { afterEach, describe, expect, it } from 'vitest'

import { parseAssistantSessionRecord } from '@murphai/operator-config/assistant-cli-contracts'

import {
  applyAssistantSessionCodexResumeStateAction,
  resolveAssistantProviderResumeStateAction,
  resolveAssistantResumeStateFromProviderTurn,
} from '../src/assistant/turn-finalizer.js'
import { createAssistantRuntimeStateService } from '../src/assistant/runtime-state-service.js'
import { createTempVaultContext } from './test-helpers.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((target) =>
      rm(target, {
        force: true,
        recursive: true,
      }),
    ),
  )
})

describe('resolveAssistantProviderResumeStateAction', () => {
  it.each([
    {
      codexThreadId: 'accepted-session-thread',
      expected: 'persist-from-provider-turn',
      threadScope: 'session-thread',
    },
    {
      codexThreadId: null,
      expected: 'clear',
      threadScope: 'session-thread',
    },
    {
      codexThreadId: 'isolated-maintenance-thread',
      expected: 'preserve-existing',
      threadScope: 'isolated-thread',
    },
  ] as const)(
    'returns $expected for $threadScope with thread $codexThreadId',
    ({ codexThreadId, expected, threadScope }) => {
      expect(
        resolveAssistantProviderResumeStateAction({
          codexThreadId,
          threadScope,
        }),
      ).toBe(expected)
    },
  )
})

describe('resolveAssistantResumeStateFromProviderTurn', () => {
  it('records the route that produced the resumable provider session', () => {
    const codexThreadId = '00000000-0000-4000-8000-000000000123'
    const codexRolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${codexThreadId}.jsonl`
    expect(
      resolveAssistantResumeStateFromProviderTurn({
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        codexRolloutRelativePath,
        codexThreadId,
        routeFingerprint: 'route-new',
      }),
    ).toEqual({
      assistantContractFingerprint:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      rolloutRelativePath: codexRolloutRelativePath,
      routeFingerprint: 'route-new',
      threadId: codexThreadId,
    })
  })

  it('drops non-resumable turns instead of persisting route-only state', () => {
    expect(
      resolveAssistantResumeStateFromProviderTurn({
        assistantContractFingerprint:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        codexThreadId: null,
        routeFingerprint: 'route-new',
      }),
    ).toBeNull()
  })
})

describe('applyAssistantSessionCodexResumeStateAction', () => {
  it('persists, preserves, and clears the provider-confirmed resume state', async () => {
    const { parentRoot, vaultRoot } = await createTempVaultContext(
      'assistant-resume-state-action-',
    )
    cleanupPaths.push(parentRoot)
    const session = parseAssistantSessionRecord({
      alias: null,
      binding: {
        actorId: null,
        channel: null,
        conversationKey: null,
        delivery: null,
        identityId: null,
        threadId: null,
        threadIsDirect: null,
      },
      codexResume: {
        routeFingerprint: 'stale-route',
        threadId: 'stale-thread',
      },
      codexTarget: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        codexHome: null,
        model: 'gpt-5.6-terra',
        modelProvider: null,
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'danger-full-access',
      },
      conversationId: 'session-resume-state-action',
      createdAt: '2026-07-14T00:00:00.000Z',
      lastTurnAt: null,
      schema: 'murph.assistant-conversation.v2',
      turnCount: 0,
      updatedAt: '2026-07-14T00:00:00.000Z',
    })
    const acceptedThreadId = '00000000-0000-4000-8000-000000000123'
    const acceptedRolloutRelativePath =
      `sessions/2026/07/14/rollout-2026-07-14T01-02-03-${acceptedThreadId}.jsonl`
    const actionInput = {
      assistantContractFingerprint:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      codexRolloutRelativePath: acceptedRolloutRelativePath,
      codexThreadId: acceptedThreadId,
      routeFingerprint: 'accepted-route',
      vault: vaultRoot,
    }

    const persisted = await applyAssistantSessionCodexResumeStateAction({
      ...actionInput,
      action: 'persist-from-provider-turn',
      session,
    })
    const expectedResumeState = {
      assistantContractFingerprint:
        actionInput.assistantContractFingerprint,
      rolloutRelativePath: acceptedRolloutRelativePath,
      routeFingerprint: 'accepted-route',
      threadId: acceptedThreadId,
    }
    expect(persisted.codexResume).toEqual(expectedResumeState)
    await expect(
      createAssistantRuntimeStateService(vaultRoot).sessions.get(
        session.sessionId,
      ),
    ).resolves.toMatchObject({
      codexResume: expectedResumeState,
      resumeState: expectedResumeState,
    })

    const preserved = await applyAssistantSessionCodexResumeStateAction({
      ...actionInput,
      action: 'preserve-existing',
      session: persisted,
    })
    expect(preserved).toBe(persisted)
    await expect(
      createAssistantRuntimeStateService(vaultRoot).sessions.get(
        session.sessionId,
      ),
    ).resolves.toMatchObject({
      codexResume: expectedResumeState,
      resumeState: expectedResumeState,
    })

    const cleared = await applyAssistantSessionCodexResumeStateAction({
      ...actionInput,
      action: 'clear',
      session: persisted,
    })
    expect(cleared).toMatchObject({
      codexResume: null,
      resumeState: null,
    })
    await expect(
      createAssistantRuntimeStateService(vaultRoot).sessions.get(
        session.sessionId,
      ),
    ).resolves.toMatchObject({
      codexResume: null,
      resumeState: null,
    })
  })
})
