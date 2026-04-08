#!/usr/bin/env node

import { formatMurphCliError } from './cli-entry.js'
import { runRunnerVaultCliEntrypoint } from './runner-vault-cli.js'

runRunnerVaultCliEntrypoint().catch((error) => {
  console.error(formatMurphCliError(error))
  process.exitCode = 1
})
