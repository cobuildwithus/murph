import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { AssistantStatePaths } from './store.js'
import { resolveAssistantStatePaths } from './store.js'
import {
  isMissingFileError,
  normalizeNullableString,
  writeTextFileAtomic,
} from './shared.js'

const LONG_TERM_MEMORY_SECTIONS = [
  'Identity',
  'Preferences',
  'Standing instructions',
  'Health context',
] as const

const MEMORY_PROMPT_MAX_CHARS = 4_500
const RECENT_DAILY_NOTE_LIMIT = 12
const MEMORY_TIME_SEPARATOR = ' — '
const SENSITIVE_HEALTH_PATTERN =
  /\b(?:a1c|allerg(?:y|ies|ic)|asthma|blood pressure|bpm|cholesterol|chronic|condition|diagnos(?:is|ed)|disease|disorder|dosage|dose|glucose|hba1c|heart rate|hdl|lab(?:s| result| results)?|ldl|medication|medicine|mg\b|mg\/dl|mmhg|mmol(?:\/l)?|prescription|resting heart rate|rx|supplement|symptom|syndrome|triglycerides)\b/iu
const RESPONSE_CONTEXT_PATTERN =
  /\b(?:answer|answers|response|responses|reply|replies|summary|summaries)\b/iu
const RESPONSE_STYLE_PATTERN =
  /\b(?:bullet(?: point)?s?|concise|brief|detailed|table(?:s)?|tone)\b/iu
const TRANSIENT_HEALTH_CONTEXT_PATTERN =
  /\b(?:concern(?:ed)?|worr(?:y|ied)|currently|experiencing|feel(?:ing)?|felt|headache|hurt(?:ing|s)?|infection|lately|migraine|nausea|pain|painful|rash|recently|right now|sick|symptom|symptoms|today|tonight|vomit(?:ing)?|weak|worse|worsening)\b/iu
const DURABLE_HEALTH_BASELINE_PATTERN =
  /\b(?:average|avg|baseline|normal(?:ly)?|resting|typical(?:ly)?|usual(?:ly)?)\b/iu
const DURABLE_HEALTH_CONDITION_PATTERN =
  /\b(?:adhd|allerg(?:y|ies)|anemia|anxiety|arthritis|asthma|autism|cholesterol|chronic|condition|depression|diabetes|disease|disorder|gerd|history of|hypertension|hypotension|migraine|pcos|prediabetes|sleep apnea|syndrome|thyroid)\b/iu
const EXPLICIT_HEALTH_MEMORY_LEAD_IN_PATTERN =
  /^(?:(?:please\s+)?remember(?: that)?|for future reference|keep in mind that)\b[:,]?\s*/iu

export interface AssistantMemoryPromptInput {
  now?: Date
  vault: string
}

export interface AssistantMemoryWriteInput {
  now?: Date
  prompt: string
  vault: string
}

export interface AssistantMemoryWriteResult {
  dailyAdded: number
  longTermAdded: number
}

export interface AssistantLongTermMemoryEntry {
  section: AssistantLongTermMemorySection
  text: string
}

export interface AssistantMemoryExtraction {
  daily: string[]
  longTerm: AssistantLongTermMemoryEntry[]
}

export type AssistantLongTermMemorySection =
  (typeof LONG_TERM_MEMORY_SECTIONS)[number]

interface MarkdownSection {
  heading: string
  lines: string[]
}

interface ParsedMarkdownDocument {
  preambleLines: string[]
  sections: MarkdownSection[]
}

interface AssistantMemoryBullet {
  key: string
  rawText: string
  replaceKey: string | null
}

export function resolveAssistantMemoryPaths(vault: string): AssistantStatePaths {
  return resolveAssistantStatePaths(vault)
}

export function resolveAssistantDailyMemoryPath(
  paths: Pick<AssistantStatePaths, 'dailyMemoryDirectory'>,
  now = new Date(),
): string {
  return path.join(paths.dailyMemoryDirectory, `${formatLocalDate(now)}.md`)
}

export async function loadAssistantMemoryPromptBlock(
  input: AssistantMemoryPromptInput,
): Promise<string | null> {
  const paths = resolveAssistantMemoryPaths(input.vault)
  const longTerm = await readOptionalText(paths.longTermMemoryPath)
  const recentNotes = await loadRecentDailyMemoryNotes(paths, input.now)
  const blocks: string[] = []

  if (longTerm) {
    const excerpt = renderLongTermMemoryPromptExcerpt(longTerm)
    if (excerpt) {
      blocks.push(`Long-term assistant memory:\n${excerpt}`)
    }
  }

  if (recentNotes.length > 0) {
    blocks.push(
      `Recent daily assistant memory (yesterday + today; later bullets override earlier ones):\n${recentNotes
        .map((note) => `- ${note}`)
        .join('\n')}`,
    )
  }

  if (blocks.length === 0) {
    return null
  }

  return [
    'Assistant memory lives outside the canonical vault and is only for conversational continuity.',
    'Use it for naming, response preferences, standing instructions, selected health context, and recent project context. Do not treat it as canonical health data or evidence.',
    'If assistant memory conflicts with the vault, trust the vault. Newer bullets override older bullets.',
    ...blocks,
  ].join('\n\n')
}

