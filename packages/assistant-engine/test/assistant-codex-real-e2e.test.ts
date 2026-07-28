import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'
import { describe, expect, it } from 'vitest'

import {
  executeCodexAppServerTurn,
  resolveMurphDynamicTools,
  type CodexAppServerTurnInput,
} from '../src/assistant-codex.ts'
import {
  MURPH_AUTOMATION_TOOL,
  MURPH_COMPUTER_OPEN_TOOL,
  MURPH_FAMILY_PLAN_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  MURPH_CONNECTED_APPS_SEARCH_TOOL,
} from '../src/assistant-codex/dynamic-tools/connected-apps.ts'
import {
  MURPH_CREATE_PHONE_CALL_TOOL,
} from '../src/assistant-codex/dynamic-tools/phone-calls.ts'
import {
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
  resolveAssistantSkillsRoot,
  type AssistantSkillSlug,
} from '../src/assistant-skill-assets.ts'
import {
  MURPH_CODEX_BASE_INSTRUCTIONS,
} from '../src/assistant/codex-base-instructions.ts'
import type {
  AssistantHostedAutomationToolRequest,
} from '../src/assistant/execution-context.ts'
import {
  buildAssistantSystemPrompt,
} from '../src/assistant/system-prompt.ts'
import { extractCodexAssistantProviderUsage } from '../src/assistant/providers/helpers.ts'
import type {
  AssistantProviderDynamicTool,
} from '../src/assistant/providers/types.ts'

const RUN_REAL_CODEX_E2E = process.env.MURPH_RUN_REAL_CODEX_E2E === '1'
const describeRealCodex = RUN_REAL_CODEX_E2E ? describe : describe.skip
const DEFAULT_REAL_CODEX_MODEL = 'gpt-5.6-terra'
const OPENAI_ENV_MODEL_PROVIDER = 'openai-env'
const OPENAI_BASE_URL = 'https://api.openai.com/v1'
const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY'
const VERCEL_AI_GATEWAY_MODEL_PROVIDER = 'vercel-ai-gateway'
const VERCEL_AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1'
const VERCEL_AI_GATEWAY_API_KEY_ENV = 'VERCEL_AI_API_KEY'
const REAL_CODEX_E2E_ENV_ALLOWLIST = [
  'PATH',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
] as const

interface RealCodexE2eConfig {
  codexHome: string
  env: NodeJS.ProcessEnv
  model: string
  modelProvider: string
  temporaryPaths: string[]
}

