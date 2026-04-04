import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  assistantMemoryLongTermSectionValues,
  assistantMemoryVisibleSectionValues,
} from '../assistant-cli-contracts.js'
import { withAssistantMemoryWriteLock } from './memory/locking.js'
import {
  createDefaultDailyMemoryDocument,
  createDefaultLongTermMemoryDocument,
  findOrCreateSection,
  getDailySectionBullets,
  getSectionBullets,
  parseMarkdownDocument,
  renderMarkdownDocument,
} from './memory/storage-format.js'
import {
  buildDailyMemoryMapKey,
  deriveLongTermReplaceKey,
  isLongTermSection,
  longTermMemorySections,
  normalizeMemoryLookup,
} from './memory/text.js'
import {
  ensureAssistantStateDirectory,
  isMissingFileError,
  normalizeNullableString,
  writeTextFileAtomic,
} from '../assistant/shared.js'
import { VaultCliError } from '../vault-cli-errors.js'
import { resolveAssistantMemoryStoragePaths } from './memory.js'

type AssistantMemoryVisibleSection =
  (typeof assistantMemoryVisibleSectionValues)[number]
type AssistantMemoryLongTermSection =
  (typeof assistantMemoryLongTermSectionValues)[number]

export interface AssistantMemoryFileReadResult {
  path: string
  present: boolean
  text: string
  totalChars: number
  truncated: boolean
}

export interface AssistantMemoryFileWriteResult {
  path: string
  totalChars: number
}

export interface AssistantMemoryFileAppendResult {
  appended: boolean
  path: string
  section: AssistantMemoryVisibleSection
  totalBullets: number
}

const assistantMemoryTextReadDefaultMaxChars = 8_000

export async function readAssistantMemoryMarkdownFile(
  vaultRoot: string,
  candidatePath: string,
  maxChars?: number,
  allowSensitiveHealthContext = false,
): Promise<AssistantMemoryFileReadResult> {
  const resolved = resolveAssistantMemoryMarkdownFile(vaultRoot, candidatePath)
  const limit = maxChars ?? assistantMemoryTextReadDefaultMaxChars
  let present = true
  let text: string

  try {
    text = await readFile(resolved.absolutePath, 'utf8')
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
    present = false
    text = resolved.defaultText
  }

  if (!allowSensitiveHealthContext) {
    text = sanitizeAssistantMemoryMarkdownForSharedContext(resolved.relativePath, text)
  }

  const totalChars = text.length
  const truncated = totalChars > limit

  return {
    path: resolved.relativePath,
    present,
    text:
      truncated
        ? `${text.slice(0, limit)}\n\n[truncated ${totalChars - limit} characters]`
        : text,
    totalChars,
    truncated,
  }
}

export async function writeAssistantMemoryMarkdownFile(
  vaultRoot: string,
  candidatePath: string,
  text: string,
  allowSensitiveHealthContext = false,
): Promise<AssistantMemoryFileWriteResult> {
  const resolved = resolveAssistantMemoryMarkdownFile(vaultRoot, candidatePath)
  await ensureAssistantStateDirectory(path.dirname(resolved.absolutePath))
  const normalizedText = validateAssistantMemoryMarkdownWrite({
    allowSensitiveHealthContext,
    path: resolved.relativePath,
    text,
  })
  await withAssistantMemoryWriteLock(resolveAssistantMemoryStoragePaths(vaultRoot), async () => {
    await assertAssistantMemoryMarkdownWriteAllowed({
      absolutePath: resolved.absolutePath,
      allowSensitiveHealthContext,
      path: resolved.relativePath,
    })
    await writeTextFileAtomic(resolved.absolutePath, normalizedText)
  })

  return {
    path: resolved.relativePath,
    totalChars: normalizedText.length,
  }
}

