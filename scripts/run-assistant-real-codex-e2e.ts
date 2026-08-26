import { spawnSync } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

export type AssistantRealCodexAuthMode = 'provider' | 'subscription'

export interface AssistantRealCodexRunOptions {
  authMode: AssistantRealCodexAuthMode
  codexHome: string | null
  help: boolean
  model: string | null
  testPattern: string | null
}

export interface AssistantRealCodexCommandRequest {
  args: string[]
  command: string
  env: NodeJS.ProcessEnv
  stdio: 'capture' | 'ignore' | 'inherit'
}

export interface AssistantRealCodexCommandResult {
  error?: Error
  status: number | null
  stdout?: string
}

export interface AssistantRealCodexRunDependencies {
  runCommand: (
    request: AssistantRealCodexCommandRequest,
  ) => AssistantRealCodexCommandResult
  sourceEnv: NodeJS.ProcessEnv
  writeStderr: (message: string) => void
  writeStdout: (message: string) => void
}

const DEFAULT_OPTIONS: AssistantRealCodexRunOptions = {
  authMode: 'subscription',
  codexHome: null,
  help: false,
  model: null,
  testPattern: null,
}
const REAL_CODEX_E2E_TAG = 'real-codex-live'

const USAGE = [
  'Usage: pnpm test:assistant:live -- --test <name-pattern> [options]',
  '',
  'Options:',
  '  --auth subscription|provider  Use local ChatGPT auth (default) or provider env.',
  '  --codex-home <absolute-path>   Use an explicit local Codex home for subscription auth.',
  '  --model <model>               Override the default gpt-5.6-terra model.',
  '  -h, --help                    Show this help.',
].join('\n')

