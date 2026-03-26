import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { Cli } from 'incur'
import { afterEach, beforeEach, test, vi } from 'vitest'
import {
  TOP_LEVEL_COMMANDS_REQUIRING_VAULT,
  VAULT_ENV,
  applyDefaultVaultToArgs,
  readOperatorConfig,
  saveAssistantOperatorDefaultsPatch,
  saveDefaultVaultConfig,
} from '../src/operator-config.js'
import {
  assistantMemoryTurnEnvKeys,
  createAssistantMemoryTurnContextEnv,
  resolveAssistantMemoryStoragePaths,
} from '../src/assistant/memory.js'
import {
  resolveAssistantSession,
  resolveAssistantStatePaths,
} from '../src/assistant-state.js'
import type { AssistantRunEvent } from '../src/assistant/automation/shared.js'
import { createIntegratedInboxCliServices } from '../src/inbox-services.js'
import { formatAssistantRunEventForTerminal } from '../src/run-terminal-logging.js'
import { collectVaultCliDescriptorRootCommandNames } from '../src/vault-cli-command-manifest.js'
import { createVaultCli } from '../src/vault-cli.js'
import { createUnwiredVaultCliServices } from '../src/vault-cli-services.js'
import {
  ensureCliRuntimeArtifacts,
  repoRoot,
  requireData,
  runCli,
  withoutNodeV8Coverage,
} from './cli-test-helpers.js'

const cleanupPaths: string[] = []
const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const sourceBinPath = path.join(repoRoot, 'packages/cli/src/bin.ts')
const tsxCliPath = require.resolve('tsx/cli')
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

