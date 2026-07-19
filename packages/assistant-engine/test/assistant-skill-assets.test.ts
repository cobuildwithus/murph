import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS,
} from '@murphai/hosted-execution/vault-share'

import {
  ASSISTANT_SKILLS,
  buildAssistantSkillFileRef,
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
  MURPH_ASSISTANT_SKILLS_ROOT_REF,
  resolveAssistantSkillsRoot,
  withAssistantSkillsRootEnv,
} from '../src/assistant-skill-assets.js'
import {
  MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH_ENV as skillEnvCliSurfaceArtifactPathEnv,
  MURPH_ASSISTANT_SKILLS_ROOT_ENV as skillEnvSkillsRootEnv,
} from '../src/assistant-skill-env.js'
import {
  ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE,
} from '../src/assistant/first-contact-welcome.js'
import {
  buildAssistantSystemPrompt,
} from '../src/assistant/system-prompt.js'

const DELETED_COMMONS_COMMANDS = [
  'vault-cli commons search',
  'vault-cli commons get',
  'vault-cli commons source list',
] as const

const RESEARCHED_HEALTH_TOPIC_SKILL_SLUGS = [
  'sleep-improvement',
  'circadian-rhythm',
  'energy-fatigue',
  'substance-load',
  'cognitive-focus',
  'hrv-resting-heart-rate',
  'aerobic-fitness',
  'recovery-modalities',
  'daily-activity',
  'mobility-posture',
  'cardiometabolic-health',
  'micronutrients-supplements',
  'body-composition',
  'cycle-hormonal-health',
  'gut-digestion',
  'general-eye-health',
] as const

type AssistantSkillMetadata = {
  readonly description: string
  readonly name: string
}

function expectRecord(
  value: unknown,
  label: string,
): asserts value is Record<string, unknown> {
  expect(value, `${label} must be an object`).toBeTruthy()
  expect(typeof value, `${label} must be an object`).toBe('object')
  expect(Array.isArray(value), `${label} must not be an array`).toBe(false)
}

function parseAssistantSkillFrontmatter(raw: string): AssistantSkillMetadata {
  const normalized = raw.replace(/\r\n/gu, '\n')
  if (!normalized.startsWith('---\n')) {
    throw new Error('SKILL.md must start with YAML frontmatter')
  }

  const frontmatterEnd = normalized.indexOf('\n---\n', 4)
  if (frontmatterEnd === -1) {
    throw new Error('SKILL.md must close YAML frontmatter')
  }

  const values = new Map<string, string>()
  let blockKey: string | null = null
  let blockStyle: 'folded' | 'literal' | null = null

  for (const line of normalized.slice(4, frontmatterEnd).split('\n')) {
    if (line.length === 0) {
      continue
    }

    if (/^\s/u.test(line)) {
      if (!blockKey || !blockStyle) {
        throw new Error(`Unexpected indented SKILL.md frontmatter line: ${line}`)
      }
      const current = values.get(blockKey) ?? ''
      const text = line.trim()
      values.set(
        blockKey,
        blockStyle === 'folded'
          ? [current, text].filter(Boolean).join(' ')
          : [current, text].filter(Boolean).join('\n'),
      )
      continue
    }

    blockKey = null
    blockStyle = null
    const match = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/u.exec(line)
    if (!match) {
      throw new Error(`Invalid SKILL.md frontmatter line: ${line}`)
    }

    const key = match[1]
    const value = match[2] ?? ''
    if (!key) {
      throw new Error(`Invalid SKILL.md frontmatter key: ${line}`)
    }

    if (/^[>|][+-]?$/u.test(value)) {
      blockKey = key
      blockStyle = value.startsWith('>') ? 'folded' : 'literal'
      values.set(key, '')
      continue
    }

    const trimmedValue = value.trim()
    const quoted =
      trimmedValue.startsWith('"') || trimmedValue.startsWith("'")
    if (!quoted && /:\s/u.test(trimmedValue)) {
      throw new Error(
        `Plain SKILL.md frontmatter scalar for ${key} contains ': '; use a quoted or folded scalar`,
      )
    }
    values.set(key, trimmedValue)
  }

  const name = values.get('name')?.trim()
  const description = values.get('description')?.trim()
  if (!name || !description) {
    throw new Error('SKILL.md frontmatter must include name and description')
  }

  return { description, name }
}

