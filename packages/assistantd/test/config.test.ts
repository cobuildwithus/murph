import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import {
  loadAssistantdEnvironment,
  loadAssistantdEnvFiles,
} from '../src/config.js'

const ASSISTANTD_ENV_KEYS = [
  'ASSISTANTD_CONTROL_TOKEN',
  'ASSISTANTD_HOST',
  'ASSISTANTD_PORT',
  'ASSISTANTD_VAULT_ROOT',
] as const

const ORIGINAL_ASSISTANTD_ENV = new Map(
  ASSISTANTD_ENV_KEYS.map((key) => [key, process.env[key]]),
)

afterEach(() => {
  for (const key of ASSISTANTD_ENV_KEYS) {
    const originalValue = ORIGINAL_ASSISTANTD_ENV.get(key)
    if (originalValue === undefined) {
      delete process.env[key]
      continue
    }
    process.env[key] = originalValue
  }
})

test('loadAssistantdEnvFiles mirrors CLI env-file precedence for assistantd startup', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'murph-assistantd-env-files-'))
  try {
    await writeFile(
      path.join(cwd, '.env'),
      [
        'ASSISTANTD_VAULT_ROOT=/from-env',
        'ASSISTANTD_CONTROL_TOKEN=token-from-env',
        'ASSISTANTD_HOST=127.0.0.9',
        '',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      path.join(cwd, '.env.local'),
      [
        'ASSISTANTD_VAULT_ROOT=/from-env-local',
        'ASSISTANTD_CONTROL_TOKEN=token-from-env-local',
        '',
      ].join('\n'),
      'utf8',
    )

    delete process.env.ASSISTANTD_VAULT_ROOT
    delete process.env.ASSISTANTD_CONTROL_TOKEN
    delete process.env.ASSISTANTD_HOST
    delete process.env.ASSISTANTD_PORT

    loadAssistantdEnvFiles(cwd)

    const env = loadAssistantdEnvironment()
    assert.equal(env.vaultRoot, '/from-env-local')
    assert.equal(env.controlToken, 'token-from-env-local')
    assert.equal(env.host, '127.0.0.9')
    assert.equal(env.port, 50_241)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('loadAssistantdEnvFiles preserves exported shell variables over local env defaults', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'murph-assistantd-env-shell-'))
  try {
    await writeFile(
      path.join(cwd, '.env'),
      [
        'ASSISTANTD_VAULT_ROOT=/from-env',
        'ASSISTANTD_CONTROL_TOKEN=token-from-env',
        '',
      ].join('\n'),
      'utf8',
    )

    process.env.ASSISTANTD_VAULT_ROOT = '/from-shell'
    process.env.ASSISTANTD_CONTROL_TOKEN = 'token-from-shell'
    delete process.env.ASSISTANTD_HOST
    delete process.env.ASSISTANTD_PORT

    loadAssistantdEnvFiles(cwd)

    const env = loadAssistantdEnvironment()
    assert.equal(env.vaultRoot, '/from-shell')
    assert.equal(env.controlToken, 'token-from-shell')
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
