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
import { resolveMurphDynamicTools } from '../src/assistant-codex/dynamic-tools.ts'
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
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'done',
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
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'done',
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

  it('runs native resume without a second provider request when primary succeeds', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'done',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'done',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'thread-resume',
      stderr: '',
      stdout: '',
      threadId: 'thread-resume',
      turnId: 'turn-resume',
    })

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
        },
        userPrompt: 'Continue.',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).resolves.toMatchObject({
      ok: true,
    })

    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0])
      .toMatchObject({
        resumeSessionId: 'thread-resume',
      })
  })

  it('keeps personalized resumes on the native Codex thread', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
      finalMessage: 'done',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'done',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'thread-cold-old',
      stderr: '',
      stdout: '',
      threadId: 'thread-cold-old',
      turnId: 'turn-native-resume',
    })

    const dynamicTools = resolveMurphDynamicTools({
      personalizationAvailable: true,
    })

    const attempt = await executeCodexAssistantTurnAttemptUnchecked({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      dynamicTools,
      env: {},
      developerInstructions: null,
      resume: {
        codexThreadId: 'thread-cold-old',
      },
      userPrompt: 'Continue.',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0])
      .toMatchObject({
        dynamicTools,
        resumeSessionId: 'thread-cold-old',
      })
    expect(attempt).toMatchObject({
      ok: true,
      result: { codexThreadId: 'thread-cold-old' },
    })
  })

  it('returns stale native-resume failure without starting a fresh thread', async () => {
    const dynamicTools = resolveMurphDynamicTools({})
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

    await expect(
      executeCodexAssistantTurnAttempt({
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
        dynamicTools,
        env: {},
        developerInstructions: null,
        resume: {
          codexThreadId: 'stale-thread',
        },
        userPrompt: 'Continue.',
        workingDirectory: '/tmp/provider-tests',
      }),
    ).resolves.toMatchObject({
      ok: false,
    })

    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0])
      .toMatchObject({
        developerInstructions: null,
        dynamicTools,
        resumeSessionId: 'stale-thread',
      })
  })

  it('does not promote or replay legacy system prompts', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'done',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'done',
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
