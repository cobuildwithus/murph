import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'incur'
import { searchAssistantMemory } from './memory.js'
import { isMissingFileError, normalizeNullableString, writeJsonFileAtomic } from './shared.js'
import { createAssistantStateWriteLock } from './state-write-lock.js'
import { resolveAssistantStatePaths, type AssistantStatePaths } from './store.js'

const assistantOnboardingSlotValues = ['name', 'tone', 'goals'] as const

type AssistantOnboardingSlot = (typeof assistantOnboardingSlotValues)[number]

const assistantOnboardingProfileSchema = z
  .object({
    schema: z.literal('healthybob.assistant-onboarding.v1'),
    name: z.string().min(1).nullable(),
    nameAsked: z.boolean().optional().default(false),
    tone: z.string().min(1).nullable(),
    toneAsked: z.boolean().optional().default(false),
    goals: z.array(z.string().min(1)),
    updatedAt: z.string().min(1).nullable(),
  })
  .strict()

export interface AssistantOnboardingSummary {
  answered: {
    goals: string[]
    name: string | null
    tone: string | null
  }
  missingSlots: AssistantOnboardingSlot[]
}

const ASSISTANT_ONBOARDING_LOCK_DIRECTORY = '.locks/assistant-onboarding-write'
const ASSISTANT_ONBOARDING_LOCK_METADATA_PATH =
  `${ASSISTANT_ONBOARDING_LOCK_DIRECTORY}/owner.json`

const assistantOnboardingWriteLock = createAssistantStateWriteLock<AssistantStatePaths>({
  ownerKeyPrefix: 'assistant-onboarding',
  lockDirectory: ASSISTANT_ONBOARDING_LOCK_DIRECTORY,
  lockMetadataPath: ASSISTANT_ONBOARDING_LOCK_METADATA_PATH,
  invalidMetadataReason: 'Assistant onboarding write lock metadata is malformed.',
  heldLockErrorCode: 'ASSISTANT_ONBOARDING_WRITE_LOCKED',
  formatHeldLockMessage(owner) {
    return owner
      ? `Assistant onboarding writes are already in progress (pid=${owner.pid}, startedAt=${owner.startedAt}, command=${owner.command}).`
      : 'Assistant onboarding writes are already in progress.'
  },
})

export async function updateAssistantOnboardingSummary(input: {
  prompt: string
  vault: string
}): Promise<AssistantOnboardingSummary> {
  const paths = resolveAssistantStatePaths(input.vault)
  const extracted = extractAssistantOnboardingAnswers(input.prompt)

  return assistantOnboardingWriteLock.withWriteLock(paths, async () => {
    const current = await readAssistantOnboardingProfile(paths)
    const summary = await buildAssistantOnboardingSummary({
      paths,
      current,
      extracted,
    })
    const next = mergeAssistantOnboardingProfile(current, extracted, {
      markNameAsked: summary.missingSlots.includes('name'),
      markToneAsked: summary.missingSlots.includes('tone'),
    })
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      await mkdir(paths.assistantStateRoot, { recursive: true })
      await writeJsonFileAtomic(resolveAssistantOnboardingPath(paths), next)
    }

    return summary
  })
}

function resolveAssistantOnboardingPath(
  paths: Pick<AssistantStatePaths, 'assistantStateRoot'>,
): string {
  return path.join(paths.assistantStateRoot, 'onboarding.json')
}

async function readAssistantOnboardingProfile(
  paths: Pick<AssistantStatePaths, 'assistantStateRoot'>,
) {
  try {
    const raw = await readFile(resolveAssistantOnboardingPath(paths), 'utf8')
    return assistantOnboardingProfileSchema.parse(JSON.parse(raw) as unknown)
  } catch (error) {
    if (isMissingFileError(error)) {
      return createEmptyAssistantOnboardingProfile()
    }

    throw error
  }
}

