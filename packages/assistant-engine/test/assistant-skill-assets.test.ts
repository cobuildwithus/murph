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
import {
  ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
} from '../src/assistant/first-contact-welcome.js'

describe('assistant skill assets', () => {
  async function readSkillFile(skill: (typeof ASSISTANT_SKILLS)[number]) {
    return readFile(
      path.join(resolveAssistantSkillsRoot(), skill.slug, 'SKILL.md'),
      'utf8',
    )
  }

  it('has a valid SKILL.md for every registered assistant skill', async () => {
    for (const skill of ASSISTANT_SKILLS) {
      const raw = await readSkillFile(skill)

      expect(raw).toContain('---')
      expect(raw).toContain(`name: ${skill.name}`)
      expect(raw).toContain('description:')
      expect(raw.length).toBeGreaterThan(0)
    }
  })

  it('uses unique safe skill slugs and names', () => {
    const slugs = new Set<string>()
    const names = new Set<string>()

    for (const skill of ASSISTANT_SKILLS) {
      expect(skill.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(slugs.has(skill.slug)).toBe(false)
      expect(names.has(skill.name)).toBe(false)

      slugs.add(skill.slug)
      names.add(skill.name)
    }
  })

  it('builds stable symbolic skill file references', () => {
    expect(MURPH_ASSISTANT_SKILLS_ROOT_REF).toBe('$MURPH_ASSISTANT_SKILLS_ROOT')
    expect(buildAssistantSkillFileRef('conversation-onboarding')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/conversation-onboarding/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('experiment-onboarding')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md',
    )
  })

  it('uses the canonical package skill root in process env', () => {
    const fallback = withAssistantSkillsRootEnv({
      [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: '   ',
    })
    expect(fallback[MURPH_ASSISTANT_SKILLS_ROOT_ENV]).toBe(
      resolveAssistantSkillsRoot(),
    )

    const explicitRoot = path.join('custom', 'assistant-skills')
    const canonical = withAssistantSkillsRootEnv({
      [MURPH_ASSISTANT_SKILLS_ROOT_ENV]: explicitRoot,
    })
    expect(canonical[MURPH_ASSISTANT_SKILLS_ROOT_ENV]).toBe(
      resolveAssistantSkillsRoot(),
    )
  })

  it('keeps experiment onboarding details in the skill file, not the prompt', async () => {
    const experimentOnboardingSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'experiment-onboarding',
    )
    expect(experimentOnboardingSkill).toBeTruthy()
    if (!experimentOnboardingSkill) {
      return
    }

    const raw = await readSkillFile(experimentOnboardingSkill)

    expect(raw).toContain(
      'Before asking any experiment onboarding question, perform a bounded vault-first evidence pass',
    )
    expect(raw).toContain('# First-session prep reminders')
    expect(raw).toContain('Ask a direct, lightweight reminder setup question')
    expect(raw).toContain('vault-cli experiment start <slug>')
    expect(raw).toContain('vault-cli experiment edit <id>')
    expect(raw).toContain('vault-cli automation save <title>')
    expect(raw).toContain('first_session_start_at')
    expect(raw).toContain('first_session_prep_reminder_at')
    expect(raw).toContain('first_session_prep_automation_slug')
    expect(raw).toContain('analysisPlan.measurementAnchors')
    expect(raw).toContain('analysisPlan.plannedMeasurements')
    expect(raw).toContain(
      'planned follow-up windows to `analysisPlan.plannedMeasurements`',
    )
    expect(raw).toContain('commonsProtocolRef')
    expect(raw).toContain(
      'If no Murph product base URL is present, do not send an experiment page link or standalone `/experiments/<routeId>` route.',
    )
    expect(raw).not.toContain('/tmp/')
    expect(raw).not.toContain('.codex-hosted')
  })

  it('keeps conversation onboarding details in the skill file, not the prompt', async () => {
    const conversationOnboardingSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'conversation-onboarding',
    )
    expect(conversationOnboardingSkill).toBeTruthy()
    if (!conversationOnboardingSkill) {
      return
    }

    const raw = await readSkillFile(conversationOnboardingSkill)

    expect(raw).toContain(ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE)
    expect(raw).toContain(
      'Use this skill only when the current prompt includes the `Conversation onboarding:` activation',
    )
    expect(raw).toContain('roughly 7-8 short assistant messages')
    expect(raw).toContain(
      'age plus gender first, then the wearable/app checkpoint',
    )
    expect(raw).toContain('then current health protocols or experiments')
    expect(raw).toContain('then current supplements with brand or product names')
    expect(raw).toContain('roughly how long they have taken them or since when')
    expect(raw).toContain('age plus gender')
    expect(raw).toContain(
      'One high-level setup detail first: what age and gender should I use for context?',
    )
    expect(raw).toContain(
      'before the wearable/app checkpoint or more detailed protocol/supplement questions',
    )
    expect(raw).toContain(
      'before moving to current protocol or supplement questions',
    )
    expect(raw).toContain(
      'Are you taking any supplements right now? Product or brand names help, plus roughly how long you\'ve taken each one or since when.',
    )
    expect(raw).toContain(
      'Are you already trying any health protocols or experiments, or mostly starting fresh?',
    )
    expect(raw).toContain('Save useful onboarding answers as they arrive')
    expect(raw).toContain(
      'before asking the next onboarding question',
    )
    expect(raw).toContain(
      'Do not wait until all setup prompts are done',
    )
    const highLevelIndex = raw.indexOf(
      'One high-level setup detail first: what age and gender should I use for context?',
    )
    const wearableIndex = raw.indexOf(
      '4. Data sources and wearables. This is a required onboarding checkpoint',
    )
    const protocolsIndex = raw.indexOf(
      'Are you already trying any health protocols or experiments, or mostly starting fresh?',
    )
    const supplementsIndex = raw.indexOf(
      'Are you taking any supplements right now? Product or brand names help, plus roughly how long you\'ve taken each one or since when.',
    )
    const bloodTestsIndex = raw.indexOf(
      'Do you have any recent blood tests or lab panels',
    )
    expect(highLevelIndex).toBeGreaterThanOrEqual(0)
    expect(wearableIndex).toBeGreaterThan(highLevelIndex)
    expect(protocolsIndex).toBeGreaterThan(wearableIndex)
    expect(supplementsIndex).toBeGreaterThan(protocolsIndex)
    expect(bloodTestsIndex).toBeGreaterThan(supplementsIndex)
    expect(raw).toContain(
      'whether they have recent blood tests or lab panels',
    )
    expect(raw).toContain(
      'you can send the PDFs or copy/paste the results whenever you want',
    )
    expect(raw).toContain('they can skip anything they do not want to share')
    expect(raw).toContain(
      'Do not press for skipped demographic details, birth date, birth month/year, or sex assigned at birth',
    )
    expect(raw).not.toContain(
      'A few setup details are helpful if you\'re comfortable sharing',
    )
    expect(raw).toContain(
      'Ask follow-up questions about dosage only when the user asks to set up a specific experiment',
    )
    expect(raw).toContain(
      'Ask follow-up questions about protocol adherence only when the user asks to set up a specific experiment',
    )
    expect(raw).not.toContain('birth month plus year and gender')
    expect(raw).not.toContain('birth month plus year, gender')
    expect(raw).toContain(
      'If they send PDFs or pasted lab results, handle them through normal attachment/message intake',
    )
    expect(raw).toContain(
      'broad health context, supplements, protocols, experiments, dated age context, gender, or interests go to memory',
    )
    expect(raw).toContain(
      'supplement names and timing, current protocols or experiments',
    )
    expect(raw).toContain(
      'Age: save as dated Context memory using the current prompt\'s local date',
    )
    expect(raw).toContain('User was 20 years old on 2026-02-01.')
    expect(raw).toContain('Do not infer or store a birthday from age alone')
    expect(raw).toContain(
      'high-level age/gender prompt, wearable/app checkpoint, current protocol/experiment prompt, supplement prompt, and blood-test prompt have been asked',
    )
    expect(raw).toContain(
      'verify that every useful setup answer they supplied has already been persisted',
    )
    expect(raw).toContain(
      'complete a wearable/app checkpoint before first experiment or logging setup',
    )
    expect(raw).toContain('vault-cli device account list --format json')
    expect(raw).toContain('vault-cli device connect <provider> --format json')
    expect(raw).toContain(
      'Do not present Apple Health or HealthKit as supported yet or available via supported apps',
    )
    expect(raw).toContain('one lightweight, bounded experiment at a time')
    expect(raw).toContain('retrospective baseline')
    expect(raw).toContain(
      'Useful setup answers are persisted canonically when the user shared them',
    )
    expect(raw).toContain(
      'vault-cli memory upsert "<identity memory>" --section Identity --format json',
    )
    expect(raw).toContain(
      'vault-cli memory upsert "<context memory>" --section Context --format json',
    )
    expect(raw).toContain(
      'vault-cli goal save "<goal title>" --status active --horizon ongoing --format json',
    )
    expect(raw).toContain('add `--domain <domain>` only when a clear domain exists')
    expect(raw).toContain(
      'After required canonical memory/goal writes succeed, mark onboarding complete',
    )
    expect(raw).toContain('If a required canonical write fails, do not mark onboarding complete')
    expect(raw).toContain('On a retry after a failed or interrupted save')
    expect(raw).toContain(
      'Inspect existing memory/goals or use the returned record ids from earlier writes',
    )
    expect(raw).toContain('write only the missing facts')
    expect(raw).toContain(
      'When the user clearly declines onboarding, mark onboarding complete with `vault-cli assistant onboarding complete --reason user_declined` without creating memory or goal records',
    )
    expect(raw).not.toContain('/tmp/')
    expect(raw).not.toContain('.codex-hosted')
  })

  it('keeps route hints and SKILL.md descriptions under parser limits', async () => {
    for (const skill of ASSISTANT_SKILLS) {
      expect(skill.triggerHint.length).toBeLessThan(1024)

      const raw = await readSkillFile(skill)
      const frontmatter = raw.match(/^---\n(?<body>[\s\S]*?)\n---/u)
      expect(frontmatter?.groups?.body).toBeTruthy()

      const description = frontmatter?.groups?.body.match(
        /^description:\s*(?<description>.+)$/mu,
      )?.groups?.description

      expect(description).toBeTruthy()
      expect(description?.length).toBeLessThan(1024)
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
