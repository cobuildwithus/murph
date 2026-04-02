import type { AssistantMemoryLongTermSection } from '../../assistant-cli-contracts.js'
import { VaultCliError } from '../../vault-cli-errors.js'
import { normalizeNullableString } from '../shared.js'
import { normalizeMemoryLookup } from './text.js'

const RESPONSE_CONTEXT_PATTERN =
  /\b(?:answer|answers|response|responses|reply|replies|summary|summaries)\b/iu
const RESPONSE_STYLE_PATTERN =
  /\b(?:bullet(?: point)?s?|concise|brief|detailed|table(?:s)?|tone)\b/iu
const SENSITIVE_HEALTH_PATTERN =
  /\b(?:a1c|allerg(?:y|ies|ic)|asthma|blood pressure|bpm|cholesterol|chronic|condition|diagnos(?:is|ed)|disease|disorder|dosage|dose|glucose|hba1c|heart rate|hdl|lab(?:s| result| results)?|ldl|medication|medicine|mg\b|mg\/dl|mmhg|mmol(?:\/l)?|prescription|resting heart rate|rx|supplement|symptom|syndrome|triglycerides)\b/iu
const TRANSIENT_HEALTH_CONTEXT_PATTERN =
  /\b(?:concern(?:ed)?|worr(?:y|ied)|currently|experiencing|feel(?:ing)?|felt|headache|hurt(?:ing|s)?|infection|lately|migraine|nausea|pain|painful|rash|recently|right now|sick|symptom|symptoms|today|tonight|vomit(?:ing)?|weak|worse|worsening)\b/iu
const DURABLE_HEALTH_BASELINE_PATTERN =
  /\b(?:average|avg|baseline|normal(?:ly)?|resting|typical(?:ly)?|usual(?:ly)?)\b/iu
const DURABLE_HEALTH_CONDITION_PATTERN =
  /\b(?:adhd|allerg(?:y|ies)|anemia|anxiety|arthritis|asthma|autism|cholesterol|chronic|condition|depression|diabetes|disease|disorder|gerd|history of|hypertension|hypotension|migraine|pcos|prediabetes|sleep apnea|syndrome|thyroid)\b/iu
const EXPLICIT_HEALTH_MEMORY_LEAD_IN_PATTERN =
  /^(?:(?:please\s+)?remember(?: that)?|for future reference|keep in mind that)\b[:,]?\s*/iu
const MEMORY_CLAUSE_SPLIT_PATTERN =
  /(?:\s*,\s*|\s*;\s*|\s+\band\b\s+)(?=(?:actually\s+)?(?:call me|you can call me|my name is|i(?: would|'d)? prefer|user prefers|(?:i(?:'m|\s+am)\s+)?(?:fine|okay)\s+with|fine with|okay with|(?:(?:ur|your|the)\s+)?default(?:\s+assistant)?\s+tone(?:\s+is)?\s+fine|keep\s+(?:answer|answers|response|responses|reply|replies)|default to|ask before|always\b|never\b|when\b|remember(?: that)?|for future reference|keep in mind that|we(?:'re| are) working on|let'?s keep working on|i(?:'m| am) building|i(?:'m| am) working on|i want to|i wanna|we need to|the plan is|current project)\b)/iu

export interface AssistantLongTermMemoryEntry {
  section: AssistantMemoryLongTermSection
  text: string
}

export interface AssistantMemoryExtraction {
  daily: string[]
  longTerm: AssistantLongTermMemoryEntry[]
}

