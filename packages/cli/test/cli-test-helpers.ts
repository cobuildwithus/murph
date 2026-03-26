import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CliSuccessEnvelope<TData = Record<string, unknown>> {
  ok: true
  data: TData
  meta: {
    cta?: {
      description?: string
      commands: Array<{
        command: string
        description?: string
      }>
    }
    command: string
    duration: string
  }
}

export interface CliErrorEnvelope {
  ok: false
  error: {
    code?: string
    message?: string
    retryable?: boolean
  }
  meta: {
    cta?: {
      description?: string
      commands: Array<{
        command: string
        description?: string
      }>
    }
    command: string
    duration: string
  }
}

export type CliEnvelope<TData = Record<string, unknown>> =
  | CliSuccessEnvelope<TData>
  | CliErrorEnvelope

export const packageDir = fileURLToPath(new URL('../', import.meta.url))
export const repoRoot = path.resolve(packageDir, '../..')
export const binPath = path.join(packageDir, 'dist/bin.js')
const cliIndexPath = path.join(packageDir, 'dist/index.js')
const CLI_MAX_OUTPUT_BUFFER_BYTES = 8 * 1024 * 1024
const CLI_RUNTIME_ARTIFACT_WAIT_TIMEOUT_MS = 15_000
const CLI_RUNTIME_ARTIFACT_WAIT_INTERVAL_MS = 100
const forwardedCliEnvKeys = [
  'CI',
  'COLORTERM',
  'FORCE_COLOR',
  'HOME',
  'LANG',
  'NODE_ENV',
  'NO_COLOR',
  'PATH',
  'SHELL',
  'SYSTEMROOT',
  'TERM',
  'TMP',
  'TMPDIR',
  'TZ',
  'VAULT',
] as const
const requiredRuntimeArtifactPaths = [
  path.join(repoRoot, 'packages/contracts/dist/index.js'),
  path.join(repoRoot, 'packages/contracts/dist/index.d.ts'),
  path.join(repoRoot, 'packages/contracts/dist/command-capabilities.js'),
  path.join(repoRoot, 'packages/contracts/dist/command-capabilities.d.ts'),
  path.join(repoRoot, 'packages/runtime-state/dist/index.js'),
  path.join(repoRoot, 'packages/runtime-state/dist/index.d.ts'),
  path.join(repoRoot, 'packages/core/dist/index.js'),
  path.join(repoRoot, 'packages/core/dist/index.d.ts'),
  path.join(repoRoot, 'packages/importers/dist/index.js'),
  path.join(repoRoot, 'packages/importers/dist/index.d.ts'),
  path.join(repoRoot, 'packages/importers/dist/core-port.js'),
  path.join(repoRoot, 'packages/importers/dist/core-port.d.ts'),
  path.join(repoRoot, 'packages/device-syncd/dist/index.js'),
  path.join(repoRoot, 'packages/device-syncd/dist/index.d.ts'),
  path.join(repoRoot, 'packages/query/dist/index.js'),
  path.join(repoRoot, 'packages/query/dist/index.d.ts'),
  path.join(repoRoot, 'packages/inboxd/dist/index.js'),
  path.join(repoRoot, 'packages/inboxd/dist/index.d.ts'),
  path.join(repoRoot, 'packages/parsers/dist/index.js'),
  path.join(repoRoot, 'packages/parsers/dist/index.d.ts'),
  binPath,
  cliIndexPath,
  path.join(repoRoot, 'packages/cli/dist/vault-cli-contracts.js'),
  path.join(repoRoot, 'packages/cli/dist/inbox-cli-contracts.js'),
]
let cliRuntimeArtifactsVerified = false
const strippedTestRunnerEnvKeys = ['NODE_OPTIONS', 'VITEST'] as const
const strippedTestRunnerEnvPrefixes = ['VITEST_', 'C8_', 'NYC_'] as const

function withoutVitestRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nextEnv = { ...env }

  for (const key of strippedTestRunnerEnvKeys) {
    delete nextEnv[key]
  }

  for (const key of Object.keys(nextEnv)) {
    if (strippedTestRunnerEnvPrefixes.some((prefix) => key.startsWith(prefix))) {
      delete nextEnv[key]
    }
  }

  return nextEnv
}

export function withoutNodeV8Coverage(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nextEnv = withoutVitestRuntimeEnv(env)
  delete nextEnv.NODE_V8_COVERAGE

  return nextEnv
}

function selectCliBaseEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {}

  for (const key of forwardedCliEnvKeys) {
    const value = env[key]
    if (value !== undefined) {
      nextEnv[key] = value
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('LC_') && value !== undefined) {
      nextEnv[key] = value
    }
  }

  return nextEnv
}

export async function runCli<TData = Record<string, unknown>>(
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
    stdin?: string
  },
): Promise<CliEnvelope<TData>> {
  return runCliAttempt(args, options, true)
}

