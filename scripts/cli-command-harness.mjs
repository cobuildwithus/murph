#!/usr/bin/env node

import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const cliBinPath = fileURLToPath(new URL('../packages/cli/dist/bin.js', import.meta.url))
const { runMurphCliEntrypoint } = await import(
  new URL('../packages/cli/dist/cli-entry.js', import.meta.url)
)

process.chdir(repoRoot)

const baselineCwd = process.cwd()
const baselineEnv = { ...process.env }
let queue = Promise.resolve()

const rl = createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})

rl.on('line', (line) => {
  if (line.trim().length === 0) {
    return
  }

  let request

  try {
    request = JSON.parse(line)
  } catch (error) {
    writeResponse((message) => process.stdout.write(message), {
      id: -1,
      ok: false,
      stdout: '',
      stderr: '',
      errorMessage: `Persistent CLI harness received invalid JSON: ${formatHarnessError(error)}`,
    })
    return
  }

  queue = queue
    .then(() => handleRequest(request))
    .catch((error) => {
      writeResponse((message) => process.stdout.write(message), {
        id: typeof request?.id === 'number' ? request.id : -1,
        ok: false,
        stdout: '',
        stderr: '',
        errorMessage: formatHarnessError(error),
      })
    })
})

rl.on('close', () => {
  queue.finally(() => {
    process.exit(0)
  })
})

async function handleRequest(request) {
  const stdout = []
  const stderr = []
  const io = interceptProcessIo({ stderr, stdout })
  let exitCode
  let response

  try {
    replaceProcessEnv(request.env ?? {})
    await runMurphCliEntrypoint(Array.isArray(request.args) ? request.args : [], {
      argv0: cliBinPath,
      exit: (code = 0) => {
        exitCode ??= code
      },
    })
    response =
      exitCode === undefined || exitCode === 0
        ? {
            id: request.id,
            ok: true,
            stdout: stdout.join(''),
            stderr: stderr.join(''),
          }
        : {
            id: request.id,
            ok: false,
            stdout: stdout.join(''),
            stderr: stderr.join(''),
            errorMessage: `CLI exited with code ${exitCode}.`,
          }
  } catch (error) {
    response = {
      id: request.id,
      ok: false,
      stdout: stdout.join(''),
      stderr: stderr.join(''),
      errorMessage: formatHarnessError(error),
    }
  } finally {
    io.restore()

    if (process.cwd() !== baselineCwd) {
      process.chdir(baselineCwd)
    }

    process.exitCode = undefined
    replaceProcessEnv(baselineEnv)
  }

  writeResponse(io.writeToParent, response)
}

function interceptProcessIo({ stdout, stderr }) {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout)
  const originalStderrWrite = process.stderr.write.bind(process.stderr)

  process.stdout.write = createWriteInterceptor(stdout)
  process.stderr.write = createWriteInterceptor(stderr)

  return {
    restore() {
      process.stdout.write = originalStdoutWrite
      process.stderr.write = originalStderrWrite
    },
    writeToParent(message) {
      originalStdoutWrite(message)
    },
  }
}

function createWriteInterceptor(chunks) {
  return ((chunk, encoding, callback) => {
    const resolvedEncoding = typeof encoding === 'string' ? encoding : 'utf8'
    chunks.push(
      typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(resolvedEncoding),
    )

    if (typeof encoding === 'function') {
      encoding()
    }

    if (typeof callback === 'function') {
      callback()
    }

    return true
  })
}

function replaceProcessEnv(nextEnv) {
  for (const key of Object.keys(process.env)) {
    if (!(key in nextEnv)) {
      delete process.env[key]
    }
  }

  for (const [key, value] of Object.entries(nextEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function writeResponse(writeToParent, response) {
  writeToParent(`${JSON.stringify(response)}\n`)
}

function formatHarnessError(error) {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }

  return typeof error === 'string' ? error : String(error)
}
