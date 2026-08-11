import { createHash } from 'node:crypto'

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
  MURPH_CODEX_BASE_INSTRUCTIONS,
} from '../src/assistant/codex-base-instructions.ts'
import {
  buildAssistantCodexContractFingerprint,
} from '../src/assistant/codex-contract-fingerprint.ts'
import {
  executeCodexAssistantTurnAttempt,
} from '../src/assistant/codex-runtime.ts'
import {
  MURPH_GROUP_ROOM_MODEL_TOOL,
  resolveMurphDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  executeCodexAssistantTurnAttempt as executeCodexAssistantTurnAttemptUnchecked,
} from '../src/assistant/providers/codex-cli.ts'

afterEach(() => {
  codexAppServerMocks.executeCodexAppServerTurn.mockReset()
})

describe('Codex thread instructions', () => {
  it('keeps the Murph execution kernel compact without coding-agent baggage', () => {
    expect(Buffer.byteLength(MURPH_CODEX_BASE_INSTRUCTIONS, 'utf8')).toBeLessThan(3_000)
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      "Complete the user's in-scope request end to end",
    )
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain('untrusted data')
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain('never fabricate tool output')
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      'Continue from runtime summaries without restarting completed work',
    )
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      'Use final for the complete answer',
    )
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).not.toContain(
      'Use commentary for brief progress',
    )
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      'Answer, explanation, review, diagnosis, plan, or content requests—including "build me a plan"—do not by themselves authorize implementation or changes to saved state or external systems',
    )
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      'Murph instructions or a selected skill may define a narrow internal canonical write',
    )
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      'subject to user opt-out or a narrower owner rule',
    )
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).toContain(
      'Otherwise mutate state only when explicitly asked',
    )
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).not.toContain(
      'not unrelated mutations',
    )
    expect(MURPH_CODEX_BASE_INSTRUCTIONS).not.toMatch(
      /(?:apply_patch|rg --files|git reset|AGENTS\.md|SKILL\.md)/u,
    )
  })

  it('includes the base instructions in the native-thread contract fingerprint', () => {
    const fingerprintInput = {
      developerInstructions: 'Stable Murph instructions.',
      dynamicTools: [],
      routeFingerprint: 'route-contract-v1',
    }
    const expectedFingerprint = createHash('sha256')
      .update(JSON.stringify({
        baseInstructions: MURPH_CODEX_BASE_INSTRUCTIONS,
        ...fingerprintInput,
      }))
      .digest('hex')

    expect(buildAssistantCodexContractFingerprint(fingerprintInput)).toBe(
      expectedFingerprint,
    )
  })

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
    expect(appServerInput.baseInstructions).toBe(MURPH_CODEX_BASE_INSTRUCTIONS)
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

  it('forwards trusted generated-song policy to the app-server turn', async () => {
    codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValue({
      finalMessage: 'done',
      precedingAgentMessageSegments: [],
      responseDeliveryContextOrdinal: 0,
      transcriptMessage: 'done',
      jsonEvents: [],
      providerActionCount: 0,
      sessionId: 'thread-song-policy',
      stderr: '',
      stdout: '',
      threadId: 'thread-song-policy',
      turnId: 'turn-song-policy',
    })
    const generateSongPolicy = {
      maxAttempts: 1,
      requiredDurationSeconds: 15,
    } as const

    await executeCodexAssistantTurnAttemptUnchecked({
      providerConfig: normalizeAssistantProviderConfig({
        provider: 'codex-cli',
      }),
      dynamicTools: [],
      env: {},
      generateSongPolicy,
      userPrompt: 'Create the bounded song.',
      workingDirectory: '/tmp/provider-tests',
    })

    expect(codexAppServerMocks.executeCodexAppServerTurn).toHaveBeenCalledTimes(1)
    expect(codexAppServerMocks.executeCodexAppServerTurn.mock.calls[0]?.[0])
      .toMatchObject({ generateSongPolicy })
  })

  it('keeps constrained profile inputs at the app-server seam', async () => {
    const scenarios = [
      {
        contract:
          'This is an output-only turn. Return exactly one user-facing text response.',
        maintenance: false,
        name: 'assistant-ask-continuation',
      },
      {
        contract:
          'This is an output-only turn. The platform owns delivery.',
        maintenance: false,
        name: 'system-notification',
      },
      {
        contract:
          'The only state tool available is `murph.group_room_model`. Return exactly one JSON object.',
        maintenance: true,
        name: 'maintenance',
      },
    ] as const
    const outputOnlyOverrides = [
      'features.shell_tool=false',
      'web_search="disabled"',
      'features.apps=false',
      'features.browser_use=false',
      'features.plugins=false',
      'features.multi_agent=false',
    ]

    for (const [index, scenario] of scenarios.entries()) {
      codexAppServerMocks.executeCodexAppServerTurn.mockResolvedValueOnce({
        finalMessage: 'done',
        precedingAgentMessageSegments: [],
        responseDeliveryContextOrdinal: 0,
        transcriptMessage: 'done',
        jsonEvents: [],
        providerActionCount: 0,
        sessionId: `restricted-thread-${index}`,
        stderr: '',
        stdout: '',
        threadId: `restricted-thread-${index}`,
        turnId: `restricted-turn-${index}`,
      })

      await executeCodexAssistantTurnAttemptUnchecked({
        providerConfig: normalizeAssistantProviderConfig({
          approvalPolicy: 'never',
          provider: 'codex-cli',
          sandbox: scenario.maintenance
            ? 'danger-full-access'
            : 'read-only',
        }),
        codexConfigOverrides: scenario.maintenance
          ? []
          : outputOnlyOverrides,
        developerInstructions: scenario.contract,
        dynamicTools: scenario.maintenance
          ? [MURPH_GROUP_ROOM_MODEL_TOOL]
          : [],
        env: {},
        groupConversation: scenario.maintenance,
        groupRoomModelMaintenanceAuthorized: scenario.maintenance,
        permissions: scenario.maintenance
          ? 'murph-group-room-model-maintenance'
          : null,
        processLifetime: 'one-shot',
        providerThreadEphemeral: true,
        userPrompt: `Run the ${scenario.name} profile.`,
        workingDirectory: '/tmp/provider-tests',
      })

      const appServerInput = codexAppServerMocks.executeCodexAppServerTurn.mock
        .calls.at(-1)?.[0]
      expect(appServerInput?.approvalPolicy).toBe('never')
      expect(appServerInput?.baseInstructions).toBe(
        MURPH_CODEX_BASE_INSTRUCTIONS,
      )
      expect(appServerInput?.developerInstructions).toBe(scenario.contract)
      expect(appServerInput?.ephemeral).toBe(true)
      expect(appServerInput?.groupConversation).toBe(scenario.maintenance)
      expect(appServerInput?.processLifetime).toBe('one-shot')
      if (scenario.maintenance) {
        expect(appServerInput?.dynamicTools).toHaveLength(1)
        expect(appServerInput?.dynamicTools?.[0]).toBe(
          MURPH_GROUP_ROOM_MODEL_TOOL,
        )
        expect(appServerInput?.groupRoomModelMaintenanceAuthorized).toBe(true)
        expect(appServerInput?.sandbox).toBeUndefined()
      } else {
        expect(appServerInput?.configOverrides).toEqual(outputOnlyOverrides)
        expect(appServerInput?.dynamicTools).toEqual([])
        expect(appServerInput?.sandbox).toBe('read-only')
      }
    }
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
