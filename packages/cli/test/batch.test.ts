import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'

import { runMurphCliAction } from '../src/cli-entry.ts'

async function runCli(argv: string[]): Promise<string> {
  const stdout: string[] = []
  const previousExitCode = process.exitCode
  try {
    process.exitCode = undefined
    await runMurphCliAction(argv, {
      argv0: 'vault-cli',
      exit(code) {
        if (code && code !== 0) {
          throw new Error(`exit ${code}`)
        }
      },
      stdout(chunk) {
        stdout.push(chunk)
      },
    })

    if (process.exitCode && process.exitCode !== 0) {
      throw new Error(`exitCode ${process.exitCode}`)
    }

    return stdout.join('')
  } finally {
    process.exitCode = previousExitCode
  }
}

test('batch runs multiple vault-cli argv arrays in one process', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-batch-'))
  const vault = path.join(parent, 'vault')

  try {
    await runCli(['init', '--vault', vault, '--format', 'json'])
    await runCli([
      'memory',
      'upsert',
      'Prefers concise answers.',
      '--section',
      'Preferences',
      '--vault',
      vault,
      '--format',
      'json',
    ])
    await runCli([
      'goal',
      'save',
      'Sleep consistently',
      '--status',
      'active',
      '--vault',
      vault,
      '--format',
      'json',
    ])

    const raw = await runCli([
      'batch',
      '--vault',
      vault,
      '--command',
      '["memory","show"]',
      '--command',
      '["goal","list"]',
      '--format',
      'json',
    ])
    const result = JSON.parse(raw) as {
      count: number
      failed: number
      commands: Array<{
        argv: string[]
        data?: unknown
        ok: boolean
        stdout: string
      }>
      vault: string
    }

    assert.equal(result.vault, vault)
    assert.equal(result.count, 2)
    assert.equal(result.failed, 0)
    assert.deepEqual(result.commands.map((command) => command.ok), [true, true])
    assert.deepEqual(result.commands[0]?.argv.slice(0, 2), ['memory', 'show'])
    assert.equal(result.commands[0]?.argv.includes('--vault'), true)
    assert.equal(result.commands[0]?.argv.includes('--format'), true)
    assert.equal(typeof result.commands[0]?.stdout, 'string')
    assert.equal(typeof result.commands[0]?.data, 'object')
    assert.equal(typeof result.commands[1]?.data, 'object')
  } finally {
    await rm(parent, {
      recursive: true,
      force: true,
    })
  }
})

test('batch captures child failures and honors stopOnError', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-batch-failure-'))
  const vault = path.join(parent, 'vault')

  try {
    await runCli(['init', '--vault', vault, '--format', 'json'])

    const raw = await runCli([
      'batch',
      '--vault',
      vault,
      '--command',
      '["memory","show"]',
      '--command',
      '["batch","--command","[\\"memory\\",\\"show\\"]"]',
      '--command',
      '["goal","list"]',
      '--stopOnError',
      '--format',
      'json',
    ])
    const result = JSON.parse(raw) as {
      count: number
      failed: number
      commands: Array<{
        error?: {
          message: string
        }
        ok: boolean
      }>
    }

    assert.equal(result.count, 2)
    assert.equal(result.failed, 1)
    assert.deepEqual(result.commands.map((command) => command.ok), [true, false])
    assert.match(
      result.commands[1]?.error?.message ?? '',
      /Nested batch commands are not supported/u,
    )
  } finally {
    await rm(parent, {
      recursive: true,
      force: true,
    })
  }
})

test('batch captures executed child command failures and continues by default', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-batch-child-failure-'))
  const vault = path.join(parent, 'vault')

  try {
    await runCli(['init', '--vault', vault, '--format', 'json'])

    const raw = await runCli([
      'batch',
      '--vault',
      vault,
      '--command',
      '["not-a-real-command"]',
      '--command',
      '["memory","show"]',
      '--format',
      'json',
    ])
    const result = JSON.parse(raw) as {
      count: number
      failed: number
      commands: Array<{
        error?: {
          message: string
        }
        ok: boolean
      }>
    }

    assert.equal(result.count, 2)
    assert.equal(result.failed, 1)
    assert.deepEqual(result.commands.map((command) => command.ok), [false, true])
    assert.equal(typeof result.commands[0]?.error?.message, 'string')
  } finally {
    await rm(parent, {
      recursive: true,
      force: true,
    })
  }
})