interface CodexUsageSnapshot {
  cachedInputTokens: number
  inputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

interface CodexTokenUsageEvent {
  last: CodexUsageSnapshot
  total: CodexUsageSnapshot
}

interface CapabilityRoutingProbe {
  assertArguments(argumentsValue: Record<string, unknown>): void
  expectedSkillHeading: string
  expectedTool: string
  prompt: string
  skillSlug: 'computer-use' | 'connected-apps' | 'phone-calls' | 'murph-family'
  tool: AssistantProviderDynamicTool
}

interface CacheProbeSummary {
  finalContainsOk: boolean
  finalLastCachedInputTokens: number
  finalLastInputTokens: number
  finalTotalCachedInputTokens: number
  finalTotalInputTokens: number
  modelProvider: string
  providerActionCount: number
  summedLastCachedInputTokens: number
  summedLastInputTokens: number
  usageCount: number
}

interface ResumeCacheProbeSummary {
  first: {
    finalContainsOk: boolean
    finalLastUsage: CodexUsageSnapshot | null
    providerActionCount: number
    usageCount: number
  }
  second: {
    allUsageEvents: CodexTokenUsageEvent[]
    currentPostStartLastUsage: CodexUsageSnapshot
    eventSequence: Array<{
      index: number
      type: string | null
      usage?: {
        last: CodexUsageSnapshot
        total: CodexUsageSnapshot
      }
    }>
    finalContainsOk: boolean
    providerActionCount: number
    turnIdPresent: boolean
    usageCount: number
  }
}

describeRealCodex('real Codex group-chat behavior e2e', () => {
  it(
    'prefers grounded group-chat actions while respecting collective human ownership',
    async () => {
      const config = await resolveRealCodexE2eConfig()
      const workingDirectory = await mkdtemp(
        path.join(tmpdir(), 'murph-group-point-of-view-e2e-'),
      )

      try {
        const skillsRoot = path.join(workingDirectory, 'skills')
        await Promise.all(
          (['group-chat', 'groupchat-comedy'] as const).map(async (slug) => {
            await materializeAssistantSkill({
              skillsRoot,
              slug,
            })
          }),
        )
        const result = await executeRealCodexAppServerTurn({
          approvalPolicy: 'never',
          baseInstructions: MURPH_CODEX_BASE_INSTRUCTIONS,
          codexCommand:
            normalizeEnvString(process.env.MURPH_REAL_CODEX_COMMAND)
            ?? undefined,
          codexHome: config.codexHome,
          developerInstructions:
            buildGroupPointOfViewDeveloperInstructions(),
          env: {
            ...config.env,
            [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: skillsRoot,
          },
          model: config.model,
          modelProvider: config.modelProvider,
          prompt: buildGroupPointOfViewCandidateProbe(),
          reasoningEffort: 'low',
          sandbox: 'workspace-write',
          workingDirectory,
        })
        const actions = readCapabilityRoutingActions(result.jsonEvents)

        expect(result.finalMessage.trim()).toBe(
          '14:B 15:A 18:B 19:A 20:B 21:A 22:A 23:D 24:A',
        )
        expect(
          actions.some((action) =>
            action.kind === 'command'
            && action.command.includes('group-chat/SKILL.md')
            && action.output.includes('# Group Chat')
          ),
          'group-chat skill read',
        ).toBe(true)
        expect(
          actions.some((action) =>
            action.kind === 'command'
            && action.command.includes('groupchat-comedy/SKILL.md')
            && action.output.includes('# Group-Chat Comedy & Refereeing')
          ),
          'groupchat-comedy skill read',
        ).toBe(true)
      } finally {
        await removeRealCodexTemporaryPaths([
          workingDirectory,
          ...config.temporaryPaths,
        ])
      }
    },
    360_000,
  )
})

describeRealCodex('real Codex app-server cache usage e2e', () => {
  it(
    'loads each moved capability owner before its representative tool call',
    async () => {
      const config = await resolveRealCodexE2eConfig()

      try {
        for (const probe of CAPABILITY_ROUTING_PROBES) {
          const workingDirectory = await mkdtemp(
            path.join(tmpdir(), `murph-capability-${probe.skillSlug}-e2e-`),
          )

          try {
            const skillsRoot = path.join(workingDirectory, 'skills')
            await materializeAssistantSkill({
              skillsRoot,
              slug: probe.skillSlug,
            })
            const result = await executeRealCodexAppServerTurn({
              approvalPolicy: 'never',
              baseInstructions: MURPH_CODEX_BASE_INSTRUCTIONS,
              codexCommand:
                normalizeEnvString(process.env.MURPH_REAL_CODEX_COMMAND)
                ?? undefined,
              codexHome: config.codexHome,
              developerInstructions:
                buildCapabilityRoutingDeveloperInstructions(),
              dynamicTools: [probe.tool],
              env: {
                ...config.env,
                [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: skillsRoot,
              },
              model: config.model,
              modelProvider: config.modelProvider,
              prompt: probe.prompt,
              reasoningEffort: 'low',
              sandbox: 'workspace-write',
              workingDirectory,
            })
            const actions = readCapabilityRoutingActions(result.jsonEvents)
            const skillRead = actions.find((action) =>
              action.kind === 'command'
              && action.command.includes(`${probe.skillSlug}/SKILL.md`)
              && action.output.includes(probe.expectedSkillHeading)
            )
            const toolCall = actions.find((action) =>
              action.kind === 'dynamic'
              && action.tool === probe.expectedTool
            )

            expect(skillRead, `${probe.skillSlug} skill read`).toBeDefined()
            expect(toolCall, `${probe.skillSlug} dynamic tool call`).toBeDefined()
            expect(toolCall?.eventIndex).toBeGreaterThan(
              skillRead?.eventIndex ?? Number.POSITIVE_INFINITY,
            )
            if (toolCall?.kind === 'dynamic') {
              probe.assertArguments(toolCall.argumentsValue)
            }
          } finally {
            await removeRealCodexTemporaryPaths([workingDirectory])
          }
        }
      } finally {
        await removeRealCodexTemporaryPaths(config.temporaryPaths)
      }
    },
    720_000,
  )

  it(
    'saves an explicit midnight Linq reminder without off-hours confirmation',
    async () => {
      const config = await resolveRealCodexE2eConfig()
      const workingDirectory = await mkdtemp(
        path.join(tmpdir(), 'murph-midnight-linq-reminder-e2e-'),
      )
      const automationRequests: AssistantHostedAutomationToolRequest[] = []

      try {
        const result = await executeRealCodexAppServerTurn({
          approvalPolicy: 'never',
          baseInstructions: MURPH_CODEX_BASE_INSTRUCTIONS,
          codexCommand:
            normalizeEnvString(process.env.MURPH_REAL_CODEX_COMMAND)
            ?? undefined,
          codexHome: config.codexHome,
          developerInstructions:
            buildMidnightLinqReminderDeveloperInstructions(),
          dynamicTools: [MURPH_AUTOMATION_TOOL],
          env: config.env,
          excludeResumeTurns: true,
          hostedToolContext: {
            automationTool: {
              request: async (request) => {
                automationRequests.push(request)
                return {
                  action: 'save',
                  automationId: 'automation-midnight-watch',
                  created: true,
                  lookupId: 'midnight-watch-reminder',
                  routeBinding: 'current_conversation',
                  status: 'active',
                }
              },
            },
            computerToolsAvailable: false,
            currentHostedDeliveryContext: () => null,
            currentHostedMailboxItemIds: () => [],
            sendVaultFile: async () => {
              throw new Error('Vault file sends are unavailable in this test.')
            },
            vaultFileSendAvailable: false,
          },
          model: config.model,
          modelProvider: config.modelProvider,
          prompt: [
            'Remind me here every day at midnight through July 31, 2026',
            'to plug in my watch. Save it now.',
          ].join(' '),
          reasoningEffort: 'low',
          sandbox: 'workspace-write',
          workingDirectory,
        })
        const automationCall = readCapabilityRoutingActions(
          result.jsonEvents,
        ).find((action) =>
          action.kind === 'dynamic'
          && action.tool === MURPH_AUTOMATION_TOOL.name
        )

        expect(automationCall).toBeDefined()
        if (automationCall?.kind !== 'dynamic') {
          throw new Error('Expected a real murph.automation tool call.')
        }
        expect(automationRequests).toHaveLength(1)
        expect(automationRequests[0]).toMatchObject({
          action: 'save',
          activeUntil: expect.any(String),
          continuityPolicy: 'preserve',
          instructions: expect.stringMatching(
            /plug in.*watch|watch.*plug in/iu,
          ),
          schedule: {
            kind: 'dailyLocal',
            localTime: '00:00',
          },
        })
        expect(result.finalMessage).toMatch(
          /midnight|00:00|12(?::00)?\s*a\.?m\.?/iu,
        )
        expect(result.finalMessage).not.toMatch(
          /off[- ]hours|spam(?:my)?|safer (?:nearby )?time|waking[- ]time/iu,
        )
      } finally {
        await removeRealCodexTemporaryPaths([
          workingDirectory,
          ...config.temporaryPaths,
        ])
      }
    },
    360_000,
  )

  it(
    'returns the resumed turn id in the real turn/start result contract',
    async () => {
      const config = await resolveRealCodexE2eConfig()
      const workingDirectory = await mkdtemp(
        path.join(tmpdir(), 'murph-codex-turn-start-contract-e2e-'),
      )

      try {
        const commonInput = {
          approvalPolicy: 'never',
          codexCommand: normalizeEnvString(process.env.MURPH_REAL_CODEX_COMMAND)
            ?? undefined,
          codexHome: config.codexHome,
          env: config.env,
          excludeResumeTurns: true,
          model: config.model,
          modelProvider: config.modelProvider,
          reasoningEffort: 'low',
          sandbox: 'workspace-write' as const,
          workingDirectory,
        }
        const first = await executeRealCodexAppServerTurn({
          ...commonInput,
          prompt: 'Reply exactly TURN_START_CONTRACT_ONE_OK.',
        })
        const secondTraceEvents: unknown[] = []
        const second = await executeRealCodexAppServerTurn({
          ...commonInput,
          onTraceEvent: (event) => {
            secondTraceEvents.push(event)
          },
          prompt: 'Reply exactly TURN_START_CONTRACT_TWO_OK.',
          resumeSessionId: first.sessionId,
        })
        const turnStartResultTurnIds = readCodexTurnStartResultTurnIds(
          second.jsonEvents,
        )
        const turnStartedEventTurnIds = readCodexTurnStartedEventTurnIds(
          second.jsonEvents,
        )
        const secondTurnId = second.turnId

        expect(second.finalMessage).toContain('TURN_START_CONTRACT_TWO_OK')
        expect(secondTurnId).not.toBeNull()
        if (!secondTurnId) {
          throw new Error('Real Codex resumed turn did not expose a turn id.')
        }
        expect(hasCodexTimingStage(secondTraceEvents, 'warm-reused')).toBe(true)
        expect(turnStartResultTurnIds).toContain(secondTurnId)
        expect(turnStartedEventTurnIds).toContain(secondTurnId)
      } finally {
        await removeRealCodexTemporaryPaths([
          workingDirectory,
          ...config.temporaryPaths,
        ])
      }
    },
    360_000,
  )

  it(
    'uses current-turn total delta usage from a real tool-using Codex turn',
    async () => {
      const config = await resolveRealCodexE2eConfig()

      try {
        const attempts = readPositiveIntegerEnv(
          process.env.MURPH_REAL_CODEX_CACHE_ATTEMPTS,
        ) ?? 2
        const summaries: CacheProbeSummary[] = []

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          const probe = await runCacheProbeAttempt({
            attempt,
            config,
          })
          summaries.push(probe.summary)

          if (!hasTotalUsageRegressionShape(probe.summary)) {
            continue
          }

          const extractedUsage = extractCodexAssistantProviderUsage({
            providerConfig: normalizeAssistantProviderConfig({
              provider: 'codex-cli',
              model: config.model,
              modelProvider: config.modelProvider,
              oss: false,
            }),
            rawEvents: probe.rawEvents,
          })

          expect(extractedUsage.usageExtractionSourcePath).toBe(
            'thread.tokenUsage.total.delta',
          )
          expect(extractedUsage.inputTokens).toBe(
            probe.summary.finalTotalInputTokens,
          )
          expect(extractedUsage.cachedInputTokens).toBe(
            probe.summary.finalTotalCachedInputTokens,
          )
          expect(probe.summary.finalTotalInputTokens).toBeGreaterThan(
            probe.summary.finalLastInputTokens,
          )
          expect(probe.summary.finalTotalCachedInputTokens).toBeGreaterThan(
            probe.summary.finalLastCachedInputTokens,
          )
          return
        }

        throw new Error(
          [
            'Real Codex cache regression did not observe current-turn total usage exceeding final last usage.',
            `attempt summaries: ${JSON.stringify(summaries)}`,
          ].join(' '),
        )
      } finally {
        await removeRealCodexTemporaryPaths(config.temporaryPaths)
      }
    },
    360_000,
  )

  it(
    'records resumed low-reasoning usage from the current post-start provider request',
    async () => {
      const config = await resolveRealCodexE2eConfig()

      try {
        const probe = await runResumeCacheProbeAttempt({
          config,
        })
        const currentUsage = probe.summary.second.currentPostStartLastUsage
        const summaryJson = JSON.stringify(probe.summary)
        const extractedUsage = extractCodexAssistantProviderUsage({
          providerConfig: normalizeAssistantProviderConfig({
            provider: 'codex-cli',
            model: config.model,
            modelProvider: config.modelProvider,
            oss: false,
          }),
          rawEvents: probe.rawEvents,
        })

        expect(probe.summary.first.finalContainsOk).toBe(true)
        expect(probe.summary.second.finalContainsOk).toBe(true)
        expect(currentUsage.inputTokens).toBeGreaterThan(1024)
        expect(extractedUsage.inputTokens, summaryJson).toBe(
          currentUsage.inputTokens,
        )
        expect(extractedUsage.cachedInputTokens, summaryJson).toBe(
          currentUsage.cachedInputTokens,
        )
        expect(extractedUsage.outputTokens, summaryJson).toBe(
          currentUsage.outputTokens,
        )
        expect(extractedUsage.reasoningTokens, summaryJson).toBe(
          currentUsage.reasoningOutputTokens,
        )

        if (process.env.MURPH_REAL_CODEX_EXPECT_RESUME_CACHE_MISS === '1') {
          expect(
            currentUsage.cachedInputTokens,
            `expected local resumed cache miss, summary=${JSON.stringify(probe.summary)}`,
          ).toBe(0)
        }
      } finally {
        await removeRealCodexTemporaryPaths(config.temporaryPaths)
      }
    },
    360_000,
  )
})

describe('real Codex app-server cache usage e2e harness', () => {
  it('passes only a minimal environment to live Codex probes', () => {
    const env = buildRealCodexE2eEnv({
      apiKeyEnv: 'PROVIDER_KEY',
      sourceEnv: {
        AWS_SECRET_ACCESS_KEY: 'ignored-aws-value',
        CODEX_HOME: 'ignored-codex-home',
        DATABASE_URL: 'ignored-database-url',
        HOME: 'ignored-home',
        OPENAI_API_KEY: 'ignored-openai-value',
        PATH: '/usr/bin:/bin',
        PROVIDER_KEY: 'provider-value',
        TMPDIR: '/tmp',
      },
    })

    expect(env).toEqual({
      PATH: '/usr/bin:/bin',
      PROVIDER_KEY: 'provider-value',
      TMPDIR: '/tmp',
    })
  })

  it('writes provider-key config without embedding the provider key value', () => {
    const configToml = buildRealCodexConfigToml({
      apiKeyEnv: 'PROVIDER_KEY',
      model: 'gpt-5.6-terra',
      modelProvider: OPENAI_ENV_MODEL_PROVIDER,
    })

    expect(configToml).toContain('[shell_environment_policy]')
    expect(configToml).toContain('include_only = [')
    expect(configToml).toContain('[model_providers.openai-env]')
    expect(configToml).toContain('env_key = "PROVIDER_KEY"')
    expect(configToml).not.toContain('provider-value')
  })

  it('sanitizes live provider failures before Vitest prints them', () => {
    const rawError = Object.assign(
      new Error('Quota exceeded for request req_sensitive_123'),
      {
        code: 'ASSISTANT_CODEX_FAILED',
        context: {
          codexFailureStage: 'turn_failed',
          codexTurnStatus: 'failed',
          providerActionCount: 2,
          codexThreadId: 'thread_sensitive_123',
        },
      },
    )

    const message = buildRealCodexE2eFailureMessage(rawError)

    expect(message).toBe(
      'Real Codex cache probe failed: code=ASSISTANT_CODEX_FAILED stage=turn_failed status=failed providerActionCount=2',
    )
    expect(message).not.toContain('Quota')
    expect(message).not.toContain('req_sensitive')
    expect(message).not.toContain('thread_sensitive')
  })

  it('distinguishes turn/start result ids from turn/started event ids', () => {
    const events = [
      {
        id: 1,
        result: {},
      },
      {
        method: 'turn/started',
        params: {
          turn: {
            id: 'turn-event-only',
          },
        },
      },
      {
        id: 2,
        result: {
          turn: {
            id: 'turn-result',
          },
        },
      },
      {
        id: 3,
        result: {
          turnId: 'turn-result-flat',
        },
      },
      {
        id: 4,
        result: {
          turn_id: 'turn-result-snake',
        },
      },
      {
        method: 'turn/started',
        data: {
          turn: {
            id: 'turn-data-event',
          },
        },
        result: {
          turn: {
            id: 'ignored-result-on-event',
          },
        },
      },
      {
        type: 'turn.started',
        turn_id: 'turn-record-snake-event',
      },
    ]

    expect(readCodexTurnStartResultTurnIds(events)).toEqual([
      'turn-result',
      'turn-result-flat',
      'turn-result-snake',
    ])
    expect(readCodexTurnStartedEventTurnIds(events)).toEqual([
      'turn-event-only',
      'turn-data-event',
      'turn-record-snake-event',
    ])
  })
})

const CAPABILITY_ROUTING_PROBES: readonly CapabilityRoutingProbe[] = [
  {
    assertArguments: (argumentsValue) => {
      expect(argumentsValue).toEqual({})
    },
    expectedSkillHeading: '# Computer Use',
    expectedTool: MURPH_COMPUTER_OPEN_TOOL.name,
    prompt:
      'Open the current browser and inspect whether the portal is already signed in. Do not click, type, log in, or ask me for credentials.',
    skillSlug: 'computer-use',
    tool: MURPH_COMPUTER_OPEN_TOOL,
  },
  {
    assertArguments: (argumentsValue) => {
      expect(argumentsValue.toolkits).toEqual(
        expect.arrayContaining(['instacart']),
      )
    },
    expectedSkillHeading: '# Connected Apps',
    expectedTool: MURPH_CONNECTED_APPS_SEARCH_TOOL.name,
    prompt:
      'Find the exact connected-app tool for an Instacart grocery handoff for oats and blueberries. This is a handoff only; do not place or pay for an order.',
    skillSlug: 'connected-apps',
    tool: MURPH_CONNECTED_APPS_SEARCH_TOOL,
  },
  {
    assertArguments: (argumentsValue) => {
      expect(argumentsValue.allowTransferToUser).toBe(false)
      expect(argumentsValue.callerName).toBe('Sam')
      expect(argumentsValue.goal).toEqual(
        expect.stringMatching(/office hours/iu),
      )
    },
    expectedSkillHeading: '# Phone Calls',
    expectedTool: MURPH_CREATE_PHONE_CALL_TOOL.name,
    prompt:
      'Call +12025550123 for me to ask only for the clinic office hours today. Use caller name Sam. This is information-only, and I do not want a transfer.',
    skillSlug: 'phone-calls',
    tool: MURPH_CREATE_PHONE_CALL_TOOL,
  },
  {
    assertArguments: (argumentsValue) => {
      expect(argumentsValue).toEqual({ action: 'read_status' })
    },
    expectedSkillHeading: '# Murph Family',
    expectedTool: MURPH_FAMILY_PLAN_TOOL.name,
    prompt:
      'I want to add usage for my sponsored Murph Family member Alex. Check my Family status first; do not start checkout or create an invite.',
    skillSlug: 'murph-family',
    tool: MURPH_FAMILY_PLAN_TOOL,
  },
]

async function runCacheProbeAttempt(input: {
  attempt: number
  config: RealCodexE2eConfig
}): Promise<{
  rawEvents: unknown[]
  summary: CacheProbeSummary
}> {
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), 'murph-codex-cache-e2e-'),
  )

  try {
    await writeFile(
      path.join(workingDirectory, 'cache_a.txt'),
      'alpha-cache-probe-data\n'.repeat(31),
      'utf8',
    )
    await writeFile(
      path.join(workingDirectory, 'cache_b.txt'),
      'beta-cache-probe-data\n'.repeat(37),
      'utf8',
    )

    const result = await executeRealCodexAppServerTurn({
      approvalPolicy: 'never',
      codexCommand: normalizeEnvString(process.env.MURPH_REAL_CODEX_COMMAND)
        ?? undefined,
      codexHome: input.config.codexHome,
      env: input.config.env,
      model: input.config.model,
      modelProvider: input.config.modelProvider,
      prompt: buildCacheProbePrompt(input.attempt),
      reasoningEffort: 'low',
      sandbox: 'workspace-write',
      workingDirectory,
    })
    const usageEvents = readCodexTokenUsageEvents(result.jsonEvents)
    const finalUsage = usageEvents.at(-1) ?? null
    const summedLastUsage = sumCodexLastUsageSnapshots(usageEvents)

    return {
      rawEvents: result.jsonEvents,
      summary: {
        finalContainsOk: result.finalMessage.includes('CACHE_PROBE_OK'),
        finalLastCachedInputTokens: finalUsage?.last.cachedInputTokens ?? 0,
        finalLastInputTokens: finalUsage?.last.inputTokens ?? 0,
        finalTotalCachedInputTokens: finalUsage?.total.cachedInputTokens ?? 0,
        finalTotalInputTokens: finalUsage?.total.inputTokens ?? 0,
        modelProvider: input.config.modelProvider,
        providerActionCount: result.providerActionCount,
        summedLastCachedInputTokens: summedLastUsage.cachedInputTokens,
        summedLastInputTokens: summedLastUsage.inputTokens,
        usageCount: usageEvents.length,
      },
    }
  } finally {
    await removeRealCodexTemporaryPaths([workingDirectory])
  }
}

