#!/usr/bin/env node

import { Errors } from 'incur'

installSqliteExperimentalWarningFilter()

const cliModule = await import('./index.js')
const operatorConfigModule = await import('./operator-config.js')
const setupCliModule = await import('./setup-cli.js')

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
  isSetupInvocation,
  resolveSetupPostLaunchAction,
} = setupCliModule

type SuccessfulSetupContext = import('./setup-cli.js').SuccessfulSetupContext

actionMain().catch((error) => {
  if (error instanceof Errors.IncurError) {
    console.error(error.message)
  } else {
    console.error(error)
  }
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
      const launchAction = resolveSetupPostLaunchAction(setupContext)
      if (launchAction !== null) {
        const launchVault =
          (await resolveDefaultVault(homeDirectory)) ??
          expandConfiguredVaultPath(setupContext.result.vault, homeDirectory)

        if (launchAction === 'assistant-run') {
          process.stderr.write(
            '\nStarting Healthy Bob assistant automation. Leave this terminal open while iMessage auto-reply is active. Press Ctrl+C to stop.\n\n',
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
  cli.serve(applyDefaultVaultToArgs(argv, defaultVault))
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
