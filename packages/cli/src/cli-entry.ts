import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Cli } from 'incur'

import { installSqliteExperimentalWarningFilterWithOptions } from '@murphai/runtime-state/node/sqlite-warning-filter'
import { formatStructuredErrorMessage } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { getVaultCliPackageVersion } from './vault-cli-package.js'
import { VAULT_CLI_SKILL_HASH } from './vault-cli-skill-hash.generated.js'
import {
  detectCliProgramName,
  hasEffectiveMcpFlag,
  planVaultCliInvocation,
  type CliInvocationPlan,
  type VaultCliProgramName,
} from './vault-cli-routing.js'

export interface MurphCliRunOptions {
  argv0?: string
  exit?: ((code?: number) => void) | undefined
  stdout?: ((s: string) => void) | undefined
}

type SuccessfulSetupContext = import('@murphai/setup-cli/setup-cli').SuccessfulSetupContext
type CliServeOptions = Parameters<Cli.Cli['serve']>[1]
type VaultCliVaultContext = import('./vault-cli-vault-context.js').VaultCliVaultContext
type ExecutableCliInvocationPlan =
  | Extract<CliInvocationPlan, { kind: 'scoped' }>
  | Extract<CliInvocationPlan, { kind: 'full' }>

export async function runMurphCliEntrypoint(
  argv: string[] = process.argv.slice(2),
  options: MurphCliRunOptions = {},
): Promise<void> {
  installBrokenPipeHandler()
  installSqliteExperimentalWarningFilter()
  loadCliEnvFiles()
  try {
    await runMurphCliAction(argv, options)
  } finally {
    await stopWarmCodexAppServerForCliExit()
  }
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
  const programName = detectCliProgramName(options.argv0 ?? process.argv[1])
  const plannedInvocation = planVaultCliInvocation(argv, {
    env: process.env,
    programName,
  })
  const serveOptions = createCliServeOptions(options.exit, options.stdout)

  if (plannedInvocation.plan.kind === 'version') {
    const stdout = options.stdout ?? ((output: string) => process.stdout.write(output))
    stdout(`${getVaultCliPackageVersion()}\n`)
    return
  }

  if (plannedInvocation.plan.kind === 'setup') {
    await runSetupInvocation({
      argv,
      programName,
      serveOptions,
    })
    return
  }

  const operatorConfigModule = await import('@murphai/operator-config/operator-config')
  const {
    resolveConfiguredDefaultVault,
    resolveEffectiveTopLevelToken,
    resolveDefaultVault,
    resolveOperatorHomeDirectory,
  } = operatorConfigModule

  const homeDirectory = resolveOperatorHomeDirectory()
  const { vaultOverride } = plannedInvocation
  const topLevelToken = resolveEffectiveTopLevelToken(vaultOverride.argv)
  if (programName === 'murph' && topLevelToken === 'batch') {
    throw new VaultCliError(
      'invalid_option',
      '`batch` is only available through `vault-cli` because child commands may name explicit vaults.',
    )
  }

  const commandAllowsExplicitVaultOverride =
    programName === 'murph' && topLevelToken === 'init'

  if (
    programName === 'murph' &&
    vaultOverride.explicit &&
    !commandAllowsExplicitVaultOverride
  ) {
    throw new VaultCliError(
      'invalid_option',
      '`murph` uses one active vault. Omit `--vault` and use `murph use <path>` or `murph onboard --vault <path>` to change it.',
    )
  }

  const defaultVault =
    vaultOverride.vault ??
    (programName === 'murph' && topLevelToken !== 'init'
      ? await resolveConfiguredDefaultVault(homeDirectory)
      : await resolveDefaultVault(homeDirectory))
  const { createVaultCliVaultContext } = await import('./vault-cli-vault-context.js')
  const vaultContext = createVaultCliVaultContext(defaultVault)
  vaultContext.missingVaultMessage =
    programName === 'murph' && topLevelToken !== 'init'
      ? 'No active Murph vault is configured. Run `murph onboard --vault ./vault` to create one, or `murph use <path>` to select an existing vault.'
      : null
  await servePlannedVaultCliInvocation({
    argv: vaultOverride.argv,
    plan: executablePlanOrFullFallback(plannedInvocation.plan),
    programName,
    serveOptions,
    vaultContext,
  })
}

