#!/usr/bin/env node

import {
  isBrokenPipeError,
  renderMurphCliEntrypointError,
  runMurphCliEntrypoint,
} from './cli-entry.js'

runMurphCliEntrypoint().catch(async (error) => {
  if (isBrokenPipeError(error)) {
    process.exitCode = 0
    return
  }

  const rendered = await renderMurphCliEntrypointError(
    error,
    process.argv.slice(2),
  )
  const stream = rendered.machineReadable ? process.stdout : process.stderr
  stream.write(`${rendered.output}\n`)
  process.exitCode = rendered.exitCode
})
