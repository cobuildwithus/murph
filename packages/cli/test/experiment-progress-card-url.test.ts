import assert from 'node:assert/strict'

import {
  EXPERIMENT_PROGRESS_CARD_VERSION,
  buildExperimentProgressCardPath,
  type ExperimentProgressCardData,
} from '@murphai/contracts'
import { normalizeAssistantResponseMediaUrl } from '@murphai/operator-config/assistant-cli-contracts'
import { test } from 'vitest'

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
  const path = buildExperimentProgressCardPath(
    'exp_01JNV4458HYPP53JDQCBP1QJFM',
    sampleCard,
  )
  const url = `https://app.withmurph.ai${path}`

  // normalizeAssistantResponseMediaUrl throws if the URL is not attachable, and
  // returns the URL verbatim when it is. Both properties matter.
  assert.equal(normalizeAssistantResponseMediaUrl(url), url)
})