async function runResumeCacheProbeAttempt(input: {
  config: RealCodexE2eConfig
}): Promise<{
  rawEvents: unknown[]
  summary: ResumeCacheProbeSummary
}> {
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), 'murph-codex-resume-cache-e2e-'),
  )

  try {
    const commonInput = {
      approvalPolicy: 'never',
      codexCommand: normalizeEnvString(process.env.MURPH_REAL_CODEX_COMMAND)
        ?? undefined,
      codexHome: input.config.codexHome,
      developerInstructions: buildResumeCacheProbeInstructions(),
      env: input.config.env,
      excludeResumeTurns: true,
      model: input.config.model,
      modelProvider: input.config.modelProvider,
      reasoningEffort: 'low',
      sandbox: 'workspace-write' as const,
      workingDirectory,
    }
    const first = await executeRealCodexAppServerTurn({
      ...commonInput,
      prompt: 'Reply exactly RESUME_CACHE_PROBE_ONE_OK.',
    })
    const second = await executeRealCodexAppServerTurn({
      ...commonInput,
      prompt: 'Reply exactly RESUME_CACHE_PROBE_TWO_OK.',
      resumeSessionId: first.sessionId,
    })
    const firstUsageEvents = readCodexTokenUsageEvents(first.jsonEvents)
    const secondUsageEvents = readCodexTokenUsageEvents(second.jsonEvents)
    const currentPostStartUsage =
      readFinalCodexPostStartTokenUsageEvent({
        events: second.jsonEvents,
        turnId: second.turnId,
      })?.last

    if (!currentPostStartUsage) {
      throw new Error(
        `Real Codex resume cache probe produced no post-start token usage event: ${JSON.stringify({
          secondTurnIdPresent: second.turnId !== null,
          secondUsageCount: secondUsageEvents.length,
        })}`,
      )
    }

    return {
      rawEvents: second.jsonEvents,
      summary: {
        first: {
          finalContainsOk: first.finalMessage.includes(
            'RESUME_CACHE_PROBE_ONE_OK',
          ),
          finalLastUsage: firstUsageEvents.at(-1)?.last ?? null,
          providerActionCount: first.providerActionCount,
          usageCount: firstUsageEvents.length,
        },
        second: {
          allUsageEvents: secondUsageEvents,
          currentPostStartLastUsage: currentPostStartUsage,
          eventSequence: summarizeCodexEventSequence(second.jsonEvents),
          finalContainsOk: second.finalMessage.includes(
            'RESUME_CACHE_PROBE_TWO_OK',
          ),
          providerActionCount: second.providerActionCount,
          turnIdPresent: second.turnId !== null,
          usageCount: secondUsageEvents.length,
        },
      },
    }
  } finally {
    await removeRealCodexTemporaryPaths([workingDirectory])
  }
}

