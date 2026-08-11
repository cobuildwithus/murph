import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { initializeVault } from '@murphai/core'
import { afterEach, test, vi } from 'vitest'
import {
  VAULT_ENV,
  buildAssistantProviderDefaultsPatch,
  readOperatorConfig,
  resolveAssistantOperatorDefaults,
  resolveDefaultVault,
  resolveOperatorConfigPath,
  saveAssistantSelfDeliveryTarget,
  saveAssistantOperatorDefaultsPatch,
  saveDefaultVaultConfig,
} from '@murphai/operator-config/operator-config'
import {
  resolveAssistantSession,
  resolveAssistantStatePaths,
} from '@murphai/assistant-engine/assistant-state'
import { createIntegratedInboxServices } from '@murphai/inbox-services'
import { formatAssistantRunEventForTerminal } from '@murphai/assistant-cli/run-terminal-logging'
import { formatStructuredErrorMessage } from '@murphai/operator-config/text/shared'
import type { SetupConfiguredAssistant } from '@murphai/operator-config/setup-cli-contracts'
import type { SetupAssistantResolver } from '@murphai/setup-cli/setup-assistant'
import type { SetupAssistantWizardInput } from '@murphai/setup-cli/setup-assistant-wizard'
import {
  collectVaultCliDescriptorRootCommandNames,
  collectVaultRequiredCliDescriptorRootCommandNames,
} from '../src/vault-cli-command-manifest.js'
import { registerModelCommands } from '../src/commands/model.js'
import { createVaultCli } from '../src/vault-cli.js'
import { createUnwiredVaultServices } from '@murphai/vault-usecases'
import {
  requireData,
  runCli,
  withoutNodeV8Coverage,
} from './cli-test-helpers.js'

const cleanupPaths: string[] = []
const ASSISTANT_CLI_TIMEOUT_MS = 60_000
type AssistantRunEvent = Parameters<typeof formatAssistantRunEventForTerminal>[0]

function isolateVaultEnv(
  env: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    [VAULT_ENV]: undefined,
    ...env,
  }
}

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        recursive: true,
        force: true,
      })
    }),
  )
})

