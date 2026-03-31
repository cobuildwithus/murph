#!/usr/bin/env node

import { formatMurphCliError, runMurphCliEntrypoint } from './cli-entry.js'

runMurphCliEntrypoint().catch((error) => {
  console.error(formatMurphCliError(error))
  process.exitCode = 1
})
