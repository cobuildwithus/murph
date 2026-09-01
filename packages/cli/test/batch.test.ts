import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'

import { VAULT_LAYOUT } from '@murphai/contracts'
import {
  VAULT_CLI_BATCH_RESULT_SCHEMA,
  vaultCliBatchResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'

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

test('batch schema explains source output lengths before compact mode', async () => {
  const raw = await runCli(['batch', '--schema', '--format', 'json'])
  const schema = JSON.parse(raw) as {
    output?: {
      properties?: {
        commands?: {
          items?: {
            properties?: Record<string, { description?: string }>
          }
        }
      }
    }
  }
  const outputProperties = schema.output?.properties?.commands?.items?.properties

  assert.equal(
    outputProperties?.outputBytes?.description,
    'UTF-8 byte length of captured child stdout before compact mode may clear stdout.',
  )
  assert.equal(
    outputProperties?.outputChars?.description,
    'Legacy UTF-16 code-unit length of captured child stdout before compact mode may clear stdout.',
  )
})

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
        outputBytes: number
        outputChars: number
        stdout: string
      }>
      schema: string
      vault: string
    }

    assert.equal(result.schema, VAULT_CLI_BATCH_RESULT_SCHEMA)
    assert.equal(result.vault, vault)
    assert.equal(result.count, 2)
    assert.equal(result.failed, 0)
    assert.deepEqual(result.commands.map((command) => command.ok), [true, true])
    assert.deepEqual(result.commands[0]?.argv.slice(0, 2), ['memory', 'show'])
    assert.equal(result.commands[0]?.argv.includes('--vault'), true)
    assert.equal(result.commands[0]?.argv.includes('--format'), true)
    assert.equal(typeof result.commands[0]?.stdout, 'string')
    assert.equal(typeof result.commands[1]?.stdout, 'string')
    assert.equal(
      result.commands[0]?.outputChars,
      result.commands[0]?.stdout.length,
    )
    assert.equal(
      result.commands[1]?.outputChars,
      result.commands[1]?.stdout.length,
    )
    assert.equal(
      result.commands[0]?.outputBytes,
      Buffer.byteLength(result.commands[0]?.stdout ?? '', 'utf8'),
    )
    assert.equal(
      result.commands[1]?.outputBytes,
      Buffer.byteLength(result.commands[1]?.stdout ?? '', 'utf8'),
    )
    assert.equal(typeof result.commands[0]?.data, 'object')
    assert.equal(typeof result.commands[1]?.data, 'object')
    assert.deepEqual(JSON.parse(result.commands[0]?.stdout ?? ''), result.commands[0]?.data)
    assert.deepEqual(JSON.parse(result.commands[1]?.stdout ?? ''), result.commands[1]?.data)
  } finally {
    await rm(parent, {
      recursive: true,
      force: true,
    })
  }
})

test('batch compact mode removes duplicate parsed JSON bytes without changing the released result shape', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-batch-compact-'))
  const vault = path.join(parent, 'vault')

  try {
    await runCli(['init', '--vault', vault, '--format', 'json'])
    await runCli([
      'memory',
      'upsert',
      'Préfère les réponses concises 🙂.',
      '--section',
      'Preferences',
      '--vault',
      vault,
      '--format',
      'json',
    ])

    const nonCompactRaw = await runCli([
      'batch',
      '--vault',
      vault,
      '--command',
      '["memory","show"]',
      '--format',
      'json',
    ])
    const nonCompactResult = JSON.parse(nonCompactRaw) as {
      commands: Array<{
        outputBytes: number
        outputChars: number
        stdout: string
      }>
    }
    const nonCompactMemory = nonCompactResult.commands[0]
    assert.ok(nonCompactMemory)
    assert.equal(
      nonCompactMemory.outputBytes,
      Buffer.byteLength(nonCompactMemory.stdout, 'utf8'),
    )
    assert.equal(nonCompactMemory.outputChars, nonCompactMemory.stdout.length)

    const raw = await runCli([
      'batch',
      '--compact',
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
      commands: Array<{
        data?: unknown
        ok: boolean
        outputBytes: number
        outputChars: number
        stdout: string
      }>
    }

    assert.deepEqual(result.commands.map((command) => command.ok), [true, true])
    assert.deepEqual(result.commands.map((command) => command.stdout), ['', ''])
    assert.equal(
      result.commands.every((command) => command.outputChars > 0),
      true,
    )
    assert.equal(
      result.commands.every((command) => command.outputBytes > 0),
      true,
    )
    assert.equal(
      result.commands.some(
        (command) => command.outputBytes > command.outputChars,
      ),
      true,
    )
    assert.equal(typeof result.commands[0]?.data, 'object')
    assert.equal(typeof result.commands[1]?.data, 'object')
    assert.equal(result.commands[0]?.outputBytes, nonCompactMemory.outputBytes)
    assert.equal(result.commands[0]?.outputChars, nonCompactMemory.outputChars)

    const duplicatedRaw = JSON.stringify({
      ...result,
      commands: result.commands.map((command) => ({
        ...command,
        stdout: JSON.stringify(command.data),
      })),
    })
    assert.ok(JSON.stringify(result).length < duplicatedRaw.length * 0.7)
  } finally {
    await rm(parent, {
      recursive: true,
      force: true,
    })
  }
})