test('formatAssistantRunEventForTerminal redacts delivery targets by default', () => {
  const event: AssistantRunEvent = {
    inputId: 'ain_safe_123',
    details: 'telegram -> +15550001111',
    type: 'input.replied',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(message, 'replied ain_safe_123')
  assert.doesNotMatch(message ?? '', /\+15550001111/u)
})

test('formatAssistantRunEventForTerminal summarizes auto-reply provider progress by default', () => {
  const event: AssistantRunEvent = {
    inputId: 'ain_safe_123',
    details: 'Web: treehouse menu',
    providerKind: 'search',
    providerState: 'running',
    type: 'input.reply-progress',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(message, 'reply-progress ain_safe_123: searching the web')
  assert.doesNotMatch(message ?? '', /treehouse menu/u)
})

test('formatAssistantRunEventForTerminal shows raw auto-reply provider progress when unsafe details are enabled', () => {
  const event: AssistantRunEvent = {
    inputId: 'ain_safe_123',
    details: 'Web: treehouse menu',
    providerKind: 'search',
    providerState: 'running',
    type: 'input.reply-progress',
  }

  const message = formatAssistantRunEventForTerminal(event, {
    unsafeDetails: true,
  })

  assert.equal(message, 'reply-progress ain_safe_123: Web: treehouse menu')
})

test('formatAssistantRunEventForTerminal shows safe command labels by default', () => {
  const event: AssistantRunEvent = {
    inputId: 'ain_safe_123',
    details: '$ node /tmp/bin.js memory show --vault /tmp/vault',
    providerKind: 'command',
    providerState: 'running',
    safeDetails: 'running memory show',
    type: 'input.reply-progress',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(message, 'reply-progress ain_safe_123: running memory show')
  assert.doesNotMatch(message ?? '', /\/tmp\/vault/u)
})

test('formatAssistantRunEventForTerminal shows safe tool labels by default', () => {
  const event: AssistantRunEvent = {
    inputId: 'ain_safe_123',
    details: 'Tool vault.cli.run',
    providerKind: 'tool',
    providerState: 'completed',
    safeDetails: 'finished vault.cli.run',
    type: 'input.reply-progress',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(message, 'reply-progress ain_safe_123: finished vault.cli.run')
})

test('formatAssistantRunEventForTerminal keeps safe auto-reply heartbeat details visible by default', () => {
  const event: AssistantRunEvent = {
    inputId: 'ain_safe_123',
    details: 'assistant still running after 10m; last provider activity 8m ago',
    providerKind: 'status',
    providerState: 'running',
    type: 'input.reply-progress',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(
    message,
    'reply-progress ain_safe_123: assistant still running after 10m; last provider activity 8m ago',
  )
})

test('formatAssistantRunEventForTerminal keeps long-running auto-reply heartbeat details visible by default', () => {
  const event: AssistantRunEvent = {
    inputId: 'ain_safe_123',
    details:
      'assistant still running after 45m; knowledge upsert command active for 43m; last provider activity 43m ago',
    providerKind: 'status',
    providerState: 'running',
    type: 'input.reply-progress',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(
    message,
    'reply-progress ain_safe_123: assistant still running after 45m; knowledge upsert command active for 43m; last provider activity 43m ago',
  )
})

test('formatAssistantRunEventForTerminal shows safe auto-reply failure details by default', () => {
  const event: AssistantRunEvent = {
    inputId: 'ain_safe_123',
    details:
      "Codex CLI failed. exit code 1. You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Apr 3rd, 2026 1:20 PM.",
    errorCode: 'ASSISTANT_CODEX_FAILED',
    safeDetails: 'provider usage limit reached (ASSISTANT_CODEX_FAILED)',
    type: 'input.reply-failed',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(
    message,
    'reply-failed ain_safe_123: provider usage limit reached (ASSISTANT_CODEX_FAILED)',
  )
  assert.doesNotMatch(message ?? '', /purchase more credits/u)
})

test('formatAssistantRunEventForTerminal shows raw auto-reply failure details when unsafe details are enabled', () => {
  const event: AssistantRunEvent = {
    inputId: 'ain_safe_123',
    details: 'Temporary network interruption while delivering the reply.',
    errorCode: 'ASSISTANT_DELIVERY_FAILED',
    safeDetails: 'outbound delivery failed (ASSISTANT_DELIVERY_FAILED)',
    type: 'input.reply-failed',
  }

  const message = formatAssistantRunEventForTerminal(event, {
    unsafeDetails: true,
  })

  assert.equal(
    message,
    'reply-failed ain_safe_123: Temporary network interruption while delivering the reply.',
  )
})

test('formatStructuredErrorMessage expands structured validation details and redacts home paths', () => {
  const error = Object.assign(
    new Error('Vault metadata failed contract validation.'),
    {
      code: 'VAULT_INVALID_METADATA',
      details: {
        errors: [
          '$.paths.protocolsRoot: Invalid input: expected "bank/protocols"',
          'Invalid JSON in "/Users/example/vault/vault.json".',
        ],
      },
    },
  )

  assert.equal(
    formatStructuredErrorMessage(error),
    [
      'Vault metadata failed contract validation.',
      'details:',
      '- $.paths.protocolsRoot: Invalid input: expected "bank/protocols"',
      '- Invalid JSON in "<HOME_DIR>/vault/vault.json".',
    ].join('\n'),
  )
})

test('formatAssistantRunEventForTerminal hides daemon failure details by default', () => {
  const event: AssistantRunEvent = {
    type: 'daemon.failed',
    details: [
      'Vault metadata failed contract validation.',
      'details:',
      '- $.paths: Unrecognized key: "regimensRoot"',
    ].join('\n'),
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(
    message,
    'inbox daemon failed daemon failure details hidden',
  )
  assert.equal(
    formatAssistantRunEventForTerminal(event, { unsafeDetails: true }),
    [
      'inbox daemon failed Vault metadata failed contract validation.',
      'details:',
      '- $.paths: Unrecognized key: "regimensRoot"',
    ].join('\n'),
  )
})

test.sequential(
  'assistant session list and show expose assistant runtime metadata through the CLI',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cli-'))
    const homeRoot = path.join(parent, 'home')
    const vaultRoot = path.join(parent, 'vault')
    cleanupPaths.push(parent)
    await mkdir(homeRoot, { recursive: true })
    await initializeVault({ vaultRoot })

    const created = await resolveAssistantSession({
      vault: vaultRoot,
      alias: 'telegram:bob',
      channel: 'telegram',
      identityId: 'assistant:primary',
      participantId: 'contact:bob',
      threadId: 'thread-42',
      model: 'gpt-oss:20b',
    })
    const statePaths = resolveAssistantStatePaths(vaultRoot)

    const listed = requireData(
      await runIsolatedCli<{
        count: number
        filters: {
          limit: number
        }
        stateRoot: string
        sessions: Array<{
          sessionId: string
          alias: string | null
          target?: unknown
        }>
      }>(['assistant', 'session', 'list', '--vault', vaultRoot], {
        env: {
          HOME: homeRoot,
        },
      }),
    )
    assert.equal(listed.count, 1)
    assert.equal(listed.filters.limit, 5)
    assert.equal(listed.sessions.length, 1)
    assert.equal(listed.sessions[0]?.sessionId, created.session.sessionId)
    assert.equal(listed.sessions[0]?.alias, 'telegram:bob')
    assert.equal(listed.stateRoot, statePaths.assistantStateRoot)
    assert.equal('target' in (listed.sessions[0] ?? {}), false)
    assert.equal(
      Object.prototype.hasOwnProperty.call(listed.sessions[0] ?? {}, 'lastAssistantMessage'),
      false,
    )

    const shown = requireData(
      await runIsolatedCli<{
        session: {
          sessionId: string
          binding: {
            channel: string | null
            actorId: string | null
          }
        }
      }>(['assistant', 'session', 'show', created.session.sessionId, '--vault', vaultRoot], {
        env: {
          HOME: homeRoot,
        },
      }),
    )

    assert.equal(shown.session.sessionId, created.session.sessionId)
    assert.equal(shown.session.binding.channel, 'telegram')
    assert.equal(shown.session.binding.actorId, 'contact:bob')
    assert.equal(
      Object.prototype.hasOwnProperty.call(shown.session, 'lastAssistantMessage'),
      false,
    )
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test.sequential(
  'assistant session list returns an empty compact page for a fresh vault',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cli-empty-'))
    const homeRoot = path.join(parent, 'home')
    const vaultRoot = path.join(parent, 'vault')
    cleanupPaths.push(parent)
    await mkdir(homeRoot, { recursive: true })
    await initializeVault({ vaultRoot })

    const listed = requireData(
      await runIsolatedCli<{
        count: number
        filters: {
          limit: number
        }
        sessions: unknown[]
      }>(['assistant', 'session', 'list', '--vault', vaultRoot], {
        env: {
          HOME: homeRoot,
        },
      }),
    )

    assert.equal(listed.count, 0)
    assert.equal(listed.filters.limit, 5)
    assert.deepEqual(listed.sessions, [])
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test.sequential(
  'assistant session list reads legacy session files without repair',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cli-legacy-'))
    const homeRoot = path.join(parent, 'home')
    const vaultRoot = path.join(parent, 'vault')
    cleanupPaths.push(parent)
    await mkdir(homeRoot, { recursive: true })
    await initializeVault({ vaultRoot })

    await resolveAssistantSession({
      vault: vaultRoot,
      alias: 'legacy:older',
      now: new Date('2026-06-29T21:00:00.000Z'),
    })
    const newer = await resolveAssistantSession({
      vault: vaultRoot,
      alias: 'legacy:newer',
      now: new Date('2026-06-29T22:00:00.000Z'),
    })
    const statePaths = resolveAssistantStatePaths(vaultRoot)
    await writeFile(
      statePaths.indexesPath,
      JSON.stringify({ version: 1, aliases: {}, conversationKeys: {} }),
      'utf8',
    )

    const listed = requireData(
      await runIsolatedCli<{
        count: number
        filters: {
          limit: number
        }
        sessions: Array<{
          sessionId: string
          target?: unknown
        }>
      }>(['assistant', 'session', 'list', '--limit', '1', '--vault', vaultRoot], {
        env: {
          HOME: homeRoot,
        },
      }),
    )

    assert.equal(listed.count, 1)
    assert.equal(listed.filters.limit, 1)
    assert.equal(listed.sessions[0]?.sessionId, newer.session.sessionId)
    assert.equal('target' in (listed.sessions[0] ?? {}), false)
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test.sequential(
  'assistant session list and show redact HOME-based vault and runtime paths',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cli-home-'))
    const homeRoot = path.join(parent, 'home')
    const vaultRoot = path.join(homeRoot, 'vault')
    await mkdir(vaultRoot, {
      recursive: true,
    })
    cleanupPaths.push(parent)
    await initializeVault({ vaultRoot })

    const originalHome = process.env.HOME
    process.env.HOME = homeRoot

    try {
      const created = await resolveAssistantSession({
        vault: vaultRoot,
        alias: 'telegram:bob',
      })
      const expectedStateRoot = path.join(
        '~',
        'vault',
        '.runtime',
        'operations',
        'assistant',
      )

      const listed = requireData(
        await runIsolatedCli<{
          stateRoot: string
          vault: string
        }>(['assistant', 'session', 'list', '--vault', vaultRoot]),
      )
      assert.equal(listed.vault, path.join('~', 'vault'))
      assert.equal(listed.stateRoot, expectedStateRoot)

      const shown = requireData(
        await runIsolatedCli<{
          stateRoot: string
          vault: string
          session: {
            sessionId: string
          }
        }>(['assistant', 'session', 'show', created.session.sessionId, '--vault', vaultRoot]),
      )

      assert.equal(shown.vault, path.join('~', 'vault'))
      assert.equal(shown.stateRoot, expectedStateRoot)
      assert.equal(shown.session.sessionId, created.session.sessionId)
    } finally {
      restoreEnvironmentVariable('HOME', originalHome)
    }
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test.sequential(
  'raw vault-cli assistant commands use the saved default vault when --vault is omitted and still allow explicit overrides',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-default-vault-'))
    const homeRoot = path.join(parent, 'home')
    const defaultVaultRoot = path.join(homeRoot, 'default-vault')
    const overrideVaultRoot = path.join(homeRoot, 'override-vault')
    cleanupPaths.push(parent)

    await initializeVault({ vaultRoot: defaultVaultRoot })
    await initializeVault({ vaultRoot: overrideVaultRoot })

    const originalHome = process.env.HOME
    process.env.HOME = homeRoot

    try {
      const defaultSession = await resolveAssistantSession({
        vault: defaultVaultRoot,
        alias: 'default:bob',
      })
      const overrideSession = await resolveAssistantSession({
        vault: overrideVaultRoot,
        alias: 'override:bob',
      })
      await saveDefaultVaultConfig(defaultVaultRoot, homeRoot)

      const defaultListed = requireData(
        await runSourceCli<{
          vault: string
          sessions: Array<{
            sessionId: string
          }>
        }>(['assistant', 'session', 'list'], {
          env: isolateVaultEnv(),
        }),
      )
      assert.equal(defaultListed.vault, path.join('~', 'default-vault'))
      assert.equal(defaultListed.sessions.length, 1)
      assert.equal(defaultListed.sessions[0]?.sessionId, defaultSession.session.sessionId)

      const overrideListed = requireData(
        await runCli<{
          vault: string
          sessions: Array<{
            sessionId: string
          }>
        }>(['assistant', 'session', 'list', '--vault', overrideVaultRoot], {
          env: isolateVaultEnv(),
        }),
      )
      assert.equal(overrideListed.vault, path.join('~', 'override-vault'))
      assert.equal(overrideListed.sessions.length, 1)
      assert.equal(overrideListed.sessions[0]?.sessionId, overrideSession.session.sessionId)
    } finally {
      restoreEnvironmentVariable('HOME', originalHome)
    }
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test.sequential(
  'resolveDefaultVault falls back to the current working directory vault when saved config is stale',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-stale-default-vault-'))
    const homeRoot = path.join(parent, 'home')
    const cwdRoot = path.join(parent, 'workspace')
    const staleVaultRoot = path.join(homeRoot, 'stale-vault')
    const cwdVaultRoot = path.join(cwdRoot, 'vault')
    cleanupPaths.push(parent)

    await mkdir(cwdVaultRoot, { recursive: true })

    const originalHome = process.env.HOME
    const originalCwd = process.cwd()
    process.env.HOME = homeRoot
    process.chdir(cwdRoot)

    try {
      await saveDefaultVaultConfig(staleVaultRoot, homeRoot)

      assert.equal(await resolveDefaultVault(homeRoot), path.resolve('vault'))
    } finally {
      process.chdir(originalCwd)
      restoreEnvironmentVariable('HOME', originalHome)
    }
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test.sequential(
  'assistant self-target commands manage local saved outbound routes without needing a vault',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-self-target-cli-'))
    const homeRoot = path.join(parent, 'home')
    await mkdir(homeRoot, { recursive: true })
    cleanupPaths.push(parent)

    const env = {
      HOME: homeRoot,
    }

    const setResult = requireData(
      await runCli<{
        configPath: string
        target: {
          channel: string
          participantId: string | null
          threadId: string | null
          deliveryTarget: string | null
          identityId: string | null
        }
      }>([
        'assistant',
        'self-target',
        'set',
        'telegram',
        '--participant',
        'saved-chat',
        '--thread',
        'saved-chat',
      ], {
        env,
      }),
    )

    assert.equal(setResult.configPath, '~/.murph/config.json')
    assert.equal(setResult.target.channel, 'telegram')
    assert.equal(setResult.target.participantId, 'saved-chat')
    assert.equal(setResult.target.threadId, 'saved-chat')

    const listed = requireData(
      await runCli<{
        targets: Array<{
          channel: string
        }>
      }>(['assistant', 'self-target', 'list'], {
        env,
      }),
    )
    assert.deepEqual(listed.targets.map((target) => target.channel), ['telegram'])

    const shown = requireData(
      await runCli<{
        target: {
          channel: string
          participantId: string | null
        } | null
      }>(['assistant', 'self-target', 'show', 'telegram'], {
        env,
      }),
    )
    assert.equal(shown.target?.channel, 'telegram')
    assert.equal(shown.target?.participantId, 'saved-chat')

    const config = await readOperatorConfig(homeRoot)
    assert.equal(config?.assistant?.selfDeliveryTargets?.telegram?.threadId, 'saved-chat')
    assert.equal(resolveOperatorConfigPath(homeRoot).endsWith(path.join('.murph', 'config.json')), true)

    const cleared = requireData(
      await runCli<{
        clearedChannels: string[]
      }>(['assistant', 'self-target', 'clear', 'telegram'], {
        env,
      }),
    )
    assert.deepEqual(cleared.clearedChannels, ['telegram'])

    const emptyList = requireData(
      await runCli<{
        targets: Array<{
          channel: string
        }>
      }>(['assistant', 'self-target', 'list'], {
        env,
      }),
    )
    assert.deepEqual(emptyList.targets, [])
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test.sequential(
  'assistant self-target commands reject unsupported channels and invalid email recipients',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-self-target-guard-'))
    const homeRoot = path.join(parent, 'home')
    await mkdir(homeRoot, { recursive: true })
    cleanupPaths.push(parent)

    const env = {
      HOME: homeRoot,
    }

    const unsupportedChannel = await runCli([
      'assistant',
      'self-target',
      'set',
      'slack',
      '--thread',
      'thread-1',
    ], {
      env,
    })
    assert.equal(unsupportedChannel.ok, false)
    if (!unsupportedChannel.ok) {
      assert.match(unsupportedChannel.error.message ?? '', /telegram/u)
      assert.match(unsupportedChannel.error.message ?? '', /email/u)
    }

    const invalidEmail = await runCli([
      'assistant',
      'self-target',
      'set',
      'email',
      '--identity',
      'inbox-id',
      '--delivery-target',
      'not-an-email',
    ], {
      env,
    })
    assert.equal(invalidEmail.ok, false)
    if (!invalidEmail.ok) {
      assert.match(invalidEmail.error.message ?? '', /single recipient email address/u)
    }

    const invalidDirectEmail = await runCli([
      'assistant',
      'deliver',
      'hello',
      '--vault',
      path.join(parent, 'vault'),
      '--channel',
      'email',
      '--identity',
      'inbox-id',
      '--delivery-target',
      'not-an-email',
    ], {
      env,
    })
    assert.equal(invalidDirectEmail.ok, false)
    if (!invalidDirectEmail.ok) {
      assert.match(
        invalidDirectEmail.error.message ?? '',
        /single recipient email address/u,
      )
    }
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test.sequential(
  'assistant run rejects removed base URL options',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-run-model-guard-'))
    const vaultRoot = path.join(parent, 'vault')
    cleanupPaths.push(parent)

    const result = await runCli([
      'assistant',
      'run',
      '--vault',
      vaultRoot,
      '--base-url',
      'http://127.0.0.1:11434/v1',
      '--once',
    ], {
      env: {
        HOME: parent,
        MURPH_CLI_TEST_PERSISTENT_HARNESS: '0',
      },
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.match(result.error.message ?? '', /Unknown flag: --base-url|base-url/u)
    }
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test('manifest marks query as vault-backed while model and route are exempt', () => {
  assert.equal(collectVaultRequiredCliDescriptorRootCommandNames().includes('query'), true)
  assert.equal(collectVaultCliDescriptorRootCommandNames().includes('model'), true)
  assert.equal(collectVaultCliDescriptorRootCommandNames().includes('commons'), true)
  assert.equal(collectVaultCliDescriptorRootCommandNames().includes('route'), true)
  assert.equal(collectVaultCliDescriptorRootCommandNames().includes('research'), true)
  assert.equal(collectVaultCliDescriptorRootCommandNames().includes('deepthink'), false)
  assert.equal(collectVaultRequiredCliDescriptorRootCommandNames().includes('model'), false)
  assert.equal(collectVaultRequiredCliDescriptorRootCommandNames().includes('commons'), false)
  assert.equal(collectVaultRequiredCliDescriptorRootCommandNames().includes('research'), false)
  assert.equal(collectVaultRequiredCliDescriptorRootCommandNames().includes('route'), false)
})

test('model --show returns the saved assistant backend', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-show-'))
  cleanupPaths.push(homeRoot)

  await saveAssistantOperatorDefaultsPatch(
    {
      backend: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        model: 'gpt-5.4',
        oss: false,
        profile: 'ops',
        reasoningEffort: 'medium',
        sandbox: 'danger-full-access',
      },
      account: {
        source: 'codex',
        kind: 'account',
        planCode: null,
        planName: 'Pro',
        quota: null,
      },
    },
    homeRoot,
  )

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: false,
      stderrIsTTY: false,
    },
  })

  const result = await runRegisteredCliJson<{
    configured: boolean
    backend: {
      adapter: string
      model: string | null
      profile: string | null
    } | null
    summary: string | null
  }>(cli, ['model', '--show'])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.equal(result.envelope.data?.configured, true)
  assert.deepEqual(result.envelope.data?.backend, {
    adapter: 'codex-cli',
    approvalPolicy: 'never',
    codexCommand: null,
    model: 'gpt-5.4',
    modelProvider: null,
    oss: false,
    profile: 'ops',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  })
  assert.equal(result.envelope.data?.summary, 'gpt-5.4 via Codex app-server (Pro account)')
})

test('model --show summarizes a saved Codex OSS backend', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-show-oss-'))
  cleanupPaths.push(homeRoot)

  await saveAssistantOperatorDefaultsPatch(
    {
      backend: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        model: 'qwen3-coder',
        oss: true,
        profile: null,
        reasoningEffort: null,
        sandbox: 'danger-full-access',
      },
      account: null,
    },
    homeRoot,
  )

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: false,
      stderrIsTTY: false,
    },
  })

  const result = await runRegisteredCliJson<{
    summary: string | null
  }>(cli, ['model', '--show'])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.equal(result.envelope.data?.summary, 'qwen3-coder via Codex OSS app-server')
})

test('model --show fails closed for an unsupported persisted backend', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-show-unsupported-backend-'))
  cleanupPaths.push(homeRoot)

  await writeLegacyAssistantOperatorConfig(homeRoot)

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: false,
      stderrIsTTY: false,
    },
  })

  const result = await runRegisteredCliJson(cli, ['model', '--show'])

  assert.equal(result.exitCode, 1)
  assert.equal(result.envelope.ok, false)
  assert.equal(result.envelope.error?.code, 'UNKNOWN')
  assert.match(
    result.envelope.error?.message ?? '',
    /Reconfigure the assistant for Codex App Server/u,
  )
})

test('model --preset codex replaces an unsupported persisted backend', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-replace-unsupported-backend-'))
  cleanupPaths.push(homeRoot)
  await writeLegacyAssistantOperatorConfig(homeRoot, '~/vault')

  const resolveAssistant = vi.fn(
    async ({ options, preset }): Promise<SetupConfiguredAssistant> => ({
      preset,
      enabled: true,
      provider: 'codex-cli',
      model: options.assistantModel ?? null,
      modelProvider: options.assistantModelProvider ?? null,
      codexCommand: options.assistantCodexCommand ?? null,
      codexHome: options.assistantCodexHome ?? null,
      profile: options.assistantProfile ?? null,
      reasoningEffort: options.assistantReasoningEffort ?? null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: options.assistantOss ?? false,
      account: null,
      detail: 'saved codex backend',
    }),
  )

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    assistantSetup: {
      resolve: resolveAssistant,
    },
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: false,
      stderrIsTTY: false,
    },
  })

  const result = await runRegisteredCliJson<{
    backend: {
      adapter: string
      model: string | null
      modelProvider: string | null
    } | null
  }>(cli, [
    'model',
    '--preset',
    'codex',
    '--model',
    'gpt-5.6-terra',
    '--modelProvider',
    'vercel-ai-gateway',
  ])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.equal(result.envelope.data?.backend?.adapter, 'codex-cli')
  assert.equal(result.envelope.data?.backend?.model, 'gpt-5.6-terra')
  assert.equal(result.envelope.data?.backend?.modelProvider, 'vercel-ai-gateway')

  const config = await readOperatorConfig(homeRoot)
  assert.equal(config?.defaultVault, '~/vault')
  assert.equal(config?.assistant?.backend?.adapter, 'codex-cli')
  assert.equal(
    config?.assistant?.backend?.adapter === 'codex-cli'
      ? config.assistant.backend.modelProvider
      : null,
    'vercel-ai-gateway',
  )
})

