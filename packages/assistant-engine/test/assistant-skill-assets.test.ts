import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ASSISTANT_SKILLS,
  buildAssistantSkillFileRef,
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
  MURPH_ASSISTANT_SKILLS_ROOT_REF,
  resolveAssistantSkillsRoot,
  withAssistantSkillsRootEnv,
} from '../src/assistant-skill-assets.js'

describe('assistant skill assets', () => {
  it('has a valid SKILL.md for every registered assistant skill', async () => {
    const root = resolveAssistantSkillsRoot()

    for (const skill of ASSISTANT_SKILLS) {
      const raw = await readFile(
        path.join(root, skill.slug, 'SKILL.md'),
        'utf8',
      )

      expect(raw).toContain('---')
      expect(raw).toContain(`name: ${skill.name}`)
      expect(raw).toContain('description:')
      expect(raw.length).toBeGreaterThan(0)
    }
  })

  it('builds stable symbolic skill file references', () => {
    expect(MURPH_ASSISTANT_SKILLS_ROOT_REF).toBe('$MURPH_ASSISTANT_SKILLS_ROOT')
    expect(buildAssistantSkillFileRef('experiment-onboarding')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md',
    )
  })

  it('fills the assistant skills root env without overriding explicit roots', () => {
    const fallback = withAssistantSkillsRootEnv({
      [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: '   ',
    })
    expect(fallback[MURPH_ASSISTANT_SKILLS_ROOT_ENV]).toBe(
      resolveAssistantSkillsRoot(),
    )

    const explicitRoot = path.join('custom', 'assistant-skills')
    const preserved = withAssistantSkillsRootEnv({
      [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: explicitRoot,
    })
    expect(preserved[MURPH_ASSISTANT_SKILLS_ROOT_ENV]).toBe(explicitRoot)
  })

  it('keeps experiment onboarding details in the skill file, not the prompt', async () => {
    const raw = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        'experiment-onboarding',
        'SKILL.md',
      ),
      'utf8',
    )

    expect(raw).toContain(
      'Before asking any experiment onboarding question, perform a bounded vault-first evidence pass',
    )
    expect(raw).toContain('# First-session prep reminders')
    expect(raw).toContain('vault-cli experiment start <slug>')
    expect(raw).toContain('vault-cli experiment edit <id>')
    expect(raw).toContain('vault-cli automation save <title>')
    expect(raw).toContain('first_session_start_at')
    expect(raw).toContain('first_session_prep_reminder_at')
    expect(raw).toContain('first_session_prep_automation_slug')
    expect(raw).toContain('analysisPlan.measurementAnchors')
    expect(raw).toContain('analysisPlan.plannedMeasurements')
    expect(raw).toContain('commonsProtocolRef')
    expect(raw).toContain(
      'If no Murph product base URL is present, do not send an experiment page link or standalone `/experiments/<routeId>` route.',
    )
    expect(raw).not.toContain('/tmp/')
    expect(raw).not.toContain('.codex-hosted')
  })

  it('keeps skill descriptions under the Codex parser limit', () => {
    for (const skill of ASSISTANT_SKILLS) {
      expect(skill.triggerHint.length).toBeLessThan(1024)
    }
  })

  it('publishes static skill assets with the assistant-engine package', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports?: unknown; files?: unknown }

    expect(Array.isArray(packageJson.files)).toBe(true)
    expect(packageJson.files).toContain('skills')
    expect(packageJson.exports).toMatchObject({
      './assistant-skill-assets': {
        default: './dist/assistant-skill-assets.js',
        types: './dist/assistant-skill-assets.d.ts',
      },
    })
  })
})
