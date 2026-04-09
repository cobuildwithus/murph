import * as React from 'react'
import process from 'node:process'
import { PassThrough } from 'node:stream'

import type { SetupResult } from '@murphai/operator-config/setup-cli-contracts'

import { createSetupCli, type SetupCliOptions } from '../src/setup-cli.ts'

export interface CliEnvelope<TData> {
  data?: TData
  error?: {
    code?: string
    message?: string
    retryable?: boolean
  }
  meta: {
    cta?: {
      commands?: Array<{
        command?: string
        description?: string
      }>
      description?: string
    }
  }
  ok: boolean
}

export function makeSetupResult(
  vault: string,
  overrides: Partial<SetupResult> = {},
): SetupResult {
  return {
    arch: 'arm64',
    assistant: null,
    bootstrap: null,
    channels: [],
    dryRun: false,
    notes: [],
    platform: 'darwin',
    scheduledUpdates: [],
    steps: [
      {
        detail: `Initialized a new vault scaffold at ${vault}.`,
        id: 'vault-init',
        kind: 'configure',
        status: 'completed',
        title: 'Vault initialization',
      },
    ],
    toolchainRoot: '~/.murph/toolchain',
    tools: {
      ffmpegCommand: '/usr/local/bin/ffmpeg',
      pdftotextCommand: '/usr/local/bin/pdftotext',
      whisperCommand: '/usr/local/bin/whisper-cli',
      whisperModelPath: '~/.murph/toolchain/models/whisper/ggml-base.en.bin',
    },
    vault,
    wearables: [],
    whisperModel: 'base.en',
    ...overrides,
  }
}

export async function runSetupCliJson<TData>(
  args: string[],
  options: SetupCliOptions,
): Promise<CliEnvelope<TData>> {
  const cli = createSetupCli(options)
  const output: string[] = []

  await cli.serve([...args, '--verbose', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

export function collectElementText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return ''
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    return node.map((child) => collectElementText(child)).join('')
  }

  if (React.isValidElement(node)) {
    return collectElementText(
      (node.props as { children?: React.ReactNode }).children,
    )
  }

  return ''
}

export class FakeTtyStream extends PassThrough {
  readonly columns = 120
  readonly isTTY = true
  readonly rows = 40

  setRawMode(): void {}

  ref(): void {}

  unref(): void {}
}

export function createCapturedOutputStream(): {
  output: PassThrough
  readOutput: () => string
} {
  const output = new PassThrough()
  let rendered = ''

  output.on('data', (chunk) => {
    rendered += chunk.toString()
  })

  return {
    output,
    readOutput: () => rendered,
  }
}

let ttyHarnessLock: Promise<void> = Promise.resolve()

export async function withMockProcessTty<TResult>(
  run: (context: {
    flush: () => Promise<void>
    readOutput: () => string
    stderr: FakeTtyStream
    stdin: FakeTtyStream
    writeInput: (value: string) => Promise<void>
  }) => Promise<TResult>,
): Promise<TResult> {
  const waitForPreviousHarness = ttyHarnessLock
  let releaseHarness = () => {}
  ttyHarnessLock = new Promise<void>((resolve) => {
    releaseHarness = resolve
  })
  await waitForPreviousHarness

  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin')
  const stderrDescriptor = Object.getOwnPropertyDescriptor(process, 'stderr')
  const stdin = new FakeTtyStream()
  const stderr = new FakeTtyStream()
  let rendered = ''

  stderr.on('data', (chunk) => {
    rendered += chunk.toString()
  })

  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: stdin,
  })
  Object.defineProperty(process, 'stderr', {
    configurable: true,
    value: stderr,
  })

  const flush = async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  try {
    return await run({
      flush,
      readOutput: () => rendered,
      stderr,
      stdin,
      writeInput: async (value) => {
        stdin.write(value)
        await flush()
      },
    })
  } finally {
    stdin.end()
    stderr.end()

    if (stdinDescriptor) {
      Object.defineProperty(process, 'stdin', stdinDescriptor)
    }
    if (stderrDescriptor) {
      Object.defineProperty(process, 'stderr', stderrDescriptor)
    }
    releaseHarness()
  }
}

export function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/gu, '')
}

export async function waitForRenderedText(
  flush: () => Promise<void>,
  readOutput: () => string,
  pattern: RegExp,
  options: {
    timeoutMs?: number
  } = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const output = stripAnsi(readOutput())
    if (pattern.test(output)) {
      await flush()
      return stripAnsi(readOutput())
    }

    await flush()
  }

  return stripAnsi(readOutput())
}