test('model rejects unsupported legacy presets', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-legacy-preset-'))
  cleanupPaths.push(homeRoot)

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: false,
      stderrIsTTY: false,
    },
  })

  const result = await runRegisteredCliJson(cli, [
    'model',
    '--preset',
    'unsupported-provider',
    '--model',
    'gpt-4.1-mini',
  ])

  assert.equal(result.exitCode, 1)
  assert.equal(result.envelope.ok, false)
  assert.match(
    result.envelope.error?.message ?? '',
    /Invalid input|unsupported-provider/u,
  )
})

test('model --show includes a note for an explicit saved Codex home', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-show-codex-home-'))
  cleanupPaths.push(homeRoot)

  await saveAssistantOperatorDefaultsPatch(
    {
      backend: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        codexHome: '/tmp/codex-1',
        model: 'gpt-5.4',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'danger-full-access',
      },
      account: null,
    },
    homeRoot,
  )

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: false,
      stderrIsTTY: false,
    },
  })

  const result = await runRegisteredCliJson<{
    backend: {
      codexHome?: string | null
    } | null
    notes: string[]
  }>(cli, ['model', '--show'])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.equal(result.envelope.data?.backend?.codexHome, '[path]')
  assert.deepEqual(result.envelope.data?.notes, [
    'A saved Codex home is configured; path redacted in CLI output.',
  ])
})

