import path from 'node:path'
import type { Cli } from 'incur'

import { formatStructuredErrorMessage } from '@murphai/operator-config/text/shared'

export interface MurphCliRunOptions {
  argv0?: string
  exit?: ((code?: number) => void) | undefined
}

type SuccessfulSetupContext = import('@murphai/setup-cli/setup-cli').SuccessfulSetupContext
type CliServeOptions = Parameters<Cli.Cli['serve']>[1]
type ProcessEmitWarningRestArgs = Parameters<typeof process.emitWarning> extends [
  unknown,
  ...infer Rest,
]
  ? Rest
  : never

const SQLITE_EXPERIMENTAL_WARNING_MESSAGE = 'SQLite is an experimental feature'

let sqliteExperimentalWarningFilterInstalled = false

export async function runMurphCliEntrypoint(
  argv: string[] = process.argv.slice(2),
  options: MurphCliRunOptions = {},
): Promise<void> {
  installSqliteExperimentalWarningFilter()
  loadCliEnvFiles()
  await runMurphCliAction(argv, options)
}

export async function runMurphCliAction(
  argv: string[],
  options: MurphCliRunOptions = {},
): Promise<void> {
  const cliModule = await import('./index.js')
  const operatorConfigModule = await import('@murphai/operator-config/operator-config')
  const setupCliModule = await import('@murphai/setup-cli/setup-cli')
  const setupRuntimeEnvModule = await import('@murphai/operator-config/setup-runtime-env')

  const cli = cliModule.default
  const {
    applyDefaultVaultToArgs,
    expandConfiguredVaultPath,
    resolveDefaultVault,
    resolveOperatorHomeDirectory,
  } = operatorConfigModule
  const {
    createSetupCli,
    detectSetupProgramName,
    formatSetupWearableLabel,
    isSetupInvocation,
    listSetupPendingWearables,
    listSetupReadyWearables,
    resolveSetupPostLaunchAction,
  } = setupCliModule
  const { SETUP_RUNTIME_ENV_NOTICE } = setupRuntimeEnvModule

  const setupProgramName = detectSetupProgramName(options.argv0 ?? process.argv[1])
  const homeDirectory = resolveOperatorHomeDirectory()
  const serveOptions = createCliServeOptions(options.exit)

  if (isSetupInvocation(argv, setupProgramName)) {
    const successfulSetup = {
      current: null as SuccessfulSetupContext | null,
    }
    const setupCli = createSetupCli({
      commandName: setupProgramName,
      onSetupSuccess(context) {
        successfulSetup.current = context
      },
    })
    await setupCli.serve(argv, serveOptions)

    const setupContext = successfulSetup.current
    if (setupContext === null) {
      return
    }

    const launchVault =
      (await resolveDefaultVault(homeDirectory)) ??
      expandConfiguredVaultPath(setupContext.result.vault, homeDirectory)

    const readyWearables = listSetupReadyWearables(setupContext.result)
    const pendingWearables = listSetupPendingWearables(setupContext.result)

    if (pendingWearables.length > 0) {
      const pendingSummary = pendingWearables
        .map(
          (wearable) =>
            `${formatSetupWearableLabel(wearable.wearable)} (${wearable.missingEnv.join(', ')})`,
        )
        .join(', ')
      process.stderr.write(
        `\nSelected wearable setup is waiting on credentials: ${pendingSummary}. ${SETUP_RUNTIME_ENV_NOTICE}\n`,
      )
    }

    for (const wearable of readyWearables) {
      const wearableLabel = formatSetupWearableLabel(wearable)
      process.stderr.write(
        `\nOpening ${wearableLabel} connect flow in your browser.\n\n`,
      )
      try {
        await cli.serve(
          ['device', 'connect', wearable, '--vault', launchVault, '--open'],
          serveOptions,
        )
      } catch (error) {
        process.stderr.write(
          `Could not start the ${wearableLabel} connect flow: ${formatErrorMessage(error)}\n`,
        )
      }
    }

    const launchAction = resolveSetupPostLaunchAction(setupContext)
    if (launchAction === null) {
      return
    }

    if (launchAction === 'assistant-run') {
      process.stderr.write(
        '\nStarting Murph assistant automation. Leave this terminal open while channel auto-reply is active for iMessage, Telegram, and/or email. Press Ctrl+C to stop.\n\n',
      )
      await cli.serve(['assistant', 'run', '--vault', launchVault], serveOptions)
      return
    }

    process.stderr.write('\nOpening Murph assistant chat. Type /exit to quit.\n\n')
    await cli.serve(['assistant', 'chat', '--vault', launchVault], serveOptions)
    return
  }

  const defaultVault = await resolveDefaultVault(homeDirectory)
  await cli.serve(applyDefaultVaultToArgs(argv, defaultVault), serveOptions)
}

export function formatMurphCliError(error: unknown): string {
  return formatStructuredErrorMessage(error)
}

export function createCliServeOptions(
  exit: ((code?: number) => void) | undefined,
): CliServeOptions {
  return {
    env: process.env,
    ...(exit ? { exit: (code: number) => exit(code) } : {}),
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return typeof error === 'string' ? error : 'unknown error'
}

export function loadCliEnvFiles(cwd = process.cwd()): void {
  // Keep exported shell variables authoritative while allowing repo-local
  // `.env` files to provide defaults for local CLI setup and automation.
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
  if (sqliteExperimentalWarningFilterInstalled) {
    return
  }

  sqliteExperimentalWarningFilterInstalled = true
  const originalEmitWarning = process.emitWarning.bind(process)

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (isSqliteExperimentalWarning(warning, args)) {
      return
    }

    return originalEmitWarning(
      warning as Parameters<typeof process.emitWarning>[0],
      ...(args as ProcessEmitWarningRestArgs),
    )
  }) as typeof process.emitWarning
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function isSqliteExperimentalWarning(
  warning: string | Error,
  args: readonly unknown[],
): boolean {
  return (
    resolveWarningType(warning, args) === 'ExperimentalWarning' &&
    resolveWarningMessage(warning).includes(SQLITE_EXPERIMENTAL_WARNING_MESSAGE)
  )
}

function resolveWarningMessage(warning: string | Error): string {
  return typeof warning === 'string' ? warning : warning.message
}

function resolveWarningType(
  warning: string | Error,
  args: readonly unknown[],
): string {
  if (typeof args[0] === 'string') {
    return args[0]
  }

  return warning instanceof Error ? warning.name : ''
}
