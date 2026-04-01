import { spawn } from 'node:child_process'
import { chmodSync, closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  DEVICE_DAEMON_HEALTH_POLL_MS,
  type DeviceDaemonDependencies,
} from './types.js'

const DEVICE_DAEMON_RUNTIME_DIRECTORY_MODE = 0o700
const DEVICE_DAEMON_LOG_FILE_MODE = 0o600
const REDACTED_SECRET_TEXT = '[REDACTED]'
const SENSITIVE_DAEMON_LOG_VALUE_PATTERN =
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/giu
const SENSITIVE_DAEMON_HEADER_ASSIGNMENT_PATTERN =
  /((?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*["']?)([^"',;\r\n]+)(["']?)/giu
const SENSITIVE_DAEMON_INLINE_ASSIGNMENT_PATTERN =
  /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|token)\s*[:=]\s*["']?)([^"'\s,;\]}]{4,})(["']?)/giu

function sanitizeChildProcessEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const nextEnv = { ...env }
  delete nextEnv.NODE_V8_COVERAGE
  return nextEnv
}

export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function defaultSpawnDeviceDaemonProcess(input: {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  stdoutPath: string
  stderrPath: string
}): Promise<{ pid: number }> {
  for (const directoryPath of new Set([
    path.dirname(input.stdoutPath),
    path.dirname(input.stderrPath),
  ])) {
    await ensurePrivateDeviceDaemonDirectory(directoryPath)
  }

  let stdoutFd: number | null = null
  let stderrFd: number | null = null

  try {
    stdoutFd = openPrivateDeviceDaemonLogFile(input.stdoutPath)
    stderrFd = openPrivateDeviceDaemonLogFile(input.stderrPath)
  } catch (error) {
    if (stdoutFd !== null) {
      closeSync(stdoutFd)
    }
    if (stderrFd !== null) {
      closeSync(stderrFd)
    }
    throw error
  }

  if (stdoutFd === null || stderrFd === null) {
    throw new Error('Device sync daemon log files could not be opened.')
  }

  const resolvedStdoutFd = stdoutFd
  const resolvedStderrFd = stderrFd

  return await new Promise((resolve, reject) => {
    try {
      const child = spawn(input.command, input.args, {
        detached: true,
        stdio: ['ignore', resolvedStdoutFd, resolvedStderrFd],
        env: sanitizeChildProcessEnv(input.env),
      })

      child.once('error', (error) => {
        closeSync(resolvedStdoutFd)
        closeSync(resolvedStderrFd)
        reject(error)
      })
      child.once('spawn', () => {
        child.unref()
        closeSync(resolvedStdoutFd)
        closeSync(resolvedStderrFd)
        if (!child.pid) {
          reject(new Error('Device sync daemon spawn did not yield a PID.'))
          return
        }
        resolve({ pid: child.pid })
      })
    } catch (error) {
      closeSync(resolvedStdoutFd)
      closeSync(resolvedStderrFd)
      reject(error)
    }
  })
}

export async function isDeviceDaemonHealthy(
  baseUrl: string,
  fetchImpl: typeof fetch,
  controlToken?: string | null,
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {}
    if (controlToken) {
      headers['Authorization'] = `Bearer ${controlToken}`
    }
    const response = await fetchImpl(new URL('healthz', `${baseUrl}/`), {
      signal: AbortSignal.timeout(750),
      headers,
    })
    return response.ok
  } catch {
    return false
  }
}

export async function waitForDeviceDaemonHealth(
  baseUrl: string,
  dependencies: Pick<DeviceDaemonDependencies, 'now' | 'sleep' | 'fetchImpl'>,
  timeoutMs: number,
  controlToken?: string | null,
): Promise<boolean> {
  const deadline = dependencies.now().valueOf() + timeoutMs

  while (dependencies.now().valueOf() < deadline) {
    if (await isDeviceDaemonHealthy(baseUrl, dependencies.fetchImpl, controlToken)) {
      return true
    }

    await dependencies.sleep(DEVICE_DAEMON_HEALTH_POLL_MS)
  }

  return false
}

export async function waitForDeviceDaemonExit(
  pid: number,
  dependencies: Pick<DeviceDaemonDependencies, 'now' | 'sleep' | 'isProcessAlive'>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = dependencies.now().valueOf() + timeoutMs

  while (dependencies.now().valueOf() < deadline) {
    if (!dependencies.isProcessAlive(pid)) {
      return true
    }

    await dependencies.sleep(DEVICE_DAEMON_HEALTH_POLL_MS)
  }

  return false
}

export async function readRecentDeviceDaemonLog(
  logPath: string,
  dependencies: Pick<DeviceDaemonDependencies, 'readFile'>,
): Promise<string | null> {
  try {
    const text = await dependencies.readFile(logPath)
    const lines = text
      .split(/\r?\n/u)
      .map((line) => sanitizeDeviceDaemonLogSnippet(line.trim()))
      .filter(Boolean)

    if (lines.length === 0) {
      return null
    }

    return lines.slice(-4).join(' ')
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    throw error
  }
}

function sanitizeDeviceDaemonLogSnippet(value: string): string {
  return value
    .replace(
      SENSITIVE_DAEMON_HEADER_ASSIGNMENT_PATTERN,
      (_match, prefix: string, _value: string, suffix: string) =>
        `${prefix}${REDACTED_SECRET_TEXT}${suffix}`,
    )
    .replace(SENSITIVE_DAEMON_LOG_VALUE_PATTERN, (match) => {
      const scheme = match.split(/\s+/u, 1)[0]
      return `${scheme} ${REDACTED_SECRET_TEXT}`
    })
    .replace(
      SENSITIVE_DAEMON_INLINE_ASSIGNMENT_PATTERN,
      (_match, prefix: string, _value: string, suffix: string) =>
        `${prefix}${REDACTED_SECRET_TEXT}${suffix}`,
    )
}

async function ensurePrivateDeviceDaemonDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, {
    recursive: true,
    mode: DEVICE_DAEMON_RUNTIME_DIRECTORY_MODE,
  })
  chmodSync(directoryPath, DEVICE_DAEMON_RUNTIME_DIRECTORY_MODE)
}

function openPrivateDeviceDaemonLogFile(filePath: string): number {
  const fileDescriptor = openSync(filePath, 'a', DEVICE_DAEMON_LOG_FILE_MODE)
  chmodSync(filePath, DEVICE_DAEMON_LOG_FILE_MODE)
  return fileDescriptor
}

export function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
