import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Cli } from 'incur'

import { installSqliteExperimentalWarningFilterWithOptions } from '@murphai/runtime-state/node'
import { formatStructuredErrorMessage } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export interface MurphCliRunOptions {
  argv0?: string
  exit?: ((code?: number) => void) | undefined
}

type SuccessfulSetupContext = import('@murphai/setup-cli/setup-cli').SuccessfulSetupContext
type CliServeOptions = Parameters<Cli.Cli['serve']>[1]

export async function runMurphCliEntrypoint(
  argv: string[] = process.argv.slice(2),
  options: MurphCliRunOptions = {},
): Promise<void> {
  installBrokenPipeHandler()
  installSqliteExperimentalWarningFilter()
  loadCliEnvFiles()
  await runMurphCliAction(argv, options)
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
  const vaultCliModule = await import('./vault-cli.js')
  const operatorConfigModule = await import('@murphai/operator-config/operator-config')
  const setupCliModule = await import('@murphai/setup-cli/setup-cli')
  const setupRuntimeEnvModule = await import('@murphai/operator-config/setup-runtime-env')

  const {
    applyDefaultVaultToArgs,
    commandNeedsVaultForExecution,
    expandConfiguredVaultPath,
    hasExplicitVaultOption,
    resolveConfiguredDefaultVault,
    resolveEffectiveTopLevelToken,
    resolveDefaultVault,
    resolveOperatorHomeDirectory,
  } = operatorConfigModule
  const {
    createSetupCli,
    createSetupServices,
    detectSetupProgramName,
    formatSetupWearableLabel,
    isSetupInvocation,
    listSetupPendingWearables,
    listSetupReadyWearables,
    resolveSetupPostLaunchAction,
  } = setupCliModule
  const { SETUP_RUNTIME_ENV_NOTICE } = setupRuntimeEnvModule

  const programName = detectSetupProgramName(options.argv0 ?? process.argv[1])
  const topLevelToken = resolveEffectiveTopLevelToken(argv)
  const cli = vaultCliModule.createVaultCliWithOptions({
    commandName: programName,
  })
  const homeDirectory = resolveOperatorHomeDirectory()
  const serveOptions = createCliServeOptions(options.exit)

  if (isSetupInvocation(argv, programName)) {
    const successfulSetup = {
      current: null as SuccessfulSetupContext | null,
    }
    const setupCli = createSetupCli({
      commandName: programName,
      services: createSetupServices({
        resolveCliBinPath: resolvePublishedCliBinPath,
      }),
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
      (programName === 'murph' && topLevelToken !== 'init'
        ? await resolveConfiguredDefaultVault(homeDirectory)
        : await resolveDefaultVault(homeDirectory)) ??
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
        '\nStarting Murph assistant automation. Leave this terminal open while channel auto-reply is active for Telegram, Linq, and/or email. Press Ctrl+C to stop.\n\n',
      )
      await cli.serve(['assistant', 'run', '--vault', launchVault], serveOptions)
      return
    }

    process.stderr.write('\nOpening Murph assistant chat. Type /exit to quit.\n\n')
    await cli.serve(['assistant', 'chat', '--vault', launchVault], serveOptions)
    return
  }

  const defaultVault =
    programName === 'murph' && topLevelToken !== 'init'
      ? await resolveConfiguredDefaultVault(homeDirectory)
      : await resolveDefaultVault(homeDirectory)
  await cli.serve(
    await prepareProgramArgsForExecution({
      applyDefaultVaultToArgs,
      argv,
      commandNeedsVaultForExecution,
      configFiles: vaultCliModule.CLI_CONFIG_FILES,
      defaultVault,
      hasExplicitVaultOption,
      homeDirectory,
      programName,
      resolveEffectiveTopLevelToken: () => topLevelToken,
    }),
    serveOptions,
  )
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

function resolvePublishedCliBinPath(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  const moduleBaseName = path.basename(moduleDirectory)

  return moduleBaseName === 'src'
    ? path.resolve(moduleDirectory, '../dist/bin.js')
    : path.resolve(moduleDirectory, 'bin.js')
}

async function prepareProgramArgsForExecution(input: {
  applyDefaultVaultToArgs: (args: readonly string[], vault: string | null) => string[]
  argv: string[]
  commandNeedsVaultForExecution: (args: readonly string[]) => boolean
  configFiles: readonly string[]
  defaultVault: string | null
  hasExplicitVaultOption: (args: readonly string[]) => boolean
  homeDirectory: string
  programName: string
  resolveEffectiveTopLevelToken: (args: readonly string[]) => string | null
}): Promise<string[]> {
  const explicitVaultRequested = input.hasExplicitVaultOption(input.argv)
  const commandNeedsVault = input.commandNeedsVaultForExecution(input.argv)
  const commandAllowsExplicitVaultOverride =
    input.programName === 'murph' &&
    input.resolveEffectiveTopLevelToken(input.argv) === 'init'

  if (
    input.programName === 'murph' &&
    explicitVaultRequested &&
    commandNeedsVault &&
    !commandAllowsExplicitVaultOverride
  ) {
    throw new VaultCliError(
      'invalid_option',
      '`murph` uses one active vault. Omit `--vault` and use `murph use <path>` or `murph onboard --vault <path>` to change it.',
    )
  }

  if (
    input.programName === 'murph' &&
    input.defaultVault === null &&
    commandNeedsVault &&
    !commandAllowsExplicitVaultOverride
  ) {
    throw new VaultCliError(
      'missing_vault',
      'No active Murph vault is configured. Run `murph onboard --vault ./vault` to create one, or `murph use <path>` to select an existing vault.',
    )
  }

  if (
    input.programName !== 'murph' &&
    input.defaultVault === null &&
    !explicitVaultRequested &&
    commandNeedsVault &&
    !(await hasEnabledIncurConfigFile(input.argv, input.configFiles, input.homeDirectory))
  ) {
    throw new VaultCliError(
      'missing_vault',
      'No vault was provided. Pass --vault <path> or select a default vault before running this command.',
    )
  }

  return input.applyDefaultVaultToArgs(input.argv, input.defaultVault)
}

async function hasEnabledIncurConfigFile(
  argv: readonly string[],
  configFiles: readonly string[],
  homeDirectory: string,
): Promise<boolean> {
  const configFlagState = readConfigFlagState(argv)
  if (configFlagState.disabled) {
    return false
  }

  if (configFlagState.explicit) {
    return true
  }

  for (const filePath of configFiles) {
    if (await pathIsReadable(resolveIncurConfigPath(filePath, homeDirectory))) {
      return true
    }
  }

  return false
}

function readConfigFlagState(argv: readonly string[]): {
  disabled: boolean
  explicit: boolean
} {
  let disabled = false
  let explicit = false

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--config') {
      disabled = false
      explicit = true
      index += 1
      continue
    }
    if (token?.startsWith('--config=')) {
      disabled = false
      explicit = true
      continue
    }
    if (token === '--no-config') {
      disabled = true
      explicit = false
    }
  }

  return {
    disabled,
    explicit,
  }
}

function resolveIncurConfigPath(configPath: string, homeDirectory: string): string {
  if (configPath === '~') {
    return homeDirectory
  }

  if (configPath.startsWith('~/')) {
    return path.join(homeDirectory, configPath.slice(2))
  }

  return path.resolve(process.cwd(), configPath)
}

async function pathIsReadable(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT') || isNodeErrorWithCode(error, 'ENOTDIR')) {
      return false
    }

    throw error
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
  installSqliteExperimentalWarningFilterWithOptions({
    matchMode: 'includes',
  })
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}
