import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AssistantOperatorDefaults } from '@murphai/assistant-core/operator-config'
import { resolveAssistantOperatorDefaults } from '@murphai/assistant-core/operator-config'
import { normalizeNullableString as normalizeOptionalText } from '@murphai/assistant-core/text/shared'
import { loadIntegratedRuntime } from '@murphai/assistant-core/usecases/runtime'
import { VaultCliError } from '@murphai/assistant-core/vault-cli-errors'

export const DEFAULT_DEEPTHINK_MODEL = 'gpt-5.4-pro'
export const DEFAULT_DEEPTHINK_THINKING = 'extended'
export const DEFAULT_REVIEW_GPT_TIMEOUT = '40m'

const WORKSPACE_ROOT_CANDIDATE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

interface ReviewGptWorkspacePackageJson {
  scripts?: Record<string, string | undefined>
}

export type ReviewGptExecutionMode = 'deep-research' | 'gpt-pro'

export interface ReviewGptPromptInput {
  vault: string
  prompt: string
  mode: ReviewGptExecutionMode
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

export interface ReviewGptWarningBuilderInput {
  mode: ReviewGptExecutionMode
  defaults: AssistantOperatorDefaults | null
}

export type BuildReviewGptWarnings = (
  input: ReviewGptWarningBuilderInput,
) => string[]

export interface ReviewGptRuntimeDependencies {
  env?: NodeJS.ProcessEnv
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
}

interface BuiltReviewGptCommand {
  command: string
  args: string[]
}

export interface ReviewGptPromptResult {
  chat: string | null
  mode: ReviewGptExecutionMode
  model: string | null
  prompt: string
  response: string
  responseLength: number
  thinking: string | null
  warnings: string[]
}

export function buildReviewGptCommand(input: {
  prompt: string
  responseFile: string
  mode: ReviewGptExecutionMode
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

export async function runReviewGptPrompt(
  input: ReviewGptPromptInput,
  dependencies: ReviewGptRuntimeDependencies = {},
  options: {
    buildWarnings?: BuildReviewGptWarnings
  } = {},
): Promise<ReviewGptPromptResult> {
  const prompt = normalizeReviewGptPrompt(input.prompt)
  const workspaceRoot = (dependencies.resolveWorkspaceRoot ??
    resolveReviewGptWorkspaceRoot)({
    prompt,
    vault: input.vault,
  })
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
  const resolveAssistantDefaults =
    dependencies.resolveAssistantDefaults ?? resolveAssistantOperatorDefaults
  const assistantDefaults = await resolveAssistantDefaults()
  const warnings = options.buildWarnings
    ? options.buildWarnings({
        mode: input.mode,
        defaults: assistantDefaults,
      })
    : []

  const temporaryDirectory = await createTempDirectory('murph-review-gpt-')
  const responseFile = path.join(temporaryDirectory, 'response.md')

  try {
    const reviewGptCommand = buildReviewGptCommand({
      prompt,
      responseFile,
      mode: input.mode,
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

    const response = normalizeReviewGptResponse(await readTextFile(responseFile))
    const model = input.mode === 'gpt-pro' ? DEFAULT_DEEPTHINK_MODEL : null
    const thinking = input.mode === 'gpt-pro' ? DEFAULT_DEEPTHINK_THINKING : null

    return {
      chat: normalizeOptionalText(input.chat) ?? null,
      mode: input.mode,
      model,
      prompt,
      response,
      responseLength: response.length,
      thinking,
      warnings,
    }
  } finally {
    await removePath(temporaryDirectory)
  }
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

export async function saveVaultTextNote(input: {
  vault: string
  relativePath: string
  content: string
  operationType: string
  overwrite?: boolean
  summary: string
}): Promise<void> {
  const runtime = await loadIntegratedRuntime()
  await runtime.core.applyCanonicalWriteBatch({
    vaultRoot: input.vault,
    operationType: input.operationType,
    summary: input.summary,
    textWrites: [
      {
        relativePath: input.relativePath,
        content: input.content,
        overwrite: input.overwrite ?? false,
      },
    ],
  })
}

export function normalizeReviewGptPrompt(value: string): string {
  const normalized = String(value ?? '').replace(/\r\n?/gu, '\n').trim()
  if (normalized.length === 0) {
    throw new VaultCliError(
      'invalid_prompt',
      'Prompts must not be empty.',
    )
  }

  return normalized
}

export function normalizeReviewGptPromptTitleSource(value: string): string {
  return normalizeReviewGptPrompt(value).replace(/\s+/gu, ' ')
}

export function normalizeReviewGptResponse(value: string): string {
  const normalized = String(value ?? '').trim()
  if (normalized.length === 0) {
    throw new VaultCliError(
      'research_empty_response',
      'review:gpt finished without writing a response.',
    )
  }

  return normalized
}

export function redactPromptArgs(args: readonly string[]): string[] {
  const redacted = [...args]

  for (let index = 0; index < redacted.length; index += 1) {
    if (redacted[index] === '--prompt' && index + 1 < redacted.length) {
      redacted[index + 1] = '<redacted-prompt>'
      index += 1
    }
  }

  return redacted
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
          `${input.command} exited unsuccessfully while waiting for the response.`,
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
    ) as ReviewGptWorkspacePackageJson

    return typeof packageJson.scripts?.['review:gpt'] === 'string'
  } catch {
    return false
  }
}
