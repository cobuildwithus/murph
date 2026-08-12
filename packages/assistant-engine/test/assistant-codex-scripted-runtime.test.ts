import { execFile } from 'node:child_process'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from '@murphai/hosted-execution/env'
import type {
  HostedRuntimeAssistantConfigurationSnapshot,
} from '@murphai/hosted-execution/runtime-control'
import {
  createDefaultLocalAssistantModelTarget,
} from '@murphai/operator-config/assistant-backend'
import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'
import type {
  AssistantResponseCard,
} from '@murphai/operator-config/assistant-response-cards'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import {
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.ts'
import {
  compactWarmCodexThread,
  executeCodexAppServerTurn as executeCodexAppServerTurnUnchecked,
  resolveMurphDynamicTools,
  stopWarmCodexAppServer,
  type CodexAppServerTurnInput,
} from '../src/assistant-codex.ts'
import type { CodexAppServerLiveTurn } from '../src/assistant-codex.ts'
import {
  MURPH_AUTOMATION_TOOL,
  MURPH_GROUP_ASSISTANT_CONFIGURATION_TOOL,
  MURPH_GROUP_SHARED_READ_TOOL,
  MURPH_GROUP_TOOL,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  MURPH_ATTACH_RESPONSE_CARD_TOOL,
  MURPH_FINISH_WITHOUT_REPLY_TOOL,
} from '../src/assistant-codex/dynamic-tool-catalog.ts'
import type {
  VoiceMemoToolRuntime,
} from '../src/assistant-codex/generate-voice-memo-tool.ts'
import {
  createAskGrokToolRuntimeFromEnv,
} from '../src/assistant-codex/ask-grok-tool.ts'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.ts'
import type {
  AssistantHostedAutomationToolRequest,
} from '../src/assistant/execution-context.ts'
import {
  isCanonicalOnboardingFirstPersonalReadAutomationSaveRequest,
} from '../src/assistant/onboarding-first-personal-read-automation.ts'
import { sendAssistantAskContinuationLocal } from '../src/assistant/ask-continuation.ts'
import { conversationRefFromBinding } from '../src/assistant/conversation-ref.ts'
import { listAssistantOutboxIntents } from '../src/assistant/outbox.ts'
import { resolveAssistantSession } from '../src/assistant/store.ts'
import {
  getKnowledgePage,
  upsertKnowledgePage,
} from '../src/knowledge/service.ts'
import {
  renderGroupChallengeDefinitionSection,
} from '../src/assistant/group-challenge-response-card-schema.ts'
import {
  buildAssistantSystemPrompt,
} from '../src/assistant/system-prompt.ts'
import {
  ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
} from '../src/assistant/first-contact-welcome.ts'
import {
  buildAssistantResearchScoutCapabilityText,
} from '../src/assistant/model-behavior.ts'
import {
  MURPH_MANAGED_AUTOMATIONS,
  MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
} from '../src/assistant/managed-automations.ts'

// Runs the REAL `codex app-server` binary (pinned @openai/codex devDependency,
// matching CODEX_CLI_VERSION in Dockerfile.cloudflare-hosted-runner-base)
// against a local scripted Responses API stub. Deterministic and free: this is
// the default-on protocol-contract lane that replaces the deleted
// MockChildProcess happy-path fakes. Adversarial process behavior (malformed
// events, stale ids, poisoning) stays in assistant-codex-runtime.test.ts where
// a scriptable fake child process is the right tool.

const SCRIPTED_STUB_KEY_ENV = 'MURPH_SCRIPTED_STUB_KEY'
const SCRIPTED_MODEL = 'gpt-5.6-terra'
const SCRIPTED_MODEL_PROVIDER = 'local-stub'
const TURN_TIMEOUT_MS = 90_000
const execFileAsync = promisify(execFile)

const GROUP_CHALLENGE_DEFINITION = {
  format: {
    kind: 'individual',
    objective: { kind: 'ranking' },
  },
  participants: [
    { participantId: 'participant_maya', state: 'in' },
    { participantId: 'participant_jon', state: 'in' },
  ],
  rulesRevision: 1,
  scorecard: {
    components: [{
      evaluationRule: 'Sum settled shared steps in the challenge window.',
      id: 'steps',
      label: 'Steps',
      perQuantity: 100,
      points: 3,
      projectionScopeKeys: ['steps-days.v0'],
      quantityUnit: 'steps',
      settlementMode: 'window-total',
    }],
  },
  version: 1,
} as const

const GROUP_CHALLENGE_AUTHORING_INPUT = {
  challengeSlug: 'weird-health-week',
  pageRevisionDigest: '0'.repeat(64),
  participantObservations: [
    {
      components: [{
        componentId: 'steps',
        quantity: 4_000,
        status: 'available',
      }],
      participantId: 'participant_maya',
    },
    {
      components: [{ componentId: 'steps', status: 'pending' }],
      participantId: 'participant_jon',
    },
  ],
} as const

const GROUP_CHALLENGE_DYNAMIC_TOOLS = [
  MURPH_GROUP_SHARED_READ_TOOL,
  ...resolveMurphDynamicTools({
    groupChallengeResponseCardsAvailable: true,
    responseCardsAvailable: false,
  }).filter((tool) => tool.name === 'attach_response_card'),
]

function buildScriptedChallengeMember(input: {
  displayName: string
  participantId: string
  value: number | null
}) {
  return {
    currentTurnHandles: [],
    displayName: input.displayName,
    memberId: `member_${input.participantId}`,
    participantId: input.participantId,
    projections: [{
      dataStatus: input.value === null ? 'missing' as const : 'available' as const,
      grantStatus: 'granted' as const,
      projectionScope: {
        projectionKind: 'steps-days.v0' as const,
      },
      projectionScopeKey: 'steps-days.v0',
      records: input.value === null
        ? []
        : [{
            data: {
              date: '2026-08-08',
              metricKey: 'steps' as const,
              unit: 'count',
              value: input.value,
            },
            occurredAt: '2026-08-08T00:00:00.000Z',
            recordKey: '2026-08-08',
          }],
    }],
  }
}

async function prepareGroupChallengeVault(
  workingDirectory: string,
): Promise<string> {
  const vaultRoot = path.join(workingDirectory, 'group-challenge-vault')
  await createIntegratedVaultServices().core.init({
    requestId: 'scripted-group-challenge-card',
    timezone: 'UTC',
    vault: vaultRoot,
  })
  await upsertKnowledgePage({
    body: [
      'The current room challenge rules and canon.',
      '',
      renderGroupChallengeDefinitionSection(GROUP_CHALLENGE_DEFINITION),
    ].join('\n'),
    pageType: 'challenge',
    slug: 'weird-health-week',
    title: 'Weird Health Week',
    vault: vaultRoot,
  })
  return vaultRoot
}

interface ScriptedResponseRoute {
  completionLabel?: string
  delayMs?: number
  requestExcludes?: readonly string[]
  requestIncludes?: readonly string[]
}

type ScriptedResponse = ScriptedResponseRoute & (
  | { text: string }
  | {
      commentaryAndFunctionCall: {
        commentary: string
        functionCall: {
          arguments: Record<string, unknown>
          name: string
          namespace?: string
        }
      }
    }
  | {
      customToolCall: {
        input: string
        name: string
      }
    }
  | {
      toolSearchCall: {
        limit?: number
        query: string
      }
    }
  | {
      functionCall: {
        arguments: Record<string, unknown>
        name: string
        namespace?: string
      }
    }
)

interface ScriptedStub {
  baseUrl: string
  captureProviderRequestDiagnostics(): void
  close(): Promise<void>
  completedResponseLabelsSinceBaseline(): string[]
  markRequestBaseline(): void
  queue(...responses: readonly ScriptedResponse[]): void
  resetQueue(): void
  requestCountSinceBaseline(): number
  requestSummariesSinceBaseline(): ScriptedProviderRequestSummary[]
}

interface ScriptedProviderRequestSummary {
  customToolCallOutputs?: string[]
  functionCallOutputs?: string[]
  model: string | null
  providerRequestDiagnostics?: {
    bytes: number
    includesAllTools: boolean
    includesAutomation: boolean
    includesGroup: boolean
    includesReadShared: boolean
    includesResponseCardCompactTableShape: boolean
    includesResponseCardNutritionV2Shape: boolean
    includesGroupEmail: boolean
    includesToolSearch: boolean
  }
  serviceTier: string | null
  toolSearchOutputTools?: unknown[]
}

const codexCommand = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../node_modules/.bin/codex',
)

let stub: ScriptedStub | null = null
const temporaryPaths: string[] = []

function executeCodexAppServerTurn(
  input: Omit<CodexAppServerTurnInput, 'dynamicTools'> & {
    dynamicTools?: CodexAppServerTurnInput['dynamicTools']
  },
) {
  return executeCodexAppServerTurnUnchecked({
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
}

function quotePosixShellLiteral(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

async function requireScriptedStub(): Promise<ScriptedStub> {
  stub ??= await startScriptedResponsesStub()
  return stub
}

afterEach(async () => {
  await stopWarmCodexAppServer().catch(() => {})
})

afterAll(async () => {
  await stub?.close()
  stub = null
  await Promise.all(temporaryPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })))
}, 180_000)

