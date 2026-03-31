import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveAssistantOperatorDefaults,
  type AssistantOperatorDefaults,
} from '@murph/assistant-core/operator-config'
import { loadIntegratedRuntime } from './usecases/runtime.js'
import {
  type ResearchExecutionMode,
  type ResearchRunResult,
} from './research-cli-contracts.js'
import { normalizeNullableString as normalizeOptionalText } from '@murph/assistant-core/text/shared'
import { VaultCliError } from '@murph/assistant-core/vault-cli-errors'

const DEFAULT_DEEPTHINK_MODEL = 'gpt-5.4-pro'
const DEFAULT_DEEPTHINK_THINKING = 'extended'
const DEFAULT_REVIEW_GPT_TIMEOUT = '40m'
const WORKSPACE_ROOT_CANDIDATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

interface ResearchWorkspacePackageJson {
  scripts?: Record<string, string | undefined>
}

export interface ResearchPromptInput {
  vault: string
  prompt: string
  title?: string | null
  chat?: string | null
  browserPath?: string | null
  timeout?: string | null
  waitTimeout?: string | null
}

export interface ReviewGptProcessInvocation {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
}

export interface ReviewGptProcessResult {
  stdout: string
  stderr: string
}

export interface ResearchRuntimeDependencies {
  env?: NodeJS.ProcessEnv
  now?: () => Date
  resolveAssistantDefaults?: () => Promise<AssistantOperatorDefaults | null>
  resolveWorkspaceRoot?: (input: {
    prompt: string
    vault: string
  }) => string
  runProcess?: (
    input: ReviewGptProcessInvocation,
  ) => Promise<ReviewGptProcessResult>
  readTextFile?: (filePath: string) => Promise<string>
  removePath?: (filePath: string) => Promise<void>
  createTempDirectory?: (prefix: string) => Promise<string>
  saveNote?: (input: {
    vault: string
    relativePath: string
    content: string
    summary: string
  }) => Promise<void>
}

