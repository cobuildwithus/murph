#!/usr/bin/env node

import cli from './index.js'
import {
  applyDefaultVaultToArgs,
  resolveDefaultVault,
  resolveOperatorHomeDirectory,
} from './operator-config.js'
import {
  createSetupCli,
  detectSetupProgramName,
  isSetupInvocation,
} from './setup-cli.js'

const argv = process.argv.slice(2)
const setupProgramName = detectSetupProgramName(process.argv[1])

if (isSetupInvocation(argv, setupProgramName)) {
  const setupCli = createSetupCli({
    commandName: setupProgramName,
  })
  setupCli.serve(argv)
} else {
  const defaultVault = await resolveDefaultVault(resolveOperatorHomeDirectory())
  cli.serve(applyDefaultVaultToArgs(argv, defaultVault))
}
