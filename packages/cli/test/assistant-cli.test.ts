import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { afterEach, beforeEach, test, vi } from 'vitest'
import {
  TOP_LEVEL_COMMANDS_REQUIRING_VAULT,
  VAULT_ENV,
  applyDefaultVaultToArgs,
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
  createProviderTurnAssistantToolCatalog,
} from '@murphai/assistant-engine/assistant-cli-tools'
import {
  assistantMemoryTurnEnvKeys,
} from '@murphai/assistant-engine/assistant/memory'
import {
  resolveAssistantSession,
  resolveAssistantStatePaths,
} from '@murphai/assistant-engine/assistant-state'
import type { AssistantRunEvent } from '@murphai/assistant-engine/assistant/automation/shared'
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

function isolateAssistantMemoryEnv(
  env: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const clearedKeys = Object.fromEntries(
    assistantMemoryTurnEnvKeys.map((key) => [key, undefined]),
  ) as NodeJS.ProcessEnv

  return {
    ...clearedKeys,
    ...env,
  }
}

const runtimeMocks = vi.hoisted(() => ({
  runAssistantChat: vi.fn(),
}))

vi.mock('@murphai/assistant-cli/assistant/runtime', async () => {
  const actual = await vi.importActual<typeof import('@murphai/assistant-cli/assistant/runtime')>(
    '@murphai/assistant-cli/assistant/runtime',
  )

  return {
    ...actual,
    runAssistantChat: runtimeMocks.runAssistantChat,
  }
})

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

beforeEach(() => {
  runtimeMocks.runAssistantChat.mockReset()
})

