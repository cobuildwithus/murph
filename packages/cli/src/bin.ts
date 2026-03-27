#!/usr/bin/env node

import path from 'node:path'
import { formatStructuredErrorMessage } from './text/shared.js'

installSqliteExperimentalWarningFilter()
loadCliEnvFiles()

const cliModule = await import('./index.js')
const operatorConfigModule = await import('./operator-config.js')
const setupCliModule = await import('./setup-cli.js')
const setupRuntimeEnvModule = await import('./setup-runtime-env.js')

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

type SuccessfulSetupContext = import('./setup-cli.js').SuccessfulSetupContext

actionMain().catch((error) => {
  console.error(formatStructuredErrorMessage(error))
  process.exitCode = 1
})

async function actionMain(): Promise<void> {
  const argv = process.argv.slice(2)
  const setupProgramName = detectSetupProgramName(process.argv[1])
  const homeDirectory = resolveOperatorHomeDirectory()

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
    await setupCli.serve(argv)

    const setupContext = successfulSetup.current
    if (setupContext !== null) {
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
        process.stderr.write(
          `\nOpening ${formatSetupWearableLabel(wearable)} connect flow in your browser.\n\n`,
        )
        try {
          await cli.serve(['device', 'connect', wearable, '--vault', launchVault, '--open'])
        } catch (error) {
          process.stderr.write(
            `Could not start the ${formatSetupWearableLabel(wearable)} connect flow: ${formatErrorMessage(error)}\n`,
          )
        }
      }

      const launchAction = resolveSetupPostLaunchAction(setupContext)
      if (launchAction !== null) {
        if (launchAction === 'assistant-run') {
          process.stderr.write(
            '\nStarting Healthy Bob assistant automation. Leave this terminal open while channel auto-reply is active for iMessage, Telegram, and/or email. Press Ctrl+C to stop.\n\n',
          )
          await cli.serve(['assistant', 'run', '--vault', launchVault])
          return
        }

        process.stderr.write(
          '\nOpening Healthy Bob assistant chat. Type /exit to quit.\n\n',
        )
        await cli.serve(['assistant', 'chat', '--vault', launchVault])
      }
    }
    return
  }

  const defaultVault = await resolveDefaultVault(homeDirectory)
  await cli.serve(applyDefaultVaultToArgs(argv, defaultVault))
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return typeof error === 'string' ? error : 'unknown error'
}

function loadCliEnvFiles(cwd = process.cwd()): void {
  // Keep exported shell variables authoritative while allowing repo-local
  // `.env` files to provide defaults for local CLI setup and automation.
  for (const fileName of ['.env.local', '.env']) {
    const filePath = path.join(cwd, fileName)
    try {
      process.loadEnvFile(filePath)
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        continue
      }

      throw error
    }
  }
}

function installSqliteExperimentalWarningFilter(): void {
  const originalEmitWarning = process.emitWarning.bind(process)

  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message =
      typeof warning === 'string'
        ? warning
        : warning instanceof Error
          ? warning.message
          : ''
    const warningType =
      typeof args[0] === 'string'
        ? args[0]
        : warning instanceof Error
          ? warning.name
          : ''

    if (
      warningType === 'ExperimentalWarning' &&
      message.includes('SQLite is an experimental feature')
    ) {
      return
    }

    return originalEmitWarning(
      warning as Parameters<typeof process.emitWarning>[0],
      ...(args as Parameters<typeof process.emitWarning> extends [
        unknown,
        ...infer Rest,
      ]
        ? Rest
        : never),
    )
  }) as typeof process.emitWarning
}