function createEmptyAssistantOnboardingProfile() {
  return assistantOnboardingProfileSchema.parse({
    schema: 'healthybob.assistant-onboarding.v1',
    name: null,
    nameAsked: false,
    tone: null,
    toneAsked: false,
    goals: [],
    updatedAt: null,
  })
}

function mergeAssistantOnboardingProfile(
  current: z.infer<typeof assistantOnboardingProfileSchema>,
  extracted: {
    goals: string[]
    name: string | null
    tone: string | null
  },
  options?: {
    markNameAsked?: boolean
    markToneAsked?: boolean
  },
) {
  const goals = [...new Set([...current.goals, ...extracted.goals])]
  const name = extracted.name ?? current.name
  const nameAsked = current.nameAsked || Boolean(options?.markNameAsked) || name !== null
  const tone = extracted.tone ?? current.tone
  const toneAsked = current.toneAsked || Boolean(options?.markToneAsked) || tone !== null
  const changed =
    name !== current.name ||
    nameAsked !== current.nameAsked ||
    tone !== current.tone ||
    toneAsked !== current.toneAsked ||
    goals.length !== current.goals.length ||
    goals.some((goal, index) => goal !== current.goals[index])

  return assistantOnboardingProfileSchema.parse({
    schema: current.schema,
    name,
    nameAsked,
    tone,
    toneAsked,
    goals,
    updatedAt: changed ? new Date().toISOString() : current.updatedAt,
  })
}

async function buildAssistantOnboardingSummary(
  input: {
    current: z.infer<typeof assistantOnboardingProfileSchema>
    extracted: {
      goals: string[]
      name: string | null
      tone: string | null
    }
    paths: AssistantStatePaths
  },
): Promise<AssistantOnboardingSummary> {
  const [profile, memoryBackfill] = await Promise.all([
    Promise.resolve(input.current),
    loadAssistantOnboardingMemoryBackfill(input.paths.absoluteVaultRoot),
  ])

  const answered = {
    name: input.extracted.name ?? profile.name ?? memoryBackfill.name,
    tone: input.extracted.tone ?? profile.tone ?? memoryBackfill.tone,
    goals: [...new Set([...profile.goals, ...input.extracted.goals])],
  }
  const shouldAskName = answered.name === null && profile.nameAsked !== true
  const shouldAskTone = answered.tone === null && profile.toneAsked !== true

  return {
    answered,
    missingSlots: assistantOnboardingSlotValues.filter((slot) => {
      switch (slot) {
        case 'name':
          return shouldAskName
        case 'tone':
          return shouldAskTone
        case 'goals':
          return answered.goals.length === 0
      }
    }),
  }
}

async function loadAssistantOnboardingMemoryBackfill(vault: string): Promise<{
  name: string | null
  tone: string | null
}> {
  const [identity, preferences, instructions] = await Promise.all([
    searchAssistantMemory({
      vault,
      scope: 'long-term',
      section: 'Identity',
      limit: 8,
    }),
    searchAssistantMemory({
      vault,
      scope: 'long-term',
      section: 'Preferences',
      limit: 8,
    }),
    searchAssistantMemory({
      vault,
      scope: 'long-term',
      section: 'Standing instructions',
      limit: 8,
    }),
  ])

  const name =
    identity.results.find((record) => /^call the user\s+/iu.test(record.text))?.text ?? null
  const tone = [...preferences.results, ...instructions.results]
    .filter((record) => looksLikeOnboardingToneText(record.text))
    .sort((left, right) => (right.recordedAt ?? '').localeCompare(left.recordedAt ?? ''))
    .at(0)?.text ?? null

  return {
    name,
    tone,
  }
}

function extractAssistantOnboardingAnswers(prompt: string): {
  goals: string[]
  name: string | null
  tone: string | null
} {
  let name: string | null = null
  let tone: string | null = null
  const goals = new Set<string>()

  for (const sentence of splitIntoSentences(prompt)) {
    name ??= extractOnboardingName(sentence)
    tone ??= extractOnboardingTone(sentence)
    for (const goal of extractOnboardingGoals(sentence)) {
      goals.add(goal)
    }
  }

  return {
    name,
    tone,
    goals: [...goals],
  }
}

