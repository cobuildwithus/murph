import { afterEach, describe, expect, it, vi } from 'vitest'

const codexAppServerMocks = vi.hoisted(() => ({
  executeCodexAppServerTurn: vi.fn(),
}))

vi.mock('../src/assistant-codex.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/assistant-codex.ts')>()),
  executeCodexAppServerTurn: codexAppServerMocks.executeCodexAppServerTurn,
}))

import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'

import {
  executeCodexAssistantTurnAttempt,
} from '../src/assistant/providers/registry.ts'

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
        conversationMessages: [
          {
            content: 'Earlier answer.',
            role: 'assistant',
          },
        ],
        providerConfig: normalizeAssistantProviderConfig({
          provider: 'codex-cli',
        }),
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
        'Conversation so far:\nAssistant:\nEarlier answer.',
        'Current Murph runtime context.',
        'User message:\nWhat changed?',
      ].join('\n\n'),
    )
    expect(appServerInput.prompt).not.toContain('Stable Murph instructions.')
  })

  it('keeps thread instructions when using provider-native resume', async () => {
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
      conversationMessages: [
        {
          content: 'Old transcript fallback.',
          role: 'assistant',
        },
      ],
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      env: {},
      developerInstructions: 'Stable Murph instructions.',
      resumeProviderSessionId: 'thread-resume',
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
    expect(appServerInput.prompt).not.toContain('Old transcript fallback.')
    expect(appServerInput.prompt).not.toContain('Stable Murph instructions.')
    expect(appServerInput.resumeSessionId).toBe('thread-resume')
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
