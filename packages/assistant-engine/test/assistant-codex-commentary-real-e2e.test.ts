import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  executeCodexAppServerTurn,
  resolveMurphDynamicTools,
} from '../src/assistant-codex.ts'

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

// GPT-5.5 emits mid-turn user-visible updates as commentary-phase agent
// messages rather than calling the murph.send_progress_update tool. This
// real-binary test proves the whole chain: the app-server surfaces the phase
// on item/completed, normalization classifies it, and the turn routes the
// commentary text into progress delivery while keeping it out of the final
// reply. A silent regression here strands members with no mid-turn updates.
describeRealCodex('real Codex commentary phase progress delivery e2e', () => {
  it('routes commentary-phase agent messages into progress delivery', async () => {
    const codexHome = await mkdtemp(path.join(tmpdir(), 'murph-commentary-e2e-'))
    temporaryPaths.push(codexHome)
    const workingDirectory = await mkdtemp(
      path.join(tmpdir(), 'murph-commentary-e2e-wd-'),
    )
    temporaryPaths.push(workingDirectory)
    await mkdir(codexHome, { recursive: true })
    await writeFile(path.join(codexHome, 'config.toml'), [
      'model = "gpt-5.5"',
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

    const progressSends: Array<{ source: string; text: string }> = []
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
      model: 'gpt-5.5',
      modelProvider: 'openai-env',
      progressDelivery,
      prompt: [
        'Multi-step task: first send a short mid-turn commentary/progress',
        'message that says exactly PROBE_COMMENTARY_ALPHA, then run a shell',
        'command like `echo probe`, and finally reply with the final answer',
        'exactly PROBE_FINAL_OMEGA.',
      ].join(' '),
      reasoningEffort: 'low',
      sandbox: 'workspace-write',
      workingDirectory,
      dynamicTools: resolveMurphDynamicTools({
        progressUpdatesAvailable: true,
      }),
    })

    expect(result.finalMessage).toContain('PROBE_FINAL_OMEGA')
    expect(result.finalMessage).not.toContain('PROBE_COMMENTARY_ALPHA')
    expect(
      progressSends.some((send) => send.text.includes('PROBE_COMMENTARY_ALPHA')),
    ).toBe(true)
  }, 240_000)
})
