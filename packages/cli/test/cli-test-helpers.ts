import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
const execFileAsync = promisify(execFile)

const requiredRuntimeArtifactPaths = [
  path.join(repoRoot, 'packages/contracts/dist/index.js'),
  path.join(repoRoot, 'packages/runtime-state/dist/index.js'),
  path.join(repoRoot, 'packages/core/dist/index.js'),
  path.join(repoRoot, 'packages/importers/dist/index.js'),
  path.join(repoRoot, 'packages/query/dist/index.js'),
  path.join(repoRoot, 'packages/inboxd/dist/index.js'),
  path.join(repoRoot, 'packages/parsers/dist/index.js'),
  binPath,
]

const runtimeBuildSteps: Array<{ cwd: string; args: string[] }> = [
  { cwd: repoRoot, args: ['--dir', 'packages/contracts', 'build'] },
  { cwd: repoRoot, args: ['--dir', 'packages/runtime-state', 'build'] },
  { cwd: repoRoot, args: ['--dir', 'packages/core', 'build'] },
  { cwd: repoRoot, args: ['--dir', 'packages/importers', 'build'] },
  { cwd: repoRoot, args: ['--dir', 'packages/query', 'build'] },
  { cwd: repoRoot, args: ['--dir', 'packages/inboxd', 'build'] },
  { cwd: repoRoot, args: ['--dir', 'packages/parsers', 'build'] },
  { cwd: packageDir, args: ['build'] },
]

let cliRuntimeArtifactsPromise: Promise<void> | null = null

export async function runCli<TData = Record<string, unknown>>(
  args: string[],
  options?: {
    stdin?: string
  },
): Promise<CliEnvelope<TData>> {
  try {
    const { stdout } = await execCli(withMachineOutput(args), options)

    return JSON.parse(stdout) as CliEnvelope<TData>
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
  if (requiredRuntimeArtifactPaths.every((artifactPath) => existsSync(artifactPath))) {
    return
  }

  if (cliRuntimeArtifactsPromise === null) {
    cliRuntimeArtifactsPromise = (async () => {
      for (const step of runtimeBuildSteps) {
        await execFileAsync('pnpm', step.args, {
          cwd: step.cwd,
          encoding: 'utf8',
        })
      }
    })().finally(() => {
      cliRuntimeArtifactsPromise = null
    })
  }

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
    stdin?: string
  },
) {
  await ensureCliRuntimeArtifacts()

  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [binPath, ...args],
      {
        cwd: repoRoot,
        encoding: 'utf8',
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
