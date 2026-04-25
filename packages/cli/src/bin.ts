#!/usr/bin/env node

import {
  formatMurphCliError,
  isBrokenPipeError,
  runMurphCliEntrypoint,
} from './cli-entry.js'

runMurphCliEntrypoint().catch((error) => {
  if (isBrokenPipeError(error)) {
    process.exitCode = 0
    return
  }

  console.error(formatMurphCliError(error))
  process.exitCode = 1
})