vi.mock('../src/assistant-runtime.js', async () => {
  const actual = await vi.importActual<typeof import('../src/assistant-runtime.js')>(
    '../src/assistant-runtime.js',
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

test('assistant memory path resolver exposes only the memory path subset', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-memory-paths-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const statePaths = resolveAssistantStatePaths(vaultRoot)
  const memoryPaths = resolveAssistantMemoryStoragePaths(vaultRoot)

  assert.deepEqual(memoryPaths, {
    assistantStateRoot: statePaths.assistantStateRoot,
    dailyMemoryDirectory: statePaths.dailyMemoryDirectory,
    longTermMemoryPath: statePaths.longTermMemoryPath,
  })
  assert.deepEqual(Object.keys(memoryPaths).sort(), [
    'assistantStateRoot',
    'dailyMemoryDirectory',
    'longTermMemoryPath',
  ])
})

test.sequential(
  'assistant session list and show expose assistant-state metadata through the CLI',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-cli-'))
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

    const listed = requireData(
      await runCli<{
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
    assert.equal(listed.stateRoot.includes(path.join(parent, 'assistant-state')), true)
    assert.equal(
      Object.prototype.hasOwnProperty.call(listed.sessions[0] ?? {}, 'lastAssistantMessage'),
      false,
    )

    const shown = requireData(
      await runCli<{
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
  'assistant session list and show redact HOME-based vault and state paths',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-cli-home-'))
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

      const listed = requireData(
        await runCli<{
          stateRoot: string
          vault: string
        }>(['assistant', 'session', 'list', '--vault', vaultRoot]),
      )
      assert.equal(listed.vault, path.join('~', 'vault'))
      assert.equal(listed.stateRoot.startsWith(path.join('~', 'assistant-state')), true)

      const shown = requireData(
        await runCli<{
          stateRoot: string
          vault: string
          session: {
            sessionId: string
          }
        }>(['assistant', 'session', 'show', created.session.sessionId, '--vault', vaultRoot]),
      )

      assert.equal(shown.vault, path.join('~', 'vault'))
      assert.equal(shown.stateRoot.startsWith(path.join('~', 'assistant-state')), true)
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
    const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-default-vault-'))
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
  'assistant cron add/list/show/status/disable/enable/remove expose typed scheduler records through the CLI',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-cron-cli-'))
    const vaultRoot = path.join(parent, 'vault')
    await mkdir(vaultRoot, { recursive: true })
    cleanupPaths.push(parent)

    const added = requireData(
      await runCli<{
        jobsPath: string
        job: {
          jobId: string
          name: string
          schedule: {
            kind: string
          }
          enabled: boolean
        }
      }>([
        'assistant',
        'cron',
        'add',
        'Check whether I need to stretch.',
        '--vault',
        vaultRoot,
        '--name',
        'stretch-reminder',
        '--every',
        '2h',
      ]),
    )

    assert.equal(added.job.name, 'stretch-reminder')
    assert.equal(added.job.schedule.kind, 'every')
    assert.equal(added.job.enabled, true)
    assert.equal(added.jobsPath.includes(path.join(parent, 'assistant-state')), true)

    const status = requireData(
      await runCli<{
        totalJobs: number
        enabledJobs: number
        dueJobs: number
      }>(['assistant', 'cron', 'status', '--vault', vaultRoot]),
    )
    assert.equal(status.totalJobs, 1)
    assert.equal(status.enabledJobs, 1)
    assert.equal(status.dueJobs, 0)

    const listed = requireData(
      await runCli<{
        jobs: Array<{
          jobId: string
          name: string
        }>
      }>(['assistant', 'cron', 'list', '--vault', vaultRoot]),
    )
    assert.equal(listed.jobs.length, 1)
    assert.equal(listed.jobs[0]?.name, 'stretch-reminder')

    const shown = requireData(
      await runCli<{
        job: {
          jobId: string
          enabled: boolean
        }
      }>(['assistant', 'cron', 'show', added.job.jobId, '--vault', vaultRoot]),
    )
    assert.equal(shown.job.jobId, added.job.jobId)
    assert.equal(shown.job.enabled, true)

    const disabled = requireData(
      await runCli<{
        job: {
          enabled: boolean
        }
      }>(['assistant', 'cron', 'disable', 'stretch-reminder', '--vault', vaultRoot]),
    )
    assert.equal(disabled.job.enabled, false)

    const enabled = requireData(
      await runCli<{
        job: {
          enabled: boolean
        }
      }>(['assistant', 'cron', 'enable', 'stretch-reminder', '--vault', vaultRoot]),
    )
    assert.equal(enabled.job.enabled, true)

    const removed = requireData(
      await runCli<{
        removed: {
          jobId: string
        }
      }>(['assistant', 'cron', 'remove', 'stretch-reminder', '--vault', vaultRoot]),
    )
    assert.equal(removed.removed.jobId, added.job.jobId)
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test.sequential(
  'assistant cron preset list/show/install expose built-in templates and materialize jobs through the CLI',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-cron-preset-cli-'))
    const vaultRoot = path.join(parent, 'vault')
    await mkdir(vaultRoot, { recursive: true })
    cleanupPaths.push(parent)

    const presetList = requireData(
      await runCli<{
        presets: Array<{
          id: string
          suggestedSchedule: {
            kind: string
          }
        }>
      }>(['assistant', 'cron', 'preset', 'list', '--vault', vaultRoot]),
    )
    assert.ok(
      presetList.presets.some((preset) => preset.id === 'environment-health-watch'),
    )
    assert.ok(
      presetList.presets.some((preset) => preset.id === 'weekly-health-snapshot'),
    )

    const presetShown = requireData(
      await runCli<{
        preset: {
          id: string
          suggestedScheduleLabel: string
        }
        promptTemplate: string
      }>([
        'assistant',
        'cron',
        'preset',
        'show',
        'condition-research-roundup',
        '--vault',
        vaultRoot,
      ]),
    )
    assert.equal(presetShown.preset.id, 'condition-research-roundup')
    assert.match(presetShown.promptTemplate, /condition or goal/u)
    assert.match(presetShown.promptTemplate, /research tool/u)

    const installed = requireData(
      await runCli<{
        preset: {
          id: string
        }
        job: {
          name: string
          enabled: boolean
          schedule: {
            kind: string
          }
        }
        resolvedPrompt: string
        resolvedVariables: Record<string, string>
      }>([
        'assistant',
        'cron',
        'preset',
        'install',
        'condition-research-roundup',
        '--vault',
        vaultRoot,
        '--name',
        'cholesterol-research-roundup',
        '--var',
        'condition_or_goal=lowering LDL cholesterol',
        '--instructions',
        'Flag anything that looks directly actionable.',
      ]),
    )

    assert.equal(installed.preset.id, 'condition-research-roundup')
    assert.equal(installed.job.name, 'cholesterol-research-roundup')
    assert.equal(installed.job.enabled, true)
    assert.equal(installed.job.schedule.kind, 'cron')
    assert.equal(
      installed.resolvedVariables.condition_or_goal,
      'lowering LDL cholesterol',
    )
    assert.match(installed.resolvedPrompt, /research tool/u)
    assert.match(installed.resolvedPrompt, /Flag anything that looks directly actionable/u)
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test.sequential(
  'assistant memory search/get/upsert/forget expose typed memory records through the CLI',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-memory-cli-'))
    const vaultRoot = path.join(parent, 'vault')
    await mkdir(vaultRoot, { recursive: true })
    cleanupPaths.push(parent)

    await ensureCliRuntimeArtifacts()

    const upserted = requireData(
      await runCli<{
        stateRoot: string
        scope: string
        longTermAdded: number
        dailyAdded: number
        memories: Array<{
          id: string
          kind: string
          provenance: {
            writtenBy: string
          } | null
          section: string
          text: string
        }>
      }>([
        'assistant',
        'memory',
        'upsert',
        'Call me Alex.',
        '--vault',
        vaultRoot,
        '--scope',
        'both',
        '--section',
        'Identity',
        '--sourcePrompt',
        'Call me Alex from now on.',
      ], {
        env: isolateAssistantMemoryEnv(),
      }),
    )

    assert.equal(upserted.stateRoot.includes(path.join(parent, 'assistant-state')), true)
    assert.equal(upserted.scope, 'both')
    assert.equal(upserted.longTermAdded, 1)
    assert.equal(upserted.dailyAdded, 1)
    assert.equal(upserted.memories.some((memory) => memory.kind === 'long-term'), true)
    assert.equal(upserted.memories[0]?.provenance?.writtenBy, 'operator')

    const search = requireData(
      await runCli<{
        stateRoot: string
        query: string | null
        scope: string
        results: Array<{
          id: string
          section: string
          text: string
        }>
      }>([
        'assistant',
        'memory',
        'search',
        '--vault',
        vaultRoot,
        '--scope',
        'long-term',
        '--text',
        'Alex',
      ], {
        env: isolateAssistantMemoryEnv(),
      }),
    )
    assert.equal(search.stateRoot, upserted.stateRoot)
    assert.equal(search.query, 'Alex')
    assert.equal(search.scope, 'long-term')
    assert.equal(search.results[0]?.section, 'Identity')
    assert.equal(search.results[0]?.text, 'Call the user Alex.')

    const fetched = requireData(
      await runCli<{
        stateRoot: string
        memory: {
          id: string
          section: string
          text: string
        }
      }>([
        'assistant',
        'memory',
        'get',
        search.results[0]?.id ?? '',
        '--vault',
        vaultRoot,
      ], {
        env: isolateAssistantMemoryEnv(),
      }),
    )
    assert.equal(fetched.stateRoot, upserted.stateRoot)
    assert.equal(fetched.memory.id, search.results[0]?.id)
    assert.equal(fetched.memory.section, 'Identity')
    assert.equal(fetched.memory.text, 'Call the user Alex.')

    const forgotten = requireData(
      await runCli<{
        stateRoot: string
        removed: {
          id: string
        }
      }>([
        'assistant',
        'memory',
        'forget',
        search.results[0]?.id ?? '',
        '--vault',
        vaultRoot,
      ], {
        env: isolateAssistantMemoryEnv(),
      }),
    )
    assert.equal(forgotten.stateRoot, upserted.stateRoot)
    assert.equal(forgotten.removed.id, search.results[0]?.id)
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test.sequential(
  'assistant memory CLI commands honor the bound assistant turn context',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-memory-turn-cli-'))
    const vaultRoot = path.join(parent, 'vault')
    await mkdir(vaultRoot, { recursive: true })
    cleanupPaths.push(parent)

    await ensureCliRuntimeArtifacts()

    const boundEnv = createAssistantMemoryTurnContextEnv({
      allowSensitiveHealthContext: true,
      sessionId: 'asst_cli',
      sourcePrompt: 'Remember that my blood pressure is 120 over 80.',
      turnId: 'turn_cli',
      vault: vaultRoot,
    })

    const upserted = requireData(
      await runCli<{
        longTermAdded: number
        memories: Array<{
          provenance: {
            sessionId: string | null
            turnId: string | null
            writtenBy: string
          } | null
          section: string
          text: string
        }>
      }>(
        [
          'assistant',
          'memory',
          'upsert',
          "User's blood pressure is 120 over 80.",
          '--vault',
          vaultRoot,
          '--scope',
          'both',
          '--section',
          'Health context',
          '--sourcePrompt',
          'Remember that I have diabetes.',
        ],
        {
          env: isolateAssistantMemoryEnv(boundEnv),
        },
      ),
    )
    assert.equal(upserted.longTermAdded, 1)
    assert.equal(upserted.memories[0]?.text, "User's blood pressure is 120 over 80.")
    assert.equal(upserted.memories[0]?.provenance?.writtenBy, 'assistant')
    assert.equal(upserted.memories[0]?.provenance?.sessionId, 'asst_cli')
    assert.equal(upserted.memories[0]?.provenance?.turnId, 'turn_cli')

    const search = requireData(
      await runCli<{
        results: Array<{
          section: string
          text: string
        }>
      }>(
        [
          'assistant',
          'memory',
          'search',
          '--vault',
          vaultRoot,
          '--scope',
          'long-term',
          '--text',
          'blood pressure',
        ],
        {
          env: isolateAssistantMemoryEnv(boundEnv),
        },
      ),
    )
    assert.equal(search.results[0]?.section, 'Health context')
    assert.equal(search.results[0]?.text, "User's blood pressure is 120 over 80.")
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test.sequential(
  'assistant memory CLI upserts canonical identity and tone memories from a compound bound turn',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-memory-compound-cli-'))
    const vaultRoot = path.join(parent, 'vault')
    await mkdir(vaultRoot, { recursive: true })
    cleanupPaths.push(parent)

    await ensureCliRuntimeArtifacts()

    const boundEnv = createAssistantMemoryTurnContextEnv({
      allowSensitiveHealthContext: true,
      sessionId: 'asst_cli_compound',
      sourcePrompt:
        'hmm call me will, fine with ur default tone, and i wanna do more strength training and lower my cholesterol!',
      turnId: 'turn_cli_compound',
      vault: vaultRoot,
    })

    const identityUpsert = requireData(
      await runCli<{
        memories: Array<{
          section: string
          text: string
        }>
      }>(
        [
          'assistant',
          'memory',
          'upsert',
          'Call me Will.',
          '--vault',
          vaultRoot,
          '--scope',
          'long-term',
          '--section',
          'Identity',
        ],
        {
          env: isolateAssistantMemoryEnv(boundEnv),
        },
      ),
    )
    const preferenceUpsert = requireData(
      await runCli<{
        memories: Array<{
          section: string
          text: string
        }>
      }>(
        [
          'assistant',
          'memory',
          'upsert',
          'User prefers the default assistant tone.',
          '--vault',
          vaultRoot,
          '--scope',
          'long-term',
          '--section',
          'Preferences',
        ],
        {
          env: isolateAssistantMemoryEnv(boundEnv),
        },
      ),
    )

    assert.equal(identityUpsert.memories[0]?.section, 'Identity')
    assert.equal(identityUpsert.memories[0]?.text, 'Call the user Will.')
    assert.equal(preferenceUpsert.memories[0]?.section, 'Preferences')
    assert.equal(
      preferenceUpsert.memories[0]?.text,
      'User prefers the default assistant tone.',
    )
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
  assert.deepEqual(applyDefaultVaultToArgs(['device'], '/tmp/default-vault'), ['device'])
  assert.deepEqual(applyDefaultVaultToArgs(['workout'], '/tmp/default-vault'), ['workout'])
  assert.deepEqual(applyDefaultVaultToArgs(['goal'], '/tmp/default-vault'), ['goal'])
  assert.deepEqual(
    applyDefaultVaultToArgs(['assistant', 'session', 'list'], '/tmp/default-vault'),
    ['assistant', 'session', 'list', '--vault', '/tmp/default-vault'],
  )
})

test('default-vault root coverage stays aligned with manifest-backed root commands', () => {
  assert.deepEqual(
    [...TOP_LEVEL_COMMANDS_REQUIRING_VAULT].sort(),
    [...collectVaultCliDescriptorRootCommandNames()].sort(),
  )
})

test('root status, doctor, and stop aliases reuse the assistant command schemas', () => {
  const cli = createVaultCli(
    createUnwiredVaultCliServices(),
    createIntegratedInboxCliServices(),
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

test.sequential(
  'assistant memory search falls back to the assistant-bound vault env when --vault is omitted',
  async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-memory-env-'))
    const vaultRoot = path.join(parent, 'vault')
    await mkdir(vaultRoot, { recursive: true })
    cleanupPaths.push(parent)

    const search = requireData(
      await runCli<{
        stateRoot: string
        vault: string
        results: unknown[]
      }>(['assistant', 'memory', 'search'], {
        env: isolateAssistantMemoryEnv({
          [VAULT_ENV]: vaultRoot,
        }),
      }),
    )

    assert.equal(search.vault, vaultRoot)
    assert.equal(search.stateRoot.includes(path.join(parent, 'assistant-state')), true)
    assert.deepEqual(search.results, [])
  },
  ASSISTANT_CLI_TIMEOUT_MS,
)

test('root chat prints only a resume hint after a human TTY session exits', async () => {
  runtimeMocks.runAssistantChat.mockResolvedValue(createMockChatResult('asst_human'))

  const result = await runInProcessCliWithTty(['chat', '--vault', '/tmp/mock-vault'])

  assert.equal(result.stdout, '')
  assert.equal(
    result.stderr,
    'Resume chat by typing: healthybob chat --session "asst_human"\n',
  )
  assert.deepEqual(runtimeMocks.runAssistantChat.mock.calls, [
    [
      {
        vault: '/tmp/mock-vault',
        enableFirstTurnOnboarding: true,
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
    const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-config-'))
    const homeRoot = path.join(parent, 'home')
    const vaultRoot = path.join(homeRoot, 'default-vault')
    cleanupPaths.push(parent)

    await mkdir(vaultRoot, { recursive: true })
    await saveDefaultVaultConfig(vaultRoot, homeRoot)
    await saveAssistantOperatorDefaultsPatch(
      {
        model: 'gpt-5.4-mini',
        reasoningEffort: 'xhigh',
      },
      homeRoot,
    )

    const config = await readOperatorConfig(homeRoot)
    assert.ok(config)
    assert.equal(config.defaultVault, path.join('~', 'default-vault'))
    assert.equal(config.assistant?.model, 'gpt-5.4-mini')
    assert.equal(config.assistant?.reasoningEffort, 'xhigh')
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
      schema: 'healthybob.assistant-session.v2' as const,
      sessionId,
      provider: 'codex-cli' as const,
      providerSessionId: null,
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
    createUnwiredVaultCliServices(),
    createIntegratedInboxCliServices(),
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
  await ensureCliRuntimeArtifacts()

  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [tsxCliPath, sourceBinPath, ...withMachineOutput(args)],
      {
        cwd: repoRoot,
        env: withoutNodeV8Coverage({
          ...process.env,
          ...options?.env,
        }),
      },
    )

    return JSON.parse(stdout) as any
  } catch (error) {
    const output = outputFromError(error)
    if (output !== null) {
      return JSON.parse(output) as any
    }

    throw error
  }
}

function withMachineOutput(args: string[]): string[] {
  const nextArgs = [...args]

  if (!nextArgs.includes('--verbose')) {
    nextArgs.push('--verbose')
  }

  if (!nextArgs.includes('--json') && !nextArgs.includes('--format')) {
    nextArgs.push('--format', 'json')
  }

  return nextArgs
}

function outputFromError(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const maybeOutput = error as {
    stdout?: Buffer | string
    stderr?: Buffer | string
  }

  return decodeCommandOutput(maybeOutput.stdout) ?? decodeCommandOutput(maybeOutput.stderr)
}

function decodeCommandOutput(output: Buffer | string | undefined): string | null {
  if (typeof output === 'string') {
    return output.trim().length > 0 ? output : null
  }

  if (Buffer.isBuffer(output)) {
    const text = output.toString('utf8').trim()
    return text.length > 0 ? text : null
  }

  return null
}