test('interactive bare model uses the Codex wizard selection before resolving details', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-wizard-'))
  cleanupPaths.push(homeRoot)

  const assistantWizard = vi.fn(async (_input: SetupAssistantWizardInput) => ({
    assistantPreset: 'codex' as const,
    assistantOss: false,
  }))
  const resolveAssistant = vi.fn(
    async ({ options, preset }): Promise<SetupConfiguredAssistant> => ({
      preset,
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.6-terra',
      modelProvider: options.assistantModelProvider ?? null,
      codexCommand: null,
      codexHome: options.assistantCodexHome ?? null,
      profile: null,
      reasoningEffort: options.assistantReasoningEffort ?? null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'resolved Codex after wizard selection',
    }),
  )
  const assistantSetup: SetupAssistantResolver = {
    resolve: resolveAssistant,
  }

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    assistantSetup,
    assistantWizard,
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: true,
      stderrIsTTY: true,
    },
  })

  const result = await runRegisteredCliJson<{
    summary: string | null
  }>(cli, ['model'])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.equal(assistantWizard.mock.calls.length, 1)
  assert.deepEqual(assistantWizard.mock.calls[0]?.[0], {
    enableApiKeyProviderOnboarding: false,
  })
  assert.equal(resolveAssistant.mock.calls.length, 1)
  assert.deepEqual(resolveAssistant.mock.calls[0]?.[0], {
    allowPrompt: true,
    commandName: 'model',
    options: {
      vault: './vault',
      strict: true,
      whisperModel: 'base.en',
      assistantPreset: 'codex',
      assistantOss: false,
    },
    preset: 'codex',
  })
  assert.equal(
    result.envelope.data?.summary,
    'gpt-5.6-terra via Codex app-server',
  )
})

