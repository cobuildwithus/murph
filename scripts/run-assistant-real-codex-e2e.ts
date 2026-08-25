import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export type AssistantRealCodexAuthMode = 'provider' | 'subscription'

export interface AssistantRealCodexRunOptions {
  authMode: AssistantRealCodexAuthMode
  help: boolean
  model: string | null
  testPattern: string | null
}

const DEFAULT_OPTIONS: AssistantRealCodexRunOptions = {
  authMode: 'subscription',
  help: false,
  model: null,
  testPattern: null,
}

const USAGE = [
  'Usage: pnpm test:assistant:live -- --test <name-pattern> [options]',
  '',
  'Options:',
  '  --auth subscription|provider  Use local ChatGPT auth (default) or provider env.',
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

  return options
}

export function buildAssistantRealCodexRunEnv(input: {
  options: AssistantRealCodexRunOptions
  sourceEnv?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  const env = { ...(input.sourceEnv ?? process.env) }
  env.MURPH_RUN_REAL_CODEX_E2E = '1'

  if (input.options.authMode === 'subscription') {
    env.MURPH_REAL_CODEX_AUTH = 'subscription'
    delete env.MURPH_REAL_CODEX_COMMAND
    delete env.MURPH_REAL_CODEX_MODEL_PROVIDER
    delete env.MURPH_REAL_CODEX_PROVIDER_ENV_KEY
  } else {
    delete env.MURPH_REAL_CODEX_AUTH
  }

  if (input.options.model) {
    env.MURPH_REAL_CODEX_MODEL = input.options.model
  }

  return env
}

export function buildAssistantRealCodexVitestArgs(
  testPattern: string,
): string[] {
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
    testPattern,
  ]
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

  if (options.authMode === 'subscription') {
    const loginStatus = spawnSync('codex', ['login', 'status'], {
      env: process.env,
      stdio: 'ignore',
    })
    if (loginStatus.status !== 0) {
      process.stderr.write(
        'Codex is not logged in with ChatGPT. Run `codex login`, then retry.\n',
      )
      process.exitCode = 1
      return
    }
  }

  const testPattern = options.testPattern
  if (!testPattern) {
    throw new Error('Test pattern was not resolved.')
  }
  const effectiveModel =
    options.model
    ?? process.env.MURPH_REAL_CODEX_MODEL?.trim()
    ?? 'gpt-5.6-terra'
  process.stdout.write(
    `Running one real Murph assistant journey with ${effectiveModel} via ${options.authMode} auth.\n`,
  )

  const pnpmArgs = buildAssistantRealCodexVitestArgs(testPattern)
  const npmExecPath = process.env.npm_execpath?.trim()
  const child = npmExecPath
    ? spawnSync(process.execPath, [npmExecPath, ...pnpmArgs], {
        env: buildAssistantRealCodexRunEnv({ options }),
        stdio: 'inherit',
      })
    : spawnSync('pnpm', pnpmArgs, {
        env: buildAssistantRealCodexRunEnv({ options }),
        stdio: 'inherit',
      })
  if (child.error) {
    process.stderr.write(
      `Could not start the focused test: ${child.error.message}\n`,
    )
    process.exitCode = 1
    return
  }
  process.exitCode = child.status ?? 1
}

const invokedPath = process.argv[1]
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  run()
}