describe('assistant skill assets', () => {
  async function readSkillFile(skill: (typeof ASSISTANT_SKILLS)[number]) {
    return readFile(
      path.join(resolveAssistantSkillsRoot(), skill.slug, 'SKILL.md'),
      'utf8',
    )
  }

  function expectNoDeletedCommonsCommands(raw: string) {
    for (const deletedCommand of DELETED_COMMONS_COMMANDS) {
      expect(raw).not.toContain(deletedCommand)
    }
  }

  it('has a valid SKILL.md for every registered assistant skill', async () => {
    for (const skill of ASSISTANT_SKILLS) {
      const raw = await readSkillFile(skill)
      const metadata = parseAssistantSkillFrontmatter(raw)

      expect(metadata.name).toBe(skill.name)
      expect(metadata.description.length).toBeGreaterThan(0)
      expect(raw.length).toBeGreaterThan(0)
    }
  })

  it('keeps automation command selection in the shared developer prompt', async () => {
    const registeredSkillText = (
      await Promise.all(ASSISTANT_SKILLS.map(readSkillFile))
    ).join('\n')

    expect(registeredSkillText).not.toMatch(
      /(?:vault-cli\s+)?automation\s+(?:save|edit|set-status|import-json)\b/u,
    )
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

  it('registers researched health topic skills with stable file references', async () => {
    const registeredSkillSlugs: ReadonlySet<string> = new Set(
      ASSISTANT_SKILLS.map((skill) => skill.slug),
    )

    for (const slug of RESEARCHED_HEALTH_TOPIC_SKILL_SLUGS) {
      expect(registeredSkillSlugs.has(slug)).toBe(true)
      expect(buildAssistantSkillFileRef(slug)).toBe(
        `$MURPH_ASSISTANT_SKILLS_ROOT/${slug}/SKILL.md`,
      )

      const skill = ASSISTANT_SKILLS.find(
        (candidate) => candidate.slug === slug,
      )
      expect(skill).toBeTruthy()
      if (!skill) {
        continue
      }

      expect(skill.triggerHint.length).toBeGreaterThan(0)
      const raw = await readSkillFile(skill)
      expect(raw).toContain('Use this as Murph operating guidance')
      expect(raw).toContain('## Owns')
      expect(raw).toContain('## Hand Off')
      expect(raw).toContain('## Data First')
      expect(raw).toContain('## Answer Shape')
      expect(raw).not.toContain('MODEL_CONFIRMATION')
      expect(raw).not.toContain('RESEARCH_COMPLETE')
      expect(raw).not.toMatch(/^Skill \d+:/mu)
      expect(raw).not.toMatch(/^\+\d+\s*$/mu)
    }

    expect(registeredSkillSlugs.has('red-light-therapy')).toBe(true)
    expect(buildAssistantSkillFileRef('red-light-therapy')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/red-light-therapy/SKILL.md',
    )
  })

  it('routes bedtime transition, external disruption, and sleep-breathing concerns before skill loading', () => {
    const sleepSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'sleep-improvement',
    )
    expect(sleepSkill).toBeTruthy()
    if (!sleepSkill) {
      return
    }

    expect(sleepSkill.triggerHint).toContain('bedtime procrastination or getting-to-bed transition friction')
    expect(sleepSkill.triggerHint).toContain('sleep-environment disruption such as noise or vibration')
    expect(sleepSkill.triggerHint).toContain('high-altitude sleep disruption')
    expect(sleepSkill.triggerHint).toContain('dangerous daytime sleepiness')
    expect(sleepSkill.triggerHint).toContain('sleep-disordered breathing')
    expect(sleepSkill.triggerHint).toContain(
      'circadian-rhythm for body-clock, light-timing, jet-lag, shift-work, or clock-shifting plans',
    )
  })

  it('routes red light dose ownership to the dedicated red-light skill', async () => {
    const recoverySkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'recovery-modalities',
    )
    expect(recoverySkill).toBeTruthy()
    if (!recoverySkill) {
      return
    }

    expect(recoverySkill.triggerHint).toContain('Use red-light-therapy')
    expect(recoverySkill.triggerHint).not.toContain('device dosing')

    const recoveryText = await readSkillFile(recoverySkill)
    expect(recoveryText).toContain('Use red-light-therapy for red/NIR photobiomodulation dose')
    expect(recoveryText).toContain('does not own PBM device-dose math')
    expect(recoveryText).not.toContain('device-seeds.json')
  })

  it('keeps red light therapy registered with device seed data', async () => {
    const redLightSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'red-light-therapy',
    )
    expect(redLightSkill).toBeTruthy()
    if (!redLightSkill) {
      return
    }

    expect(redLightSkill.triggerHint).toContain('red light therapy')
    expect(redLightSkill.triggerHint).toContain('device irradiance')
    expect(buildAssistantSkillFileRef('red-light-therapy')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/red-light-therapy/SKILL.md',
    )

    const redLightText = await readSkillFile(redLightSkill)
    expect(redLightText).toContain('device-seeds.json')
    expect(redLightText).toContain('activeModeLabel')
    expect(redLightText).toContain('manufacturer-claim duration estimate')

    const deviceSeedsRaw = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        'red-light-therapy',
        'device-seeds.json',
      ),
      'utf8',
    )
    const deviceSeeds: unknown = JSON.parse(deviceSeedsRaw)
    expectRecord(deviceSeeds, 'red-light device seeds')
    expect(deviceSeeds.schemaVersion).toBe(
      'murph.assistant.skill.red-light-device-seeds.v1',
    )
    const devices = deviceSeeds.devices
    expect(Array.isArray(devices)).toBe(true)
    if (!Array.isArray(devices)) {
      return
    }
    expect(devices.length).toBeGreaterThan(0)
  })

  it('routes general eye health with evidence and contact-lens safety boundaries', async () => {
    const eyeSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'general-eye-health',
    )
    expect(eyeSkill).toBeTruthy()
    if (!eyeSkill) {
      return
    }

    expect(eyeSkill.triggerHint).toContain('digital eye strain')
    expect(eyeSkill.triggerHint).toContain('contact-lens comfort and safety')
    expect(buildAssistantSkillFileRef('general-eye-health')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/general-eye-health/SKILL.md',
    )

    const eyeSkillText = await readSkillFile(eyeSkill)
    expect(eyeSkillText).toContain('references/triage-and-contact-lenses.md')
    expect(eyeSkillText).toContain('references/evidence-register.md')
    expect(eyeSkillText).toContain(
      'For eye-exam timing, read both: the Decision Order owns the outcome and timing, while the evidence register supplies evidence only.',
    )
    expect(eyeSkillText).toContain('correction information, not an eye-health score')
    expect(eyeSkillText).toContain('optional memory cue, not a proven treatment dose')
    expect(eyeSkillText).toContain('Do not recommend blue-light-filtering glasses')
    expect(eyeSkillText).toContain(
      'Apply Prerequisite First Aid and then the Decision Order in `references/triage-and-contact-lenses.md` before selecting a care destination or any further action.',
    )
    expect(eyeSkillText).toContain(
      'Only when the Decision Order assigns `Brief self-care trial is reasonable`:',
    )
    expect(eyeSkillText).toContain('`Arrange a prompt eye exam`')
    expect(eyeSkillText).toContain('`Arrange a routine eye exam`')
    expect(eyeSkillText).toContain('`Prevention action only`')
    expect(eyeSkillText).not.toContain('safety pass is negative')
    expect(eyeSkillText).not.toContain('A contact-lens wearer with pain')
    expect(eyeSkillText).not.toContain('gradual, mild, in both eyes')
    expect(eyeSkillText).not.toContain('still hurts after removal')
    expect(eyeSkillText).not.toContain('pain that persists or worsens after removal')
    expect(eyeSkillText).not.toContain('usually in both eyes')
    expect(eyeSkillText).toContain('Stop the trial')
    expect(eyeSkillText).not.toContain('Stop the experiment')

    const [triageText, evidenceText] = await Promise.all([
      readFile(
        path.join(
          resolveAssistantSkillsRoot(),
          'general-eye-health',
          'references',
          'triage-and-contact-lenses.md',
        ),
        'utf8',
      ),
      readFile(
        path.join(
          resolveAssistantSkillsRoot(),
          'general-eye-health',
          'references',
          'evidence-register.md',
        ),
        'utf8',
      ),
    ])
    expect(triageText).toContain('### Emergency now')
    expect(triageText).toContain('### Prompt same-day eye care')
    const emergencyRule = triageText.slice(
      triageText.indexOf('### Emergency now'),
      triageText.indexOf('### Prompt same-day eye care'),
    )
    expect(emergencyRule).toContain(
      'Sudden severe or intense eye pain, even before another feature is known, including with a red eye, blurred vision, halos, nausea, or vomiting.',
    )
    const sameDayRule = triageText.slice(
      triageText.indexOf('### Prompt same-day eye care'),
      triageText.indexOf('### Arrange a prompt eye exam'),
    )
    expect(sameDayRule).toContain(
      'A significant direct blow or blunt impact to the eye, even when initial pain and vision seem normal',
    )
    expect(triageText).toContain('## Prerequisite First Aid')
    expect(triageText.indexOf('## Prerequisite First Aid')).toBeLessThan(
      triageText.indexOf('## Decision Order'),
    )
    expect(triageText).toContain(
      'Evaluate these outcomes from top to bottom, select exactly one, and stop at the first match.',
    )
    expect(triageText).toContain('### Arrange a prompt eye exam')
    expect(triageText).toContain('### Brief self-care trial is reasonable')
    expect(triageText).toContain('### Prevention action only')
    expect(triageText).toContain('### Arrange a routine eye exam')
    expect(triageText).toContain('### Ask one decision-changing question')
    expect(triageText).toContain(
      'If no earlier outcome matches, self-care is reasonable',
    )
    const prerequisiteFirstAid = triageText.slice(
      triageText.indexOf('## Prerequisite First Aid'),
      triageText.indexOf('## Decision Order'),
    )
    expect(prerequisiteFirstAid).toContain(
      'apply the first applicable rule below from top to bottom',
    )
    expect(prerequisiteFirstAid.indexOf('For a suspected penetrating')).toBeLessThan(
      prerequisiteFirstAid.indexOf(
        'For a corrosive, industrial, or unknown chemical exposure',
      ),
    )
    expect(prerequisiteFirstAid).toContain(
      'For a corrosive, industrial, or unknown chemical exposure, start copious gentle irrigation',
    )
    expect(prerequisiteFirstAid).toContain(
      'Remove contacts only if easy and without pausing or delaying irrigation.',
    )
    expect(prerequisiteFirstAid).toContain(
      'Do not manipulate or remove a contact lens.',
    )
    expect(prerequisiteFirstAid).toContain(
      'any new vision change, marked tearing, discharge, irritation, or a foreign-body sensation, remove the lens or lenses immediately',
    )
    expect(prerequisiteFirstAid).toContain(
      'Otherwise, if water contacts lenses, remove them as soon as possible.',
    )
    expect(triageText).toContain(
      'Otherwise, for a known mild irritant or loose superficial particle, rinse gently with clean lukewarm water.',
    )
    expect(triageText).toContain(
      'known mild irritant or loose superficial particle that fully resolves after thorough rinsing',
    )
    const promptExamRule = triageText.slice(
      triageText.indexOf('### Arrange a prompt eye exam'),
      triageText.indexOf('### Brief self-care trial is reasonable'),
    )
    expect(promptExamRule).toContain('Arrange the next available eye-care visit')
    expect(promptExamRule).toContain(
      'when a headache is persistent, recurring, worsening, function-limiting, or present away from near work',
    )
    expect(promptExamRule).toContain(
      'unless every condition in `Brief self-care trial is reasonable` is known to be met',
    )
    expect(promptExamRule).toContain(
      'missing eligibility facts do not default to self-care',
    )
    expect(promptExamRule).not.toContain(
      'Use a lower threshold for prompt clinician input',
    )
    expect(promptExamRule).not.toContain(' or medical eye visit')
    expect(triageText).toContain(
      'This may include a mild headache confined to near work that improves with rest.',
    )
    const preventionActionRule = triageText.slice(
      triageText.indexOf('### Prevention action only'),
      triageText.indexOf('### Arrange a routine eye exam'),
    )
    expect(preventionActionRule).toContain(
      'Do not invent a need for an eye exam.',
    )
    const routineExamRule = triageText.slice(
      triageText.indexOf('### Arrange a routine eye exam'),
      triageText.indexOf('### Ask one decision-changing question'),
    )
    expect(routineExamRule).toContain(
      'known age, eye or medical risk, last-exam timing, or an established clinician schedule',
    )
    expect(routineExamRule).toContain(
      'Do not ask another question when the known inputs already determine the routine guidance.',
    )
    expect(routineExamRule).toContain(
      'If one missing input would change the timing, use `Ask one decision-changing question` instead.',
    )
    expect(routineExamRule).toContain(
      'recommend the next available visit of the resolved type',
    )
    expect(routineExamRule).not.toContain('next available routine eye exam')
    const examTypeResolver = triageText.slice(
      triageText.indexOf('## Exam Type Resolver'),
      triageText.indexOf('## Contact-Lens Action Rules'),
    )
    expect(examTypeResolver).toContain(
      'resolve one booking type before handing off to computer-use',
    )
    expect(examTypeResolver).toContain(
      'Follow a known clinician-specified exam or visit type.',
    )
    expect(examTypeResolver).toContain(
      'For active symptom evaluation or known eye or medical risk that requires risk-based screening or clinician-directed follow-up, use a medical eye visit.',
    )
    expect(examTypeResolver).toContain(
      'For asymptomatic general vision or prevention without that risk or direction, use a routine comprehensive eye or vision exam.',
    )
    expect(examTypeResolver).toContain(
      'For an active-symptom medical eye visit, mention current contact-lens wear in the booking reason but do not append a separate fit-review type.',
    )
    expect(examTypeResolver).toContain(
      'current contact-lens wear resolves to a routine comprehensive eye or vision exam with contact-lens evaluation as the single requested service.',
    )
    expect(examTypeResolver).not.toContain('Add a contact-lens-fit review')
    expect(examTypeResolver).not.toContain('fit or prescription is due')
    expect(examTypeResolver).toContain(
      'A past contact prescription by itself does not justify a contact-lens fitting for someone who no longer wears contacts.',
    )
    expect(examTypeResolver).toContain(
      'Do not select dilation or another procedure unless it is already directed.',
    )
    expect(triageText).toContain('new flashes of light')
    expect(triageText).toContain('a sudden increase in or many new floaters')
    const triageContactLensSameDayRule = triageText
      .split('\n')
      .find((line) => line.includes('A contact-lens wearer has pain;'))
    expect(triageContactLensSameDayRule).toContain(
      'has pain; redness; light sensitivity; any new vision change;',
    )
    expect(triageContactLensSameDayRule).not.toContain('marked redness')
    expect(triageText).toContain(
      'A contact-lens wearer with redness or a new vision change is not eligible for this pathway',
    )
    expect(triageText).toContain(
      'When a contact-lens wearer is assigned `Prompt same-day eye care`, the matching prerequisite removes the lenses;',
    )
    expect(triageText).toContain(
      'When the Decision Order assigns `Brief self-care trial is reasonable` for mild contact-lens dryness, do not wear the lenses again that day.',
    )
    expect(triageText).toContain(
      'if symptoms return, stop lens wear and apply the Decision Order again.',
    )
    expect(triageText).not.toContain(
      'if symptoms return, stop lens wear and arrange a contact-lens-fit exam',
    )
    expect(triageText).not.toContain(
      'For mild end-of-day dryness that fully resolves after removal',
    )
    expect(triageText).not.toContain(
      'or symptoms that persist after removal, do not reinsert',
    )
    expect(triageText).not.toContain('attend at least yearly contact-lens exams')
    expect(triageText).toContain(
      'mild, gradual, bilateral tired, dry, burning, gritty, or intermittently blurry symptoms',
    )
    expect(triageText).toContain(
      'improve with complete blinking, rest, or lens removal',
    )
    expect(triageText).not.toContain('pain that persists or worsens after removal')
    expect(triageText).toContain('mild, gradual, bilateral')
    expect(triageText).not.toContain('usually bilateral')
    expect(triageText).toContain(
      'new flashes, a sudden increase in or many new floaters',
    )
    expect(triageText).toContain(
      'Stable, longstanding occasional floaters do not meet this rule by themselves.',
    )
    expect(triageText).toContain(
      'https://www.cdc.gov/contact-lenses/causes/index.html',
    )
    expect(evidenceText).toContain('The exact `20-20-20` formula has limited evidence')
    expect(evidenceText).toContain(
      'Do not assign exam timing or type outside that outcome.',
    )
    expect(evidenceText).toContain(
      'https://www.cochrane.org/evidence/CD013244_blue-light-filtering-spectacle-lenses-visual-performance-macular-back-part-eye-protection-and',
    )

    const systemPrompt = buildAssistantSystemPrompt({
      assistantCliContract: null,
      assistantContextSnapshotPrompt: null,
      assistantHostedDeviceConnectAvailable: false,
      assistantHostedDeviceConnectProviders: [],
      assistantKnowledgeToolsAvailable: false,
      channel: 'local',
      cliAccess: {
        rawCommand: 'vault-cli',
        setupCommand: 'murph',
      },
      currentLocalDate: '2026-07-10',
      currentTimeZone: 'America/New_York',
      onboardingGuidance: false,
      modelBehaviorProfile: 'gpt5-agentic',
      turnTrigger: null,
    })
    expect(systemPrompt).toContain(
      'Eye health: general-eye-health for screen-linked discomfort, contact-lens safety, refractive questions, prevention, and symptom triage.',
    )
    expect(systemPrompt).toContain(
      'Route any active eye pain, redness, light sensitivity, discharge, vision change, flashes, floaters, injury, or chemical exposure to general-eye-health first',
    )
    expect(systemPrompt).toContain(
      'Load secondary skills only after establishing the care level and immediate action.',
    )
  })

  it('keeps umbrella skills from duplicating focused health topic owners', async () => {
    const sleepSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'sleep-recovery-readiness',
    )
    expect(sleepSkill).toBeTruthy()
    if (!sleepSkill) {
      return
    }

    expect(sleepSkill.triggerHint).toContain(
      'Use when the user needs an acute readiness decision',
    )
    expect(sleepSkill.triggerHint).toContain(
      'Use sleep-improvement for sleep mechanics',
    )
    expect(sleepSkill.triggerHint).toContain(
      'circadian-rhythm for clock timing',
    )
    expect(sleepSkill.triggerHint).toContain(
      'hrv-resting-heart-rate for HRV/RHR interpretation',
    )
    expect(sleepSkill.triggerHint).toContain(
      'energy-fatigue for persistent tiredness',
    )
    expect(sleepSkill.triggerHint).not.toContain('sleep routines')
    expect(sleepSkill.triggerHint).not.toContain('shift work')
    expect(sleepSkill.triggerHint).not.toContain('travel or jet lag')
    expect(sleepSkill.triggerHint).not.toContain('wearable sleep')

    const sleepText = await readSkillFile(sleepSkill)
    expect(sleepText).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/sleep-improvement/SKILL.md',
    )
    expect(sleepText).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/circadian-rhythm/SKILL.md',
    )
    expect(sleepText).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/hrv-resting-heart-rate/SKILL.md',
    )
    expect(sleepText).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/energy-fatigue/SKILL.md',
    )
    expect(sleepText).not.toContain('### 2. Sleep routine improvement')
    expect(sleepText).not.toContain('### 4. Wearable trend interpretation')

    const nutritionSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'nutrition-strategy',
    )
    expect(nutritionSkill).toBeTruthy()
    if (!nutritionSkill) {
      return
    }

    expect(nutritionSkill.triggerHint).toContain(
      'meal structure and protein',
    )
    expect(nutritionSkill.triggerHint).toContain(
      'real-life food-system execution',
    )
    expect(nutritionSkill.triggerHint).toContain(
      'body-composition for fat loss/muscle gain/recomposition',
    )
    expect(nutritionSkill.triggerHint).toContain(
      'gut-digestion for digestive symptom strategy',
    )
    expect(nutritionSkill.triggerHint).not.toContain('GI comfort')
    expect(nutritionSkill.triggerHint).not.toContain(
      'body composition, training fuel',
    )

    const nutritionText = await readSkillFile(nutritionSkill)
    expect(nutritionText).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/body-composition/SKILL.md',
    )
    expect(nutritionText).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/gut-digestion/SKILL.md',
    )
    expect(nutritionText).not.toContain('### Body composition')
    expect(nutritionText).not.toContain('### GI comfort and performance')
  })

  it('keeps group newsletter setup and opt-out behavior in the group-chat skill', async () => {
    const groupChatSkill = ASSISTANT_SKILLS.find((skill) => skill.slug === 'group-chat')
    expect(groupChatSkill).toBeTruthy()
    if (!groupChatSkill) return

    const raw = await readSkillFile(groupChatSkill)
    expect(raw).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/group-newsletter/SKILL.md')
    expect(raw).toContain('do not create it immediately with invented')
    expect(raw).toContain('group wants to call it')
    expect(raw).toContain('newsletter reaction-share scope')
    expect(raw).toMatch(/sleep\s+duration/u)
    expect(raw).toContain('workout summaries, resting heart rate, and HRV')
    expect(raw).toMatch(/Let\s+the group widen/u)
    expect(raw).toContain('existing group\'s non-blank\n`displayName`')
    expect(raw).toContain('before inventing a')
    expect(raw).toContain('generic default')
    expect(raw).toMatch(/pass that same chosen name\s+as `displayName`/)
    expect(raw).toContain('`murph.group action="post_join_offer"`')
    expect(raw).toContain('`murph.group action="create_join_link"`')
    expect(raw).toContain('## Creating a hosted group')
    expect(raw).toContain('Before any permission-bearing `create_join_link` or `post_join_offer`, call')
    expect(raw).toContain('Only when it returns `status="none"`')
    expect(raw).toMatch(/one reusable core\s+set/u)
    expect(raw).toMatch(
      /`group-email\.v0`[\s\S]*`steps-days\.v0`[\s\S]*`activity-days\.v0`[\s\S]*`workout-days\.v0`[\s\S]*`sleep-duration-days\.v0`[\s\S]*`sleep-times\.v0`[\s\S]*`resting-heart-rate-days\.v0`[\s\S]*`hrv-days\.v0`/u,
    )
    expect(raw).toContain('`requestedVaultShareProjectionScopes` on `create_join_link`')
    expect(raw).toContain('`projectionScopes` when creation uses `post_join_offer`')
    expect(raw).toContain('This is a permission\nrequest, not automatic sharing')
    expect(raw).toContain('every item stays individually\nselectable')
    expect(raw).toContain('an explicit request from the group creator for narrower')
    expect(raw).toContain("`group-email.v0` remains the server's standard new-group request")
    expect(raw).toMatch(/Do not request every available projection by\s+default/u)
    expect(raw).toContain('When `read_current` returns an existing group, do not add the core set')
    expect(raw).toContain('Use only the exact workflow or additive scopes needed')
    expect(raw).toMatch(
      /`read_current` can return `status="none"`[\s\S]*not that\s+someone must link an external workspace[\s\S]*those\s+actions create the hosted group record/u,
    )
    expect(raw).toContain('If the group wants the recurring update in the chat instead of email')
    expect(raw).toContain(
      "Create a new newsletter under the developer prompt's shared automation action",
    )
    expect(raw).toContain(
      "For changes or stopping, follow the developer prompt's shared automation",
    )
    expect(raw).not.toContain('the current group channel')
    expect(raw).toContain('`title`: the group\'s chosen name')
    expect(raw).toContain('require every email subject to start with that exact name')
    expect(raw).toContain('Future notification turns may not read this skill')
    expect(raw).toContain('`slug`: exactly `group-health-newsletter`')
    expect(raw).toContain('Any other slug will not be able to send')
    expect(raw).toContain('`schedule`: `{ "kind": "cron", "expression": "0 9 * * 0" }`')
    expect(raw).toContain('`continuityPolicy`: `fresh`')
    expect(raw).toMatch(
      /until\s+`murph\.automation` returns success[\s\S]*never\s+turn a failed action into a confirmation/u,
    )
    expect(raw).toContain('next natural cron occurrence')
    expect(raw).toContain('Never create an')
    expect(raw).toContain('never call `murph.newsletter` `send` right after')
    expect(raw).toContain('complete read-compose-send and notification')
    expect(raw).toContain('Do not duplicate or')
    expect(raw).toContain('action="revoke_own_email_share"')
    expect(raw).toContain('## Leaving a hosted group')
    expect(raw).toContain('private one-to-one conversation')
    expect(raw).toContain('`murph.group action="list_memberships"` first')
    expect(raw).toContain('exact nonempty')
    expect(raw).toContain('`membershipId` returned in that result')
    expect(raw).toContain('Never guess an id')
    expect(raw).toContain('do not create, reconstruct, or reveal a reusable join URL')
    expect(raw).not.toContain('temporarily unavailable')
    expect(raw).toContain('does not remove them from the iMessage chat')
    expect(raw).toContain('owner_cannot_leave')
    expect(raw).toContain('## Room style settings')
    expect(raw).toContain('shared room settings, not the visible sender\'s personal')
    expect(raw).toContain('`murph.personalization`')
    expect(raw).toContain('`murph.assistant_style`')
    expect(raw).toMatch(/does not restyle the\s+reply already running/u)
    expect(raw).toContain('Group email may')
    expect(raw).toContain('cannot change that style')
    expect(raw).toContain('group-email.v0')
    expect(raw).toContain('https://www.withmurph.ai/settings?addEmail=true')
    expect(raw).not.toContain('`/settings?addEmail=true`')
    expect(raw).not.toContain('nudge them in the group')
    expect(raw).toContain('post a permission offer scoped to')
    expect(raw).toContain('the Creating a hosted group core set\ntakes precedence when `read_current` returns `status="none"`')
    expect(raw).toContain('For an existing\ngroup, propose only the newsletter reaction-share scope')
    expect(raw).toContain('`group-email.v0`, `sleep-duration-days.v0`')
    expect(raw).not.toMatch(
      /post a permission offer scoped to[\s\S]{0,400}`sleep-times\.v0`/u,
    )
    expect(raw).toContain('`resting-heart-rate-days.v0`, and `hrv-days.v0`')
    expect(raw).toContain('Every permission offer must lead with "Like this message,"')
    expect(raw).not.toContain('lead with "react to this message')
    expect(raw).toContain('include `{{join_url}}` exactly once as the customize link')
    expect(raw).toContain('pass the group\'s')
    expect(raw).toContain('chosen name as `displayName` on the `post_join_offer` call')
    expect(raw).toContain('newsletter like-to-consent path')
    expect(raw).not.toContain('newsletter react-to-join path')
    expect(raw).toContain('Liking the message')
    expect(raw).toContain('adds the disclosed snapshot')
    expect(raw).toContain('disclosed snapshot')
    expect(raw).toMatch(/For\s+existing participants, call this permission opt-in/)
    expect(raw).toContain('Never silently')
    expect(raw).toContain('share health data that the message did not disclose')
    expect(raw).not.toContain('link-free offer')
    expect(raw).toContain('never repeatedly re-offer')
    expect(raw).toContain('## Additive permissions')
    expect(raw).toMatch(/default\s+to `murph\.group action="post_join_offer"`/)
    expect(raw).toContain('Do not tell existing members to join')
  })

  it('keeps the new-group contact handoff natural and reactive', async () => {
    const groupChatSkill = ASSISTANT_SKILLS.find((skill) => skill.slug === 'group-chat')
    expect(groupChatSkill).toBeTruthy()
    if (!groupChatSkill) return

    const raw = await readSkillFile(groupChatSkill)
    expect(raw).toContain('When the group tools are available')
    expect(raw).toContain('check the room once on your first reply')
    expect(raw).toContain('text you to get set up')
    expect(raw).toContain('Use your own words,\n  not a fixed script')
    expect(raw).toContain('Do not repeat the invitation unprompted')
    expect(raw).toContain('when someone new joins later')
    expect(raw).toContain('If\n  someone asks why they have not been added')
    expect(raw).not.toContain('their own Murph')
    expect(raw).not.toContain('the shape of "')
  })

  it('registers a dedicated group newsletter editorial skill', async () => {
    const newsletterSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'group-newsletter',
    )
    expect(newsletterSkill).toBeTruthy()
    if (!newsletterSkill) return

    expect(newsletterSkill.triggerHint).toContain(
      'every scheduled group-health-newsletter run',
    )
    const raw = await readSkillFile(newsletterSkill)
    expect(raw).toContain('## Compose each edition')
    expect(raw).toContain('Usually include 6–12 useful stats')
    expect(raw).toContain('Cross-person comparisons are welcome')
    expect(raw).toContain('currently eligible email recipients')
    expect(raw).toContain('Use only `members`')
    expect(raw).toContain('Never run another group')
    expect(raw).toContain('Never expose dashboard language')
    expect(raw).toContain('never as a daily or weekly exercise total')
    expect(raw).toMatch(/about 30 minutes of movement a\s+day/u)
    expect(raw).toContain('Keep them separate')
    expect(raw).toContain('Do not use `workout-count` to claim a weekly workout total')
    expect(raw).toContain('Do not claim a prior-week change')
    expect(raw).toContain('{"kind":"skip","privateSummary":"..."}')
    expect(raw).toContain('If `prepare`')
    expect(raw).not.toContain('vault-cli group weekly')
    expect(raw).not.toContain('Join the two results by exact `memberId`')
    expect(raw).toMatch(/do not compose or call\s+`send`/u)
    expect(raw).toContain('After any `send` result')
    expect(raw).toContain('do not retry `send` in the same turn')
    expect(raw).toContain('runtime owns delivery, retry, and')
    expect(raw).toContain('the trusted parent')
    expect(raw).toContain('owns the fixed group notice and Settings link')
    expect(raw).not.toContain('https://www.withmurph.ai/settings?addEmail=true')
    expect(raw).not.toContain('`/settings?addEmail=true`')
    expect(raw).toContain('### Example 1: close race')
    expect(raw).toContain('### Example 2: opted-in roast')
    expect(raw).not.toContain('### Example 3:')
    expect(raw).toContain('<Exact Group Name> — <specific hook>')
    expect(raw).not.toContain('286 active minutes')
    expect(raw).not.toContain('17 workouts')
    expect(raw).not.toContain('completed the most workouts')
    expect(raw).not.toContain('best total this month')
  })

  it('keeps group challenge guidance aligned with selectable scoring projections', async () => {
    const groupChallengeSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'group-challenge',
    )
    expect(groupChallengeSkill).toBeTruthy()
    if (!groupChallengeSkill) return

    const raw = await readSkillFile(groupChallengeSkill)
    for (const projectionKind of HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_KINDS) {
      if (projectionKind === 'group-email.v0') {
        continue
      }
      expect(raw).toContain(projectionKind)
    }
    expect(raw).toContain(HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND)
    expect(raw).toContain('"activityKind": "<alias>"')
    expect(raw).toContain('narrowest matching scope')
    expect(raw).toContain('unsupported instead of')
    expect(raw).toContain('vault-cli group shared --kind steps-days.v0')
    expect(raw).toContain('zero-selector\n   `action: "group_shared"`')
    expect(raw).toContain('automation-bound\n   projection')
    expect(raw).toContain('`<projection-kind>.activityKind.<alias>`')
    expect(raw).toContain('Never\n   pass selector scopes through `projectionKind`')
    expect(raw).toContain('`murph.group action="post_join_offer"` with only the challenge\'s share')
    expect(raw).toContain('the group-chat skill\'s Creating a\n   hosted group core set takes precedence')
    expect(raw).toContain('For an existing group, use')
    expect(raw).toMatch(/Existing\s+members like the server-owned message to opt into/)
    expect(raw).toContain('Do not tell the room to join again')
    expect(raw).not.toContain('Mint the join link with `murph.group`')
    expect(raw.replace(/\s+/gu, ' ')).toContain(
      "under the developer prompt's shared automation action rules",
    )
  })

  it('builds stable symbolic skill file references', () => {
    expect(MURPH_ASSISTANT_SKILLS_ROOT_REF).toBe('$MURPH_ASSISTANT_SKILLS_ROOT')
    expect(buildAssistantSkillFileRef('murph-onboarding')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/murph-onboarding/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('experiment-onboarding')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('behavior-followthrough')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/behavior-followthrough/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('competition-training')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/competition-training/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('strength-training')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/strength-training/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('running-cardio')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/running-cardio/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('stress-regulation')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/stress-regulation/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('appointment-scheduling')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/appointment-scheduling/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('computer-use')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/computer-use/SKILL.md',
    )
  })

  it('keeps hosted computer-use guidance on decision-bounded browser macro-steps and the health playbook', async () => {
    const computerUseSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'computer-use',
    )
    expect(computerUseSkill).toBeTruthy()
    if (!computerUseSkill) {
      return
    }

    const raw = await readSkillFile(computerUseSkill)
    const actPrimitive = raw.match(
      /## Act primitive\n(?<section>[\s\S]*?)\n## Browser control loop/u,
    )?.groups?.section ?? ''
    const browserControlLoop = raw.match(
      /## Browser control loop\n(?<section>[\s\S]*?)\n## Playwright control tactics/u,
    )?.groups?.section ?? ''
    const playbook = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        computerUseSkill.slug,
        'references',
        'health-browser-playbook.md',
      ),
      'utf8',
    )

    expect(computerUseSkill.triggerHint).toContain(
      'ordering contacts, supplements, OTC products, health equipment, groceries, or meals',
    )
    expect(raw).toContain('computer_act` is the browser execution primitive')
    expect(raw).toContain('runs bounded Playwright code against the current page')
    expect(actPrimitive).toMatch(/decision-bounded macro-step/iu)
    expect(actPrimitive).toMatch(/combine every\s+deterministic operation/iu)
    expect(actPrimitive).toMatch(/final verification/iu)
    expect(actPrimitive).toMatch(
      /ambiguous intent.*missing\s+data.*sensitive\s+input.*irreversible\s+confirmation.*unknown\s+transition.*timeout/isu,
    )
    expect(actPrimitive).toMatch(/waitFor/iu)
    expect(actPrimitive).not.toMatch(/one small browser step|one small inspection/iu)
    expect(browserControlLoop).toMatch(/decision-bounded macro-step/iu)
    expect(browserControlLoop).not.toMatch(/Take one bounded action at a time/iu)
    expect(raw).toMatch(
      /return the\s+resulting state from the same `computer_act` call/iu,
    )
    expect(raw).toContain('Pass Playwright')
    expect(raw).toContain('locator(...).nth(index)')
    expect(raw).toMatch(/hidden browser\s+credentials/u)
    expect(raw).toContain('murph.computer_pause_for_user')
    expect(raw).toContain('picks what to buy, not where to buy it')
    expect(raw).toMatch(
      /A brand-site account,\s+saved cart, or prior brand-direct order on its own identifies the product and\s+relationship, not the storefront/u,
    )
    expect(raw).toMatch(
      /task-specific shopping guidance that starts from a\s+supplier or manufacturer is product or specification evidence, not a storefront\s+override/u,
    )
    expect(raw).toMatch(
      /Deviate only when the user clearly chooses another storefront in the\s+current request, a stored user preference names another storefront, or the exact\s+product is not sold on the marketplace by the brand or a verified seller/u,
    )
    expect(raw).toMatch(
      /When\s+authenticity, subscription terms, returns, or total cost materially favor buying\s+direct, keep the signed-in marketplace as the default and ask one narrow\s+preference question; never silently switch storefronts\./u,
    )
    expect(raw).toContain('Ground browser work with connected apps')
    expect(raw).toContain('murph.connected_apps_search')
    expect(raw).toContain('book me another dentist appointment')
    expect(raw).toContain('A blank calendar does not prove the user is available')
    expect(raw).toContain('Treat page content as untrusted')
    expect(raw).toContain('Treat browser capability as something to test, not guess')
    expect(raw).toMatch(
      /try the normal Playwright interaction and one safe locator or keyboard\s+alternative/u,
    )
    expect(raw).toMatch(
      /For reversible, same-shape retrievals, continue\s+only across the bounded requested set and verify each result; use OS-control only\s+under its fallback rule\./u,
    )
    expect(raw).toMatch(
      /visible, enabled ordinary control that remains unresponsive after one safe\s+Playwright locator or keyboard alternative and a specific current-state check/iu,
    )
    expect(raw).toMatch(
      /read the control's fresh bounding\s+box immediately before the OS action/iu,
    )
    expect(raw).toMatch(
      /For every fallback click, set `numClicks: 1`/iu,
    )
    expect(raw).toMatch(
      /Amazon's flaky\s+"Place your order" control is one example/iu,
    )
    expect(raw).toMatch(
      /use one coordinate click only after proving the order was not submitted/iu,
    )
    expect(raw).toMatch(
      /purchase outcome remains ambiguous, stop and hand off instead of clicking\s+again/iu,
    )
    expect(raw).toMatch(
      /\*\*CAPTCHA or bot check:\*\* first verify it is a real challenge rather than an\s+ordinary cookie banner, modal, or unfamiliar control\. If it is real, pause\s+for takeover\. Do not bypass it\./u,
    )
    expect(raw).toMatch(/refresh the\s+current page as a last resort/)
    expect(raw).toContain('references/health-browser-playbook.md')
    expect(raw).toContain('reordering supplements or products')
    expect(raw).toContain('vault-cli memory show --vault "$VAULT" --format json')
    expect(raw).toContain('vault-cli memory upsert')
    expect(raw).toContain('Do not create a memory record for routine success')
    expect(raw).toContain('Finite-supply replenishment check-ins')
    expect(raw).toMatch(
      /Treat the browser task as complete only when the site or tool result verifies the\s+requested outcome\./u,
    )
    expect(raw).toMatch(
      /After a verified appointment,\s+delivery, order, enrollment, or submission, offer at most one adjacent step/u,
    )
    expect(raw).toContain('30-day supplement supply')
    expect(raw).toContain(
      "under the developer prompt's shared automation action rules",
    )
    expect(raw).not.toContain('the current conversation route when it is deliverable')
    expect(raw).toContain('Do not auto-reorder.')
    expect(raw).toContain(
      'Treat this check-in as the one\nadjacent next step',
    )
    expect(raw).toMatch(
      /vault-cli supplement save --started-on\s+<delivery-date>/u,
    )
    expect(raw).toContain(
      'If the delivery date is not reliable, do not invent one',
    )
    expect(raw).toContain(
      'Buying a supplement does not prove that it is effective, safe, or appropriate',
    )
    expect(raw).toContain(
      'Pause only when Murph is actually blocked: expired login, CAPTCHA',
    )
    expect(raw).toContain('call `computer_open`')
    expect(raw).toContain('supplies hidden mailbox proof and delivery context, selects the active awaiting')
    expect(raw).toContain('exact quoted phrase such as "place order"')
    expect(raw).toMatch(/ordinary\s+confirmations like "yes", "go\s+ahead", or "you're good" are enough/u)
    expect((playbook.match(/^### \d+\./gmu) ?? []).length).toBe(25)
    expect(playbook).toContain('Connected-app preflight for browser tasks')
    expect(playbook).toContain('another dentist appointment')
    expect(playbook).toContain('Order or reorder contact lenses')
    expect(playbook).toMatch(
      /Buy through the user's signed-in marketplace \(usually Amazon\) unless they\s+clearly chose another storefront in the current request, a stored user\s+preference names another storefront/u,
    )
    expect(playbook).toMatch(
      /A prior order does not choose the storefront on its own\.\s+Default to the signed-in marketplace \(usually Amazon\) even when the prior\s+order was placed on the brand's own site/u,
    )
    expect(playbook).toMatch(
      /When authenticity, returns,\s+subscription terms, or total cost materially favor buying direct, keep the\s+signed-in marketplace as the default and ask one narrow preference question\s+instead of silently switching storefronts/u,
    )
    expect(playbook).toContain('Make a first-time supplement purchase')
    expect(playbook).toContain('Order prepared meals or a meal-kit plan')
    expect(raw).not.toContain('CSS only')
    expect(raw).not.toContain('Use `computer_act` only for URL navigation')
    expect(raw).not.toContain('Pass one action per call')
    expect(raw).not.toContain('handoffPurpose="manual_browser_help"')
  })

  it('honors an explicit MURPH_ASSISTANT_SKILLS_ROOT process env override', () => {
    const original = process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]
    try {
      process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = '/opt/bundled/skills'
      expect(resolveAssistantSkillsRoot()).toBe('/opt/bundled/skills')

      // Blank overrides fall back to the module-relative package root.
      process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = '   '
      expect(resolveAssistantSkillsRoot()).toMatch(/assistant-engine/)
    } finally {
      if (original === undefined) {
        delete process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV]
      } else {
        process.env[MURPH_ASSISTANT_SKILLS_ROOT_ENV] = original
      }
    }
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

  it('keeps assistant prompt and skills on remaining Commons protocol commands', async () => {
    const systemPrompt = buildAssistantSystemPrompt({
      assistantCliContract: null,
      assistantContextSnapshotPrompt: null,
      assistantHostedDeviceConnectAvailable: false,
      assistantHostedDeviceConnectProviders: [],
      assistantKnowledgeToolsAvailable: false,
      channel: 'local',
      cliAccess: {
        rawCommand: 'vault-cli',
        setupCommand: 'murph',
      },
      currentLocalDate: '2026-06-05',
      currentTimeZone: 'America/New_York',
      onboardingGuidance: true,
      modelBehaviorProfile: 'gpt5-agentic',
      turnTrigger: null,
    })
    const skillTexts = await Promise.all(ASSISTANT_SKILLS.map(readSkillFile))
    const registeredSkillText = skillTexts.join('\n')

    expectNoDeletedCommonsCommands(systemPrompt)
    expectNoDeletedCommonsCommands(registeredSkillText)
    expect(systemPrompt).toContain(
      'vault-cli commons protocol explore <query> --format json',
    )
    expect(systemPrompt).toContain(
      'vault-cli commons protocol list --query <query> --format json',
    )
    expect(systemPrompt).toContain(
      'vault-cli commons protocol show <key-or-slug> --format json',
    )
    expect(registeredSkillText).toContain(
      'vault-cli commons protocol explore <query> --format json',
    )
    expect(registeredSkillText).toContain(
      'vault-cli commons protocol list --query <query> --format json',
    )
    expect(registeredSkillText).toContain(
      'vault-cli commons protocol show <key-or-slug> --format json',
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
    expect(experimentOnboardingSkill.triggerHint).toContain(
      'planned-session support reminders',
    )

    const raw = await readSkillFile(experimentOnboardingSkill)

    expect(raw).toContain(
      'Before asking any experiment onboarding question, perform a bounded vault-first evidence pass',
    )
    expect(raw).toContain('# First-session prep reminders')
    expect(raw).toContain('# Planned-session support reminders')
    expect(raw).toContain(
      'Prefer a context-backed suggestion the user can accept or edit',
    )
    expect(raw).toContain('vault-cli experiment start <slug>')
    expect(raw).toContain('vault-cli experiment edit <id>')
    expect(raw).toContain(
      "Follow the developer prompt's shared automation action rules for creation",
    )
    expect(raw).toContain(
      "For rescheduling, follow the developer prompt's shared automation action rules",
    )
    expect(raw).not.toContain('stable slug lets rescheduling update')
    expect(raw).not.toContain('Include the current route fields')
    expect(raw).not.toContain('--channel <channel>')
    expect(raw).toContain('first_session_start_at')
    expect(raw).toContain('first_session_prep_reminder_at')
    expect(raw).toContain('first_session_prep_automation_slug')
    expect(raw).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/behavior-followthrough/SKILL.md',
    )
    expect(raw).toContain(
      'Use it only for the support loop; this skill still owns protocol resolution, safety, run creation, and experiment mechanics.',
    )
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

  it('keeps red light therapy registered with dose math and device seeds', async () => {
    const redLightSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'red-light-therapy',
    )
    expect(redLightSkill).toBeTruthy()
    if (!redLightSkill) {
      return
    }

    const skillText = await readSkillFile(redLightSkill)
    expect(redLightSkill.triggerHint).toContain('device irradiance')
    expect(skillText).toContain('seconds = target dose J/cm2 * 1000 / irradiance mW/cm2')
    expect(skillText).toContain('manufacturer-claim duration estimate')
    expect(skillText).toContain('matches the user\'s distance or contact setting')
    expect(skillText).toContain('activeModeLabel')
    expect(skillText).toContain('vault-cli commons protocol explore "red light therapy" --format json')
    expect(skillText).toContain('$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md')

    const raw = await readFile(
      path.join(
        resolveAssistantSkillsRoot(),
        redLightSkill.slug,
        'device-seeds.json',
      ),
      'utf8',
    )
    const parsed: unknown = JSON.parse(raw)
    expectRecord(parsed, 'red light device seed root')

    expect(parsed.schemaVersion).toBe(
      'murph.assistant.skill.red-light-device-seeds.v1',
    )
    expect(Array.isArray(parsed.sourcePolicy)).toBe(true)
    expect(JSON.stringify(parsed.sourcePolicy)).toContain(
      'manufacturer-claim examples',
    )
    expect(JSON.stringify(parsed.sourcePolicy)).toContain(
      'Do not extrapolate',
    )

    const devices = parsed.devices
    expect(Array.isArray(devices)).toBe(true)
    if (!Array.isArray(devices)) {
      return
    }
    expect(devices.length).toBeGreaterThanOrEqual(8)

    const aliases = new Set<string>()
    const models = new Set<string>()

    for (const [deviceIndex, deviceValue] of devices.entries()) {
      expectRecord(deviceValue, `device ${deviceIndex}`)
      expect(typeof deviceValue.brand).toBe('string')
      expect(typeof deviceValue.model).toBe('string')
      expect(typeof deviceValue.deviceClass).toBe('string')
      models.add(String(deviceValue.model))

      const deviceClass = deviceValue.deviceClass
      expect(['panel', 'contact_wrap', 'contact_mat']).toContain(deviceClass)

      expect(Array.isArray(deviceValue.aliases)).toBe(true)
      if (Array.isArray(deviceValue.aliases)) {
        for (const alias of deviceValue.aliases) {
          expect(typeof alias).toBe('string')
          expect(aliases.has(String(alias))).toBe(false)
          aliases.add(String(alias))
        }
      }

      expect(Array.isArray(deviceValue.wavelengthsNm)).toBe(true)
      if (Array.isArray(deviceValue.wavelengthsNm)) {
        for (const wavelength of deviceValue.wavelengthsNm) {
          expect(typeof wavelength).toBe('number')
          expect(wavelength).toBeGreaterThan(0)
        }
      }

      expect(Array.isArray(deviceValue.irradianceReadings)).toBe(true)
      if (!Array.isArray(deviceValue.irradianceReadings)) {
        continue
      }

      for (const [
        readingIndex,
        readingValue,
      ] of deviceValue.irradianceReadings.entries()) {
        expectRecord(
          readingValue,
          `device ${deviceIndex} reading ${readingIndex}`,
        )
        expect(readingValue.sourceType).toBe('manufacturer_claim')
        expect(String(readingValue.sourceUrl)).toMatch(
          /^https:\/\/www\.bestqool\.com\/products\//u,
        )
        expect(typeof readingValue.activeModeLabel).toBe('string')
        expect(String(readingValue.activeModeLabel).trim().length)
          .toBeGreaterThan(0)
        expect(typeof readingValue.distanceCm).toBe('number')
        expect(typeof readingValue.distanceLabel).toBe('string')
        expect(typeof readingValue.irradianceMwPerCm2).toBe('number')
        expect(Number(readingValue.irradianceMwPerCm2)).toBeGreaterThan(0)
        expect(typeof readingValue.measurementContext).toBe('string')

        if (deviceClass === 'panel') {
          expect(Number(readingValue.distanceCm)).toBeGreaterThan(0)
        } else {
          expect(readingValue.distanceCm).toBe(0)
          expect(String(readingValue.distanceLabel)).toContain('surface')
        }
      }
    }

    expect(models).toEqual(
      new Set([
        'BQ40',
        'BQ60',
        'BQ60Pro',
        'BQ150',
        'Pro100',
        'Pro200',
        'Pro300',
        'Redot S',
        'Redot M',
        'Redot L',
      ]),
    )
  })

  it('keeps behavior follow-through policy in the skill file with only compact bridges elsewhere', async () => {
    const behaviorSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'behavior-followthrough',
    )
    expect(behaviorSkill).toBeTruthy()
    if (!behaviorSkill) {
      return
    }

    expect(behaviorSkill.triggerHint).toContain('ignored reminders')
    expect(behaviorSkill.triggerHint).toContain('reminder fatigue')
    expect(behaviorSkill.triggerHint).toContain(
      'before scheduling recurring behavior support',
    )

    const stressSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'stress-regulation',
    )
    expect(stressSkill).toBeTruthy()
    if (!stressSkill) {
      return
    }

    const [raw, stressRaw] = await Promise.all([
      readSkillFile(behaviorSkill),
      readSkillFile(stressSkill),
    ])
    const compact = raw.replace(/\s+/gu, ' ')

    expect(raw).toContain(
      'This skill is a lightweight policy layer over existing Murph surfaces.',
    )
    expect(raw).toContain(
      'It should not create a new habit engine, psychology profile, scoring model, or persistence system.',
    )
    expect(raw).toContain('### Grounding gate before a durable loop')
    expect(compact).toContain(
      'For a repeated-behavior support loop Murph is helping design, satisfy the grounding gate below before scheduling or continuing support.',
    )
    expect(compact).toContain(
      'target behavior, tiny version, anchor, and repair policy are enough only to discuss or take a one-time action.',
    )
    expect(compact).toContain(
      'An exact user-directed recurring reminder or check-in whose action and timing are already specified may be created under the normal automation, safety, and authorization rules.',
    )
    expect(compact).toContain(
      'Do not ask for motivation, baseline, or prior attempts unless one would materially change that requested automation.',
    )
    expect(compact).toContain(
      'For Murph-designed habit regimens, experiment support loops, recurring reminders, or other durable behavior support, first understand enough of the user\'s actual situation to choose well',
    )
    expect(compact).toContain(
      'the desired outcome and why it matters, in the user\'s words',
    )
    expect(compact).toContain(
      'Never infer a “self-evident” reason from the outcome itself.',
    )
    expect(compact).toContain(
      'the user selected this outcome as what they want to work on now, or explicitly asked for help with it',
    )
    expect(compact).toContain(
      'a generic request to continue onboarding is not selection',
    )
    expect(compact).toContain(
      'the user chooses the thread before Murph asks its baseline, obstacle, prior-attempt, or support-fit questions',
    )
    expect(compact).toContain(
      'relevant existing records, connected data, logs, labs, or active plans that could change the behavior or its timing',
    )
    expect(compact).toContain(
      'the user\'s current behavior, routine, and practical baseline',
    )
    expect(compact).toContain(
      'what they have already tried and what happened',
    )
    expect(compact).toContain(
      'If decision-changing evidence is still being parsed or saved in the background',
    )
    expect(raw).toContain('### 1. Ground the outcome and current pattern')
    expect(compact).toContain(
      'A bare outcome by itself is not enough to activate a durable support loop.',
    )
    expect(compact).toContain(
      'make the value, schedule, and support concrete before any writes',
    )
    expect(compact).toContain(
      'A vague promise to "remind you" is not enough.',
    )
    expect(compact).toContain(
      'two or three short sentences and one easy question',
    )
    expect(compact).toContain(
      'Use one editable recommendation rather than a menu.',
    )
    expect(compact).toContain(
      "If Murph's visible contribution is no better than a generic phone reminder, the loop is underspecified",
    )
    expect(compact).toContain(
      'recommend one best-fit support pattern rather than presenting a menu',
    )
    expect(raw).not.toContain('Offer it as a menu the user picks from')
    expect(raw).toContain('### 7. Mark the first launch')
    expect(compact).toContain(
      'The launch close is not a movement-instruction turn.',
    )
    expect(compact).toContain(
      'do not attach exercise-catalog images, cards, or carousels',
    )
    expect(compact).toContain(
      'one original 15–20 second standalone launch song',
    )
    expect(compact).toContain(
      'This is reply-time media, never a scheduled onboarding automation.',
    )
    expect(compact).toContain(
      'Delight marks real value; it never substitutes for the launch offer, working support, or mandatory text close.',
    )
    expect(compact).toContain(
      'When `murph-onboarding` returns to a parked desired outcome after the health foundation, follow that owner\'s exact bounded behavioral-fit sequence, question budget, early-stop rule, and persistence policy.',
    )
    expect(compact).toContain(
      'Do not add or repeat a second motivation interview here.',
    )
    expect(raw).toContain(
      'A tiny version counts only when partial completion is safe and preserves the intent.',
    )
    expect(raw).toContain(
      'When a scheduled support automation fires, choose one structured outcome: `skip` or `send_message`.',
    )
    expect(raw).toContain(
      'Default to private/minimal support when shared-channel permission is unclear.',
    )
    expect(raw).toContain(
      'A future notification turn may not read this skill, so include the compact support loop directly in the automation instructions.',
    )
    expect(compact).toContain(
      'A reminder is a cue. An accountability check-in is a separate, later action whose job is to learn the outcome, not repeat the cue.',
    )
    expect(compact).toContain(
      'A direct request to check back later authorizes that exact check-in.',
    )
    expect(compact).toContain(
      'A request such as "remind me" or "remind me every other day" authorizes the cue only.',
    )
    expect(compact).toContain(
      'Otherwise create the check-in only after a clear yes to that exact bounded offer.',
    )
    expect(compact).toContain(
      'Unavailable, delayed, stale, or missing data is `unknown`, not `missed`.',
    )
    expect(compact).toContain(
      'A plan, reminder, automation record, statement of intent, or unrelated recent activity is not completion evidence.',
    )
    expect(compact).toContain(
      'Create both only when the user requested or accepted both; a check-in-only request does not authorize an extra cue.',
    )
    expect(compact).toContain(
      'Scheduled turns can skip or send their own occurrence; they do not create or mutate future automations.',
    )
    expect(compact).toContain(
      'Read the latest relevant conversation for a completion report, correction, cancellation, reschedule, or changed plan.',
    )
    expect(compact).toContain(
      "Match the behavior and action window using event time in the user's timezone; an ingestion or sync timestamp does not prove when the behavior happened.",
    )
    expect(compact).toContain(
      'Return `skip`; do not ask the user to confirm it again.',
    )
    expect(compact).toContain(
      'Return `skip`; do not ask whether it happened or piggyback a repair onto this check-in.',
    )
    expect(compact).toContain(
      'Ask one neutral, easy-to-answer question. Never state or imply that the user failed',
    )
    expect(compact).toContain(
      'Silence after that check-in does not authorize another same-occurrence follow-up.',
    )
    expect(compact).toContain('Prefer bounded support. Never create open-ended nag loops.')
    expect(raw).toContain('Count an ignored support attempt only when')
    expect(raw).toContain('When support is working, fade it instead of adding more.')
    expect(raw).toContain('Use `completed`, `partial`, `missed`, or `skipped` session status')
    expect(raw).toContain('For shared support, capture a share-safe label')
    expect(raw).toContain('Use novelty deliberately.')
    expect(raw).toContain('Playful accountability cannot become humiliation')
    expect(raw).toContain('If the user is ambivalent, do not schedule repeated support yet.')
    expect(raw).toContain(
      'When acute stress, overload, trouble winding down, or symptom fear is the immediate bottleneck, read `stress-regulation` first',
    )
    expect(raw).toContain(
      '`physical-therapy` owns the assessment and movement plan; this skill owns only the adherence/support layer around that plan.',
    )
    expect(stressRaw).toContain(
      'Route recurring follow-through work to `behavior-followthrough`.',
    )
    expect(stressRaw).toContain(
      'Hand off to `chronic-pain-support`, `chronic-illness-support`, `physical-therapy`, or appropriate medical care.',
    )
    expect(raw).not.toContain('/tmp/')
    expect(raw).not.toContain('.codex-hosted')
  })

  it('keeps strength training guidance in the package skill route', async () => {
    const strengthTrainingSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'strength-training',
    )
    expect(strengthTrainingSkill).toBeTruthy()
    if (!strengthTrainingSkill) {
      return
    }

    expect(strengthTrainingSkill.triggerHint).toContain(
      'strength or resistance training plans',
    )
    expect(strengthTrainingSkill.triggerHint).toContain(
      'Do not use for diagnosis, rehabilitation, medical clearance',
    )

    const raw = await readSkillFile(strengthTrainingSkill)

    expect(raw).toContain('# Strength Training')
    expect(raw).toContain('Load only what the task needs')
    expect(raw).toContain('references/programming.md')
    expect(raw).toContain('references/coaching.md')
    expect(raw).toContain('references/safety.md')
    expect(raw).toContain('references/evidence.md')
    expect(raw).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/shared/exercise-catalog-runtime.md',
    )
    expect(raw).toContain(
      'This skill still owns exercise choice, programming, dose, progression, substitutions, and safety.',
    )
    expect(raw).not.toContain('$murph-exercise-images')
    expect(raw).not.toContain('/tmp/')
    expect(raw).not.toContain('.codex-hosted')

    const referenceTexts = await Promise.all(
      ['coaching.md', 'evidence.md', 'programming.md', 'safety.md'].map(
        (referenceFile) =>
          readFile(
            path.join(
              resolveAssistantSkillsRoot(),
              strengthTrainingSkill.slug,
              'references',
              referenceFile,
            ),
            'utf8',
          ),
      ),
    )
    const referenceText = referenceTexts.join('\n')

    expect(referenceText).toContain(
      "Murph's available response-media or image support only if the current runtime exposes it",
    )
    expect(referenceText).not.toContain('$murph-exercise-images')
    expect(referenceText).not.toContain('exercise-image skill')
  })

  it('keeps exercise lookup and presentation in one shared domain reference', async () => {
    const skillBySlug = new Map(
      ASSISTANT_SKILLS.map((skill) => [skill.slug, skill] as const),
    )
    const physicalTherapy = skillBySlug.get('physical-therapy')
    const mobilityPosture = skillBySlug.get('mobility-posture')
    const strengthTraining = skillBySlug.get('strength-training')
    expect(physicalTherapy).toBeTruthy()
    expect(mobilityPosture).toBeTruthy()
    expect(strengthTraining).toBeTruthy()
    if (!physicalTherapy || !mobilityPosture || !strengthTraining) {
      return
    }

    const [catalog, physicalTherapyRaw, mobilityRaw, strengthRaw] =
      await Promise.all([
        readFile(
          path.join(
            resolveAssistantSkillsRoot(),
            'shared',
            'exercise-catalog-runtime.md',
          ),
          'utf8',
        ),
        readSkillFile(physicalTherapy),
        readSkillFile(mobilityPosture),
        readSkillFile(strengthTraining),
      ])

    const compactCatalog = catalog.replace(/\s+/gu, ' ')
    const sharedReference =
      '$MURPH_ASSISTANT_SKILLS_ROOT/shared/exercise-catalog-runtime.md'
    expect(physicalTherapyRaw).toContain(sharedReference)
    expect(mobilityRaw).toContain(sharedReference)
    expect(strengthRaw).toContain(sharedReference)
    expect(catalog).toContain('vault-cli exercise list ... --format json')
    expect(catalog).toContain(
      'vault-cli exercise show <id-or-slug>\n   --format json',
    )
    expect(compactCatalog).toContain(
      'Decide likely familiarity per movement from the current conversation and durable context.',
    )
    expect(compactCatalog).toContain(
      'Strong familiarity signals include stated experience in the relevant training modality, correct movement-specific language, prior logged performance, or a routine the user has already performed.',
    )
    expect(compactCatalog).toContain(
      'Let explicit modality experience cover common movements in that modality even when the user has not named them or used technical language',
    )
    expect(compactCatalog).toContain(
      'regular calisthenics, for example, is a familiarity signal for ordinary push-up and pull-up variations.',
    )
    expect(compactCatalog).toContain(
      'Treat stated novice status, expressed uncertainty about the movement, or no relevant experience signal as likely unfamiliar.',
    )
    expect(compactCatalog).toContain(
      'A first plan with Murph is not itself novice evidence.',
    )
    expect(compactCatalog).toContain(
      'Familiarity is still per movement: an experienced trainee can be new to an uncommon variation.',
    )
    expect(compactCatalog).toContain(
      'Do not ask a separate experience question only to decide whether to include media.',
    )
    expect(compactCatalog).toContain(
      'normally two to four and rarely more than five',
    )
    expect(compactCatalog).toContain(
      'Exercise media belongs only in a response that is actually teaching or cueing a movement',
    )
    expect(compactCatalog).toContain(
      'A setup-only activation turn, plan or save confirmation, reminder or review scheduling, and the first-launch close are not movement-instruction turns merely because the saved plan contains named exercises.',
    )
    expect(compactCatalog).toContain(
      'If any movement being taught is likely unfamiliar or uncommon, attach at least one useful returned catalog image and normally two in the same response.',
    )
    expect(compactCatalog).toContain(
      'If the user clearly demonstrates relevant training fluency and every movement being taught is common or already familiar, omit exercise images unless the user asks for them.',
    )
    expect(compactCatalog).toContain(
      'Use returned `images[]` with catalog URL, alt text, and source `exercise_catalog:<id>:<step>`.',
    )
    expect(compactCatalog).toContain('"no catalog image yet"')
    expect(catalog).toContain(
      'If acute pain or safety requires an immediate action, give the minimal plan\n   now',
    )
  })

  it('keeps supplement label identity, persistence, and evidence limits in its skill', async () => {
    const supplementSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'micronutrients-supplements',
    )
    expect(supplementSkill).toBeTruthy()
    if (!supplementSkill) {
      return
    }

    const raw = await readSkillFile(supplementSkill)

    expect(raw).toContain('vault-cli supplement search-labels`')
    expect(raw).toContain('vault-cli\nsupplement search-labels-batch`')
    expect(raw).toContain('preserve the full active ingredient panel')
    expect(raw).toContain('vault-cli supplement save --ingredient')
    expect(raw).toContain('save the\nlabel serving with `--serving-size`')
    expect(raw).toContain(
      'Treat contaminant observations as exact-product lab context only.',
    )
    expect(raw).toContain(
      'absence of an exact test is not proof that a product is clean or safe',
    )
    expect(raw).toContain(
      'A purchase is not proof that a supplement is effective, safe, medically appropriate, or authorized to start or change dose.',
    )
    expect(raw).toContain('vault-cli blood-test list --format json')
    expect(raw).toContain(
      'vault-cli blood-test show <id> --format json',
    )
    expect(raw).toContain(
      'When blood-test records exist, cite the latest relevant markers with dates',
    )
    expect(raw).toContain(
      'For supplements outside the list above (for example NAC, curcumin, ginger, berberine)',
    )
    expect(raw).toContain(
      'Name the personal evidence the classification rests on (latest panel date, current regimen, symptoms, goals).',
    )
  })

  it('keeps aspiration-anchored, foundation-complete Murph onboarding details in the skill file', async () => {
    const murphOnboardingSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'murph-onboarding',
    )
    expect(murphOnboardingSkill).toBeTruthy()
    if (!murphOnboardingSkill) {
      return
    }

    const raw = await readSkillFile(murphOnboardingSkill)
    const compact = raw.replace(/\s+/gu, ' ')

    expect(murphOnboardingSkill.triggerHint).toContain(
      'direct first-run Murph onboarding is open',
    )
    expect(murphOnboardingSkill.triggerHint).toContain(
      'broad private relationship',
    )
    expect(murphOnboardingSkill.triggerHint).toContain(
      'capture and park one or two',
    )
    expect(murphOnboardingSkill.triggerHint).toContain(
      'six progressive foundation-context checkpoints',
    )
    expect(murphOnboardingSkill.triggerHint).toContain(
      'return with context',
    )
    expect(murphOnboardingSkill.triggerHint).toContain(
      'answering a discovery question is not permission for a plan',
    )

    expect(raw).toContain(ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE)
    expect(raw).not.toContain('personal health assistant')
    expect(ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE).toContain(
      "Everyone's got something they want from their health",
    )
    expect(ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE).toContain(
      'stays private to you',
    )
    expect(ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE).toContain(
      'the more I learn, the better my help fits',
    )
    expect(compact).toContain(
      'Do not turn memory controls into opening copy or a required onboarding talking point.',
    )
    expect(raw).toContain(
      'vault-cli assistant onboarding resume-context --format json',
    )
    expect(compact).toContain(
      'Make one targeted owning read only on an ordinary interactive or inbound turn when the checkpoint needed now is omitted, truncated, or errored in the snapshot.',
    )
    expect(compact).toContain(
      'The managed scheduled follow-up performs no targeted CLI reads and uses only its parent-supplied snapshot.',
    )
    expect(raw).toContain('vault-cli memory show --format json')
    expect(compact).toContain('vault-cli blood-test list --format json')
    expect(compact).toContain(
      'Missing evidence is unresolved unless the visible conversation shows that the user said it was not relevant or explicitly skipped it.',
    )
    expect(raw).toContain('## The immediate need wins')
    expect(compact).toContain(
      'That request may answer one or more onboarding checkpoints, but it does not complete onboarding by itself.',
    )
    expect(raw).toContain('## Delegating onboarding work')
    expect(compact).toContain(
      'This skill explicitly invokes the global `Non-blocking delegation` contract; the user does not need to ask for a subagent separately.',
    )
    expect(compact).toContain(
      'Follow that contract for eligibility, durable parent ownership, tool boundaries, confirmation, and fallback.',
    )
    expect(compact).toContain(
      'Before any child starts, the parent must save the smallest truthful canonical fact or raw source and verify the receipt.',
    )
    expect(compact).toContain(
      'A child may enrich only the exact durable record ids or source refs returned by that save; it never owns a promised save or parse.',
    )
    expect(compact).toContain(
      'The medical-and-safety checkpoint is the one deliberate exception to this parent-first save rule: there the child owns the entire medical save, and the parent must not persist a medical answer in the foreground when a child can be spawned.',
    )
    expect(compact).toContain(
      'An optional child may outlive the reply; do not keep the root turn open solely to wait for it.',
    )
    expect(compact).toContain(
      "I've got my best man researching the exact ingredients.",
    )
    expect(compact).toContain(
      'Its spawn is not durable operation state: do not promise it will finish, and on later turns do not say enrichment is pending, processing, or in progress.',
    )
    expect(compact).toContain(
      'never expose internal subagent terminology, record ids, or save-status bookkeeping',
    )
    expect(compact).toContain(
      'Claim exact-label or structured child enrichment only after canonical readback confirms it.',
    )
    expect(compact).not.toContain('A spawn means the save is pending')
    expect(compact).not.toContain('describe the parse as in progress')
    expect(compact).not.toContain(
      'use one delegated child to save that single answer',
    )
    expect(raw).toContain('### 2. Minimal identity')
    expect(raw).toContain(
      'Also, how old are you—and are you a guy or a girl?',
    )
    expect(raw).not.toContain("Totally fine if you'd rather not say.")
    expect(compact).toContain(
      'casually ask their age and whether they are a guy or a girl',
    )
    expect(compact).toContain(
      'accept a different self-description without correcting or pressing them',
    )
    expect(raw).not.toContain('age and relevant sex or gender context')
    expect(raw).not.toContain("I'll only ask about sex or gender")
    expect(raw).not.toContain("what's your gender")
    expect(raw).not.toContain('how do you identify')
    expect(raw).not.toContain('avoid dumb assumptions')
    expect(compact).toContain(
      'Treat this bundled minimal-identity prompt as one onboarding question.',
    )
    expect(raw).toContain('If the user gives only a name, continue.')
    expect(raw).toContain(
      'What would you most like from your health—something you want to change, understand, handle, or be able to do?',
    )
    expect(compact).toContain(
      'start the same reply by greeting them by the name they just gave, then give a short two- or three-sentence bridge on how Murph works before the question',
    )
    expect(compact).toContain(
      "the hard part usually isn't knowing what to do. It's fitting it into your real life and following through.",
    )
    expect(compact).toContain(
      'Do not frame the bridge around getting healthy, as if the user is starting from unhealthy.',
    )
    expect(raw).toContain('**Change:**')
    expect(raw).toContain('**Understand:**')
    expect(raw).toContain('**Handle:**')
    expect(raw).toContain('**Explore:**')
    expect(raw).toContain('### 3. Find one or two aspiration anchors')
    expect(compact).toContain(
      'The broad anchor question does not consume the clarification budget. After it, ask up to three short clarifiers total, one per message.',
    )
    expect(compact).toContain(
      'If the user says they do not know, gives no reason, or declines, accept that answer without pressure or repetition and park the thread with motivation explicitly unknown.',
    )
    expect(compact).toContain('A list of desired outcomes is not a reason')
    expect(raw).toContain('1. What would success look or feel like?')
    expect(raw).toContain('2. Why do you want that?')
    expect(raw).not.toContain('Is this the main priority or one of several?')
    expect(compact).toContain(
      'When several threads are named, keep them all without asking the user to rank them.',
    )
    expect(compact).toContain(
      'Never dress it up in coaching language such as "what would that give you?" or "what matters most right now?".',
    )
    expect(compact).toContain(
      'Do not excavate obstacles or failed attempts, diagnose the problem, collect a baseline, or ask about schedule, equipment, treatment, or plan mechanics in this phase.',
    )
    expect(compact).toContain(
      'If the user accepts, treat figuring out where to focus as the open thread, learn the foundation, then return with a small contextual synthesis.',
    )
    expect(compact).toContain(
      'If they decline, do not press or make the foundation mandatory merely because they named no problem; follow the skip and overall-decline rules below.',
    )
    expect(raw).toContain('### 4. Reflect, save, and park the threads')
    expect(compact).toContain(
      'I\'m not going to jump into solving that yet. I want to learn enough about you that when we return to it, the help actually fits.',
    )
    expect(compact).toContain(
      'This park is not a diagnosis, recommendation, plan, habit, experiment, support loop, or invitation to activate a domain-planning skill.',
    )
    expect(compact).toContain(
      'do not add a separate “continue now or another day?” turn by default',
    )
    expect(raw).toContain('### 5. Resolve the foundation checkpoints')
    expect(raw).toContain('1. **Data sources and wearables.**')
    expect(raw).toContain('2. **Movement and training.**')
    expect(raw).toContain('3. **Current protocols or experiments.**')
    expect(compact).toContain(
      'Ask it plainly and stop; the value of the question is obvious, so do not append a justification',
    )
    expect(raw).not.toContain('Explain that this prevents duplicate or conflicting suggestions.')
    expect(raw).toContain('4. **Supplements.**')
    expect(raw).toContain('5. **Medical and safety context.**')
    expect(raw).toContain('6. **Recent blood tests or lab panels.**')
    expect(compact).toContain('Feel free to send me a voice memo.')
    expect(compact).toContain(
      'Send one message in this shape, adapting the lead-in wording but keeping the bulleted list and the explicit voice-memo ask',
    )
    expect(compact).toContain('Can you send me a voice memo covering a few things?')
    expect(compact).toContain(
      'spawn a separate background child for each: the medical-persistence child owns the entire medical save, and the supplement child owns label enrichment',
    )
    expect(compact).toContain(
      'Up to three may be active at once, as an explicit exception to the global one-at-a-time default',
    )
    expect(compact).toContain(
      "ok, one last question and then I'll leave you alone, promise",
    )
    expect(compact).not.toContain(
      'This is the default delight moment for one generated onboarding voice memo.',
    )
    expect(compact).toContain('a photo of bottles or labels is welcome if easier')
    expect(compact).toContain(
      '$MURPH_ASSISTANT_SKILLS_ROOT/micronutrients-supplements/SKILL.md',
    )
    expect(compact).toContain(
      'First use one compact parent batch to save each user-reported product identity, brand when supplied, and active status, and capture the returned canonical ids.',
    )
    expect(compact).toContain(
      'This intentionally minimal record is durable reported context, not a claim that the exact label or ingredient panel is known.',
    )
    expect(compact).toContain(
      'never recite bookkeeping such as "user-reported product names," "verified ingredient panel," or record status to the user',
    )
    expect(compact).toContain(
      'spawn one by default from those exact ids when a record is incomplete and exact-label enrichment can materially improve later help',
    )
    expect(compact).toContain(
      'Never persist the answer in the parent foreground.',
    )
    expect(compact).toContain(
      'always spawn a child from the user\'s exact words to own the entire medical persistence: every supported fact and negative clinical assertion across the named medical owners, schema-correct record shape, detail fields, and cross-owner consistency',
    )
    expect(compact).toContain(
      'This applies to every medical answer, including an all-negative one such as "no meds, no conditions."',
    )
    expect(compact).toContain(
      'Do not hold the visible reply for any medical saving or structuring; send the next checkpoint immediately after the spawn.',
    )
    expect(raw).not.toContain(
      'one compact parent batch across the named medical owners',
    )
    expect(compact).not.toContain(
      'Do not spawn a child for this bounded persistence work.',
    )
    expect(raw).toContain('https://my.functionhealth.com/documents')
    expect(compact).toContain(
      'download the Lab Results of Record PDFs, and send those files to Murph. Do not wait for them to ask how.',
    )
    expect(compact).toContain(
      'Naming the provider without supplying results does not start a parse child; wait for an actual PDF, paste, or other durable evidence.',
    )
    expect(compact).toContain(
      'the parent must first verify that the raw source already has a durable attachment, document, or import ref, or import it through an existing canonical surface before replying.',
    )
    expect(compact).toContain(
      'always spawn one from that exact source unless the source is already structured',
    )
    expect(compact).toContain(
      'Send the next visible onboarding step after the durable-source receipt instead of waiting for extraction.',
    )
    expect(compact).toContain(
      'A lab drop during onboarding is not a request for interpretation: do not parse the panel in the parent foreground merely to summarize it.',
    )
    expect(compact).toContain(
      'Keep the parse in the parent only when the user explicitly asks for an answer that needs it now or a safety concern requires it; then follow the global progress-update contract.',
    )
    expect(compact).toContain(
      'until canonical readback proves the extraction, do not state structured lab details as fact',
    )
    expect(compact).toContain(
      'Checkpoints, records, receipts, and open/resolved status are internal bookkeeping, never conversation copy.',
    )
    expect(raw).toContain(
      'Route useful answers to their existing canonical owner in the same turn',
    )
    expect(compact).toContain(
      'Save a durable request not to discuss a category as a Preferences memory in the user\'s words.',
    )
    expect(compact).toContain(
      'Do not create a fake health record or an opaque onboarding step marker merely to track coverage.',
    )
    expect(compact).toContain(
      '“not lifting right now” can resolve movement context; it does not authorize a workout routine.',
    )
    expect(raw).toContain('### 6. Return to an open thread and choose together')
    expect(compact).toContain(
      'After the foundation is resolved, close it warmly before asking for anything else.',
    )
    expect(compact).toContain(
      'Do not frame this as a completed intake, recite what was collected, or announce "we now have enough context."',
    )
    expect(compact).toContain(
      'hear a bit more about what Murph can do for them, or dive into the goals they named earlier, in their words',
    )
    expect(compact).toContain(
      'running health challenges and group chats with friends, ordering things on Amazon, calling to book appointments, singing songs, and tracking meals and calories',
    )
    expect(compact).toContain(
      'steer back to the goals they named and toward setting up the first habit or experiment below',
    )
    expect(compact).toContain(
      'create the first-value launch offer before any plan or support write.',
    )
    expect(compact).toContain(
      "follow `behavior-followthrough`'s launch-offer contract exactly",
    )
    expect(compact).toContain(
      'the compact launch offer contains the proposed schedule, actionable reminder package, and early review.',
    )
    expect(compact).toContain(
      "always follow `behavior-followthrough`'s first-launch delight rule",
    )
    expect(compact).toContain(
      'This is reply-time delight, not an onboarding automation',
    )
    const aspirationIndex = raw.indexOf('### 3. Find one or two aspiration anchors')
    const parkIndex = raw.indexOf('### 4. Reflect, save, and park the threads')
    const foundationIndex = raw.indexOf('### 5. Resolve the foundation checkpoints')
    const returnIndex = raw.indexOf('### 6. Return to an open thread and choose together')
    const completionIndex = raw.indexOf('## Completion')
    const replyRulesIndex = raw.indexOf('## Reply and follow-up rules')
    expect(aspirationIndex).toBeGreaterThan(-1)
    expect(parkIndex).toBeGreaterThan(aspirationIndex)
    expect(foundationIndex).toBeGreaterThan(parkIndex)
    expect(returnIndex).toBeGreaterThan(foundationIndex)
    expect(completionIndex).toBeGreaterThan(returnIndex)
    expect(replyRulesIndex).toBeGreaterThan(completionIndex)

    const aspirationSection = raw.slice(aspirationIndex, parkIndex)
    const returnSection = raw.slice(returnIndex, completionIndex)
    const completionSection = raw.slice(completionIndex, replyRulesIndex)
    expect(
      [...aspirationSection.matchAll(/^\d+\. (.+\?)$/gmu)]
        .map((match) => match[1]),
    ).toEqual([
      'What would success look or feel like?',
      'Why do you want that?',
    ])

    const behavioralFitQuestionList = returnSection
      .slice(
        returnSection.indexOf('Useful unanswered areas are:'),
        returnSection.indexOf('Do not ask why the outcome matters again'),
      )
    expect(behavioralFitQuestionList.match(/^- /gmu)).toHaveLength(3)
    expect(returnSection).toContain(
      'Ask up to three short questions across separate replies to fill only the\n' +
      'decision-changing gaps',
    )
    expect(returnSection).toContain(
      'If\nmotivation remains unknown or declined, collaborate only on a one-time first\nstep or leave the thread open; do not activate a Murph-designed durable loop.',
    )
    expect(completionSection.match(/^\d+\. /gmu)).toHaveLength(8)

    const immediateNeedSection = raw
      .slice(
        raw.indexOf('## The immediate need wins'),
        raw.indexOf('## Delegating onboarding work'),
      )
      .replace(/\s+/gu, ' ')
    const parkSection = raw
      .slice(parkIndex, foundationIndex)
      .replace(/\s+/gu, ' ')
    const persistenceSection = raw
      .slice(raw.indexOf('## Context persistence'), completionIndex)
      .replace(/\s+/gu, ' ')
    const compactCompletionSection = completionSection.replace(/\s+/gu, ' ')
    const onboardingDecisionScenarios = [
      {
        contract:
          '“I want to get stronger” after Murph asks what the user wants from their health is an aspiration to save and park.',
        section: immediateNeedSection,
        userMessage: 'I want to get stronger',
      },
      {
        contract:
          '“Can you make me a strength plan?” is an immediate request to handle.',
        section: immediateNeedSection,
        userMessage: 'Can you make me a strength plan?',
      },
      {
        contract:
          'If they ask to pause, leave onboarding open and let the existing managed onboarding follow-up automation own continuation.',
        section: parkSection,
        userMessage: 'Pause for now',
      },
      {
        contract: 'A simple “later” remains unresolved.',
        section: persistenceSection,
        userMessage: 'I can answer that later',
      },
      {
        contract:
          'Do not use `user_declined` for one skipped category',
        section: compactCompletionSection,
        userMessage: 'Skip supplements',
      },
      {
        contract:
          'If the user clearly declines onboarding or further setup as a whole, use `--reason user_declined`, verify completion, and do not ask another onboarding question.',
        section: compactCompletionSection,
        userMessage: 'I do not want to do onboarding',
      },
    ] as const

    for (const scenario of onboardingDecisionScenarios) {
      expect(
        scenario.section,
        `onboarding decision for: ${scenario.userMessage}`,
      ).toContain(scenario.contract)
    }
    expect(compact).toContain(
      'First make one bounded evidence pass across the foundation, relevant canonical records, connected data, and any confirmed enrichment that could materially change the choice.',
    )
    expect(compact).toContain(
      'Before asking baseline, obstacle, prior-attempt, or support questions, ask which thread—if any—the user actually wants to work on now.',
    )
    expect(compact).toContain(
      'A generic “let\'s continue” that only advances onboarding before this choice question is not consent to a Murph-selected health priority, deeper behavior discovery, or a plan.',
    )
    expect(compact).toContain(
      'Keep this thread-selection question separate from the bounded behavioral-fit questions below.',
    )
    expect(compact).toContain(
      'Ground the outcome and reason, the user\'s current behavior or routine, what existing data says, what they have already tried, and the main conditions that help or disrupt follow-through.',
    )
    expect(compact).toContain(
      'Ask up to three short questions across separate replies to fill only the decision-changing gaps',
    )
    expect(compact).toContain(
      'Do not create a habit regimen, reminder, experiment support loop, or other durable behavior-change setup until that grounding is sufficient',
    )
    expect(compact).toContain(
      'If the visible conversation shows a foundation question or answer after an aspiration, treat the reflect-and-park transition as already done.',
    )
    expect(compact).toContain(
      'This one post-park legacy-recovery question satisfies aspiration readiness for that already-open flow',
    )
    expect(compact).toContain(
      'Offer the foundation as an optional way to see where attention may be useful.',
    )
    expect(compact).toContain(
      'Do not infer or persist a psychology profile, personality trait, diagnosis, or hidden motivation.',
    )
    expect(compact).toContain(
      'the user chooses or adjusts what happens next',
    )
    expect(raw).toContain('## Completion')
    expect(raw).toContain(
      'The broad role, private default, and context-compounding value were delivered.',
    )
    expect(compact).toContain(
      'All six foundation checkpoints are answered from conversation or saved evidence, marked not relevant, or explicitly skipped.',
    )
    expect(compact).toContain(
      'A thread disclosed during discovery was reflected, saved when concrete, and explicitly parked before foundation collection.',
    )
    expect(compact).toContain(
      'Murph asked once for a missing reason a desired change matters; that reason is known from the user\'s own words or is explicitly unknown or declined.',
    )
    expect(compact).toContain(
      'Murph returned to an open thread with the relevant new context',
    )
    expect(compact).toContain(
      'The user chose which thread, if any, to work on now, then collaboratively chose a first step, explicitly chose to leave the thread open without acting, or declined further help on it.',
    )
    expect(compact).toContain(
      'An experiment, plan, support loop, wearable connection, lab upload, group, or specific positive health fact is not required.',
    )
    expect(compact).toContain(
      'do not require a plan or support loop merely to use `user_answered`',
    )
    expect(compact).toContain(
      'use one short messaging bubble, usually two to four short sentences',
    )
    expect(compact).toContain(
      '“Later,” “tomorrow,” or “I don\'t have it handy” leaves onboarding open.',
    )
    expect(raw).toContain(
      'vault-cli assistant onboarding complete --reason user_answered',
    )
    expect(raw).toContain('--reason user_declined')
    expect(compact).toContain(
      'Except for the bundled minimal-identity prompt and the foundation brain-dump memo above, ask at most one question per reply.',
    )
    expect(compact).toContain(
      'If the last onboarding question is still unanswered, do not send a different setup question.',
    )

    expect(raw).not.toContain('roughly 9-10 short assistant messages')
    expect(raw).not.toContain('### 4. Establish the first ongoing support loop')
    expect(raw).not.toContain('### 5. Bridge from value into foundation context')
    expect(raw).not.toContain('After first value and an agreed loop')
    expect(raw).not.toContain('## First-experiment outcome quality bar')
    expect(raw).not.toContain(
      'Do not mark onboarding complete until first experiment setup is resolved',
    )
    expect(raw).not.toContain(
      'two or three lightweight, bounded first-experiment options',
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
      './assistant-skill-env': {
        default: './dist/assistant-skill-env.js',
        types: './dist/assistant-skill-env.d.ts',
      },
    })
  })

  it('keeps the skill env-name contract dependency-free for hosted runtime boundaries', async () => {
    expect(skillEnvSkillsRootEnv).toBe('MURPH_ASSISTANT_SKILLS_ROOT')
    expect(skillEnvCliSurfaceArtifactPathEnv).toBe(
      'MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH',
    )

    const source = await readFile(
      new URL('../src/assistant-skill-env.ts', import.meta.url),
      'utf8',
    )
    expect(source).not.toMatch(/\bimport\b/u)
    expect(source).not.toContain('process')
    expect(source).not.toContain('node:')
  })
})