test('batch compact mode preserves successful help and schema output as stdout', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-batch-text-'))
  const vault = path.join(parent, 'vault')

  try {
    await runCli(['init', '--vault', vault, '--format', 'json'])

    const raw = await runCli([
      'batch',
      '--compact',
      '--vault',
      vault,
      '--command',
      '["memory","show","--help","--format","yaml"]',
      '--command',
      '["memory","show","--schema","--format","yaml"]',
      '--format',
      'json',
    ])
    const result = JSON.parse(raw) as {
      commands: Array<{
        data?: unknown
        ok: boolean
        stdout: string
      }>
    }

    assert.deepEqual(result.commands.map((command) => command.ok), [true, true])
    assert.equal(
      result.commands.every((command) => command.stdout.length > 0),
      true,
    )
    assert.equal(
      result.commands.every((command) => !Object.hasOwn(command, 'data')),
      true,
    )
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
        stdout: string
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
      '["init"]',
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
          code?: string
          fieldErrors?: Array<{ path: string }>
          hint?: string
          message: string
          retryable?: boolean
          stage?: string
        }
        ok: boolean
        stdout: string
      }>
    }

    assert.equal(result.count, 2)
    assert.equal(result.failed, 1)
    assert.deepEqual(result.commands.map((command) => command.ok), [false, true])
    assert.deepEqual(result.commands[0]?.error, {
      code: 'already_exists',
      fieldErrors: [
        {
          code: 'custom',
          expected: '',
          message: 'This field is invalid.',
          path: 'vault',
          received: 'invalid',
        },
      ],
      message: 'Vault is already initialized. Use vault show for the existing vault or choose a different vault root.',
      retryable: false,
      stage: 'conflict',
    })
    assert.equal(
      result.commands[0]?.error?.message.includes('exited with status'),
      false,
    )
    assert.equal(typeof result.commands[0]?.stdout, 'string')
  } finally {
    await rm(parent, {
      recursive: true,
      force: true,
    })
  }
})

test('batch preserves query-source recovery fields without echoing private source data', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-batch-query-source-'))
  const vault = path.join(parent, 'vault')
  const relativeSourcePath = path.posix.join(
    VAULT_LAYOUT.auditDirectory,
    '2026',
    'invalid.jsonl',
  )
  const sourcePath = path.join(vault, relativeSourcePath)
  const privateMarker = 'private-batch-query-source-marker'
  const invalidSource = `${JSON.stringify({
    occurredAt: '2026-08-30T12:00:00.000Z',
    privatePayload: privateMarker,
  })}\n`

  try {
    await runCli(['init', '--vault', vault, '--format', 'json'])
    await mkdir(path.dirname(sourcePath), { recursive: true })
    await writeFile(sourcePath, invalidSource, 'utf8')

    const raw = await runCli([
      'batch',
      '--compact',
      '--vault',
      vault,
      '--command',
      '["timeline"]',
      '--command',
      '["memory","show"]',
      '--stopOnError',
      '--format',
      'json',
    ])
    const result = vaultCliBatchResultSchema.parse(JSON.parse(raw))
    const command = result.commands[0]

    assert.equal(result.requested, 2)
    assert.equal(result.executed, 1)
    assert.equal(result.count, 1)
    assert.equal(result.succeeded, 0)
    assert.equal(result.failed, 1)
    assert.equal(result.stoppedEarly, true)
    assert.equal(command?.ok, false)
    assert.deepEqual(command?.error, {
      code: 'query_source_invalid',
      message: `Canonical vault source ${relativeSourcePath}:1 could not be read.`,
      retryable: false,
      fieldErrors: [
        {
          code: 'missing_field',
          path: 'id',
          expected: '',
          received: 'missing',
          message: 'This canonical source field is invalid or missing.',
          missing: true,
        },
      ],
      hint:
        `Repair ${relativeSourcePath}:1, then rerun the command. Vault validation can identify additional source issues.`,
      stage: 'query_source',
    })
    assert.equal(command?.stdout, '')
    const safeFailureOutput = JSON.stringify({
      error: command?.error,
      stdout: command?.stdout,
    })
    assert.doesNotMatch(safeFailureOutput, new RegExp(privateMarker, 'u'))
    assert.doesNotMatch(
      safeFailureOutput,
      new RegExp(parent.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'),
    )
    assert.equal(await readFile(sourcePath, 'utf8'), invalidSource)
  } finally {
    await rm(parent, {
      recursive: true,
      force: true,
    })
  }
})

