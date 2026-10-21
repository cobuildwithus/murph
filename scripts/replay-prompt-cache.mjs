#!/usr/bin/env node
// Loads only the explicitly selected development key. Never source an .env file.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseArgs, parseEnv } from 'node:util'

const { values } = parseArgs({ options: {
  'env-file': { type: 'string' },
  scenario: { type: 'string', default: 'scheduled' },
  transport: { type: 'string', default: 'websocket' },
  policy: { type: 'string', default: 'baseline' },
  help: { type: 'boolean' },
} })
if (values.help) {
  process.stdout.write('Usage: node scripts/replay-prompt-cache.mjs [--env-file .env] [--scenario scheduled|document] [--transport websocket|http] [--policy baseline|key|breakpoint|stable|explicit]\nRuns three synthetic turns through real Codex. Makes billable API calls. Logs metadata only.\n')
} else {
  try {
    if (!['scheduled', 'document'].includes(values.scenario)
      || !['websocket', 'http'].includes(values.transport)
      || !['baseline', 'key', 'breakpoint', 'stable', 'explicit'].includes(values.policy)) {
      throw new Error('invalid_options')
    }
    const key = values['env-file']
      ? parseEnv(await readFile(values['env-file'], 'utf8')).OPENAI_API_KEY
      : process.env.OPENAI_API_KEY
    if (!key?.trim()) throw new Error('development_key_required')
    const child = spawn('pnpm', ['--filter', '@murphai/assistant-engine', 'exec', 'vitest', 'run',
      'test/prompt-cache-replay-real-e2e.test.ts', '--no-coverage', '--maxWorkers=1'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, OPENAI_API_KEY: key,
        MURPH_RUN_PROMPT_CACHE_REPLAY: '1', MURPH_CACHE_REPLAY_SCENARIO: values.scenario,
        MURPH_CACHE_REPLAY_TRANSPORT: values.transport, MURPH_CACHE_REPLAY_POLICY: values.policy },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // Buffer by line so a secret split between process chunks is still redacted.
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8')
      let pending = ''
      const write = (line) => process.stdout.write(line.replaceAll(key, '<REDACTED_KEY>').replaceAll(homedir(), '<HOME_DIR>'))
      stream.on('data', (text) => {
        pending += text
        let end
        while ((end = pending.indexOf('\n')) !== -1) {
          write(pending.slice(0, end + 1))
          pending = pending.slice(end + 1)
        }
      })
      stream.on('end', () => { if (pending) write(pending) })
    }
    child.on('error', () => { process.stderr.write('Cache replay could not start.\n'); process.exitCode = 1 })
    child.on('close', (code) => { process.exitCode = code ?? 1 })
  } catch {
    process.stderr.write('Cache replay configuration failed. Check --help and the selected development key file.\n')
    process.exitCode = 1
  }
}
