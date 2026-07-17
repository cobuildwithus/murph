import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  executeCodexAppServerTurn,
  resolveMurphDynamicTools,
} from '../src/assistant-codex.ts'
import { buildAssistantExecutionBehaviorText } from '../src/assistant/model-behavior.ts'

const RUN_REAL_CODEX_E2E = process.env.MURPH_RUN_REAL_CODEX_E2E === '1'
const describeRealCodex = RUN_REAL_CODEX_E2E ? describe : describe.skip

const ENV_ALLOWLIST = [
  'PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
] as const

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map(async (target) => {
    await rm(target, { force: true, recursive: true }).catch(() => undefined)
  }))
})

async function createRealCodexFixture(): Promise<{
  codexHome: string
  env: NodeJS.ProcessEnv
  workingDirectory: string
}> {
  const codexHome = await mkdtemp(path.join(tmpdir(), 'murph-commentary-e2e-'))
  temporaryPaths.push(codexHome)
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), 'murph-commentary-e2e-wd-'),
  )
  temporaryPaths.push(workingDirectory)
  await mkdir(codexHome, { recursive: true })
  await writeFile(path.join(codexHome, 'config.toml'), [
    'model = "gpt-5.6-terra"',
    'model_provider = "openai-env"',
    'model_reasoning_effort = "low"',
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    'allow_login_shell = false',
    '',
    '[shell_environment_policy]',
    'inherit = "all"',
    'ignore_default_excludes = false',
    `include_only = [${ENV_ALLOWLIST.map((key) => JSON.stringify(key)).join(', ')}]`,
    '',
    '[model_providers."openai-env"]',
    'name = "OpenAI"',
    'base_url = "https://api.openai.com/v1"',
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    'request_max_retries = 4',
    'stream_max_retries = 5',
    'supports_websockets = false',
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o600 })

  const env: NodeJS.ProcessEnv = {}
  for (const key of ENV_ALLOWLIST) {
    if (process.env[key]?.trim()) {
      env[key] = process.env[key]
    }
  }
  env.OPENAI_API_KEY = process.env.OPENAI_API_KEY

  return { codexHome, env, workingDirectory }
}

// Native Codex commentary is runtime narration, not a member-facing message.
// These real-binary tests prove both sides of the boundary: commentary remains
// internal, and a requested member-visible interim update uses the explicit
// murph.send_progress_update tool when that tool is available.
describeRealCodex('real Codex progress channel contract e2e', () => {
  it('keeps commentary-phase agent messages internal', async () => {
    const { codexHome, env, workingDirectory } = await createRealCodexFixture()

    const progressSends: Array<{ source: string; text: string }> = []
    const internalProgress: Array<{ kind: string; text: string }> = []
    const progressDelivery = {
      async send(text: string, options?: { source?: string }) {
        const source = options?.source ?? 'model'
        progressSends.push({ source, text })
        return { kind: 'sent' as const, source: source as 'model' }
      },
      close() {},
    }

    const result = await executeCodexAppServerTurn({
      approvalPolicy: 'never',
      codexHome,
      env,
      excludeResumeTurns: true,
      model: 'gpt-5.6-terra',
      modelProvider: 'openai-env',
      onProgress(event) {
        internalProgress.push({ kind: event.kind, text: event.text })
      },
      progressDelivery,
      prompt: [
        'Multi-step task: first provide a short commentary message that says',
        'exactly PROBE_COMMENTARY_ALPHA, then run a shell',
        'command like `echo probe`, and finally reply with the final answer',
        'exactly PROBE_FINAL_OMEGA. Do not call any Murph dynamic tool.',
      ].join(' '),
      reasoningEffort: 'low',
      sandbox: 'workspace-write',
      workingDirectory,
      dynamicTools: resolveMurphDynamicTools({
        progressUpdatesAvailable: false,
      }),
    })

    expect(result.finalMessage).toContain('PROBE_FINAL_OMEGA')
    expect(result.finalMessage).not.toContain('PROBE_COMMENTARY_ALPHA')
    expect(
      internalProgress.some(
        (event) =>
          event.kind === 'message' &&
          event.text.includes('PROBE_COMMENTARY_ALPHA'),
      ),
    ).toBe(true)
    expect(
      progressSends.some((send) => send.text.includes('PROBE_COMMENTARY_ALPHA')),
    ).toBe(false)
  }, 240_000)

  it('uses the explicit progress tool for a member-visible interim update', async () => {
    const { codexHome, env, workingDirectory } = await createRealCodexFixture()
    const progressMarker = path.join(workingDirectory, '.progress-delivered')
    const firstActionMarker = path.join(workingDirectory, '.first-action')
    const secondActionMarker = path.join(workingDirectory, '.second-action')
    const progressSends: Array<{ source: string; text: string }> = []
    const progressDelivery = {
      async send(text: string, options?: { source?: string }) {
        const source = options?.source ?? 'model'
        progressSends.push({ source, text })
        await writeFile(progressMarker, 'delivered', 'utf8')
        return { kind: 'sent' as const, source: source as 'model' }
      },
      close() {},
    }

    const result = await executeCodexAppServerTurn({
      approvalPolicy: 'never',
      codexHome,
      developerInstructions: buildAssistantExecutionBehaviorText({
        profile: 'gpt5-agentic',
      }),
      env,
      excludeResumeTurns: true,
      model: 'gpt-5.6-terra',
      modelProvider: 'openai-env',
      progressDelivery,
      prompt: [
        'Before doing this substantial multi-step task, send one brief',
        'member-visible interim update using the mechanism your instructions',
        'designate for member-visible progress. Then run these two separate',
        'shell commands in order: first',
        '`test -f .progress-delivered && printf first > .first-action`, then',
        '`test -f .first-action && printf second > .second-action`. Finally reply with',
        'the final answer exactly PROBE_PROGRESS_TOOL_FINAL_OMEGA. Do not',
        'mention the progress mechanism in the final answer.',
      ].join(' '),
      reasoningEffort: 'low',
      sandbox: 'workspace-write',
      workingDirectory,
      dynamicTools: resolveMurphDynamicTools({
        progressUpdatesAvailable: true,
      }),
    })

    expect(result.finalMessage).toContain('PROBE_PROGRESS_TOOL_FINAL_OMEGA')
    expect(progressSends.some((send) => send.source === 'model')).toBe(true)
    expect(await readFile(firstActionMarker, 'utf8')).toBe('first')
    expect(await readFile(secondActionMarker, 'utf8')).toBe('second')
  }, 240_000)
})