interface BuiltReviewGptCommand {
  command: string
  args: string[]
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

export function buildReviewGptCommand(input: {
  prompt: string
  responseFile: string
  mode: ResearchExecutionMode
  chat?: string | null
  browserPath?: string | null
  timeout?: string | null
  waitTimeout?: string | null
}): BuiltReviewGptCommand {
  const timeout = input.timeout ?? DEFAULT_REVIEW_GPT_TIMEOUT
  const args = [
    'review:gpt',
    '--no-zip',
    '--send',
    '--wait',
    '--response-file',
    input.responseFile,
    '--prompt',
    input.prompt,
  ]

  if (input.mode === 'deep-research') {
    args.push('--deep-research')
  } else {
    args.push('--model', DEFAULT_DEEPTHINK_MODEL)
    args.push('--thinking', DEFAULT_DEEPTHINK_THINKING)
  }

  if (input.chat) {
    args.push('--chat', input.chat)
  }

  if (input.browserPath) {
    args.push('--browser-path', input.browserPath)
  }

  if (timeout) {
    args.push('--timeout', timeout)
  }

  if (input.waitTimeout) {
    args.push('--wait-timeout', input.waitTimeout)
  }

  return {
    command: 'pnpm',
    args,
  }
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

  const normalizedPrompt = normalizePromptTitleSource(prompt)
  if (normalizedPrompt.length <= 80) {
    return normalizedPrompt
  }

  return `${normalizedPrompt.slice(0, 77).trimEnd()}...`
}

export function resolveReviewGptWorkspaceRoot(input: {
  prompt: string
  vault: string
}): string {
  const candidates = [
    input.vault,
    process.cwd(),
    WORKSPACE_ROOT_CANDIDATE,
  ]

  for (const candidate of candidates) {
    const resolved = findWorkspaceRootWithReviewGpt(candidate)
    if (resolved) {
      return resolved
    }
  }

  throw new VaultCliError(
    'research_tool_unavailable',
    'Could not locate a Murph workspace root containing the `review:gpt` script.',
    {
      searchedFrom: candidates.map((candidate) => path.resolve(candidate)),
    },
  )
}

export async function saveResearchNote(input: {
  vault: string
  relativePath: string
  content: string
  summary: string
}): Promise<void> {
  const runtime = await loadIntegratedRuntime()
  await runtime.core.applyCanonicalWriteBatch({
    vaultRoot: input.vault,
    operationType: 'research_note.write',
    summary: input.summary,
    textWrites: [
      {
        relativePath: input.relativePath,
        content: input.content,
        overwrite: false,
      },
    ],
  })
}

async function runResearchLikePrompt(
  mode: ResearchExecutionMode,
  input: ResearchPromptInput,
  dependencies: ResearchRuntimeDependencies,
): Promise<ResearchRunResult> {
  const prompt = normalizePrompt(input.prompt)
  const workspaceRoot = (dependencies.resolveWorkspaceRoot ??
    resolveReviewGptWorkspaceRoot)({
    prompt,
    vault: input.vault,
  })
  const now = dependencies.now ?? (() => new Date())
  const createTempDirectory =
    dependencies.createTempDirectory ??
    ((prefix: string) => mkdtemp(path.join(tmpdir(), prefix)))
  const readTextFile =
    dependencies.readTextFile ??
    (async (filePath: string) => await readFile(filePath, 'utf8'))
  const removePath = dependencies.removePath ?? (async (filePath: string) => {
    await rm(filePath, {
      force: true,
      recursive: true,
    })
  })
  const runProcess = dependencies.runProcess ?? runReviewGptProcess
  const persistNote = dependencies.saveNote ?? saveResearchNote
  const resolveAssistantDefaults =
    dependencies.resolveAssistantDefaults ?? resolveAssistantOperatorDefaults
  const assistantDefaults = await resolveAssistantDefaults()
  const warnings = buildResearchWarnings({
    mode,
    defaults: assistantDefaults,
  })

  const temporaryDirectory = await createTempDirectory('murph-research-')
  const responseFile = path.join(temporaryDirectory, 'response.md')

  try {
    const reviewGptCommand = buildReviewGptCommand({
      prompt,
      responseFile,
      mode,
      chat: normalizeOptionalText(input.chat),
      browserPath: normalizeOptionalText(input.browserPath),
      timeout: normalizeOptionalText(input.timeout),
      waitTimeout: normalizeOptionalText(input.waitTimeout),
    })

    await runProcess({
      command: reviewGptCommand.command,
      args: reviewGptCommand.args,
      cwd: workspaceRoot,
      env: dependencies.env ?? process.env,
    })

    const response = normalizeResponse(await readTextFile(responseFile))
    const savedAt = now()
    const savedAtIso = savedAt.toISOString()
    const title = deriveResearchTitle(prompt, input.title)
    const relativePath = buildResearchRelativePath(savedAt, title)
    const model = mode === 'gpt-pro' ? DEFAULT_DEEPTHINK_MODEL : null
    const thinking = mode === 'gpt-pro' ? DEFAULT_DEEPTHINK_THINKING : null
    const markdown = buildResearchMarkdown({
      title,
      prompt,
      response,
      savedAt: savedAtIso,
      mode,
      chat: normalizeOptionalText(input.chat),
      model,
      thinking,
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
      prompt,
      notePath: relativePath,
      savedAt: savedAtIso,
      response,
      responseLength: response.length,
      chat: normalizeOptionalText(input.chat) ?? null,
      model,
      thinking,
      warnings,
    }
  } finally {
    await removePath(temporaryDirectory)
  }
}

function buildResearchWarnings(input: {
  mode: ResearchExecutionMode
  defaults: AssistantOperatorDefaults | null
}): string[] {
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

async function runReviewGptProcess(
  input: ReviewGptProcessInvocation,
): Promise<ReviewGptProcessResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      reject(
        new VaultCliError(
          'research_tool_unavailable',
          `Failed to launch ${input.command}: ${error.message}`,
          {
            command: input.command,
            cwd: input.cwd,
          },
        ),
      )
    })
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve({
          stdout,
          stderr,
        })
        return
      }

      reject(
        new VaultCliError(
          'research_failed',
          `${input.command} exited unsuccessfully while waiting for the research response.`,
          {
            code,
            signal,
            command: input.command,
            args: redactPromptArgs(input.args),
            cwd: input.cwd,
            stdout,
            stderr,
          },
        ),
      )
    })
  })
}

function findWorkspaceRootWithReviewGpt(startingDirectory: string): string | null {
  let current = path.resolve(startingDirectory)
  while (true) {
    if (directoryHasReviewGptScript(current)) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

function directoryHasReviewGptScript(directoryPath: string): boolean {
  const packageJsonPath = path.join(directoryPath, 'package.json')
  const configPath = path.join(directoryPath, 'scripts', 'review-gpt.config.sh')

  if (!existsSync(packageJsonPath) || !existsSync(configPath)) {
    return false
  }

  try {
    const packageJson = JSON.parse(
      readFileSync(packageJsonPath, 'utf8'),
    ) as ResearchWorkspacePackageJson

    return typeof packageJson.scripts?.['review:gpt'] === 'string'
  } catch {
    return false
  }
}

function normalizePrompt(value: string): string {
  const normalized = String(value ?? '').replace(/\r\n?/gu, '\n').trim()
  if (normalized.length === 0) {
    throw new VaultCliError(
      'invalid_prompt',
      'Research prompts must not be empty.',
    )
  }

  return normalized
}

function normalizePromptTitleSource(value: string): string {
  return normalizePrompt(value).replace(/\s+/gu, ' ')
}

function normalizeResponse(value: string): string {
  const normalized = String(value ?? '').trim()
  if (normalized.length === 0) {
    throw new VaultCliError(
      'research_empty_response',
      'review:gpt finished without writing a research response.',
    )
  }

  return normalized
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

function redactPromptArgs(args: readonly string[]): string[] {
  const redacted = [...args]

  for (let index = 0; index < redacted.length; index += 1) {
    if (redacted[index] === '--prompt' && index + 1 < redacted.length) {
      redacted[index + 1] = '<redacted-prompt>'
      index += 1
    }
  }

  return redacted
}