export function parseAssistantRealCodexRunArgs(
  argv: readonly string[],
): AssistantRealCodexRunOptions {
  const options = { ...DEFAULT_OPTIONS }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!argument || argument === '--') {
      continue
    }
    if (argument === '-h' || argument === '--help') {
      options.help = true
      continue
    }
    if (argument === '--test') {
      options.testPattern = readRequiredValue(argv, index, argument)
      index += 1
      continue
    }
    if (argument === '--model') {
      options.model = readRequiredValue(argv, index, argument)
      index += 1
      continue
    }
    if (argument === '--codex-home') {
      const codexHome = readRequiredValue(argv, index, argument)
      if (!isAbsolute(codexHome)) {
        throw new Error('--codex-home requires an absolute path.')
      }
      options.codexHome = codexHome
      index += 1
      continue
    }
    if (argument === '--auth') {
      const authMode = readRequiredValue(argv, index, argument)
      if (authMode !== 'provider' && authMode !== 'subscription') {
        throw new Error('--auth must be subscription or provider.')
      }
      options.authMode = authMode
      index += 1
      continue
    }
    if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`)
    }
    if (options.testPattern) {
      throw new Error('Provide exactly one test-name pattern.')
    }
    options.testPattern = argument
  }

  if (!options.help && !options.testPattern) {
    throw new Error('A focused --test name pattern is required.')
  }
  if (options.authMode === 'provider' && options.codexHome) {
    throw new Error('--codex-home is available only with subscription auth.')
  }

  return options
}

export function buildAssistantRealCodexRunEnv(input: {
  options: AssistantRealCodexRunOptions
  sourceEnv?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  const sourceEnv = input.sourceEnv ?? process.env
  const env = input.options.authMode === 'subscription'
    ? buildSubscriptionRunEnv(sourceEnv, input.options.codexHome)
    : { ...sourceEnv }
  env.MURPH_RUN_REAL_CODEX_E2E = '1'

  if (input.options.authMode === 'subscription') {
    env.MURPH_REAL_CODEX_AUTH = 'subscription'
    delete env.MURPH_REAL_CODEX_COMMAND
    delete env.MURPH_REAL_CODEX_MODEL_PROVIDER
    delete env.MURPH_REAL_CODEX_PROVIDER_ENV_KEY
  } else {
    delete env.MURPH_REAL_CODEX_AUTH
    delete env.MURPH_REAL_CODEX_HOME
  }

  if (input.options.model) {
    env.MURPH_REAL_CODEX_MODEL = input.options.model
  }

  return env
}

export function buildAssistantRealCodexLoginEnv(
  sourceEnv: NodeJS.ProcessEnv,
  codexHome: string | null = null,
): NodeJS.ProcessEnv {
  const env = { ...sourceEnv }
  delete env.MURPH_REAL_CODEX_HOME
  if (codexHome) {
    env.CODEX_HOME = codexHome
  } else {
    delete env.CODEX_HOME
  }
  return env
}

export function buildAssistantRealCodexListArgs(
  testPattern: string,
): string[] {
  return [
    '--dir',
    'packages/assistant-engine',
    'exec',
    'vitest',
    'list',
    '--config',
    'vitest.config.ts',
    'test/assistant-codex-real-e2e.test.ts',
    '--testNamePattern',
    testPattern,
    '--tagsFilter',
    REAL_CODEX_E2E_TAG,
    '--json',
  ]
}

export function buildAssistantRealCodexVitestArgs(
  fullTestName: string,
): string[] {
  const matcherName = fullTestName.replaceAll(' > ', ' ')
  return [
    '--dir',
    'packages/assistant-engine',
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.config.ts',
    '--no-coverage',
    'test/assistant-codex-real-e2e.test.ts',
    '--testNamePattern',
    `^${escapeRegularExpression(matcherName)}$`,
    '--tagsFilter',
    REAL_CODEX_E2E_TAG,
  ]
}

export function requireSingleAssistantRealCodexTest(
  listOutput: string,
): string {
  let listed: unknown
  try {
    listed = JSON.parse(listOutput)
  } catch {
    throw new Error('Vitest returned an unreadable focused-test list.')
  }
  if (!Array.isArray(listed)) {
    throw new Error('Vitest returned an unreadable focused-test list.')
  }

  const names = listed.flatMap((entry) => {
    if (
      entry
      && typeof entry === 'object'
      && typeof (entry as { name?: unknown }).name === 'string'
    ) {
      return [(entry as { name: string }).name]
    }
    return []
  })
  if (names.length === 0) {
    throw new Error('The test-name pattern did not match a live journey.')
  }
  if (names.length !== 1) {
    throw new Error(
      `The test-name pattern matched ${names.length} live journeys; make it more specific.`,
    )
  }
  return names[0] as string
}

export function executeAssistantRealCodexRun(
  options: AssistantRealCodexRunOptions,
  dependencies: AssistantRealCodexRunDependencies,
): number {
  const testPattern = options.testPattern
  if (!testPattern) {
    throw new Error('Test pattern was not resolved.')
  }

  const liveEnv = buildAssistantRealCodexRunEnv({
    options,
    sourceEnv: dependencies.sourceEnv,
  })
  const listCommand = buildPnpmCommand(
    buildAssistantRealCodexListArgs(testPattern),
    dependencies.sourceEnv,
  )
  const listed = dependencies.runCommand({
    ...listCommand,
    env: liveEnv,
    stdio: 'capture',
  })
  if (listed.error || listed.status !== 0) {
    dependencies.writeStderr('Could not enumerate the focused live journey.\n')
    return 1
  }
  let fullTestName: string
  try {
    fullTestName = requireSingleAssistantRealCodexTest(listed.stdout ?? '')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    dependencies.writeStderr(`${message}\n`)
    return 2
  }

  if (options.authMode === 'subscription') {
    const loginStatus = dependencies.runCommand({
      args: ['login', 'status'],
      command: 'codex',
      env: buildAssistantRealCodexLoginEnv(
        dependencies.sourceEnv,
        options.codexHome,
      ),
      stdio: 'ignore',
    })
    if (loginStatus.status !== 0) {
      dependencies.writeStderr(
        'Codex is not logged in with ChatGPT. Run `codex login`, then retry.\n',
      )
      return 1
    }
  }

  const effectiveModel =
    options.model
    ?? dependencies.sourceEnv.MURPH_REAL_CODEX_MODEL?.trim()
    ?? 'gpt-5.6-terra'
  dependencies.writeStdout(
    `Running one real Murph assistant journey with ${effectiveModel} via ${options.authMode} auth.\n`,
  )

  const liveCommand = buildPnpmCommand(
    buildAssistantRealCodexVitestArgs(fullTestName),
    dependencies.sourceEnv,
  )
  const child = dependencies.runCommand({
    ...liveCommand,
    env: liveEnv,
    stdio: 'inherit',
  })
  if (child.error) {
    dependencies.writeStderr(
      `Could not start the focused test: ${child.error.message}\n`,
    )
    return 1
  }
  return child.status ?? 1
}

function readRequiredValue(
  argv: readonly string[],
  index: number,
  option: string,
): string {
  const value = argv[index + 1]?.trim()
  if (!value) {
    throw new Error(`${option} requires a value.`)
  }
  return value
}

function buildSubscriptionRunEnv(
  sourceEnv: NodeJS.ProcessEnv,
  codexHome: string | null,
): NodeJS.ProcessEnv {
  const env = { ...sourceEnv }
  delete env.CODEX_HOME
  if (codexHome) {
    env.MURPH_REAL_CODEX_HOME = codexHome
  } else {
    delete env.MURPH_REAL_CODEX_HOME
  }
  return env
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function buildPnpmCommand(
  args: string[],
  sourceEnv: NodeJS.ProcessEnv,
): Pick<AssistantRealCodexCommandRequest, 'args' | 'command'> {
  const npmExecPath = sourceEnv.npm_execpath?.trim()
  return npmExecPath
    ? {
        args: [npmExecPath, ...args],
        command: process.execPath,
      }
    : {
        args,
        command: 'pnpm',
      }
}

function runAssistantRealCodexCommand(
  request: AssistantRealCodexCommandRequest,
): AssistantRealCodexCommandResult {
  const result = request.stdio === 'capture'
    ? spawnSync(request.command, request.args, {
        encoding: 'utf8',
        env: request.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawnSync(request.command, request.args, {
        env: request.env,
        stdio: request.stdio,
      })
  return {
    error: result.error,
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : undefined,
  }
}

function run(): void {
  let options: AssistantRealCodexRunOptions
  try {
    options = parseAssistantRealCodexRunArgs(process.argv.slice(2))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n\n${USAGE}\n`)
    process.exitCode = 2
    return
  }

  if (options.help) {
    process.stdout.write(`${USAGE}\n`)
    return
  }

  process.exitCode = executeAssistantRealCodexRun(options, {
    runCommand: runAssistantRealCodexCommand,
    sourceEnv: process.env,
    writeStderr: (message) => process.stderr.write(message),
    writeStdout: (message) => process.stdout.write(message),
  })
}

const invokedPath = process.argv[1]
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  run()
}
