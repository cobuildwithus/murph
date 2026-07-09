import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { Cli } from 'incur'

import { repoRoot } from './cli-test-helpers.js'
import { localParallelCliTest as test } from './local-parallel-test.js'
import { createVaultCli } from '../src/index.js'

const DEFAULT_AGENT_VISIBLE_OUTPUT_MAX_CHARS = 15_000
const OUTPUT_BUDGET_TIMEOUT_MS = 120_000

function cliBudgetEnv() {
  const env = { ...process.env }
  delete env.VAULT
  return { env }
}

async function runBudgetedRawCli(
  cli: Cli.Cli,
  args: readonly string[],
  vaultRoot: string,
): Promise<string> {
  const output: string[] = []

  await cli.serve(
    [
      ...args,
      '--vault',
      vaultRoot,
      '--format',
      'json',
      '--full-output',
    ],
    {
      ...cliBudgetEnv(),
      exit: () => {},
      stdout(chunk) {
        output.push(chunk)
      },
    },
  )

  return output.join('').trim()
}

function assertWithinBudget(label: string, output: string) {
  assert.ok(
    output.length <= DEFAULT_AGENT_VISIBLE_OUTPUT_MAX_CHARS,
    `${label} emitted ${output.length} chars, expected <= ${DEFAULT_AGENT_VISIBLE_OUTPUT_MAX_CHARS}`,
  )
}

function assertOk(label: string, output: string) {
  const parsed = JSON.parse(output) as {
    error?: {
      code?: string
      message?: string
    }
    ok?: unknown
  }
  assert.equal(
    parsed.ok,
    true,
    `${label} did not return an ok envelope: ${parsed.error?.code ?? 'unknown'} ${
      parsed.error?.message ?? ''
    }`.trim(),
  )
}

test('representative default read commands stay within the agent-visible output budget', async () => {
  const cli = createVaultCli()
  const demoVaultRoot = path.join(repoRoot, 'fixtures/demo-web-vault')
  const commands: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['root list', ['list']],
    ['event list', ['event', 'list']],
    ['document list', ['document', 'list']],
    ['workout list', ['workout', 'list']],
    ['automation list', ['automation', 'list']],
    ['audit list', ['audit', 'list']],
    ['search query', ['search', 'query', 'sleep']],
    ['knowledge list', ['knowledge', 'list']],
    ['protocol list', ['protocol', 'list']],
    ['wearables latest', ['wearables', 'latest']],
    ['wearables sleep list', ['wearables', 'sleep', 'list']],
    ['wearables activity list', ['wearables', 'activity', 'list']],
    ['wearables recovery list', ['wearables', 'recovery', 'list']],
    ['wearables sources list', ['wearables', 'sources', 'list']],
  ]

  for (const [label, args] of commands) {
    const output = await runBudgetedRawCli(cli, args, demoVaultRoot)
    assertOk(label, output)
    assertWithinBudget(label, output)
  }
}, OUTPUT_BUDGET_TIMEOUT_MS)

test('workout list uses the compact default page size for oversized records', async () => {
  const cli = createVaultCli()
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-cli-output-budget-'))
  const longSummary = `Easy run ${'with detailed notes '.repeat(120)}`

  try {
    assertOk('init', await runBudgetedRawCli(cli, ['init'], vaultRoot))
    for (let index = 0; index < 6; index += 1) {
      assertOk(
        `workout add ${index}`,
        await runBudgetedRawCli(
          cli,
          [
            'workout',
            'add',
            `${longSummary}${index}`,
            '--duration',
            '30',
            '--occurred-at',
            `2026-04-${String(index + 1).padStart(2, '0')}T07:00:00.000Z`,
          ],
          vaultRoot,
        ),
      )
    }

    const rawList = await runBudgetedRawCli(cli, ['workout', 'list'], vaultRoot)
    const list = JSON.parse(rawList) as {
      ok: true
      data: {
        filters: {
          limit: number
        }
        items: unknown[]
      }
    }

    assert.equal(list.ok, true)
    assertWithinBudget('workout list', rawList)
    assert.equal(list.data.filters.limit, 5)
    assert.equal(list.data.items.length, 5)
  } finally {
    await rm(vaultRoot, {
      force: true,
      recursive: true,
    })
  }
}, OUTPUT_BUDGET_TIMEOUT_MS)
