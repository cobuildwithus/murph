import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  EXPERIMENT_PROGRESS_CARD_VERSION,
  MURPH_PRODUCT_ORIGIN,
  buildExperimentProgressCardPath,
  type ExperimentProgressCardData,
} from '@murphai/contracts'
import { normalizeAssistantResponseMediaUrl } from '@murphai/operator-config/assistant-cli-contracts'
import { createIntegratedVaultServices } from '@murphai/vault-usecases'
import { Cli } from 'incur'
import { test } from 'vitest'
import { registerExperimentCommands } from '../src/commands/experiment.js'
import { registerVaultCommands } from '../src/commands/vault.js'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import type { CliEnvelope } from './cli-test-helpers.js'
import { requireData } from './cli-test-helpers.js'

/**
 * The progress-card URL must survive `attach_response_media` unchanged: HTTPS,
 * no query string, no fragment, and an image extension. Pinning that here means
 * any later "improvement" to the URL shape (e.g. moving the payload back into a
 * query string) fails this test instead of silently breaking Murph's ability to
 * attach the card.
 */

const sampleCard: ExperimentProgressCardData = {
  v: EXPERIMENT_PROGRESS_CARD_VERSION,
  title: 'Creatine · 5g daily',
  asOf: '2026-06-09',
  phase: { day: 9, totalDays: 28 },
  sessions: { logged: 7, target: 24 },
  weeks: [
    { start: '2026-06-01', cells: 'CCPMCCN' },
    { start: '2026-06-08', cells: 'CNSSSSS' },
  ],
  movers: [
    {
      label: 'Resting heart rate',
      changePct: '2%',
      value: '58.2',
      unit: 'bpm',
      delta: '−1.2 bpm',
      direction: 'down',
      sentiment: 'positive',
    },
  ],
  confounders: [{ date: '2026-06-04', label: 'Alcohol (~5 drinks)' }],
}

test('progress-card URL passes assistant response-media validation unchanged', () => {
  const cardPath = buildExperimentProgressCardPath(
    'exp_01JNV4458HYPP53JDQCBP1QJFM',
    sampleCard,
  )
  const url = `${MURPH_PRODUCT_ORIGIN}${cardPath}`

  // normalizeAssistantResponseMediaUrl throws if the URL is not attachable, and
  // returns the URL verbatim when it is. Both properties matter.
  assert.equal(normalizeAssistantResponseMediaUrl(url), url)
})

const PRODUCT_BASE_URL_ENV_KEYS = [
  'HOSTED_ONBOARDING_PUBLIC_BASE_URL',
  'HOSTED_WEB_BASE_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
] as const

async function runProgressCardSliceCli<TData>(
  args: readonly string[],
): Promise<CliEnvelope<TData>> {
  const cli = Cli.create('vault-cli', {
    description: 'experiment progress-card url slice test cli',
    version: '0.0.0-test',
  })
  cli.use(incurErrorBridge)
  const services = createIntegratedVaultServices()
  registerVaultCommands(cli, services)
  registerExperimentCommands(cli, services)

  const output: string[] = []
  await cli.serve([...args, '--full-output', '--format', 'json'], {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return JSON.parse(output.join('').trim()) as CliEnvelope<TData>
}

test.sequential(
  'progress-card command emits the canonical-origin url with no env configured and lets env overrides win',
  async () => {
    const savedEnv = PRODUCT_BASE_URL_ENV_KEYS.map(
      (key) => [key, process.env[key]] as const,
    )
    const vaultRoot = await mkdtemp(
      path.join(tmpdir(), 'murph-cli-progress-card-url-'),
    )

    try {
      for (const key of PRODUCT_BASE_URL_ENV_KEYS) {
        delete process.env[key]
      }

      await runProgressCardSliceCli([
        'init',
        '--vault',
        vaultRoot,
        '--timezone',
        'America/Los_Angeles',
      ])
      const created = await runProgressCardSliceCli<{ slug: string }>([
        'experiment',
        'start',
        'progress-card-url',
        '--custom',
        '--no-public-protocol',
        '--title',
        'Progress Card URL',
        '--started-on',
        '2026-04-01',
        '--status',
        'active',
        '--intervention-start',
        '2026-04-08',
        '--intervention-days',
        '14',
        '--primary-biomarker-key',
        'biomarker:resting-heart-rate',
        '--vault',
        vaultRoot,
      ])
      assert.equal(created.ok, true)

      const progressCardArgs = [
        'experiment',
        'progress-card',
        'progress-card-url',
        '--as-of',
        '2026-04-10',
        '--vault',
        vaultRoot,
      ]

      // No base-URL env configured: the command falls back to the canonical
      // production origin instead of a null url plus a configuration warning.
      const fallback = requireData(
        await runProgressCardSliceCli<{
          path: string
          url: string
          warnings: string[]
        }>(progressCardArgs),
      )
      assert.equal(fallback.url, `${MURPH_PRODUCT_ORIGIN}${fallback.path}`)
      assert.equal(
        fallback.warnings.some((warning) => /base url/iu.test(warning)),
        false,
      )

      // Configured env still wins over the canonical fallback.
      process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL = 'https://join.example.test'
      const overridden = requireData(
        await runProgressCardSliceCli<{
          path: string
          url: string
        }>(progressCardArgs),
      )
      assert.equal(
        overridden.url,
        `https://join.example.test${overridden.path}`,
      )
    } finally {
      for (const [key, value] of savedEnv) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