async function runSetupInvocation(input: {
  argv: string[]
  programName: VaultCliProgramName
  serveOptions: CliServeOptions
}): Promise<void> {
  const operatorConfigModule = await import('@murphai/operator-config/operator-config')
  const setupCliModule = await import('@murphai/setup-cli/setup-cli')
  const setupRuntimeEnvModule = await import('@murphai/operator-config/setup-runtime-env')
  const { createVaultCliVaultContext } = await import('./vault-cli-vault-context.js')

  const {
    expandConfiguredVaultPath,
    resolveConfiguredDefaultVault,
    resolveDefaultVault,
    resolveEffectiveTopLevelToken,
    resolveOperatorHomeDirectory,
  } = operatorConfigModule
  const {
    createSetupCli,
    createSetupServices,
    formatSetupWearableLabel,
    listSetupPendingWearables,
    listSetupReadyWearables,
    resolveSetupPostLaunchAction,
  } = setupCliModule
  const { SETUP_RUNTIME_ENV_NOTICE } = setupRuntimeEnvModule

  const setupTopLevelToken = resolveEffectiveTopLevelToken(input.argv)
  const successfulSetup = {
    current: null as SuccessfulSetupContext | null,
  }
  const setupCli = createSetupCli({
    commandName: input.programName,
    services: createSetupServices({
      resolveCliBinPath: resolvePublishedCliBinPath,
    }),
    onSetupSuccess(context) {
      successfulSetup.current = context
    },
  })
  await setupCli.serve(input.argv, input.serveOptions)

  const setupContext = successfulSetup.current
  if (setupContext === null) {
    return
  }

  const homeDirectory = resolveOperatorHomeDirectory()
  const launchVault =
    (input.programName === 'murph' && setupTopLevelToken !== 'init'
      ? await resolveConfiguredDefaultVault(homeDirectory)
      : await resolveDefaultVault(homeDirectory)) ??
    expandConfiguredVaultPath(setupContext.result.vault, homeDirectory)
  const vaultContext = createVaultCliVaultContext(launchVault)

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
      await serveVaultCliWithExistingContext({
        argv: ['device', 'connect', wearable, '--open'],
        programName: input.programName,
        serveOptions: input.serveOptions,
        vaultContext,
      })
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
    await serveVaultCliWithExistingContext({
      argv: ['assistant', 'run'],
      programName: input.programName,
      serveOptions: input.serveOptions,
      vaultContext,
    })
    return
  }

  process.stderr.write('\nOpening Murph assistant chat. Type /exit to quit.\n\n')
  await serveVaultCliWithExistingContext({
    argv: ['assistant', 'chat'],
    programName: input.programName,
    serveOptions: input.serveOptions,
    vaultContext,
  })
}

async function serveVaultCliWithExistingContext(input: {
  argv: string[]
  programName: VaultCliProgramName
  serveOptions: CliServeOptions
  vaultContext: VaultCliVaultContext
}): Promise<void> {
  const plannedInvocation = planVaultCliInvocation(input.argv, {
    env: process.env,
    programName: input.programName,
  })
  const plan = executablePlanOrFullFallback(plannedInvocation.plan)

  await servePlannedVaultCliInvocation({
    argv: plannedInvocation.vaultOverride.argv,
    plan,
    programName: input.programName,
    serveOptions: input.serveOptions,
    vaultContext: input.vaultContext,
  })
}

function executablePlanOrFullFallback(
  plan: CliInvocationPlan,
): ExecutableCliInvocationPlan {
  return plan.kind === 'scoped' || plan.kind === 'full'
    ? plan
    : {
        kind: 'full',
        reason: 'setup-follow-on',
      }
}

async function servePlannedVaultCliInvocation(input: {
  argv: string[]
  plan: ExecutableCliInvocationPlan
  programName: VaultCliProgramName
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
    const cli = createVaultCliShell(input.programName, {
      expectedSkillHash: VAULT_CLI_SKILL_HASH,
    })

    await registerScopedVaultCliCommand({
      cli,
      root: input.plan.root,
    })
    installVaultCliSchemaIndex(cli)
    installVaultCliLlmsNormalizer(cli, input.programName)
    installVaultCliVaultContext(cli, input.vaultContext)
    await cli.serve(input.argv, input.serveOptions)
    return
  }

  const { createVaultCliWithOptions } = await import('./vault-cli.js')
  const cli = createVaultCliWithOptions({
    commandName: input.programName,
    ...(hasEffectiveMcpFlag(input.argv)
      ? { excludeCommandDescriptorIds: new Set(['batch']) }
      : {}),
    vaultContext: input.vaultContext,
  })
  await cli.serve(input.argv, input.serveOptions)
}

export function formatMurphCliError(error: unknown): string {
  return formatStructuredErrorMessage(error)
}

export function createCliServeOptions(
  exit: ((code?: number) => void) | undefined,
  stdout?: ((s: string) => void) | undefined,
): CliServeOptions {
  return {
    env: process.env,
    ...(exit ? { exit: (code: number) => exit(code) } : {}),
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

function resolvePublishedCliBinPath(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  const moduleBaseName = path.basename(moduleDirectory)

  return moduleBaseName === 'src'
    ? path.resolve(moduleDirectory, '../dist/bin.js')
    : path.resolve(moduleDirectory, 'bin.js')
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
