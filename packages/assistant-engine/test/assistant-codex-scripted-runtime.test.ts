import { execFile } from 'node:child_process'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
import { afterAll, afterEach, describe, expect, it } from 'vitest'

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
import type {
  VoiceMemoToolRuntime,
} from '../src/assistant-codex/generate-voice-memo-tool.ts'
import {
  createAskGrokToolRuntimeFromEnv,
} from '../src/assistant-codex/ask-grok-tool.ts'
import type {
  AssistantHostedToolContext,
} from '../src/assistant/hosted-tool-context.ts'
import { sendAssistantAskContinuationLocal } from '../src/assistant/ask-continuation.ts'
import { conversationRefFromBinding } from '../src/assistant/conversation-ref.ts'
import { listAssistantOutboxIntents } from '../src/assistant/outbox.ts'
import { resolveAssistantSession } from '../src/assistant/store.ts'
import {
  buildAssistantSystemPrompt,
} from '../src/assistant/system-prompt.ts'

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

interface ScriptedResponseRoute {
  completionLabel?: string
  delayMs?: number
  requestExcludes?: readonly string[]
  requestIncludes?: readonly string[]
}

type ScriptedResponse = ScriptedResponseRoute & (
  | { text: string }
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
    includesSaveNewsletter: boolean
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
})

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
    await writeFile(fakeVaultCli, `#!/bin/sh
printf '%s\\n' "$*" >> "vault-cli-invocations.log"
case "$*" in
  *food*search-labels-batch*)
    printf '%s\\n' '{"ok":true,"results":[{"query":"rolled oats","items":[{"id":"fdc:oats-1","name":"Rolled oats","serving":{"amount":100,"unit":"g"},"nutrition":{"basis":"per_100_g","rows":[{"name":"Calories","unit":"kcal","value":389},{"name":"Protein","unit":"g","value":16.9},{"name":"Carbohydrate","unit":"g","value":66.3},{"name":"Fat","unit":"g","value":6.9},{"name":"Fiber","unit":"g","value":10.6}]}}]},{"query":"Example plain kefir","items":[{"id":"fdc:kefir-1","name":"Example plain kefir","serving":{"amount":240,"unit":"g"},"nutrition":{"basis":"per_100_g","rows":[{"name":"Calories","unit":"kcal","value":62.5},{"name":"Protein","unit":"g","value":4.17},{"name":"Carbohydrate","unit":"g","value":5},{"name":"Fat","unit":"g","value":2.08},{"name":"Fiber","unit":"g","value":0}]}}]}]}'
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
        requestIncludes: ['Increase `--limit` only for an ambiguous match'],
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
        requestIncludes: ['fdc:oats-1', 'fdc:kefir-1'],
      },
      {
        requestIncludes: ['meal_scripted_mixed'],
        text: 'Logged it: about 345 calories, 18g protein, 45g carbs, 8g fat, and 5g fiber, based on 50g oats and one 240g kefir serving.',
      },
    )

    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      baseInstructions: buildScriptedHostedSystemPrompt('direct'),
      env: {
        ...scenario.turnInput.env,
      },
      prompt: 'Log a synthetic meal of 50 g rolled oats and one 240 g serving of Example plain kefir, then give me the nutrition summary.',
    })

    expect(result.finalMessage).toBe(
      'Logged it: about 345 calories, 18g protein, 45g carbs, 8g fat, and 5g fiber, based on 50g oats and one 240g kefir serving.',
    )
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
    const toolOutputs = scenario.stub.requestSummariesSinceBaseline()
      .flatMap((summary) => summary.customToolCallOutputs ?? [])
      .join('\n')
    expect(toolOutputs).toContain('The default returns one compact')
    expect(toolOutputs).toContain('fdc:oats-1')
    expect(toolOutputs).toContain('fdc:kefir-1')
    expect(toolOutputs).toContain('meal_scripted_mixed')
    expect(scenario.stub.requestCountSinceBaseline()).toBe(4)
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
if (!tool) {
  text(JSON.stringify({ found: false }));
} else {
  const result = await tools.murph__automation({
    action: "save",
    instructions: "Send a short reminder.",
    schedule: { kind: "dailyLocal", localTime: "09:00" },
    title: "Morning reminder",
  });
  text(JSON.stringify({ found: true, result }));
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
            automationRequests.push(request)
            return {
              action: 'save',
              automationId: 'automation-native-deferred',
              created: true,
              lookupId: 'morning-reminder',
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
      prompt: 'Save the reminder, then reply exactly NATIVE_DEFERRED_TOOL_OK.',
    })

    const summaries = scenario.stub.requestSummariesSinceBaseline()
    expect(summaries[0]).toMatchObject({
      providerRequestDiagnostics: {
        includesAllTools: true,
        includesAutomation: false,
        includesGroup: false,
        includesSaveNewsletter: false,
      },
    })
    expect(summaries[0]?.providerRequestDiagnostics?.bytes).toBeGreaterThan(0)
    const automationOutput =
      summaries[1]?.customToolCallOutputs?.join('\n') ?? ''
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
        includesSaveNewsletter: true,
      },
    })
    expect(
      (directSummary?.providerRequestDiagnostics?.bytes ?? 0)
        - deferredRequestBytes,
    ).toBeGreaterThan(4_000)
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
            automationRequests.push(request)
            return {
              action: 'save',
              automationId: 'automation-native-search',
              created: true,
              lookupId: 'morning-reminder',
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
      model: 'gpt-5.4',
      prompt: 'Save the reminder, then reply exactly NATIVE_TOOL_SEARCH_OK.',
    })

    const summaries = scenario.stub.requestSummariesSinceBaseline()
    expect(summaries[0]).toMatchObject({
      model: 'gpt-5.4',
      providerRequestDiagnostics: {
        includesAllTools: false,
        includesAutomation: false,
        includesGroup: false,
        includesSaveNewsletter: false,
        includesToolSearch: true,
      },
    })
    expect(JSON.stringify(summaries[1]?.toolSearchOutputTools)).toContain(
      '"name":"automation"',
    )
    expect(automationRequests).toEqual([{
      action: 'save',
      instructions: 'Send a short reminder.',
      schedule: { kind: 'dailyLocal', localTime: '09:00' },
      title: 'Morning reminder',
    }])
    expect(result.finalMessage).toBe('NATIVE_TOOL_SEARCH_OK')
    expect(scenario.stub.requestCountSinceBaseline()).toBe(3)
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
        includesSaveNewsletter: false,
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
    const previewAuthorityChecks: unknown[] = []
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
      currentGroupPhoneCallPreviewAuthority: async (input) => {
        previewAuthorityChecks.push(input)
        return input?.confirmationInputId === messageRef
          ? { assistantInputId: messageRef }
          : null
      },
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
    expect(previewAuthorityChecks).toEqual([{
      brief: {
        allowTransferToUser: false,
        callerName: 'Murph',
        goal: 'Confirm the office opening time.',
        instructions: ['Ask only for the opening time.'],
        shareableFacts: {},
        successCriteria: 'The office states its opening time.',
        timeZone: 'America/New_York',
        to: {
          label: 'The office',
          phoneNumber: '+12125550123',
        },
      },
      confirmationInputId: messageRef,
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
): string {
  return buildAssistantSystemPrompt({
    assistantCliContract: 'Stable CLI contract for scripted hosted proof.',
    assistantContextSnapshotPrompt: null,
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
    onboardingGuidance: false,
    ordinaryInboundTurn: true,
    turnTrigger: 'automation-auto-reply',
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
    const outputItem = 'toolSearchCall' in scripted
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
        }
    writeScriptedSseResponse({
      outputItem,
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
            includesSaveNewsletter: requestBody.includes('save_newsletter'),
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
  outputItem: Record<string, unknown>
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
    output: [input.outputItem],
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
  writeScriptedSseEvent(input.response, 'response.output_item.added', {
    item: {
      ...input.outputItem,
      status: 'in_progress',
    },
    output_index: 0,
    type: 'response.output_item.added',
  })
  writeScriptedSseEvent(input.response, 'response.output_item.done', {
    item: input.outputItem,
    output_index: 0,
    type: 'response.output_item.done',
  })
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
