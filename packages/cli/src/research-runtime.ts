import path from 'node:path'
import { normalizeNullableString as normalizeOptionalText } from '@murphai/operator-config/text/shared'
import {
  runReviewGptPrompt,
  saveVaultTextNote,
  normalizeReviewGptPromptTitleSource,
  type BuildReviewGptWarnings,
  type ReviewGptProcessInvocation,
  type ReviewGptProcessResult,
  type ReviewGptRuntimeDependencies,
} from './review-gpt-runtime.js'
import {
  type ResearchExecutionMode,
  type ResearchRunResult,
} from './research-cli-contracts.js'

export {
  buildReviewGptCommand,
  redactPromptArgs,
  resolveReviewGptWorkspaceRoot,
  type ReviewGptProcessInvocation,
  type ReviewGptProcessResult,
  type ReviewGptRuntimeDependencies,
} from './review-gpt-runtime.js'

export interface ResearchPromptInput {
  vault: string
  prompt: string
  title?: string | null
  chat?: string | null
  browserPath?: string | null
  timeout?: string | null
  waitTimeout?: string | null
}

export interface ResearchRuntimeDependencies extends ReviewGptRuntimeDependencies {
  now?: () => Date
  saveNote?: (input: {
    vault: string
    relativePath: string
    content: string
    summary: string
  }) => Promise<void>
}

export async function runResearchPrompt(
  input: ResearchPromptInput,
  dependencies: ResearchRuntimeDependencies = {},
): Promise<ResearchRunResult> {
  return runResearchLikePrompt('deep-research', input, dependencies)
}

export async function runDeepthinkPrompt(
  input: ResearchPromptInput,
  dependencies: ResearchRuntimeDependencies = {},
): Promise<ResearchRunResult> {
  return runResearchLikePrompt('gpt-pro', input, dependencies)
}

export function buildResearchRelativePath(
  savedAt: Date,
  title: string,
): string {
  const year = `${savedAt.getUTCFullYear()}`
  const month = `${savedAt.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${savedAt.getUTCDate()}`.padStart(2, '0')
  const hours = `${savedAt.getUTCHours()}`.padStart(2, '0')
  const minutes = `${savedAt.getUTCMinutes()}`.padStart(2, '0')
  const seconds = `${savedAt.getUTCSeconds()}`.padStart(2, '0')
  const milliseconds = `${savedAt.getUTCMilliseconds()}`.padStart(3, '0')
  const slug = slugifyResearchTitle(title)

  return path.posix.join(
    'research',
    year,
    month,
    `${year}-${month}-${day}-${hours}${minutes}${seconds}${milliseconds}-${slug}.md`,
  )
}

export function buildResearchMarkdown(input: {
  title: string
  prompt: string
  response: string
  savedAt: string
  mode: ResearchExecutionMode
  chat?: string | null
  model?: string | null
  thinking?: string | null
}): string {
  const metadataLines = [
    `_Source:_ review:gpt`,
    `_Mode:_ ${input.mode === 'deep-research' ? 'Deep Research' : 'GPT Pro'}`,
    `_Saved:_ ${input.savedAt}`,
    input.chat ? `_Chat:_ ${input.chat}` : null,
    input.model ? `_Model:_ ${input.model}` : null,
    input.thinking ? `_Thinking:_ ${input.thinking}` : null,
  ].filter((value): value is string => value !== null)

  return [
    `# ${input.title}`,
    '',
    ...metadataLines,
    '',
    '## Prompt',
    '',
    '```text',
    input.prompt.trim(),
    '```',
    '',
    '## Response',
    '',
    input.response.trim(),
    '',
  ].join('\n')
}

export function deriveResearchTitle(
  prompt: string,
  override?: string | null,
): string {
  const normalizedOverride = normalizeOptionalText(override)
  if (normalizedOverride) {
    return normalizedOverride
  }

  const normalizedPrompt = normalizeReviewGptPromptTitleSource(prompt)
  if (normalizedPrompt.length <= 80) {
    return normalizedPrompt
  }

  return `${normalizedPrompt.slice(0, 77).trimEnd()}...`
}

export async function saveResearchNote(input: {
  vault: string
  relativePath: string
  content: string
  summary: string
}): Promise<void> {
  await saveVaultTextNote({
    vault: input.vault,
    relativePath: input.relativePath,
    content: input.content,
    operationType: 'research_note.write',
    overwrite: false,
    summary: input.summary,
  })
}

async function runResearchLikePrompt(
  mode: ResearchExecutionMode,
  input: ResearchPromptInput,
  dependencies: ResearchRuntimeDependencies,
): Promise<ResearchRunResult> {
  const persistNote = dependencies.saveNote ?? saveResearchNote
  const now = dependencies.now ?? (() => new Date())
  const review = await runReviewGptPrompt(
    {
      vault: input.vault,
      prompt: input.prompt,
      mode,
      chat: input.chat,
      browserPath: input.browserPath,
      timeout: input.timeout,
      waitTimeout: input.waitTimeout,
    },
    dependencies,
    {
      buildWarnings: buildResearchWarnings,
    },
  )

  const savedAt = now()
  const savedAtIso = savedAt.toISOString()
  const title = deriveResearchTitle(review.prompt, input.title)
  const relativePath = buildResearchRelativePath(savedAt, title)
  const markdown = buildResearchMarkdown({
    title,
    prompt: review.prompt,
    response: review.response,
    savedAt: savedAtIso,
    mode,
    chat: review.chat,
    model: review.model,
    thinking: review.thinking,
  })

  await persistNote({
    vault: input.vault,
    relativePath,
    content: markdown,
    summary: `Saved ${mode === 'deep-research' ? 'Deep Research' : 'GPT Pro'} note "${title}".`,
  })

  return {
    vault: input.vault,
    mode,
    title,
    prompt: review.prompt,
    notePath: relativePath,
    savedAt: savedAtIso,
    response: review.response,
    responseLength: review.responseLength,
    chat: review.chat,
    model: review.model,
    thinking: review.thinking,
    warnings: review.warnings,
  }
}

const buildResearchWarnings: BuildReviewGptWarnings = (input) => {
  const account = input.defaults?.account ?? null
  const planCode =
    typeof account?.planCode === 'string' ? account.planCode.trim().toLowerCase() : null
  const planName =
    typeof account?.planName === 'string' && account.planName.trim().length > 0
      ? account.planName.trim()
      : null

  if (input.mode === 'gpt-pro') {
    if (planCode === 'pro') {
      return []
    }

    if (planName) {
      return [
        `Deepthink targets GPT Pro and may fail because the saved assistant account is ${planName}, not Pro.`,
      ]
    }

    return [
      'Deepthink targets GPT Pro and may fail because Murph could not verify a saved Pro assistant account on this machine.',
    ]
  }

  if (planCode === 'free' || planCode === 'guest') {
    return [
      `Research uses Deep Research and may be unavailable or more limited on the saved ${planName ?? 'Free'} account.`,
    ]
  }

  return []
}

function slugifyResearchTitle(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '') || 'research-note'
  )
}
