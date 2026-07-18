import { execFile } from 'node:child_process'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import {
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from '@murphai/hosted-execution/env'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import {
  compactWarmCodexThread,
  executeCodexAppServerTurn as executeCodexAppServerTurnUnchecked,
  resolveMurphDynamicTools,
  stopWarmCodexAppServer,
  type CodexAppServerTurnInput,
} from '../src/assistant-codex.ts'
import {
  resolveMurphScheduledDynamicTools,
} from '../src/assistant-codex/dynamic-tools.ts'
import {
  ASSISTANT_SCHEDULED_TURN_THREAD_CONFIG,
} from '../src/assistant/scheduled-turn-policy.ts'
import {
  resolveScheduledCodexModelCatalogJson,
} from '../src/assistant-codex/scheduled-model-catalog.ts'
import type { CodexAppServerLiveTurn } from '../src/assistant-codex.ts'

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
const SCHEDULED_TOOL_GRAPH_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
] as const
const SCHEDULED_TOOL_GRAPH_AUTHORITY = {
  automationId: 'automation_group_challenge',
  expectedUpdatedAt: '2026-07-18T12:00:00.000Z',
  kind: 'group_challenge',
  projectionScopeKey: 'steps-days.v0',
  slug: 'summer-steps',
} as const
const TURN_TIMEOUT_MS = 90_000
const execFileAsync = promisify(execFile)

type ScriptedResponse =
  | { delayMs?: number; text: string }
  | {
    delayMs?: number
    functionCall: {
      arguments: Record<string, unknown>
      name: string
      namespace?: string
    }
  }

interface ScriptedStub {
  baseUrl: string
  close(): Promise<void>
  markRequestBaseline(): void
  queue(...responses: readonly ScriptedResponse[]): void
  requestBodiesSinceBaseline(): string[]
  requestCountSinceBaseline(): number
  requestSummariesSinceBaseline(): ScriptedProviderRequestSummary[]
}

interface ScriptedProviderRequestSummary {
  model: string | null
  serviceTier: string | null
}

const EXPECTED_SCHEDULED_MURPH_TOOL_NAMES = [
  'generate_scheduled_image',
  'scheduled_read',
] as const