test('interactive bare model saves Venice from the wizard selection', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-wizard-venice-'))
  cleanupPaths.push(homeRoot)

  const assistantWizard = vi.fn(async (_input: SetupAssistantWizardInput) => ({
    assistantPreset: 'codex' as const,
    assistantModelProvider: 'venice',
    assistantOss: false,
  }))
  const resolveAssistant = vi.fn(
    async ({ options, preset }): Promise<SetupConfiguredAssistant> => ({
      preset,
      enabled: true,
      provider: 'codex-cli',
      model: 'venice-model',
      modelProvider: options.assistantModelProvider ?? null,
      codexCommand: null,
      codexHome: options.assistantCodexHome ?? null,
      profile: null,
      reasoningEffort: options.assistantReasoningEffort ?? null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: options.assistantOss ?? false,
      account: null,
      detail: 'resolved Venice after wizard selection',
    }),
  )

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    assistantSetup: {
      resolve: resolveAssistant,
    },
    assistantWizard,
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: true,
      stderrIsTTY: true,
    },
  })

  const result = await runRegisteredCliJson<{
    backend: {
      modelProvider: string | null
    } | null
  }>(cli, ['model'])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.deepEqual(assistantWizard.mock.calls[0]?.[0], {
    enableApiKeyProviderOnboarding: false,
  })
  assert.equal(resolveAssistant.mock.calls[0]?.[0].options.assistantModelProvider, 'venice')
  assert.equal(result.envelope.data?.backend?.modelProvider, 'venice')
})