async function executeRealCodexAppServerTurn(
  input: Omit<CodexAppServerTurnInput, 'dynamicTools'> & {
    dynamicTools?: CodexAppServerTurnInput['dynamicTools']
  },
): ReturnType<typeof executeCodexAppServerTurn> {
  try {
    return await executeCodexAppServerTurn({
      ...input,
      dynamicTools: input.dynamicTools ?? resolveMurphDynamicTools({
        allowFinishWithoutReply: input.allowFinishWithoutReply,
        messageTargetingAvailable:
          input.authorizeAcceptedMessageTarget != null,
        computerToolsAvailable:
          input.hostedToolContext?.computerToolsAvailable === true,
        connectedAppsAvailable: input.hostedToolContext?.connectedApps != null,
        productFeedbackAvailable:
          typeof input.productFeedbackRecorder?.recordProductFeedback === 'function',
        progressUpdatesAvailable: input.progressDelivery != null,
      }),
    })
  } catch (error) {
    throw new Error(buildRealCodexE2eFailureMessage(error))
  }
}

async function materializeAssistantSkill(input: {
  skillsRoot: string
  slug: AssistantSkillSlug
}): Promise<void> {
  const targetDirectory = path.join(input.skillsRoot, input.slug)
  await mkdir(targetDirectory, { recursive: true })
  await writeFile(
    path.join(targetDirectory, 'SKILL.md'),
    await readFile(
      path.join(resolveAssistantSkillsRoot(), input.slug, 'SKILL.md'),
      'utf8',
    ),
    'utf8',
  )
}