export async function recordAssistantMemoryTurn(
  input: AssistantMemoryWriteInput,
): Promise<AssistantMemoryWriteResult> {
  const extracted = extractAssistantMemory(input.prompt)
  if (extracted.longTerm.length === 0 && extracted.daily.length === 0) {
    return {
      dailyAdded: 0,
      longTermAdded: 0,
    }
  }

  const paths = resolveAssistantMemoryPaths(input.vault)
  const now = input.now ?? new Date()
  let longTermAdded = 0
  let dailyAdded = 0

  if (extracted.longTerm.length > 0) {
    longTermAdded = await mergeLongTermAssistantMemory(paths, extracted.longTerm, now)
  }

  const dailyNotes = [
    ...extracted.longTerm.map((entry) => entry.text),
    ...extracted.daily,
  ]
  if (dailyNotes.length > 0) {
    dailyAdded = await appendAssistantDailyMemory(paths, dailyNotes, now)
  }

  return {
    dailyAdded,
    longTermAdded,
  }
}

export function extractAssistantMemory(prompt: string): AssistantMemoryExtraction {
  const sentences = splitIntoMemorySentences(prompt)
  const longTerm = new Map<string, AssistantLongTermMemoryEntry>()
  const daily = new Map<string, string>()

  for (const sentence of sentences) {
    const identity = extractIdentityMemory(sentence)
    if (identity && shouldPersistAssistantMemory(identity)) {
      setLongTermMemoryEntry(longTerm, {
        section: 'Identity',
        text: identity,
      })
    }

    const preference = extractPreferenceMemory(sentence)
    if (preference && shouldPersistAssistantMemory(preference)) {
      setLongTermMemoryEntry(longTerm, {
        section: 'Preferences',
        text: preference,
      })
    }

    const instruction = extractStandingInstructionMemory(sentence)
    if (instruction && shouldPersistAssistantMemory(instruction)) {
      setLongTermMemoryEntry(longTerm, {
        section: 'Standing instructions',
        text: instruction,
      })
    }

    const healthContext = extractHealthContextMemory(sentence)
    if (healthContext) {
      setLongTermMemoryEntry(longTerm, {
        section: 'Health context',
        text: healthContext,
      })
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
    longTerm: [...longTerm.values()],
    daily: [...daily.values()],
  }
}

function setLongTermMemoryEntry(
  target: Map<string, AssistantLongTermMemoryEntry>,
  entry: AssistantLongTermMemoryEntry,
): void {
  const key = buildLongTermMemoryMapKey(entry.section, entry.text)
  if (!key) {
    return
  }

  target.set(key, entry)
}

async function mergeLongTermAssistantMemory(
  paths: AssistantStatePaths,
  entries: AssistantLongTermMemoryEntry[],
  now: Date,
): Promise<number> {
  const existing = await readOptionalText(paths.longTermMemoryPath)
  const document = existing
    ? parseMarkdownDocument(existing)
    : createDefaultLongTermMemoryDocument()
  const stampedPrefix = `${formatLocalDate(now)} ${formatLocalTime(now)}${MEMORY_TIME_SEPARATOR}`
  let added = 0
  let changed = false

  for (const sectionName of LONG_TERM_MEMORY_SECTIONS) {
    const section = findOrCreateSection(document, sectionName)
    const bullets = getSectionBullets(section, sectionName)
    let nextBullets = bullets
    let sectionChanged = false

    for (const entry of entries) {
      if (entry.section !== sectionName) {
        continue
      }

      const key = normalizeMemoryLookup(entry.text)
      if (!key) {
        continue
      }

      const replaceKey = deriveLongTermReplaceKey(sectionName, entry.text)
      if (replaceKey) {
        const filtered = nextBullets.filter(
          (bullet) => bullet.replaceKey !== replaceKey || bullet.key === key,
        )
        if (filtered.length !== nextBullets.length) {
          nextBullets = filtered
          sectionChanged = true
        }
      }

      if (nextBullets.some((bullet) => bullet.key === key)) {
        continue
      }

      nextBullets = [
        ...nextBullets,
        {
          key,
          rawText: `${stampedPrefix}${entry.text}`,
          replaceKey,
        },
      ]
      sectionChanged = true
      added += 1
    }

    if (sectionChanged) {
      section.lines = renderSectionBulletLines(nextBullets)
      changed = true
    }
  }

  if (changed) {
    await mkdir(path.dirname(paths.longTermMemoryPath), { recursive: true })
    await writeTextFileAtomic(
      paths.longTermMemoryPath,
      renderMarkdownDocument(document),
    )
  }

  return added
}

async function appendAssistantDailyMemory(
  paths: AssistantStatePaths,
  notes: string[],
  now: Date,
): Promise<number> {
  const dailyPath = resolveAssistantDailyMemoryPath(paths, now)
  const existing = await readOptionalText(dailyPath)
  const document = existing
    ? parseMarkdownDocument(existing)
    : createDefaultDailyMemoryDocument(now)
  const section = findOrCreateSection(document, 'Notes')
  const seen = new Set(getSectionBulletKeys(section))
  let added = 0

  for (const note of notes) {
    const key = normalizeMemoryLookup(note)
    if (!key || seen.has(key)) {
      continue
    }

    if (section.lines.length > 0 && section.lines[section.lines.length - 1]?.trim()) {
      section.lines.push('')
    }
    section.lines.push(`- ${formatLocalTime(now)}${MEMORY_TIME_SEPARATOR}${note}`)
    seen.add(key)
    added += 1
  }

  if (added > 0) {
    await mkdir(path.dirname(dailyPath), { recursive: true })
    await writeTextFileAtomic(dailyPath, renderMarkdownDocument(document))
  }

  return added
}

async function loadRecentDailyMemoryNotes(
  paths: AssistantStatePaths,
  now = new Date(),
): Promise<string[]> {
  const dates = [shiftDate(now, -1), now]
  const notes = new Map<string, string>()

  for (const date of dates) {
    const dailyPath = resolveAssistantDailyMemoryPath(paths, date)
    const text = await readOptionalText(dailyPath)
    if (!text) {
      continue
    }

    const document = parseMarkdownDocument(text)
    const section = document.sections.find((candidate) => candidate.heading === 'Notes')
    if (!section) {
      continue
    }

    for (const line of section.lines) {
      const bullet = parseBulletLine(line)
      if (bullet) {
        const key = buildDailyMemoryMapKey(bullet)
        if (!key) {
          continue
        }

        notes.delete(key)
        notes.set(key, bullet)
      }
    }
  }

  return [...notes.values()].slice(-RECENT_DAILY_NOTE_LIMIT)
}

function renderLongTermMemoryPromptExcerpt(text: string): string | null {
  const document = parseMarkdownDocument(text)
  const sections = document.sections
    .map((section) => {
      const visibleLines = section.lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
      if (visibleLines.length === 0) {
        return null
      }
      return `${section.heading}:\n${visibleLines.join('\n')}`
    })
    .filter((section): section is string => Boolean(section))

  if (sections.length === 0) {
    const fallback = normalizeNullableString(text)
    if (!fallback) {
      return null
    }
    return truncateMemoryPromptText(fallback)
  }

  return truncateMemoryPromptText(sections.join('\n\n'))
}

function truncateMemoryPromptText(text: string): string {
  if (text.length <= MEMORY_PROMPT_MAX_CHARS) {
    return text
  }

  return `${text.slice(0, MEMORY_PROMPT_MAX_CHARS - 18).trimEnd()}\n\n[truncated memory]`
}

function splitIntoMemorySentences(prompt: string): string[] {
  return prompt
    .split(/(?:\r?\n)+|(?<=[.!?;])\s+/u)
    .map((sentence) => normalizeSentence(sentence))
    .filter((sentence): sentence is string => Boolean(sentence))
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

  const preferMatch = /\bi(?: would|'d)? prefer\s+(.+)/iu.exec(trimmed)
  if (preferMatch?.[1]) {
    const clause = cleanMemoryValue(preferMatch[1])
    if (looksLikeDurablePreferenceClause(clause)) {
      return `User prefers ${clause}.`
    }
  }

  if (
    /\buse\s+(?:metric|imperial|us customary)\s+units\b/iu.test(trimmed) &&
    !looksLikeOneOffFormattingRequest(trimmed)
  ) {
    return toSentence(trimmed)
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
    /\b(?:always|never)\b/iu.test(trimmed) &&
    /\b(?:answer|response|reply|recommend|write|format|mention|summari(?:ze|zing)|ask)\b/iu.test(trimmed)
  ) {
    return toSentence(trimmed.replace(/^please\s+/iu, ''))
  }

  if (
    /^when\b/iu.test(trimmed) &&
    /\b(?:answer|response|reply|recommend|write|format|summari(?:ze|zing)|show|use)\b/iu.test(trimmed)
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

function shiftDate(value: Date, days: number): Date {
  const copy = new Date(value)
  copy.setDate(copy.getDate() + days)
  return copy
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatLocalTime(value: Date): string {
  const hours = String(value.getHours()).padStart(2, '0')
  const minutes = String(value.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

function normalizeMemoryLookup(value: string): string | null {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    return null
  }

  return normalized
    .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+—\s+/u, '')
    .replace(/^\d{2}:\d{2}\s+—\s+/u, '')
    .replace(/[.!?]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
}

function buildLongTermMemoryMapKey(
  section: AssistantLongTermMemorySection,
  text: string,
): string | null {
  const normalized = normalizeMemoryLookup(text)
  if (!normalized) {
    return null
  }

  const replaceKey = deriveLongTermReplaceKey(section, text)
  return replaceKey
    ? `${section.toLowerCase()}|slot:${replaceKey}`
    : `${section.toLowerCase()}|text:${normalized}`
}

function buildDailyMemoryMapKey(text: string): string | null {
  const normalized = normalizeMemoryLookup(text)
  if (!normalized) {
    return null
  }

  const replaceKey =
    deriveIdentityReplaceKey(normalized) ??
    deriveAssistantBehaviorReplaceKey(normalized) ??
    deriveHealthContextReplaceKey(normalized)

  return replaceKey ? `daily|slot:${replaceKey}` : `daily|text:${normalized}`
}

function deriveLongTermReplaceKey(
  section: AssistantLongTermMemorySection,
  text: string,
): string | null {
  const normalized = normalizeMemoryLookup(text)
  if (!normalized) {
    return null
  }

  if (section === 'Identity' && normalized.startsWith('call the user ')) {
    return 'identity:name'
  }

  if (section === 'Preferences' || section === 'Standing instructions') {
    return deriveAssistantBehaviorReplaceKey(normalized)
  }

  if (section === 'Health context') {
    return deriveHealthContextReplaceKey(normalized)
  }

  return null
}

function deriveIdentityReplaceKey(text: string): string | null {
  return text.startsWith('call the user ') ? 'identity:name' : null
}

function deriveAssistantBehaviorReplaceKey(text: string): string | null {
  if (/\buse\s+(?:metric|imperial|us customary)\s+units\b/iu.test(text)) {
    return 'assistant-style:units'
  }

  if (
    RESPONSE_CONTEXT_PATTERN.test(text) &&
    /\b(?:brief|concise|detailed)\b/iu.test(text)
  ) {
    return 'assistant-style:verbosity'
  }

  if (RESPONSE_CONTEXT_PATTERN.test(text) && /\bbullet(?: point)?s?\b/iu.test(text)) {
    return 'assistant-style:format:bullets'
  }

  if (RESPONSE_CONTEXT_PATTERN.test(text) && /\btable(?:s)?\b/iu.test(text)) {
    return 'assistant-style:format:tables'
  }

  if (/\btone\b/iu.test(text)) {
    return 'assistant-style:tone'
  }

  return null
}

function deriveHealthContextReplaceKey(text: string): string | null {
  const allergyMatch = /^user is allergic to (.+)$/iu.exec(text)
  if (allergyMatch?.[1]) {
    const subject = normalizeHealthSubjectKey(allergyMatch[1])
    return subject ? `health:allergy:${subject}` : null
  }

  const medicationMatch = /^user takes (.+)$/iu.exec(text)
  if (medicationMatch?.[1]) {
    const subject = normalizeHealthSubjectKey(medicationMatch[1])
    return subject ? `health:medication:${subject}` : null
  }

  const usageMatch = /^user uses (.+)$/iu.exec(text)
  if (usageMatch?.[1]) {
    const subject = normalizeHealthSubjectKey(usageMatch[1])
    return subject ? `health:use:${subject}` : null
  }

  const trackingMatch = /^user (?:tracks|monitors) (.+)$/iu.exec(text)
  if (trackingMatch?.[1]) {
    const subject = normalizeHealthSubjectKey(trackingMatch[1])
    return subject ? `health:tracked:${subject}` : null
  }

  const measurementMatch =
    /^user's (.+?)\s+(?:is|was|are|were)\s+.+$/iu.exec(text)
  if (measurementMatch?.[1]) {
    const subject = normalizeHealthSubjectKey(measurementMatch[1])
    return subject ? `health:measurement:${subject}` : null
  }

  return null
}

function normalizeHealthSubjectKey(value: string): string | null {
  const normalized = normalizeMemoryLookup(value)
  if (!normalized) {
    return null
  }

  return normalizeNullableString(
    normalized
      .replace(
        /\b\d+(?:\.\d+)?\s*(?:g|iu|mcg|mg|ml|units?)\b.*$/u,
        '',
      )
      .replace(/\b(?:as needed|daily|monthly|nightly|prn|weekly)\b.*$/u, '')
      .replace(/[,:;].*$/u, '')
      .trim(),
  )
}

function createDefaultLongTermMemoryDocument(): ParsedMarkdownDocument {
  return {
    preambleLines: [
      '# Assistant memory',
      '',
      'This file lives outside the canonical vault. It stores non-canonical conversational memory such as naming, response preferences, standing instructions, and selected health context.',
      'If anything here conflicts with the vault, trust the vault. Newer bullets override older bullets.',
    ],
    sections: LONG_TERM_MEMORY_SECTIONS.map((heading) => ({
      heading,
      lines: [],
    })),
  }
}

function createDefaultDailyMemoryDocument(now: Date): ParsedMarkdownDocument {
  return {
    preambleLines: [
      `# Daily assistant memory — ${formatLocalDate(now)}`,
      '',
      'This file lives outside the canonical vault and stores short-lived conversational context for recent sessions only.',
    ],
    sections: [
      {
        heading: 'Notes',
        lines: [],
      },
    ],
  }
}

function parseMarkdownDocument(text: string): ParsedMarkdownDocument {
  const lines = text.replace(/\r\n/gu, '\n').split('\n')
  const preambleLines: string[] = []
  const sections: MarkdownSection[] = []
  let activeSection: MarkdownSection | null = null

  for (const line of lines) {
    const sectionMatch = /^##\s+(.+)$/u.exec(line)
    if (sectionMatch?.[1]) {
      activeSection = {
        heading: sectionMatch[1].trim(),
        lines: [],
      }
      sections.push(activeSection)
      continue
    }

    if (activeSection) {
      activeSection.lines.push(line)
    } else {
      preambleLines.push(line)
    }
  }

  return {
    preambleLines,
    sections,
  }
}

function renderMarkdownDocument(document: ParsedMarkdownDocument): string {
  const chunks: string[] = []
  const preamble = document.preambleLines.join('\n').trimEnd()
  if (preamble.length > 0) {
    chunks.push(preamble)
  }

  for (const section of document.sections) {
    const body = section.lines.join('\n').replace(/\n+$/u, '')
    chunks.push(body.length > 0 ? `## ${section.heading}\n${body}` : `## ${section.heading}`)
  }

  return `${chunks.join('\n\n').trimEnd()}\n`
}

function findOrCreateSection(
  document: ParsedMarkdownDocument,
  heading: string,
): MarkdownSection {
  const existing = document.sections.find((section) => section.heading === heading)
  if (existing) {
    return existing
  }

  const created = {
    heading,
    lines: [],
  }
  document.sections.push(created)
  return created
}

function getSectionBulletKeys(section: MarkdownSection): string[] {
  return section.lines
    .map((line) => parseBulletLine(line))
    .filter((line): line is string => Boolean(line))
    .map((line) => normalizeMemoryLookup(line))
    .filter((line): line is string => Boolean(line))
}

function getSectionBullets(
  section: MarkdownSection,
  sectionName: AssistantLongTermMemorySection,
): AssistantMemoryBullet[] {
  return section.lines
    .map((line) => parseBulletLine(line))
    .filter((line): line is string => Boolean(line))
    .map((rawText) => {
      const key = normalizeMemoryLookup(rawText)
      if (!key) {
        return null
      }

      return {
        key,
        rawText,
        replaceKey: deriveLongTermReplaceKey(sectionName, rawText),
      }
    })
    .filter((bullet): bullet is AssistantMemoryBullet => Boolean(bullet))
}

function renderSectionBulletLines(bullets: AssistantMemoryBullet[]): string[] {
  return bullets.flatMap((bullet, index) =>
    index === 0 ? [`- ${bullet.rawText}`] : ['', `- ${bullet.rawText}`],
  )
}

function parseBulletLine(line: string): string | null {
  const match = /^\s*-\s+(.+)$/u.exec(line)
  if (!match?.[1]) {
    return null
  }

  return normalizeNullableString(match[1])
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

async function readOptionalText(filePath: string): Promise<string | null> {
  try {
    const raw = await readFile(filePath, 'utf8')
    return normalizeNullableString(raw)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }
    throw error
  }
}