test('interactive bare model clears a saved provider when wizard selects ChatGPT', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-wizard-clear-provider-'))
  cleanupPaths.push(homeRoot)

  await saveAssistantOperatorDefaultsPatch(
    {
      backend: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        codexHome: null,
        model: 'venice-model',
        modelProvider: 'venice',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'danger-full-access',
      },
      account: null,
    },
    homeRoot,
  )

  const assistantWizard = vi.fn(async (_input: SetupAssistantWizardInput) => ({
    assistantPreset: 'codex' as const,
    assistantModelProvider: null,
    assistantOss: false,
  }))
  const resolveAssistant = vi.fn(
    async ({ options, preset }): Promise<SetupConfiguredAssistant> => ({
      preset,
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-5.6-terra',
      modelProvider: options.assistantModelProvider ?? null,
      codexCommand: null,
      codexHome: null,
      profile: null,
      reasoningEffort: options.assistantReasoningEffort ?? null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: options.assistantOss ?? false,
      account: null,
      detail: 'resolved ChatGPT after wizard selection',
    }),
  )

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    assistantSetup: {
      resolve: resolveAssistant,
    },
    assistantWizard,
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: true,
      stderrIsTTY: true,
    },
  })

  const result = await runRegisteredCliJson<{
    backend: {
      modelProvider: string | null
      oss: boolean
    } | null
  }>(cli, ['model'])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.equal(resolveAssistant.mock.calls[0]?.[0].options.assistantModelProvider, undefined)
  assert.equal(result.envelope.data?.backend?.modelProvider, null)
  assert.equal(result.envelope.data?.backend?.oss, false)
})

test('interactive bare model clears a saved provider when wizard selects local OSS', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-wizard-local-clear-provider-'))
  cleanupPaths.push(homeRoot)

  await saveAssistantOperatorDefaultsPatch(
    {
      backend: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        codexHome: null,
        model: 'venice-model',
        modelProvider: 'venice',
        oss: false,
        profile: null,
        reasoningEffort: 'medium',
        sandbox: 'danger-full-access',
      },
      account: null,
    },
    homeRoot,
  )

  const assistantWizard = vi.fn(async (_input: SetupAssistantWizardInput) => ({
    assistantPreset: 'codex' as const,
    assistantModelProvider: null,
    assistantOss: true,
  }))
  const resolveAssistant = vi.fn(
    async ({ options, preset }): Promise<SetupConfiguredAssistant> => ({
      preset,
      enabled: true,
      provider: 'codex-cli',
      model: 'gpt-oss:20b',
      modelProvider: options.assistantModelProvider ?? null,
      codexCommand: null,
      codexHome: null,
      profile: null,
      reasoningEffort: options.assistantReasoningEffort ?? null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: options.assistantOss ?? false,
      account: null,
      detail: 'resolved local Codex after wizard selection',
    }),
  )

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    assistantSetup: {
      resolve: resolveAssistant,
    },
    assistantWizard,
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: true,
      stderrIsTTY: true,
    },
  })

  const result = await runRegisteredCliJson<{
    backend: {
      modelProvider: string | null
      oss: boolean
    } | null
  }>(cli, ['model'])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.equal(resolveAssistant.mock.calls[0]?.[0].options.assistantModelProvider, undefined)
  assert.equal(result.envelope.data?.backend?.modelProvider, null)
  assert.equal(result.envelope.data?.backend?.oss, true)
})

test('model reuses existing Codex defaults when only the model changes', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-update-'))
  cleanupPaths.push(homeRoot)

  await saveAssistantOperatorDefaultsPatch(
    {
      backend: {
        adapter: 'codex-cli',
        approvalPolicy: 'never',
        codexCommand: null,
        codexHome: '/tmp/codex-1',
        model: 'gpt-5.4',
        modelProvider: 'vercel-ai-gateway',
        oss: false,
        profile: 'ops',
        reasoningEffort: 'medium',
        sandbox: 'danger-full-access',
      },
      account: null,
    },
    homeRoot,
  )

  const resolveAssistant = vi.fn(
    async ({ options, preset }): Promise<SetupConfiguredAssistant> => ({
      preset,
      enabled: true,
      provider: 'codex-cli',
      model: options.assistantModel ?? null,
      modelProvider: options.assistantModelProvider ?? null,
      codexCommand: options.assistantCodexCommand ?? null,
      codexHome: options.assistantCodexHome ?? null,
      profile: options.assistantProfile ?? null,
      reasoningEffort: options.assistantReasoningEffort ?? null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: options.assistantOss ?? false,
      account: null,
      detail: 'saved codex backend',
    }),
  )
  const assistantSetup: SetupAssistantResolver = {
    resolve: resolveAssistant,
  }

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    assistantSetup,
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: false,
      stderrIsTTY: false,
    },
  })

  const result = await runRegisteredCliJson<{
    backend: {
      adapter: string
      model: string | null
      modelProvider: string | null
    } | null
    notes: string[]
    summary: string | null
  }>(cli, ['model', '--model', 'gpt-oss:20b'])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.equal(resolveAssistant.mock.calls.length, 1)
  assert.deepEqual(resolveAssistant.mock.calls[0]?.[0], {
    allowPrompt: false,
    commandName: 'model',
    options: {
      vault: './vault',
      strict: true,
      whisperModel: 'base.en',
      assistantPreset: 'codex',
      assistantModel: 'gpt-oss:20b',
      assistantCodexCommand: undefined,
      assistantCodexHome: '/tmp/codex-1',
      assistantModelProvider: 'vercel-ai-gateway',
      assistantOss: undefined,
      assistantProfile: 'ops',
      assistantReasoningEffort: 'medium',
    },
    preset: 'codex',
  })
  assert.deepEqual(result.envelope.data?.backend, {
    adapter: 'codex-cli',
    approvalPolicy: 'never',
    codexCommand: null,
    codexHome: '[path]',
    model: 'gpt-oss:20b',
    modelProvider: 'vercel-ai-gateway',
    oss: false,
    profile: 'ops',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  })
  assert.deepEqual(result.envelope.data?.notes, [
    'A saved Codex home is configured; path redacted in CLI output.',
  ])
  assert.equal(
    result.envelope.data?.summary,
    'gpt-oss:20b via Codex app-server',
  )

  const savedConfig = await readOperatorConfig(homeRoot)
  assert.equal(savedConfig?.assistant?.backend?.adapter, 'codex-cli')
  assert.equal(savedConfig?.assistant?.backend?.model, 'gpt-oss:20b')
  assert.equal(
    savedConfig?.assistant?.backend?.adapter === 'codex-cli'
      ? savedConfig.assistant.backend.modelProvider
      : null,
    'vercel-ai-gateway',
  )
})

