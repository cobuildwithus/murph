import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { MURPH_PRODUCT_ORIGIN } from '@murphai/contracts'
import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

async function readExperimentOnboardingSkill(): Promise<string> {
  const skill = ASSISTANT_SKILLS.find(
    (candidate) => candidate.slug === 'experiment-onboarding',
  )
  expect(skill).toBeTruthy()
  if (!skill) {
    throw new Error('experiment-onboarding skill is not registered')
  }

  return readFile(
    path.join(resolveAssistantSkillsRoot(), skill.slug, 'SKILL.md'),
    'utf8',
  )
}

describe('private experiment deep links', () => {
  it('routes custom experiment links from canonical ids in verified-private conversations', async () => {
    const skill = await readExperimentOnboardingSkill()

    expect(skill).toContain(
      'Do not send an experiment page link proactively. Creating a run is not a reason to send one',
    )
    expect(skill).toContain(
      'Send a link only when the user asks for one or clearly wants more detail on the experiment',
    )
    expect(skill).toContain(
      'When a link is warranted for a successfully persisted custom unlinked run in a verified-private conversation',
    )
    expect(skill).toContain(
      `${MURPH_PRODUCT_ORIGIN}/experiments/runs/<experimentId>`,
    )
    expect(skill).toContain(
      'the exact canonical `experimentId` returned by the successful non-dry-run command',
    )
    expect(skill).toContain(
      'use the exact canonical `experimentId` from trusted active-experiment context when present',
    )
    expect(skill).toContain('Never require a prebuilt URL from the context')
    expect(skill).toContain('percent-encoded as one path segment')
    expect(skill).toContain('never derive the route from a title or slug')
    expect(skill).toContain('never send it in a group or unverified conversation')
    expect(skill).toContain('normal account access still applies')
    expect(skill).not.toContain(
      'Do not invent a page URL for custom unlinked runs.',
    )
  })
})