export async function appendAssistantMemoryMarkdownFile(
  vaultRoot: string,
  candidatePath: string,
  text: string,
  section: AssistantMemoryVisibleSection | undefined,
  allowSensitiveHealthContext = false,
): Promise<AssistantMemoryFileAppendResult> {
  const resolved = resolveAssistantMemoryMarkdownFile(vaultRoot, candidatePath)
  await ensureAssistantStateDirectory(path.dirname(resolved.absolutePath))
  const normalizedText = normalizeAssistantMemoryAppendText(text)

  return await withAssistantMemoryWriteLock(
    resolveAssistantMemoryStoragePaths(vaultRoot),
    async () => {
      const existingText = await readAssistantMemoryMarkdownFileForAppend(resolved)
      const document = parseMarkdownDocument(existingText)

      if (resolved.relativePath === 'MEMORY.md') {
        const targetSection = resolveAssistantLongTermAppendSection(
          section,
          allowSensitiveHealthContext,
        )
        const target = findOrCreateSection(document, targetSection)
        const existingBullets = getSectionBullets(target, targetSection)
        const key = normalizeMemoryLookup(normalizedText)
        if (!key) {
          throw new VaultCliError(
            'ASSISTANT_MEMORY_FILE_APPEND_INVALID',
            'Assistant memory append text must be one non-empty bullet line.',
          )
        }

        const existingExact = existingBullets.find((bullet) => bullet.key === key)
        if (existingExact) {
          return {
            appended: false,
            path: resolved.relativePath,
            section: targetSection,
            totalBullets: existingBullets.length,
          }
        }

        const replaceKey = deriveLongTermReplaceKey(targetSection, normalizedText)
        if (
          replaceKey &&
          existingBullets.some((bullet) => bullet.replaceKey === replaceKey)
        ) {
          throw new VaultCliError(
            'ASSISTANT_MEMORY_FILE_APPEND_REQUIRES_EDIT',
            `Assistant memory section \`${targetSection}\` already has a conflicting bullet for this slot. Read the latest file and use \`assistant memory file write\` only for the deliberate edit.`,
          )
        }

        target.lines = appendAssistantMemoryBulletLine(target.lines, normalizedText)
        const rendered = validateAssistantMemoryMarkdownWrite({
          allowSensitiveHealthContext,
          allowExistingHiddenHealthContext: !allowSensitiveHealthContext,
          path: resolved.relativePath,
          text: renderMarkdownDocument(document),
        })
        await writeTextFileAtomic(resolved.absolutePath, rendered)

        return {
          appended: true,
          path: resolved.relativePath,
          section: targetSection,
          totalBullets: existingBullets.length + 1,
        }
      }

      const targetSection = resolveAssistantDailyAppendSection(
        section,
        allowSensitiveHealthContext,
      )
      const target = findOrCreateSection(document, targetSection)
      const existingBullets = getDailySectionBullets(target)
      const key = buildDailyMemoryMapKey(normalizedText)
      if (!key) {
        throw new VaultCliError(
          'ASSISTANT_MEMORY_FILE_APPEND_INVALID',
          'Assistant memory append text must be one non-empty bullet line.',
        )
      }

      const existingExact = existingBullets.find((bullet) => bullet.key === key)
      if (existingExact) {
        return {
          appended: false,
          path: resolved.relativePath,
          section: targetSection,
          totalBullets: existingBullets.length,
        }
      }

      target.lines = appendAssistantMemoryBulletLine(target.lines, normalizedText)
      const rendered = validateAssistantMemoryMarkdownWrite({
        allowSensitiveHealthContext,
        path: resolved.relativePath,
        text: renderMarkdownDocument(document),
      })
      await writeTextFileAtomic(resolved.absolutePath, rendered)

      return {
        appended: true,
        path: resolved.relativePath,
        section: targetSection,
        totalBullets: existingBullets.length + 1,
      }
    },
  )
}

function resolveAssistantMemoryMarkdownFile(
  vaultRoot: string,
  candidatePath: string,
): {
  absolutePath: string
  defaultText: string
  relativePath: string
} {
  const normalizedPath = candidatePath.replaceAll('\\', '/').replace(/^\.\//u, '')
  const memoryPaths = resolveAssistantMemoryStoragePaths(vaultRoot)

  if (normalizedPath === 'MEMORY.md') {
    return {
      absolutePath: memoryPaths.longTermMemoryPath,
      defaultText: renderMarkdownDocument(createDefaultLongTermMemoryDocument()),
      relativePath: normalizedPath,
    }
  }

  const dailyMatch = /^memory\/(\d{4})-(\d{2})-(\d{2})\.md$/u.exec(normalizedPath)
  if (dailyMatch) {
    const year = Number(dailyMatch[1])
    const month = Number(dailyMatch[2])
    const day = Number(dailyMatch[3])
    return {
      absolutePath: path.join(memoryPaths.assistantStateRoot, normalizedPath),
      defaultText: renderMarkdownDocument(
        createDefaultDailyMemoryDocument(new Date(year, month - 1, day)),
      ),
      relativePath: normalizedPath,
    }
  }

  throw new VaultCliError(
    'ASSISTANT_MEMORY_FILE_PATH_INVALID',
    'Assistant memory file paths must be `MEMORY.md` or `memory/YYYY-MM-DD.md`.',
  )
}

function sanitizeAssistantMemoryMarkdownForSharedContext(
  relativePath: string,
  text: string,
): string {
  if (relativePath !== 'MEMORY.md') {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_FILE_ACCESS_DENIED',
      'Daily assistant memory file access requires a private assistant context.',
    )
  }

  const document = parseMarkdownDocument(text)
  const healthSection = document.sections.find((section) => section.heading === 'Health context')
  if (healthSection) {
    healthSection.lines = []
  }
  return renderMarkdownDocument(document)
}

async function readAssistantMemoryMarkdownFileForAppend(input: {
  absolutePath: string
  defaultText: string
}): Promise<string> {
  try {
    return await readFile(input.absolutePath, 'utf8')
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
    return input.defaultText
  }
}