test('model forwards an explicit Codex model provider to setup resolution', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-provider-'))
  cleanupPaths.push(homeRoot)

  const resolveAssistant = vi.fn(
    async ({ options, preset }): Promise<SetupConfiguredAssistant> => ({
      preset,
      enabled: true,
      provider: 'codex-cli',
      model: options.assistantModel ?? null,
      modelProvider: options.assistantModelProvider ?? null,
      codexCommand: null,
      profile: null,
      reasoningEffort: options.assistantReasoningEffort ?? null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: false,
      account: null,
      detail: 'saved codex backend',
    }),
  )

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    assistantSetup: {
      resolve: resolveAssistant,
    },
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: false,
      stderrIsTTY: false,
    },
  })

  const result = await runRegisteredCliJson(cli, [
    'model',
    '--preset',
    'codex',
    '--model',
    'gpt-5.6-terra',
    '--modelProvider',
    'vercel-ai-gateway',
  ])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.equal(resolveAssistant.mock.calls.length, 1)
  assert.deepEqual(resolveAssistant.mock.calls[0]?.[0], {
    allowPrompt: false,
    commandName: 'model',
    options: {
      vault: './vault',
      strict: true,
      whisperModel: 'base.en',
      assistantPreset: 'codex',
      assistantModel: 'gpt-5.6-terra',
      assistantModelProvider: 'vercel-ai-gateway',
    },
    preset: 'codex',
  })
})

test('model treats an explicit false OSS flag as a codex option when inferring the preset', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-oss-false-'))
  cleanupPaths.push(homeRoot)

  const resolveAssistant = vi.fn(
    async ({ options, preset }): Promise<SetupConfiguredAssistant> => ({
      preset,
      enabled: true,
      provider: 'codex-cli',
      model: options.assistantModel ?? null,
      modelProvider: options.assistantModelProvider ?? null,
      codexCommand: options.assistantCodexCommand ?? null,
      profile: options.assistantProfile ?? null,
      reasoningEffort: options.assistantReasoningEffort ?? null,
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
      oss: options.assistantOss ?? false,
      account: null,
      detail: 'saved codex backend',
    }),
  )
  const assistantSetup: SetupAssistantResolver = {
    resolve: resolveAssistant,
  }

  const cli = Cli.create('vault-cli')
  registerModelCommands(cli, {
    assistantSetup,
    resolveHomeDirectory: () => homeRoot,
    terminal: {
      stdinIsTTY: false,
      stderrIsTTY: false,
    },
  })

  const result = await runRegisteredCliJson(cli, [
    'model',
    '--model',
    'gpt-5.4',
    '--no-oss',
  ])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.equal(resolveAssistant.mock.calls.length, 1)
  assert.deepEqual(resolveAssistant.mock.calls[0]?.[0], {
    allowPrompt: false,
    commandName: 'model',
    options: {
      vault: './vault',
      strict: true,
      whisperModel: 'base.en',
      assistantPreset: 'codex',
      assistantModel: 'gpt-5.4',
      assistantOss: false,
    },
    preset: 'codex',
  })
})

test('root status, doctor, and stop aliases reuse the assistant command schemas', () => {
  const cli = createVaultCli(
    createUnwiredVaultServices(),
    createIntegratedInboxServices(),
  )
  const commands = Cli.toCommands.get(cli)
  const assistant = commands?.get('assistant') as
    | {
        _group: true
        commands: Map<string, Record<string, unknown>>
      }
    | undefined

  const rootStatus = commands?.get('status') as Record<string, unknown> | undefined
  const assistantStatus = assistant?.commands.get('status')
  const rootDoctor = commands?.get('doctor') as Record<string, unknown> | undefined
  const assistantDoctor = assistant?.commands.get('doctor')

  assert.notEqual(rootStatus, undefined)
  assert.notEqual(assistantStatus, undefined)
  assert.deepEqual(
    commandSchemaShapeKeys(rootStatus, 'args'),
    commandSchemaShapeKeys(assistantStatus, 'args'),
  )
  assert.deepEqual(
    commandSchemaShapeKeys(rootStatus, 'options'),
    commandSchemaShapeKeys(assistantStatus, 'options'),
  )
  assert.deepEqual(
    commandSchemaShapeKeys(rootStatus, 'output'),
    commandSchemaShapeKeys(assistantStatus, 'output'),
  )

  assert.notEqual(rootDoctor, undefined)
  assert.notEqual(assistantDoctor, undefined)
  assert.deepEqual(
    commandSchemaShapeKeys(rootDoctor, 'args'),
    commandSchemaShapeKeys(assistantDoctor, 'args'),
  )
  assert.deepEqual(
    commandSchemaShapeKeys(rootDoctor, 'options'),
    commandSchemaShapeKeys(assistantDoctor, 'options'),
  )
  assert.deepEqual(
    commandSchemaShapeKeys(rootDoctor, 'output'),
    commandSchemaShapeKeys(assistantDoctor, 'output'),
  )

  const rootStop = commands?.get('stop') as Record<string, unknown> | undefined
  const assistantStop = assistant?.commands.get('stop')
  assert.notEqual(rootStop, undefined)
  assert.notEqual(assistantStop, undefined)
  assert.deepEqual(
    commandSchemaShapeKeys(rootStop, 'args'),
    commandSchemaShapeKeys(assistantStop, 'args'),
  )
  assert.deepEqual(
    commandSchemaShapeKeys(rootStop, 'options'),
    commandSchemaShapeKeys(assistantStop, 'options'),
  )
  assert.deepEqual(
    commandSchemaShapeKeys(rootStop, 'output'),
    commandSchemaShapeKeys(assistantStop, 'output'),
  )
})

function commandSchemaShapeKeys(
  command: Record<string, unknown> | undefined,
  field: 'args' | 'options' | 'output',
): string[] {
  const schema = command?.[field] as
    | { shape?: Record<string, unknown>; def?: { shape?: Record<string, unknown> } }
    | undefined
  const shape = schema?.shape ?? schema?.def?.shape ?? {}
  return Object.keys(shape).sort()
}

test('root chat fails closed when the terminal cannot provide interactive raw-mode input', async () => {
  const result = await runInProcessCliWithTty(['chat', '--vault', '/tmp/mock-vault'])

  assert.equal(result.stderr, '')
  assert.equal(
    result.stdout,
    'Error: Murph chat requires interactive terminal input. process.stdin does not support raw mode, and Murph could not open the controlling terminal for Ink input.\n',
  )
})

test('root chat surfaces the interactive-input failure before any json result can be emitted', async () => {
  const result = await runInProcessCliWithTty([
    'chat',
    '--vault',
    '/tmp/mock-vault',
    '--format',
    'json',
  ])

  assert.equal(result.stderr, '')
  assert.equal(
    result.stdout,
    'Error: Murph chat requires interactive terminal input. process.stdin does not support raw mode, and Murph could not open the controlling terminal for Ink input.\n',
  )
})