function buildGroupPointOfViewDeveloperInstructions(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'linq',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope: 'group',
    currentLocalDate: '2026-07-27',
    currentTimeZone: 'America/New_York',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
  })
}

function buildGroupPointOfViewCandidateProbe(): string {
  return [
    'This is a playful group-chat candidate-choice evaluation.',
    'For each numbered transcript, choose the action Murph should take.',
    'Each candidate describes the complete action for that transcript.',
    'For transcripts 14-22, choose A or B. For transcripts 23-24, choose A, B, C, or D.',
    'Reply exactly in the form `14:<A-or-B> 15:<A-or-B> 18:<A-or-B> 19:<A-or-B> 20:<A-or-B> 21:<A-or-B> 22:<A-or-B> 23:<A-B-C-or-D> 24:<A-B-C-or-D>` with no explanation.',
    '',
    '14. Nate: "Correct, the lid-free society has begun."',
    'A: "Correct, the lid-free society has begun."',
    'B: "Nate has been demoted from cook to steam-release valve."',
    '',
    '15. Sam: "Murph, who chooses the movie? Priya rejected six already."',
    'A: "Priya is now festival director. The seventh rejection comes with a counterproposal."',
    'B: "Everyone should take turns choosing movies."',
    '',
    '18. Murph: "Any heroic overpacking to report?"',
    'Elena: "I packed three backup batteries for the day hike."',
    'A: "The moon has appointed a new sandwich mayor."',
    'B: "Elena is no longer attending the hike; she is the regional power grid."',
    '',
    '19. Lee: "What is the boiling point of water at sea level?"',
    'A: "100°C (212°F). It changes with altitude."',
    'B: "The kettle has entered its villain era."',
    '',
    '20. Reed posts a photo of an old apartment building.',
    'Reed: "y\'all remember this place"',
    'Reed: "we somehow fit nine people in there for a whole summer."',
    'A: "Nine people and one bathroom is not a lease, it is a field study."',
    'B: SILENT',
    '',
    '21. Reed posts a photo of an old apartment building.',
    'Reed: "y\'all remember this place"',
    'Reed: "Does anyone know the occupancy limit for a two-bedroom?"',
    'A: "Usually two people per bedroom plus one, though it varies by city."',
    'B: SILENT',
    '',
    '22. Reed posts a photo of an old apartment building.',
    'Reed: "y\'all remember this place"',
    'Reed: "Murph, settle this: was fitting nine people in there legal?"',
    'A: "That depends on the local occupancy code and the lease; nine in a two-bedroom was likely over at least one limit."',
    'B: SILENT',
    '',
    '23. Reed posts a photo of an old apartment building with no caption or addressee.',
    'A: Send "That building has seen things no security deposit could explain."',
    'B: React to the photo, then finish without a text reply.',
    'C: Run a short shell sleep to watch for a follow-up before deciding.',
    'D: Immediately finish without a text reply or reaction.',
    '',
    '24. Reed posts a photo of a street-parking sign and asks the room: "Does this mean parking is allowed after 6pm?"',
    'A: Answer the factual question briefly from the visible sign.',
    'B: React to the photo, then finish without a text reply.',
    'C: Run a short shell sleep to watch for a follow-up before deciding.',
    'D: Immediately finish without a text reply or reaction.',
  ].join('\n')
}