test('formatAssistantRunEventForTerminal redacts delivery targets by default', () => {
  const event: AssistantRunEvent = {
    captureId: 'cap_safe_123',
    details: 'telegram -> +15550001111',
    type: 'capture.replied',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(message, 'replied cap_safe_123')
  assert.doesNotMatch(message ?? '', /\+15550001111/u)
})

test('formatAssistantRunEventForTerminal summarizes auto-reply provider progress by default', () => {
  const event: AssistantRunEvent = {
    captureId: 'cap_safe_123',
    details: 'Web: treehouse menu',
    providerKind: 'search',
    providerState: 'running',
    type: 'capture.reply-progress',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(message, 'reply-progress cap_safe_123: searching the web')
  assert.doesNotMatch(message ?? '', /treehouse menu/u)
})

test('formatAssistantRunEventForTerminal shows raw auto-reply provider progress when unsafe details are enabled', () => {
  const event: AssistantRunEvent = {
    captureId: 'cap_safe_123',
    details: 'Web: treehouse menu',
    providerKind: 'search',
    providerState: 'running',
    type: 'capture.reply-progress',
  }

  const message = formatAssistantRunEventForTerminal(event, {
    unsafeDetails: true,
  })

  assert.equal(message, 'reply-progress cap_safe_123: Web: treehouse menu')
})

test('formatAssistantRunEventForTerminal shows safe command labels by default', () => {
  const event: AssistantRunEvent = {
    captureId: 'cap_safe_123',
    details: '$ node /tmp/bin.js memory show --vault /tmp/vault',
    providerKind: 'command',
    providerState: 'running',
    safeDetails: 'running memory show',
    type: 'capture.reply-progress',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(message, 'reply-progress cap_safe_123: running memory show')
  assert.doesNotMatch(message ?? '', /\/tmp\/vault/u)
})

test('formatAssistantRunEventForTerminal shows safe tool labels by default', () => {
  const event: AssistantRunEvent = {
    captureId: 'cap_safe_123',
    details: 'Tool vault.cli.run',
    providerKind: 'tool',
    providerState: 'completed',
    safeDetails: 'finished vault.cli.run',
    type: 'capture.reply-progress',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(message, 'reply-progress cap_safe_123: finished vault.cli.run')
})

test('formatAssistantRunEventForTerminal keeps safe auto-reply heartbeat details visible by default', () => {
  const event: AssistantRunEvent = {
    captureId: 'cap_safe_123',
    details: 'assistant still running after 10m; last provider activity 8m ago',
    providerKind: 'status',
    providerState: 'running',
    type: 'capture.reply-progress',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(
    message,
    'reply-progress cap_safe_123: assistant still running after 10m; last provider activity 8m ago',
  )
})

test('formatAssistantRunEventForTerminal keeps long-running auto-reply heartbeat details visible by default', () => {
  const event: AssistantRunEvent = {
    captureId: 'cap_safe_123',
    details:
      'assistant still running after 45m; deepthink command active for 43m; last provider activity 43m ago',
    providerKind: 'status',
    providerState: 'running',
    type: 'capture.reply-progress',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(
    message,
    'reply-progress cap_safe_123: assistant still running after 45m; deepthink command active for 43m; last provider activity 43m ago',
  )
})

test('formatAssistantRunEventForTerminal shows safe auto-reply failure details by default', () => {
  const event: AssistantRunEvent = {
    captureId: 'cap_safe_123',
    details:
      "Codex CLI failed. exit code 1. You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Apr 3rd, 2026 1:20 PM.",
    errorCode: 'ASSISTANT_CODEX_FAILED',
    safeDetails: 'provider usage limit reached (ASSISTANT_CODEX_FAILED)',
    type: 'capture.reply-failed',
  }

  const message = formatAssistantRunEventForTerminal(event)

  assert.equal(
    message,
    'reply-failed cap_safe_123: provider usage limit reached (ASSISTANT_CODEX_FAILED)',
  )
  assert.doesNotMatch(message ?? '', /purchase more credits/u)
})

test('formatAssistantRunEventForTerminal shows raw auto-reply failure details when unsafe details are enabled', () => {
  const event: AssistantRunEvent = {
    captureId: 'cap_safe_123',
    details: 'Temporary network interruption while delivering the reply.',
    errorCode: 'ASSISTANT_DELIVERY_FAILED',
    safeDetails: 'outbound delivery failed (ASSISTANT_DELIVERY_FAILED)',
    type: 'capture.reply-failed',
  }

  const message = formatAssistantRunEventForTerminal(event, {
    unsafeDetails: true,
  })

  assert.equal(
    message,
    'reply-failed cap_safe_123: Temporary network interruption while delivering the reply.',
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

test('formatAssistantRunEventForTerminal shows daemon failure details by default', () => {
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
    const vaultRoot = path.join(parent, 'vault')
    await mkdir(vaultRoot)
    cleanupPaths.push(parent)

    const created = await resolveAssistantSession({
      vault: vaultRoot,
      alias: 'telegram:bob',
      channel: 'telegram',
      identityId: 'assistant:primary',
      participantId: 'contact:bob',
      sourceThreadId: 'thread-42',
      model: 'gpt-oss:20b',
    })
    const statePaths = resolveAssistantStatePaths(vaultRoot)

    const listed = requireData(
      await runIsolatedCli<{
        stateRoot: string
        sessions: Array<{
          sessionId: string
          alias: string | null
        }>
      }>(['assistant', 'session', 'list', '--vault', vaultRoot]),
    )
    assert.equal(listed.sessions.length, 1)
    assert.equal(listed.sessions[0]?.sessionId, created.session.sessionId)
    assert.equal(listed.sessions[0]?.alias, 'telegram:bob')
    assert.equal(listed.stateRoot, statePaths.assistantStateRoot)
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
      }>(['assistant', 'session', 'show', created.session.sessionId, '--vault', vaultRoot]),
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
  'assistant session list and show redact HOME-based vault and runtime paths',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-cli-home-'))
    const homeRoot = path.join(parent, 'home')
    const vaultRoot = path.join(homeRoot, 'vault')
    await mkdir(vaultRoot, {
      recursive: true,
    })
    cleanupPaths.push(parent)

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
  'assistant commands use the saved default vault when --vault is omitted and still allow explicit overrides',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-assistant-default-vault-'))
    const homeRoot = path.join(parent, 'home')
    const defaultVaultRoot = path.join(homeRoot, 'default-vault')
    const overrideVaultRoot = path.join(homeRoot, 'override-vault')
    cleanupPaths.push(parent)

    await mkdir(defaultVaultRoot, { recursive: true })
    await mkdir(overrideVaultRoot, { recursive: true })

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
          env: isolateAssistantMemoryEnv(),
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
          env: isolateAssistantMemoryEnv(),
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
          sourceThreadId: string | null
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
        '--sourceThread',
        'saved-chat',
      ], {
        env,
      }),
    )

    assert.equal(setResult.configPath, '~/.murph/config.json')
    assert.equal(setResult.target.channel, 'telegram')
    assert.equal(setResult.target.participantId, 'saved-chat')
    assert.equal(setResult.target.sourceThreadId, 'saved-chat')

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
    assert.equal(config?.assistant?.selfDeliveryTargets?.telegram?.sourceThreadId, 'saved-chat')
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
  'provider-turn vault.cli.run falls back to the workspace CLI when vault-cli is unavailable on PATH',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'murph-provider-turn-cli-fallback-'))
    const vaultRoot = path.join(parent, 'vault')
    cleanupPaths.push(parent)

    await mkdir(vaultRoot, { recursive: true })

    const catalog = createProviderTurnAssistantToolCatalog({
      cliEnv: {
        HOME: parent,
        PATH: '',
      },
      vault: vaultRoot,
      workingDirectory: vaultRoot,
    })

    const [result] = await catalog.executeCalls({
      mode: 'apply',
      calls: [
        {
          tool: 'vault.cli.run',
          input: {
            args: ['--version'],
          },
        },
      ],
    })

    assert.equal(result?.status, 'succeeded')
    const payload = result?.result as {
      argv?: string[]
      exitCode?: number
      stdout?: string
    }
    assert.deepEqual(payload?.argv?.slice(0, 1), ['vault-cli'])
    assert.equal(payload?.exitCode, 0)
    assert.ok(String(payload?.stdout ?? '').trim().length > 0)
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test('root chat alias participates in default-vault injection', () => {
  assert.deepEqual(applyDefaultVaultToArgs(['chat'], '/tmp/default-vault'), [
    'chat',
    '--vault',
    '/tmp/default-vault',
  ])
  assert.deepEqual(applyDefaultVaultToArgs(['status'], '/tmp/default-vault'), [
    'status',
    '--vault',
    '/tmp/default-vault',
  ])
  assert.deepEqual(applyDefaultVaultToArgs(['doctor'], '/tmp/default-vault'), [
    'doctor',
    '--vault',
    '/tmp/default-vault',
  ])
  assert.deepEqual(applyDefaultVaultToArgs(['stop'], '/tmp/default-vault'), [
    'stop',
    '--vault',
    '/tmp/default-vault',
  ])
  assert.deepEqual(applyDefaultVaultToArgs(['run'], '/tmp/default-vault'), [
    'run',
    '--vault',
    '/tmp/default-vault',
  ])
  assert.deepEqual(
    applyDefaultVaultToArgs(['device', 'connect', 'oura'], '/tmp/default-vault'),
    ['device', 'connect', 'oura', '--vault', '/tmp/default-vault'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['workout', 'add', 'Ran 5k'], '/tmp/default-vault'),
    ['workout', 'add', 'Ran 5k', '--vault', '/tmp/default-vault'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['research', 'Check ApoB updates'], '/tmp/default-vault'),
    ['research', 'Check ApoB updates', '--vault', '/tmp/default-vault'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['deepthink', 'Think through recovery tradeoffs'], '/tmp/default-vault'),
    ['deepthink', 'Think through recovery tradeoffs', '--vault', '/tmp/default-vault'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['chat', '--vault', '/tmp/explicit-vault'], '/tmp/default-vault'),
    ['chat', '--vault', '/tmp/explicit-vault'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['status', '--vault', '/tmp/explicit-vault'], '/tmp/default-vault'),
    ['status', '--vault', '/tmp/explicit-vault'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['doctor', '--vault', '/tmp/explicit-vault'], '/tmp/default-vault'),
    ['doctor', '--vault', '/tmp/explicit-vault'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['stop', '--vault', '/tmp/explicit-vault'], '/tmp/default-vault'),
    ['stop', '--vault', '/tmp/explicit-vault'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['run', '--vault', '/tmp/explicit-vault'], '/tmp/default-vault'),
    ['run', '--vault', '/tmp/explicit-vault'],
  )
})

test('default-vault injection skips non-executing builtin flags', () => {
  assert.deepEqual(applyDefaultVaultToArgs(['chat', '--help'], '/tmp/default-vault'), [
    'chat',
    '--help',
  ])
  assert.deepEqual(
    applyDefaultVaultToArgs(['assistant', 'session', '--schema'], '/tmp/default-vault'),
    ['assistant', 'session', '--schema'],
  )
})

test('default-vault injection skips incomplete command groups', () => {
  assert.deepEqual(applyDefaultVaultToArgs(['assistant'], '/tmp/default-vault'), [
    'assistant',
  ])
  assert.deepEqual(
    applyDefaultVaultToArgs(['assistant', 'session'], '/tmp/default-vault'),
    ['assistant', 'session'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['memory'], '/tmp/default-vault'),
    ['memory'],
  )
  assert.deepEqual(applyDefaultVaultToArgs(['device'], '/tmp/default-vault'), ['device'])
  assert.deepEqual(applyDefaultVaultToArgs(['wearables'], '/tmp/default-vault'), ['wearables'])
  assert.deepEqual(applyDefaultVaultToArgs(['workout'], '/tmp/default-vault'), ['workout'])
  assert.deepEqual(
    applyDefaultVaultToArgs(['wearables', 'sleep'], '/tmp/default-vault'),
    ['wearables', 'sleep'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['workout', 'format'], '/tmp/default-vault'),
    ['workout', 'format'],
  )
  assert.deepEqual(applyDefaultVaultToArgs(['goal'], '/tmp/default-vault'), ['goal'])
  assert.deepEqual(
    applyDefaultVaultToArgs(['assistant', 'session', 'list'], '/tmp/default-vault'),
    ['assistant', 'session', 'list', '--vault', '/tmp/default-vault'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['memory', 'show'], '/tmp/default-vault'),
    ['memory', 'show', '--vault', '/tmp/default-vault'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['workout', 'format', 'list'], '/tmp/default-vault'),
    ['workout', 'format', 'list', '--vault', '/tmp/default-vault'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['wearables', 'sleep', 'list'], '/tmp/default-vault'),
    ['wearables', 'sleep', 'list', '--vault', '/tmp/default-vault'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(['assistant', 'self-target', 'list'], '/tmp/default-vault'),
    ['assistant', 'self-target', 'list'],
  )
  assert.deepEqual(
    applyDefaultVaultToArgs(
      ['route', 'estimate', '123 Example St, Melbourne VIC', 'St Kilda Beach'],
      '/tmp/default-vault',
    ),
    ['route', 'estimate', '123 Example St, Melbourne VIC', 'St Kilda Beach'],
  )
})

test('manifest marks query as vault-backed while model and route are exempt', () => {
  assert.equal(collectVaultRequiredCliDescriptorRootCommandNames().includes('query'), true)
  assert.equal(collectVaultCliDescriptorRootCommandNames().includes('model'), true)
  assert.equal(collectVaultCliDescriptorRootCommandNames().includes('route'), true)
  assert.equal(collectVaultRequiredCliDescriptorRootCommandNames().includes('model'), false)
  assert.equal(collectVaultRequiredCliDescriptorRootCommandNames().includes('route'), false)
})

test('applyDefaultVaultToArgs keeps model outside default-vault injection', () => {
  assert.deepEqual(applyDefaultVaultToArgs(['model'], '/tmp/default-vault'), ['model'])
  assert.deepEqual(
    applyDefaultVaultToArgs(['model', '--show'], '/tmp/default-vault'),
    ['model', '--show'],
  )
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
    oss: false,
    profile: 'ops',
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  })
  assert.equal(result.envelope.data?.summary, 'gpt-5.4 in Codex CLI (Pro account)')
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
  assert.equal(result.envelope.data?.summary, 'qwen3-coder in Codex OSS')
})

test('model --show summarizes a saved OpenAI-compatible backend without an endpoint', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-show-openai-'))
  cleanupPaths.push(homeRoot)

  await saveAssistantOperatorDefaultsPatch(
    {
      backend: {
        adapter: 'openai-compatible',
        apiKeyEnv: 'OPENAI_API_KEY',
        endpoint: null,
        headers: null,
        model: 'gpt-4.1-mini',
        providerName: 'openai',
        reasoningEffort: null,
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
  assert.equal(
    result.envelope.data?.summary,
    'gpt-4.1-mini via the saved OpenAI-compatible endpoint',
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
    notes: string[]
  }>(cli, ['model', '--show'])

  assert.equal(result.exitCode, null)
  assert.equal(result.envelope.ok, true)
  assert.deepEqual(result.envelope.data?.notes, [
    'Use the saved Codex home at /tmp/codex-1.',
  ])
})

test('interactive bare model uses the assistant Ink wizard selection before resolving details', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-wizard-'))
  cleanupPaths.push(homeRoot)

  const assistantWizard = vi.fn(async (_input: SetupAssistantWizardInput) => ({
    assistantPreset: 'openai-compatible' as const,
    assistantBaseUrl: 'http://127.0.0.1:11434/v1',
    assistantApiKeyEnv: 'OLLAMA_API_KEY',
    assistantProviderName: 'ollama',
    assistantOss: false,
  }))
  const resolveAssistant = vi.fn(
    async ({ options, preset }): Promise<SetupConfiguredAssistant> => ({
      preset,
      enabled: true,
      provider: 'openai-compatible',
      model: 'gpt-oss:20b',
      baseUrl: options.assistantBaseUrl ?? null,
      apiKeyEnv: options.assistantApiKeyEnv ?? null,
      providerName: options.assistantProviderName ?? null,
      codexCommand: null,
      profile: null,
      reasoningEffort: options.assistantReasoningEffort ?? null,
      sandbox: null,
      approvalPolicy: null,
      oss: false,
      account: null,
      detail: 'resolved after wizard selection',
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
  assert.deepEqual(assistantWizard.mock.calls[0]?.[0], {})
  assert.equal(resolveAssistant.mock.calls.length, 1)
  assert.deepEqual(resolveAssistant.mock.calls[0]?.[0], {
    allowPrompt: true,
    commandName: 'model',
    options: {
      vault: './vault',
      strict: true,
      whisperModel: 'base.en',
      assistantPreset: 'openai-compatible',
      assistantBaseUrl: 'http://127.0.0.1:11434/v1',
      assistantApiKeyEnv: 'OLLAMA_API_KEY',
      assistantProviderName: 'ollama',
    },
    preset: 'openai-compatible',
  })
  assert.equal(
    result.envelope.data?.summary,
    'gpt-oss:20b via http://127.0.0.1:11434/v1',
  )
})

test('interactive bare model clears stale saved model and provider metadata when the wizard changes endpoint details', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-wizard-reset-'))
  cleanupPaths.push(homeRoot)

  await saveAssistantOperatorDefaultsPatch(
    {
      backend: {
        adapter: 'openai-compatible',
        apiKeyEnv: 'OPENROUTER_API_KEY',
        endpoint: 'https://openrouter.ai/api/v1',
        headers: null,
        model: 'openai/gpt-4.1-mini',
        providerName: 'OpenRouter',
        reasoningEffort: 'high',
      },
      account: null,
    },
    homeRoot,
  )

  const assistantWizard = vi.fn(async (_input: SetupAssistantWizardInput) => ({
    assistantPreset: 'openai-compatible' as const,
    assistantBaseUrl: 'http://127.0.0.1:11434/v1',
    assistantApiKeyEnv: null,
    assistantProviderName: null,
    assistantOss: false,
  }))
  const resolveAssistant = vi.fn(
    async ({ options, preset }): Promise<SetupConfiguredAssistant> => ({
      preset,
      enabled: true,
      provider: 'openai-compatible',
      model: 'gpt-oss:20b',
      baseUrl: options.assistantBaseUrl ?? null,
      apiKeyEnv: options.assistantApiKeyEnv ?? null,
      providerName: options.assistantProviderName ?? null,
      codexCommand: null,
      profile: null,
      reasoningEffort: options.assistantReasoningEffort ?? null,
      sandbox: null,
      approvalPolicy: null,
      oss: false,
      account: null,
      detail: 'resolved after wizard selection',
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
  assert.equal(resolveAssistant.mock.calls.length, 1)
  assert.deepEqual(resolveAssistant.mock.calls[0]?.[0], {
    allowPrompt: true,
    commandName: 'model',
    options: {
      vault: './vault',
      strict: true,
      whisperModel: 'base.en',
      assistantPreset: 'openai-compatible',
      assistantBaseUrl: 'http://127.0.0.1:11434/v1',
    },
    preset: 'openai-compatible',
  })
})

test('model reuses existing backend defaults when only the model changes', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-update-'))
  cleanupPaths.push(homeRoot)

  await saveAssistantOperatorDefaultsPatch(
    {
      backend: {
        adapter: 'openai-compatible',
        apiKeyEnv: 'OLLAMA_API_KEY',
        endpoint: 'http://127.0.0.1:11434/v1',
        headers: null,
        model: 'llama3.2:latest',
        providerName: 'ollama',
        reasoningEffort: 'high',
      },
      account: null,
    },
    homeRoot,
  )

  const resolveAssistant = vi.fn(
    async ({ options, preset }): Promise<SetupConfiguredAssistant> => ({
      preset,
      enabled: true,
      provider: 'openai-compatible',
      model: options.assistantModel ?? null,
      baseUrl: options.assistantBaseUrl ?? null,
      apiKeyEnv: options.assistantApiKeyEnv ?? null,
      providerName: options.assistantProviderName ?? null,
      codexCommand: null,
      profile: null,
      reasoningEffort: options.assistantReasoningEffort ?? null,
      sandbox: null,
      approvalPolicy: null,
      oss: false,
      account: null,
      detail: 'saved openai-compatible backend',
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
      endpoint: string | null
      apiKeyEnv: string | null
      model: string | null
      providerName: string | null
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
      assistantPreset: 'openai-compatible',
      assistantModel: 'gpt-oss:20b',
      assistantBaseUrl: 'http://127.0.0.1:11434/v1',
      assistantApiKeyEnv: 'OLLAMA_API_KEY',
      assistantProviderName: 'ollama',
    },
    preset: 'openai-compatible',
  })
  assert.deepEqual(result.envelope.data?.backend, {
    adapter: 'openai-compatible',
    apiKeyEnv: 'OLLAMA_API_KEY',
    endpoint: 'http://127.0.0.1:11434/v1',
    headers: null,
    model: 'gpt-oss:20b',
    providerName: 'ollama',
    reasoningEffort: null,
  })
  assert.deepEqual(result.envelope.data?.notes, [
    'Export OLLAMA_API_KEY before using the saved OpenAI-compatible assistant backend.',
  ])
  assert.equal(
    result.envelope.data?.summary,
    'gpt-oss:20b via http://127.0.0.1:11434/v1',
  )

  const savedConfig = await readOperatorConfig(homeRoot)
  assert.equal(savedConfig?.assistant?.backend?.adapter, 'openai-compatible')
  assert.equal(savedConfig?.assistant?.backend?.model, 'gpt-oss:20b')
  assert.equal(savedConfig?.assistant?.backend?.providerName, 'ollama')
})

test('changing presets does not leak saved defaults from a different backend adapter', async () => {
  const homeRoot = await mkdtemp(path.join(tmpdir(), 'murph-model-preset-switch-'))
  cleanupPaths.push(homeRoot)

  await saveAssistantOperatorDefaultsPatch(
    {
      backend: {
        adapter: 'openai-compatible',
        apiKeyEnv: 'OPENROUTER_API_KEY',
        endpoint: 'https://openrouter.ai/api/v1',
        headers: null,
        model: 'openai/gpt-4.1-mini',
        providerName: 'OpenRouter',
        reasoningEffort: 'high',
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
      baseUrl: options.assistantBaseUrl ?? null,
      apiKeyEnv: options.assistantApiKeyEnv ?? null,
      providerName: options.assistantProviderName ?? null,
      codexCommand: options.assistantCodexCommand ?? null,
      profile: options.assistantProfile ?? null,
      reasoningEffort: options.assistantReasoningEffort ?? null,
      sandbox: null,
      approvalPolicy: null,
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
    '--preset',
    'codex',
    '--model',
    'gpt-5.4',
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
      baseUrl: options.assistantBaseUrl ?? null,
      apiKeyEnv: options.assistantApiKeyEnv ?? null,
      providerName: options.assistantProviderName ?? null,
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

test('root chat prints only a resume hint after a human TTY session exits', async () => {
  runtimeMocks.runAssistantChat.mockResolvedValue(createMockChatResult('asst_human'))

  const result = await runInProcessCliWithTty(['chat', '--vault', '/tmp/mock-vault'])

  assert.equal(result.stdout, '')
  assert.equal(
    result.stderr,
    'Resume chat by typing: murph chat --session "asst_human"\n',
  )
  assert.deepEqual(runtimeMocks.runAssistantChat.mock.calls, [
    [
      {
        vault: '/tmp/mock-vault',
        initialPrompt: undefined,
        sessionId: undefined,
        alias: undefined,
        channel: undefined,
        identityId: undefined,
        participantId: undefined,
        sourceThreadId: undefined,
        provider: undefined,
        codexCommand: undefined,
        model: undefined,
        baseUrl: undefined,
        apiKeyEnv: undefined,
        providerName: undefined,
        sandbox: undefined,
        approvalPolicy: undefined,
        profile: undefined,
        oss: undefined,
      },
    ],
  ])
})

test('root chat keeps explicit machine-readable output intact', async () => {
  runtimeMocks.runAssistantChat.mockResolvedValue(createMockChatResult('asst_json'))

  const result = await runInProcessCliWithTty([
    'chat',
    '--vault',
    '/tmp/mock-vault',
    '--format',
    'json',
  ])

  assert.equal(result.stderr, '')
  assert.deepEqual(JSON.parse(result.stdout), createMockChatResult('asst_json'))
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
        provider: 'codex-cli',
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

function createMockChatResult(sessionId: string) {
  return {
    vault: '/tmp/mock-vault',
    startedAt: '2026-03-17T23:20:16.318Z',
    stoppedAt: '2026-03-17T23:21:22.167Z',
    turns: 0,
    session: {
      schema: 'murph.assistant-session.v4' as const,
      sessionId,
      target: {
        adapter: 'codex-cli' as const,
        approvalPolicy: 'never' as const,
        codexCommand: null,
        model: null,
        oss: false,
        profile: null,
        reasoningEffort: null,
        sandbox: 'read-only' as const,
      },
      resumeState: null,
      provider: 'codex-cli' as const,
      providerOptions: {
        model: null,
        reasoningEffort: null,
        sandbox: 'read-only' as const,
        approvalPolicy: 'never' as const,
        profile: null,
        oss: false,
      },
      alias: null,
      binding: {
        conversationKey: null,
        channel: null,
        identityId: null,
        actorId: null,
        threadId: null,
        threadIsDirect: null,
        delivery: null,
      },
      createdAt: '2026-03-17T23:20:16.331Z',
      updatedAt: '2026-03-17T23:20:16.331Z',
      lastTurnAt: null,
      turnCount: 0,
    },
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
  const stdoutTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  const stderrWriteSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return true
    }) as typeof process.stderr.write)

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
    stderrWriteSpy.mockRestore()

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

  await cli.serve([...args, '--format', 'json', '--verbose'], {
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
