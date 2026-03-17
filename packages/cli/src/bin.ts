#!/usr/bin/env node

import cli from './index.js'
import {
  applyDefaultVaultToArgs,
  expandConfiguredVaultPath,
  resolveDefaultVault,
  resolveOperatorHomeDirectory,
} from './operator-config.js'
import {
  createSetupCli,
  detectSetupProgramName,
  isSetupInvocation,
  shouldAutoLaunchAssistantAfterSetup,
  type SuccessfulSetupContext,
} from './setup-cli.js'

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
  if (setupContext !== null && shouldAutoLaunchAssistantAfterSetup(setupContext)) {
    const launchVault =
      (await resolveDefaultVault(homeDirectory)) ??
      expandConfiguredVaultPath(setupContext.result.vault, homeDirectory)

    process.stderr.write('\nOpening Healthy Bob assistant chat. Type /exit to quit.\n\n')
    await cli.serve(['assistant', 'chat', '--vault', launchVault])
  }
} else {
  const defaultVault = await resolveDefaultVault(homeDirectory)
  cli.serve(applyDefaultVaultToArgs(argv, defaultVault))
}