async function assertAssistantMemoryMarkdownWriteAllowed(input: {
  absolutePath: string
  allowSensitiveHealthContext: boolean
  path: string
}): Promise<void> {
  if (input.path !== 'MEMORY.md' || input.allowSensitiveHealthContext) {
    return
  }

  let existingText: string
  try {
    existingText = await readFile(input.absolutePath, 'utf8')
  } catch (error) {
    if (isMissingFileError(error)) {
      return
    }
    throw error
  }

  if (!assistantMemoryMarkdownHasHealthBullets(existingText)) {
    return
  }

  throw new VaultCliError(
    'ASSISTANT_MEMORY_FILE_ACCESS_DENIED',
    'Shared assistant contexts must not overwrite `MEMORY.md` while durable health context is present. Use append or a private assistant context instead.',
  )
}

function resolveAssistantLongTermAppendSection(
  section: AssistantMemoryVisibleSection | undefined,
  allowSensitiveHealthContext: boolean,
): AssistantMemoryLongTermSection {
  if (!section || !isLongTermSection(section)) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_FILE_APPEND_INVALID',
      'Appending to `MEMORY.md` requires one long-term section such as `Identity` or `Preferences`.',
    )
  }

  if (section === 'Health context' && !allowSensitiveHealthContext) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_FILE_ACCESS_DENIED',
      'Shared assistant contexts must not append durable health context into `MEMORY.md`.',
    )
  }

  return section
}

function resolveAssistantDailyAppendSection(
  section: AssistantMemoryVisibleSection | undefined,
  allowSensitiveHealthContext: boolean,
): 'Notes' {
  if (!allowSensitiveHealthContext) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_FILE_ACCESS_DENIED',
      'Daily assistant memory file access requires a private assistant context.',
    )
  }

  if (section && section !== 'Notes') {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_FILE_APPEND_INVALID',
      'Daily assistant memory appends must target the `Notes` section.',
    )
  }

  return 'Notes'
}

function normalizeAssistantMemoryAppendText(text: string): string {
  if (/\r|\n/u.test(text)) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_FILE_APPEND_INVALID',
      'Assistant memory append accepts exactly one bullet line at a time.',
    )
  }

  const normalized = normalizeNullableString(text.replace(/^\s*-\s+/u, ''))
  if (!normalized || /^##\s+/u.test(normalized)) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_FILE_APPEND_INVALID',
      'Assistant memory append text must be one non-empty bullet line.',
    )
  }

  return normalized
}

function appendAssistantMemoryBulletLine(
  existingLines: string[],
  bulletText: string,
): string[] {
  const nextLines = [...existingLines]
  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
    nextLines.pop()
  }

  if (nextLines.length > 0) {
    nextLines.push('')
  }
  nextLines.push(`- ${bulletText}`)
  return nextLines
}

function validateAssistantMemoryMarkdownWrite(input: {
  allowSensitiveHealthContext: boolean
  allowExistingHiddenHealthContext?: boolean
  path: string
  text: string
}): string {
  const normalizedText = input.text.endsWith('\n') ? input.text : `${input.text}\n`
  const document = parseMarkdownDocument(normalizedText)

  if (input.path === 'MEMORY.md') {
    const headings = new Set(document.sections.map((section) => section.heading))
    for (const heading of longTermMemorySections) {
      if (!headings.has(heading)) {
        throw new VaultCliError(
          'ASSISTANT_MEMORY_FILE_INVALID',
          `Assistant long-term memory must keep the \`${heading}\` section heading.`,
        )
      }
    }

    if (!input.allowSensitiveHealthContext) {
      const healthSection = document.sections.find((section) => section.heading === 'Health context')
      const hasHealthBullets = healthSection?.lines.some((line) => /^\s*-\s+\S/u.test(line)) ?? false
      if (hasHealthBullets && !input.allowExistingHiddenHealthContext) {
        throw new VaultCliError(
          'ASSISTANT_MEMORY_FILE_ACCESS_DENIED',
          'Shared assistant contexts must not write durable health context into `MEMORY.md`.',
        )
      }
    }

    return normalizedText
  }

  if (!input.allowSensitiveHealthContext) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_FILE_ACCESS_DENIED',
      'Daily assistant memory file access requires a private assistant context.',
    )
  }

  const hasNotesSection = document.sections.some((section) => section.heading === 'Notes')
  if (!hasNotesSection) {
    throw new VaultCliError(
      'ASSISTANT_MEMORY_FILE_INVALID',
      'Daily assistant memory must keep the `Notes` section heading.',
    )
  }

  return normalizedText
}

function assistantMemoryMarkdownHasHealthBullets(text: string): boolean {
  const document = parseMarkdownDocument(text)
  const healthSection = document.sections.find((section) => section.heading === 'Health context')
  return healthSection?.lines.some((line) => /^\s*-\s+\S/u.test(line)) ?? false
}