test('batch compact mode retains requested child failure envelopes', async () => {
  const privateVault = './private-vault-path'
  const invalidKind = 'not-a-kind'
  const raw = await runCli([
    'batch',
    '--compact',
    '--vault',
    privateVault,
    '--command',
    JSON.stringify([
      'event',
      'list',
      '--kind',
      invalidKind,
      '--full-output',
      '--format',
      'json',
    ]),
    '--command',
    '["memory","show"]',
    '--stopOnError',
    '--format',
    'json',
  ])
  const result = vaultCliBatchResultSchema.parse(JSON.parse(raw))
  const command = result.commands[0]

  assert.equal(result.requested, 2)
  assert.equal(result.executed, 1)
  assert.equal(result.count, 1)
  assert.equal(result.succeeded, 0)
  assert.equal(result.failed, 1)
  assert.equal(result.stoppedEarly, true)
  assert.equal(command?.ok, false)
  assert.equal(command?.error?.code, 'VALIDATION_ERROR')
  assert.equal(command?.error?.retryable, false)
  assert.equal(command?.error?.stage, 'validation')
  assert.equal(command?.error?.fieldErrors?.[0]?.path, 'kind')
  assert.ok((command?.stdout.length ?? 0) > 0)
  assert.equal(
    command?.outputBytes,
    Buffer.byteLength(command?.stdout ?? '', 'utf8'),
  )
  assert.equal(command?.outputChars, command?.stdout.length)

  const childEnvelope = JSON.parse(command?.stdout ?? '') as {
    error?: {
      code?: string
      fieldErrors?: Array<{
        code?: string
        expected?: string
        message?: string
        missing?: boolean
        path?: string
        received?: string
      }>
      hint?: string
      message?: string
      retryable?: boolean
      stage?: string
    }
    meta?: {
      command?: string
      duration?: string
    }
    ok?: boolean
  }
  assert.equal(childEnvelope.ok, false)
  assert.deepEqual(childEnvelope.error, {
    code: 'VALIDATION_ERROR',
    message: 'The command input is invalid.',
    retryable: false,
    hint: 'Check the command schema and correct the invalid input.',
    stage: 'validation',
    fieldErrors: [
      {
        code: 'invalid_value',
        missing: false,
        path: 'kind',
        expected: '',
        received: 'invalid',
        message: 'This field is invalid.',
      },
    ],
  })
  assert.equal(childEnvelope.meta?.command, 'event list')
  assert.match(childEnvelope.meta?.duration ?? '', /^\d+ms$/u)

  const safeFailureOutput = JSON.stringify({
    error: command?.error,
    stdout: command?.stdout,
  })
  assert.equal(safeFailureOutput.includes(invalidKind), false)
  assert.equal(safeFailureOutput.includes(privateVault), false)
})