test.sequential(
  'assistant model defaults persist in operator config without disturbing the default vault',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-config-'))
    const homeRoot = path.join(parent, 'home')
    const vaultRoot = path.join(homeRoot, 'default-vault')
    cleanupPaths.push(parent)

    await mkdir(vaultRoot, { recursive: true })
    await saveDefaultVaultConfig(vaultRoot, homeRoot)
    await saveAssistantOperatorDefaultsPatch(
      buildAssistantProviderDefaultsPatch({
        defaults: null,
        providerConfig: {
          model: 'gpt-5.4-mini',
          reasoningEffort: 'xhigh',
          oss: false,
        },
      }),
      homeRoot,
    )

    const config = await readOperatorConfig(homeRoot)
    const defaults = await resolveAssistantOperatorDefaults(homeRoot)
    assert.ok(config)
    assert.equal(config.defaultVault, path.join('~', 'default-vault'))
    assert.equal(config.assistant?.backend?.adapter, 'codex-cli')
    assert.equal(config.assistant?.backend?.model, 'gpt-5.4-mini')
    assert.equal(defaults?.backend?.adapter, 'codex-cli')
    assert.equal(
      defaults?.backend?.adapter === 'codex-cli'
        ? defaults.backend.reasoningEffort
        : null,
      'xhigh',
    )
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

function restoreEnvironmentVariable(
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}

async function writeLegacyAssistantOperatorConfig(
  homeRoot: string,
  defaultVault: string | null = null,
): Promise<void> {
  const configPath = resolveOperatorConfigPath(homeRoot)
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(
    configPath,
    JSON.stringify({
      schema: 'murph.operator-config.v1',
      defaultVault,
      assistant: {
        backend: {
          adapter: 'unsupported-provider',
          apiKeyEnv: 'LEGACY_API_KEY',
          endpoint: 'https://api.legacy.example/v1',
          headers: null,
          model: 'gpt-4.1-mini',
          presetId: 'legacy',
          providerName: 'legacy-provider',
          reasoningEffort: null,
          webSearch: null,
        },
        account: null,
        identityId: null,
        selfDeliveryTargets: null,
      },
      updatedAt: '2026-04-28T00:00:00.000Z',
    }),
    'utf8',
  )
}

async function runRegisteredCliJson<TData>(
  cli: Cli.Cli,
  args: string[],
): Promise<{
  envelope: {
    ok: boolean
    data?: TData
    error?: {
      code?: string
      message?: string
      retryable?: boolean
    }
  }
  exitCode: number | null
}> {
  const output: string[] = []
  let exitCode: number | null = null

  await cli.serve([...args, '--format', 'json', '--full-output'], {
    env: process.env,
    exit(code) {
      exitCode = code
    },
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return {
    envelope: JSON.parse(output.join('').trim()) as {
      ok: boolean
      data?: TData
      error?: {
        code?: string
        message?: string
        retryable?: boolean
      }
    },
    exitCode,
  }
}

async function runInProcessCliWithTty(args: string[]): Promise<{
  stderr: string
  stdout: string
}> {
  const cli = createVaultCli(
    createUnwiredVaultServices(),
    createIntegratedInboxServices(),
  )
  const stdout: string[] = []
  const stderr: string[] = []
  const stdinTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  const stdinRawModeDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode')
  const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  // Only fail tty opens: the chat command lazy-imports its ink surface, so a
  // blanket openSync stub would break Node's own module-file reads mid-run.
  // Mirror the production tty path selection (CONIN$ on Windows, /dev/tty
  // elsewhere) so this stub keeps simulating an unopenable controlling
  // terminal on every platform.
  const controllingTtyPath = process.platform === 'win32' ? 'CONIN$' : '/dev/tty'
  const realOpenSync = fs.openSync.bind(fs)
  const openSyncSpy = vi
    .spyOn(fs, 'openSync')
    .mockImplementation(((path: fs.PathLike, flags: fs.OpenMode, mode?: fs.Mode | null) => {
      if (String(path) === controllingTtyPath) {
        throw new Error('tty unavailable')
      }
      return realOpenSync(path, flags, mode)
    }) as typeof fs.openSync)
  const stderrWriteSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stderr.write)

  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: false,
  })
  Object.defineProperty(process.stdin, 'setRawMode', {
    configurable: true,
    value: undefined,
  })
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: true,
  })

  try {
    await cli.serve(args, {
      env: process.env,
      exit: () => {},
      stdout(chunk) {
        stdout.push(chunk)
      },
    })
  } finally {
    openSyncSpy.mockRestore()
    stderrWriteSpy.mockRestore()

    if (stdinTtyDescriptor) {
      Object.defineProperty(process.stdin, 'isTTY', stdinTtyDescriptor)
    } else {
      delete (process.stdin as { isTTY?: boolean }).isTTY
    }

    if (stdinRawModeDescriptor) {
      Object.defineProperty(process.stdin, 'setRawMode', stdinRawModeDescriptor)
    } else {
      delete (process.stdin as { setRawMode?: unknown }).setRawMode
    }

    if (stdoutTtyDescriptor) {
      Object.defineProperty(process.stdout, 'isTTY', stdoutTtyDescriptor)
    } else {
      delete (process.stdout as { isTTY?: boolean }).isTTY
    }
  }

  return {
    stderr: stderr.join(''),
    stdout: stdout.join(''),
  }
}

async function runSourceCli<TData = Record<string, unknown>>(
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
  },
): Promise<{
  ok: true
  data: TData
  meta: {
    command: string
    duration: string
  }
} | {
  ok: false
  error: {
    code?: string
    message?: string
  }
  meta: {
    command: string
    duration: string
  }
}> {
  return runCli(args, {
    env: withoutNodeV8Coverage({
      ...process.env,
      ...options?.env,
    }),
  })
}

async function runIsolatedCli<TData = Record<string, unknown>>(
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
  },
): Promise<{
  ok: true
  data: TData
  meta: {
    command: string
    duration: string
  }
} | {
  ok: false
  error: {
    code?: string
    message?: string
  }
  meta: {
    command: string
    duration: string
  }
}> {
  return runCli(args, {
    env: {
      ...options?.env,
      MURPH_CLI_TEST_PERSISTENT_HARNESS: '0',
    },
  })
}
