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
    expect(conversationOnboardingSkill.triggerHint).toContain(
      'Use only when onboarding is eligible or open',
    )
    expect(conversationOnboardingSkill.triggerHint).toContain(
      'Do not read or follow this skill before handling concrete help',
    )
    expect(conversationOnboardingSkill.triggerHint).toContain(
      'Concrete help includes user questions, health data, attachments, PDFs, lab results',
    )

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
      'ask a natural optional question for age and gender context',
    )
    expect(raw).toContain('Do not use a fixed script for this turn')
    expect(raw).toContain(
      'age and gender can help Murph interpret health context',
    )
    expect(raw).toContain('make both fields optional')
    expect(raw).toContain(
      'ask for gender with a clear option such as "prefer not to say"',
    )
    expect(raw).toContain(
      'Do not turn this into a question about labels or phrasing',
    )
    expect(raw).not.toContain(
      'invite the user\'s own gender wording without choosing labels for them',
    )
    expect(raw).not.toContain('gender wording')
    expect(raw).toContain(
      'before the wearable/app checkpoint or more detailed protocol/supplement questions',
    )
    expect(raw).toContain(
      'before moving to current protocol or supplement questions',
    )
    expect(raw).toContain(
      'What should I call you? And is there anything health-wise you\'ve been curious about, working on, or dealing with lately?',
    )
    expect(raw).toContain(
      'whether they are already trying any health protocols or experiments',
    )
    expect(raw).toContain('mostly starting fresh')
    expect(raw).toContain(
      'invite product or brand names plus roughly how long they have taken each one or since when',
    )
    expect(raw).toContain(
      'When their supplement answer will require web searches or other product-ingredient lookups',
    )
    expect(raw).toContain(
      'call `send_progress_update` once before the first search or lookup',
    )
    expect(raw).toContain(
      'Do not use it for a quick memory save or a single follow-up question',
    )
    expect(raw).toContain(
      'Make clear that PDFs or pasted results are welcome whenever the user wants to share them',
    )
    expect(raw).toContain(
      'If the user sends lab PDFs, pasted lab results, or blood-test documents',
    )
    expect(raw).toContain(
      'call `send_progress_update` before reading the content or using file/import tools',
    )
    expect(raw).toContain('Save useful onboarding answers as they arrive')
    expect(raw).toContain(
      'before asking the next onboarding question',
    )
    expect(raw).toContain(
      'Do not wait until all setup prompts are done',
    )
    const nameContextIndex = raw.indexOf(
      '2. Name and context. After the welcome',
    )
    const highLevelIndex = raw.indexOf(
      'ask a natural optional question for age and gender context',
    )
    const wearableIndex = raw.indexOf(
      '4. Data sources and wearables. This is a required onboarding checkpoint',
    )
    const protocolsIndex = raw.indexOf(
      '6. Current protocols or experiments.',
    )
    const supplementsIndex = raw.indexOf(
      '7. Supplements.',
    )
    const bloodTestsIndex = raw.indexOf(
      '8. Blood tests.',
    )
    const orientationIndex = raw.indexOf('9. Orientation.')
    const firstExperimentIndex = raw.indexOf(
      '10. First experiment or logging decision.',
    )
    expect(nameContextIndex).toBeGreaterThanOrEqual(0)
    expect(highLevelIndex).toBeGreaterThanOrEqual(0)
    expect(highLevelIndex).toBeGreaterThan(nameContextIndex)
    expect(wearableIndex).toBeGreaterThan(highLevelIndex)
    expect(protocolsIndex).toBeGreaterThan(wearableIndex)
    expect(supplementsIndex).toBeGreaterThan(protocolsIndex)
    expect(bloodTestsIndex).toBeGreaterThan(supplementsIndex)
    expect(orientationIndex).toBeGreaterThan(bloodTestsIndex)
    expect(firstExperimentIndex).toBeGreaterThan(orientationIndex)
    expect(raw).toContain(
      'Do not mark onboarding complete until the first experiment or logging path is resolved',
    )
    expect(raw).toContain(
      'Ask one clear question that lets them choose: start the proposed experiment now, log for a few days first, or defer',
    )
    expect(raw).toContain(
      'A resolved first experiment or logging path means one of: an active first experiment was created through experiment onboarding, a simple logging habit was chosen, the user explicitly deferred or declined, or setup is blocked by a specific safety/logistics issue',
    )
    expect(raw).toContain(
      'read and follow `$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md` immediately',
    )
    expect(raw).toContain(
      'Do not settle for "text me workouts" as onboarding completion',
    )
    expect(raw).not.toContain(
      'Creating an active experiment remains a separate confirmed flow',
    )
    expect(raw).toContain(
      'whether they have recent blood tests or lab panels',
    )
    expect(raw).toContain(
      'PDFs or pasted results are welcome whenever the user wants to share them',
    )
    expect(raw).toContain('they can skip anything they do not want to share')
    expect(raw).toContain(
      'Do not press for skipped demographic details, birth date, birth month/year, or sex assigned at birth',
    )
    expect(raw.slice(nameContextIndex, highLevelIndex)).toContain('```text')
    expect(raw.slice(highLevelIndex, wearableIndex)).not.toContain('```text')
    expect(raw.slice(protocolsIndex, supplementsIndex)).not.toContain('```text')
    expect(raw.slice(supplementsIndex, bloodTestsIndex)).not.toContain('```text')
    expect(raw.slice(bloodTestsIndex, orientationIndex)).not.toContain('```text')
    expect(raw.match(/Do not use a fixed script for this turn/g)?.length).toBe(4)
    const removedFixedScripts = [
      'One high-level setup detail first: what age and gender should I use for context? You can skip either.',
      'Are you already trying any health protocols or experiments, or mostly starting fresh?',
      'Are you taking any supplements right now? Product or brand names help, plus roughly how long you\'ve taken each one or since when.',
      'Do you have any recent blood tests or lab panels, like Function Health or doctor-ordered tests? If you do, you can send the PDFs or copy/paste the results whenever you want.',
    ]
    for (const removedFixedScript of removedFixedScripts) {
      expect(raw).not.toContain(removedFixedScript)
    }
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
    expect(raw).toContain(
      'If a required canonical write fails, do not mark onboarding complete',
    )
    expect(raw).toContain('On a retry after a failed or interrupted save')
    expect(raw).toContain(
      'Inspect existing memory/goals or use the returned record ids from earlier writes',
    )
    expect(raw).toContain('write only the missing facts')
    expect(raw).toContain(
      'When the user clearly declines onboarding, mark onboarding complete with `vault-cli assistant onboarding complete --reason user_declined` without creating memory or goal records',
    )
    const rejectedPersistenceExpansions = [
      'narrowest matching `vault-cli` surface',
      'web lookup before saving an identifiable product',
      'vault-cli supplement save',
      'vault-cli regimen save',
      'vault-cli blood-test save',
      'vault-cli protocol import-json',
      'Completion may intentionally skip saving',
    ]
    for (const rejectedPersistenceExpansion of rejectedPersistenceExpansions) {
      expect(raw).not.toContain(rejectedPersistenceExpansion)
    }
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
