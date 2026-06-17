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
    expect(buildAssistantSkillFileRef('murph-onboarding')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/murph-onboarding/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('experiment-onboarding')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md',
    )
    expect(buildAssistantSkillFileRef('behavior-followthrough')).toBe(
      '$MURPH_ASSISTANT_SKILLS_ROOT/behavior-followthrough/SKILL.md',
    )
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
    expect(raw).toContain('vault-cli automation save <title>')
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

    const raw = await readSkillFile(behaviorSkill)

    expect(raw).toContain(
      'This skill is a lightweight policy layer over existing Murph surfaces.',
    )
    expect(raw).toContain(
      'It should not create a new habit engine, psychology profile, scoring model, or persistence system.',
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
    expect(raw).toContain('Count an ignored support attempt only when')
    expect(raw).toContain('When support is working, fade it instead of adding more.')
    expect(raw).toContain('Use `completed`, `partial`, `missed`, or `skipped` session status')
    expect(raw).toContain('For shared support, capture a share-safe label')
    expect(raw).toContain('Use novelty deliberately.')
    expect(raw).toContain('Playful accountability cannot become humiliation')
    expect(raw).toContain('If the user is ambivalent, do not schedule repeated support yet.')
    expect(raw).not.toContain('/tmp/')
    expect(raw).not.toContain('.codex-hosted')
  })

  it('keeps Murph onboarding details in the skill file, not the prompt', async () => {
    const murphOnboardingSkill = ASSISTANT_SKILLS.find(
      (skill) => skill.slug === 'murph-onboarding',
    )
    expect(murphOnboardingSkill).toBeTruthy()
    if (!murphOnboardingSkill) {
      return
    }

    const raw = await readSkillFile(murphOnboardingSkill)
    expect(murphOnboardingSkill.triggerHint).toContain(
      'Use when Murph onboarding is open',
    )
    expect(murphOnboardingSkill.triggerHint).toContain(
      'the assistant needs the next unresolved onboarding step',
    )
    expect(murphOnboardingSkill.triggerHint).toContain(
      'when the user clearly declines/skips onboarding',
    )
    expect(murphOnboardingSkill.triggerHint).toContain(
      'mark onboarding complete with the declined reason',
    )
    expect(murphOnboardingSkill.triggerHint).toContain(
      'files, labs, supplement labels, wearable data, medications, meals, workouts, symptoms, or setup answers',
    )

    expect(raw).toContain(ASSISTANT_FIRST_CONTACT_WELCOME_MESSAGE)
    expect(raw).toContain(
      'Use this skill only when the current prompt includes the `Murph onboarding:` activation that says first-run Murph onboarding is open',
    )
    expect(raw).toContain('roughly 9-10 short assistant messages')
    expect(raw).toContain(
      'If the user has an immediate request, handle it first',
    )
    expect(raw).not.toContain('or have an immediate request')
    expect(raw).not.toContain('unless the user has an immediate request')
    expect(raw).toContain(
      'age plus gender first, then the wearable/app checkpoint',
    )
    expect(raw).toContain('then movement/training context')
    expect(raw).toContain('then current health protocols or experiments')
    expect(raw).toContain('then current supplements with brand or product names')
    expect(raw).toContain('roughly how long they have taken them or since when')
    expect(raw).toContain('then one open medical-context question')
    expect(raw).toContain('diagnosed conditions, allergies or intolerances, and pregnancy or nursing')
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
      'ask gender in plain language with wording like "are you a guy, girl, or prefer not to say?"',
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
      'text-only notes means no wearable/app is required, not that later onboarding answers must be typed',
    )
    expect(raw).toContain(
      'Do not let this suppress later voice memo or attachment options',
    )
    expect(raw).toContain(
      'What\'s your name? And is there anything health-wise you\'ve been curious about, working on, or dealing with lately?',
    )
    expect(raw).toContain(
      'If the exact welcome is visible in this same thread and the user\'s latest message is a short acceptance',
    )
    expect(raw).toContain('normal first-run continuation')
    expect(raw).toContain('no broad vault resume check is needed')
    expect(raw).toContain(
      'When onboarding is open but the visible thread does not show the welcome or prior onboarding steps, make one bounded vault resume check',
    )
    expect(raw).toContain(
      'vault-cli assistant onboarding resume-context --format json',
    )
    expect(raw).toContain(
      'Do not fan this resume check out into separate `memory show`, `goal list`, `regimen list`, `supplement list`, `condition list`, `allergy list`, `experiment list`, or `device account list` commands',
    )
    expect(raw).not.toContain(
      'When this thread shows no onboarding history, check the vault before asking anything',
    )
    expect(raw).toContain('## Required input affordances')
    expect(raw).toContain(
      'These are part of the one lightweight question, not extra questions',
    )
    expect(raw).toContain('Do not drop them for brevity')
    expect(raw).toContain(
      'current fitness level, activity, workout routine, and movement/training context',
    )
    expect(raw).toContain('rough, stream-of-consciousness context dump')
    expect(raw).toContain(
      'Include a short examples list to help the user answer',
    )
    expect(raw).toContain('keep the examples in list form, not one long paragraph')
    expect(raw).toContain('- usual weekly exercise rhythm')
    expect(raw).toContain('- classes, lifting, running, cardio, sports, or walking')
    expect(raw).toContain('- races or training blocks like a 5K, marathon, or triathlon')
    expect(raw).toContain(
      '- recent benchmarks like VO2 max, mile time, lifts, pace, or zones',
    )
    expect(raw).toContain(
      '- injuries, limitations, or anything they are trying to improve',
    )
    expect(raw).toContain(
      'Movement/training: ask one natural question, include the compact examples list',
    )
    expect(raw).toContain(
      'end the visible message with exactly: "Feel free to send me a voice memo."',
    )
    expect(raw).toContain('Follow the movement/training input affordance')
    expect(raw).not.toContain('A messy answer is perfect')
    expect(raw).not.toContain('typed or voice memo')
    expect(raw).not.toContain('messy typed list or a stream-of-consciousness voice memo')
    expect(raw).toContain(
      'If a voice memo or audio answer already has a transcript',
    )
    expect(raw).toContain(
      'use it directly',
    )
    expect(raw).toContain(
      'No progress update is needed solely because the answer arrived as automatically parsed audio',
    )
    expect(raw).not.toContain(
      'If the user sends a voice memo and the assistant will inspect, transcribe, summarize, or save it',
    )
    expect(raw).not.toContain(
      'call `send_progress_update` before reading the content or using file/transcription tools',
    )
    expect(raw).toContain(
      'Save useful movement/training context to Context memory',
    )
    expect(raw).toContain(
      'whether they are already trying any health protocols or experiments',
    )
    expect(raw).not.toContain('outside supplements')
    expect(raw).toContain('mostly starting fresh')
    expect(raw).toContain(
      'invite product or brand names plus roughly how long they have taken each one or since when',
    )
    expect(raw).not.toContain(
      'Current supplements: save each current product with',
    )
    expect(raw).toContain(
      'save every current supplement product through `vault-cli supplement save`',
    )
    expect(raw).toContain(
      "use the current prompt's local date as fallback `startedOn`",
    )
    expect(raw).toContain(
      'Supplements: mention that they can send a photo of supplement bottles or labels if that is easier',
    )
    expect(raw).toContain('Follow the supplement input affordance')
    expect(raw).toContain(
      'When their supplement answer will require ingredient lookup',
    )
    expect(raw).toContain(
      'call `send_progress_update` once before the first lookup',
    )
    expect(raw).toContain(
      'Default to `vault-cli supplement search-labels` for one supplement or `vault-cli supplement search-labels-batch` for several',
    )
    expect(raw).toContain(
      'For batch lookup, pass one repeated `--query` flag per product; do not pass product names as positional arguments',
    )
    expect(raw).toContain(
      'The label database covers many supplements but is not exhaustive',
    )
    expect(raw).toContain(
      'fall back to web search for products or ingredients it misses',
    )
    expect(raw).toContain(
      'Do not use a progress update for a quick memory save or a single follow-up question',
    )
    expect(raw).toContain(
      'After lookup when useful, save every current supplement product through `vault-cli supplement save`',
    )
    expect(raw).toContain(
      'ask one short follow-up for duration or start timing after the structured save or on the next onboarding turn',
    )
    expect(raw).toContain(
      'if they do not have results handy, they can skip this now and send PDF lab documents later if they want Murph to use them',
    )
    expect(raw).toContain(
      'https://my.functionhealth.com/documents',
    )
    expect(raw).toContain('Lab Results of Record documents')
    expect(raw).not.toContain('Function Health has no data export')
    expect(raw).not.toContain('copy and paste their biomarker results page')
    expect(raw).not.toContain('downloading results can be annoying')
    expect(raw).not.toContain('downloading results is annoying')
    expect(raw).toContain(
      'If the user sends lab PDFs, Lab Results of Record documents, pasted lab results, or other blood-test documents',
    )
    expect(raw).toContain(
      'call `send_progress_update` before reading the content or using file/import tools',
    )
    expect(raw).toContain('Persist useful answers as they arrive, not at the end')
    expect(raw).toContain(
      'Each fact goes to its best-fit canonical `vault-cli` surface',
    )
    expect(raw).toContain(
      'Treat "NKDA", "no known drug allergies", "NKFA", "no known food allergies", and broad "no known allergies" as negative clinical assertions',
    )
    expect(raw).toContain(
      'using `kind: "clinical_assertion"`',
    )
    expect(raw).toContain(
      '`occurredAt` for the source/save timestamp',
    )
    expect(raw).toContain('no_known_drug_allergies')
    expect(raw).toContain('no_known_food_allergies')
    expect(raw).toContain(
      'Do not dump structured items into freeform memory',
    )
    expect(raw).toContain(
      'before asking the next onboarding question',
    )
    expect(raw).toContain(
      'verify that every useful setup answer they supplied has already been persisted through the saving rules above',
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
    const hostedWearableIndex = raw.indexOf(
      '5. Hosted wearable handling.',
    )
    const movementIndex = raw.indexOf('6. Movement and training context.')
    const protocolsIndex = raw.indexOf(
      '7. Current protocols or experiments.',
    )
    const supplementsIndex = raw.indexOf(
      '8. Supplements.',
    )
    const medicalContextIndex = raw.indexOf(
      '9. Medical context.',
    )
    const bloodTestsIndex = raw.indexOf(
      '10. Blood tests.',
    )
    const orientationIndex = raw.indexOf('11. Orientation.')
    const firstExperimentIndex = raw.indexOf('12. First experiment setup.')
    expect(nameContextIndex).toBeGreaterThanOrEqual(0)
    expect(highLevelIndex).toBeGreaterThanOrEqual(0)
    expect(highLevelIndex).toBeGreaterThan(nameContextIndex)
    expect(wearableIndex).toBeGreaterThan(highLevelIndex)
    expect(hostedWearableIndex).toBeGreaterThan(wearableIndex)
    expect(movementIndex).toBeGreaterThan(hostedWearableIndex)
    expect(protocolsIndex).toBeGreaterThan(movementIndex)
    expect(supplementsIndex).toBeGreaterThan(protocolsIndex)
    expect(medicalContextIndex).toBeGreaterThan(supplementsIndex)
    expect(bloodTestsIndex).toBeGreaterThan(medicalContextIndex)
    expect(orientationIndex).toBeGreaterThan(bloodTestsIndex)
    expect(firstExperimentIndex).toBeGreaterThan(orientationIndex)
    expect(raw).toContain(
      'Do not mark onboarding complete until first experiment setup is resolved',
    )
    expect(raw).toContain(
      'three or four lightweight, bounded first-experiment options',
    )
    expect(raw).toContain(
      'Health Commons protocol discovery pass',
    )
    expect(raw).toContain(
      'Before presenting first-experiment options, check Health Commons',
    )
    expect(raw).toContain(
      'vault-cli commons protocol explore <query> --format json',
    )
    expect(raw).toContain(
      'vault-cli commons protocol list --query <query> --format json',
    )
    expectNoDeletedCommonsCommands(raw)
    expect(raw).toContain(
      'Do not invent the option set before this Health Commons pass',
    )
    expect(raw).toContain(
      'Prefer existing Health Commons protocols when they fit',
    )
    expect(raw).toContain(
      'Include a custom option only when the discovered protocols are missing, too burdensome, mismatched to the user\'s data',
    )
    expect(raw).toContain(
      'not a single recommendation',
    )
    expect(raw).toContain(
      'and may label one option as the lowest-friction default',
    )
    expect(raw).toContain(
      'but the user should still be able to choose among the options or defer',
    )
    expect(raw).toContain(
      'Keep the options concise, meaningfully distinct by intervention, outcome, or burden',
    )
    expect(raw).toContain(
      'If you cannot find at least three reasonable experiment options after Health Commons discovery',
    )
    expect(raw).toContain(
      'Ask one clear question that lets them choose one option to set up now or defer',
    )
    expect(raw).toContain(
      'If the user chooses an option to set up, or if baseline logging is needed as part of the chosen option',
    )
    expect(raw).toContain(
      'A resolved first experiment setup means one of: an active first experiment was created through experiment onboarding, the user explicitly deferred or declined, or setup is blocked by a specific safety/logistics issue',
    )
    expect(raw).toContain(
      'Do not offer standalone tracking as the alternative',
    )
    expect(raw).toContain(
      'A standalone tracking routine, generic "send me updates" instruction, or "log for a few days" plan does not resolve onboarding unless it is part of a concrete experiment setup handled through experiment onboarding',
    )
    expect(raw).toContain(
      'read and follow `$MURPH_ASSISTANT_SKILLS_ROOT/experiment-onboarding/SKILL.md` immediately',
    )
    expect(raw).toContain(
      'Do not settle for "text me workouts" or "log for a few days" as onboarding completion',
    )
    expect(raw).toContain(
      'If fresh baseline logging is needed because the signal is missing, stale, sparse, subjective, or protocol-required, treat that as part of experiment setup rather than a separate onboarding path',
    )
    expect(raw).not.toContain(
      'Creating an active experiment remains a separate confirmed flow',
    )
    expect(raw).not.toContain('propose one lightweight, bounded first experiment')
    expect(raw).not.toContain(
      'set up the proposed experiment now or defer',
    )
    expect(raw).not.toContain('as part of the proposed experiment')
    expect(raw).not.toContain('two or three lightweight')
    expect(raw).not.toContain('at least two reasonable experiment options')
    expect(raw).not.toContain(
      'inspect Health Commons protocol discovery before presenting choices',
    )
    expect(raw).not.toContain('first experiment or logging path')
    expect(raw).not.toContain('first experiment or logging setup')
    expect(raw).not.toContain('simple logging habit')
    expect(raw).not.toContain('log for a few days first')
    expect(raw).toContain(
      'whether they have recent blood tests or lab panels',
    )
    expect(raw).toContain(
      'lab sharing is optional and can be deferred',
    )
    expect(raw).toContain('they can skip anything they do not want to share')
    expect(raw).toContain(
      'Do not press for skipped demographic details, birth date, birth month/year, or sex assigned at birth',
    )
    expect(raw.slice(nameContextIndex, highLevelIndex)).toContain('```text')
    expect(raw.slice(highLevelIndex, wearableIndex)).not.toContain('```text')
    const movementSection = raw.slice(movementIndex, protocolsIndex)
    const movementExamples = [
      '- usual weekly exercise rhythm',
      '- classes, lifting, running, cardio, sports, or walking',
      '- races or training blocks like a 5K, marathon, or triathlon',
      '- recent benchmarks like VO2 max, mile time, lifts, pace, or zones',
      '- injuries, limitations, or anything they are trying to improve',
    ]
    for (const movementExample of movementExamples) {
      expect(movementSection).toContain(movementExample)
    }
    expect(movementSection).toContain('Follow the movement/training input affordance')
    expect(raw).toContain(
      'end the visible message with exactly: "Feel free to send me a voice memo."',
    )
    expect(movementSection).not.toContain('A messy answer is perfect')
    expect(movementSection).not.toContain('typed or voice memo')
    expect(movementSection).not.toContain(
      'messy typed list or a stream-of-consciousness voice memo',
    )
    expect(movementSection).toContain(
      'If a voice memo or audio answer already has a transcript',
    )
    expect(movementSection).toContain(
      'use it directly',
    )
    expect(movementSection).toContain(
      'No progress update is needed solely because the answer arrived as automatically parsed audio',
    )
    expect(movementSection).not.toContain(
      'If the user sends a voice memo and the assistant will inspect, transcribe, summarize, or save it',
    )
    expect(movementSection).not.toContain(
      'call `send_progress_update` before reading the content or using file/transcription tools',
    )
    expect(movementSection).toContain(
      'Save useful movement/training context to Context memory',
    )
    expect(movementSection).not.toContain('```text')
    const protocolsSection = raw.slice(protocolsIndex, supplementsIndex)
    expect(protocolsSection).toContain(
      'whether they are already trying any health protocols or experiments',
    )
    expect(protocolsSection).toContain('mostly starting fresh')
    expect(protocolsSection).toContain('cold exposure')
    expect(protocolsSection).toContain('sauna')
    expect(protocolsSection).toContain('a new workout plan')
    expect(protocolsSection).toContain('a diet pattern change')
    expect(protocolsSection).toContain('a sleep routine change')
    expect(protocolsSection).toContain('a recovery practice')
    expect(protocolsSection).toContain('caffeine/alcohol timing')
    const normalizedProtocolsSection = protocolsSection.toLowerCase()
    expect(normalizedProtocolsSection).not.toContain('supplement')
    const supplementExamplesExcludedFromProtocolStep = [
      'magnesium',
      'creatine',
      'vitamin d',
      'fish oil',
      'omega-3',
      'ashwagandha',
      'protein powder',
      'multivitamin',
    ]
    for (const supplementExample of supplementExamplesExcludedFromProtocolStep) {
      expect(normalizedProtocolsSection).not.toContain(supplementExample)
    }
    expect(protocolsSection).not.toContain('```text')
    const supplementSection = raw.slice(supplementsIndex, bloodTestsIndex)
    expect(supplementSection).toContain(
      'When relevant, invite product or brand names plus roughly how long they have taken each one or since when',
    )
    expect(supplementSection).toContain('Follow the supplement input affordance')
    expect(supplementSection).toContain(
      'The default lookup returns one match per query; pass an explicit higher limit only when the first result is ambiguous, generic, or missing likely product variants',
    )
    expect(supplementSection).not.toContain('```text')
    expect(raw.slice(bloodTestsIndex, orientationIndex)).not.toContain('```text')
    expect(raw.match(/Do not use a fixed script for this turn/g)?.length).toBe(5)
    const removedFixedScripts = [
      'One high-level setup detail first: what age and gender should I use for context? You can skip either.',
      'what gender should I use when interpreting health stuff',
      'Are you already trying any health protocols or experiments, or mostly starting fresh?',
      'Are you taking any supplements right now? Product or brand names help, plus roughly how long you\'ve taken each one or since when.',
      'Do you have any recent blood tests or lab panels, like Function Health or doctor-ordered labs? If you don\'t have them handy, skip this for now — you can always send a PDF or paste results later.',
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
      'only if the supplement lookup does not already provide a usable serving, dose, or amount',
    )
    expect(raw).toContain(
      'Ask follow-up questions about protocol adherence only when the user asks to set up a specific experiment',
    )
    expect(raw).not.toContain('birth month plus year and gender')
    expect(raw).not.toContain('birth month plus year, gender')
    expect(raw).toContain(
      'If they send PDFs, Lab Results of Record documents, pasted lab results, or other lab files, handle them through normal attachment/message intake',
    )
    expect(raw).toContain(
      'Useful setup answers are persisted to their best-fit canonical surface as the user shares them',
    )
    expect(raw).toContain(
      'Use a structured record whenever a typed `vault-cli` surface exists for the fact',
    )
    expect(raw).toContain(
      'fall back to Identity or Context memory only for facts with no structured home',
    )
    expect(raw).toContain(
      'preferred name, demographics, lifestyle context, interests, pregnancy or nursing status',
    )
    expect(raw).toContain(
      "Save dated facts with the current prompt's local date rather than inferring a birthday or onset",
    )
    expect(raw).toContain(
      'save soft "curious about sleep" mentions as Context memory unless the user framed a concrete goal',
    )
    expect(raw).toContain(
      'high-level age/gender prompt, wearable/app checkpoint, movement/training prompt, current protocol/experiment prompt, supplement prompt, medical-context prompt, and blood-test prompt have been asked',
    )
    expect(raw).toContain(
      'verify that every useful setup answer they supplied has already been persisted',
    )
    expect(raw).toContain(
      'complete a wearable/app checkpoint before first experiment setup',
    )
    expect(raw).toContain('vault-cli device account list --format json')
    expect(raw).toContain('vault-cli device connect <provider> --format json')
    expect(raw).toContain(
      'mention only those supported choices instead of leaving the connection for later',
    )
    expect(raw).toContain(
      'do not add any unsupported source as a caveat unless the user names that source',
    )
    expect(raw).toContain(
      'Do not proactively mention unsupported sources as caveats during onboarding',
    )
    expect(raw).toContain(
      'If the user names an unsupported source, say Murph does not support that source yet',
    )
    expect(raw).not.toContain('Apple Health')
    expect(raw).not.toContain('HealthKit')
    expect(raw).not.toContain('Health Connect')
    expect(raw).toContain('one lightweight, bounded experiment at a time')
    expect(raw).toContain('retrospective baseline')
    expect(raw).toContain(
      'One question per turn. Keep each turn short: one paragraph and at most one question, except the movement/training context turn may include a compact examples list',
    )
    expect(raw).toContain(
      'If any useful answer has not been saved yet, save it through the same canonical vault commands before marking onboarding complete',
    )
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