async function runCliAttempt<TData = Record<string, unknown>>(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv
    stdin?: string
  } | undefined,
  allowRetry: boolean,
): Promise<CliEnvelope<TData>> {
  try {
    const { stdout } = await execCli(withMachineOutput(args), options)
    const result = JSON.parse(stdout) as CliEnvelope<TData>

    if (allowRetry && shouldRetryCliEnvelope(result) && (await waitForCliRuntimeArtifacts())) {
      return runCliAttempt(args, options, false)
    }

    return result
  } catch (error) {
    const output = commandOutputFromError(error)
    if (output !== null) {
      try {
        return JSON.parse(output) as CliEnvelope<TData>
      } catch {
        throw new Error(`CLI command failed before emitting JSON:\n${output}`)
      }
    }

    throw error
  }
}

export async function runRawCli(
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
    stdin?: string
  },
): Promise<string> {
  try {
    const { stdout } = await execCli(args, options)

    return stdout.trim()
  } catch (error) {
    const output = commandOutputFromError(error)
    if (output !== null) {
      return output
    }

    throw error
  }
}

export function requireData<TData>(result: CliEnvelope<TData>): TData {
  if (!result.ok) {
    throw new Error(
      `CLI result failed: ${result.error.message ?? result.error.code ?? 'unknown error'}`,
    )
  }

  return result.data
}

export function commandOutputFromError(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null
  }

  const maybeOutput = error as {
    stdout?: Buffer | string
    stderr?: Buffer | string
  }

  return decodeCommandOutput(maybeOutput.stdout) ?? decodeCommandOutput(maybeOutput.stderr)
}

export async function ensureCliRuntimeArtifacts(): Promise<void> {
  if (
    cliRuntimeArtifactsVerified &&
    requiredRuntimeArtifactPaths.every((artifactPath) => existsSync(artifactPath))
  ) {
    return
  }

  if (await verifyCliRuntimeArtifacts()) {
    return
  }

  if (await waitForCliRuntimeArtifacts()) {
    return
  }

  throw createMissingRuntimeArtifactsError()
}

export async function rebuildCliRuntimeArtifacts(): Promise<void> {
  await ensureCliRuntimeArtifacts()
}

function decodeCommandOutput(output: Buffer | string | undefined): string | null {
  if (typeof output === 'string') {
    return output.trim().length > 0 ? output : null
  }

  if (Buffer.isBuffer(output)) {
    const text = output.toString('utf8').trim()
    return text.length > 0 ? text : null
  }

  return null
}

function withMachineOutput(args: string[]): string[] {
  const nextArgs = [...args]

  if (!nextArgs.includes('--verbose')) {
    nextArgs.push('--verbose')
  }

  if (!nextArgs.includes('--json') && !nextArgs.includes('--format')) {
    nextArgs.push('--format', 'json')
  }

  return nextArgs
}

async function execCli(
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
    stdin?: string
  }
) {
  await ensureCliRuntimeArtifacts()

  try {
    return await execCliProcess(args, options)
  } catch (error) {
    if (shouldRetryCliExecution(error) && (await waitForCliRuntimeArtifacts())) {
      return await execCliProcess(args, options)
    }

    throw error
  }
}

async function execCliProcess(
  args: string[],
  options?: {
    env?: NodeJS.ProcessEnv
    stdin?: string
  },
) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [binPath, ...args],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: withoutNodeV8Coverage({
          ...selectCliBaseEnv(),
          ...options?.env,
        }),
        maxBuffer: CLI_MAX_OUTPUT_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stderr, stdout })
          reject(error)
          return
        }

        resolve({ stdout, stderr })
      },
    )

    child.stdin?.end(options?.stdin)
  })
}

async function verifyCliRuntimeArtifacts(): Promise<boolean> {
  cliRuntimeArtifactsVerified = requiredRuntimeArtifactPaths.every((artifactPath) =>
    existsSync(artifactPath),
  )
  return cliRuntimeArtifactsVerified
}

async function waitForCliRuntimeArtifacts(): Promise<boolean> {
  const deadline = Date.now() + CLI_RUNTIME_ARTIFACT_WAIT_TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, CLI_RUNTIME_ARTIFACT_WAIT_INTERVAL_MS))

    if (await verifyCliRuntimeArtifacts()) {
      return true
    }
  }

  return false
}

function shouldRetryCliExecution(error: unknown): boolean {
  return shouldRetryCliOutput(commandOutputFromError(error))
}

function shouldRetryCliEnvelope(result: CliEnvelope<unknown>): boolean {
  if (result.ok) {
    return false
  }

  return shouldRetryCliOutput(result.error.message ?? result.error.code ?? null)
}

function shouldRetryCliOutput(output: string | null): boolean {
  if (output === null) {
    return false
  }

  return (
    (output.includes('ERR_MODULE_NOT_FOUND') || output.includes('Cannot find module')) &&
    output.includes('/packages/') &&
    output.includes('/dist/')
  )
}

function createMissingRuntimeArtifactsError(): Error {
  const missingArtifacts = requiredRuntimeArtifactPaths.filter(
    (artifactPath) => !existsSync(artifactPath),
  )
  const relativeMissingArtifacts = missingArtifacts.map((artifactPath) =>
    path.relative(repoRoot, artifactPath),
  )
  const detail =
    relativeMissingArtifacts.length > 0
      ? ` Missing artifacts: ${relativeMissingArtifacts.join(', ')}.`
      : ''

  return new Error(
    `Built CLI runtime artifacts are unavailable.${detail} Run \`pnpm build\` before invoking CLI integration tests.`,
  )
}