function buildMidnightLinqReminderDeveloperInstructions(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedAutomationAvailable: true,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'linq',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope: 'direct',
    currentLocalDate: '2026-07-27',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
  })
}

function buildCapabilityRoutingDeveloperInstructions(): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: null,
    assistantContextSnapshotPrompt: null,
    assistantHostedDeviceConnectAvailable: false,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: false,
    channel: 'local',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope: 'direct',
    currentLocalDate: '2026-07-26',
    currentTimeZone: 'America/New_York',
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance: false,
    turnTrigger: null,
  })
}

type CapabilityRoutingAction =
  | {
      command: string
      eventIndex: number
      kind: 'command'
      output: string
    }
  | {
      argumentsValue: Record<string, unknown>
      eventIndex: number
      kind: 'dynamic'
      tool: string
    }

function readCapabilityRoutingActions(
  events: readonly unknown[],
): CapabilityRoutingAction[] {
  return events.flatMap<CapabilityRoutingAction>((event, eventIndex) => {
    const record = readRecord(event)
    if (readString(record?.method, record?.type) !== 'item/completed') {
      return []
    }
    const item = readRecord(readRecord(record?.params)?.item)
    const itemType = readString(item?.type)
    if (itemType === 'commandExecution' || itemType === 'command_execution') {
      return [{
        command: readCommandText(item?.command),
        eventIndex,
        kind: 'command' as const,
        output: readString(
          item?.aggregatedOutput,
          item?.aggregated_output,
          item?.output,
        ) ?? '',
      }]
    }
    if (itemType === 'dynamicToolCall' || itemType === 'dynamic_tool_call') {
      const tool = readString(item?.tool, item?.name)
      if (!tool) {
        return []
      }
      return [{
        argumentsValue: readArgumentsRecord(item?.arguments),
        eventIndex,
        kind: 'dynamic' as const,
        tool,
      }]
    }
    return []
  })
}

function readCommandText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return Array.isArray(value)
    ? value.filter((part): part is string => typeof part === 'string').join(' ')
    : ''
}

function readArgumentsRecord(value: unknown): Record<string, unknown> {
  const record = readRecord(value)
  if (record) {
    return record
  }
  if (typeof value !== 'string') {
    return {}
  }
  try {
    return readRecord(JSON.parse(value)) ?? {}
  } catch {
    return {}
  }
}

function buildRealCodexE2eFailureMessage(error: unknown): string {
  const record = readRecord(error)
  const context = readRecord(record?.context)
  const parts = [
    `code=${readSafeDiagnosticString(record?.code, 'UNKNOWN')}`,
  ]
  const stage = readSafeDiagnosticString(context?.codexFailureStage)
  if (stage) {
    parts.push(`stage=${stage}`)
  }
  const status = readSafeDiagnosticString(context?.codexTurnStatus)
  if (status) {
    parts.push(`status=${status}`)
  }
  const providerActionCount = readNonNegativeInteger(context?.providerActionCount)
  if (providerActionCount !== null) {
    parts.push(`providerActionCount=${providerActionCount}`)
  }

  return `Real Codex cache probe failed: ${parts.join(' ')}`
}

async function removeRealCodexTemporaryPaths(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((targetPath) => removeRealCodexTemporaryPath(targetPath)))
}

async function removeRealCodexTemporaryPath(targetPath: string): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await rm(targetPath, {
        force: true,
        recursive: true,
      })
      return
    } catch {
      await delay(50 * attempt)
    }
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function buildCacheProbePrompt(attempt: number): string {
  const staticPrefix = Array.from(
    { length: 2200 },
    (_, index) =>
      `cache-probe-static-prefix-${String(index).padStart(4, '0')} keep-this-prefix-stable`,
  ).join('\n')

  return [
    staticPrefix,
    `Cache probe attempt ${attempt}.`,
    'You must run exactly two separate shell commands before answering.',
    'First run a shell command that counts bytes in cache_a.txt.',
    'After that result is observed, run a separate shell command that counts bytes in cache_b.txt.',
    'Then reply exactly CACHE_PROBE_OK followed by both byte counts.',
  ].join('\n\n')
}

