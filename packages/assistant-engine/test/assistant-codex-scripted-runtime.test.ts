import { createServer, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import {
  compactWarmCodexThread,
  executeCodexAppServerTurn,
  stopWarmCodexAppServer,
} from '../src/assistant-codex.ts'
import type { CodexAppServerLiveTurn } from '../src/assistant-codex.ts'

// Runs the REAL `codex app-server` binary (pinned @openai/codex devDependency,
// matching CODEX_CLI_VERSION in Dockerfile.cloudflare-hosted-runner-base)
// against a local scripted Responses API stub. Deterministic and free: this is
// the default-on protocol-contract lane that replaces the deleted
// MockChildProcess happy-path fakes. Adversarial process behavior (malformed
// events, stale ids, poisoning) stays in assistant-codex-runtime.test.ts where
// a scriptable fake child process is the right tool.

const SCRIPTED_STUB_KEY_ENV = 'MURPH_SCRIPTED_STUB_KEY'
const SCRIPTED_MODEL = 'gpt-5.5'
const SCRIPTED_MODEL_PROVIDER = 'local-stub'
const TURN_TIMEOUT_MS = 90_000

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
  requestCountSinceBaseline(): number
}

const codexCommand = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../node_modules/.bin/codex',
)

let stub: ScriptedStub | null = null
const temporaryPaths: string[] = []

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

  it('compacts the warm thread off-turn and keeps it resumable', {
    timeout: TURN_TIMEOUT_MS,
  }, async () => {
    const scenario = await prepareScriptedTurnScenario()
    scenario.stub.queue({ text: 'COMPACT_SEED_OK' })
    const seeded = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly COMPACT_SEED_OK.',
    })
    expect(seeded.finalMessage).toBe('COMPACT_SEED_OK')

    // Below threshold: no provider traffic, warm process untouched. The
    // reported size must be the real observed thread context from the seed
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
      threadId: seeded.threadId,
    })
    // Billing depends on usage capture during compaction; if the app-server
    // ever stops emitting tokenUsage for compact requests this must fail.
    expect(compacted.kind === 'compacted' && compacted.usage).toBeTruthy()

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
    // spawn resumes the same thread.
    scenario.stub.queue({ text: 'POST_ABORT_OK' })
    const resumed = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly POST_ABORT_OK.',
      resumeSessionId: seeded.sessionId,
    })
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

  it('resumes a scripted thread through the real turn/start contract', {
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
    const second = await executeCodexAppServerTurn({
      ...scenario.turnInput,
      prompt: 'Reply exactly RESUME_SECOND_OK.',
      resumeSessionId: first.sessionId,
    })

    expect(second.finalMessage).toBe('RESUME_SECOND_OK')
    expect(second.threadId).toBe(first.threadId)
    expect(second.rolloutRelativePath).toBe(first.rolloutRelativePath)
    expect(second.turnId).not.toBe(first.turnId)
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
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
}

async function startScriptedResponsesStub(): Promise<ScriptedStub> {
  const queuedResponses: ScriptedResponse[] = []
  let responseSequence = 0
  let responsesRequestCount = 0
  let requestBaseline = 0

  const server: Server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/responses') {
      response.statusCode = 404
      response.end(JSON.stringify({ error: `unhandled ${request.method} ${request.url}` }))
      return
    }

    for await (const chunk of request) {
      void chunk
    }
    responsesRequestCount += 1
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
    },
    queue: (...responses) => {
      queuedResponses.push(...responses)
    },
    requestCountSinceBaseline: () => responsesRequestCount - requestBaseline,
  }
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