describe('real codex app-server with scripted provider', () => {
  it('streams a scripted turn through the real app-server protocol', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.queue({ text: 'SCRIPTED_TURN_OK' })

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly SCRIPTED_TURN_OK.',
    })

    expect(result.finalMessage).toBe('SCRIPTED_TURN_OK')
    expect(result.threadId).toEqual(expect.any(String))
    expect(result.turnId).toEqual(expect.any(String))
    expect(result.sessionId).toEqual(expect.any(String))
    expect(scenario.stub.requestCountSinceBaseline()).toBe(1)
  })

  it('keeps a fresh onboarding greeting on the compact root and bounded resume read', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const skillsRoot = path.join(
      scenario.turnInput.workingDirectory,
      'skills',
    )
    await mkdir(skillsRoot, { recursive: true })
    await cp(
      path.join(resolveAssistantSkillsRoot(), 'murph-onboarding'),
      path.join(skillsRoot, 'murph-onboarding'),
      { recursive: true },
    )
    const fakeVaultCli = path.join(
      scenario.turnInput.workingDirectory,
      'vault-cli',
    )
    await writeFile(fakeVaultCli, `#!/bin/sh
if [ "$*" = "assistant onboarding resume-context --format json" ]; then
  printf '%s\\n' '{"status":"open","hasPriorSetupContext":false,"savedFacts":[]}'
  exit 0
fi
printf '%s\\n' '{"error":"unexpected scripted command"}' >&2
exit 1
`, {
      encoding: 'utf8',
      mode: 0o755,
    })

    const laterStageMarker =
      'Hosted onboarding must have capacity for at least three concurrent children.'
    const completionMarker =
      'Onboarding is complete with `user_answered` only when all of these are true:'
    const recoveryMarker =
      'A managed owner may invoke this skill at most once on each of the next three local days after the welcome.'
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "sed -n '1,260p' skills/murph-onboarding/SKILL.md",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "./vault-cli assistant onboarding resume-context --format json",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        text: ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
      },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions: buildScriptedHostedSystemPrompt('direct', true),
      env: {
        ...scenario.turnInput.env,
        [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: skillsRoot,
      },
      prompt: 'Hey',
      // This proof intentionally executes the staged skill and fake vault CLI.
      // Match the existing scripted exec lane so GitHub's restricted Linux
      // runner does not fail while bubblewrap configures loopback.
      sandbox: 'danger-full-access',
    })

    expect(result.finalMessage).toBe(ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE)
    expect(scenario.stub.requestCountSinceBaseline()).toBe(3)
    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
    expect(toolOutputs).toContain('## Progressive disclosure')
    expect(toolOutputs).toContain(
      'Never re-ask solely for optional demographics.',
    )
    expect(toolOutputs).toContain('"hasPriorSetupContext":false')
    expect(toolOutputs).not.toContain(laterStageMarker)
    expect(toolOutputs).not.toContain(completionMarker)
    expect(toolOutputs).not.toContain(recoveryMarker)
  })

  it('completes onboarding without arming or promising a revoked first read', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const skillsRoot = path.join(scenario.turnInput.workingDirectory, 'skills')
    await mkdir(skillsRoot, { recursive: true })
    await cp(
      path.join(resolveAssistantSkillsRoot(), 'murph-onboarding'),
      path.join(skillsRoot, 'murph-onboarding'),
      { recursive: true },
    )
    const commandLog = path.join(
      scenario.turnInput.workingDirectory,
      'onboarding-completion-commands.log',
    )
    const fakeVaultCli = path.join(
      scenario.turnInput.workingDirectory,
      'vault-cli',
    )
    await writeFile(fakeVaultCli, `#!/bin/sh
if [ "$*" = "assistant onboarding complete --reason user_answered" ]; then
  printf '%s\\n' "$*" >> "${commandLog}"
  printf '%s\\n' '{"status":"completed","completedReason":"user_answered"}'
  exit 0
fi
printf '%s\\n' '{"error":"unexpected scripted command"}' >&2
exit 1
`, {
      encoding: 'utf8',
      mode: 0o755,
    })
    const automationRequests: unknown[] = []
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "sed -n '1,260p' skills/murph-onboarding/SKILL.md",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "sed -n '1,360p' skills/murph-onboarding/references/return-launch-completion.md",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "./vault-cli assistant onboarding complete --reason user_answered",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        text: "Understood — you're all set, and I won't send proactive follow-ups.",
      },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions: buildScriptedHostedSystemPrompt('direct', true),
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      env: {
        ...scenario.turnInput.env,
        [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: skillsRoot,
      },
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            automationRequests.push(request)
            throw new Error('The revoked first read must not be armed.')
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
      onboardingFirstReadCompletionTransitionAvailable: true,
      prompt: [
        'Every user_answered onboarding criterion is now satisfied.',
        'Complete onboarding, but do not follow up or message me proactively.',
      ].join(' '),
      sandbox: 'danger-full-access',
    })

    expect(result.finalMessage).toBe(
      "Understood — you're all set, and I won't send proactive follow-ups.",
    )
    expect(automationRequests).toEqual([])
    expect((await readFile(commandLog, 'utf8')).trim().split('\n')).toEqual([
      'assistant onboarding complete --reason user_answered',
    ])
    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
    expect(toolOutputs).toContain(
      'Never arm it when the current message says the member asked not to',
    )
    expect(result.finalMessage).not.toContain(
      'If I find something genuinely useful',
    )
  })

  it('completes onboarding before arming and promising one first read', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const skillsRoot = path.join(scenario.turnInput.workingDirectory, 'skills')
    await mkdir(skillsRoot, { recursive: true })
    await cp(
      path.join(resolveAssistantSkillsRoot(), 'murph-onboarding'),
      path.join(skillsRoot, 'murph-onboarding'),
      { recursive: true },
    )
    const commandLog = path.join(
      scenario.turnInput.workingDirectory,
      'onboarding-positive-completion-commands.log',
    )
    const fakeVaultCli = path.join(
      scenario.turnInput.workingDirectory,
      'vault-cli',
    )
    await writeFile(fakeVaultCli, `#!/bin/sh
if [ "$*" = "assistant onboarding complete --reason user_answered" ]; then
  printf '%s\\n' "$*" >> "${commandLog}"
  printf '%s\\n' '{"status":"completed","completedReason":"user_answered"}'
  exit 0
fi
printf '%s\\n' '{"error":"unexpected scripted command"}' >&2
exit 1
`, {
      encoding: 'utf8',
      mode: 0o755,
    })
    const automationRequests: AssistantHostedAutomationToolRequest[] = []
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "sed -n '1,260p' skills/murph-onboarding/SKILL.md",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "sed -n '1,360p' skills/murph-onboarding/references/return-launch-completion.md",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "./vault-cli assistant onboarding complete --reason user_answered",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation({
  action: "save_onboarding_first_personal_read",
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      {
        text: "You're all set. I'm going to take a proper look across what you shared and any data you connected. If I find something genuinely useful—whether that's a pattern, a clearer interpretation, or something worth watching next—I'll send it over. You can keep texting me normally in the meantime.",
      },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions: buildScriptedHostedSystemPrompt('direct', true),
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      env: {
        ...scenario.turnInput.env,
        [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: skillsRoot,
      },
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            if (request.action !== 'save') {
              throw new Error('Expected an automation save request.')
            }
            expect((await readFile(commandLog, 'utf8')).trim()).toBe(
              'assistant onboarding complete --reason user_answered',
            )
            automationRequests.push(request)
            return {
              action: 'save',
              automationId: 'automation-first-personal-read',
              created: true,
              effectiveTimeZone: null,
              lookupId: 'onboarding-first-personal-read',
              nextOccurrenceAt: '2026-08-07T13:00:00.000Z',
              routeBinding: 'current_conversation',
              schedule: request.schedule,
              status: 'active',
              timingVerified: true,
              updatedAt: '2026-08-06T21:00:00.000Z',
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
      onboardingFirstReadCompletionTransitionAvailable: true,
      prompt: [
        'Every user_answered onboarding criterion is now satisfied.',
        'Complete onboarding and follow the completion owner.',
      ].join(' '),
      sandbox: 'danger-full-access',
    })

    expect(result.finalMessage).toContain(
      'If I find something genuinely useful',
    )
    expect(automationRequests).toHaveLength(1)
    const request = automationRequests[0]
    expect(request?.action).toBe('save')
    if (request?.action !== 'save') {
      throw new Error('Expected the code-owned first-read save request.')
    }
    expect(
      isCanonicalOnboardingFirstPersonalReadAutomationSaveRequest(request),
    ).toBe(true)
    expect(scenario.stub.requestCountSinceBaseline()).toBe(5)
    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
    expect(toolOutputs.replace(/\s+/gu, ' ')).toContain(
      'post-completion first-personal-read one-shot',
    )
    expect(toolOutputs).toContain('routeBinding')
    expect(toolOutputs).toContain('current_conversation')
  })

  it('carries a compact mixed-meal lookup through a grounded save and final reply', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const sourceSkillsRoot = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../skills',
    )
    const skillsRoot = path.join(
      scenario.turnInput.workingDirectory,
      'skills',
    )
    const foodJournalDirectory = path.join(skillsRoot, 'food-journal')
    await mkdir(foodJournalDirectory, { recursive: true })
    await writeFile(
      path.join(foodJournalDirectory, 'SKILL.md'),
      await readFile(
        path.join(sourceSkillsRoot, 'food-journal', 'SKILL.md'),
        'utf8',
      ),
      'utf8',
    )
    const commandLog = path.join(
      scenario.turnInput.workingDirectory,
      'vault-cli-invocations.log',
    )
    const fakeVaultCli = path.join(
      scenario.turnInput.workingDirectory,
      'vault-cli',
    )
    const compactLookupResult = JSON.stringify({
      ok: true,
      results: [
        {
          query: 'rolled oats',
          items: [
            {
              id: 'fdc:oats-1',
              name: 'Rolled oats',
              serving: { amount: 100, unit: 'g' },
              nutrition: {
                basis: 'per_100_g',
                rows: [
                  { name: 'Calories', unit: 'kcal', value: 389 },
                  { name: 'Protein', unit: 'g', value: 16.9 },
                  { name: 'Carbohydrate', unit: 'g', value: 66.3 },
                  { name: 'Fat', unit: 'g', value: 6.9 },
                  { name: 'Fiber', unit: 'g', value: 10.6 },
                ],
              },
              contaminantSummary: {
                status: 'no_known_product_tests',
                murphConcernLevel: 'unknown',
                alertCount: 0,
                alertsTruncated: false,
                alerts: [],
                observationCount: 0,
                observationsTruncated: false,
                observations: [],
              },
            },
          ],
        },
        {
          query: 'Example plain kefir',
          items: [
            {
              id: 'fdc:kefir-1',
              name: 'Example plain kefir',
              serving: { amount: 240, unit: 'g' },
              nutrition: {
                basis: 'per_100_g',
                rows: [
                  { name: 'Calories', unit: 'kcal', value: 62.5 },
                  { name: 'Protein', unit: 'g', value: 4.17 },
                  { name: 'Carbohydrate', unit: 'g', value: 5 },
                  { name: 'Fat', unit: 'g', value: 2.08 },
                  { name: 'Fiber', unit: 'g', value: 0 },
                ],
              },
              contaminantSummary: {
                status: 'known_product_tests',
                murphConcernLevel: 'high',
                alertCount: 1,
                alertsTruncated: false,
                alerts: [
                  {
                    contaminantKey: 'bisphenol_a_bpa',
                    contaminantName: 'Bisphenol A (BPA)',
                    concernLevel: 'high',
                    result: {
                      operator: 'eq',
                      value: 0.001,
                      unit: 'ppm',
                      basis: 'product_mass',
                    },
                    threshold: {
                      value: 0.2,
                      unit: 'ng/kg_bw/day',
                      basis: 'oral_total_dietary_exposure',
                      authority: 'Example Authority',
                      name: 'Example screening level',
                    },
                    screeningPolicy: {
                      id: 'adult_one_serving_per_day_v1',
                      assumedBodyWeightKg: 70,
                      assumedServingsPerDay: 1,
                      servingGrams: 240,
                      exposure: {
                        value: 3.428571,
                        unit: 'ng/kg_bw/day',
                        basis: 'oral_total_dietary_exposure',
                      },
                      ratio: 17.142855,
                    },
                    source: {
                      name: 'Example Source',
                      reportDate: '2024-07-11',
                    },
                  },
                ],
                observationCount: 6,
                observationsTruncated: true,
                observations: [
                  {
                    contaminantKey: 'bisphenol_a_bpa',
                    contaminantName: 'Bisphenol A (BPA)',
                    result: {
                      operator: 'eq',
                      value: 1,
                      upperValue: null,
                      unit: 'ng/g',
                      basis: 'product_mass',
                    },
                    source: {
                      name: 'Example Source',
                      reportDate: '2024-07-11',
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    })
    await writeFile(fakeVaultCli, `#!/bin/sh
printf '%s\\n' "$*" >> "vault-cli-invocations.log"
case "$*" in
  *food*search-labels-batch*)
    printf '%s\\n' '${compactLookupResult}'
    ;;
  *meal*add*)
    printf '%s\\n' '{"ok":true,"meal":{"id":"meal_scripted_mixed","nutrition":{"totals":{"calories":344.5,"proteinGrams":18.45,"carbsGrams":45.15,"fatGrams":8.45,"fiberGrams":5.3}}}}'
    ;;
  *)
    printf '%s\\n' '{"ok":false,"error":"unexpected scripted command"}'
    exit 1
    ;;
esac
`, {
      encoding: 'utf8',
      mode: 0o755,
    })

    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "sed -n '1,150p' skills/food-journal/SKILL.md",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const generic = JSON.stringify(JSON.stringify([
  "food", "search-labels-batch", "--query", "rolled oats", "--generic",
]));
const branded = JSON.stringify(JSON.stringify([
  "food", "search-labels-batch", "--query", "Example plain kefir",
]));
const result = await tools.exec_command({
  cmd: "./vault-cli batch --compact --format json --command " + generic + " --command " + branded,
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "./vault-cli meal add --note 'Rolled oats and plain kefir' --ingredient 'rolled oats, 50 g' --ingredient 'plain kefir, 240 g' --nutrition-calories 344.5 --nutrition-protein-grams 18.45 --nutrition-carbs-grams 45.15 --nutrition-fat-grams 8.45 --nutrition-fiber-grams 5.3 --nutrition-source database --nutrition-confidence high --nutrition-source-detail 'USDA fdc:oats-1 scaled from 100 g; label fdc:kefir-1 scaled to its 240 g serving'",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        text: 'Logged it: about 345 calories, 18g protein, 45g carbs, 8g fat, and 5g fiber. Example Source reported BPA at 1 ng/g in the kefir. Against Example Authority’s 0.2 ng/kg/day screening level, Murph’s fixed one-240g-serving-per-day, 70kg screen estimates 3.43 ng/kg/day (17.1x), a high threshold-screening result. The compact evidence list was truncated. This is screening context, not a personalized safety verdict.',
      },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions: buildScriptedHostedSystemPrompt('direct'),
      env: {
        ...scenario.turnInput.env,
      },
      prompt: 'Log a synthetic meal of 50 g rolled oats and one 240 g serving of Example plain kefir, then give me the nutrition summary.',
      sandbox: 'danger-full-access',
    })

    expect(result.finalMessage).toBe(
      'Logged it: about 345 calories, 18g protein, 45g carbs, 8g fat, and 5g fiber. Example Source reported BPA at 1 ng/g in the kefir. Against Example Authority’s 0.2 ng/kg/day screening level, Murph’s fixed one-240g-serving-per-day, 70kg screen estimates 3.43 ng/kg/day (17.1x), a high threshold-screening result. The compact evidence list was truncated. This is screening context, not a personalized safety verdict.',
    )
    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
    expect(toolOutputs).toContain('The default returns one compact')
    expect(toolOutputs).toContain('fdc:oats-1')
    expect(toolOutputs).toContain('fdc:kefir-1')
    expect(toolOutputs).toContain('adult_one_serving_per_day_v1')
    expect(toolOutputs).toContain('no_known_product_tests')
    expect(toolOutputs).toContain('"observationsTruncated":true')
    expect(toolOutputs).toContain('meal_scripted_mixed')
    const invocations = (await readFile(commandLog, 'utf8'))
      .trim()
      .split('\n')
    expect(invocations).toHaveLength(2)
    expect(invocations[0]?.match(/search-labels-batch/gu)).toHaveLength(2)
    expect(invocations[0]?.match(/--generic/gu)).toHaveLength(1)
    expect(invocations[0]).not.toContain('--limit')
    expect(invocations[0]).not.toContain('--full-label')
    expect(invocations[1]).toContain('--nutrition-calories 344.5')
    expect(invocations[1]).toContain('USDA fdc:oats-1 scaled from 100 g')
    expect(invocations[1]).toContain('label fdc:kefir-1 scaled to its 240 g serving')
    expect(scenario.stub.requestCountSinceBaseline()).toBe(4)
  })

  it('carries generalized Exa evidence through progress, source mapping, and empty recovery', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const requestLog = path.join(
      scenario.turnInput.workingDirectory,
      'research-request.log',
    )
    const fakeVaultCli = path.join(
      scenario.turnInput.workingDirectory,
      'vault-cli',
    )
    const sourcedResponsePayload = {
      ok: true,
      privacy: {
        persistedByTool: false,
        rawVaultValuesSent: false,
        sentProfileKind: 'focused_profile',
        tokenSource: 'env',
      },
      provider: {
        endpoint: 'search',
        mode: 'deep-reasoning',
        name: 'exa',
      },
      response: {
        output: {
          content: JSON.stringify({
            candidates: [{
              actionOrQuestion: 'Treat this as a population-level result.',
              doNotOverinterpret: 'The included trials were small and heterogeneous.',
              evidenceStrength: 'moderate',
              hypeRisk: 'medium',
              keyFinding: 'The review found a small possible memory benefit.',
              matchedProfileTags: [],
              resultIndex: 0,
              studyType: 'systematic_review',
              whyItMayMatter: 'It directly addresses the generalized question.',
            }],
          }),
        },
        results: [{
          publishedDate: '2025-02-03',
          title: 'Creatine and cognitive performance: a systematic review',
          url: 'https://example.test/research/creatine-cognition-review',
        }],
      },
    }
    const sourcedResponse = JSON.stringify(sourcedResponsePayload)
    const emptyResponse = JSON.stringify({
      ok: true,
      privacy: {
        persistedByTool: false,
        rawVaultValuesSent: false,
        sentProfileKind: 'focused_profile',
        tokenSource: 'env',
      },
      provider: {
        endpoint: 'search',
        mode: 'deep-reasoning',
        name: 'exa',
      },
      response: {
        output: { content: '{"candidates":[]}' },
        results: [],
      },
    })
    const batchResponse = JSON.stringify({
      ok: true,
      privacy: {
        ...sourcedResponsePayload.privacy,
        sentProfileKind: 'tag_profile',
      },
      provider: sourcedResponsePayload.provider,
      lanes: [{
        label: 'creatine and cognition',
        response: sourcedResponsePayload.response,
      }],
    })
    await writeFile(fakeVaultCli, `#!/bin/sh
if [ "$*" = "research payload-schema --format json" ]; then
  printf '%s\\n' '{"schemaVersion":"murph.payload-schema.v1","schema":{"properties":{"topics":{"items":{"description":"Allowed provider values: cognition."}},"supplements":{"items":{"description":"Allowed provider values: creatine."}},"conditionsOrConcerns":{"items":{"description":"Allowed provider values: adults, healthy adults."}},"goals":{"items":{"description":"Allowed provider values: cognitive performance."}}}}}'
  exit 0
fi
if [ "$*" = "research scout-batch-payload-schema --format json" ]; then
  printf '%s\\n' '{"command":"research scout-batch-payload-schema","schemaVersion":"murph.payload-schema.v1","schema":{"properties":{"lanes":{"items":{"properties":{"profile":{"properties":{"topics":{"items":{"description":"Allowed provider values: cognition."}},"supplements":{"items":{"description":"Allowed provider values: creatine."}},"conditionsOrConcerns":{"items":{"description":"Allowed provider values: healthy adults."}},"goals":{"items":{"description":"Allowed provider values: cognitive performance."}}}}}}}}}}'
  exit 0
fi
request="$(cat)"
printf '%s\\n' "$request" >> "research-request.log"
case "$*" in
  *"research scout-batch"*) printf '%s\\n' '${batchResponse}'; exit 0 ;;
esac
case "$request" in
  *creatine*) printf '%s\\n' '${sourcedResponse}' ;;
  *) printf '%s\\n' '${emptyResponse}' ;;
esac
`, {
      encoding: 'utf8',
      mode: 0o755,
    })
    const progressUpdates: string[] = []
    const progressDelivery = {
      send: async (text: string) => {
        progressUpdates.push(text)
        return { kind: 'sent' as const, source: 'model' as const }
      },
    }
    const directGuidance = buildAssistantResearchScoutCapabilityText({
      progressUpdateMode: 'direct',
    })

    scenario.stub.queue(
      {
        functionCall: {
          arguments: { text: 'I’m checking the current human evidence and its limits.' },
          name: 'send_progress_update',
          namespace: 'murph',
        },
      },
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "./vault-cli research payload-schema --format json",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const input = JSON.stringify({mode: "focused", topics: ["cognition"], supplements: ["creatine"], conditionsOrConcerns: ["adults"], goals: ["cognitive performance"]});
const result = await tools.exec_command({
  cmd: "printf '%s' '" + input + "' | ./vault-cli research scout --input - --since 2020-01-01 --until 2026-08-06",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        text: 'A 2025 systematic review, “Creatine and cognitive performance,” found a small possible memory benefit, but the evidence is only moderate because the included trials were small and heterogeneous. Source: https://example.test/research/creatine-cognition-review. That is population-level evidence, not a personalized recommendation.',
      },
    )

    const sourced = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions: directGuidance,
      env: {
        ...scenario.turnInput.env,
        EXA_API_KEY: 'configured-sentinel',
      },
      progressDelivery,
      prompt: 'Check current creatine-and-memory evidence relevant to Caseperson, then explain the useful result and its main limitation.',
      sandbox: 'danger-full-access',
    })

    expect(progressUpdates).toEqual([
      'I’m checking the current human evidence and its limits.',
    ])
    expect(sourced.finalMessage).toContain('2025 systematic review')
    expect(sourced.finalMessage).toContain('evidence is only moderate')
    expect(sourced.finalMessage).toContain('small and heterogeneous')
    expect(sourced.finalMessage).toContain(
      'https://example.test/research/creatine-cognition-review',
    )
    expect(
      scenario.stub.requestSummariesSinceBaseline()
        .flatMap((summary) => summary.customToolCallOutputs ?? [])
        .join('\n'),
    ).toContain('Allowed provider values: creatine')
    const providerQuestion = (await readFile(requestLog, 'utf8')).trim()
    expect(providerQuestion).toContain('"mode":"focused"')
    expect(providerQuestion).toContain('"topics":["cognition"]')
    expect(providerQuestion).toContain('"supplements":["creatine"]')
    expect(providerQuestion.toLowerCase()).not.toContain('caseperson')

    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const input = JSON.stringify({mode: "focused", behaviors: ["meal timing", "sleep timing"], conditionsOrConcerns: ["adults"]});
const result = await tools.exec_command({
  cmd: "printf '%s' '" + input + "' | ./vault-cli research scout --input - --since 2025-01-01 --until 2026-08-06",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        text: 'That research pass found no usable current source, so I would not raise confidence or invent a current-evidence answer from it.',
      },
    )

    const empty = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions: directGuidance,
      env: {
        ...scenario.turnInput.env,
        EXA_API_KEY: 'configured-sentinel',
      },
      progressDelivery,
      prompt: 'Check current trial evidence on meal timing and sleep timing.',
      sandbox: 'danger-full-access',
    })

    expect(empty.finalMessage).toBe(
      'That research pass found no usable current source, so I would not raise confidence or invent a current-evidence answer from it.',
    )
    expect(progressUpdates).toHaveLength(1)
    expect((await readFile(requestLog, 'utf8')).trim().split('\n')).toHaveLength(2)

    scenario.stub.markRequestBaseline()
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "./vault-cli research payload-schema --format json",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        text: 'I could not safely form that current-source lookup, so no current sources were checked. I can offer clearly labeled general background from existing knowledge, but not a current-research answer.',
      },
    )

    const unrepresentable = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions: directGuidance,
      env: {
        ...scenario.turnInput.env,
        EXA_API_KEY: 'configured-sentinel',
      },
      progressDelivery,
      prompt: 'What do the latest human studies say about semaglutide and gallbladder risk?',
      sandbox: 'danger-full-access',
    })

    expect(unrepresentable.finalMessage).toContain(
      'could not safely form that current-source lookup',
    )
    expect(unrepresentable.finalMessage).toContain(
      'no current sources were checked',
    )
    expect(unrepresentable.finalMessage).toContain('general background')
    expect(unrepresentable.finalMessage).not.toContain('I found')
    expect(unrepresentable.finalMessage).not.toContain('I checked')
    expect(unrepresentable.finalMessage).not.toContain('I reviewed')
    expect(unrepresentable.finalMessage).not.toContain('I verified')
    expect(scenario.stub.requestCountSinceBaseline()).toBe(2)
    expect((await readFile(requestLog, 'utf8')).trim().split('\n')).toHaveLength(2)

    const managedResearchScout = MURPH_MANAGED_AUTOMATIONS.find(
      (seed) =>
        seed.automationId ===
          MURPH_WEEKLY_HEALTH_RESEARCH_SCOUT_AUTOMATION_ID,
    )
    expect(managedResearchScout).toBeDefined()

    scenario.stub.markRequestBaseline()
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "./vault-cli research scout-batch-payload-schema --format json",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const input = JSON.stringify({lanes: [{label: "creatine and cognition", profile: {topics: ["cognition"], supplements: ["creatine"], conditionsOrConcerns: ["healthy adults"], goals: ["cognitive performance"]}}]});
const result = await tools.exec_command({
  cmd: "printf '%s' '" + input + "' | ./vault-cli research scout-batch --input - --since 2024-08-07 --until 2026-08-07 --maxCandidatesPerLane 8",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        text: 'A current review suggests creatine may have a small memory benefit, although the trials were small and heterogeneous.',
      },
    )

    const scheduled = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      allowFinishWithoutReply: true,
      baseInstructions: managedResearchScout!.instructions,
      env: {
        ...scenario.turnInput.env,
        EXA_API_KEY: 'configured-sentinel',
      },
      prompt: 'Scheduled occurrence context: the current vault context contains an active creatine experiment and a current cognition question.',
      sandbox: 'danger-full-access',
    })

    expect(scheduled.finalMessage).toContain('small memory benefit')
    expect(scenario.stub.requestCountSinceBaseline()).toBe(3)
    const scheduledToolOutputs =
      scenario.stub.requestSummariesSinceBaseline()
        .flatMap((summary) => summary.customToolCallOutputs ?? [])
        .join('\n')
    expect(scheduledToolOutputs).toContain(
      'research scout-batch-payload-schema',
    )
    expect(scheduledToolOutputs).toContain(
      'https://example.test/research/creatine-cognition-review',
    )
    const scheduledRequests = (await readFile(requestLog, 'utf8'))
      .trim()
      .split('\n')
    expect(scheduledRequests).toHaveLength(3)
    expect(scheduledRequests[2]).toContain('"topics":["cognition"]')
    expect(scheduledRequests[2]).toContain('"supplements":["creatine"]')
    expect(scheduledRequests[2]).not.toContain('mode')

    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.exec_command({
  cmd: "./vault-cli research scout-batch-payload-schema --format json",
});
text(result.output);
`,
          name: 'exec',
        },
      },
      {
        functionCall: {
          arguments: {},
          name: 'finish_without_reply',
          namespace: 'murph',
        },
      },
      { text: '' },
    )

    const suppressed = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      allowFinishWithoutReply: true,
      baseInstructions: managedResearchScout!.instructions,
      env: {
        ...scenario.turnInput.env,
        EXA_API_KEY: 'configured-sentinel',
      },
      prompt: 'Scheduled occurrence context: a current private context exists, but none of it maps exactly to an allowed provider concept.',
      sandbox: 'danger-full-access',
    })

    expect(suppressed.finalAction).toEqual({ kind: 'none' })
    expect(suppressed.finalMessage).toBe('')
    expect((await readFile(requestLog, 'utf8')).trim().split('\n')).toHaveLength(3)
  })

  it.each(['direct', 'group'] as const)(
    'carries a delayed V2 child completion into a later %s root turn without waiting',
    { timeout: TURN_TIMEOUT_MS },
    async (conversationScope) => {
      const scenario = await prepareScriptedTurnScenario({
        multiAgentV2: true,
      })
      const scopeLabel = conversationScope.toUpperCase()
      const childResult = `LATE_CHILD_RESULT_${scopeLabel}`
      const firstPrompt = `SPAWN_LATE_CHILD_${scopeLabel}`
      const laterPrompt = `USE_LATE_CHILD_${scopeLabel}`
      scenario.stub.queue(
        {
          functionCall: {
            arguments: {
              fork_turns: 'none',
              message: `Return exactly ${childResult}.`,
              task_name: `late_child_${conversationScope}`,
            },
            name: 'spawn_agent',
            namespace: 'collaboration',
          },
          requestIncludes: [firstPrompt],
        },
        {
          completionLabel: childResult,
          delayMs: 1_500,
          requestIncludes: [
            'Message Type: NEW_TASK',
            `late_child_${conversationScope}`,
          ],
          text: childResult,
        },
        {
          requestExcludes: ['Message Type: FINAL_ANSWER'],
          requestIncludes: [firstPrompt],
          text: `ROOT_REPLIED_WITHOUT_WAIT_${scopeLabel}`,
        },
      )

      const first = await executeCodexAppServerTurn({
        ...scenario.turnInput,
        baseInstructions: buildScriptedHostedSystemPrompt(conversationScope),
        groupConversation: conversationScope === 'group',
        prompt: firstPrompt,
      })

      expect(first.finalMessage).toBe(`ROOT_REPLIED_WITHOUT_WAIT_${scopeLabel}`)
      expect(first.sessionId).toEqual(expect.any(String))
      expect(
        scenario.stub.completedResponseLabelsSinceBaseline(),
      ).not.toContain(childResult)

      const childDeadline = Date.now() + 5_000
      while (
        !scenario.stub.completedResponseLabelsSinceBaseline().includes(childResult)
        && Date.now() < childDeadline
      ) {
        await delay(20)
      }
      expect(
        scenario.stub.completedResponseLabelsSinceBaseline(),
      ).toContain(childResult)
      await delay(100)

      scenario.stub.queue({
        requestIncludes: [
          laterPrompt,
          childResult,
        ],
        text: `INCORPORATED_${childResult}`,
      })
      const later = await executeCodexAppServerTurn({
        ...scenario.turnInput,
        groupConversation: conversationScope === 'group',
        prompt: laterPrompt,
        resumeSessionId: first.sessionId,
      })

      expect(later.finalMessage).toBe(`INCORPORATED_${childResult}`)
      expect(later.threadId).toBe(first.threadId)
      expect(scenario.stub.requestCountSinceBaseline()).toBe(4)
    },
  )

  it('composes a reviewed group continuation through the real provider and queues one reply', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.captureProviderRequestDiagnostics()
    scenario.stub.queue({
      text: 'First reviewed fact.\n---\nSecond reviewed fact.',
    })
    const target = {
      ...createDefaultLocalAssistantModelTarget(),
      codexCommand: scenario.turnInput.codexCommand,
      codexHome: scenario.turnInput.codexHome,
      model: scenario.turnInput.model,
      modelProvider: null,
      reasoningEffort: 'low' as const,
      sandbox: 'read-only' as const,
    }
    const participantId = 'participant-reviewed-continuation'
    const laterParticipantId = 'participant-later-speaker'
    const threadId = 'thread-reviewed-continuation'
    const resolved = await resolveAssistantSession({
      actorId: participantId,
      bindingDeliveryTarget: threadId,
      channel: 'telegram',
      target,
      threadId,
      threadIsDirect: false,
      vault: scenario.turnInput.workingDirectory,
    })
    const currentSpeaker = await resolveAssistantSession({
      actorId: laterParticipantId,
      bindingDeliveryTarget: threadId,
      channel: 'telegram',
      target,
      threadId,
      threadIsDirect: false,
      vault: scenario.turnInput.workingDirectory,
    })
    expect(currentSpeaker.session.sessionId).toBe(resolved.session.sessionId)
    expect(currentSpeaker.session.binding.actorId).toBe(laterParticipantId)

    const result = await sendAssistantAskContinuationLocal({
      actorId: currentSpeaker.session.binding.actorId,
      answeredMailboxItemIds: ['aask_done_reviewed_continuation'],
      bindingDeliveryTarget: threadId,
      canCommit: () => true,
      channel: 'telegram',
      conversation: conversationRefFromBinding(currentSpeaker.session.binding),
      deliveryIdempotencyKey: 'assistant-ask-reviewed-continuation',
      deliveryReplyToMessageId: 'message-reviewed-continuation',
      deliveryTarget: threadId,
      executionContext: {
        hosted: {
          defaultTarget: target,
          memberId: 'member-reviewed-continuation',
          userEnvKeys: [],
        },
      },
      expectedConversationScope: 'group',
      instructions: 'Reply naturally using only the reviewed private result quoted here.',
      originAssistantInputId: `ain_${'c'.repeat(32)}`,
      participantId: currentSpeaker.session.binding.actorId,
      requestId: 'aask_req_reviewed_continuation',
      reviewedAssistantAskCompletionExpiresAt: '2099-01-01T00:00:00.000Z',
      sessionId: resolved.session.sessionId,
      threadId,
      threadIsDirect: false,
      turnEnvironment: {
        currentWorkingDirectory: scenario.turnInput.workingDirectory,
        env: scenario.turnInput.env,
      },
      vault: scenario.turnInput.workingDirectory,
      workingDirectory: scenario.turnInput.workingDirectory,
    })

    expect(result).toMatchObject({
      response: 'First reviewed fact.\n---\nSecond reviewed fact.',
      status: 'completed',
    })
    expect(scenario.stub.requestCountSinceBaseline()).toBe(1)
    expect(scenario.stub.requestSummariesSinceBaseline()).toEqual([
      expect.objectContaining({
        providerRequestDiagnostics: expect.objectContaining({
          includesAutomation: false,
          includesGroup: false,
          includesReadShared: false,
          includesToolSearch: false,
        }),
      }),
    ])
    expect(await listAssistantOutboxIntents(
      scenario.turnInput.workingDirectory,
    )).toEqual([
      expect.objectContaining({
        answeredMailboxItemIds: ['aask_done_reviewed_continuation'],
        deliveryIdempotencyKey: 'assistant-ask-reviewed-continuation',
        message: 'First reviewed fact.\n\nSecond reviewed fact.',
        reviewedAssistantAskCompletionExpiresAt:
          '2099-01-01T00:00:00.000Z',
        status: 'pending',
        threadId,
        threadIsDirect: false,
      }),
    ])
  })

  it('defers broad Murph schemas through native Codex code-mode discovery', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const modelCatalogJson = await writeOpenAiFlexModelCatalogJson({
      codexCommand: scenario.turnInput.codexCommand,
      directory: scenario.turnInput.codexHome,
    })
    scenario.stub.captureProviderRequestDiagnostics()
    const automationRequests: unknown[] = []
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const tool = ALL_TOOLS.find(({ name }) => name === "murph__automation");
const groupTool = ALL_TOOLS.find(({ name }) => name === "murph__group");
if (!tool) {
  text(JSON.stringify({ found: false, foundGroup: Boolean(groupTool) }));
} else {
  const result = await tools.murph__automation({
    action: "save",
    instructions: "Send a short reminder.",
    schedule: { kind: "dailyLocal", localTime: "09:00" },
    title: "Morning reminder",
  });
  text(JSON.stringify({ found: true, foundGroup: Boolean(groupTool), result }));
}
`,
          name: 'exec',
        },
      },
      { text: 'NATIVE_DEFERRED_TOOL_OK' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools: [MURPH_AUTOMATION_TOOL, MURPH_GROUP_TOOL],
      env: {
        ...scenario.turnInput.env,
        [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: modelCatalogJson,
      },
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            if (request.action !== 'save') {
              throw new Error('Expected an automation save request.')
            }
            automationRequests.push(request)
            return {
              action: 'save',
              automationId: 'automation-native-deferred',
              created: true,
              effectiveTimeZone: 'America/New_York',
              lookupId: 'morning-reminder',
              nextOccurrenceAt: '2026-08-08T13:00:00.000Z',
              routeBinding: 'current_conversation',
              schedule: request.schedule,
              status: 'active',
              timingVerified: true,
              updatedAt: '2026-08-08T12:00:00.000Z',
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
      prompt: 'Save the reminder, then reply exactly NATIVE_DEFERRED_TOOL_OK.',
    })

    const summaries = scenario.stub.requestSummariesSinceBaseline()
    expect(summaries[0]).toMatchObject({
      providerRequestDiagnostics: {
        includesAllTools: true,
        includesAutomation: false,
        includesGroup: false,
        includesGroupEmail: false,
      },
    })
    expect(summaries[0]?.providerRequestDiagnostics?.bytes).toBeGreaterThan(0)
    const automationOutput =
      summaries[1]?.customToolCallOutputs?.join('\n') ?? ''
    expect(automationOutput).toContain('"foundGroup":true')
    expect(automationOutput).toContain('automation-native-deferred')
    expect(automationOutput).toContain('morning-reminder')
    expect(automationOutput).toContain('active')
    expect(automationRequests).toEqual([{
      action: 'save',
      instructions: 'Send a short reminder.',
      schedule: { kind: 'dailyLocal', localTime: '09:00' },
      title: 'Morning reminder',
    }])
    expect(result.finalMessage).toBe('NATIVE_DEFERRED_TOOL_OK')
    expect(scenario.stub.requestCountSinceBaseline()).toBe(2)

    const deferredRequestBytes =
      summaries[0]?.providerRequestDiagnostics?.bytes ?? 0
    await stopWarmCodexAppServer()
    const directScenario = await prepareScriptedTurnScenario()
    directScenario.stub.captureProviderRequestDiagnostics()
    directScenario.stub.queue({ text: 'DIRECT_TOOL_BASELINE_OK' })
    const directResult = await executeCodexAppServerTurn({
      ...directScenario.turnInput,
      configOverrides: [
        'features.code_mode.direct_only_tool_namespaces=["murph"]',
      ],
      dynamicTools: [MURPH_AUTOMATION_TOOL, MURPH_GROUP_TOOL],
      env: {
        ...directScenario.turnInput.env,
        [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: modelCatalogJson,
      },
      prompt: 'Save the reminder, then reply exactly NATIVE_DEFERRED_TOOL_OK.',
    })
    const directSummary =
      directScenario.stub.requestSummariesSinceBaseline()[0]

    expect(directResult.finalMessage).toBe('DIRECT_TOOL_BASELINE_OK')
    expect(directSummary).toMatchObject({
      providerRequestDiagnostics: {
        includesAutomation: true,
        includesGroup: true,
        includesGroupEmail: true,
      },
    })
    expect(
      (directSummary?.providerRequestDiagnostics?.bytes ?? 0)
        - deferredRequestBytes,
    ).toBeGreaterThan(4_000)
  })

  it('preserves the stored timezone through a separate schedule-patch turn', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const automationRequests: AssistantHostedAutomationToolRequest[] = []
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation({
  action: "patch",
  expectedUpdatedAt: "2026-08-10T00:00:00.000Z",
  lookup: "evening-reminder",
  schedule: { kind: "dailyLocal", localTime: "22:00" },
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      { text: 'Updated your evening reminder to 10 PM Central.' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions: buildScriptedHostedSystemPrompt('direct', true),
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            if (request.action !== 'patch') {
              throw new Error('Expected an automation patch request.')
            }
            automationRequests.push(request)
            return {
              action: 'patch',
              automationId: 'automation-central-evening',
              created: false,
              effectiveTimeZone: 'America/Chicago',
              lookupId: 'evening-reminder',
              nextOccurrenceAt: '2026-08-11T03:00:00.000Z',
              routeBinding: 'preserved',
              schedule: {
                kind: 'dailyLocal',
                localTime: '22:00',
                timeZone: 'America/Chicago',
              },
              status: 'active',
              timingVerified: true,
              updatedAt: '2026-08-10T00:01:00.000Z',
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
      prompt: 'Move my evening reminder to 10 PM. Save the change now.',
    })

    expect(automationRequests).toEqual([{
      action: 'patch',
      expectedUpdatedAt: '2026-08-10T00:00:00.000Z',
      lookup: 'evening-reminder',
      schedule: { kind: 'dailyLocal', localTime: '22:00' },
    }])
    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
    expect(toolOutputs).toContain('America/Chicago')
    expect(toolOutputs).toContain('2026-08-11T03:00:00.000Z')
    expect(result.finalMessage).toBe(
      'Updated your evening reminder to 10 PM Central.',
    )
  })

  it('inspects existing reminder timing without issuing a mutation', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const automationRequests: AssistantHostedAutomationToolRequest[] = []
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation({
  action: "inspect",
  lookup: "evening-reminder",
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      { text: 'Your reminder is set for 10 PM Central.' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions: buildScriptedHostedSystemPrompt('direct', true),
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            if (request.action !== 'inspect') {
              throw new Error('Expected an automation inspection request.')
            }
            automationRequests.push(request)
            return {
              action: 'inspect',
              automationId: 'automation-central-evening',
              effectiveTimeZone: 'America/Chicago',
              lookupId: 'evening-reminder',
              nextOccurrenceAt: '2026-08-11T03:00:00.000Z',
              routeBinding: 'preserved',
              schedule: {
                kind: 'dailyLocal',
                localTime: '22:00',
                timeZone: 'America/Chicago',
              },
              status: 'active',
              timingVerified: true,
              updatedAt: '2026-08-10T00:00:00.000Z',
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
      prompt: 'What time is my evening reminder scheduled for?',
    })

    expect(automationRequests).toEqual([{
      action: 'inspect',
      lookup: 'evening-reminder',
    }])
    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
    expect(toolOutputs).toContain('America/Chicago')
    expect(toolOutputs).toContain('2026-08-11T03:00:00.000Z')
    expect(result.finalMessage).toBe(
      'Your reminder is set for 10 PM Central.',
    )
  })

  it('resolves a group one-shot local time before saving and exposes verified readback', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const automationRequests: AssistantHostedAutomationToolRequest[] = []
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation({
  action: "save",
  instructions: "Send the group a short reminder.",
  schedule: {
    kind: "at",
    localAt: {
      relativeDay: "today",
      time: "23:20",
      timeZone: "Pacific/Honolulu",
    },
  },
  title: "Group one-shot reminder",
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      { text: 'The group reminder is saved for the verified local time.' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      automationRelativeDateReferenceWindow: {
        earliestAt: '2031-02-15T09:59:59.900Z',
        latestAt: '2031-02-15T09:59:59.900Z',
      },
      baseInstructions: buildScriptedHostedSystemPrompt('group', true),
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            if (request.action !== 'save') {
              throw new Error('Expected an automation save request.')
            }
            automationRequests.push(request)
            return {
              action: 'save',
              automationId: 'automation-group-one-shot',
              created: true,
              effectiveTimeZone: null,
              lookupId: 'group-one-shot-reminder',
              nextOccurrenceAt: '2031-02-15T09:20:00.000Z',
              routeBinding: 'current_conversation',
              schedule: {
                at: '2031-02-15T09:20:00.000Z',
                kind: 'at',
              },
              status: 'active',
              timingVerified: true,
              updatedAt: '2031-02-14T12:00:00.000Z',
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
      prompt: 'Save a one-time reminder for this authenticated group.',
    })

    expect(automationRequests).toEqual([{
      action: 'save',
      instructions: 'Send the group a short reminder.',
      schedule: {
        at: '2031-02-15T09:20:00.000Z',
        kind: 'at',
      },
      title: 'Group one-shot reminder',
    }])
    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
      .replace(/\\"/gu, '"')
    expect(toolOutputs).toContain('"timingVerified":true')
    expect(toolOutputs).toContain('"effectiveTimeZone":null')
    expect(toolOutputs).toContain('"nextOccurrenceAt":"2031-02-15T09:20:00.000Z"')
    expect(result.finalMessage).toBe(
      'The group reminder is saved for the verified local time.',
    )
  })

  it.each([
    {
      expectedClarification:
        'The trusted reminder date is 2026-03-08. What other local time on 2026-03-08 should I use?',
      finalMessage:
        '2:30 AM does not exist on 2026-03-08 because of daylight saving time.',
      referenceAt: '2026-03-08T04:59:00.000Z',
      time: '02:30',
      title: 'Gap reminder',
    },
    {
      expectedClarification:
        'The trusted reminder date is 2026-11-01. Should I use the earlier or later occurrence on 2026-11-01?',
      finalMessage:
        '1:30 AM occurs twice on 2026-11-01 because of daylight saving time.',
      referenceAt: '2026-11-01T03:59:00.000Z',
      time: '01:30',
      title: 'Fold reminder',
    },
  ])('retains the trusted date in the $title clarification transcript', {
    timeout: TURN_TIMEOUT_MS,
  }, async ({
    expectedClarification,
    finalMessage,
    referenceAt,
    time,
    title,
  }) => {
    const scenario = await prepareScriptedTurnScenario()
    const automationRequest = vi.fn(async () => {
      throw new Error('DST clarification must not mutate an automation.')
    })
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation({
  action: "save",
  instructions: "Send the reminder tomorrow.",
  schedule: {
    kind: "at",
    localAt: {
      relativeDay: "tomorrow",
      time: "${time}",
      timeZone: "America/New_York",
    },
  },
  title: "${title}",
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      { text: finalMessage },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      automationRelativeDateReferenceWindow: {
        earliestAt: referenceAt,
        latestAt: referenceAt,
      },
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      hostedToolContext: {
        automationTool: { request: automationRequest },
        computerToolsAvailable: false,
        currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [],
        sendVaultFile: async () => {
          throw new Error('Vault file sends are unavailable in this test.')
        },
        vaultFileSendAvailable: false,
      },
      prompt: `Remind me tomorrow at ${time} in New York.`,
    })

    expect(automationRequest).not.toHaveBeenCalled()
    expect(result.finalMessage).toBe(`${finalMessage}\n\n${expectedClarification}`)
    expect(result.transcriptMessage).toBe(
      `${finalMessage}\n\n${expectedClarification}`,
    )
  })

  it.each([
    {
      expectedAt: '2026-03-08T07:30:00.000Z',
      failedTime: '02:30',
      finalMessage: 'Done — your reminder is set for 3:30 AM on March 8.',
      kind: 'gap',
      referenceAt: '2026-03-08T04:59:00.000Z',
      retryLocalAt: {
        date: '2026-03-08',
        time: '03:30',
        timeZone: 'America/New_York',
      },
      staleClarification:
        'The trusted reminder date is 2026-03-08. What other local time on 2026-03-08 should I use?',
      steerAt: '2026-03-08T05:01:00.000Z',
      steerPrompt: 'Actually, use 3:30 AM.',
      title: 'Spring reminder',
    },
    {
      expectedAt: '2026-11-01T05:30:00.000Z',
      failedTime: '01:30',
      finalMessage:
        'Done — your reminder is set for the earlier 1:30 AM on November 1.',
      kind: 'fold',
      referenceAt: '2026-11-01T03:59:00.000Z',
      retryLocalAt: {
        date: '2026-11-01',
        fold: 'earlier' as const,
        time: '01:30',
        timeZone: 'America/New_York',
      },
      staleClarification:
        'The trusted reminder date is 2026-11-01. Should I use the earlier or later occurrence on 2026-11-01?',
      steerAt: '2026-11-01T04:01:00.000Z',
      steerPrompt: 'Use the earlier occurrence.',
      title: 'Fall reminder',
    },
  ])('clears a matching $kind clarification after a successful live-steered retry', {
    timeout: TURN_TIMEOUT_MS,
  }, async ({
    expectedAt,
    failedTime,
    finalMessage,
    referenceAt,
    retryLocalAt,
    staleClarification,
    steerAt,
    steerPrompt,
    title,
  }) => {
    const scenario = await prepareScriptedTurnScenario()
    const automationRequests: AssistantHostedAutomationToolRequest[] = []
    let steered: Promise<void> | null = null
    const failedRequest = {
      action: 'save',
      instructions: 'Send the reminder tomorrow.',
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: failedTime,
          timeZone: 'America/New_York',
        },
      },
      title,
    }
    const retryRequest = {
      action: 'save',
      instructions: 'Send the reminder tomorrow.',
      schedule: {
        kind: 'at',
        localAt: retryLocalAt,
      },
      title,
    }
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation(${JSON.stringify(failedRequest)});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      {
        delayMs: 4_000,
        text: 'Tell me the missing DST choice and I can finish this reminder.',
      },
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation(${JSON.stringify(retryRequest)});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      { text: finalMessage },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      automationRelativeDateReferenceWindow: {
        earliestAt: referenceAt,
        latestAt: referenceAt,
      },
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            if (request.action !== 'save') {
              throw new Error('Expected an automation save request.')
            }
            automationRequests.push(request)
            return {
              action: 'save',
              automationId: `automation-${title.toLowerCase().replace(/\s+/gu, '-')}`,
              created: true,
              effectiveTimeZone: null,
              lookupId: title.toLowerCase().replace(/\s+/gu, '-'),
              nextOccurrenceAt: expectedAt,
              routeBinding: 'current_conversation',
              schedule: request.schedule,
              status: 'active',
              timingVerified: true,
              updatedAt: steerAt,
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
      onLiveTurn: (turn: CodexAppServerLiveTurn) => {
        steered = delay(1_000).then(() =>
          turn.steer({
            prompt: steerPrompt,
            relativeDateReferenceWindow: {
              earliestAt: steerAt,
              latestAt: steerAt,
            },
          }))
      },
      prompt: `Remind me tomorrow at ${failedTime} in New York.`,
    })

    expect(steered).not.toBeNull()
    await steered
    expect(automationRequests).toEqual([{
      action: 'save',
      instructions: 'Send the reminder tomorrow.',
      schedule: { at: expectedAt, kind: 'at' },
      title,
    }])
    expect(result.finalMessage).toBe(finalMessage)
    expect(result.transcriptMessage).toBe(finalMessage)
    expect(result.finalMessage).not.toContain(staleClarification)
    expect(result.transcriptMessage).not.toContain(staleClarification)
  })

  it.each([
    {
      expectedAt: '2026-03-08T07:30:00.000Z',
      failedLookup: 'medication-reminder',
      failedTime: '02:30',
      referenceAt: '2026-03-08T04:59:00.000Z',
      responseLookup: 'medication-reminder',
      retryLocalAt: {
        date: '2026-03-08',
        time: '03:30',
        timeZone: 'America/New_York',
      },
      retryLookup: 'automation-medication-reminder',
    },
    {
      expectedAt: '2026-03-08T07:30:00.000Z',
      failedLookup: 'automation-medication-reminder',
      failedTime: '02:30',
      referenceAt: '2026-03-08T04:59:00.000Z',
      responseLookup: 'medication-reminder',
      retryLocalAt: {
        date: '2026-03-08',
        time: '03:30',
        timeZone: 'America/New_York',
      },
      retryLookup: 'medication-reminder',
    },
    {
      expectedAt: '2026-03-08T07:30:00.000Z',
      failedLookup: 'medication-reminder',
      failedTime: '02:30',
      referenceAt: '2026-03-08T04:59:00.000Z',
      requestedSlug: 'morning-meds',
      responseLookup: 'morning-meds',
      retryLocalAt: {
        date: '2026-03-08',
        time: '03:30',
        timeZone: 'America/New_York',
      },
      retryLookup: 'medication-reminder',
    },
    {
      expectedAt: '2026-11-01T06:30:00.000Z',
      failedLookup: 'medication-reminder',
      failedTime: '01:30',
      referenceAt: '2026-11-01T03:59:00.000Z',
      requestedSlug: 'evening-meds',
      responseLookup: 'evening-meds',
      retryLocalAt: {
        date: '2026-11-01',
        fold: 'later' as const,
        time: '01:30',
        timeZone: 'America/New_York',
      },
      retryLookup: 'medication-reminder',
    },
  ])('clears a patch clarification across canonical and renamed aliases', {
    timeout: TURN_TIMEOUT_MS,
  }, async ({
    expectedAt,
    failedLookup,
    failedTime,
    referenceAt,
    requestedSlug,
    responseLookup,
    retryLocalAt,
    retryLookup,
  }) => {
    const scenario = await prepareScriptedTurnScenario()
    const responseCard = {
      kind: 'compact_table',
      version: 1,
      title: 'Medication reminder',
      subtitle: 'March 8 at 3:30 AM',
      rowHeader: 'Status',
      columns: ['Schedule'],
      rows: [{ label: 'Active', values: ['3:30 AM'] }],
      footer: null,
      tracking: null,
    } satisfies AssistantResponseCard
    const failedRequest = {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      lookup: failedLookup,
      ...(requestedSlug ? { slug: requestedSlug } : {}),
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: failedTime,
          timeZone: 'America/New_York',
        },
      },
    }
    const retryRequest = {
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      lookup: retryLookup,
      ...(requestedSlug ? { slug: requestedSlug } : {}),
      schedule: {
        kind: 'at',
        localAt: retryLocalAt,
      },
    }
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation(${JSON.stringify(failedRequest)});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation(${JSON.stringify(retryRequest)});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      {
        functionCall: {
          arguments: { card: responseCard },
          name: 'attach_response_card',
          namespace: 'murph',
        },
      },
      { text: 'CARD_ATTACHED' },
    )

    const automationRequest = vi.fn(async (
      request: AssistantHostedAutomationToolRequest,
    ) => {
      if (request.action !== 'patch') {
        throw new Error('Expected an automation patch request.')
      }
      return {
        action: 'patch' as const,
        automationId: 'automation-medication-reminder',
        created: false,
        effectiveTimeZone: 'America/New_York',
        lookupId: responseLookup,
        nextOccurrenceAt: expectedAt,
        routeBinding: 'current_conversation' as const,
        schedule: request.schedule ?? {
          at: expectedAt,
          kind: 'at' as const,
        },
        status: 'active' as const,
        timingVerified: true,
        updatedAt: '2026-03-08T05:01:00.000Z',
      }
    })
    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      automationRelativeDateReferenceWindow: {
        earliestAt: referenceAt,
        latestAt: referenceAt,
      },
      dynamicTools: [
        MURPH_AUTOMATION_TOOL,
        MURPH_ATTACH_RESPONSE_CARD_TOOL,
      ],
      groupConversation: false,
      hostedToolContext: {
        automationTool: { request: automationRequest },
        computerToolsAvailable: false,
        currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [],
        sendVaultFile: async () => {
          throw new Error('Vault file sends are unavailable in this test.')
        },
        vaultFileSendAvailable: false,
      },
      prompt: `Move my medication reminder to tomorrow at ${failedTime}.`,
    })

    expect(automationRequest).toHaveBeenCalledTimes(1)
    expect(automationRequest).toHaveBeenCalledWith({
      action: 'patch',
      expectedUpdatedAt: '2026-03-07T20:00:00.000Z',
      lookup: retryLookup,
      ...(requestedSlug ? { slug: requestedSlug } : {}),
      schedule: { at: expectedAt, kind: 'at' },
    }, expect.anything())
    expect(result.responseCard).toEqual(responseCard)
    expect(result.finalMessage).not.toContain('The trusted reminder date is')
    expect(result.transcriptMessage).not.toContain('The trusted reminder date is')
  })

  it('contains local one-shot slug failures and accepts a corrected retry', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const localizedRequest = {
      action: 'save',
      instructions: 'Send the reminder.',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '03:30',
          timeZone: 'America/New_York',
        },
      },
      title: '薬を飲む',
    }
    const correctedRequest = {
      ...localizedRequest,
      slug: 'take-medicine',
    }
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation(${JSON.stringify(localizedRequest)});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation(${JSON.stringify(correctedRequest)});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      { text: 'The reminder is set for March 8 at 3:30 AM.' },
    )

    const automationRequest = vi.fn(async (
      request: AssistantHostedAutomationToolRequest,
    ) => ({
      action: 'save' as const,
      automationId: 'automation-take-medicine',
      created: true,
      effectiveTimeZone: 'America/New_York',
      lookupId: 'take-medicine',
      nextOccurrenceAt: '2026-03-08T07:30:00.000Z',
      routeBinding: 'current_conversation' as const,
      schedule: request.action === 'save'
        ? request.schedule
        : { at: '2026-03-08T07:30:00.000Z', kind: 'at' as const },
      status: 'active' as const,
      timingVerified: true,
      updatedAt: '2026-03-08T05:01:00.000Z',
    }))
    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      hostedToolContext: {
        automationTool: { request: automationRequest },
        computerToolsAvailable: false,
        currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [],
        sendVaultFile: async () => {
          throw new Error('Vault file sends are unavailable in this test.')
        },
        vaultFileSendAvailable: false,
      },
      prompt: 'Remind me to take medicine on March 8 at 3:30 AM.',
    })

    expect(automationRequest).toHaveBeenCalledTimes(1)
    expect(result.finalMessage).toBe(
      'The reminder is set for March 8 at 3:30 AM.',
    )
    expect(result.transcriptMessage).toBe(result.finalMessage)
  })

  it('does not clear a pending DST clarification for an unrelated automation', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const automationRequests: AssistantHostedAutomationToolRequest[] = []
    const failedRequest = {
      action: 'save',
      instructions: 'Send the medication reminder tomorrow.',
      schedule: {
        kind: 'at',
        localAt: {
          relativeDay: 'tomorrow',
          time: '02:30',
          timeZone: 'America/New_York',
        },
      },
      title: 'Medication reminder',
    }
    const unrelatedRequest = {
      action: 'save',
      instructions: 'Send the breakfast reminder tomorrow.',
      schedule: {
        kind: 'at',
        localAt: {
          date: '2026-03-08',
          time: '04:00',
          timeZone: 'America/New_York',
        },
      },
      title: 'Breakfast reminder',
    }
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation(${JSON.stringify(failedRequest)});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation(${JSON.stringify(unrelatedRequest)});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      { text: 'The breakfast reminder is set for 4 AM on March 8.' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      automationRelativeDateReferenceWindow: {
        earliestAt: '2026-03-08T04:59:00.000Z',
        latestAt: '2026-03-08T04:59:00.000Z',
      },
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            if (request.action !== 'save') {
              throw new Error('Expected an automation save request.')
            }
            automationRequests.push(request)
            return {
              action: 'save',
              automationId: 'automation-breakfast-reminder',
              created: true,
              effectiveTimeZone: null,
              lookupId: 'breakfast-reminder',
              nextOccurrenceAt: '2026-03-08T08:00:00.000Z',
              routeBinding: 'current_conversation',
              schedule: request.schedule,
              status: 'active',
              timingVerified: true,
              updatedAt: '2026-03-08T05:01:00.000Z',
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
      prompt: 'Set two reminders for tomorrow.',
    })

    const requiredClarification =
      'The trusted reminder date is 2026-03-08. What other local time on 2026-03-08 should I use?'
    expect(automationRequests).toEqual([{
      action: 'save',
      instructions: 'Send the breakfast reminder tomorrow.',
      schedule: { at: '2026-03-08T08:00:00.000Z', kind: 'at' },
      title: 'Breakfast reminder',
    }])
    expect(result.finalMessage).toBe(
      `The breakfast reminder is set for 4 AM on March 8.\n\n${requiredClarification}`,
    )
    expect(result.transcriptMessage).toBe(result.finalMessage)
  })

  it('suppresses a response card until the trusted DST clarification is delivered', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const responseCard = {
      kind: 'compact_table',
      version: 1,
      title: 'Strength session',
      subtitle: null,
      rowHeader: 'Exercise',
      columns: ['Set 1'],
      rows: [{ label: 'Bench press', values: ['185 lb × 8'] }],
      footer: null,
      tracking: {
        kind: 'workout',
        entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
        snapshotAt: '2026-08-04T21:30:00.000Z',
      },
    } satisfies AssistantResponseCard
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation({
  action: "save",
  instructions: "Send the reminder tomorrow.",
  schedule: {
    kind: "at",
    localAt: {
      relativeDay: "tomorrow",
      time: "02:30",
      timeZone: "America/New_York",
    },
  },
  title: "Gap reminder",
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      {
        functionCall: {
          arguments: { card: responseCard },
          name: 'attach_response_card',
          namespace: 'murph',
        },
      },
      {
        text:
          '2:30 AM does not exist on 2026-03-08 because of daylight saving time.',
      },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      automationRelativeDateReferenceWindow: {
        earliestAt: '2026-03-08T04:59:00.000Z',
        latestAt: '2026-03-08T04:59:00.000Z',
      },
      dynamicTools: [
        MURPH_AUTOMATION_TOOL,
        MURPH_ATTACH_RESPONSE_CARD_TOOL,
      ],
      groupConversation: false,
      hostedToolContext: {
        automationTool: {
          request: async () => {
            throw new Error('DST clarification must not mutate an automation.')
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
      prompt: 'Show my workout and remind me tomorrow at 2:30 AM.',
    })

    const publicCardText =
      'Strength session\n\nBench press: Set 1: 185 lb × 8'
    const requiredClarification =
      'The trusted reminder date is 2026-03-08. What other local time on 2026-03-08 should I use?'
    const expectedDeliveredText = `${publicCardText}\n\n${requiredClarification}`
    expect(result.responseCard).toBeNull()
    expect(result.finalMessage).toBe(expectedDeliveredText)
    expect(result.transcriptMessage).toBe(expectedDeliveredText)
    expect(result.transcriptMessage).not.toContain('Murph tracked workout source')
  })

  it('overrides finish-without-reply when a trusted DST date must be clarified', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation({
  action: "save",
  instructions: "Send the reminder tomorrow.",
  schedule: {
    kind: "at",
    localAt: {
      relativeDay: "tomorrow",
      time: "02:30",
      timeZone: "America/New_York",
    },
  },
  title: "Gap reminder",
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      {
        functionCall: {
          arguments: {},
          name: 'finish_without_reply',
          namespace: 'murph',
        },
      },
      { text: '' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      allowFinishWithoutReply: true,
      automationRelativeDateReferenceWindow: {
        earliestAt: '2026-03-08T04:59:00.000Z',
        latestAt: '2026-03-08T04:59:00.000Z',
      },
      dynamicTools: [
        MURPH_AUTOMATION_TOOL,
        MURPH_FINISH_WITHOUT_REPLY_TOOL,
      ],
      hostedToolContext: {
        automationTool: {
          request: async () => {
            throw new Error('DST clarification must not mutate an automation.')
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
      prompt: 'Remind me tomorrow at 2:30 AM in New York.',
    })

    const requiredClarification =
      'The trusted reminder date is 2026-03-08. What other local time on 2026-03-08 should I use?'
    expect(result.finalAction).toBeNull()
    expect(result.finalActionExplicit).toBe(false)
    expect(result.finalMessage).toBe(requiredClarification)
    expect(result.transcriptMessage).toBe(requiredClarification)
  })

  it('keeps a live-steered relative reminder on its accepted delivery-context date', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const automationRequests: AssistantHostedAutomationToolRequest[] = []
    let steered: Promise<void> | null = null
    scenario.stub.queue(
      {
        delayMs: 2_000,
        text: 'STEER_REMINDER_FIRST_REPLY',
      },
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation({
  action: "save",
  instructions: "Send the reminder tonight.",
  schedule: {
    kind: "at",
    localAt: {
      relativeDay: "today",
      time: "23:20",
      timeZone: "Pacific/Honolulu",
    },
  },
  title: "Steered one-shot reminder",
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      { text: 'STEER_REMINDER_OK' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      automationRelativeDateReferenceWindow: {
        earliestAt: '2031-02-15T09:59:59.800Z',
        latestAt: '2031-02-15T09:59:59.800Z',
      },
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            if (request.action !== 'save') {
              throw new Error('Expected an automation save request.')
            }
            automationRequests.push(request)
            return {
              action: 'save',
              automationId: 'automation-steered-one-shot',
              created: true,
              effectiveTimeZone: null,
              lookupId: 'steered-one-shot-reminder',
              nextOccurrenceAt: '2031-02-15T09:20:00.000Z',
              routeBinding: 'current_conversation',
              schedule: {
                at: '2031-02-15T09:20:00.000Z',
                kind: 'at',
              },
              status: 'active',
              timingVerified: true,
              updatedAt: '2031-02-15T09:59:59.950Z',
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
      onLiveTurn: (turn: CodexAppServerLiveTurn) => {
        steered = delay(500).then(() =>
          turn.steer({
            prompt: 'Remind me tonight at 11:20 PM Honolulu time.',
            relativeDateReferenceWindow: {
              earliestAt: '2031-02-15T09:59:59.900Z',
              latestAt: '2031-02-15T09:59:59.900Z',
            },
          }))
      },
      prompt: 'Reply before I send another message.',
    })

    expect(steered).not.toBeNull()
    await steered
    expect(automationRequests).toEqual([{
      action: 'save',
      instructions: 'Send the reminder tonight.',
      schedule: {
        at: '2031-02-15T09:20:00.000Z',
        kind: 'at',
      },
      title: 'Steered one-shot reminder',
    }])
    expect(result.finalMessage).toBe('STEER_REMINDER_OK')
    expect(result.responseDeliveryContextOrdinal).toBe(1)
  })

  it('fails closed when a live-steered relative reminder spans local midnight', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const automationRequest = vi.fn(async () => {
      throw new Error('The ambiguous reminder must not reach the automation port.')
    })
    let steered: Promise<void> | null = null
    scenario.stub.queue(
      {
        delayMs: 2_000,
        text: 'STEER_MIDNIGHT_FIRST_REPLY',
      },
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation({
  action: "save",
  instructions: "Send the reminder tomorrow.",
  schedule: {
    kind: "at",
    localAt: {
      relativeDay: "tomorrow",
      time: "09:00",
      timeZone: "America/New_York",
    },
  },
  title: "Midnight-spanning reminder",
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      { text: 'STEER_MIDNIGHT_ASK_EXPLICIT_DATE' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      automationRelativeDateReferenceWindow: {
        earliestAt: '2031-07-15T03:59:59.900Z',
        latestAt: '2031-07-15T03:59:59.900Z',
      },
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      hostedToolContext: {
        automationTool: { request: automationRequest },
        computerToolsAvailable: false,
        currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [],
        sendVaultFile: async () => {
          throw new Error('Vault file sends are unavailable in this test.')
        },
        vaultFileSendAvailable: false,
      },
      onLiveTurn: (turn: CodexAppServerLiveTurn) => {
        steered = delay(500).then(() =>
          turn.steer({
            prompt: 'Actually, make it 10 AM.',
            relativeDateReferenceWindow: {
              earliestAt: '2031-07-15T04:00:00.100Z',
              latestAt: '2031-07-15T04:00:00.100Z',
            },
          }))
      },
      prompt: 'Remind me tomorrow at 9 AM New York time.',
    })

    expect(steered).not.toBeNull()
    await steered
    expect(automationRequest).not.toHaveBeenCalled()
    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
    expect(toolOutputs).toContain(
      'accepted messages span different calendar dates in that timezone',
    )
    expect(result.finalMessage).toBe('STEER_MIDNIGHT_ASK_EXPLICIT_DATE')
    expect(result.responseDeliveryContextOrdinal).toBe(1)
  })

  it('reports a reactivated stale one-shot as needing a new time', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const automationRequests: AssistantHostedAutomationToolRequest[] = []
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation({
  action: "patch",
  expectedUpdatedAt: "2026-08-10T00:00:00.000Z",
  lookup: "one-time-evening-reminder",
  status: "active",
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      {
        text: 'That reminder is active, but its requested time has already passed and is no longer deliverable. Tell me a new time and I can reschedule it.',
      },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions: buildScriptedHostedSystemPrompt('direct', true),
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            if (request.action !== 'patch') {
              throw new Error('Expected an automation patch request.')
            }
            automationRequests.push(request)
            return {
              action: 'patch',
              automationId: 'automation-one-time-evening',
              created: false,
              effectiveTimeZone: null,
              lookupId: 'one-time-evening-reminder',
              nextOccurrenceAt: null,
              routeBinding: 'preserved',
              schedule: {
                at: '2026-08-01T13:00:00.000Z',
                kind: 'at',
              },
              status: 'active',
              timingVerified: true,
              updatedAt: '2026-08-10T00:01:00.000Z',
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
      prompt: 'Reactivate my one-time evening reminder. Save the change now.',
    })

    expect(automationRequests).toEqual([{
      action: 'patch',
      expectedUpdatedAt: '2026-08-10T00:00:00.000Z',
      lookup: 'one-time-evening-reminder',
      status: 'active',
    }])
    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
      .replace(/\\"/gu, '"')
    expect(toolOutputs).toContain('"kind":"at"')
    expect(toolOutputs).toContain('"nextOccurrenceAt":null')
    expect(toolOutputs).toContain('"timingVerified":true')
    expect(result.finalMessage).toMatch(/already passed|no longer deliverable/iu)
    expect(result.finalMessage).toMatch(/new time|reschedule/iu)
  })

  it('does not describe an unverified stale recurrence as exhausted', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__automation({
  action: "patch",
  expectedUpdatedAt: "2026-08-10T00:00:00.000Z",
  instructions: "Send the revised daily interval reminder.",
  lookup: "daily-interval-reminder",
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      {
        text: 'The reminder wording was updated, but I could not verify its next occurrence. I can inspect or update the schedule if you want.',
      },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions: buildScriptedHostedSystemPrompt('direct', true),
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            if (request.action !== 'patch') {
              throw new Error('Expected an automation patch request.')
            }
            return {
              action: 'patch',
              automationId: 'automation-daily-interval',
              created: false,
              effectiveTimeZone: null,
              lookupId: 'daily-interval-reminder',
              nextOccurrenceAt: null,
              routeBinding: 'preserved',
              schedule: { everyMs: 86_400_000, kind: 'every' },
              status: 'active',
              timingVerified: false,
              updatedAt: '2026-08-10T00:01:00.000Z',
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
      prompt: 'Update the wording of my daily interval reminder now.',
    })

    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
      .replace(/\\"/gu, '"')
    expect(toolOutputs).toContain('"kind":"every"')
    expect(toolOutputs).toContain('"nextOccurrenceAt":null')
    expect(toolOutputs).toContain('"timingVerified":false')
    expect(result.finalMessage).toMatch(/could not verify/iu)
    expect(result.finalMessage).toMatch(/inspect|update/iu)
    expect(result.finalMessage).not.toMatch(
      /no (?:future|later) delivery|nothing (?:else )?(?:is )?scheduled/iu,
    )
  })

  it('keeps active device-triggered saves distinct from exhausted clock schedules', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const automationRequests: unknown[] = []
    const baseInstructions = buildScriptedHostedSystemPrompt('direct', true)
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const tool = ALL_TOOLS.find(({ name }) => name === "murph__automation");
if (!tool) {
  text(JSON.stringify({ found: false }));
} else {
  const result = await tools.murph__automation({
    action: "save",
    instructions: "Ask how the next workout felt.",
    schedule: {
      activityKind: "workout",
      after: "2026-08-10T12:00:00.000Z",
      kind: "deviceActivity",
      source: "whoop",
    },
    title: "Next workout check-in",
  });
  text(JSON.stringify({ found: true, result }));
}
`,
          name: 'exec',
        },
      },
      {
        text: "Saved. I'll check in after your next workout. There isn't a clock time to confirm until that workout arrives.",
      },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions,
      dynamicTools: [MURPH_AUTOMATION_TOOL],
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            if (request.action !== 'save') {
              throw new Error('Expected an automation save request.')
            }
            automationRequests.push(request)
            return {
              action: 'save',
              automationId: 'automation-next-workout',
              created: true,
              effectiveTimeZone: null,
              lookupId: 'next-workout-check-in',
              nextOccurrenceAt: null,
              routeBinding: 'current_conversation',
              schedule: request.schedule,
              status: 'active',
              timingVerified: true,
              updatedAt: '2026-08-08T12:00:00.000Z',
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
      prompt: 'After my next WHOOP workout, ask how it felt. Save it now.',
    })

    expect(automationRequests).toEqual([{
      action: 'save',
      instructions: 'Ask how the next workout felt.',
      schedule: {
        activityKind: 'workout',
        after: '2026-08-10T12:00:00.000Z',
        kind: 'deviceActivity',
        source: 'whoop',
      },
      title: 'Next workout check-in',
    }])
    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
      .replace(/\\"/gu, '"')
    expect(toolOutputs).toContain('"kind":"deviceActivity"')
    expect(toolOutputs).toContain('"nextOccurrenceAt":null')
    expect(toolOutputs).toContain('"timingVerified":true')
    expect(result.finalMessage).toContain('after your next workout')
    expect(result.finalMessage).not.toMatch(/no (?:future|later) delivery/iu)
  })

  it('preserves current response-card shapes and rejects legacy-only nutrition authoring through the real App Server boundary', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const completedWorkoutCard = {
      kind: 'compact_table',
      version: 1,
      title: 'Lower body strength',
      subtitle: null,
      footer: 'Workout completed.',
      tracking: {
        kind: 'workout',
        entityId: 'evt_01K1ABCDEFGHJKMNPQRSTVWXYZ',
        snapshotAt: '2026-08-09T19:45:00.000Z',
      },
      workout: {
        version: 1,
        state: 'completed',
        exercises: [
          'Dumbbell Single-Leg Romanian Deadlift',
          'Dumbbell Bulgarian Split Squat',
          'Dumbbell Walking Lunge in Place',
          'Split Squat with Front Heel Lift',
          'Dumbbell Reverse Lunge',
          'Dumbbell Step-Up',
        ].map((name) => ({
          name,
          sets: [
            ['55 lb × 8–10', '55 lb × 9'],
            ['55 lb × 10', '55 lb × 10'],
            ['65 lb × 10–12', '65 lb × 11'],
            ['65 lb × 12', '65 lb × 12'],
          ].map(([target, actual]) => ({
            status: 'completed' as const,
            target: target ?? null,
            actual: actual ?? null,
          })),
        })),
      },
    } satisfies AssistantResponseCard
    const cards = [
      {
        kind: 'compact_table',
        version: 1,
        title: 'Training sets',
        subtitle: null,
        rowHeader: 'Order',
        columns: ['Set', 'Reps'],
        rows: [
          { label: 'First', values: ['1', '8'] },
          { label: 'Second', values: ['2', '6'] },
        ],
        footer: null,
        tracking: null,
      },
      completedWorkoutCard,
      {
        kind: 'daily_nutrition',
        version: 2,
        localDate: '2026-08-08',
        mealCount: 2,
        totals: {
          calories: { total: 900, mealCount: 2 },
          proteinGrams: { total: 70, mealCount: 2 },
          carbsGrams: { total: 80, mealCount: 2 },
          fatGrams: { total: 30, mealCount: 2 },
          fiberGrams: { total: 15, mealCount: 2 },
        },
        goals: {
          calories: { target: 1_800, status: 'under_target' },
          proteinGrams: { target: 100, status: 'under_target' },
          carbsGrams: { target: 190, status: 'under_target' },
          fatGrams: { target: 55, status: 'under_target' },
          fiberGrams: { target: 25, status: 'under_target' },
        },
      },
    ] as const
    const completeNutritionCard = cards[2]

    for (const card of cards) {
      const scenario = await prepareScriptedTurnScenario()
      scenario.stub.captureProviderRequestDiagnostics()
      scenario.stub.queue(
        {
          functionCall: {
            arguments: { card },
            name: 'attach_response_card',
            namespace: 'murph',
          },
        },
        { text: 'CARD_ATTACHED' },
      )

      const result = await executeCodexAppServerTurn({
        ...scenario.turnInput,
        dynamicTools: [MURPH_ATTACH_RESPONSE_CARD_TOOL],
        groupConversation: false,
        prompt: 'Attach the requested synthetic response card.',
      })

      expect(
        scenario.stub.requestSummariesSinceBaseline()[0]
          ?.providerRequestDiagnostics,
      ).toMatchObject({
        includesResponseCardCompactTableShape: true,
        includesResponseCardNutritionV2Shape: true,
      })
      expect(result.runtimeIssueInputs).toEqual([])
      expect(result.responseCard).toEqual(card)
    }

    const incompleteNutritionCards = [
      {
        kind: 'daily_nutrition',
        localDate: '2026-08-08',
        mealCount: 2,
        totals: {
          calories: { total: 900, mealCount: 2 },
          proteinGrams: { total: 70, mealCount: 2 },
          carbsGrams: { total: 80, mealCount: 2 },
          fatGrams: { total: 30, mealCount: 2 },
        },
      },
      {
        ...completeNutritionCard,
        goals: {
          calories: null,
          proteinGrams: null,
          carbsGrams: null,
          fatGrams: null,
          fiberGrams: null,
        },
      },
      ...([
        'calories',
        'proteinGrams',
        'carbsGrams',
        'fatGrams',
        'fiberGrams',
      ] as const).map((metric) => ({
        ...completeNutritionCard,
        goals: {
          ...completeNutritionCard.goals,
          [metric]: null,
        },
      })),
    ]

    for (const card of incompleteNutritionCards) {
      const scenario = await prepareScriptedTurnScenario()
      scenario.stub.captureProviderRequestDiagnostics()
      scenario.stub.queue(
        {
          functionCall: {
            arguments: { card },
            name: 'attach_response_card',
            namespace: 'murph',
          },
        },
        { text: 'INCOMPLETE_CARD_REJECTED' },
      )

      const result = await executeCodexAppServerTurn({
        ...scenario.turnInput,
        dynamicTools: [MURPH_ATTACH_RESPONSE_CARD_TOOL],
        groupConversation: false,
        prompt: 'Try the requested synthetic response card.',
      })

      expect(result.responseCard).toBeNull()
      expect(result.runtimeIssueInputs).toEqual([
        expect.objectContaining({
          component: 'assistant.tool-validation',
          errorCode: 'TOOL_INPUT_SCHEMA_REJECTION',
          issueKind: 'schema_rejection',
          operation: 'murph.attach_response_card',
        }),
        expect.objectContaining({
          component: 'assistant.codex-action',
          errorCode: 'CODEX_DYNAMIC_TOOL_CALL_FAILED',
          issueKind: 'tool_error',
          operation: 'dynamic.tool.call',
        }),
      ])
      expect(result.finalMessage).toBe('INCOMPLETE_CARD_REJECTED')
    }
  })

  it('proves complete Goal and safety discovery before nutrition targets and cards', {
    timeout: 720_000,
  }, async () => {
    const activeListCommand =
      'goal list --status active --limit 200 --format json'
    const visibleGoalShowCommand =
      'goal show goal_visible_bundle --format json'
    const hiddenGoalShowCommand =
      'goal show goal_hidden_conflict --format json'
    const memoryCommand = 'memory show --format json'
    const conditionListCommand =
      'condition list --status active --limit 200 --format json'
    const regimenListCommand =
      'regimen list --status active --limit 200 --format json'
    const measurementCommand =
      'measurement entry list --metric bmi --metric height --metric weight --metric body-weight --from 2026-06-15 --to 2026-07-30 --limit 200 --format json'
    const pregnancyMeasurementCommand =
      'measurement entry list --metric pregnancy-test --from 2025-10-03 --to 2026-07-30 --limit 200 --format json'
    const testEventListCommand =
      'event list --kind test --from 2025-10-03 --to 2026-07-30 --limit 200 --format json'
    const procedureListCommand =
      'event list --kind procedure --limit 200 --format json'
    const encounterListCommand =
      'event list --kind encounter --limit 200 --format json'
    const totalsCommand =
      'meal totals --from 2026-07-30 --to 2026-07-30 --format json'

    const pointTarget = (
      id: string,
      metric: string,
      unit: string,
      value: number,
    ) => ({
      evaluation: {
        comparator: 'between',
        highValue: value,
        kind: 'selected-value',
        value,
      },
      id,
      kind: 'metric',
      metric,
      unit,
    })
    const completeTargets = [
      pointTarget('target_calories', 'dietary-calories', 'kcal', 1_800),
      pointTarget('target_protein', 'protein-grams', 'g', 140),
      pointTarget('target_carbs', 'carbs-grams', 'g', 190),
      pointTarget('target_fat', 'fat-grams', 'g', 55),
      pointTarget('target_fiber', 'fiber-grams', 'g', 25),
    ]
    const visibleGoal = {
      entity: {
        data: {
          metricTargets: completeTargets,
          status: 'active',
          windowStartAt: '2026-07-01',
        },
        id: 'goal_visible_bundle',
        kind: 'goal',
        title: 'Plan A',
      },
      vault: 'synthetic-vault',
    }
    const hiddenGoal = {
      entity: {
        data: {
          metricTargets: [
            pointTarget(
              'target_hidden_calories',
              'dietary-calories',
              'kcal',
              1_100,
            ),
          ],
          status: 'active',
          windowStartAt: '2026-07-01',
        },
        id: 'goal_hidden_conflict',
        kind: 'goal',
        title: 'Plan L',
      },
      vault: 'synthetic-vault',
    }
    const conflictItems = Array.from({ length: 12 }, (_, index) => {
      const itemNumber = index + 1
      const id = index === 0
        ? 'goal_visible_bundle'
        : index === 11
          ? 'goal_hidden_conflict'
          : `goal_opaque_${itemNumber}`
      return {
        data: {
          metricTargetsCount: index === 0 ? 5 : index === 11 ? 1 : 0,
          status: 'active',
        },
        id,
        kind: 'goal',
        title: `Plan ${itemNumber}`,
      }
    })
    const conflictList = {
      count: conflictItems.length,
      filters: { limit: 200, status: 'active' },
      items: conflictItems,
      nextCursor: null,
      vault: 'synthetic-vault',
    }
    const saturatedItems = Array.from({ length: 200 }, (_, index) => ({
      data: {
        metricTargetsCount: index % 17 === 0 ? 1 : 0,
        status: 'active',
      },
      id: `goal_saturated_${index + 1}`,
      kind: 'goal',
      title: `Plan ${index + 1}`,
    }))
    const saturatedList = {
      count: saturatedItems.length,
      filters: { limit: 200, status: 'active' },
      items: saturatedItems,
      nextCursor: null,
      vault: 'synthetic-vault',
    }
    const completeList = {
      count: 1,
      filters: { limit: 200, status: 'active' },
      items: [conflictItems[0]],
      nextCursor: null,
      vault: 'synthetic-vault',
    }
    const safeMeasurements = {
      count: 0,
      filters: {
        from: '2026-06-15',
        limit: 200,
        metric: ['bmi', 'height', 'weight', 'body-weight'],
        to: '2026-07-30',
      },
      items: [],
      nextCursor: null,
      vault: 'synthetic-vault',
    }
    const memoryResult = (
      records: readonly { section: string; text: string }[],
    ) => ({
      document: {
        records: records.map((record, index) => ({
          ...record,
          id: `memory_record_${index + 1}`,
          updatedAt: '2026-07-29T12:00:00.000Z',
        })),
      },
      memory: null,
      vault: 'synthetic-vault',
    })
    const adultMemory = memoryResult([{
      section: 'Identity',
      text: 'Age: 34',
    }])
    const minorMemory = memoryResult([{
      section: 'Identity',
      text: 'Age: 16',
    }])
    const numberSensitiveMemory = memoryResult([{
      section: 'Preferences',
      text: 'Avoid calorie and macro numbers; use an intuitive-eating approach.',
    }])
    const measurementResult = (
      items: readonly Record<string, unknown>[],
    ) => ({
      count: items.length,
      filters: {
        from: '2026-06-15',
        limit: 200,
        metric: ['bmi', 'height', 'weight', 'body-weight'],
        to: '2026-07-30',
      },
      items,
      nextCursor: null,
      vault: 'synthetic-vault',
    })
    const pregnancyMeasurementResult = (
      items: readonly Record<string, unknown>[],
    ) => ({
      count: items.length,
      filters: {
        from: '2025-10-03',
        limit: 200,
        metric: ['pregnancy-test'],
        to: '2026-07-30',
      },
      items,
      nextCursor: null,
      vault: 'synthetic-vault',
    })
    const lowBmiMeasurements = measurementResult([{
      eventId: 'event_low_bmi',
      metric: 'bmi',
      occurredAt: '2026-07-29T12:00:00.000Z',
      unit: 'kg/m^2',
      value: 16.8,
    }])
    const lowSameEventMeasurements = measurementResult([
      {
        eventId: 'event_low_pair',
        metric: 'height',
        occurredAt: '2026-07-29T12:00:00.000Z',
        unit: 'cm',
        value: 180,
      },
      {
        eventId: 'event_low_pair',
        metric: 'weight',
        occurredAt: '2026-07-29T12:00:00.000Z',
        unit: 'kg',
        value: 54,
      },
    ])
    const normalBmiMeasurements = measurementResult([{
      eventId: 'event_normal_bmi',
      metric: 'bmi',
      occurredAt: '2026-07-29T12:00:00.000Z',
      unit: 'kg/m^2',
      value: 22.1,
    }])
    const saturatedMeasurements = measurementResult(
      Array.from({ length: 200 }, (_, index) => ({
        eventId: `event_height_only_${index + 1}`,
        metric: 'height',
        occurredAt: `2026-07-${String(29 - (index % 20)).padStart(2, '0')}T12:00:00.000Z`,
        unit: 'cm',
        value: 180,
      })),
    )
    const noPregnancyMeasurements = pregnancyMeasurementResult([])
    const negativePregnancyMeasurements = pregnancyMeasurementResult([{
      eventId: 'event_negative_pregnancy_test',
      measurementIndex: 0,
      metric: 'pregnancy-test',
      occurredAt: '2026-07-29T12:00:00.000Z',
      qualifiers: { result: 'negative' },
      recordKind: 'measurement',
      source: 'device',
      unit: 'result',
      value: 0,
    }])
    const ambiguousPregnancyMeasurements = pregnancyMeasurementResult([{
      eventId: 'event_ambiguous_pregnancy_test',
      measurementIndex: 0,
      metric: 'pregnancy-test',
      occurredAt: '2026-07-29T12:00:00.000Z',
      qualifiers: { result: 'indeterminate' },
      recordKind: 'measurement',
      source: 'device',
      unit: 'result',
      value: 1,
    }])
    const positivePregnancyMeasurements = pregnancyMeasurementResult([{
      eventId: 'event_positive_pregnancy_test',
      measurementIndex: 0,
      metric: 'pregnancy-test',
      occurredAt: '2026-07-28T12:00:00.000Z',
      qualifiers: { result: 'positive' },
      recordKind: 'measurement',
      source: 'device',
      unit: 'result',
      value: 1,
    }])
    const laterNegativeAfterPositiveMeasurements = pregnancyMeasurementResult([
      {
        eventId: 'event_later_negative_pregnancy_test',
        measurementIndex: 0,
        metric: 'pregnancy-test',
        occurredAt: '2026-07-29T12:00:00.000Z',
        qualifiers: { result: 'negative' },
        recordKind: 'measurement',
        source: 'device',
        unit: 'result',
        value: 0,
      },
      positivePregnancyMeasurements.items[0]!,
    ])
    const saturatedPregnancyMeasurements = pregnancyMeasurementResult(
      Array.from({ length: 200 }, (_, index) => ({
        eventId: `event_negative_pregnancy_test_${index + 1}`,
        measurementIndex: 0,
        metric: 'pregnancy-test',
        occurredAt: `2026-07-${String(29 - (index % 20)).padStart(2, '0')}T12:00:00.000Z`,
        qualifiers: { result: 'negative' },
        recordKind: 'measurement',
        source: 'device',
        unit: 'result',
        value: 0,
      })),
    )
    const testEventListResult = (
      items: readonly Record<string, unknown>[],
    ) => ({
      count: items.length,
      filters: {
        experiment: null,
        from: '2025-10-03',
        kind: 'test',
        limit: 200,
        tag: [],
        to: '2026-07-30',
      },
      items,
      nextCursor: null,
      vault: 'synthetic-vault',
    })
    const testEventItem = (
      id: string,
      testName: string,
      resultStatus: string,
      resultsCount: number,
    ) => ({
      data: {
        resultStatus,
        ...(resultsCount === 0 ? {} : { resultsCount }),
        testName,
      },
      id,
      kind: 'blood_test',
      occurredAt: '2026-07-28T12:00:00.000Z',
      title: 'Structured clinical result',
    })
    const testEventDetail = (input: {
      id: string
      resultStatus: string
      results?: readonly Record<string, unknown>[]
      summary?: string
      testName: string
    }) => ({
      entity: {
        data: {
          resultStatus: input.resultStatus,
          ...(input.results ? { results: input.results } : {}),
          ...(input.summary ? { summary: input.summary } : {}),
          testName: input.testName,
        },
        id: input.id,
        kind: 'blood_test',
        occurredAt: '2026-07-28T12:00:00.000Z',
        title: 'Structured clinical result',
      },
      vault: 'synthetic-vault',
    })
    const noTestEvents = testEventListResult([])
    const positivePregnancyTestEventId =
      'event_positive_structured_pregnancy_test'
    const positivePregnancyTestEvents = testEventListResult([
      testEventItem(
        positivePregnancyTestEventId,
        'serum_hcg_qualitative',
        'unknown',
        0,
      ),
    ])
    const positivePregnancyTestEventDetail = testEventDetail({
      id: positivePregnancyTestEventId,
      resultStatus: 'unknown',
      summary: 'Pregnancy test: positive',
      testName: 'serum_hcg_qualitative',
    })
    const negativePregnancyTestEventId =
      'event_negative_structured_pregnancy_test'
    const negativePregnancyTestEvents = testEventListResult([
      testEventItem(
        negativePregnancyTestEventId,
        'urine_pregnancy_test',
        'normal',
        1,
      ),
    ])
    const negativePregnancyTestEventDetail = testEventDetail({
      id: negativePregnancyTestEventId,
      resultStatus: 'normal',
      results: [{ analyte: 'Pregnancy test', textValue: 'Negative' }],
      summary: 'Pregnancy test: negative',
      testName: 'urine_pregnancy_test',
    })
    const pendingPregnancyTestEventId =
      'event_pending_structured_pregnancy_test'
    const pendingPregnancyTestEvents = testEventListResult([
      testEventItem(
        pendingPregnancyTestEventId,
        'urine_pregnancy_test',
        'pending',
        1,
      ),
    ])
    const pendingPregnancyTestEventDetail = testEventDetail({
      id: pendingPregnancyTestEventId,
      resultStatus: 'pending',
      results: [{ analyte: 'Pregnancy test', textValue: 'Positive' }],
      summary: 'Preliminary pregnancy test: positive',
      testName: 'urine_pregnancy_test',
    })
    const numericHcgTestEventId = 'event_numeric_hcg_result'
    const unrelatedTestEventId = 'event_unrelated_strep_result'
    const ambiguousHcgTestEventId = 'event_ambiguous_hcg_result'
    const negatedHcgTestEventId = 'event_negated_hcg_result'
    const numericAndUnrelatedTestEvents = testEventListResult([
      testEventItem(
        numericHcgTestEventId,
        'quantitative_hcg',
        'unknown',
        1,
      ),
      testEventItem(
        unrelatedTestEventId,
        'rapid_strep_test',
        'unknown',
        1,
      ),
      testEventItem(
        ambiguousHcgTestEventId,
        'serum_hcg_qualitative',
        'unknown',
        1,
      ),
      testEventItem(
        negatedHcgTestEventId,
        'serum_hcg_qualitative',
        'unknown',
        1,
      ),
    ])
    const numericHcgTestEventDetail = testEventDetail({
      id: numericHcgTestEventId,
      resultStatus: 'unknown',
      results: [{
        analyte: 'beta hCG',
        unit: 'mIU/mL',
        value: 86,
      }],
      summary: 'Quantitative result available',
      testName: 'quantitative_hcg',
    })
    const unrelatedTestEventDetail = testEventDetail({
      id: unrelatedTestEventId,
      resultStatus: 'unknown',
      results: [{ analyte: 'Strep A', textValue: 'Negative' }],
      summary: 'No strep detected',
      testName: 'rapid_strep_test',
    })
    const ambiguousHcgTestEventDetail = testEventDetail({
      id: ambiguousHcgTestEventId,
      resultStatus: 'unknown',
      results: [{ analyte: 'hCG qualitative', textValue: 'Equivocal' }],
      summary: 'Pregnancy status cannot be determined',
      testName: 'serum_hcg_qualitative',
    })
    const negatedHcgTestEventDetail = testEventDetail({
      id: negatedHcgTestEventId,
      resultStatus: 'unknown',
      results: [{ analyte: 'hCG qualitative', textValue: 'Not detected' }],
      summary: 'Pregnancy test: not detected',
      testName: 'serum_hcg_qualitative',
    })
    const saturatedTestEvents = testEventListResult(
      Array.from({ length: 200 }, (_, index) =>
        testEventItem(
          `event_unrelated_test_${index + 1}`,
          `unrelated_test_${index + 1}`,
          'normal',
          0,
        )),
    )
    const procedureListResult = (
      items: readonly Record<string, unknown>[],
    ) => ({
      count: items.length,
      filters: {
        experiment: null,
        from: null,
        kind: 'procedure',
        limit: 200,
        tag: [],
        to: null,
      },
      items,
      nextCursor: null,
      vault: 'synthetic-vault',
    })
    const procedureItem = (
      id: string,
      procedure: string,
      status: string,
    ) => ({
      data: { procedure, status },
      id,
      kind: 'procedure',
      occurredAt: '2024-03-14T10:00:00.000Z',
      title: procedure,
    })
    const noProcedures = procedureListResult([])
    const completedBariatricProcedures = procedureListResult([
      procedureItem(
        'event_completed_bariatric_procedure',
        'Roux-en-Y gastric bypass',
        'completed',
      ),
    ])
    const plannedBariatricProcedureWithoutListStatus = procedureListResult([{
      data: { procedure: 'gastric sleeve' },
      id: 'event_planned_bariatric_procedure',
      kind: 'procedure',
      occurredAt: '2026-09-14T10:00:00.000Z',
      title: 'Planned gastric sleeve',
    }])
    const plannedBariatricProcedureDetail = {
      entity: {
        data: {
          procedure: 'gastric sleeve',
          status: 'planned',
        },
        id: 'event_planned_bariatric_procedure',
        kind: 'procedure',
        occurredAt: '2026-09-14T10:00:00.000Z',
        title: 'Planned gastric sleeve',
      },
      vault: 'synthetic-vault',
    }
    const saturatedProcedures = procedureListResult(
      Array.from({ length: 200 }, (_, index) =>
        procedureItem(
          `event_procedure_${index + 1}`,
          `Unrelated procedure ${index + 1}`,
          'completed',
        )),
    )
    const encounterListResult = (
      items: readonly Record<string, unknown>[],
    ) => ({
      count: items.length,
      filters: {
        experiment: null,
        from: null,
        kind: 'encounter',
        limit: 200,
        tag: [],
        to: null,
      },
      items,
      nextCursor: null,
      vault: 'synthetic-vault',
    })
    const encounterItem = (
      id: string,
      diagnosesCount: number,
    ) => ({
      data: {
        encounterType: 'office_visit',
        ...(diagnosesCount === 0 ? {} : { diagnosesCount }),
      },
      id,
      kind: 'encounter',
      occurredAt: '2026-07-14T10:00:00.000Z',
      title: 'Clinical visit',
    })
    const encounterDetail = (
      id: string,
      diagnoses: readonly Record<string, unknown>[],
    ) => ({
      entity: {
        data: {
          diagnoses,
          encounterType: 'office_visit',
        },
        id,
        kind: 'encounter',
        occurredAt: '2026-07-14T10:00:00.000Z',
        title: 'Clinical visit',
      },
      vault: 'synthetic-vault',
    })
    const noEncounters = encounterListResult([])
    const encountersWithoutDiagnoses = encounterListResult([
      encounterItem('event_encounter_without_diagnoses', 0),
    ])
    const activeKidneyEncounterId = 'event_encounter_active_kidney_diagnosis'
    const activeKidneyEncounters = encounterListResult([
      encounterItem(activeKidneyEncounterId, 1),
    ])
    const activeKidneyEncounterDetail = encounterDetail(
      activeKidneyEncounterId,
      [{
        certainty: 'documented',
        code: 'N18.30',
        codeSystem: 'ICD-10-CM',
        status: 'active',
        text: 'Chronic kidney disease stage 3',
      }],
    )
    const unresolvedKidneyEncounterId =
      'event_encounter_unresolved_kidney_diagnosis'
    const unresolvedKidneyEncounters = encounterListResult([
      encounterItem(unresolvedKidneyEncounterId, 1),
    ])
    const unresolvedKidneyEncounterDetail = encounterDetail(
      unresolvedKidneyEncounterId,
      [{
        certainty: 'unknown',
        status: 'unknown',
        text: 'Chronic kidney disease',
      }],
    )
    const nonCurrentEncounterId = 'event_encounter_non_current_diagnoses'
    const nonCurrentEncounters = encounterListResult([
      encounterItem(nonCurrentEncounterId, 6),
    ])
    const nonCurrentEncounterDetail = encounterDetail(
      nonCurrentEncounterId,
      [
        {
          certainty: 'documented',
          status: 'inactive',
          text: 'Chronic kidney disease',
        },
        {
          certainty: 'documented',
          status: 'resolved',
          text: 'Heart disease',
        },
        {
          certainty: 'documented',
          status: 'history',
          text: 'Liver disease',
        },
        {
          certainty: 'suspected',
          status: 'rule_out',
          text: 'Endocrine disease',
        },
        {
          certainty: 'ruled_out',
          status: 'active',
          text: 'Eating disorder',
        },
        {
          certainty: 'documented',
          status: 'active',
          text: 'Seasonal allergies',
        },
      ],
    )
    const saturatedEncounters = encounterListResult(
      Array.from({ length: 200 }, (_, index) =>
        encounterItem(`event_encounter_${index + 1}`, 0)),
    )
    const canonicalTotals = {
      from: '2026-07-30',
      mealCount: 3,
      metrics: {
        calories: { mealCount: 3, total: 1_760 },
        carbsGrams: { mealCount: 3, total: 185 },
        fatGrams: { mealCount: 3, total: 54 },
        fiberGrams: { mealCount: 3, total: 24 },
        proteinGrams: { mealCount: 3, total: 137 },
      },
      to: '2026-07-30',
      vault: 'synthetic-vault',
    }
    const eligibleCard = {
      goals: {
        calories: { status: 'on_target', target: 1_800 },
        carbsGrams: { status: 'on_target', target: 190 },
        fatGrams: { status: 'on_target', target: 55 },
        fiberGrams: { status: 'on_target', target: 25 },
        proteinGrams: { status: 'on_target', target: 140 },
      },
      kind: 'daily_nutrition',
      localDate: '2026-07-30',
      mealCount: 3,
      totals: canonicalTotals.metrics,
      version: 2,
    }

    const runCase = async (input: {
      card?: Record<string, unknown>
      commandOutputs: readonly (readonly [string, unknown])[]
      expectedCommands: readonly string[]
      failedCommands?: readonly string[]
      finalMessage: string
      prompt: string
      scheduled: boolean
      snapshotPrompt?: string
      skillReadCommands: readonly string[]
      skillSlugs: readonly string[]
    }) => {
      const scenario = await prepareScriptedTurnScenario()
      scenario.stub.resetQueue()
      const skillsRoot = path.join(
        scenario.turnInput.workingDirectory,
        'skills',
      )
      await mkdir(skillsRoot, { recursive: true })
      await Promise.all(input.skillSlugs.map((slug) =>
        cp(
          path.join(resolveAssistantSkillsRoot(), slug),
          path.join(skillsRoot, slug),
          { recursive: true },
        )))
      const commandLog = path.join(
        scenario.turnInput.workingDirectory,
        'nutrition-goal-discovery-commands.log',
      )
      await writeFile(commandLog, '', 'utf8')
      const scriptedCommands = new Set([
        ...input.commandOutputs.map(([command]) => command),
        ...(input.failedCommands ?? []),
      ])
      for (const command of input.expectedCommands) {
        if (!scriptedCommands.has(command)) {
          throw new Error(`Missing scripted fixture for ${command}.`)
        }
      }
      await writeFile(
        path.join(
          scenario.turnInput.workingDirectory,
          'run-nutrition-discovery',
        ),
        [
          '#!/bin/sh',
          'set -eu',
          ...input.expectedCommands.map(
            (command) =>
              `printf '%s\\n' ${quotePosixShellLiteral(command)} >> ${quotePosixShellLiteral(commandLog)}`,
          ),
          '',
        ].join('\n'),
        { encoding: 'utf8', mode: 0o755 },
      )

      const responses: ScriptedResponse[] = []
      if (input.expectedCommands.length > 0) {
        responses.push({
          customToolCall: {
            input: `
const result = await tools.exec_command({
  cmd: "./run-nutrition-discovery",
  yield_time_ms: 30000,
});
text(result.output);
`,
            name: 'exec',
          },
        })
        for (let waitAttempt = 0; waitAttempt < 4; waitAttempt += 1) {
          responses.push({
            functionCall: {
              arguments: {
                cell_id: '1',
                yield_time_ms: 30_000,
              },
              name: 'wait',
            },
            requestIncludes: ['Script running with cell ID 1'],
          })
        }
      }
      if (input.card) {
        responses.push({
          functionCall: {
            arguments: { card: input.card },
            name: 'attach_response_card',
            namespace: 'murph',
          },
        })
      }
      responses.push({ text: input.finalMessage })
      scenario.stub.queue(...responses)

      try {
        const result = await executeCodexAppServerTurn({
          ...scenario.turnInput,
          baseInstructions: buildScriptedHostedSystemPrompt(
            'direct',
            false,
            input.scheduled ? '2026-07-30T21:00:00.000-04:00' : undefined,
            input.snapshotPrompt,
          ),
          dynamicTools: [MURPH_ATTACH_RESPONSE_CARD_TOOL],
          env: {
            ...scenario.turnInput.env,
            [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: skillsRoot,
          },
          groupConversation: false,
          prompt: input.prompt,
          sandbox: 'danger-full-access',
        })
        const commandLogText = (await readFile(commandLog, 'utf8')).trim()
        const commands = commandLogText === '' ? [] : commandLogText.split('\n')
        expect(commands).toEqual(input.expectedCommands)
        expect(result.responseCard).toEqual(input.card ?? null)
        if (input.card) {
          expect(result.finalMessage).toContain(
            'Targets: 1,800 calories (on target)',
          )
          expect(result.finalMessage).toContain('25g fiber (on target).')
          expect(result.finalMessage).not.toContain(input.finalMessage)
        } else {
          expect(result.finalMessage).toBe(input.finalMessage)
        }
      } finally {
        await stopWarmCodexAppServer()
      }
    }

    const scheduledSkillReads = [
      "sed -n '1,320p' skills/automatic-meal-capture/SKILL.md",
      "sed -n '1,280p' skills/nutrition-strategy/references/daily-nutrition-card-safety.md",
    ]
    const scheduledProposalSkillReads = [
      ...scheduledSkillReads,
      "sed -n '1,320p' skills/nutrition-strategy/references/daily-nutrition-card-goals.md",
    ]
    const interactiveSkillReads = [
      "sed -n '1,180p' skills/food-journal/SKILL.md",
      "sed -n '1,280p' skills/nutrition-strategy/references/daily-nutrition-card-safety.md",
      "sed -n '1,320p' skills/nutrition-strategy/references/daily-nutrition-card-goals.md",
    ]
    const conflictOutputs = [
      [activeListCommand, conflictList],
      [visibleGoalShowCommand, visibleGoal],
      [hiddenGoalShowCommand, hiddenGoal],
    ] as const
    const conflictCommands = [
      activeListCommand,
      visibleGoalShowCommand,
      hiddenGoalShowCommand,
    ]

    await runCase({
      commandOutputs: conflictOutputs,
      expectedCommands: conflictCommands,
      finalMessage: 'Closeout saved without a goal card because active targets conflict.',
      prompt: [
        'Scheduled automatic meal closeout for the 2026-07-30 occurrence.',
        'The visible context suggests one complete bundle, but canonical state has more than ten active Goals.',
        'Follow the scheduled skill, resolve card authority, and fail closed on any hidden conflict.',
      ].join(' '),
      scheduled: true,
      skillReadCommands: scheduledSkillReads,
      skillSlugs: ['automatic-meal-capture', 'nutrition-strategy'],
    })
    await runCase({
      commandOutputs: conflictOutputs,
      expectedCommands: conflictCommands,
      finalMessage: 'I found conflicting active targets, so I did not attach a card.',
      prompt: [
        'Show my daily nutrition card for 2026-07-30.',
        'The visible context suggests one complete bundle, but canonical state has more than ten active Goals.',
      ].join(' '),
      scheduled: false,
      skillReadCommands: interactiveSkillReads,
      skillSlugs: ['food-journal', 'nutrition-strategy'],
    })
    await runCase({
      commandOutputs: [[activeListCommand, saturatedList]],
      expectedCommands: [activeListCommand],
      finalMessage: 'Closeout saved without a goal card because the active Goal read was saturated.',
      prompt: [
        'Scheduled automatic meal closeout for the 2026-07-30 occurrence.',
        'Resolve the requested goal-aware card, but fail closed if canonical Goal discovery is saturated.',
      ].join(' '),
      scheduled: true,
      skillReadCommands: scheduledSkillReads,
      skillSlugs: ['automatic-meal-capture', 'nutrition-strategy'],
    })

    const controlOutputs = [
      [activeListCommand, completeList],
      [visibleGoalShowCommand, visibleGoal],
      [memoryCommand, adultMemory],
      [conditionListCommand, {
        count: 0,
        filters: { limit: 200, status: 'active' },
        items: [],
        nextCursor: null,
        vault: 'synthetic-vault',
      }],
      [regimenListCommand, {
        count: 0,
        filters: { limit: 200, status: 'active' },
        items: [],
        nextCursor: null,
        vault: 'synthetic-vault',
      }],
      [procedureListCommand, noProcedures],
      [encounterListCommand, noEncounters],
      [measurementCommand, safeMeasurements],
      [pregnancyMeasurementCommand, noPregnancyMeasurements],
      [testEventListCommand, noTestEvents],
      [totalsCommand, canonicalTotals],
    ] as const
    const controlCommands = [
      activeListCommand,
      visibleGoalShowCommand,
      memoryCommand,
      conditionListCommand,
      regimenListCommand,
      procedureListCommand,
      encounterListCommand,
      measurementCommand,
      pregnancyMeasurementCommand,
      testEventListCommand,
      totalsCommand,
    ]
    for (const control of [
      {
        prompt: 'Run the scheduled automatic meal closeout and attach the eligible 2026-07-30 goal-aware card.',
        scheduled: true,
        skillReadCommands: scheduledSkillReads,
        skillSlugs: ['automatic-meal-capture', 'nutrition-strategy'],
      },
      {
        prompt: 'Show my eligible daily nutrition card for 2026-07-30.',
        scheduled: false,
        skillReadCommands: interactiveSkillReads,
        skillSlugs: ['food-journal', 'nutrition-strategy'],
      },
    ]) {
      await runCase({
        card: eligibleCard,
        commandOutputs: controlOutputs,
        expectedCommands: controlCommands,
        finalMessage: 'CARD_ATTACHED_AFTER_COMPLETE_GOAL_READ',
        ...control,
      })
    }

    const listResult = (
      kind: 'condition' | 'regimen',
      ids: readonly string[],
    ) => ({
      count: ids.length,
      filters: { limit: 200, status: 'active' },
      items: ids.map((id, index) => ({
        data: kind === 'condition'
          ? { clinicalStatus: 'active' }
          : { status: 'active' },
        id,
        kind,
        title: `${kind === 'condition' ? 'Condition' : 'Regimen'} ${index + 1}`,
      })),
      nextCursor: null,
      vault: 'synthetic-vault',
    })
    const detailResult = (input: {
      contraindication?: 'glucose-lowering-medication' | 'kidney-disease'
      id: string
      kind: 'condition' | 'regimen'
    }) => ({
      entity: {
        data: input.kind === 'condition'
          ? {
              clinicalStatus: 'active',
              slug: input.contraindication === 'kidney-disease'
                ? 'chronic-kidney-disease'
                : `benign-condition-${input.id}`,
            }
          : {
              kind: 'medication',
              status: 'active',
              substance: input.contraindication === 'glucose-lowering-medication'
                ? 'insulin'
                : `benign-medication-${input.id}`,
            },
        id: input.id,
        kind: input.kind,
        title: input.contraindication === 'kidney-disease'
          ? 'Chronic kidney disease'
          : input.contraindication === 'glucose-lowering-medication'
            ? 'Basal insulin'
            : `Benign ${input.kind}`,
      },
      vault: 'synthetic-vault',
    })
    const conditionIds = Array.from(
      { length: 6 },
      (_, index) => `condition_active_${index + 1}`,
    )
    const regimenIds = Array.from(
      { length: 6 },
      (_, index) => `regimen_active_${index + 1}`,
    )
    const completeSafetyOutputs = (input: {
      hiddenCondition?: boolean
      hiddenRegimen?: boolean
    }): readonly (readonly [string, unknown])[] => [
      [conditionListCommand, listResult('condition', conditionIds)],
      [regimenListCommand, listResult('regimen', regimenIds)],
      ...conditionIds.map((id, index) => [
        `condition show ${id} --format json`,
        detailResult({
          contraindication: input.hiddenCondition && index === 5
            ? 'kidney-disease'
            : undefined,
          id,
          kind: 'condition',
        }),
      ] as const),
      ...regimenIds.map((id, index) => [
        `regimen show ${id} --format json`,
        detailResult({
          contraindication: input.hiddenRegimen && index === 5
            ? 'glucose-lowering-medication'
            : undefined,
          id,
          kind: 'regimen',
        }),
      ] as const),
    ]
    const completeSafetyCommands = [
      conditionListCommand,
      regimenListCommand,
      ...conditionIds.map((id) => `condition show ${id} --format json`),
      ...regimenIds.map((id) => `regimen show ${id} --format json`),
    ]
    const emptySafetyOutputs = [
      [conditionListCommand, listResult('condition', [])],
      [regimenListCommand, listResult('regimen', [])],
    ] as const
    const emptySafetyCommands = [conditionListCommand, regimenListCommand]
    const hiddenSnapshot = (kind: 'condition' | 'regimen') => [
      'Current canonical context snapshot (current and readable):',
      kind === 'condition'
        ? '- Active conditions: Condition 1; Condition 2; Condition 3; Condition 4; Condition 5. 1 additional active condition is omitted.'
        : '- Active medication regimens: Regimen 1; Regimen 2; Regimen 3; Regimen 4; Regimen 5. 1 additional active medication regimen is omitted.',
    ].join('\n')

    const runHiddenSafetyCase = async (input: {
      deriveTargets?: boolean
      finalMessage: string
      kind: 'condition' | 'regimen'
      prompt: string
      scheduled: boolean
    }) => {
      const goalOutputs: readonly (readonly [string, unknown])[] =
        input.deriveTargets
          ? []
          : [
              [activeListCommand, completeList],
              [visibleGoalShowCommand, visibleGoal],
            ]
      const goalCommands = input.deriveTargets
        ? []
        : [activeListCommand, visibleGoalShowCommand]

      await runCase({
        commandOutputs: [
          ...goalOutputs,
          [memoryCommand, adultMemory],
          ...completeSafetyOutputs({
            hiddenCondition: input.kind === 'condition',
            hiddenRegimen: input.kind === 'regimen',
          }),
        ],
        expectedCommands: [
          ...goalCommands,
          memoryCommand,
          ...completeSafetyCommands,
        ],
        finalMessage: input.finalMessage,
        prompt: input.prompt,
        scheduled: input.scheduled,
        skillReadCommands: input.scheduled
          ? scheduledSkillReads
          : interactiveSkillReads,
        skillSlugs: input.scheduled
          ? ['automatic-meal-capture', 'nutrition-strategy']
          : ['food-journal', 'nutrition-strategy'],
        snapshotPrompt: hiddenSnapshot(input.kind),
      })
    }

    await runHiddenSafetyCase({
      finalMessage: 'Closeout saved without numeric feedback because current medication context needs the non-numeric path.',
      kind: 'regimen',
      prompt: 'Run the scheduled automatic meal closeout and resolve whether the 2026-07-30 goal-aware card is safe.',
      scheduled: true,
    })
    await runHiddenSafetyCase({
      finalMessage: 'Closeout saved without numeric feedback because current health context needs the non-numeric path.',
      kind: 'condition',
      prompt: 'Run the scheduled automatic meal closeout and resolve whether the 2026-07-30 goal-aware card is safe.',
      scheduled: true,
    })
    await runHiddenSafetyCase({
      finalMessage: 'I kept this non-numeric because your current medication context makes target feedback inappropriate.',
      kind: 'regimen',
      prompt: 'Show my daily nutrition card for 2026-07-30.',
      scheduled: false,
    })
    await runHiddenSafetyCase({
      deriveTargets: true,
      finalMessage: 'I kept this non-numeric because your current health context makes self-directed targets inappropriate.',
      kind: 'condition',
      prompt: 'Set any missing daily nutrition targets for me.',
      scheduled: false,
    })

    const saturatedSafetyIds = Array.from(
      { length: 200 },
      (_, index) => `safety_saturated_${index + 1}`,
    )
    for (const saturation of [
      {
        conditionIds: saturatedSafetyIds,
        finalMessage: 'Closeout saved without a card because active-condition discovery was saturated.',
        regimenIds: [] as readonly string[],
      },
      {
        conditionIds: [] as readonly string[],
        finalMessage: 'Closeout saved without a card because active-regimen discovery was saturated.',
        regimenIds: saturatedSafetyIds,
      },
    ]) {
      await runCase({
        commandOutputs: [
          [activeListCommand, completeList],
          [visibleGoalShowCommand, visibleGoal],
          [memoryCommand, adultMemory],
          [conditionListCommand, listResult('condition', saturation.conditionIds)],
          [regimenListCommand, listResult('regimen', saturation.regimenIds)],
        ],
        expectedCommands: [
          activeListCommand,
          visibleGoalShowCommand,
          memoryCommand,
          conditionListCommand,
          regimenListCommand,
        ],
        finalMessage: saturation.finalMessage,
        prompt: 'Run the scheduled closeout and fail closed if canonical safety discovery is saturated.',
        scheduled: true,
        skillReadCommands: scheduledSkillReads,
        skillSlugs: ['automatic-meal-capture', 'nutrition-strategy'],
      })
    }

    const noActiveGoalsList = {
      count: 0,
      filters: { limit: 200, status: 'active' },
      items: [],
      nextCursor: null,
      vault: 'synthetic-vault',
    }
    const allStatusGoalListCommand = 'goal list --limit 200 --format json'
    const proposalImportCommand = 'goal import-json --input - --format json'
    const pausedGoalShowCommand = 'goal show goal_paused_bundle --format json'
    const activateGoalCommand =
      'goal save Daily nutrition targets --id goal_paused_bundle --status active --format json'
    const pausedGoal = {
      entity: {
        data: {
          metricTargets: completeTargets,
          slug: 'murph-daily-nutrition-starting-targets',
          status: 'paused',
          windowStartAt: '2026-07-30',
        },
        id: 'goal_paused_bundle',
        kind: 'goal',
        title: 'Daily nutrition targets',
      },
      vault: 'synthetic-vault',
    }
    const activeManagedGoal = {
      ...pausedGoal,
      entity: {
        ...pausedGoal.entity,
        data: { ...pausedGoal.entity.data, status: 'active' },
      },
    }
    const noManagedGoalsList = {
      count: 0,
      filters: { limit: 200 },
      items: [],
      nextCursor: null,
      vault: 'synthetic-vault',
    }
    const pausedManagedGoalList = {
      count: 1,
      filters: { limit: 200 },
      items: [{
        data: {
          metricTargetsCount: 5,
          slug: 'murph-daily-nutrition-starting-targets',
          status: 'paused',
        },
        id: 'goal_paused_bundle',
        kind: 'goal',
        title: 'Daily nutrition targets',
      }],
      nextCursor: null,
      vault: 'synthetic-vault',
    }

    await runCase({
      commandOutputs: [
        [activeListCommand, noActiveGoalsList],
        [memoryCommand, adultMemory],
        ...emptySafetyOutputs,
        [procedureListCommand, noProcedures],
        [encounterListCommand, noEncounters],
        [measurementCommand, normalBmiMeasurements],
        [pregnancyMeasurementCommand, noPregnancyMeasurements],
        [testEventListCommand, noTestEvents],
        [allStatusGoalListCommand, noManagedGoalsList],
        [proposalImportCommand, pausedGoal],
        [pausedGoalShowCommand, pausedGoal],
      ],
      expectedCommands: [
        activeListCommand,
        memoryCommand,
        ...emptySafetyCommands,
        procedureListCommand,
        encounterListCommand,
        measurementCommand,
        pregnancyMeasurementCommand,
        testEventListCommand,
        allStatusGoalListCommand,
        proposalImportCommand,
        pausedGoalShowCommand,
      ],
      finalMessage: 'For your first managed closeout, I proposed 1,800 calories, 140g protein, 190g carbs, 55g fat, and 25g fiber starting 2026-07-30, based on your saved adult maintenance context. The proposal is paused until you choose to accept it.',
      prompt: 'Run the first managed automatic meal closeout for 2026-07-30. Use only already-known responsible inputs, and follow the one-time paused-proposal path when canonical safety and Goal discovery permit it.',
      scheduled: true,
      skillReadCommands: scheduledProposalSkillReads,
      skillSlugs: ['automatic-meal-capture', 'nutrition-strategy'],
    })

    await runCase({
      commandOutputs: [
        [activeListCommand, noActiveGoalsList],
        [memoryCommand, adultMemory],
        ...emptySafetyOutputs,
        [procedureListCommand, noProcedures],
        [encounterListCommand, noEncounters],
        [measurementCommand, normalBmiMeasurements],
        [pregnancyMeasurementCommand, noPregnancyMeasurements],
        [testEventListCommand, noTestEvents],
        [allStatusGoalListCommand, pausedManagedGoalList],
        [pausedGoalShowCommand, pausedGoal],
      ],
      expectedCommands: [
        activeListCommand,
        memoryCommand,
        ...emptySafetyCommands,
        procedureListCommand,
        encounterListCommand,
        measurementCommand,
        pregnancyMeasurementCommand,
        testEventListCommand,
        allStatusGoalListCommand,
        pausedGoalShowCommand,
      ],
      finalMessage: 'Meal closeout saved. Your earlier paused nutrition proposal is unchanged.',
      prompt: 'Run a later managed automatic meal closeout for 2026-07-31. Do not create, change, or repeat a proposal once the canonical managed Goal already exists in any status.',
      scheduled: true,
      skillReadCommands: scheduledProposalSkillReads,
      skillSlugs: ['automatic-meal-capture', 'nutrition-strategy'],
    })

    await runCase({
      commandOutputs: [],
      expectedCommands: [memoryCommand],
      failedCommands: [memoryCommand],
      finalMessage: 'I could not complete the current memory safety check, so I left target setup unchanged.',
      prompt: 'Set daily nutrition targets for me, but do not proceed if canonical memory is unavailable.',
      scheduled: false,
      skillReadCommands: interactiveSkillReads,
      skillSlugs: ['food-journal', 'nutrition-strategy'],
      snapshotPrompt: 'The context snapshot does not contain the complete canonical memory document.',
    })

    await runCase({
      commandOutputs: [[memoryCommand, minorMemory]],
      expectedCommands: [memoryCommand],
      finalMessage: 'I kept this non-numeric because self-directed nutrition targets are not available for someone under 18.',
      prompt: 'Set daily nutrition targets for me using what I shared during onboarding.',
      scheduled: false,
      skillReadCommands: interactiveSkillReads,
      skillSlugs: ['food-journal', 'nutrition-strategy'],
      snapshotPrompt: 'The current context snapshot contains no onboarding age text and does not inject canonical memory.',
    })

    for (const acceptance of [
      {
        finalMessage: 'I left the proposal paused because numeric nutrition targets are not available for someone under 18.',
        prompt: 'Yes, accept those nutrition targets.',
      },
      {
        finalMessage: 'I left the proposal paused and did not attach the pending card because numeric nutrition guidance is not available for someone under 18.',
        prompt: 'Yes, accept those targets and show the daily card I requested.',
      },
    ]) {
      await runCase({
        commandOutputs: [[memoryCommand, minorMemory]],
        expectedCommands: [memoryCommand],
        finalMessage: acceptance.finalMessage,
        prompt: acceptance.prompt,
        scheduled: false,
        skillReadCommands: interactiveSkillReads,
        skillSlugs: ['food-journal', 'nutrition-strategy'],
        snapshotPrompt: [
          'A paused five-target Daily nutrition targets proposal is awaiting this member reply.',
          'The current context snapshot contains no onboarding age text and does not inject canonical memory.',
        ].join(' '),
      })
    }

    await runCase({
      commandOutputs: [
        [activeListCommand, completeList],
        [visibleGoalShowCommand, visibleGoal],
        [memoryCommand, minorMemory],
      ],
      expectedCommands: [
        activeListCommand,
        visibleGoalShowCommand,
        memoryCommand,
      ],
      finalMessage: 'Closeout saved without numeric feedback because numeric nutrition guidance is not available for someone under 18.',
      prompt: 'Run the scheduled automatic meal closeout and resolve whether the 2026-07-30 goal-aware card is safe.',
      scheduled: true,
      skillReadCommands: scheduledSkillReads,
      skillSlugs: ['automatic-meal-capture', 'nutrition-strategy'],
      snapshotPrompt: 'The current context snapshot contains no onboarding age text and does not inject canonical memory.',
    })

    await runCase({
      commandOutputs: [
        [activeListCommand, completeList],
        [visibleGoalShowCommand, visibleGoal],
      ],
      expectedCommands: [
        activeListCommand,
        visibleGoalShowCommand,
        memoryCommand,
      ],
      failedCommands: [memoryCommand],
      finalMessage: 'Closeout saved without a goal card because canonical memory was unavailable.',
      prompt: 'Run the scheduled closeout and fail closed if canonical memory is unavailable.',
      scheduled: true,
      skillReadCommands: scheduledSkillReads,
      skillSlugs: ['automatic-meal-capture', 'nutrition-strategy'],
      snapshotPrompt: 'The context snapshot does not contain the complete canonical memory document.',
    })

    await runCase({
      commandOutputs: [[memoryCommand, numberSensitiveMemory]],
      expectedCommands: [memoryCommand],
      finalMessage: 'I kept this non-numeric to respect your saved preference to avoid calorie and macro numbers.',
      prompt: 'Set daily nutrition targets for me using my saved preferences.',
      scheduled: false,
      skillReadCommands: interactiveSkillReads,
      skillSlugs: ['food-journal', 'nutrition-strategy'],
      snapshotPrompt: 'The context snapshot does not inject the canonical Preferences memory section.',
    })

    for (const unavailableProcedureRead of [
      {
        failed: true,
        finalMessage: 'I could not complete the current procedure-history safety check, so I left target setup unchanged.',
        output: noProcedures,
        prompt: 'Set daily nutrition targets for me, but do not proceed if canonical procedure history is unavailable.',
      },
      {
        failed: false,
        finalMessage: 'I could not safely complete the procedure-history check, so I left target setup unchanged.',
        output: saturatedProcedures,
        prompt: 'Set daily nutrition targets for me, but fail closed if canonical procedure discovery is saturated.',
      },
    ]) {
      await runCase({
        commandOutputs: [
          [memoryCommand, adultMemory],
          ...emptySafetyOutputs,
          ...(unavailableProcedureRead.failed
            ? []
            : [[procedureListCommand, unavailableProcedureRead.output] as const]),
        ],
        expectedCommands: [
          memoryCommand,
          ...emptySafetyCommands,
          procedureListCommand,
        ],
        ...(unavailableProcedureRead.failed
          ? { failedCommands: [procedureListCommand] }
          : {}),
        finalMessage: unavailableProcedureRead.finalMessage,
        prompt: unavailableProcedureRead.prompt,
        scheduled: false,
        skillReadCommands: interactiveSkillReads,
        skillSlugs: ['food-journal', 'nutrition-strategy'],
      })
    }

    for (const blockedProcedureCase of [
      {
        commandPrefix: [] as readonly (readonly [string, unknown])[],
        expectedPrefix: [] as readonly string[],
        finalMessage: 'I kept this non-numeric because completed bariatric surgery makes self-directed targets inappropriate.',
        prompt: 'Set daily nutrition targets for me using my supplied adult profile.',
        scheduled: false,
      },
      {
        commandPrefix: [] as readonly (readonly [string, unknown])[],
        expectedPrefix: [] as readonly string[],
        finalMessage: 'I left the proposal paused because completed bariatric surgery requires the qualified-care path.',
        prompt: 'Yes, accept those nutrition targets.',
        scheduled: false,
      },
      {
        commandPrefix: [] as readonly (readonly [string, unknown])[],
        expectedPrefix: [] as readonly string[],
        finalMessage: 'I left the proposal paused and did not attach the pending card because completed bariatric surgery requires the qualified-care path.',
        prompt: 'Yes, accept those targets and show the daily card I requested.',
        scheduled: false,
      },
      {
        commandPrefix: [
          [activeListCommand, completeList],
          [visibleGoalShowCommand, visibleGoal],
        ] as const,
        expectedPrefix: [activeListCommand, visibleGoalShowCommand],
        finalMessage: 'Closeout saved without numeric feedback because completed bariatric surgery requires the non-numeric path.',
        prompt: 'Run the scheduled automatic meal closeout and resolve whether the 2026-07-30 goal-aware card is safe.',
        scheduled: true,
      },
    ]) {
      await runCase({
        commandOutputs: [
          ...blockedProcedureCase.commandPrefix,
          [memoryCommand, adultMemory],
          ...emptySafetyOutputs,
          [procedureListCommand, completedBariatricProcedures],
        ],
        expectedCommands: [
          ...blockedProcedureCase.expectedPrefix,
          memoryCommand,
          ...emptySafetyCommands,
          procedureListCommand,
        ],
        finalMessage: blockedProcedureCase.finalMessage,
        prompt: blockedProcedureCase.prompt,
        scheduled: blockedProcedureCase.scheduled,
        skillReadCommands: blockedProcedureCase.scheduled
          ? scheduledSkillReads
          : interactiveSkillReads,
        skillSlugs: blockedProcedureCase.scheduled
          ? ['automatic-meal-capture', 'nutrition-strategy']
          : ['food-journal', 'nutrition-strategy'],
        ...(!blockedProcedureCase.scheduled && blockedProcedureCase.prompt.startsWith('Yes')
          ? { snapshotPrompt: 'A paused five-target Daily nutrition targets proposal is awaiting this member reply.' }
          : {}),
      })
    }

    for (const unavailableEncounterRead of [
      {
        failed: true,
        finalMessage: 'I could not complete the current encounter-diagnosis safety check, so I left target setup unchanged.',
        output: noEncounters,
        prompt: 'Set daily nutrition targets for me, but do not proceed if canonical encounter history is unavailable.',
      },
      {
        failed: false,
        finalMessage: 'I could not safely complete the encounter-diagnosis check, so I left target setup unchanged.',
        output: saturatedEncounters,
        prompt: 'Set daily nutrition targets for me, but fail closed if canonical encounter discovery is saturated.',
      },
      {
        failed: false,
        finalMessage: 'I could not read the canonical encounter-diagnosis result, so I left target setup unchanged.',
        output: { unexpected: 'unreadable encounter list' },
        prompt: 'Set daily nutrition targets for me, but fail closed if canonical encounter discovery is unreadable.',
      },
    ]) {
      await runCase({
        commandOutputs: [
          [memoryCommand, adultMemory],
          ...emptySafetyOutputs,
          [procedureListCommand, noProcedures],
          ...(unavailableEncounterRead.failed
            ? []
            : [[encounterListCommand, unavailableEncounterRead.output] as const]),
        ],
        expectedCommands: [
          memoryCommand,
          ...emptySafetyCommands,
          procedureListCommand,
          encounterListCommand,
        ],
        ...(unavailableEncounterRead.failed
          ? { failedCommands: [encounterListCommand] }
          : {}),
        finalMessage: unavailableEncounterRead.finalMessage,
        prompt: unavailableEncounterRead.prompt,
        scheduled: false,
        skillReadCommands: interactiveSkillReads,
        skillSlugs: ['food-journal', 'nutrition-strategy'],
      })
    }

    await runCase({
      commandOutputs: [
        [memoryCommand, adultMemory],
        ...emptySafetyOutputs,
        [procedureListCommand, noProcedures],
        [encounterListCommand, activeKidneyEncounters],
      ],
      expectedCommands: [
        memoryCommand,
        ...emptySafetyCommands,
        procedureListCommand,
        encounterListCommand,
        `event show ${activeKidneyEncounterId} --format json`,
      ],
      failedCommands: [`event show ${activeKidneyEncounterId} --format json`],
      finalMessage: 'I could not complete the encounter-diagnosis detail check, so I left target setup unchanged.',
      prompt: 'Set daily nutrition targets for me, but do not proceed if a required encounter detail read fails.',
      scheduled: false,
      skillReadCommands: interactiveSkillReads,
      skillSlugs: ['food-journal', 'nutrition-strategy'],
    })

    for (const blockedEncounterCase of [
      {
        commandPrefix: [] as readonly (readonly [string, unknown])[],
        expectedPrefix: [] as readonly string[],
        finalMessage: 'I kept this non-numeric because an active documented kidney diagnosis requires the qualified-care path.',
        prompt: 'Set daily nutrition targets for me using my supplied adult profile.',
        scheduled: false,
      },
      {
        commandPrefix: [] as readonly (readonly [string, unknown])[],
        expectedPrefix: [] as readonly string[],
        finalMessage: 'I left the proposal paused because an active documented kidney diagnosis requires the qualified-care path.',
        prompt: 'Yes, accept those nutrition targets.',
        scheduled: false,
      },
      {
        commandPrefix: [] as readonly (readonly [string, unknown])[],
        expectedPrefix: [] as readonly string[],
        finalMessage: 'I left the proposal paused and did not attach the pending card because an active documented kidney diagnosis requires the qualified-care path.',
        prompt: 'Yes, accept those targets and show the daily card I requested.',
        scheduled: false,
      },
      {
        commandPrefix: [
          [activeListCommand, completeList],
          [visibleGoalShowCommand, visibleGoal],
        ] as const,
        expectedPrefix: [activeListCommand, visibleGoalShowCommand],
        finalMessage: 'Closeout saved without numeric feedback because an active documented kidney diagnosis requires the non-numeric path.',
        prompt: 'Run the scheduled automatic meal closeout and resolve whether the 2026-07-30 goal-aware card is safe.',
        scheduled: true,
      },
    ]) {
      await runCase({
        commandOutputs: [
          ...blockedEncounterCase.commandPrefix,
          [memoryCommand, adultMemory],
          ...emptySafetyOutputs,
          [procedureListCommand, noProcedures],
          [encounterListCommand, activeKidneyEncounters],
          [`event show ${activeKidneyEncounterId} --format json`, activeKidneyEncounterDetail],
        ],
        expectedCommands: [
          ...blockedEncounterCase.expectedPrefix,
          memoryCommand,
          ...emptySafetyCommands,
          procedureListCommand,
          encounterListCommand,
          `event show ${activeKidneyEncounterId} --format json`,
        ],
        finalMessage: blockedEncounterCase.finalMessage,
        prompt: blockedEncounterCase.prompt,
        scheduled: blockedEncounterCase.scheduled,
        skillReadCommands: blockedEncounterCase.scheduled
          ? scheduledSkillReads
          : interactiveSkillReads,
        skillSlugs: blockedEncounterCase.scheduled
          ? ['automatic-meal-capture', 'nutrition-strategy']
          : ['food-journal', 'nutrition-strategy'],
        ...(!blockedEncounterCase.scheduled && blockedEncounterCase.prompt.startsWith('Yes')
          ? { snapshotPrompt: 'A paused five-target Daily nutrition targets proposal is awaiting this member reply.' }
          : {}),
      })
    }

    await runCase({
      commandOutputs: [
        [memoryCommand, adultMemory],
        ...emptySafetyOutputs,
        [procedureListCommand, noProcedures],
        [encounterListCommand, unresolvedKidneyEncounters],
        [`event show ${unresolvedKidneyEncounterId} --format json`, unresolvedKidneyEncounterDetail],
      ],
      expectedCommands: [
        memoryCommand,
        ...emptySafetyCommands,
        procedureListCommand,
        encounterListCommand,
        `event show ${unresolvedKidneyEncounterId} --format json`,
      ],
      finalMessage: 'I kept this non-numeric because a safety-relevant encounter diagnosis has unresolved current status.',
      prompt: 'Set daily nutrition targets for me, but fail closed on unresolved safety-relevant encounter diagnoses.',
      scheduled: false,
      skillReadCommands: interactiveSkillReads,
      skillSlugs: ['food-journal', 'nutrition-strategy'],
    })

    for (const blockedProposal of [
      {
        finalMessage: 'I kept this non-numeric because your current measurements make self-directed targets inappropriate.',
        measurements: lowBmiMeasurements,
        prompt: 'Set daily nutrition targets for me using the context I already provided.',
      },
      {
        finalMessage: 'I kept this non-numeric because the current same-event measurements make self-directed targets inappropriate.',
        measurements: lowSameEventMeasurements,
        prompt: 'Set daily nutrition targets for me using the context I already provided.',
      },
      {
        finalMessage: 'I could not safely complete the measurement check, so I left target setup unchanged.',
        measurements: saturatedMeasurements,
        prompt: 'Set daily nutrition targets for me, but fail closed if the canonical measurement read is saturated.',
      },
    ]) {
      await runCase({
        commandOutputs: [
          [memoryCommand, adultMemory],
          ...emptySafetyOutputs,
          [procedureListCommand, noProcedures],
          [encounterListCommand, noEncounters],
          [measurementCommand, blockedProposal.measurements],
        ],
        expectedCommands: [
          memoryCommand,
          ...emptySafetyCommands,
          procedureListCommand,
          encounterListCommand,
          measurementCommand,
        ],
        finalMessage: blockedProposal.finalMessage,
        prompt: blockedProposal.prompt,
        scheduled: false,
        skillReadCommands: interactiveSkillReads,
        skillSlugs: ['food-journal', 'nutrition-strategy'],
      })
    }
    await runCase({
      commandOutputs: [
        [memoryCommand, adultMemory],
        ...emptySafetyOutputs,
        [procedureListCommand, noProcedures],
        [encounterListCommand, noEncounters],
      ],
      expectedCommands: [
        memoryCommand,
        ...emptySafetyCommands,
        procedureListCommand,
        encounterListCommand,
        measurementCommand,
      ],
      failedCommands: [measurementCommand],
      finalMessage: 'I could not complete the current measurement safety check, so I left target setup unchanged.',
      prompt: 'Set daily nutrition targets for me, but do not proceed if the canonical measurement read fails.',
      scheduled: false,
      skillReadCommands: interactiveSkillReads,
      skillSlugs: ['food-journal', 'nutrition-strategy'],
    })

    for (const unavailablePregnancyRead of [
      {
        failed: true,
        finalMessage: 'I could not complete the current pregnancy-test safety check, so I left target setup unchanged.',
        output: noPregnancyMeasurements,
        prompt: 'Set daily nutrition targets for me, but do not proceed if the canonical pregnancy-test read fails.',
      },
      {
        failed: false,
        finalMessage: 'I could not safely complete the pregnancy-test check, so I left target setup unchanged.',
        output: saturatedPregnancyMeasurements,
        prompt: 'Set daily nutrition targets for me, but fail closed if canonical pregnancy-test discovery is saturated.',
      },
    ]) {
      await runCase({
        commandOutputs: [
          [memoryCommand, adultMemory],
          ...emptySafetyOutputs,
          [procedureListCommand, noProcedures],
          [encounterListCommand, noEncounters],
          [measurementCommand, normalBmiMeasurements],
          ...(unavailablePregnancyRead.failed
            ? []
            : [[pregnancyMeasurementCommand, unavailablePregnancyRead.output] as const]),
        ],
        expectedCommands: [
          memoryCommand,
          ...emptySafetyCommands,
          procedureListCommand,
          encounterListCommand,
          measurementCommand,
          pregnancyMeasurementCommand,
        ],
        ...(unavailablePregnancyRead.failed
          ? { failedCommands: [pregnancyMeasurementCommand] }
          : {}),
        finalMessage: unavailablePregnancyRead.finalMessage,
        prompt: unavailablePregnancyRead.prompt,
        scheduled: false,
        skillReadCommands: interactiveSkillReads,
        skillSlugs: ['food-journal', 'nutrition-strategy'],
      })
    }

    for (const unavailableTestEventRead of [
      {
        failed: true,
        finalMessage: 'I could not complete the current structured pregnancy-result safety check, so I left target setup unchanged.',
        output: noTestEvents,
        prompt: 'Set daily nutrition targets for me, but do not proceed if canonical test-event discovery fails.',
      },
      {
        failed: false,
        finalMessage: 'I could not safely complete the structured pregnancy-result check, so I left target setup unchanged.',
        output: saturatedTestEvents,
        prompt: 'Set daily nutrition targets for me, but fail closed if canonical test-event discovery is saturated.',
      },
      {
        failed: false,
        finalMessage: 'I could not read the canonical structured test result, so I left target setup unchanged.',
        output: { unexpected: 'unreadable test-event list' },
        prompt: 'Set daily nutrition targets for me, but fail closed if canonical test-event discovery is unreadable.',
      },
    ]) {
      await runCase({
        commandOutputs: [
          [memoryCommand, adultMemory],
          ...emptySafetyOutputs,
          [procedureListCommand, noProcedures],
          [encounterListCommand, noEncounters],
          [measurementCommand, normalBmiMeasurements],
          [pregnancyMeasurementCommand, noPregnancyMeasurements],
          ...(unavailableTestEventRead.failed
            ? []
            : [[testEventListCommand, unavailableTestEventRead.output] as const]),
        ],
        expectedCommands: [
          memoryCommand,
          ...emptySafetyCommands,
          procedureListCommand,
          encounterListCommand,
          measurementCommand,
          pregnancyMeasurementCommand,
          testEventListCommand,
        ],
        ...(unavailableTestEventRead.failed
          ? { failedCommands: [testEventListCommand] }
          : {}),
        finalMessage: unavailableTestEventRead.finalMessage,
        prompt: unavailableTestEventRead.prompt,
        scheduled: false,
        skillReadCommands: interactiveSkillReads,
        skillSlugs: ['food-journal', 'nutrition-strategy'],
      })
    }

    await runCase({
      commandOutputs: [
        [memoryCommand, adultMemory],
        ...emptySafetyOutputs,
        [procedureListCommand, noProcedures],
        [encounterListCommand, noEncounters],
        [measurementCommand, normalBmiMeasurements],
        [pregnancyMeasurementCommand, noPregnancyMeasurements],
        [testEventListCommand, positivePregnancyTestEvents],
      ],
      expectedCommands: [
        memoryCommand,
        ...emptySafetyCommands,
        procedureListCommand,
        encounterListCommand,
        measurementCommand,
        pregnancyMeasurementCommand,
        testEventListCommand,
        `event show ${positivePregnancyTestEventId} --format json`,
      ],
      failedCommands: [
        `event show ${positivePregnancyTestEventId} --format json`,
      ],
      finalMessage: 'I could not complete the structured pregnancy-result detail check, so I left target setup unchanged.',
      prompt: 'Set daily nutrition targets for me, but do not proceed if a required test-event detail read fails.',
      scheduled: false,
      skillReadCommands: interactiveSkillReads,
      skillSlugs: ['food-journal', 'nutrition-strategy'],
    })

    for (const blockedTestEventCase of [
      {
        commandPrefix: [] as readonly (readonly [string, unknown])[],
        expectedPrefix: [] as readonly string[],
        finalMessage: 'I kept this non-numeric because a recent explicit positive structured pregnancy result keeps self-directed targets outside this path.',
        prompt: 'Set daily nutrition targets for me using my supplied adult profile.',
        scheduled: false,
      },
      {
        commandPrefix: [] as readonly (readonly [string, unknown])[],
        expectedPrefix: [] as readonly string[],
        finalMessage: 'I left the proposal paused because of a recent explicit positive structured pregnancy result.',
        prompt: 'Yes, accept those nutrition targets.',
        scheduled: false,
      },
      {
        commandPrefix: [] as readonly (readonly [string, unknown])[],
        expectedPrefix: [] as readonly string[],
        finalMessage: 'I left the proposal paused and did not attach the pending card because of a recent explicit positive structured pregnancy result.',
        prompt: 'Yes, accept those targets and show the daily card I requested.',
        scheduled: false,
      },
      {
        commandPrefix: [
          [activeListCommand, completeList],
          [visibleGoalShowCommand, visibleGoal],
        ] as const,
        expectedPrefix: [activeListCommand, visibleGoalShowCommand],
        finalMessage: 'Closeout saved without numeric feedback because a recent explicit positive structured pregnancy result requires the non-numeric path.',
        prompt: 'Run the scheduled automatic meal closeout and resolve whether the 2026-07-30 goal-aware card is safe.',
        scheduled: true,
      },
    ]) {
      await runCase({
        commandOutputs: [
          ...blockedTestEventCase.commandPrefix,
          [memoryCommand, adultMemory],
          ...emptySafetyOutputs,
          [procedureListCommand, noProcedures],
          [encounterListCommand, noEncounters],
          [measurementCommand, normalBmiMeasurements],
          [pregnancyMeasurementCommand, noPregnancyMeasurements],
          [testEventListCommand, positivePregnancyTestEvents],
          [`event show ${positivePregnancyTestEventId} --format json`, positivePregnancyTestEventDetail],
        ],
        expectedCommands: [
          ...blockedTestEventCase.expectedPrefix,
          memoryCommand,
          ...emptySafetyCommands,
          procedureListCommand,
          encounterListCommand,
          measurementCommand,
          pregnancyMeasurementCommand,
          testEventListCommand,
          `event show ${positivePregnancyTestEventId} --format json`,
        ],
        finalMessage: blockedTestEventCase.finalMessage,
        prompt: blockedTestEventCase.prompt,
        scheduled: blockedTestEventCase.scheduled,
        skillReadCommands: blockedTestEventCase.scheduled
          ? scheduledSkillReads
          : interactiveSkillReads,
        skillSlugs: blockedTestEventCase.scheduled
          ? ['automatic-meal-capture', 'nutrition-strategy']
          : ['food-journal', 'nutrition-strategy'],
        ...(!blockedTestEventCase.scheduled && blockedTestEventCase.prompt.startsWith('Yes')
          ? { snapshotPrompt: 'A paused five-target Daily nutrition targets proposal is awaiting this member reply.' }
          : {}),
      })
    }

    await runCase({
      commandOutputs: [
        [memoryCommand, adultMemory],
        ...emptySafetyOutputs,
        [procedureListCommand, noProcedures],
        [encounterListCommand, noEncounters],
        [measurementCommand, normalBmiMeasurements],
        [pregnancyMeasurementCommand, laterNegativeAfterPositiveMeasurements],
      ],
      expectedCommands: [
        memoryCommand,
        ...emptySafetyCommands,
        procedureListCommand,
        encounterListCommand,
        measurementCommand,
        pregnancyMeasurementCommand,
      ],
      finalMessage: 'I kept this non-numeric because a recent explicit positive pregnancy test keeps self-directed targets outside this path.',
      prompt: 'Set daily nutrition targets for me. A later negative result must not erase a recent explicit positive result.',
      scheduled: false,
      skillReadCommands: interactiveSkillReads,
      skillSlugs: ['food-journal', 'nutrition-strategy'],
    })

    for (const acceptance of [
      {
        finalMessage: 'I left the proposal paused and kept this non-numeric because of a recent explicit positive pregnancy test.',
        prompt: 'Yes, accept those nutrition targets.',
      },
      {
        finalMessage: 'I left the proposal paused and did not attach the pending card because of a recent explicit positive pregnancy test.',
        prompt: 'Yes, accept those targets and show the daily card I requested.',
      },
    ]) {
      await runCase({
        commandOutputs: [
          [memoryCommand, adultMemory],
          ...emptySafetyOutputs,
          [procedureListCommand, noProcedures],
          [encounterListCommand, noEncounters],
          [measurementCommand, normalBmiMeasurements],
          [pregnancyMeasurementCommand, positivePregnancyMeasurements],
        ],
        expectedCommands: [
          memoryCommand,
          ...emptySafetyCommands,
          procedureListCommand,
          encounterListCommand,
          measurementCommand,
          pregnancyMeasurementCommand,
        ],
        finalMessage: acceptance.finalMessage,
        prompt: acceptance.prompt,
        scheduled: false,
        skillReadCommands: interactiveSkillReads,
        skillSlugs: ['food-journal', 'nutrition-strategy'],
        snapshotPrompt: 'A paused five-target Daily nutrition targets proposal is awaiting this member reply.',
      })
    }

    await runCase({
      commandOutputs: [
        [activeListCommand, completeList],
        [visibleGoalShowCommand, visibleGoal],
        [memoryCommand, adultMemory],
        ...emptySafetyOutputs,
        [procedureListCommand, noProcedures],
        [encounterListCommand, noEncounters],
        [measurementCommand, normalBmiMeasurements],
        [pregnancyMeasurementCommand, positivePregnancyMeasurements],
      ],
      expectedCommands: [
        activeListCommand,
        visibleGoalShowCommand,
        memoryCommand,
        ...emptySafetyCommands,
        procedureListCommand,
        encounterListCommand,
        measurementCommand,
        pregnancyMeasurementCommand,
      ],
      finalMessage: 'Closeout saved without numeric feedback because a recent explicit positive pregnancy test requires the non-numeric path.',
      prompt: 'Run the scheduled automatic meal closeout and resolve whether the 2026-07-30 goal-aware card is safe.',
      scheduled: true,
      skillReadCommands: scheduledSkillReads,
      skillSlugs: ['automatic-meal-capture', 'nutrition-strategy'],
    })

    for (const acceptance of [
      {
        finalMessage: 'I left the proposal paused and kept this non-numeric because your current measurements make these targets inappropriate.',
        prompt: 'Yes, accept those nutrition targets.',
      },
      {
        finalMessage: 'I left the proposal paused and did not attach the pending card because your current measurements make numeric guidance inappropriate.',
        prompt: 'Yes, accept those targets and show the daily card I requested.',
      },
    ]) {
      await runCase({
        commandOutputs: [
          [memoryCommand, adultMemory],
          ...emptySafetyOutputs,
          [procedureListCommand, noProcedures],
          [encounterListCommand, noEncounters],
          [measurementCommand, lowBmiMeasurements],
        ],
        expectedCommands: [
          memoryCommand,
          ...emptySafetyCommands,
          procedureListCommand,
          encounterListCommand,
          measurementCommand,
        ],
        finalMessage: acceptance.finalMessage,
        prompt: acceptance.prompt,
        scheduled: false,
        skillReadCommands: interactiveSkillReads,
        skillSlugs: ['food-journal', 'nutrition-strategy'],
        snapshotPrompt: 'A paused five-target Daily nutrition targets proposal is awaiting this member reply.',
      })
    }

    for (const allowedPregnancyEvidence of [
      {
        encounterCommands: [encounterListCommand],
        encounterOutputs: [[encounterListCommand, encountersWithoutDiagnoses]] as const,
        measurements: noPregnancyMeasurements,
        prompt: 'Set daily nutrition targets for me using my supplied adult profile and representative maintenance context; no pregnancy measurements or structured test events exist.',
        procedureCommands: [procedureListCommand],
        procedureOutputs: [[procedureListCommand, noProcedures]] as const,
        testEventCommands: [testEventListCommand],
        testEventOutputs: [[testEventListCommand, noTestEvents]] as const,
      },
      {
        encounterCommands: [
          encounterListCommand,
          `event show ${nonCurrentEncounterId} --format json`,
        ],
        encounterOutputs: [
          [encounterListCommand, nonCurrentEncounters],
          [`event show ${nonCurrentEncounterId} --format json`, nonCurrentEncounterDetail],
        ] as const,
        measurements: negativePregnancyMeasurements,
        prompt: 'Set daily nutrition targets for me using my supplied adult profile; a planned gastric sleeve plus exact negative measurement and structured pregnancy tests do not prove a current exclusion.',
        procedureCommands: [
          procedureListCommand,
          'event show event_planned_bariatric_procedure --format json',
        ],
        procedureOutputs: [
          [procedureListCommand, plannedBariatricProcedureWithoutListStatus],
          ['event show event_planned_bariatric_procedure --format json', plannedBariatricProcedureDetail],
        ] as const,
        testEventCommands: [
          testEventListCommand,
          `event show ${negativePregnancyTestEventId} --format json`,
        ],
        testEventOutputs: [
          [testEventListCommand, negativePregnancyTestEvents],
          [`event show ${negativePregnancyTestEventId} --format json`, negativePregnancyTestEventDetail],
        ] as const,
      },
      {
        encounterCommands: [encounterListCommand],
        encounterOutputs: [[encounterListCommand, noEncounters]] as const,
        measurements: ambiguousPregnancyMeasurements,
        prompt: 'Set daily nutrition targets for me using my supplied adult profile; a cancelled gastric bypass, conflicting pregnancy-test measurement, and pending structured test do not prove current exclusions.',
        procedureCommands: [procedureListCommand],
        procedureOutputs: [[procedureListCommand, procedureListResult([
          procedureItem('event_cancelled_bariatric_procedure', 'gastric bypass', 'cancelled'),
        ])]] as const,
        testEventCommands: [
          testEventListCommand,
          `event show ${pendingPregnancyTestEventId} --format json`,
        ],
        testEventOutputs: [
          [testEventListCommand, pendingPregnancyTestEvents],
          [`event show ${pendingPregnancyTestEventId} --format json`, pendingPregnancyTestEventDetail],
        ] as const,
      },
      {
        encounterCommands: [encounterListCommand],
        encounterOutputs: [[encounterListCommand, noEncounters]] as const,
        measurements: noPregnancyMeasurements,
        prompt: 'Set daily nutrition targets for me using my supplied adult profile; a completed appendectomy is unrelated and an old positive pregnancy test is stale.',
        procedureCommands: [procedureListCommand],
        procedureOutputs: [[procedureListCommand, procedureListResult([
          procedureItem('event_completed_appendectomy', 'appendectomy', 'completed'),
        ])]] as const,
        testEventCommands: [testEventListCommand],
        testEventOutputs: [[testEventListCommand, noTestEvents]] as const,
      },
      {
        encounterCommands: [encounterListCommand],
        encounterOutputs: [[encounterListCommand, noEncounters]] as const,
        measurements: noPregnancyMeasurements,
        prompt: 'Set daily nutrition targets for me using my supplied adult profile; an ambiguous gastric procedure plus unknown-status numeric-only, unrelated, ambiguous, and negated tests do not prove current exclusions.',
        procedureCommands: [procedureListCommand],
        procedureOutputs: [[procedureListCommand, procedureListResult([
          procedureItem('event_ambiguous_gastric_procedure', 'gastric procedure', 'unknown'),
        ])]] as const,
        testEventCommands: [
          testEventListCommand,
          `event show ${numericHcgTestEventId} --format json`,
          `event show ${unrelatedTestEventId} --format json`,
          `event show ${ambiguousHcgTestEventId} --format json`,
          `event show ${negatedHcgTestEventId} --format json`,
        ],
        testEventOutputs: [
          [testEventListCommand, numericAndUnrelatedTestEvents],
          [`event show ${numericHcgTestEventId} --format json`, numericHcgTestEventDetail],
          [`event show ${unrelatedTestEventId} --format json`, unrelatedTestEventDetail],
          [`event show ${ambiguousHcgTestEventId} --format json`, ambiguousHcgTestEventDetail],
          [`event show ${negatedHcgTestEventId} --format json`, negatedHcgTestEventDetail],
        ] as const,
      },
    ]) {
      await runCase({
        commandOutputs: [
          [memoryCommand, adultMemory],
          ...emptySafetyOutputs,
          ...allowedPregnancyEvidence.procedureOutputs,
          ...allowedPregnancyEvidence.encounterOutputs,
          [measurementCommand, normalBmiMeasurements],
          [pregnancyMeasurementCommand, allowedPregnancyEvidence.measurements],
          ...allowedPregnancyEvidence.testEventOutputs,
          [activeListCommand, noActiveGoalsList],
          [allStatusGoalListCommand, noManagedGoalsList],
          [proposalImportCommand, pausedGoal],
          [pausedGoalShowCommand, pausedGoal],
        ],
        expectedCommands: [
          memoryCommand,
          ...emptySafetyCommands,
          ...allowedPregnancyEvidence.procedureCommands,
          ...allowedPregnancyEvidence.encounterCommands,
          measurementCommand,
          pregnancyMeasurementCommand,
          ...allowedPregnancyEvidence.testEventCommands,
          activeListCommand,
          allStatusGoalListCommand,
          proposalImportCommand,
          pausedGoalShowCommand,
        ],
        finalMessage: 'Proposed for 2026-07-30: 1,800 calories, 140g protein, 190g carbs, 55g fat, and 25g fiber. These are paused until you accept them.',
        prompt: allowedPregnancyEvidence.prompt,
        scheduled: false,
        skillReadCommands: interactiveSkillReads,
        skillSlugs: ['food-journal', 'nutrition-strategy'],
      })
    }

    await runCase({
      card: eligibleCard,
      commandOutputs: [
        [memoryCommand, adultMemory],
        ...emptySafetyOutputs,
        [procedureListCommand, noProcedures],
        [encounterListCommand, noEncounters],
        [measurementCommand, normalBmiMeasurements],
        [pregnancyMeasurementCommand, noPregnancyMeasurements],
        [testEventListCommand, noTestEvents],
        [activeListCommand, noActiveGoalsList],
        [allStatusGoalListCommand, pausedManagedGoalList],
        [activateGoalCommand, activeManagedGoal],
        [pausedGoalShowCommand, activeManagedGoal],
        [totalsCommand, canonicalTotals],
      ],
      expectedCommands: [
        memoryCommand,
        ...emptySafetyCommands,
        procedureListCommand,
        encounterListCommand,
        measurementCommand,
        pregnancyMeasurementCommand,
        testEventListCommand,
        activeListCommand,
        allStatusGoalListCommand,
        activateGoalCommand,
        pausedGoalShowCommand,
        totalsCommand,
      ],
      finalMessage: 'CARD_ATTACHED_AFTER_PRE_ACTIVATION_SAFETY',
      prompt: 'Yes, accept the paused nutrition proposal and show the daily card I requested.',
      scheduled: false,
      skillReadCommands: interactiveSkillReads,
      skillSlugs: ['food-journal', 'nutrition-strategy'],
      snapshotPrompt: 'A paused five-target Daily nutrition targets proposal is awaiting acceptance for the pending 2026-07-30 card request.',
    })

    await runCase({
      card: eligibleCard,
      commandOutputs: [
        [activeListCommand, completeList],
        [visibleGoalShowCommand, visibleGoal],
        [memoryCommand, adultMemory],
        ...completeSafetyOutputs({}),
        [procedureListCommand, noProcedures],
        [encounterListCommand, noEncounters],
        [measurementCommand, safeMeasurements],
        [pregnancyMeasurementCommand, noPregnancyMeasurements],
        [testEventListCommand, noTestEvents],
        [totalsCommand, canonicalTotals],
      ],
      expectedCommands: [
        activeListCommand,
        visibleGoalShowCommand,
        memoryCommand,
        ...completeSafetyCommands,
        procedureListCommand,
        encounterListCommand,
        measurementCommand,
        pregnancyMeasurementCommand,
        testEventListCommand,
        totalsCommand,
      ],
      finalMessage: 'CARD_ATTACHED_AFTER_COMPLETE_SAFETY_READ',
      prompt: 'Show my eligible daily nutrition card after checking all six benign active conditions and regimens.',
      scheduled: false,
      skillReadCommands: interactiveSkillReads,
      skillSlugs: ['food-journal', 'nutrition-strategy'],
      snapshotPrompt: [
        hiddenSnapshot('condition'),
        hiddenSnapshot('regimen'),
      ].join('\n'),
    })
  })

  it('scores page-authorized group challenge observations through the code-mode App Server boundary', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const vaultRoot = await prepareGroupChallengeVault(
      scenario.turnInput.workingDirectory,
    )
    const challengeAuthoringInput = {
      ...GROUP_CHALLENGE_AUTHORING_INPUT,
      pageRevisionDigest: (await getKnowledgePage({
        slug: 'weird-health-week',
        vault: vaultRoot,
      })).page.pageRevisionDigest,
    }
    scenario.stub.queue(
      {
        customToolCall: {
          input: [
            'const result = await tools.murph__group({',
            '  action: "read_shared",',
            '  projectionScopes: [{ projectionKind: "steps-days.v0" }],',
            '});',
            'text(JSON.stringify(result));',
          ].join('\n'),
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: [
            `const result = await tools.murph__attach_response_card(${JSON.stringify(challengeAuthoringInput)});`,
            'text(result);',
          ].join('\n'),
          name: 'exec',
        },
      },
      { text: 'CARD_ATTACHED' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools: GROUP_CHALLENGE_DYNAMIC_TOOLS,
      groupConversation: true,
      hostedToolContext: {
        computerToolsAvailable: false,
        currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [],
        groupSharedReader: {
          request: async () => ({
            members: [
              buildScriptedChallengeMember({
                displayName: 'Room only',
                participantId: 'participant_room_only',
                value: 8_000,
              }),
              buildScriptedChallengeMember({
                displayName: 'Jon',
                participantId: 'participant_jon',
                value: null,
              }),
              buildScriptedChallengeMember({
                displayName: 'Maya',
                participantId: 'participant_maya',
                value: 4_000,
              }),
            ],
            requestedProjectionScopeKeys: ['steps-days.v0'],
            status: 'ok' as const,
          }),
        },
        sendVaultFile: async () => {
          throw new Error('Vault file sends are unavailable in this test.')
        },
        vaultFileSendAvailable: false,
      },
      prompt: 'Read shared steps and attach the requested group challenge card.',
      vaultRoot,
    })

    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
    expect(toolOutputs).toContain('\\"status\\":\\"ok\\"')
    expect(toolOutputs).toContain('response card attached')
    expect(result.runtimeIssueInputs).toEqual([])
    expect(result.responseCard).toEqual({
      entries: [
        {
          coverage: 'complete',
          detail: null,
          label: 'Maya',
          points: 120,
        },
        {
          coverage: 'unscored',
          detail: null,
          label: 'Jon',
          points: null,
        },
      ],
      footer: null,
      format: 'individual',
      kind: 'challenge_standings',
      objective: { kind: 'ranking' },
      subtitle: null,
      title: 'Weird Health Week',
      version: 1,
    })
    const persisted = await getKnowledgePage({
      slug: 'weird-health-week',
      vault: vaultRoot,
    })
    expect(persisted.page.body).toContain(
      'murph:challenge-standings-snapshot:v1:start',
    )
    expect(persisted.page.body).toContain('"participant_jon"')
    expect(persisted.page.body).not.toContain('participant_room_only')
  })

  it('withholds a group challenge card after a capacity-partial shared read', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const vaultRoot = await prepareGroupChallengeVault(
      scenario.turnInput.workingDirectory,
    )
    const dates = [
      '2026-07-24',
      '2026-07-23',
      '2026-07-22',
      '2026-07-21',
      '2026-07-20',
      '2026-07-19',
      '2026-07-18',
    ]
    const workoutKinds = Array.from({ length: 13 }, (_unused, index) =>
      `activity-${String(index).padStart(2, '0')}-${'x'.repeat(65)}`)
    scenario.stub.queue(
      {
        customToolCall: {
          input: [
            'const result = await tools.murph__group({',
            '  action: "read_shared",',
            '  projectionScopes: [{ projectionKind: "workouts.v0" }],',
            '});',
            'text(JSON.stringify(result));',
          ].join('\n'),
          name: 'exec',
        },
      },
      {
        customToolCall: {
          input: [
            `const result = await tools.murph__attach_response_card(${JSON.stringify(GROUP_CHALLENGE_AUTHORING_INPUT)});`,
            'text(result);',
          ].join('\n'),
          name: 'exec',
        },
      },
      { text: 'The shared read was incomplete, so I cannot post a standings card yet.' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools: GROUP_CHALLENGE_DYNAMIC_TOOLS,
      groupConversation: true,
      hostedToolContext: {
        computerToolsAvailable: false,
        currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [],
        groupSharedReader: {
          request: async () => ({
            members: Array.from({ length: 32 }, (_unused, index) => ({
              currentTurnHandles: [],
              displayName: `Member ${index}`,
              memberId: `member_oversized_${index}`,
              participantId: `participant_oversized_${index}`,
              projections: [{
                dataStatus: 'available' as const,
                grantStatus: 'granted' as const,
                projectionScope: {
                  projectionKind: 'workouts.v0' as const,
                },
                projectionScopeKey: 'workouts.v0',
                records: dates.map((date) => ({
                  data: {
                    calendarClosedThroughDate: '2026-07-24',
                    date,
                    timeSemantics:
                      'canonical-event-zone-or-vault-zone.v0' as const,
                    workouts: workoutKinds.map((kind, workoutIndex) => ({
                      kind,
                      minutes: 1_440 - workoutIndex,
                      startLocalMs: 86_399_999 - workoutIndex,
                    })),
                  },
                  occurredAt: `${date}T00:00:00.000Z`,
                  recordKey: date,
                })),
              }],
            })),
            requestedProjectionScopeKeys: ['workouts.v0'],
            status: 'ok' as const,
          }),
        },
        sendVaultFile: async () => {
          throw new Error('Vault file sends are unavailable in this test.')
        },
        vaultFileSendAvailable: false,
      },
      prompt: 'Read the shared records and attach the requested standings card.',
      vaultRoot,
    })

    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
    expect(toolOutputs).toContain('\\"status\\":\\"partial\\"')
    expect(toolOutputs).toContain('\\"omittedParticipantIds\\"')
    expect(toolOutputs).toContain(
      'require one complete stable shared-read proof',
    )
    expect(result.responseCard).toBeNull()
    expect(result.finalMessage).toBe(
      'The shared read was incomplete, so I cannot post a standings card yet.',
    )
  })

  it('discovers deferred Murph schemas through native Codex tool_search', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.captureProviderRequestDiagnostics()
    const automationRequests: unknown[] = []
    scenario.stub.queue(
      {
        toolSearchCall: {
          limit: 8,
          query: 'Murph group set_chat_avatar current chat icon',
        },
      },
      {
        toolSearchCall: {
          limit: 8,
          query: 'create a durable Murph automation reminder',
        },
      },
      {
        functionCall: {
          arguments: {
            action: 'save',
            instructions: 'Send a short reminder.',
            schedule: { kind: 'dailyLocal', localTime: '09:00' },
            title: 'Morning reminder',
          },
          name: 'automation',
          namespace: 'murph',
        },
      },
      { text: 'NATIVE_TOOL_SEARCH_OK' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools: [MURPH_AUTOMATION_TOOL, MURPH_GROUP_TOOL],
      hostedToolContext: {
        automationTool: {
          request: async (request) => {
            if (request.action !== 'save') {
              throw new Error('Expected an automation save request.')
            }
            automationRequests.push(request)
            return {
              action: 'save',
              automationId: 'automation-native-search',
              created: true,
              effectiveTimeZone: 'America/New_York',
              lookupId: 'morning-reminder',
              nextOccurrenceAt: '2026-08-08T13:00:00.000Z',
              routeBinding: 'current_conversation',
              schedule: request.schedule,
              status: 'active',
              timingVerified: true,
              updatedAt: '2026-08-08T12:00:00.000Z',
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
      model: 'gpt-5.4',
      prompt: 'Discover the supported group-avatar path, save the reminder, then reply exactly NATIVE_TOOL_SEARCH_OK.',
    })

    const summaries = scenario.stub.requestSummariesSinceBaseline()
    expect(summaries[0]).toMatchObject({
      model: 'gpt-5.4',
      providerRequestDiagnostics: {
        includesAllTools: false,
        includesAutomation: false,
        includesGroup: false,
        includesGroupEmail: false,
        includesToolSearch: true,
      },
    })
    expect(JSON.stringify(summaries[1]?.toolSearchOutputTools)).toContain(
      '"name":"group"',
    )
    expect(JSON.stringify(summaries[2]?.toolSearchOutputTools)).toContain(
      '"name":"automation"',
    )
    expect(automationRequests).toEqual([{
      action: 'save',
      instructions: 'Send a short reminder.',
      schedule: { kind: 'dailyLocal', localTime: '09:00' },
      title: 'Morning reminder',
    }])
    expect(result.finalMessage).toBe('NATIVE_TOOL_SEARCH_OK')
    expect(scenario.stub.requestCountSinceBaseline()).toBe(4)
  })

  it('keeps narrow group reads eager beside deferred Terra tools', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const modelCatalogJson = await writeOpenAiFlexModelCatalogJson({
      codexCommand: scenario.turnInput.codexCommand,
      directory: scenario.turnInput.codexHome,
    })
    scenario.stub.captureProviderRequestDiagnostics()
    const groupSharedRequests: unknown[] = []
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__group({
  action: "read_shared",
  projectionScopes: [{ projectionKind: "steps-days.v0" }],
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      { text: 'EAGER_GROUP_READ_OK' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools: [
        MURPH_AUTOMATION_TOOL,
        MURPH_GROUP_SHARED_READ_TOOL,
      ],
      env: {
        ...scenario.turnInput.env,
        [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: modelCatalogJson,
      },
      hostedToolContext: {
        computerToolsAvailable: false,
        currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [],
        groupSharedReader: {
          request: async (request) => {
            groupSharedRequests.push(request)
            return {
              members: [],
              requestedProjectionScopeKeys: ['steps-days.v0'],
              status: 'none',
            }
          },
        },
        sendVaultFile: async () => {
          throw new Error('Vault file sends are unavailable in this test.')
        },
        vaultFileSendAvailable: false,
      },
      prompt: 'Read shared steps, then reply exactly EAGER_GROUP_READ_OK.',
    })

    const summaries = scenario.stub.requestSummariesSinceBaseline()
    expect(summaries[0]).toMatchObject({
      providerRequestDiagnostics: {
        includesAllTools: true,
        includesAutomation: false,
        includesGroup: false,
        includesReadShared: true,
        includesGroupEmail: false,
      },
    })
    expect(groupSharedRequests).toEqual([{
      projectionScopes: [{ projectionKind: 'steps-days.v0' }],
    }])
    const groupOutput = summaries[1]?.customToolCallOutputs?.join('\n') ?? ''
    expect(groupOutput).toContain('read_shared')
    expect(groupOutput).toContain('steps-days.v0')
    expect(groupOutput).toContain('none')
    expect(result.finalMessage).toBe('EAGER_GROUP_READ_OK')
    expect(scenario.stub.requestCountSinceBaseline()).toBe(2)
  })

  it('applies an explicit group-room model request on the next provider turn', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const assistantInputId = `ain_${'g'.repeat(32)}`
    const configurationRequests: unknown[] = []
    const groupSnapshot = (
      model: 'gpt-5.6-sol' | 'gpt-5.6-terra',
    ): HostedRuntimeAssistantConfigurationSnapshot => ({
      availableModels: [
        'gpt-5.6-luna',
        'gpt-5.6-terra',
        'gpt-5.6-sol',
      ],
      availableProviders: ['openai'],
      availableReasoningEfforts: ['low'],
      configurationAvailable: true,
      dormantSolPreference: false,
      model,
      provider: 'openai' as const,
      reasoningEffort: 'low' as const,
      solAvailable: true,
    })
    const currentSnapshot = groupSnapshot('gpt-5.6-sol')
    const updatedSnapshot = groupSnapshot('gpt-5.6-terra')
    const groupDeveloperInstructions = buildAssistantSystemPrompt({
      assistantCliContract: null,
      assistantContextSnapshotPrompt: null,
      assistantHostedDeviceConnectAvailable: false,
      assistantKnowledgeToolsAvailable: true,
      assistantStyleSettingsAvailable: true,
      channel: 'linq',
      cliAccess: {
        rawCommand: 'vault-cli',
        setupCommand: 'murph',
      },
      conversationScope: 'group',
      currentLocalDate: '2026-07-30',
      currentTimeZone: 'America/New_York',
      hostedRuntime: true,
      modelBehaviorProfile: 'gpt5-agentic',
      onboardingGuidance: false,
      turnTrigger: null,
    })
    expect(groupDeveloperInstructions).toContain(
      'select Luna, Terra, or Sol for the room',
    )
    expect(groupDeveloperInstructions).not.toContain(
      'Do not use or offer `murph.assistant_configuration` here',
    )
    scenario.stub.captureProviderRequestDiagnostics()
    scenario.stub.queue(
      {
        customToolCall: {
          input: `
const result = await tools.murph__assistant_configuration({
  action: "update",
  model: "gpt-5.6-terra",
});
text(JSON.stringify(result));
`,
          name: 'exec',
        },
      },
      { text: 'GROUP_MODEL_SWITCH_OK' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      developerInstructions: groupDeveloperInstructions,
      dynamicTools: [MURPH_GROUP_ASSISTANT_CONFIGURATION_TOOL],
      hostedToolContext: {
        assistantConfigurationTool: {
          request: async (request) => {
            configurationRequests.push(request)
            return request.action === 'read'
              ? { action: 'read', result: currentSnapshot }
              : {
                  action: 'update',
                  result: {
                    ...updatedSnapshot,
                    appliesAt: 'next_turn',
                    requiredPlan: null,
                    status: 'updated',
                  },
                }
          },
        },
        computerToolsAvailable: false,
        currentAssistantInputId: () => assistantInputId,
        currentAssistantTarget: () => ({
          model: 'gpt-5.6-sol',
          provider: 'openai',
          reasoningEffort: 'low',
        }),
        currentHostedDeliveryContext: () => null,
        currentHostedMailboxItemIds: () => [],
        currentUserActionScope: () => ({
          acceptedInputIds: [assistantInputId],
          conversationId: 'conversation-group',
          conversationScope: 'group',
          inboundMailboxItemIds: ['mailbox-group'],
          originSessionId: 'session-group',
          recipientKey: 'group:current',
        }),
        sendVaultFile: async () => {
          throw new Error('Vault-file sending is unavailable for this turn.')
        },
        vaultFileSendAvailable: false,
      },
      model: 'gpt-5.6-sol',
      prompt:
        'Use the current group room request to switch this room to Terra, then reply exactly GROUP_MODEL_SWITCH_OK.',
    })

    expect(configurationRequests).toEqual([
      {
        action: 'update',
        assistantInputId,
        model: 'gpt-5.6-terra',
      },
    ])
    const summaries = scenario.stub.requestSummariesSinceBaseline()
    expect(summaries[0]?.model).toBe('gpt-5.6-sol')
    expect(summaries[1]?.model).toBe('gpt-5.6-sol')
    expect(summaries[0]?.providerRequestDiagnostics).toMatchObject({
      includesAllTools: true,
    })
    const groupConfigurationOutput =
      summaries[1]?.customToolCallOutputs?.join('\n') ?? ''
    expect(groupConfigurationOutput).toContain('gpt-5.6-sol')
    expect(groupConfigurationOutput).toContain('gpt-5.6-terra')
    expect(groupConfigurationOutput).toContain('next_turn')
    expect(groupConfigurationOutput).toContain('updated')
    expect(result.finalMessage).toBe('GROUP_MODEL_SWITCH_OK')

    scenario.stub.queue({ text: 'GROUP_MODEL_NEXT_TURN_OK' })
    const nextTurn = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      developerInstructions: groupDeveloperInstructions,
      dynamicTools: [MURPH_GROUP_ASSISTANT_CONFIGURATION_TOOL],
      model: updatedSnapshot.model,
      prompt: 'Reply exactly GROUP_MODEL_NEXT_TURN_OK.',
      resumeSessionId: result.sessionId,
    })

    expect(scenario.stub.requestSummariesSinceBaseline()[2]?.model).toBe(
      'gpt-5.6-terra',
    )
    expect(nextTurn.finalMessage).toBe('GROUP_MODEL_NEXT_TURN_OK')
    expect(nextTurn.sessionId).toBe(result.sessionId)
    expect(scenario.stub.requestCountSinceBaseline()).toBe(3)
  })

  it('sends flex service tier through real Codex with the patched model catalog', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const modelCatalogJson = await writeOpenAiFlexModelCatalogJson({
      codexCommand: scenario.turnInput.codexCommand,
      directory: scenario.turnInput.codexHome,
    })
    scenario.stub.queue({ text: 'SCRIPTED_FLEX_OK' })

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      env: {
        ...scenario.turnInput.env,
        [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: modelCatalogJson,
      },
      prompt: 'Reply exactly SCRIPTED_FLEX_OK.',
      serviceTier: 'flex',
    })

    expect(result.finalMessage).toBe('SCRIPTED_FLEX_OK')
    expect(scenario.stub.requestSummariesSinceBaseline()).toEqual([
      {
        model: SCRIPTED_MODEL,
        serviceTier: 'flex',
      },
    ])
  })

  it('compacts the warm thread off-turn and keeps it resumable', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.queue({ text: 'COMPACT_SEED_OK' })
    const seeded = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly COMPACT_SEED_OK.',
      serviceTier: 'flex',
    })
    expect(seeded.finalMessage).toBe('COMPACT_SEED_OK')

    scenario.stub.queue({ text: 'COMPACT_STANDARD_OK' })
    const standard = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly COMPACT_STANDARD_OK.',
      resumeSessionId: seeded.sessionId,
    })
    expect(standard.finalMessage).toBe('COMPACT_STANDARD_OK')
    expect(standard.threadId).toBe(seeded.threadId)

    // Below threshold: no provider traffic, warm process untouched. The
    // reported size must be the real observed thread context from the latest
    // turn's tokenUsage events, not a placeholder.
    scenario.stub.markRequestBaseline()
    const skipped = await compactWarmCodexThread({
      minThreadTokens: 50_000,
      timeoutMs: 30_000,
    })
    expect(skipped).toMatchObject({
      kind: 'skipped',
      reason: 'below_threshold',
    })
    expect(
      skipped.kind === 'skipped' && typeof skipped.threadContextTokensBefore === 'number'
        && skipped.threadContextTokensBefore > 0,
    ).toBe(true)
    expect(scenario.stub.requestCountSinceBaseline()).toBe(0)

    // Above threshold: the local-provider compaction summarization request is
    // served by the stub and the thread reports compacted.
    scenario.stub.queue({ text: 'SCRIPTED_COMPACT_SUMMARY' })
    const compacted = await compactWarmCodexThread({
      minThreadTokens: 1,
      timeoutMs: 60_000,
    })
    expect(compacted).toMatchObject({
      kind: 'compacted',
      model: SCRIPTED_MODEL,
      serviceTier: null,
      threadId: seeded.threadId,
    })
    // Usage attribution must never regress to the zero-row production failure:
    // Codex 0.135 does not expose a compact-specific usage event, so the engine
    // records a nonzero lower-bound estimate from the pre-compact thread size.
    expect(compacted.kind).toBe('compacted')
    if (compacted.kind !== 'compacted') {
      throw new Error('Expected idle compaction to complete.')
    }
    expect(compacted.usage).toMatchObject({
      cachedInputTokens: null,
      inputTokens: expect.any(Number),
      outputTokens: null,
      source: 'estimated',
      totalTokens: expect.any(Number),
    })
    expect(compacted.usage.inputTokens).toBeGreaterThan(0)
    expect(compacted.usage.totalTokens).toBeGreaterThan(0)

    // Repeat guard: a successful compact clears the thread vitals, so an
    // immediate second idle pass must skip without provider traffic instead
    // of re-compacting the just-compacted thread.
    scenario.stub.markRequestBaseline()
    expect(
      await compactWarmCodexThread({
        minThreadTokens: 1,
        timeoutMs: 30_000,
      }),
    ).toEqual({
      kind: 'skipped',
      reason: 'no_thread_vitals',
      threadContextTokensBefore: null,
    })
    expect(scenario.stub.requestCountSinceBaseline()).toBe(0)

    // Cold-resume proof: kill the warm process so the resumed turn must
    // spawn fresh and reconstruct the COMPACTED thread from the rollout on
    // disk — the actual production payoff path (compact -> snapshot ->
    // container dies -> next wake resumes small).
    await stopWarmCodexAppServer('post-compact-cold-resume')
    scenario.stub.queue({ text: 'POST_COMPACT_OK' })
    const resumed = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly POST_COMPACT_OK.',
      resumeSessionId: seeded.sessionId,
    })
    expect(resumed.finalMessage).toBe('POST_COMPACT_OK')
    expect(resumed.threadId).toBe(seeded.threadId)
  })

  it('keeps a warm thread reusable when its model cannot be accounted', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.queue({ text: 'ACCOUNTABILITY_SEED_OK' })
    const seeded = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly ACCOUNTABILITY_SEED_OK.',
    })

    scenario.stub.markRequestBaseline()
    await expect(
      compactWarmCodexThread({
        canAccountForModel: () => false,
        minThreadTokens: 1,
        timeoutMs: 30_000,
      }),
    ).resolves.toMatchObject({
      kind: 'skipped',
      model: SCRIPTED_MODEL,
      reason: 'model_not_accountable',
      threadContextTokensBefore: expect.any(Number),
    })
    expect(scenario.stub.requestCountSinceBaseline()).toBe(0)

    scenario.stub.queue({ text: 'ACCOUNTABLE_COMPACT_SUMMARY' })
    await expect(
      compactWarmCodexThread({
        canAccountForModel: (model) => model === SCRIPTED_MODEL,
        minThreadTokens: 1,
        timeoutMs: 30_000,
      }),
    ).resolves.toMatchObject({
      kind: 'compacted',
      model: SCRIPTED_MODEL,
      threadId: seeded.threadId,
    })
  })

  it('skips off-turn compaction while a member turn is in flight', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.queue({
      delayMs: 2_000,
      text: 'MID_TURN_COMPACT_OK',
    })

    let midTurnCompact: Promise<Awaited<ReturnType<typeof compactWarmCodexThread>>> | null = null
    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      onLiveTurn: () => {
        // Attempt the idle compact while the real app-server is mid-request.
        midTurnCompact = delay(300).then(() =>
          compactWarmCodexThread({
            minThreadTokens: 1,
            timeoutMs: 5_000,
          }))
        return () => {}
      },
      prompt: 'Reply exactly MID_TURN_COMPACT_OK.',
    })

    expect(midTurnCompact).not.toBeNull()
    expect(await midTurnCompact).toEqual({
      kind: 'skipped',
      reason: 'turn_in_flight',
      threadContextTokensBefore: null,
    })
    // The member turn was never disturbed by the compact attempt.
    expect(result.finalMessage).toBe('MID_TURN_COMPACT_OK')
  })

  it('abort mid-compact kills the warm process and leaves the thread resumable', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.queue({ text: 'ABORT_SEED_OK' })
    const seeded = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly ABORT_SEED_OK.',
    })
    expect(seeded.finalMessage).toBe('ABORT_SEED_OK')

    // Hold the compaction summarization request open on the stub so the abort
    // arrives while the compact is genuinely in flight, then abort. This is
    // the wake path: it must settle promptly (process killed) instead of
    // waiting out the provider response or the compact timeout.
    scenario.stub.queue({
      delayMs: 8_000,
      text: 'NEVER_DELIVERED_COMPACT_SUMMARY',
    })
    const abortController = new AbortController()
    const abortTimer = setTimeout(() => abortController.abort(), 500)
    const abortedAt = Date.now()
    const aborted = await compactWarmCodexThread({
      minThreadTokens: 1,
      signal: abortController.signal,
      timeoutMs: 30_000,
    })
    clearTimeout(abortTimer)
    expect(aborted).toMatchObject({
      kind: 'failed',
      reason: 'aborted',
      threadId: seeded.threadId,
    })
    expect(Date.now() - abortedAt).toBeLessThan(5_000)

    // The aborted compact left the rollout uncompacted but intact: a fresh
    // spawn resumes the same thread. This is the wake-after-abort path, so it
    // must be bounded by kill teardown (3s SIGTERM ceiling) + process spawn —
    // never by the held-open provider request (8s) or the compact timeout
    // (30s). The bound below fails if the resume ever waits on either.
    scenario.stub.queue({ text: 'POST_ABORT_OK' })
    const resumeStartedAt = Date.now()
    const resumed = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly POST_ABORT_OK.',
      resumeSessionId: seeded.sessionId,
    })
    expect(Date.now() - resumeStartedAt).toBeLessThan(8_000)
    expect(resumed.finalMessage).toBe('POST_ABORT_OK')
    expect(resumed.threadId).toBe(seeded.threadId)
  })

  it('provider failure mid-compact fails bounded and leaves the thread resumable', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.queue({ text: 'FAIL_SEED_OK' })
    const seeded = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly FAIL_SEED_OK.',
    })
    expect(seeded.finalMessage).toBe('FAIL_SEED_OK')

    // No queued stub response: the compaction summarization request gets a
    // 500. The compact must fail within its bounded budget (never hang the
    // idle checkpoint) and poison the warm process.
    scenario.stub.markRequestBaseline()
    const failed = await compactWarmCodexThread({
      minThreadTokens: 1,
      timeoutMs: 10_000,
    })
    expect(failed).toMatchObject({
      kind: 'failed',
      threadId: seeded.threadId,
    })
    // The failure came from a real provider attempt, not a pre-flight skip.
    expect(scenario.stub.requestCountSinceBaseline()).toBeGreaterThanOrEqual(1)

    // The failed compact wrote nothing incomplete: a fresh spawn resumes the
    // same thread and serves the next member turn.
    scenario.stub.queue({ text: 'POST_FAILURE_OK' })
    const resumed = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly POST_FAILURE_OK.',
      resumeSessionId: seeded.sessionId,
    })
    expect(resumed.finalMessage).toBe('POST_FAILURE_OK')
    expect(resumed.threadId).toBe(seeded.threadId)
  })

  it('skips off-turn compaction when no warm process exists', async () => {
    await stopWarmCodexAppServer('test-no-warm-process')
    expect(
      await compactWarmCodexThread({
        minThreadTokens: 1,
        timeoutMs: 5_000,
      }),
    ).toEqual({
      kind: 'skipped',
      reason: 'no_warm_process',
      threadContextTokensBefore: null,
    })
  })

  it('switches model and reasoning on the next turn without changing threads', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.queue({ text: 'RESUME_FIRST_OK' })
    const first = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly RESUME_FIRST_OK.',
    })
    expect(first.finalMessage).toBe('RESUME_FIRST_OK')
    expect(first.sessionId).toEqual(expect.any(String))

    scenario.stub.queue({ text: 'RESUME_SECOND_OK' })
    scenario.stub.markRequestBaseline()
    const second = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      model: 'gpt-5.6-luna',
      prompt: 'Reply exactly RESUME_SECOND_OK.',
      reasoningEffort: 'high',
      resumeSessionId: first.sessionId,
    })

    expect(second.finalMessage).toBe('RESUME_SECOND_OK')
    expect(second.threadId).toBe(first.threadId)
    expect(second.rolloutRelativePath).toBe(first.rolloutRelativePath)
    expect(second.turnId).not.toBe(first.turnId)
    expect(scenario.stub.requestSummariesSinceBaseline()).toEqual([
      {
        model: 'gpt-5.6-luna',
        serviceTier: null,
      },
    ])
  })

  it('restores persisted dynamic tools on a real cold thread resume', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const progressUpdates: string[] = []
    const progressDelivery = {
      send: async (text: string) => {
        progressUpdates.push(text)
        return { kind: 'sent' as const, source: 'model' as const }
      },
    }
    const dynamicTools = resolveMurphDynamicTools({
      progressUpdatesAvailable: true,
    })

    scenario.stub.queue({ text: 'COLD_TOOL_SEED_OK' })
    const first = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools,
      progressDelivery,
      prompt: 'Reply exactly COLD_TOOL_SEED_OK.',
    })
    expect(first.finalMessage).toBe('COLD_TOOL_SEED_OK')

    await stopWarmCodexAppServer('dynamic-tool-cold-resume-proof')
    scenario.stub.queue(
      {
        functionCall: {
          arguments: { text: 'Cold-resume progress update.' },
          name: 'send_progress_update',
          namespace: 'murph',
        },
      },
      { text: 'COLD_TOOL_RESUME_OK' },
    )
    const resumed = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools,
      progressDelivery,
      prompt: 'Send one progress update, then reply exactly COLD_TOOL_RESUME_OK.',
      resumeSessionId: first.sessionId,
    })

    expect(resumed.finalMessage).toBe('COLD_TOOL_RESUME_OK')
    expect(resumed.threadId).toBe(first.threadId)
    expect(progressUpdates).toEqual(['Cold-resume progress update.'])
    expect(scenario.stub.requestCountSinceBaseline()).toBe(3)
  })

  it('relays murph dynamic tool calls through item/tool/call for real', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const progressUpdates: string[] = []
    scenario.stub.queue(
      {
        functionCall: {
          arguments: { text: 'Scripted progress update.' },
          name: 'send_progress_update',
          namespace: 'murph',
        },
      },
      { text: 'DYNAMIC_TOOL_OK' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      progressDelivery: {
        send: async (text) => {
          progressUpdates.push(text)
          return { kind: 'sent', source: 'model' }
        },
      },
      prompt: 'Send one progress update, then reply exactly DYNAMIC_TOOL_OK.',
    })

    expect(progressUpdates).toEqual(['Scripted progress update.'])
    expect(result.finalMessage).toBe('DYNAMIC_TOOL_OK')
    expect(scenario.stub.requestCountSinceBaseline()).toBe(2)
  })

  it('ends an accepted group email effect without another provider request', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const groupEmailRequests: unknown[] = []
    const groupEmailSendResultRecorder = vi.fn()
    const traceEvents: unknown[] = []
    scenario.stub.queue({
      commentaryAndFunctionCall: {
        commentary: 'Preparing the scheduled group update.',
        functionCall: {
          arguments: {
            action: 'send_email',
            html: '<p>Scheduled update</p>',
            subject: 'Scheduled update',
            text: 'Scheduled update',
          },
          name: 'group',
          namespace: 'murph',
        },
      },
    })

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools: resolveMurphDynamicTools({
        groupAvailable: true,
        progressUpdatesAvailable: false,
      }),
      hostedToolContext: {
        ...createScriptedGroupToolContext(async () => ({
          action: 'read_chat_participants',
          result: { participants: [], status: 'ok' },
        })),
        groupEmailEffect: {
          request: async (request) => {
            groupEmailRequests.push(request)
            return {
              action: 'send_email',
              result: {
                participantCount: 1,
                skippedNoEmailMemberIds: [],
                status: 'accepted',
              },
            }
          },
        },
        recordGroupEmailSendResult: groupEmailSendResultRecorder,
      },
      onTraceEvent: (event) => {
        traceEvents.push(event)
      },
      prompt: 'Send the prepared scheduled group email.',
    })

    expect(groupEmailRequests).toEqual([{
      action: 'send_email',
      html: '<p>Scheduled update</p>',
      subject: 'Scheduled update',
      text: 'Scheduled update',
    }])
    expect(result.finalAction).toEqual({ kind: 'none' })
    expect(result.finalMessage).toBe('')
    expect(JSON.stringify(traceEvents)).toContain(
      'Preparing the scheduled group update.',
    )
    expect(groupEmailSendResultRecorder).toHaveBeenCalledOnce()
    expect(scenario.stub.requestCountSinceBaseline()).toBe(1)
  })

  it.each([
    {
      contactCardFails: false,
      expectedFinal: 'The card is in the chat and the song is attached.',
      expectedGroupOutput: '"status":"sent"',
      name: 'both owners succeed',
    },
    {
      contactCardFails: true,
      expectedFinal: 'The contact card failed, but the song is attached.',
      expectedGroupOutput: 'group tool request failed',
      name: 'the contact-card owner fails',
    },
  ])(
    'carries an explicit contact-card and song request through the real tool loop when $name',
    { timeout: TURN_TIMEOUT_MS },
    async ({ contactCardFails, expectedFinal, expectedGroupOutput }) => {
      const scenario = await prepareScriptedTurnScenario()
      const groupRequests: unknown[] = []
      const songGenerations: unknown[] = []
      const songPrompt = 'A short upbeat group intro song.'
      scenario.stub.queue(
        {
          functionCall: {
            arguments: { action: 'share_contact_card' },
            name: 'group',
            namespace: 'murph',
          },
        },
        {
          functionCall: {
            arguments: {
              durationSeconds: 10,
              instrumental: false,
              prompt: songPrompt,
            },
            name: 'generate_song',
            namespace: 'murph',
          },
        },
        { text: expectedFinal },
      )

      const result = await executeCodexAppServerTurn({
        ...scenario.turnInput,
        dynamicTools: resolveMurphDynamicTools({
          groupAvailable: true,
          progressUpdatesAvailable: false,
          voiceMemoGenerationAvailable: true,
        }),
        hostedToolContext: createScriptedGroupToolContext(async (request) => {
          groupRequests.push(request)
          if (contactCardFails) {
            throw new Error('private upstream detail')
          }
          return {
            action: 'share_contact_card',
            result: { status: 'sent' },
          }
        }),
        prompt: 'Share your contact card and sing a short intro song.',
        voiceMemoRuntime: createScriptedSongRuntime(songGenerations),
      })

      expect(groupRequests).toEqual([{ action: 'share_contact_card' }])
      expect(songGenerations).toEqual([
        expect.objectContaining({
          durationMs: 10_000,
          forceInstrumental: false,
          kind: 'elevenlabs_music',
          prompt: songPrompt,
        }),
      ])
      expect(result.responseMedia).toEqual([
        {
          filename: 'explicit-group-song.mp3',
          kind: 'voice_memo',
          transcript: null,
          transport: {
            attachmentId: 'attachment_explicit_group_song',
            kind: 'linq_attachment',
          },
        },
      ])
      expect(result.finalMessage).toBe(expectedFinal)
      expect(result.finalMessage).not.toMatch(/Apple|provider limitation/iu)
      expect(
        scenario.stub.requestSummariesSinceBaseline()
          .flatMap((summary) => summary.functionCallOutputs ?? []),
      ).toEqual(expect.arrayContaining([
        expect.stringContaining(expectedGroupOutput),
        expect.stringContaining('generated song attached to the final response'),
      ]))
      expect(scenario.stub.requestCountSinceBaseline()).toBe(3)
    },
  )

  it('passes an advisory participant label through the real app-server tool loop only', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const groupRequests: unknown[] = []
    scenario.stub.queue(
      {
        functionCall: {
          arguments: { action: 'read_chat_participants' },
          name: 'group',
          namespace: 'murph',
        },
      },
      { text: 'GROUP_ROSTER_OK' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools: resolveMurphDynamicTools({
        groupAvailable: true,
        progressUpdatesAvailable: false,
      }),
      hostedToolContext: createScriptedGroupToolContext(async (request) => {
        groupRequests.push(request)
        return {
          action: 'read_chat_participants',
          result: {
            participants: [{
              handle: '+15550100200',
              hasOwnMurph: false,
              ownerAdvisoryName: 'Alex R.',
            }],
            status: 'ok',
          },
        }
      }),
      prompt: 'Read the current chat participants, then reply exactly GROUP_ROSTER_OK.',
    })

    expect(result.finalMessage).toBe('GROUP_ROSTER_OK')
    expect(groupRequests).toEqual([{ action: 'read_chat_participants' }])
    const functionCallOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.functionCallOutputs ?? [])
    expect(functionCallOutputs).toEqual(expect.arrayContaining([
      expect.stringContaining('"displayName":"Alex R."'),
    ]))
    expect(functionCallOutputs.join('\n')).not.toContain('ownerAdvisoryName')
    expect(functionCallOutputs.join('\n')).not.toContain('unverifiedOwnerContactLabel')
  })

  it('threads exact participant authority through the real group-effect dispatcher', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const messageRef = `ain_${'d'.repeat(32)}`
    const participant = {
      assistantInputId: messageRef,
      senderHandle: '+15550100201',
      source: 'linq' as const,
    }
    const authorizations: unknown[] = []
    const groupRequests: unknown[] = []
    const phoneCallStarts: unknown[] = []
    const userActionScope = {
      acceptedInputIds: [messageRef],
      conversationId: 'conversation_group_effect',
      conversationScope: 'group' as const,
      inboundMailboxItemIds: ['mailbox_group_effect'],
      originSessionId: 'session_group_effect',
      recipientKey: 'recipient_group_effect',
    }
    const hostedToolContext: AssistantHostedToolContext = {
      computerToolsAvailable: false,
      currentHostedDeliveryContext: () => null,
      currentHostedMailboxItemIds: () => [],
      currentUserActionScope: () => userActionScope,
      groupTool: {
        request: async (request) => {
          groupRequests.push(request)
          return {
            action: 'revoke_own_email_share',
            result: { revokedCount: 1, status: 'revoked' },
          }
        },
      },
      phoneCalls: {
        start: async (input) => {
          phoneCallStarts.push(input)
          return {
            phoneCallId: 'hpc_group_effect',
            status: 'calling',
          }
        },
      },
      sendVaultFile: async () => {
        throw new Error('Vault-file sending is unavailable for this turn.')
      },
      vaultFileSendAvailable: false,
    }
    scenario.stub.queue(
      {
        functionCall: {
          arguments: {
            action: 'revoke_own_email_share',
            message_ref: messageRef,
          },
          name: 'group',
          namespace: 'murph',
        },
      },
      {
        functionCall: {
          arguments: {
            allowTransferToUser: false,
            callerName: 'Murph',
            goal: 'Confirm the office opening time.',
            instructions: ['Ask only for the opening time.'],
            message_ref: messageRef,
            shareableFacts: {},
            successCriteria: 'The office states its opening time.',
            timeZone: 'America/New_York',
            to: {
              label: 'The office',
              phoneNumber: '+12125550123',
            },
          },
          name: 'create_phone_call',
          namespace: 'murph',
        },
      },
      {
        functionCall: {
          arguments: {
            action: 'revoke_own_email_share',
            message_ref: `ain_${'f'.repeat(32)}`,
          },
          name: 'group',
          namespace: 'murph',
        },
      },
      { text: 'PARTICIPANT_EFFECTS_OK' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      authorizeAcceptedMessageTarget: async (input) => {
        authorizations.push(input)
        if (input.messageRef !== messageRef) {
          return null
        }
        return {
          participant,
          targetInputId: messageRef,
        }
      },
      dynamicTools: resolveMurphDynamicTools({
        groupAvailable: true,
        messageTargetingAvailable: true,
        phoneCallsAvailable: true,
        progressUpdatesAvailable: false,
      }),
      hostedToolContext,
      prompt: 'Revoke email sharing and place the approved group call.',
    })

    expect(result.finalMessage).toBe('PARTICIPANT_EFFECTS_OK')
    expect(authorizations).toEqual([
      {
        action: 'participant-effect',
        deliveryContextOrdinal: 0,
        messageRef,
      },
      {
        action: 'participant-effect',
        deliveryContextOrdinal: 0,
        messageRef,
      },
      {
        action: 'participant-effect',
        deliveryContextOrdinal: 0,
        messageRef: `ain_${'f'.repeat(32)}`,
      },
    ])
    expect(groupRequests).toEqual([{
      action: 'revoke_own_email_share',
      participant,
    }])
    expect(phoneCallStarts).toEqual([
      expect.objectContaining({
        groupRequester: participant,
        requestKey: expect.stringMatching(/^phone_call_[a-f0-9]{64}$/u),
      }),
    ])
  })

  it('uses the live-steered delivery ordinal for exact participant authority', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const messageRef = `ain_${'e'.repeat(32)}`
    const authorizations: unknown[] = []
    let steered: Promise<void> | null = null
    scenario.stub.queue(
      {
        delayMs: 2_000,
        text: 'STEER_PARTICIPANT_FIRST_REPLY',
      },
      {
        functionCall: {
          arguments: {
            action: 'revoke_own_email_share',
            message_ref: messageRef,
          },
          name: 'group',
          namespace: 'murph',
        },
      },
      { text: 'STEER_PARTICIPANT_OK' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      authorizeAcceptedMessageTarget: async (input) => {
        authorizations.push(input)
        return {
          participant: {
            assistantInputId: messageRef,
            senderHandle: '+15550100202',
            source: 'linq',
          },
          targetInputId: messageRef,
        }
      },
      dynamicTools: resolveMurphDynamicTools({
        groupAvailable: true,
        messageTargetingAvailable: true,
        progressUpdatesAvailable: false,
      }),
      hostedToolContext: {
        ...createScriptedGroupToolContext(async () => ({
          action: 'revoke_own_email_share',
          result: { revokedCount: 1, status: 'revoked' },
        })),
        currentUserActionScope: () => ({
          acceptedInputIds: [messageRef],
          conversationId: 'conversation_live_group_effect',
          conversationScope: 'group',
          inboundMailboxItemIds: ['mailbox_live_group_effect'],
          originSessionId: 'session_live_group_effect',
          recipientKey: 'recipient_live_group_effect',
        }),
      },
      onLiveTurn: (turn: CodexAppServerLiveTurn) => {
        steered = delay(500).then(() =>
          turn.steer({ prompt: 'The group participant now requests revocation.' }))
      },
      prompt: 'Wait for the group participant request.',
    })

    expect(steered).not.toBeNull()
    await steered
    expect(result.finalMessage).toBe('STEER_PARTICIPANT_OK')
    expect(authorizations).toEqual([{
      action: 'participant-effect',
      deliveryContextOrdinal: 1,
      messageRef,
    }])
  })

  it('captures scripted reaction tool calls from the real app-server protocol', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const messageRef = `ain_${'c'.repeat(32)}`
    const authorizations: unknown[] = []
    scenario.stub.queue(
      {
        functionCall: {
          arguments: {
            message_ref: messageRef,
            reaction: 'heart',
          },
          name: 'react_to_message',
          namespace: 'murph',
        },
      },
      { text: 'REACTION_TOOL_OK' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      authorizeAcceptedMessageTarget: async (input) => {
        authorizations.push(input)
        return { targetInputId: messageRef }
      },
      dynamicTools: resolveMurphDynamicTools({
        messageTargetingAvailable: true,
        progressUpdatesAvailable: false,
      }),
      prompt: 'React with a heart, then reply exactly REACTION_TOOL_OK.',
    })

    expect(result.finalMessage).toBe('REACTION_TOOL_OK')
    expect(result.reactions).toEqual([
      {
        deliveryContextOrdinal: 0,
        reaction: 'heart',
        targetInputId: messageRef,
      },
    ])
    expect(authorizations).toEqual([{
      action: 'reaction',
      deliveryContextOrdinal: 0,
      messageRef,
    }])
    expect(scenario.stub.requestCountSinceBaseline()).toBe(2)
  })

  it('enforces the murph.ask_grok per-turn provider-call ceiling through the real tool loop', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    let xaiProviderCalls = 0
    const xaiFetch: typeof fetch = async () => {
      xaiProviderCalls += 1
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              call_id: 'call_xsearch_1',
              id: 'xsearch_1',
              input: '{"query":"creatine"}',
              name: 'x_keyword_search',
              status: 'completed',
              type: 'custom_tool_call',
            },
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: 'People mostly say creatine timing does not matter much.',
                },
              ],
            },
          ],
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    const askGrokCall = {
      functionCall: {
        arguments: { question: 'what are people saying about creatine?' },
        name: 'ask_grok',
        namespace: 'murph',
      },
    } as const
    scenario.stub.queue(
      askGrokCall,
      askGrokCall,
      askGrokCall,
      askGrokCall,
      { text: 'X_SEARCH_CEILING_OK' },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      dynamicTools: resolveMurphDynamicTools({
        progressUpdatesAvailable: false,
        askGrokAvailable: true,
      }),
      prompt: 'Search X four times, then reply exactly X_SEARCH_CEILING_OK.',
      askGrokRuntime: createAskGrokToolRuntimeFromEnv({
        env: { XAI_API_KEY: 'xai-sentinel-key' },
        fetchImpl: xaiFetch,
      }),
    })

    expect(result.finalMessage).toBe('X_SEARCH_CEILING_OK')
    // Four tool calls flowed through the real turn executor, but the shared
    // turn-scoped counter allowed exactly three provider requests.
    expect(xaiProviderCalls).toBe(3)
    expect(scenario.stub.requestCountSinceBaseline()).toBe(5)
    const functionCallOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.functionCallOutputs ?? [])
    expect(functionCallOutputs).toEqual(expect.arrayContaining([
      expect.stringContaining('untrusted third-party content'),
      expect.stringContaining(
        'X search limit of 3 searches reached for this turn; no search ran',
      ),
    ]))
  })

  it('steers a live turn while the real app-server is mid-request', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.queue(
      {
        delayMs: 2_000,
        text: 'STEER_FIRST_REPLY',
      },
      { text: 'STEER_FINAL_OK' },
    )

    let steered: Promise<void> | null = null
    let liveTurnReleased = 0
    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      onLiveTurn: (turn: CodexAppServerLiveTurn) => {
        expect(turn.threadId).toEqual(expect.any(String))
        expect(turn.turnId).toEqual(expect.any(String))
        // Steer shortly after the turn goes live so the real app-server has
        // registered the active turn before the turn/steer precondition check.
        steered = delay(500).then(() =>
          turn.steer({ prompt: 'Also acknowledge the steered input.' }))
        return () => {
          liveTurnReleased += 1
        }
      },
      prompt: 'Reply to the first message.',
    })

    expect(steered).not.toBeNull()
    await steered
    expect(result.finalMessage).toBe('STEER_FINAL_OK')
    expect(result.threadId).toEqual(expect.any(String))
    expect(result.turnId).toEqual(expect.any(String))
    expect(liveTurnReleased).toBe(1)
    expect(scenario.stub.requestCountSinceBaseline()).toBe(2)
  })
})

function createScriptedGroupToolContext(
  request: NonNullable<AssistantHostedToolContext['groupTool']>['request'],
): AssistantHostedToolContext {
  return {
    computerToolsAvailable: false,
    currentHostedDeliveryContext: () => null,
    currentHostedMailboxItemIds: () => [],
    groupTool: { request },
    sendVaultFile: async () => {
      throw new Error('Vault-file sending is unavailable for this turn.')
    },
    vaultFileSendAvailable: false,
  }
}

function createScriptedSongRuntime(
  generations: unknown[],
): VoiceMemoToolRuntime {
  return {
    elevenLabs: {
      apiKeyAvailable: true,
      modelId: 'eleven_multilingual_v2',
      voiceId: 'voice_murph',
    },
    generateAndUpload: async (input) => {
      generations.push(input.generation)
      return {
        attachmentId: 'attachment_explicit_group_song',
        filename: 'explicit-group-song.mp3',
      }
    },
    kind: 'linq',
  }
}

function buildScriptedHostedSystemPrompt(
  conversationScope: 'direct' | 'group',
  onboardingGuidance = false,
  scheduledOccurrenceAt?: string,
  assistantContextSnapshotPrompt?: string,
): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: 'Stable CLI contract for scripted hosted proof.',
    assistantContextSnapshotPrompt: assistantContextSnapshotPrompt ?? null,
    assistantHostedDeviceConnectAvailable: true,
    assistantHostedDeviceConnectProviders: [],
    assistantKnowledgeToolsAvailable: true,
    channel: 'telegram',
    cliAccess: {
      rawCommand: 'vault-cli',
      setupCommand: 'murph',
    },
    conversationScope,
    currentLocalDate: '2026-07-30',
    currentTimeZone: 'America/New_York',
    hostedRuntime: true,
    modelBehaviorProfile: 'gpt5-agentic',
    onboardingGuidance,
    ordinaryInboundTurn: scheduledOccurrenceAt === undefined,
    scheduledOccurrenceAt,
    turnTrigger: scheduledOccurrenceAt === undefined
      ? 'automation-auto-reply'
      : 'automation-cron',
  })
}

async function prepareScriptedTurnScenario(
  options: {
    multiAgentV2?: boolean
  } = {},
): Promise<{
  stub: ScriptedStub
  turnInput: {
    codexCommand: string
    codexHome: string
    env: NodeJS.ProcessEnv
    model: string
    modelProvider: string
    reasoningEffort: string
    sandbox: 'workspace-write'
    workingDirectory: string
  }
}> {
  const scriptedStub = await requireScriptedStub()
  scriptedStub.markRequestBaseline()
  const codexHome = await mkdtemp(path.join(tmpdir(), 'murph-codex-scripted-home-'))
  temporaryPaths.push(codexHome)
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), 'murph-codex-scripted-workspace-'),
  )
  temporaryPaths.push(workingDirectory)
  await writeFile(
    path.join(codexHome, 'config.toml'),
    buildScriptedCodexConfigToml(scriptedStub.baseUrl, options),
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  )

  return {
    stub: scriptedStub,
    turnInput: {
      codexCommand,
      codexHome,
      env: {
        [SCRIPTED_STUB_KEY_ENV]: 'scripted-local-key',
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
      },
      model: SCRIPTED_MODEL,
      modelProvider: SCRIPTED_MODEL_PROVIDER,
      reasoningEffort: 'low',
      sandbox: 'workspace-write',
      workingDirectory,
    },
  }
}

async function writeOpenAiFlexModelCatalogJson(input: {
  codexCommand: string
  directory: string
}): Promise<string> {
  const { stdout } = await execFileAsync(
    input.codexCommand,
    ['debug', 'models', '--bundled'],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  const catalog = readRecord(JSON.parse(stdout))
  const models = Array.isArray(catalog?.models) ? catalog.models : []
  const targetModel = models
    .map(readRecord)
    .find((model) => model?.slug === SCRIPTED_MODEL)
  if (!targetModel) {
    throw new Error(`Bundled Codex model catalog did not include ${SCRIPTED_MODEL}.`)
  }

  const serviceTiers = Array.isArray(targetModel.service_tiers)
    ? targetModel.service_tiers
    : []
  const hasFlex = serviceTiers
    .map(readRecord)
    .some((tier) => tier?.id === 'flex')
  if (!hasFlex) {
    targetModel.service_tiers = [
      ...serviceTiers,
      {
        description: 'Lower-cost flexible processing',
        id: 'flex',
        name: 'Flex',
      },
    ]
  }

  const modelCatalogJson = path.join(
    input.directory,
    'codex-model-catalog.openai-flex.json',
  )
  await writeFile(modelCatalogJson, `${JSON.stringify(catalog)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  return modelCatalogJson
}

function buildScriptedCodexConfigToml(
  baseUrl: string,
  options: {
    multiAgentV2?: boolean
  } = {},
): string {
  return [
    `model = "${SCRIPTED_MODEL}"`,
    `model_provider = "${SCRIPTED_MODEL_PROVIDER}"`,
    'model_reasoning_effort = "low"',
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    'check_for_update_on_startup = false',
    '',
    '[history]',
    'persistence = "none"',
    '',
    `[model_providers.${SCRIPTED_MODEL_PROVIDER}]`,
    'name = "Local scripted stub"',
    `base_url = "${baseUrl}"`,
    `env_key = "${SCRIPTED_STUB_KEY_ENV}"`,
    'wire_api = "responses"',
    'requires_openai_auth = false',
    'request_max_retries = 4',
    'stream_max_retries = 5',
    '',
    ...(options.multiAgentV2
      ? [
          '[features.multi_agent_v2]',
          'enabled = true',
          'max_concurrent_threads_per_session = 4',
          '',
        ]
      : []),
  ].join('\n')
}

async function startScriptedResponsesStub(): Promise<ScriptedStub> {
  const queuedResponses: ScriptedResponse[] = []
  const requestSummaries: ScriptedProviderRequestSummary[] = []
  const completedResponseLabels: string[] = []
  let responseSequence = 0
  let responsesRequestCount = 0
  let requestBaseline = 0
  let requestSummaryBaseline = 0
  let providerRequestDiagnosticsEnabled = false

  const server: Server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.statusCode = 404
      response.end(JSON.stringify({ error: `unhandled ${request.method} ${request.url}` }))
      return
    }

    let requestBody = ''
    for await (const chunk of request) {
      requestBody += typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk).toString('utf8')
    }
    responsesRequestCount += 1
    requestSummaries.push(readScriptedProviderRequestSummary(
      requestBody,
      providerRequestDiagnosticsEnabled,
    ))
    const scriptedResponseIndex = queuedResponses.findIndex((candidate) =>
      scriptedResponseMatchesRequest(candidate, requestBody)
    )
    const scripted = scriptedResponseIndex >= 0
      ? queuedResponses.splice(scriptedResponseIndex, 1)[0]
      : undefined
    if (!scripted) {
      response.statusCode = 500
      response.end(JSON.stringify({
        error: 'scripted responses stub received a request without a queued response',
      }))
      return
    }

    if (scripted.delayMs) {
      await new Promise((resolve) => {
        setTimeout(resolve, scripted.delayMs)
      })
    }

    responseSequence += 1
    const responseId = `resp_scripted_${responseSequence}`
    const outputItems = 'commentaryAndFunctionCall' in scripted
      ? [
          {
            content: [
              {
                annotations: [],
                text: scripted.commentaryAndFunctionCall.commentary,
                type: 'output_text',
              },
            ],
            id: `msg_${responseId}_commentary`,
            phase: 'commentary',
            role: 'assistant',
            status: 'completed',
            type: 'message',
          },
          {
            arguments: JSON.stringify(
              scripted.commentaryAndFunctionCall.functionCall.arguments,
            ),
            call_id: `call_${responseId}_group_email`,
            id: `fcall_${responseId}_group_email`,
            name: scripted.commentaryAndFunctionCall.functionCall.name,
            ...(scripted.commentaryAndFunctionCall.functionCall.namespace
              ? {
                  namespace:
                    scripted.commentaryAndFunctionCall.functionCall.namespace,
                }
              : {}),
            status: 'completed',
            type: 'function_call',
          },
        ]
      : [
          'toolSearchCall' in scripted
            ? {
                arguments: {
                  query: scripted.toolSearchCall.query,
                  ...(scripted.toolSearchCall.limit === undefined
                    ? {}
                    : { limit: scripted.toolSearchCall.limit }),
                },
                call_id: `call_${responseId}`,
                execution: 'client',
                id: `tsearch_${responseId}`,
                status: 'completed',
                type: 'tool_search_call',
              }
            : 'customToolCall' in scripted
              ? {
                  call_id: `call_${responseId}`,
                  id: `ctcall_${responseId}`,
                  input: scripted.customToolCall.input,
                  name: scripted.customToolCall.name,
                  status: 'completed',
                  type: 'custom_tool_call',
                }
              : 'functionCall' in scripted
                ? {
                    arguments: JSON.stringify(scripted.functionCall.arguments),
                    call_id: `call_${responseId}`,
                    id: `fcall_${responseId}`,
                    name: scripted.functionCall.name,
                    ...(scripted.functionCall.namespace
                      ? { namespace: scripted.functionCall.namespace }
                      : {}),
                    status: 'completed',
                    type: 'function_call',
                  }
                : {
                    content: [
                      {
                        annotations: [],
                        text: scripted.text,
                        type: 'output_text',
                      },
                    ],
                    id: `msg_${responseId}`,
                    role: 'assistant',
                    status: 'completed',
                    type: 'message',
                  },
        ]
    writeScriptedSseResponse({
      outputItems,
      response,
      responseId,
    })
    if (scripted.completionLabel) {
      completedResponseLabels.push(scripted.completionLabel)
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Expected the scripted responses stub to bind a TCP port.')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    captureProviderRequestDiagnostics: () => {
      providerRequestDiagnosticsEnabled = true
    },
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    },
    completedResponseLabelsSinceBaseline: () => [...completedResponseLabels],
    markRequestBaseline: () => {
      completedResponseLabels.splice(0)
      providerRequestDiagnosticsEnabled = false
      requestBaseline = responsesRequestCount
      requestSummaryBaseline = requestSummaries.length
    },
    queue: (...responses) => {
      queuedResponses.push(...responses)
    },
    resetQueue: () => {
      queuedResponses.splice(0)
    },
    requestCountSinceBaseline: () => responsesRequestCount - requestBaseline,
    requestSummariesSinceBaseline: () =>
      requestSummaries.slice(requestSummaryBaseline),
  }
}

function scriptedResponseMatchesRequest(
  response: ScriptedResponse,
  requestBody: string,
): boolean {
  return (response.requestIncludes ?? []).every((value) =>
    requestBody.includes(value)
  ) && (response.requestExcludes ?? []).every((value) =>
    !requestBody.includes(value)
  )
}

function readScriptedProviderRequestSummary(
  requestBody: string,
  includeDiagnostics: boolean,
): ScriptedProviderRequestSummary {
  const body = readRecord(JSON.parse(requestBody))
  const customToolCallOutputs = Array.isArray(body?.input)
    ? body.input
      .map(readRecord)
      .filter((item) => item?.type === 'custom_tool_call_output')
      .map((item) => readProviderToolOutputText(item?.output))
      .filter((output): output is string => output !== null)
    : []
  const functionCallOutputs = Array.isArray(body?.input)
    ? body.input
      .map(readRecord)
      .filter((item) => item?.type === 'function_call_output')
      .map((item) => readString(item?.output))
      .filter((output): output is string => output !== null)
    : []
  const toolSearchOutputTools = Array.isArray(body?.input)
    ? body.input
      .map(readRecord)
      .filter((item) => item?.type === 'tool_search_output')
      .flatMap((item) => Array.isArray(item?.tools) ? item.tools : [])
    : []
  const tools = Array.isArray(body?.tools)
    ? body.tools.map(readRecord)
    : []
  return {
    ...(customToolCallOutputs.length > 0 ? { customToolCallOutputs } : {}),
    ...(functionCallOutputs.length > 0 ? { functionCallOutputs } : {}),
    model: readString(body?.model),
    ...(includeDiagnostics
      ? {
          providerRequestDiagnostics: {
            bytes: Buffer.byteLength(requestBody),
            includesAllTools: requestBody.includes('ALL_TOOLS'),
            includesAutomation: requestBody.includes('"name":"automation"'),
            includesGroup: requestBody.includes('"name":"group"'),
            includesReadShared: requestBody.includes('read_shared'),
            includesResponseCardCompactTableShape: [
              'compact_table',
              'columns',
              'rowHeader',
              'rows',
              'values',
              'tracking',
              'snapshotAt',
            ].every((field) => requestBody.includes(field)),
            includesResponseCardNutritionV2Shape: [
              'daily_nutrition',
              'fiberGrams',
              'goals',
              'status',
              'target',
              'totals',
            ].every((field) => requestBody.includes(field)),
            includesGroupEmail: requestBody.includes('send_email'),
            includesToolSearch: tools.some((tool) => tool?.type === 'tool_search'),
          },
        }
      : {}),
    serviceTier: readString(body?.service_tier),
    ...(toolSearchOutputTools.length > 0 ? { toolSearchOutputTools } : {}),
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readProviderToolOutputText(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return null
  }

  const textItems = value
    .map(readRecord)
    .map((item) => readString(item?.text))
    .filter((text): text is string => text !== null)
  return textItems.length > 0 ? textItems.join('\n') : null
}

function writeScriptedSseResponse(input: {
  outputItems: readonly Record<string, unknown>[]
  response: ServerResponse
  responseId: string
}): void {
  const usage = {
    input_tokens: 12,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 7,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 19,
  }
  const completedResponse = {
    created_at: Math.floor(Date.now() / 1000),
    id: input.responseId,
    model: SCRIPTED_MODEL,
    output: input.outputItems,
    status: 'completed',
    usage,
  }

  input.response.statusCode = 200
  input.response.setHeader('cache-control', 'no-cache')
  input.response.setHeader('content-type', 'text/event-stream; charset=utf-8')
  writeScriptedSseEvent(input.response, 'response.created', {
    response: {
      ...completedResponse,
      output: [],
      status: 'in_progress',
    },
    type: 'response.created',
  })
  for (const [outputIndex, outputItem] of input.outputItems.entries()) {
    writeScriptedSseEvent(input.response, 'response.output_item.added', {
      item: {
        ...outputItem,
        status: 'in_progress',
      },
      output_index: outputIndex,
      type: 'response.output_item.added',
    })
    writeScriptedSseEvent(input.response, 'response.output_item.done', {
      item: outputItem,
      output_index: outputIndex,
      type: 'response.output_item.done',
    })
  }
  writeScriptedSseEvent(input.response, 'response.completed', {
    response: completedResponse,
    type: 'response.completed',
  })
  input.response.write('data: [DONE]\n\n')
  input.response.end()
}

function writeScriptedSseEvent(
  response: ServerResponse,
  event: string,
  payload: Record<string, unknown>,
): void {
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}