function buildResumeCacheProbeInstructions(): string {
  return Array.from(
    { length: 3600 },
    (_, index) =>
      `resume-cache-static-instruction-${String(index).padStart(4, '0')} preserve-this-prefix-for-cache-diagnosis`,
  ).join('\n')
}

function hasTotalUsageRegressionShape(summary: CacheProbeSummary): boolean {
  return summary.finalContainsOk
    && summary.providerActionCount >= 2
    && summary.usageCount >= 2
    && summary.finalTotalInputTokens > summary.finalLastInputTokens
    && summary.finalTotalCachedInputTokens > summary.finalLastCachedInputTokens
}

function sumCodexLastUsageSnapshots(
  events: readonly CodexTokenUsageEvent[],
): CodexUsageSnapshot {
  return events.reduce<CodexUsageSnapshot>(
    (total, event) => ({
      cachedInputTokens:
        total.cachedInputTokens + event.last.cachedInputTokens,
      inputTokens: total.inputTokens + event.last.inputTokens,
      outputTokens: total.outputTokens + event.last.outputTokens,
      reasoningOutputTokens:
        total.reasoningOutputTokens + event.last.reasoningOutputTokens,
      totalTokens: total.totalTokens + event.last.totalTokens,
    }),
    {
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  )
}

function readCodexTokenUsageEvents(
  events: readonly unknown[],
): CodexTokenUsageEvent[] {
  return events.flatMap((event) => {
    const record = readRecord(event)
    const eventType = readString(record?.method, record?.type, record?.event)

    if (eventType !== 'thread/tokenUsage/updated') {
      return []
    }

    const params = readRecord(record?.params)
    const tokenUsage = readRecord(params?.tokenUsage)
    const last = readRecord(tokenUsage?.last)
    const total = readRecord(tokenUsage?.total)

    if (!last || !total) {
      return []
    }

    return [
      {
        last: readCodexUsageSnapshot(last),
        total: readCodexUsageSnapshot(total),
      },
    ]
  })
}

function readCodexUsageSnapshot(record: Record<string, unknown>): CodexUsageSnapshot {
  return {
    cachedInputTokens: readIntegerTokenCount(
      record.cachedInputTokens,
      record.cached_input_tokens,
      readRecord(record.input_tokens_details)?.cached_tokens,
    ),
    inputTokens: readIntegerTokenCount(
      record.inputTokens,
      record.input_tokens,
      record.promptTokens,
      record.prompt_tokens,
    ),
    outputTokens: readIntegerTokenCount(
      record.outputTokens,
      record.output_tokens,
      record.completionTokens,
      record.completion_tokens,
    ),
    reasoningOutputTokens: readIntegerTokenCount(
      record.reasoningOutputTokens,
      record.reasoningTokens,
      record.reasoning_tokens,
      readRecord(record.output_tokens_details)?.reasoning_tokens,
    ),
    totalTokens: readIntegerTokenCount(record.totalTokens, record.total_tokens),
  }
}

function readFinalCodexPostStartTokenUsageEvent(input: {
  events: readonly unknown[]
  turnId: string | null
}): CodexTokenUsageEvent | null {
  const turnStartedIndex = input.events.findIndex((event) => {
    const record = readRecord(event)
    const eventType = readString(record?.method, record?.type, record?.event)
    if (eventType !== 'turn/started' && eventType !== 'turn.started') {
      return false
    }

    if (!input.turnId) {
      return true
    }

    const params = readRecord(record?.params)
    const turn = readRecord(params?.turn) ?? readRecord(record?.turn)
    return readString(
      params?.turnId,
      params?.turn_id,
      turn?.id,
      record?.turnId,
      record?.turn_id,
    ) === input.turnId
  })
  const eligibleEvents =
    turnStartedIndex >= 0
      ? input.events.slice(turnStartedIndex)
      : input.events

  return readCodexTokenUsageEvents(eligibleEvents).at(-1) ?? null
}

function readCodexTurnStartResultTurnIds(
  events: readonly unknown[],
): string[] {
  return events.flatMap((event) => {
    const record = readRecord(event)
    if (!record || readString(record.method, record.type, record.event)) {
      return []
    }

    const result = readRecord(record.result)
    const turn = readRecord(result?.turn)
    const turnId = readString(
      turn?.id,
      result?.turnId,
      result?.turn_id,
    )
    return turnId ? [turnId] : []
  })
}

function readCodexTurnStartedEventTurnIds(
  events: readonly unknown[],
): string[] {
  return events.flatMap((event) => {
    const record = readRecord(event)
    const eventType = readString(record?.method, record?.type, record?.event)
    if (eventType !== 'turn/started' && eventType !== 'turn.started') {
      return []
    }

    const params = readRecord(record?.params)
    const data = readRecord(record?.data)
    const turn =
      readRecord(params?.turn)
      ?? readRecord(data?.turn)
      ?? readRecord(record?.turn)
    const turnId = readString(
      params?.turnId,
      params?.turn_id,
      turn?.id,
      data?.turnId,
      data?.turn_id,
      record?.turnId,
      record?.turn_id,
    )
    return turnId ? [turnId] : []
  })
}

function hasCodexTimingStage(
  events: readonly unknown[],
  stage: string,
): boolean {
  return events.some((event) => {
    const rawEvent = readRecord(readRecord(event)?.rawEvent)
    return rawEvent?.codexTimingStage === stage
  })
}

function summarizeCodexEventSequence(
  events: readonly unknown[],
): ResumeCacheProbeSummary['second']['eventSequence'] {
  return events.flatMap((event, index) => {
    const record = readRecord(event)
    const eventType = readString(record?.method, record?.type, record?.event)
    if (!eventType) {
      return []
    }

    const tokenUsage = readRecord(readRecord(record?.params)?.tokenUsage)
    const last = readRecord(tokenUsage?.last)
    const total = readRecord(tokenUsage?.total)

    return [
      {
        index,
        type: eventType,
        ...(last && total
          ? {
              usage: {
                last: readCodexUsageSnapshot(last),
                total: readCodexUsageSnapshot(total),
              },
            }
          : {}),
      },
    ]
  })
}

async function resolveRealCodexE2eConfig(): Promise<RealCodexE2eConfig> {
  const model =
    normalizeEnvString(process.env.MURPH_REAL_CODEX_MODEL)
    ?? DEFAULT_REAL_CODEX_MODEL
  const configuredCodexHome = normalizeEnvString(process.env.MURPH_REAL_CODEX_HOME)
  if (configuredCodexHome) {
    throw new Error(
      'MURPH_REAL_CODEX_HOME is not supported for this e2e; it always creates an isolated Codex home.',
    )
  }

  const explicitModelProvider =
    normalizeEnvString(process.env.MURPH_REAL_CODEX_MODEL_PROVIDER)
  const modelProvider =
    explicitModelProvider
    ?? (
      normalizeEnvString(process.env[VERCEL_AI_GATEWAY_API_KEY_ENV])
        ? VERCEL_AI_GATEWAY_MODEL_PROVIDER
        : OPENAI_ENV_MODEL_PROVIDER
    )
  if (modelProvider === 'openai') {
    throw new Error(
      `Use ${OPENAI_ENV_MODEL_PROVIDER} for this e2e; the built-in openai provider would require the normal Codex auth store.`,
    )
  }
  if (
    modelProvider !== OPENAI_ENV_MODEL_PROVIDER
    && modelProvider !== VERCEL_AI_GATEWAY_MODEL_PROVIDER
  ) {
    throw new Error(
      `${modelProvider} is not supported by this e2e harness; use ${OPENAI_ENV_MODEL_PROVIDER} or ${VERCEL_AI_GATEWAY_MODEL_PROVIDER}.`,
    )
  }

  const apiKeyEnv =
    normalizeEnvString(process.env.MURPH_REAL_CODEX_PROVIDER_ENV_KEY)
    ?? resolveRealCodexProviderApiKeyEnv(modelProvider)
  if (!apiKeyEnv) {
    throw new Error(
      `MURPH_REAL_CODEX_PROVIDER_ENV_KEY is required for ${modelProvider} real Codex e2e.`,
    )
  }
  if (!normalizeEnvString(process.env[apiKeyEnv])) {
    throw new Error(
      `${apiKeyEnv} is required for ${modelProvider} real Codex e2e.`,
    )
  }

  const temporaryPaths: string[] = []
  const codexHome = await mkdtemp(path.join(tmpdir(), 'murph-codex-home-'))
  temporaryPaths.push(codexHome)
  await mkdir(codexHome, {
    recursive: true,
  })
  await writeFile(
    path.join(codexHome, 'config.toml'),
    buildRealCodexConfigToml({
      apiKeyEnv,
      model,
      modelProvider,
    }),
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  )

  return {
    codexHome,
    env: buildRealCodexE2eEnv({
      apiKeyEnv,
    }),
    model,
    modelProvider,
    temporaryPaths,
  }
}

function resolveRealCodexProviderApiKeyEnv(modelProvider: string): string | null {
  if (modelProvider === VERCEL_AI_GATEWAY_MODEL_PROVIDER) {
    return VERCEL_AI_GATEWAY_API_KEY_ENV
  }

  if (modelProvider === OPENAI_ENV_MODEL_PROVIDER) {
    return OPENAI_API_KEY_ENV
  }

  return null
}

function buildRealCodexConfigToml(input: {
  apiKeyEnv: string
  model: string
  modelProvider: string
}): string {
  const baseUrl =
    input.modelProvider === VERCEL_AI_GATEWAY_MODEL_PROVIDER
      ? VERCEL_AI_GATEWAY_BASE_URL
      : OPENAI_BASE_URL
  const providerName =
    input.modelProvider === VERCEL_AI_GATEWAY_MODEL_PROVIDER
      ? 'Vercel AI Gateway'
      : 'OpenAI'

  return [
    `model = ${tomlString(input.model)}`,
    `model_provider = ${tomlString(input.modelProvider)}`,
    'model_reasoning_effort = "low"',
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    'allow_login_shell = false',
    '',
    '[shell_environment_policy]',
    'inherit = "all"',
    'ignore_default_excludes = false',
    'include_only = [',
    ...REAL_CODEX_E2E_ENV_ALLOWLIST.map((key) => `  ${tomlString(key)},`),
    ']',
    '',
    `[model_providers.${tomlKey(input.modelProvider)}]`,
    `name = ${tomlString(providerName)}`,
    `base_url = ${tomlString(baseUrl)}`,
    `env_key = ${tomlString(input.apiKeyEnv)}`,
    'wire_api = "responses"',
    'request_max_retries = 4',
    'stream_max_retries = 5',
    'supports_websockets = false',
    '',
  ].join('\n')
}

function buildRealCodexE2eEnv(input: {
  apiKeyEnv: string
  sourceEnv?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  const sourceEnv = input.sourceEnv ?? process.env
  const env: NodeJS.ProcessEnv = {}

  for (const key of REAL_CODEX_E2E_ENV_ALLOWLIST) {
    const value = normalizeEnvString(sourceEnv[key])
    if (value) {
      env[key] = value
    }
  }

  const apiKey = normalizeEnvString(sourceEnv[input.apiKeyEnv])
  if (apiKey) {
    env[input.apiKeyEnv] = apiKey
  }

  return env
}

function normalizeEnvString(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function readPositiveIntegerEnv(value: string | undefined): number | null {
  const normalized = normalizeEnvString(value)
  if (!normalized) {
    return null
  }

  const parsed = Number.parseInt(normalized, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function readSafeDiagnosticString(
  value: unknown,
  fallback?: string,
): string | null {
  if (typeof value !== 'string') {
    return fallback ?? null
  }

  const normalized = value.trim()
  if (/^[A-Za-z0-9_.:-]+$/u.test(normalized)) {
    return normalized
  }

  return fallback ?? 'present'
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null
}

function readIntegerTokenCount(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return value
    }
  }

  return 0
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }

    const normalized = value.trim()
    if (normalized.length > 0) {
      return normalized
    }
  }

  return null
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/u.test(value) ? value : tomlString(value)
}