export function extractAssistantMemory(
  prompt: string,
): AssistantMemoryExtraction {
  const longTerm = new Map<string, AssistantLongTermMemoryEntry>()
  const daily = new Map<string, string>()

  for (const sentence of splitIntoMemorySentences(prompt)) {
    const identity = extractIdentityMemory(sentence)
    if (identity && shouldPersistAssistantMemory(identity)) {
      const key = normalizeMemoryLookup(identity)
      if (key) {
        longTerm.set(`Identity:${key}`, { section: 'Identity', text: identity })
      }
    }

    const preference = extractPreferenceMemory(sentence)
    if (preference && shouldPersistAssistantMemory(preference)) {
      const key = normalizeMemoryLookup(preference)
      if (key) {
        longTerm.set(`Preferences:${key}`, {
          section: 'Preferences',
          text: preference,
        })
      }
    }

    const instruction = extractStandingInstructionMemory(sentence)
    if (instruction && shouldPersistAssistantMemory(instruction)) {
      const key = normalizeMemoryLookup(instruction)
      if (key) {
        longTerm.set(`Standing instructions:${key}`, {
          section: 'Standing instructions',
          text: instruction,
        })
      }
    }

    const healthContext = extractHealthContextMemory(sentence)
    if (healthContext) {
      const key = normalizeMemoryLookup(healthContext)
      if (key) {
        longTerm.set(`Health context:${key}`, {
          section: 'Health context',
          text: healthContext,
        })
      }
    }

    const projectContext = extractProjectContextMemory(sentence)
    if (projectContext && shouldPersistAssistantMemory(projectContext)) {
      const key = normalizeMemoryLookup(projectContext)
      if (key) {
        daily.set(key, projectContext)
      }
    }
  }

  return {
    daily: [...daily.values()],
    longTerm: [...longTerm.values()],
  }
}

export function normalizeAssistantLongTermMemoryText(input: {
  allowSensitiveHealthContext: boolean
  requireSourcePromptMatch: boolean
  section: AssistantMemoryLongTermSection
  sourcePrompt: string | null
  text: string
}): string {
  const sourcePromptCandidates = input.sourcePrompt
    ? extractAssistantMemory(input.sourcePrompt).longTerm.filter(
        (entry) => entry.section === input.section,
      )
    : []
  const textCandidates = extractAssistantMemory(input.text).longTerm.filter(
    (entry) => entry.section === input.section,
  )
  const matchingCandidatePair = findMatchingAssistantMemoryCandidate(
    sourcePromptCandidates,
    textCandidates,
  )
  const sourceCandidate = matchingCandidatePair?.source ?? sourcePromptCandidates[0] ?? null
  const textCandidate = matchingCandidatePair?.text ?? textCandidates[0] ?? null
  const resolvedCandidate = matchingCandidatePair?.text ?? sourceCandidate ?? textCandidate

  if (input.requireSourcePromptMatch && !sourceCandidate) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_SOURCE_PROMPT_REQUIRED',
      `Assistant memory ${input.section} writes must be grounded in the active user turn.`,
    )
  }

  if (
    input.requireSourcePromptMatch &&
    sourcePromptCandidates.length > 0 &&
    textCandidates.length > 0 &&
    !matchingCandidatePair
  ) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_SOURCE_PROMPT_MISMATCH',
      `Assistant memory ${input.section} writes must match the active user turn.`,
    )
  }

  if (resolvedCandidate) {
    if (input.section === 'Health context' && !input.allowSensitiveHealthContext) {
      throw new VaultCliError(
        'ASSISTANT_MEMORY_HEALTH_PRIVATE_CONTEXT_REQUIRED',
        'Health-context assistant memory is only available in private assistant contexts.',
      )
    }

    return resolvedCandidate.text
  }

  const sentence = toSentence(input.text)

  switch (input.section) {
    case 'Identity': {
      if (/^call the user\s+.+$/iu.test(sentence)) {
        return sentence
      }
      break
    }

    case 'Preferences':
    case 'Standing instructions': {
      if (looksLikeAssistantBehavior(sentence) && !looksLikeSensitiveHealthFact(sentence)) {
        return sentence
      }
      break
    }

    case 'Health context': {
      if (!input.allowSensitiveHealthContext) {
        throw new VaultCliError(
          'ASSISTANT_MEMORY_HEALTH_PRIVATE_CONTEXT_REQUIRED',
          'Health-context assistant memory is only available in private assistant contexts.',
        )
      }

      if (
        looksLikeSensitiveHealthFact(sentence) &&
        !TRANSIENT_HEALTH_CONTEXT_PATTERN.test(sentence)
      ) {
        return sentence
      }

      break
    }
  }

  throw new VaultCliError(
    'ASSISTANT_MEMORY_INVALID_UPSERT',
    `Assistant memory text does not match the ${input.section} section policy.`,
  )
}