test('batch normalizes native validation fields in compact and noncompact output', async () => {
  const oversizedQuery = 'q'.repeat(257)
  const invalidKind = 'private-invalid-kind'
  const scenarios = [
    {
      argv: ['food', 'search-labels-batch', '--query', oversizedQuery],
      fieldCode: 'too_big',
      fieldPath: 'query',
    },
    {
      argv: ['event', 'list', '--kind', invalidKind],
      fieldCode: 'invalid_value',
      fieldPath: 'kind',
    },
  ] as const

  for (const compact of [false, true]) {
    const raw = await runCli([
      'batch',
      ...(compact ? ['--compact'] : []),
      '--vault',
      './vault',
      ...scenarios.flatMap((scenario) => [
        '--command',
        JSON.stringify(scenario.argv),
      ]),
      '--format',
      'json',
    ])
    const result = vaultCliBatchResultSchema.parse(JSON.parse(raw))

    assert.equal(result.failed, scenarios.length)
    for (const [index, scenario] of scenarios.entries()) {
      const command = result.commands[index]
      const expectedError = {
        code: 'VALIDATION_ERROR',
        message: 'Invalid command option.',
        retryable: false,
        stage: 'validation',
        fieldErrors: [
          {
            code: scenario.fieldCode,
            message: 'Invalid value for this option.',
            missing: false,
            path: scenario.fieldPath,
            received: 'invalid',
          },
        ],
      }

      assert.equal(command?.ok, false)
      assert.deepEqual(command?.error, expectedError)
      assert.equal(JSON.stringify(command?.error).includes(oversizedQuery), false)
      assert.equal(JSON.stringify(command?.error).includes(invalidKind), false)
      assert.ok((command?.outputBytes ?? 0) > 0)

      if (compact) {
        assert.equal(command?.stdout, '')
        continue
      }

      const nativeError = JSON.parse(command?.stdout ?? '') as {
        code?: string
        fieldErrors?: Array<{
          code?: string
          expected?: string
          message?: string
          missing?: boolean
          path?: string
          received?: string
        }>
        hint?: string
        message?: string
        retryable?: boolean
        stage?: string
      }
      assert.deepEqual(nativeError, {
        code: 'VALIDATION_ERROR',
        message: 'The command input is invalid.',
        retryable: false,
        hint: 'Check the command schema and correct the invalid input.',
        stage: 'validation',
        fieldErrors: [
          {
            code: scenario.fieldCode,
            missing: false,
            path: scenario.fieldPath,
            expected: '',
            received: 'invalid',
            message: 'This field is invalid.',
          },
        ],
      })
    }
  }
})

test('batch lifts typed child failures through explicit non-JSON formats', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-batch-formatted-failure-'))
  const vault = path.join(parent, 'vault')

  try {
    await runCli(['init', '--vault', vault, '--format', 'json'])

    for (const format of ['md', 'toon', 'yaml']) {
      const raw = await runCli([
        'batch',
        '--vault',
        vault,
        '--command',
        JSON.stringify(['init', '--format', format]),
        '--format',
        'json',
      ])
      const result = JSON.parse(raw) as {
        commands: Array<{
          argv: string[]
          error?: {
            code?: string
            fieldErrors?: Array<{ path: string }>
            message: string
            retryable?: boolean
            stage?: string
          }
          ok: boolean
          stdout: string
        }>
      }
      const command = result.commands[0]

      assert.equal(command?.ok, false)
      assert.equal(command?.error?.code, 'already_exists')
      assert.equal(command?.error?.retryable, false)
      assert.equal(command?.error?.stage, 'conflict')
      assert.deepEqual(
        command?.error?.fieldErrors?.map((fieldError) => fieldError.path),
        ['vault'],
      )
      assert.equal(command?.error?.message.includes('exited with status'), false)
      assert.deepEqual(command?.argv.slice(0, 3), ['init', '--format', format])
      assert.match(command?.stdout ?? '', /already_exists/u)
      assert.throws(() => JSON.parse(command?.stdout ?? ''))
    }
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
      '--command',
      '["--","assistant","run"]',
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

    assert.equal(result.failed, 10)
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

test('batch admission still runs an allowed child behind root options', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-batch-allowed-admission-'))
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

    const raw = await runCli([
      'batch',
      '--vault',
      vault,
      '--command',
      '["--filter-output","--once","memory","show"]',
      '--format',
      'json',
    ])
    const result = JSON.parse(raw) as {
      failed: number
      commands: Array<{
        argv: string[]
        error?: {
          message: string
        }
        ok: boolean
      }>
    }

    assert.equal(result.failed, 0, result.commands[0]?.error?.message)
    assert.equal(result.commands[0]?.ok, true)
    assert.deepEqual(result.commands[0]?.argv.slice(0, 4), [
      '--filter-output',
      '--once',
      'memory',
      'show',
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
