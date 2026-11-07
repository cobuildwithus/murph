import path from 'node:path'
import type { Cli, Formatter } from 'incur'

import { installSqliteExperimentalWarningFilterWithOptions } from '@murphai/runtime-state/node/sqlite-warning-filter'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { VaultCliErrorProjection } from '@murphai/operator-config/vault-cli-error-projection'
import { getVaultCliPackageVersion } from './vault-cli-package.js'
import { VAULT_CLI_SKILL_HASH } from './vault-cli-skill-hash.generated.js'
import {
  hasEffectiveMcpFlag,
  planVaultCliInvocation,
  type CliInvocationPlan,
} from './vault-cli-routing.js'

export interface MurphCliRunOptions {
  exit?: ((code?: number) => void) | undefined
  stdout?: ((s: string) => void) | undefined
}

type CliServeOptions = Parameters<Cli.Cli['serve']>[1]
type VaultCliVaultContext = import('./vault-cli-vault-context.js').VaultCliVaultContext
type ExecutableCliInvocationPlan =
  | Extract<CliInvocationPlan, { kind: 'scoped' }>
  | Extract<CliInvocationPlan, { kind: 'full' }>

export async function runMurphCliEntrypoint(
  argv: string[] = process.argv.slice(2),
  options: MurphCliRunOptions = {},
): Promise<void> {
  // Keep the timing wire/catalog out of the runner's static startup closure.
  // Native import caching shares the same ALS owner with middleware and queries.
  const { finishCliTimingAction, startCliPhase, withCliTiming } = await import(
    '@murphai/runtime-state/node/cli-timing'
  )
  return withCliTiming(async () => {
    installBrokenPipeHandler()
    installSqliteExperimentalWarningFilter()
    loadCliEnvFiles()
    let actionCompleted = false
    try {
      await runMurphCliActionInternal(argv, options)
      actionCompleted = true
    } finally {
      finishCliTimingAction()
      const endTeardown = startCliPhase('teardown')
      try {
        await stopWarmCodexAppServerForCliExit()
      } catch (error) {
        if (actionCompleted) {
          throw error
        }
      } finally {
        endTeardown()
      }
    }
  })
}

let brokenPipeHandlerInstalled = false

export function installBrokenPipeHandler(): void {
  if (brokenPipeHandlerInstalled) {
    return
  }

  brokenPipeHandlerInstalled = true

  const handleStreamError = (
    stream: 'stderr' | 'stdout',
    error: Error & { code?: string },
  ) => {
    if (isBrokenPipeError(error)) {
      process.exitCode = resolveBrokenPipeExitCode(stream, process.exitCode)
      return
    }

    throw error
  }

  process.stdout.on('error', (error) => handleStreamError('stdout', error))
  process.stderr.on('error', (error) => handleStreamError('stderr', error))
}

export function isBrokenPipeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EPIPE'
  )
}

export function resolveBrokenPipeExitCode(
  stream: 'stderr' | 'stdout',
  currentExitCode: NodeJS.Process['exitCode'],
): NodeJS.Process['exitCode'] {
  if (stream === 'stdout' || currentExitCode === undefined || currentExitCode === 0) {
    return 0
  }

  return currentExitCode
}

export async function runMurphCliAction(
  argv: string[],
  options: MurphCliRunOptions = {},
): Promise<void> {
  const { finishCliTimingAction, withCliTiming } = await import(
    '@murphai/runtime-state/node/cli-timing'
  )
  return withCliTiming(async () => {
    try {
      await runMurphCliActionInternal(argv, options)
    } finally {
      finishCliTimingAction()
    }
  })
}

async function runMurphCliActionInternal(
  argv: string[],
  options: MurphCliRunOptions,
): Promise<void> {
  const plannedInvocation = planVaultCliInvocation(argv, {
    env: process.env,
  })
  const serveOptions = await createCliServeOptions(options.exit, options.stdout)

  if (plannedInvocation.plan.kind === 'version') {
    const stdout = options.stdout ?? ((output: string) => process.stdout.write(output))
    stdout(`${getVaultCliPackageVersion()}\n`)
    return
  }

  const { resolveDefaultVault, resolveOperatorHomeDirectory } = await import(
    '@murphai/operator-config/operator-config'
  )
  const { vaultOverride } = plannedInvocation
  const defaultVault = vaultOverride.vault ?? await resolveDefaultVault(resolveOperatorHomeDirectory())
  const { createVaultCliVaultContext } = await import('./vault-cli-vault-context.js')
  await servePlannedVaultCliInvocation({
    argv: vaultOverride.argv,
    plan: plannedInvocation.plan,
    serveOptions,
    vaultContext: createVaultCliVaultContext(defaultVault),
  })
}

