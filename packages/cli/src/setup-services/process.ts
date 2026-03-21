import { spawn } from 'node:child_process'
import { constants, createWriteStream } from 'node:fs'
import { access, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { VaultCliError } from '../vault-cli-errors.js'

export interface CommandRunInput {
  file: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

export interface CommandRunResult {
  exitCode: number
  stdout: string
  stderr: string
}

export function assertCommandSucceeded(
  result: CommandRunResult,
  code: string,
  details?: Record<string, unknown>,
): void {
  if (result.exitCode === 0) {
    return
  }

  throw new VaultCliError(
    code,
    result.stderr.trim().length > 0
      ? result.stderr.trim()
      : result.stdout.trim().length > 0
        ? result.stdout.trim()
        : 'External setup command failed.',
    {
      ...(details ?? {}),
      exitCode: result.exitCode,
    },
  )
}

export function createDefaultCommandRunner(
  log: (message: string) => void,
): (input: CommandRunInput) => Promise<CommandRunResult> {
  return async (input: CommandRunInput) => {
    return await new Promise<CommandRunResult>((resolve, reject) => {
      const child = spawn(input.file, input.args, {
        cwd: input.cwd,
        env: input.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString()
        stdout = appendOutput(stdout, text)
        if (text.trim().length > 0) {
          log(text)
        }
      })
      child.stderr.on('data', (chunk: Buffer | string) => {
        const text = chunk.toString()
        stderr = appendOutput(stderr, text)
        if (text.trim().length > 0) {
          log(text)
        }
      })
      child.on('error', reject)
      child.on('close', (exitCode) => {
        resolve({
          exitCode: exitCode ?? 1,
          stderr,
          stdout,
        })
      })
    })
  }
}

function appendOutput(current: string, next: string): string {
  const combined = `${current}${next}`
  return combined.length <= 16000 ? combined : combined.slice(-16000)
}

export async function defaultDownloadFile(
  url: string,
  destinationPath: string,
): Promise<void> {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new VaultCliError(
      'download_failed',
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    )
  }

  const tempPath = `${destinationPath}.download`
  await mkdir(path.dirname(destinationPath), { recursive: true })

  try {
    await pipeline(
      Readable.fromWeb(response.body as any),
      createWriteStream(tempPath),
    )
    await rename(tempPath, destinationPath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

export async function defaultFileExists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath)
    return true
  } catch {
    return false
  }
}

export function defaultLogger(message: string): void {
  process.stderr.write(message.endsWith('\n') ? message : `${message}\n`)
}

export async function isExecutable(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, constants.X_OK)
    return true
  } catch {
    return false
  }
}