function splitIntoSentences(value: string): string[] {
  return value
    .split(/(?:\r?\n)+|(?<=[.!?;])\s+/u)
    .map((part) => normalizeNullableString(part.replace(/\s+/gu, ' ')))
    .filter((part): part is string => Boolean(part))
}

function extractOnboardingName(sentence: string): string | null {
  const normalized = sentence.trim().replace(/^actually[:,]?\s*/iu, '')
  const callMe = /\b(?:call me|you can call me)\s+(.+)/iu.exec(normalized)
  if (callMe?.[1]) {
    const name = cleanOnboardingValue(callMe[1])
    if (name) {
      return `Call the user ${name}.`
    }
  }

  const nameIs = /\bmy name is\s+(.+)/iu.exec(normalized)
  if (nameIs?.[1]) {
    const name = cleanOnboardingValue(nameIs[1])
    if (name) {
      return `Call the user ${name}.`
    }
  }

  return null
}

function extractOnboardingTone(sentence: string): string | null {
  const normalized = normalizeNullableString(sentence)
  if (!normalized) {
    return null
  }

  if (
    /\b(?:answer|answers|reply|replies|response|responses|summary|summaries)\b/iu.test(
      normalized,
    ) &&
    /\b(?:brief|bullet(?: point)?s?|concise|detailed|direct|formal|friendly|short|table(?:s)?|tone|warm)\b/iu.test(
      normalized,
    )
  ) {
    return toSentence(normalized)
  }

  if (/\b(?:casual|direct|formal|friendly|warm)\s+tone\b/iu.test(normalized)) {
    return toSentence(normalized)
  }

  return null
}

function looksLikeOnboardingToneText(value: string): boolean {
  return extractOnboardingTone(value) !== null
}

function extractOnboardingGoals(sentence: string): string[] {
  const normalized = normalizeNullableString(sentence)
  if (!normalized) {
    return []
  }

  const goalText =
    matchGoalValue(normalized, /\bmy goals?\s+(?:are|is)\s+(.+)/iu) ??
    matchGoalValue(normalized, /\bi want help with\s+(.+)/iu) ??
    matchGoalValue(normalized, /\bhelp me with\s+(.+)/iu) ??
    matchGoalValue(normalized, /\bi(?:'m| am)\s+focused on\s+(.+)/iu) ??
    matchGoalValue(normalized, /\bi(?:'m| am)\s+working on\s+(.+)/iu)

  if (!goalText) {
    return []
  }

  return [`Help with ${goalText}.`]
}

function matchGoalValue(sentence: string, pattern: RegExp): string | null {
  const match = pattern.exec(sentence)
  if (!match?.[1]) {
    return null
  }

  return cleanOnboardingValue(match[1], {
    trimLeading: /^(?:my\s+)?(?:current\s+)?goals?\s+(?:are|is)\s+/iu,
  })
}

function cleanOnboardingValue(
  value: string,
  options?: {
    trimLeading?: RegExp
  },
): string | null {
  let normalized = normalizeNullableString(value)
  if (!normalized) {
    return null
  }

  if (options?.trimLeading) {
    normalized = normalizeNullableString(normalized.replace(options.trimLeading, ''))
    if (!normalized) {
      return null
    }
  }

  normalized = normalizeNullableString(
    normalized
      .replace(/^[,.:;\-–—\s]+/u, '')
      .replace(/\b(?:for now|if possible|please|thanks?)\b.*$/iu, '')
      .replace(/[.!?]+$/u, ''),
  )

  return normalized
}

function toSentence(value: string): string {
  const normalized = normalizeNullableString(value.replace(/[.!?]+$/u, ''))
  return normalized ? `${normalized}.` : value
}