export function normalizeAssistantDailyMemoryText(input: {
  allowSensitiveHealthContext: boolean
  sourcePrompt: string | null
  text: string
}): string {
  const extracted = input.sourcePrompt
    ? extractAssistantMemory(input.sourcePrompt)
    : {
        daily: [],
        longTerm: [],
      }

  if (extracted.daily[0]) {
    return extracted.daily[0]
  }

  const sentence = toSentence(input.text)
  if (
    looksLikeSensitiveHealthFact(sentence) &&
    !input.allowSensitiveHealthContext
  ) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_DAILY_HEALTH_REJECTED',
      'Daily assistant memory cannot store sensitive health context outside private assistant contexts.',
    )
  }

  return sentence
}

function splitIntoMemorySentences(prompt: string): string[] {
  return prompt
    .split(/(?:\r?\n)+|(?<=[.!?;])\s+/u)
    .flatMap((sentence) => splitMemoryClauses(sentence))
    .map((sentence) => normalizeSentence(sentence))
    .filter((sentence): sentence is string => Boolean(sentence))
}

function splitMemoryClauses(sentence: string): string[] {
  return sentence.split(MEMORY_CLAUSE_SPLIT_PATTERN)
}

function normalizeSentence(value: string): string | null {
  const normalized = normalizeNullableString(value.replace(/\s+/gu, ' '))
  if (!normalized) {
    return null
  }

  return normalized
}

function extractIdentityMemory(sentence: string): string | null {
  const trimmed = sentence.trim().replace(/^actually[:,]?\s*/iu, '')
  const callMe = /\b(?:call me|you can call me)\s+(.+)/iu.exec(trimmed)
  if (callMe?.[1]) {
    const name = cleanIdentityValue(callMe[1])
    if (name) {
      return `Call the user ${name}.`
    }
  }

  const nameIs = /\bmy name is\s+(.+)/iu.exec(trimmed)
  if (nameIs?.[1]) {
    const name = cleanIdentityValue(nameIs[1])
    if (name) {
      return `Call the user ${name}.`
    }
  }

  return null
}