async function servePlannedVaultCliInvocation(input: {
  argv: string[]
  plan: ExecutableCliInvocationPlan
  serveOptions: CliServeOptions
  vaultContext: VaultCliVaultContext
}): Promise<void> {
  if (input.plan.kind === 'scoped') {
    const [
      { createVaultCliShell },
      { registerScopedVaultCliCommand },
      { installVaultCliLlmsNormalizer },
      { installVaultCliSchemaIndex },
      { installVaultCliVaultContext },
    ] = await Promise.all([
      import('./vault-cli-shell.js'),
      import('./vault-cli-command-routing.js'),
      import('./vault-cli-llms-normalizer.js'),
      import('./vault-cli-schema-index.js'),
      import('./vault-cli-vault-context.js'),
    ])
    const cli = createVaultCliShell('vault-cli', {
      expectedSkillHash: VAULT_CLI_SKILL_HASH,
    })

    await registerScopedVaultCliCommand({
      cli,
      root: input.plan.root,
    })
    installVaultCliSchemaIndex(cli)
    installVaultCliLlmsNormalizer(cli, 'vault-cli')
    installVaultCliVaultContext(cli, input.vaultContext)
    await cli.serve(input.argv, input.serveOptions)
    return
  }

  const { createVaultCliWithOptions } = await import('./vault-cli.js')
  const cli = createVaultCliWithOptions({
    commandName: 'vault-cli',
    ...(hasEffectiveMcpFlag(input.argv)
      ? { excludeCommandDescriptorIds: new Set(['batch']) }
      : {}),
    vaultContext: input.vaultContext,
  })
  await cli.serve(input.argv, input.serveOptions)
}

export interface RenderedMurphCliError {
  exitCode: number
  machineReadable: boolean
  output: string
}

export async function renderMurphCliEntrypointError(
  error: unknown,
  argv: readonly string[],
  options: { human?: boolean | undefined } = {},
): Promise<RenderedMurphCliError> {
  const { projectVaultCliError } = await import(
    './vault-cli-error-projection.js'
  )
  const projected = projectVaultCliError(error)
  const explicitFormat = findExplicitOutputFormat(argv)
  const human = options.human ?? process.stdout.isTTY === true

  if (explicitFormat === null && human) {
    return {
      exitCode: projected.exitCode ?? 1,
      machineReadable: false,
      output: formatProjectedCliErrorForHuman(projected),
    }
  }

  const format = explicitFormat ?? 'toon'
  const { Formatter: runtimeFormatter } = await import('incur')
  const errorBody = {
    code: projected.code,
    message: projected.message,
    retryable: projected.retryable,
    ...(projected.fieldErrors ? { fieldErrors: projected.fieldErrors } : {}),
    ...(projected.hint ? { hint: projected.hint } : {}),
    ...(projected.stage ? { stage: projected.stage } : {}),
  }
  const outputBody = argv.includes('--full-output')
    ? {
        ok: false,
        error: errorBody,
        meta: {
          command: 'invocation',
          duration: '0ms',
        },
      }
    : errorBody
  const output = runtimeFormatter.format(
    outputBody,
    format,
  )

  return {
    exitCode: projected.exitCode ?? 1,
    machineReadable: true,
    output,
  }
}

function formatProjectedCliErrorForHuman(
  error: VaultCliErrorProjection,
): string {
  const prefix = error.code === 'UNKNOWN' ? 'Error' : `Error (${error.code})`
  const lines = [`${prefix}: ${error.message}`]

  if (error.stage) {
    lines.push(`Stage: ${error.stage}`)
  }
  if (error.fieldErrors) {
    lines.push(
      ...error.fieldErrors.map(
        (fieldError) => `  ${fieldError.path}: ${fieldError.message}`,
      ),
    )
  }
  if (error.hint) {
    lines.push(`Hint: ${error.hint}`)
  }

  return lines.join('\n')
}

function findExplicitOutputFormat(
  argv: readonly string[],
): Formatter.Format | null {
  let format: Formatter.Format | null = null
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--json') {
      format = 'json'
      continue
    }
    if (token === '--format') {
      format = parseOutputFormat(argv[index + 1]) ?? format
      index += 1
      continue
    }
    if (token?.startsWith('--format=')) {
      format = parseOutputFormat(token.slice('--format='.length)) ?? format
    }
  }

  return format
}

function parseOutputFormat(value: string | undefined): Formatter.Format | null {
  switch (value) {
    case 'json':
    case 'jsonl':
    case 'md':
    case 'toon':
    case 'yaml':
      return value
    default:
      return null
  }
}

export async function createCliServeOptions(
  exit: ((code?: number) => void) | undefined,
  stdout?: ((s: string) => void) | undefined,
): Promise<CliServeOptions> {
  const { isCliTimingActive, noteCliTimingExit } = await import(
    '@murphai/runtime-state/node/cli-timing'
  )
  return {
    env: process.env,
    ...(isCliTimingActive()
      ? { exit: (code: number) => {
          noteCliTimingExit(code, exit === undefined)
          if (exit) exit(code)
          else process.exit(code)
        } }
      : exit ? { exit: (code: number) => exit(code) } : {}),
    ...(stdout ? { stdout } : {}),
  }
}

async function stopWarmCodexAppServerForCliExit(): Promise<void> {
  const { stopWarmCodexAppServer } = await import('@murphai/assistant-engine/codex-lifecycle')
  try {
    await stopWarmCodexAppServer('cli-entrypoint-exit')
  } catch (error) {
    if (
      error instanceof VaultCliError &&
      error.code === 'ASSISTANT_CODEX_APP_SERVER_BUSY'
    ) {
      return
    }
    throw error
  }
}

export function loadCliEnvFiles(cwd = process.cwd()): void {
  // Keep exported shell variables authoritative while allowing repo-local
  // `.env` files to provide defaults for operator commands.
  for (const fileName of ['.env.local', '.env']) {
    const filePath = path.join(cwd, fileName)
    try {
      process.loadEnvFile(filePath)
    } catch (error) {
      if (isNodeErrorWithCode(error, 'ENOENT')) {
        continue
      }

      throw error
    }
  }
}

export function installSqliteExperimentalWarningFilter(): void {
  installSqliteExperimentalWarningFilterWithOptions({
    matchMode: 'includes',
  })
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