const FORBIDDEN_SCHEDULED_PROVIDER_TOOL_NAMES = [
  'apply_patch',
  'computer',
  'exec_command',
  'image_generation',
  'list_mcp_resource_templates',
  'list_mcp_resources',
  'read_mcp_resource',
  'request_permissions',
  'shell_command',
  'spawn_agent',
  'view_image',
  'web.run',
  'web_search',
  'write_stdin',
] as const

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

  it('isolates exact scheduled tool graphs without replacing the attended warm process', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.queue(
      { text: 'ATTENDED_TOOL_GRAPH_BEFORE_OK' },
      ...SCHEDULED_TOOL_GRAPH_MODELS.map(() => ({
        text: 'SCHEDULED_TOOL_GRAPH_OK',
      })),
      { text: 'ATTENDED_TOOL_GRAPH_AFTER_OK' },
    )
    const providerStartEvents: Array<
      Parameters<
        NonNullable<CodexAppServerTurnInput['onProviderRequestStarted']>
      >[0]
    > = []
    const stableInput = {
      ...scenario.turnInput,
      onProviderRequestStarted: (
        event: Parameters<
          NonNullable<CodexAppServerTurnInput['onProviderRequestStarted']>
        >[0],
      ) => {
        providerStartEvents.push(event)
      },
    }

    const attendedBefore = await executeCodexAppServerTurn({
      ...stableInput,
      prompt: 'Reply exactly ATTENDED_TOOL_GRAPH_BEFORE_OK.',
    })
    const attendedProcessIds = await readCodexAppServerProcessIds()
    expect(attendedProcessIds.length).toBeGreaterThan(0)
    const threadIds = [attendedBefore.threadId]
    const scheduledDynamicTools = resolveMurphScheduledDynamicTools({
      deliveryToolsAvailable: true,
      taskAuthority: SCHEDULED_TOOL_GRAPH_AUTHORITY,
    })
    expect(ASSISTANT_SCHEDULED_TURN_THREAD_CONFIG).toMatchObject({
      'features.current_time_reminder.enabled': false,
      'features.deferred_executor': false,
      'features.token_budget.enabled': false,
    })
    await writeFile(
      path.join(stableInput.codexHome, 'config.toml'),
      [
        buildScriptedCodexConfigToml(scenario.stub.baseUrl),
        '[features]',
        'code_mode_only = true',
        'deferred_executor = true',
        'multi_agent = true',
        'multi_agent_v2 = true',
        '',
        '[features.code_mode]',
        'enabled = true',
        '',
        '[features.token_budget]',
        'enabled = true',
        '',
        '[features.current_time_reminder]',
        'enabled = true',
        'sleep_tool = true',
        '',
      ].join('\n'),
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    )
    for (const model of SCHEDULED_TOOL_GRAPH_MODELS) {
      const scheduled = await executeCodexAppServerTurn({
        ...stableInput,
        dynamicTools: scheduledDynamicTools,
        model,
        prompt: 'Reply exactly SCHEDULED_TOOL_GRAPH_OK.',
        scheduledExecution: true,
        scheduledTaskAuthority: SCHEDULED_TOOL_GRAPH_AUTHORITY,
      })
      expect(scheduled.finalMessage).toBe('SCHEDULED_TOOL_GRAPH_OK')
      expect(await readCodexAppServerProcessIds()).toEqual(attendedProcessIds)
      threadIds.push(scheduled.threadId)
    }

    const attendedAfter = await executeCodexAppServerTurn({
      ...stableInput,
      prompt: 'Reply exactly ATTENDED_TOOL_GRAPH_AFTER_OK.',
    })

    expect(attendedBefore.finalMessage).toBe('ATTENDED_TOOL_GRAPH_BEFORE_OK')
    expect(attendedAfter.finalMessage).toBe('ATTENDED_TOOL_GRAPH_AFTER_OK')
    expect(await readCodexAppServerProcessIds()).toEqual(attendedProcessIds)
    threadIds.push(attendedAfter.threadId)
    expect(new Set(threadIds).size).toBe(threadIds.length)
    expect(providerStartEvents).toHaveLength(threadIds.length)
    for (const event of providerStartEvents.slice(1, -1)) {
      expect(event).toEqual(expect.objectContaining({
        codexAppServerInitializeMs: expect.any(Number),
        codexAppServerSpawnReadyMs: expect.any(Number),
      }))
      expect(event).not.toHaveProperty('codexAppServerWarmReuseMs')
    }
    expect(providerStartEvents[providerStartEvents.length - 1]).toEqual(
      expect.objectContaining({
        codexAppServerWarmReuseMs: expect.any(Number),
      }),
    )
    expect(scenario.stub.requestCountSinceBaseline()).toBe(threadIds.length)
    expect(
      scenario.stub.requestSummariesSinceBaseline().map((request) => request.model),
    ).toEqual([
      SCRIPTED_MODEL,
      ...SCHEDULED_TOOL_GRAPH_MODELS,
      SCRIPTED_MODEL,
    ])

    const requestBodies = scenario.stub.requestBodiesSinceBaseline()
    expect(requestBodies).toHaveLength(threadIds.length)
    const attendedBeforeGraph = readResponsesToolGraph(requestBodies[0] ?? '')
    const attendedAfterGraph = readResponsesToolGraph(
      requestBodies[requestBodies.length - 1] ?? '',
    )

    for (const [modelIndex, model] of SCHEDULED_TOOL_GRAPH_MODELS.entries()) {
      const scheduledGraph = readResponsesToolGraph(
        requestBodies[modelIndex + 1] ?? '',
      )
      // Pinned Codex always registers its session-only plan utility. It owns
      // no filesystem, process, network, MCP, or Murph product effect.
      expect(
        scheduledGraph.map((tool) => tool.name).sort(),
        `${model} scheduled top-level tool graph`,
      ).toEqual(['murph', 'update_plan'])
      const murphNamespace = scheduledGraph.find(
        (tool) => tool.name === 'murph' && tool.type === 'namespace',
      )
      expect(
        murphNamespace?.children.map((tool) => tool.name).sort(),
        `${model} scheduled murph namespace`,
      ).toEqual([...EXPECTED_SCHEDULED_MURPH_TOOL_NAMES].sort())

      const advertisedNames = listAdvertisedToolNames(scheduledGraph)
      for (const forbiddenName of FORBIDDEN_SCHEDULED_PROVIDER_TOOL_NAMES) {
        expect(
          advertisedNames,
          `${model} must not advertise ${forbiddenName}`,
        ).not.toContain(forbiddenName)
      }
      expect(
        advertisedNames.some((name) =>
          name.startsWith('connected_apps_') ||
          name.startsWith('memory_') ||
          name.startsWith('mcp__') ||
          name.startsWith('plugin_')
        ),
        `${model} scheduled extension namespaces`,
      ).toBe(false)
    }

    for (const attendedGraph of [attendedBeforeGraph, attendedAfterGraph]) {
      const attendedExec = attendedGraph.find((tool) => tool.name === 'exec')
      expect(readCodeModeNestedToolNames(attendedExec?.description ?? '')).toEqual(
        expect.arrayContaining([
          'apply_patch',
          'exec_command',
          'view_image',
        ]),
      )
    }
  })

  it('rejects enabled MCP config before a scheduled thread can start', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const sentinelScript = path.join(
      scenario.turnInput.codexHome,
      'scheduled-mcp-sentinel.mjs',
    )
    const sentinelMarker = path.join(
      scenario.turnInput.codexHome,
      'scheduled-mcp-sentinel-started',
    )
    await writeFile(
      sentinelScript,
      [
        "import { writeFileSync } from 'node:fs'",
        "writeFileSync(process.argv[2], 'started\\n')",
        'process.stdin.resume()',
        '',
      ].join('\n'),
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    )
    await writeFile(
      path.join(scenario.turnInput.codexHome, 'config.toml'),
      [
        buildScriptedCodexConfigToml(scenario.stub.baseUrl),
        '[mcp_servers.scheduled_escape_sentinel]',
        `command = ${JSON.stringify(process.execPath)}`,
        `args = [${[
          sentinelScript,
          sentinelMarker,
        ].map((value) => JSON.stringify(value)).join(', ')}]`,
        '',
      ].join('\n'),
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    )
    const processIdsBefore = await readCodexAppServerProcessIds()

    await expect(
      executeCodexAppServerTurn({
        ...scenario.turnInput,
        dynamicTools: resolveMurphScheduledDynamicTools({
          deliveryToolsAvailable: true,
          taskAuthority: SCHEDULED_TOOL_GRAPH_AUTHORITY,
        }),
        prompt: 'This scheduled turn must never start.',
        scheduledExecution: true,
        scheduledTaskAuthority: SCHEDULED_TOOL_GRAPH_AUTHORITY,
      }),
    ).rejects.toMatchObject({
      code: 'ASSISTANT_CODEX_SCHEDULED_MCP_CONFIG_UNSAFE',
      message:
        'Scheduled Codex execution cannot start while MCP configuration is enabled or malformed.',
    })

    expect(scenario.stub.requestCountSinceBaseline()).toBe(0)
    expect(await readCodexAppServerProcessIds()).toEqual(processIdsBefore)
    await expect(access(sentinelMarker)).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('preserves explicit caller catalog metadata while restricting selectors', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const codexHome = await mkdtemp(
      path.join(tmpdir(), 'murph-codex-catalog-home-'),
    )
    temporaryPaths.push(codexHome)
    const tempRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-codex-catalog-workspace-'),
    )
    temporaryPaths.push(tempRoot)
    const sourceCatalogPath = await writeOpenAiFlexModelCatalogJson({
      codexCommand,
      directory: codexHome,
    })
    const sourceCatalog = readRecord(
      JSON.parse(await readFile(sourceCatalogPath, 'utf8')),
    )
    const sourceModels = Array.isArray(sourceCatalog?.models)
      ? sourceCatalog.models.map(readRecord)
      : []
    const sourceModel = sourceModels.find(
      (model) => model?.slug === SCRIPTED_MODEL,
    )
    expect(sourceModel).toBeDefined()
    if (!sourceModel) {
      throw new Error('explicit catalog fixture model is missing')
    }
    sourceModel.context_window = 371_111
    sourceModel.display_name = 'Scheduled catalog metadata sentinel'
    await writeFile(sourceCatalogPath, `${JSON.stringify(sourceCatalog)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })

    const scheduledCatalogPath = await resolveScheduledCodexModelCatalogJson({
      codexCommand,
      configOverrides: [
        `model_catalog_json=${JSON.stringify(sourceCatalogPath)}`,
      ],
      env: {
        CODEX_HOME: codexHome,
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
      },
      tempRoot,
    })
    const scheduledCatalog = readRecord(
      JSON.parse(await readFile(scheduledCatalogPath, 'utf8')),
    )
    const scheduledModels = Array.isArray(scheduledCatalog?.models)
      ? scheduledCatalog.models.map(readRecord)
      : []
    const scheduledModel = scheduledModels.find(
      (model) => model?.slug === SCRIPTED_MODEL,
    )

    expect(scheduledModel).toMatchObject({
      context_window: 371_111,
      display_name: 'Scheduled catalog metadata sentinel',
      multi_agent_version: 'disabled',
      slug: SCRIPTED_MODEL,
      tool_mode: 'direct',
    })
  })

  it('rejects unadvertised native and collaboration calls before handler dispatch', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    const dynamicTools = resolveMurphScheduledDynamicTools({
      deliveryToolsAvailable: true,
      taskAuthority: SCHEDULED_TOOL_GRAPH_AUTHORITY,
    })
    const cases = [
      {
        model: 'gpt-5.6-terra',
        calls: [
          { name: 'followup_task', namespace: 'collaboration' },
          { name: 'interrupt_agent', namespace: 'collaboration' },
          { name: 'list_agents', namespace: 'collaboration' },
          { name: 'send_message', namespace: 'collaboration' },
          { name: 'spawn_agent', namespace: 'collaboration' },
          { name: 'wait_agent', namespace: 'collaboration' },
          { name: 'apply_patch', namespace: undefined },
          { name: 'exec_command', namespace: undefined },
          { name: 'request_permissions', namespace: undefined },
          { name: 'shell_command', namespace: undefined },
          { name: 'view_image', namespace: undefined },
          { name: 'write_stdin', namespace: undefined },
        ],
      },
      {
        model: 'gpt-5.6-luna',
        calls: [
          { name: 'close_agent', namespace: 'multi_agent_v1' },
          { name: 'resume_agent', namespace: 'multi_agent_v1' },
          { name: 'send_input', namespace: 'multi_agent_v1' },
          { name: 'spawn_agent', namespace: 'multi_agent_v1' },
          { name: 'wait_agent', namespace: 'multi_agent_v1' },
        ],
      },
    ] as const

    for (const testCase of cases) {
      scenario.stub.markRequestBaseline()
      scenario.stub.queue(
        ...testCase.calls.map((call) => ({
          functionCall: {
            arguments: {},
            name: call.name,
            ...(call.namespace ? { namespace: call.namespace } : {}),
          },
        })),
        { text: 'UNADVERTISED_TOOL_REJECTED_OK' },
      )

      const result = await executeCodexAppServerTurn({
        ...scenario.turnInput,
        dynamicTools,
        model: testCase.model,
        prompt: 'Reply exactly UNADVERTISED_TOOL_REJECTED_OK.',
        scheduledExecution: true,
        scheduledTaskAuthority: SCHEDULED_TOOL_GRAPH_AUTHORITY,
      })

      expect(result.finalMessage).toBe('UNADVERTISED_TOOL_REJECTED_OK')
      expect(scenario.stub.requestCountSinceBaseline()).toBe(
        testCase.calls.length + 1,
      )
      const requestBodies = scenario.stub.requestBodiesSinceBaseline()
      expect(requestBodies).toHaveLength(testCase.calls.length + 1)
      for (const [callIndex, call] of testCase.calls.entries()) {
        const flattenedToolName = `${call.namespace ?? ''}${call.name}`
        expect(
          requestBodies[callIndex + 1],
          `${testCase.model} must not dispatch ${flattenedToolName}`,
        ).toContain(`unsupported call: ${flattenedToolName}`)
      }
    }
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

async function prepareScriptedTurnScenario(): Promise<{
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
    buildScriptedCodexConfigToml(scriptedStub.baseUrl),
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

function buildScriptedCodexConfigToml(baseUrl: string): string {
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
  ].join('\n')
}

async function startScriptedResponsesStub(): Promise<ScriptedStub> {
  const queuedResponses: ScriptedResponse[] = []
  const requestBodies: string[] = []
  const requestSummaries: ScriptedProviderRequestSummary[] = []
  let responseSequence = 0
  let responsesRequestCount = 0
  let requestBaseline = 0
  let requestBodyBaseline = 0
  let requestSummaryBaseline = 0

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
    requestBodies.push(requestBody)
    requestSummaries.push(readScriptedProviderRequestSummary(requestBody))
    const scripted = queuedResponses.shift()
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
    const outputItem = 'functionCall' in scripted
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
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
    markRequestBaseline: () => {
      requestBaseline = responsesRequestCount
      requestBodyBaseline = requestBodies.length
      requestSummaryBaseline = requestSummaries.length
    },
    queue: (...responses) => {
      queuedResponses.push(...responses)
    },
    requestBodiesSinceBaseline: () => requestBodies.slice(requestBodyBaseline),
    requestCountSinceBaseline: () => responsesRequestCount - requestBaseline,
    requestSummariesSinceBaseline: () =>
      requestSummaries.slice(requestSummaryBaseline),
  }
}

interface ResponsesToolGraphNode {
  children: ResponsesToolGraphNode[]
  description: string | null
  name: string
  type: string
}

function readResponsesToolGraph(requestBody: string): ResponsesToolGraphNode[] {
  const request = readRecord(JSON.parse(requestBody))
  if (!request) {
    throw new Error('Expected a Responses request object.')
  }

  const candidateToolLists: unknown[][] = []
  if (Array.isArray(request.tools)) {
    candidateToolLists.push(request.tools)
  }
  if (Array.isArray(request.input)) {
    for (const inputItem of request.input) {
      const item = readRecord(inputItem)
      if (item?.type === 'additional_tools' && Array.isArray(item.tools)) {
        candidateToolLists.push(item.tools)
      }
    }
  }

  const tools = new Map<string, ResponsesToolGraphNode>()
  for (const value of candidateToolLists.flat()) {
    const tool = readResponsesToolGraphNode(value)
    if (tool) {
      tools.set(`${tool.type}:${tool.name}`, tool)
    }
  }
  return [...tools.values()]
}

function readResponsesToolGraphNode(value: unknown): ResponsesToolGraphNode | null {
  const tool = readRecord(value)
  const type = readString(tool?.type)
  const name = readString(tool?.name) ?? type
  if (!tool || !type || !name) {
    return null
  }

  return {
    children: Array.isArray(tool.tools)
      ? tool.tools
          .map(readResponsesToolGraphNode)
          .filter((child): child is ResponsesToolGraphNode => child !== null)
      : [],
    description: readString(tool.description),
    name,
    type,
  }
}

function readCodeModeNestedToolNames(description: string): string[] {
  return [...description.matchAll(/^### `([^`]+)`/gmu)]
    .map((match) => match[1])
    .filter((name): name is string => typeof name === 'string')
}

function listAdvertisedToolNames(toolGraph: readonly ResponsesToolGraphNode[]): string[] {
  return toolGraph.flatMap((tool) => [
    tool.name,
    ...tool.children.flatMap((child) => [
      child.name,
      ...child.children.map((grandchild) => grandchild.name),
    ]),
  ])
}

function readScriptedProviderRequestSummary(
  requestBody: string,
): ScriptedProviderRequestSummary {
  const body = readRecord(JSON.parse(requestBody))
  return {
    model: readString(body?.model),
    serviceTier: readString(body?.service_tier),
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

async function readCodexAppServerProcessIds(): Promise<number[]> {
  const { stdout } = await execFileAsync(
    'ps',
    ['-axo', 'pid=,ppid=,command='],
    {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  const rows = stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/u.exec(line)
    if (!match?.[1] || !match[2] || !match[3]) {
      return []
    }
    return [{
      command: match[3],
      parentPid: Number.parseInt(match[2], 10),
      pid: Number.parseInt(match[1], 10),
    }]
  })
  const descendantPids = new Set([process.pid])
  let previousSize = -1
  while (previousSize !== descendantPids.size) {
    previousSize = descendantPids.size
    for (const row of rows) {
      if (descendantPids.has(row.parentPid)) {
        descendantPids.add(row.pid)
      }
    }
  }

  return rows
    .filter((row) =>
      descendantPids.has(row.pid) &&
      row.command.includes('app-server') &&
      row.command.includes('codex')
    )
    .map((row) => row.pid)
    .sort((left, right) => left - right)
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}
