#!/usr/bin/env node

import cli from './index.js'
import {
  createSetupCli,
  detectSetupProgramName,
  isSetupInvocation,
} from './setup-cli.js'

const argv = process.argv.slice(2)

if (isSetupInvocation(argv)) {
  const setupCli = createSetupCli({
    commandName: detectSetupProgramName(process.argv[1]),
  })
  setupCli.serve(argv)
} else {
  cli.serve(argv)
}