test('batch rejects setup, interactive, and assistant automation child commands', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-batch-blocked-'))
  const vault = path.join(parent, 'vault')

  try {
    await runCli(['init', '--vault', vault, '--format', 'json'])

    const raw = await runCli([
      'batch',
      '--vault',
      vault,
      '--command',
      '["onboard"]',
      '--command',
      '["chat"]',
      '--command',
      '["run"]',
      '--command',
      '["run","--once"]',
      '--command',
      '["--filter-output","--once","run"]',
      '--command',
      '["assistant","chat"]',
      '--command',
      '["assistant","run"]',
      '--command',
      '["assistant","run","--once"]',
      '--command',
      '["--filter-output","--once","assistant","run"]',
      '--format',
      'json',
    ])
    const result = JSON.parse(raw) as {
      failed: number
      commands: Array<{
        error?: {
          message: string
        }
        ok: boolean
      }>
    }

    assert.equal(result.failed, 9)
    assert.deepEqual(result.commands.map((command) => command.ok), [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
    assert.match(
      result.commands[0]?.error?.message ?? '',
      /cannot run onboarding setup/u,
    )
    assert.match(
      result.commands[1]?.error?.message ?? '',
      /cannot run interactive assistant chat/u,
    )
    assert.match(
      result.commands[2]?.error?.message ?? '',
      /cannot run assistant automation/u,
    )
    assert.match(
      result.commands[4]?.error?.message ?? '',
      /cannot run assistant automation/u,
    )
  } finally {
    await rm(parent, {
      recursive: true,
      force: true,
    })
  }
})

test('batch inserts inherited defaults before child argv terminator', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-batch-terminator-'))
  const vault = path.join(parent, 'vault')

  try {
    await runCli(['init', '--vault', vault, '--format', 'json'])

    const raw = await runCli([
      'batch',
      '--vault',
      vault,
      '--command',
      '["not-a-real-command","--","--format"]',
      '--format',
      'json',
    ])
    const result = JSON.parse(raw) as {
      commands: Array<{
        argv: string[]
        ok: boolean
      }>
    }

    assert.equal(result.commands[0]?.ok, false)
    assert.deepEqual(result.commands[0]?.argv, [
      'not-a-real-command',
      '--vault',
      vault,
      '--format',
      'json',
      '--',
      '--format',
    ])
  } finally {
    await rm(parent, {
      recursive: true,
      force: true,
    })
  }
})

test('batch rejects child MCP server mode', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-batch-mcp-'))
  const vault = path.join(parent, 'vault')

  try {
    await runCli(['init', '--vault', vault, '--format', 'json'])

    const raw = await runCli([
      'batch',
      '--vault',
      vault,
      '--command',
      '["--mcp"]',
      '--format',
      'json',
    ])
    const result = JSON.parse(raw) as {
      failed: number
      commands: Array<{
        error?: {
          message: string
        }
        ok: boolean
      }>
    }

    assert.equal(result.failed, 1)
    assert.equal(result.commands[0]?.ok, false)
    assert.match(
      result.commands[0]?.error?.message ?? '',
      /cannot run MCP server mode/u,
    )
  } finally {
    await rm(parent, {
      recursive: true,
      force: true,
    })
  }
})

test('batch rejects nested child commands behind leading root options', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-batch-nested-'))
  const vault = path.join(parent, 'vault')

  try {
    await runCli(['init', '--vault', vault, '--format', 'json'])

    const raw = await runCli([
      'batch',
      '--vault',
      vault,
      '--command',
      '["--format","json","batch","--command","[\\"memory\\",\\"show\\"]"]',
      '--format',
      'json',
    ])
    const result = JSON.parse(raw) as {
      failed: number
      commands: Array<{
        error?: {
          message: string
        }
        ok: boolean
      }>
    }

    assert.equal(result.failed, 1)
    assert.equal(result.commands[0]?.ok, false)
    assert.match(
      result.commands[0]?.error?.message ?? '',
      /Nested batch commands are not supported/u,
    )
  } finally {
    await rm(parent, {
      recursive: true,
      force: true,
    })
  }
})
