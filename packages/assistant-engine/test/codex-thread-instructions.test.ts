import { afterEach, describe, expect, it, vi } from 'vitest'

const codexAppServerMocks = vi.hoisted(() => ({
  executeCodexAppServerTurn: vi.fn(),
}))

vi.mock('../src/assistant-codex.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/assistant-codex.ts')>()),
  executeCodexAppServerTurn: codexAppServerMocks.executeCodexAppServerTurn,
}))

import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

import {
  executeCodexAssistantTurnAttempt,
} from '../src/assistant/codex-runtime.ts'
import {
  executeCodexAssistantTurnAttempt as executeCodexAssistantTurnAttemptUnchecked,
} from '../src/assistant/providers/codex-cli.ts'

afterEach(() => {
  codexAppServerMocks.executeCodexAppServerTurn.mockReset()
})

describe('Codex thread instructions', () => {
  it('passes Murph system instructions at thread level and keeps turn input user-scoped', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'done',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'thread-1',
      stderr: '',
      stdout: '',
      threadId: 'thread-1',
      turnId: 'turn-1',
    })

    await expect(
      executeCodexAssistantTurnAttempt({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        dynamicTools: [],
        env: {},
        developerInstructions: 'Stable Murph instructions.',
        systemPrompt: 'Stable Murph instructions.',
        turnContextPrompt: 'Current Murph runtime context.',
        userPrompt: 'What changed?',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).resolves.toMatchObject({
      ok: true,
    })

    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    const appServerInput = codexAppServerMocks.executeCodexAppServerTurn.mock
      .calls[0]?.[0]
    expect(appServerInput.developerInstructions).toBe('Stable Murph instructions.')
    expect(appServerInput.excludeResumeTurns).toBe(true)
    expect(appServerInput.prompt).toBe(
      [
        'Current Murph runtime context.',
        'User message:\nWhat changed?',
      ].join('\n\n'),
    )
    expect(appServerInput.prompt).not.toContain('Stable Murph instructions.')
  })

  it('can skip thread-instruction refresh when using provider-native resume', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'done',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'thread-resume',
      stderr: '',
      stdout: '',
      threadId: 'thread-resume',
      turnId: 'turn-resume',
    })

    await executeCodexAssistantTurnAttempt({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      dynamicTools: [],
      env: {},
      developerInstructions: 'Stable Murph instructions.',
      resume: {
        codexThreadId: 'thread-resume',
        prepareFreshThreadFallback: async () => ({
          developerInstructions: 'Stable Murph instructions.',
          turnContextPrompt: 'Current Murph runtime context.',
        }),
      },
      systemPrompt: 'Stable Murph instructions.',
      turnContextPrompt: 'Current Murph runtime context.',
      userPrompt: 'Continue.',
      workingDirectory: '/tmp/provider-tests',
    })

    const appServerInput = codexAppServerMocks.executeCodexAppServerTurn.mock
      .calls[0]?.[0]
    expect(appServerInput.developerInstructions).toBe(
      'Stable Murph instructions.',
    )
    expect(appServerInput.excludeResumeTurns).toBe(true)
    expect(appServerInput.prompt).toBe(
      ['Current Murph runtime context.', 'User message:\nContinue.'].join('\n\n'),
    )
    expect(appServerInput.prompt).not.toContain('Stable Murph instructions.')
    expect(appServerInput.resumeSessionId).toBe('thread-resume')
  })

  it('runs native resume without preparing a fresh-thread fallback when primary succeeds', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'done',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'thread-resume',
      stderr: '',
      stdout: '',
      threadId: 'thread-resume',
      turnId: 'turn-resume',
    })

    const prepareFreshThreadFallback = vi.fn(async () => ({
      developerInstructions: 'Stable Murph instructions.',
    }))

    await expect(
      executeCodexAssistantTurnAttemptUnchecked({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        dynamicTools: [],
        env: {},
        developerInstructions: 'Stable Murph instructions.',
        resume: {
          codexThreadId: 'thread-resume',
          prepareFreshThreadFallback,
        },
        userPrompt: 'Continue.',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).resolves.toMatchObject({
      ok: true,
    })

    expect(prepareFreshThreadFallback).not.toHaveBeenCalled()
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0])
      .toMatchObject({
        resumeSessionId: 'thread-resume',
      })
  })

  it('starts stale-resume fallback with fresh thread instructions', async () => {
    codexAppServerMocks.executeCodexAppServerTurn
      .mockRejectedValueOnce(
        new VaultCliError(
          'ASSISTANT_CODEX_RESUME_STALE',
          'thread/resume failed: no rollout found for thread id stale-thread',
          {
            retryable: true,
            staleResume: true,
          },
        ),
      )
      .mockResolvedValueOnce({
        finalMessage: 'done',
        jsonEvents: [],
        providerActionCount: 0,
        sessionId: 'thread-fresh',
        stderr: '',
        stdout: '',
        threadId: 'thread-fresh',
        turnId: 'turn-fresh',
      })

    const prepareFreshThreadFallback = vi.fn(async () => ({
      developerInstructions: 'Stable Murph instructions.',
      sessionContext: {
        binding: {
          actorId: 'actor-1',
          channel: 'telegram',
          conversationKey: null,
          delivery: null,
          identityId: 'identity-1',
          threadId: 'thread-telegram',
          threadIsDirect: true,
        },
      },
      turnContextPrompt: 'Current Murph runtime context.',
    }))

    await expect(
      executeCodexAssistantTurnAttempt({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        dynamicTools: [],
        env: {},
        developerInstructions: null,
        resume: {
          codexThreadId: 'stale-thread',
          prepareFreshThreadFallback,
        },
        userPrompt: 'Continue.',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).resolves.toMatchObject({
      ok: true,
    })

    expect(prepareFreshThreadFallback).toHaveBeenCalledTimes(1)
    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(2)
    expect(codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0])
      .toMatchObject({
        developerInstructions: null,
        resumeSessionId: 'stale-thread',
      })
    const fallbackInput = codexAppServerMocks.executeCodexAppServerTurn.mock
      .calls[1]?.[0]
    expect(fallbackInput).toMatchObject({
      developerInstructions: 'Stable Murph instructions.',
      resumeSessionId: undefined,
    })
    expect(fallbackInput.prompt).toContain('Current Murph runtime context.')
    expect(fallbackInput.prompt).toContain('Conversation context:')
    expect(fallbackInput.prompt).toContain('thread: thread-telegram')
    expect(fallbackInput.prompt).toContain('User message:\nContinue.')
    expect(fallbackInput.prompt).not.toContain('Stable Murph instructions.')
  })

  it('does not promote or replay legacy system prompts', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'done',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'thread-legacy',
      stderr: '',
      stdout: '',
      threadId: 'thread-legacy',
      turnId: 'turn-legacy',
    })

    await executeCodexAssistantTurnAttempt({
      env: {},
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      dynamicTools: [],
      systemPrompt: 'Legacy full system prompt with dynamic runtime context.',
      userPrompt: 'Continue.',
      workingDirectory: '/tmp/provider-tests',
    })

    const appServerInput = codexAppServerMocks.executeCodexAppServerTurn.mock
      .calls[0]?.[0]
    expect(appServerInput.developerInstructions).toBeNull()
    expect(appServerInput.prompt).not.toContain('Legacy full system prompt')
    expect(appServerInput.prompt).toContain('User message:\nContinue.')
  })
})
