import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { MURPH_PRODUCT_ORIGIN } from '@murphai/contracts'
import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  resolveAssistantSkillsRoot,
} from '../src/assistant-skill-assets.js'

function resolveExperimentOnboardingSkillDirectory(): string {
  const skill = ASSISTANT_SKILLS.find(
    (candidate) => candidate.slug === 'experiment-onboarding',
  )
  expect(skill).toBeTruthy()
  if (!skill) {
    throw new Error('experiment-onboarding skill is not registered')
  }

  return path.join(resolveAssistantSkillsRoot(), skill.slug)
}

async function readExperimentOnboardingSkillAssets(): Promise<string[]> {
  const directory = resolveExperimentOnboardingSkillDirectory()
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => readFile(path.join(entry.parentPath, entry.name), 'utf8')),
  )
}

describe('private assistant experiments', () => {
  it('designs new runs without public catalog discovery or experiment webpage links', async () => {
    const assets = await readExperimentOnboardingSkillAssets()
    expect(assets.length).toBeGreaterThan(0)

    for (const asset of assets) {
      expect(asset).not.toContain('vault-cli commons protocol')
      expect(asset).not.toContain('--from-protocol')
      expect(asset).not.toContain('--no-public-protocol')
      expect(asset).not.toContain('--page-revision-id')
      expect(asset).not.toContain('--run-spec-revision-id')
      expect(asset).not.toContain(`${MURPH_PRODUCT_ORIGIN}/experiments`)
      expect(asset).not.toMatch(/\/experiments\/(?:runs\/)?</u)
    }
  })
})
