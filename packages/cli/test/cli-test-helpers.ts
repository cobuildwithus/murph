import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

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
const execFileAsync = promisify(execFile)
const requiredRuntimeModulePaths = [
  path.join(repoRoot, 'packages/contracts/dist/index.js'),
  path.join(repoRoot, 'packages/runtime-state/dist/index.js'),
  path.join(repoRoot, 'packages/core/dist/index.js'),
  path.join(repoRoot, 'packages/importers/dist/index.js'),
  path.join(repoRoot, 'packages/device-syncd/dist/index.js'),
  path.join(repoRoot, 'packages/query/dist/index.js'),
  path.join(repoRoot, 'packages/inboxd/dist/index.js'),
  path.join(repoRoot, 'packages/parsers/dist/index.js'),
  cliIndexPath,
]

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

const runtimeBuildSteps: Array<{ cwd: string; args: string[] }> = [
  { cwd: repoRoot, args: ['build'] },
]

let cliRuntimeArtifactsPromise: Promise<void> | null = null
let cliRuntimeArtifactsVerified = false

export function withoutNodeV8Coverage(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const nextEnv = { ...env }
  delete nextEnv.NODE_V8_COVERAGE
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
  allowEnvelopeRetry: boolean,
): Promise<CliEnvelope<TData>> {
  try {
    const { stdout } = await execCli(withMachineOutput(args), options)
    const result = JSON.parse(stdout) as CliEnvelope<TData>

    if (allowEnvelopeRetry && shouldRetryCliEnvelope(result)) {
      await rebuildCliRuntimeArtifacts()
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
  if (cliRuntimeArtifactsPromise !== null) {
    await cliRuntimeArtifactsPromise
    return
  }

  if (
    cliRuntimeArtifactsVerified &&
    requiredRuntimeArtifactPaths.every((artifactPath) => existsSync(artifactPath))
  ) {
    return
  }

  if (await verifyCliRuntimeArtifacts()) {
    return
  }

  await rebuildCliRuntimeArtifacts()
}

export async function rebuildCliRuntimeArtifacts(): Promise<void> {
  if (cliRuntimeArtifactsPromise !== null) {
    await cliRuntimeArtifactsPromise
    return
  }

  cliRuntimeArtifactsVerified = false
  cliRuntimeArtifactsPromise = (async () => {
    let lastError: unknown = null

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        for (const step of runtimeBuildSteps) {
          await execFileAsync('pnpm', step.args, {
            cwd: step.cwd,
            encoding: 'utf8',
            env: withoutNodeV8Coverage(),
          })
        }

        if (await verifyCliRuntimeArtifacts()) {
          return
        }

        lastError = new Error('CLI runtime artifacts were rebuilt but remain incomplete.')
      } catch (error) {
        lastError = error
      }
    }

    throw lastError ?? new Error('Failed to rebuild CLI runtime artifacts.')
  })().finally(() => {
    cliRuntimeArtifactsPromise = null
  })

  await cliRuntimeArtifactsPromise
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
    if (!shouldRetryCliExecution(error)) {
      throw error
    }

    await rebuildCliRuntimeArtifacts()
    return await execCliProcess(args, options)
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
          ...process.env,
          ...options?.env,
        }),
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
    (output.includes('ERR_MODULE_NOT_FOUND') ||
      output.includes('Cannot find module')) &&
      output.includes('/packages/') &&
    output.includes('/dist/')
  )
}

async function verifyCliRuntimeArtifacts(): Promise<boolean> {
  if (!requiredRuntimeArtifactPaths.every((artifactPath) => existsSync(artifactPath))) {
    cliRuntimeArtifactsVerified = false
    return false
  }

  try {
    for (const modulePath of requiredRuntimeModulePaths) {
      await execFileAsync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `await import(${JSON.stringify(pathToFileURL(modulePath).href)})`,
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: withoutNodeV8Coverage(),
        },
      )
    }

    cliRuntimeArtifactsVerified = true
    return true
  } catch {
    cliRuntimeArtifactsVerified = false
    return false
  }
}