function extractPreferenceMemory(sentence: string): string | null {
  const trimmed = sentence.trim()
  const lower = trimmed.toLowerCase()

  if (
    lower.startsWith('going forward') ||
    lower.startsWith('from now on') ||
    lower.startsWith('for future responses')
  ) {
    return null
  }

  const storedPreferenceMatch = /^user prefers\s+(.+)/iu.exec(trimmed)
  if (storedPreferenceMatch?.[1]) {
    const clause = cleanMemoryValue(storedPreferenceMatch[1])
    if (looksLikeDurablePreferenceClause(clause)) {
      return `User prefers ${clause}.`
    }
  }

  const preferMatch = /\bi(?: would|'d)? prefer\s+(.+)/iu.exec(trimmed)
  if (preferMatch?.[1]) {
    const clause = cleanMemoryValue(preferMatch[1])
    if (looksLikeDurablePreferenceClause(clause)) {
      return `User prefers ${clause}.`
    }
  }

  if (looksLikeDefaultAssistantTonePreference(trimmed)) {
    return 'User prefers the default assistant tone.'
  }

  if (
    /\buse\s+(?:metric|imperial|us customary)\s+units\b/iu.test(trimmed) &&
    !looksLikeOneOffFormattingRequest(trimmed)
  ) {
    return toSentence(trimmed)
  }

  if (/^keep\s+(?:answer|answers|response|responses|reply|replies)\b/iu.test(trimmed)) {
    return null
  }

  if (looksLikeStableResponsePreference(trimmed)) {
    return toSentence(trimmed.replace(/^please\s+/iu, ''))
  }

  return null
}

function extractStandingInstructionMemory(sentence: string): string | null {
  const trimmed = sentence.trim()
  const lower = trimmed.toLowerCase()

  if (lower.startsWith('going forward')) {
    return toSentence(trimmed.replace(/^going forward[:,]?\s*/iu, ''))
  }

  if (lower.startsWith('from now on')) {
    return toSentence(trimmed.replace(/^from now on[:,]?\s*/iu, ''))
  }

  if (lower.startsWith('for future responses')) {
    return toSentence(trimmed.replace(/^for future responses[:,]?\s*/iu, ''))
  }

  if (/\bask before\b/iu.test(trimmed) || /\bdefault to\b/iu.test(trimmed)) {
    return toSentence(trimmed.replace(/^please\s+/iu, ''))
  }

  if (
    /^keep\s+(?:answer|answers|response|responses|reply|replies)\b/iu.test(trimmed) &&
    RESPONSE_STYLE_PATTERN.test(trimmed) &&
    !looksLikeOneOffFormattingRequest(trimmed)
  ) {
    return toSentence(trimmed.replace(/^please\s+/iu, ''))
  }

  if (
    /\b(?:always|never)\b/iu.test(trimmed) &&
    /\b(?:answer|response|reply|recommend|write|format|mention|summari(?:ze|zing)|ask)\b/iu.test(
      trimmed,
    )
  ) {
    return toSentence(trimmed.replace(/^please\s+/iu, ''))
  }

  if (
    /^when\b/iu.test(trimmed) &&
    /\b(?:answer|response|reply|recommend|write|format|summari(?:ze|zing)|show|use)\b/iu.test(
      trimmed,
    )
  ) {
    return toSentence(trimmed.replace(/^please\s+/iu, ''))
  }

  return null
}

function extractProjectContextMemory(sentence: string): string | null {
  const trimmed = sentence.trim()
  const projectContextPatterns = [
    /\bwe(?:'re| are) working on\b/iu,
    /\blet'?s keep working on\b/iu,
    /\bi(?:'m| am) building\b/iu,
    /\bi(?:'m| am) working on\b/iu,
    /\bi want to\b.*\b(?:add|build|fix|implement|improve|ship|simplify)\b/iu,
    /\bwe need to\b.*\b(?:add|build|fix|implement|improve|ship|simplify)\b/iu,
    /\bthe plan is\b/iu,
    /\bcurrent project\b/iu,
  ]

  if (
    projectContextPatterns.some((pattern) => pattern.test(trimmed)) &&
    /\b(?:assistant|agent|automation|build|chat|implementation|integrat|memory|project|repo|vault|workflow)\b/iu.test(
      trimmed,
    )
  ) {
    return toSentence(trimmed)
  }

  return null
}

function extractHealthContextMemory(sentence: string): string | null {
  const trimmed = sentence.trim()
  const explicitRemember = hasExplicitHealthMemoryLeadIn(trimmed)
  const candidate = stripHealthMemoryLeadIn(trimmed)
  if (!looksLikeSensitiveHealthFact(candidate)) {
    return null
  }

  if (!explicitRemember && !looksLikeDurableHealthContext(candidate)) {
    return null
  }

  const rewritten = rewriteHealthContextSentence(candidate, explicitRemember)
  if (!rewritten) {
    return null
  }

  return toSentence(rewritten)
}

function shouldPersistAssistantMemory(text: string): boolean {
  const normalized = normalizeNullableString(text)
  if (!normalized) {
    return false
  }

  return !(looksLikeSensitiveHealthFact(normalized) && !looksLikeAssistantBehavior(normalized))
}

function looksLikeSensitiveHealthFact(text: string): boolean {
  return (
    SENSITIVE_HEALTH_PATTERN.test(text) ||
    DURABLE_HEALTH_CONDITION_PATTERN.test(text)
  )
}

function looksLikeAssistantBehavior(text: string): boolean {
  return /\b(?:answer|call the user|default to|format|keep (?:answer|answers|response|responses|recommendation|recommendations)|reply|respond|show|summar(?:ize|izing|y)|use\s+(?:metric|imperial|us customary)\s+units|write|ask before)\b/iu.test(
    text,
  )
}

function cleanMemoryValue(value: string): string {
  return stripTrailingPunctuation(value)
    .replace(/^the name\s+/iu, '')
    .replace(/^me\s+/iu, '')
}

function cleanIdentityValue(value: string): string | null {
  const cleaned = cleanMemoryValue(value)
    .replace(
      /\s+(?:for future responses|from now on|going forward|instead|now)\b.*$/iu,
      '',
    )
    .replace(/\s*,?\s*please\b.*$/iu, '')
    .replace(/^["'`(]+/u, '')
    .replace(/["'`)]$/u, '')
    .trim()

  return normalizeNullableString(cleaned)
}

function stripHealthMemoryLeadIn(value: string): string {
  return value.replace(EXPLICIT_HEALTH_MEMORY_LEAD_IN_PATTERN, '').trim()
}

function hasExplicitHealthMemoryLeadIn(value: string): boolean {
  return EXPLICIT_HEALTH_MEMORY_LEAD_IN_PATTERN.test(value.trim())
}

function rewriteHealthContextSentence(
  value: string,
  allowTransientContext: boolean,
): string | null {
  const possessiveMatch = /^my\s+(.+?)\s+(is|was|are|were)\s+(.+)$/iu.exec(value)
  if (possessiveMatch?.[1] && possessiveMatch[2] && possessiveMatch[3]) {
    if (
      allowTransientContext ||
      looksLikeDurablePossessiveHealthContext(
        possessiveMatch[1],
        possessiveMatch[3],
      )
    ) {
      return `User's ${cleanMemoryValue(possessiveMatch[1])} ${possessiveMatch[2].toLowerCase()} ${cleanMemoryValue(possessiveMatch[3])}`
    }
  }

  const rewriteRules = [
    {
      allowWithoutExplicitRemember: (match: RegExpExecArray) =>
        looksLikeDurableConditionPhrase(match[1] ?? ''),
      pattern: /^i\s+have\s+(.+)$/iu,
      rewrite: (match: RegExpExecArray) => `User has ${cleanMemoryValue(match[1])}`,
    },
    {
      allowWithoutExplicitRemember: () => true,
      pattern: /^i\s+(?:was\s+)?diagnosed with\s+(.+)$/iu,
      rewrite: (match: RegExpExecArray) =>
        `User was diagnosed with ${cleanMemoryValue(match[1])}`,
    },
    {
      allowWithoutExplicitRemember: () => true,
      pattern: /^i(?:'m|\s+am)\s+allergic to\s+(.+)$/iu,
      rewrite: (match: RegExpExecArray) =>
        `User is allergic to ${cleanMemoryValue(match[1])}`,
    },
    {
      allowWithoutExplicitRemember: () => true,
      pattern: /^i\s+take\s+(.+)$/iu,
      rewrite: (match: RegExpExecArray) => `User takes ${cleanMemoryValue(match[1])}`,
    },
    {
      allowWithoutExplicitRemember: () => true,
      pattern: /^i\s+use\s+(.+)$/iu,
      rewrite: (match: RegExpExecArray) => `User uses ${cleanMemoryValue(match[1])}`,
    },
    {
      allowWithoutExplicitRemember: () => true,
      pattern: /^i\s+track\s+(.+)$/iu,
      rewrite: (match: RegExpExecArray) => `User tracks ${cleanMemoryValue(match[1])}`,
    },
    {
      allowWithoutExplicitRemember: () => true,
      pattern: /^i\s+monitor\s+(.+)$/iu,
      rewrite: (match: RegExpExecArray) =>
        `User monitors ${cleanMemoryValue(match[1])}`,
    },
  ]

  for (const rule of rewriteRules) {
    const match = rule.pattern.exec(value)
    if (match) {
      if (!allowTransientContext && !rule.allowWithoutExplicitRemember(match)) {
        return null
      }

      return rule.rewrite(match)
    }
  }

  if (allowTransientContext) {
    const transientRules = [
      {
        pattern: /^i(?:'m|\s+am)\s+experiencing\s+(.+)$/iu,
        rewrite: (match: RegExpExecArray) =>
          `User is experiencing ${cleanMemoryValue(match[1])}`,
      },
      {
        pattern: /^i(?:'m|\s+am)\s+(.+)$/iu,
        rewrite: (match: RegExpExecArray) => `User is ${cleanMemoryValue(match[1])}`,
      },
    ]

    for (const rule of transientRules) {
      const match = rule.pattern.exec(value)
      if (match) {
        return rule.rewrite(match)
      }
    }
  }

  return null
}

function toSentence(value: string): string {
  const cleaned = stripTrailingPunctuation(value)
  return /[.!?]$/u.test(cleaned) ? cleaned : `${cleaned}.`
}

function stripTrailingPunctuation(value: string): string {
  return value.trim().replace(/[\s,;:]+$/u, '').replace(/[.!?]+$/u, '')
}

function looksLikeDurablePreferenceClause(value: string): boolean {
  if (/\b(?:metric|imperial|us customary)\s+units\b/iu.test(value)) {
    return true
  }

  if (/\btone\b/iu.test(value)) {
    return true
  }

  if (
    RESPONSE_CONTEXT_PATTERN.test(value) &&
    RESPONSE_STYLE_PATTERN.test(value) &&
    !looksLikeOneOffFormattingRequest(value)
  ) {
    return true
  }

  return false
}

function looksLikeDefaultAssistantTonePreference(value: string): boolean {
  const normalized = stripTrailingPunctuation(value)
  return /^(?:(?:i(?:'m|\s+am)\s+)?(?:fine|okay)\s+with\s+(?:(?:ur|your|the)\s+)?default(?:\s+assistant)?\s+tone|(?:(?:ur|your|the)\s+)?default(?:\s+assistant)?\s+tone(?:\s+is)?\s+fine)$/iu.test(
    normalized,
  )
}

function looksLikeStableResponsePreference(value: string): boolean {
  const normalized = value.replace(/^please\s+/iu, '')
  return (
    /\b(?:answer|format|keep|make|reply|respond|use|write)\b/iu.test(
      normalized,
    ) &&
    RESPONSE_CONTEXT_PATTERN.test(normalized) &&
    RESPONSE_STYLE_PATTERN.test(normalized) &&
    !looksLikeOneOffFormattingRequest(normalized)
  )
}

function looksLikeOneOffFormattingRequest(value: string): boolean {
  return /\b(?:for this|for these|right now|these two|this answer|this response)\b/iu.test(
    value,
  )
}

function findMatchingAssistantMemoryCandidate(
  sourceCandidates: AssistantLongTermMemoryEntry[],
  textCandidates: AssistantLongTermMemoryEntry[],
): {
  source: AssistantLongTermMemoryEntry
  text: AssistantLongTermMemoryEntry
} | null {
  for (const sourceCandidate of sourceCandidates) {
    for (const textCandidate of textCandidates) {
      if (areEquivalentAssistantMemoryTexts(sourceCandidate.text, textCandidate.text)) {
        return {
          source: sourceCandidate,
          text: textCandidate,
        }
      }
    }
  }

  return null
}

function areEquivalentAssistantMemoryTexts(left: string, right: string): boolean {
  const normalizedLeft = normalizeMemoryLookup(left)
  const normalizedRight = normalizeMemoryLookup(right)
  return normalizedLeft !== null && normalizedLeft === normalizedRight
}

function looksLikeDurableHealthContext(value: string): boolean {
  if (/\?$/u.test(value) || TRANSIENT_HEALTH_CONTEXT_PATTERN.test(value)) {
    return false
  }

  if (/^i(?:'m|\s+am)\s+allergic to\s+.+$/iu.test(value)) {
    return true
  }

  if (/^i\s+(?:was\s+)?diagnosed with\s+.+$/iu.test(value)) {
    return true
  }

  if (/^i\s+(?:take|use|track|monitor)\s+.+$/iu.test(value)) {
    return true
  }

  const possessiveMatch = /^my\s+(.+?)\s+(?:is|was|are|were)\s+(.+)$/iu.exec(value)
  if (possessiveMatch?.[1] && possessiveMatch[3]) {
    return looksLikeDurablePossessiveHealthContext(
      possessiveMatch[1],
      possessiveMatch[3],
    )
  }

  const haveMatch = /^i\s+have\s+(.+)$/iu.exec(value)
  if (haveMatch?.[1]) {
    return looksLikeDurableConditionPhrase(haveMatch[1])
  }

  return false
}

function looksLikeDurablePossessiveHealthContext(
  subject: string,
  value: string,
): boolean {
  const normalizedSubject = normalizeMemoryLookup(subject)
  const normalizedValue = normalizeMemoryLookup(value)
  if (!normalizedSubject || !normalizedValue) {
    return false
  }

  if (TRANSIENT_HEALTH_CONTEXT_PATTERN.test(normalizedValue)) {
    return false
  }

  if (
    /\b(?:allerg(?:y|ies)|medication|medicine|prescription|supplement)\b/iu.test(
      normalizedSubject,
    )
  ) {
    return true
  }

  return (
    DURABLE_HEALTH_BASELINE_PATTERN.test(normalizedSubject) ||
    DURABLE_HEALTH_BASELINE_PATTERN.test(normalizedValue)
  )
}

function looksLikeDurableConditionPhrase(value: string): boolean {
  const normalized = normalizeMemoryLookup(value)
  if (!normalized) {
    return false
  }

  if (TRANSIENT_HEALTH_CONTEXT_PATTERN.test(normalized)) {
    return false
  }

  return DURABLE_HEALTH_CONDITION_PATTERN.test(normalized)
}
