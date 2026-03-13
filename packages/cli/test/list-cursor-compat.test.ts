import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test } from 'vitest'
import { repoRoot } from './cli-test-helpers.js'

const execFileAsync = promisify(execFile)
const sourceBinPath = path.join(repoRoot, 'packages/cli/src/bin.ts')

interface CliSuccessEnvelope<TData = Record<string, unknown>> {
  ok: true
  data: TData
  meta: {
    command: string
    duration: string
  }
}

type CliEnvelope<TData = Record<string, unknown>> =
  | CliSuccessEnvelope<TData>
  | {
      ok: false
      error: {
        code?: string
        message?: string
      }
      meta: {
        command: string
        duration: string
      }
    }

async function runSourceCli<TData = Record<string, unknown>>(
  args: string[],
): Promise<CliEnvelope<TData>> {
  const { stdout } = await execFileAsync(
    'pnpm',
    ['exec', 'tsx', sourceBinPath, ...withMachineOutput(args)],
    { cwd: repoRoot },
  )

  return JSON.parse(stdout) as CliEnvelope<TData>
}

async function runRawSourceCli(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'pnpm',
    ['exec', 'tsx', sourceBinPath, ...args],
    { cwd: repoRoot },
  )

  return stdout.trim()
}

function requireData<TData>(result: CliEnvelope<TData>): TData {
  if (!result.ok) {
    throw new Error(
      `CLI result failed: ${result.error.message ?? result.error.code ?? 'unknown error'}`,
    )
  }

  return result.data
}

function withMachineOutput(args: string[]): string[] {
  const nextArgs = [...args]

  if (!nextArgs.includes('--verbose')) {
    nextArgs.push('--verbose')
  }

  if (!nextArgs.includes('--json') && !nextArgs.includes('--format')) {
    nextArgs.push('--format', 'json')
  }

  return nextArgs
}

test('goal list help marks cursor as reserved instead of advertising pagination', async () => {
  const help = await runRawSourceCli(['goal', 'list', '--help'])

  assert.match(
    help,
    /Use --limit to cap results\. --cursor is accepted for compatibility but ignored until pagination is implemented\./u,
  )
  assert.doesNotMatch(help, /next-page token/u)
  assert.match(help, /Reserved for future pagination support\./u)
})

test.sequential('list commands accept reserved cursor input without echoing it back', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'healthybob-cli-list-'))

  try {
    const initResult = await runSourceCli<{ created: boolean }>(['init', '--vault', vaultRoot])
    assert.equal(initResult.ok, true)
    assert.equal(requireData(initResult).created, true)

    const readList = await runSourceCli<{
      filters: Record<string, unknown>
      nextCursor: string | null
    }>([
      'list',
      '--cursor',
      'stub-token',
      '--limit',
      '5',
      '--vault',
      vaultRoot,
    ])
    assert.equal(readList.ok, true)
    assert.equal(readList.meta?.command, 'list')
    assert.equal('cursor' in requireData(readList).filters, false)
    assert.equal(requireData(readList).nextCursor, null)

    const intakeList = await runSourceCli<{
      filters: Record<string, unknown>
      nextCursor: string | null
    }>([
      'intake',
      'list',
      '--cursor',
      'stub-token',
      '--limit',
      '5',
      '--vault',
      vaultRoot,
    ])
    assert.equal(intakeList.ok, true)
    assert.equal(intakeList.meta?.command, 'intake list')
    assert.equal('cursor' in requireData(intakeList).filters, false)
    assert.equal(requireData(intakeList).nextCursor, null)

    const goalList = await runSourceCli<{
      count: number
      items: unknown[]
    }>([
      'goal',
      'list',
      '--cursor',
      'stub-token',
      '--limit',
      '5',
      '--vault',
      vaultRoot,
    ])
    assert.equal(goalList.ok, true)
    assert.equal(goalList.meta?.command, 'goal list')
    assert.equal(requireData(goalList).count, 0)
    assert.deepEqual(requireData(goalList).items, [])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})
