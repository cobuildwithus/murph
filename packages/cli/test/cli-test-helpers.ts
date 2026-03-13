import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
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

const execFileAsync = promisify(execFile)

export const packageDir = fileURLToPath(new URL('../', import.meta.url))
export const repoRoot = path.resolve(packageDir, '../..')
export const binPath = path.join(packageDir, 'dist/bin.js')

export async function runCli<TData = Record<string, unknown>>(
  args: string[],
): Promise<CliEnvelope<TData>> {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [binPath, ...withMachineOutput(args)],
      {
        cwd: repoRoot,
      },
    )

    return JSON.parse(stdout) as CliEnvelope<TData>
  } catch (error) {
    const output = commandOutputFromError(error)
    if (output !== null) {
      return JSON.parse(output) as CliEnvelope<TData>
    }

    throw error
  }
}

export async function runRawCli(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [binPath, ...args], {
      cwd: repoRoot,
    })

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
