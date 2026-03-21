import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  DEVICE_DAEMON_HEALTH_POLL_MS,
  type DeviceDaemonDependencies,
} from './types.js'

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
  await mkdir(path.dirname(input.stdoutPath), { recursive: true })
  const stdoutFd = openSync(input.stdoutPath, 'a')
  const stderrFd = openSync(input.stderrPath, 'a')

  return await new Promise((resolve, reject) => {
    try {
      const child = spawn(input.command, input.args, {
        detached: true,
        stdio: ['ignore', stdoutFd, stderrFd],
        env: input.env,
      })

      child.once('error', (error) => {
        closeSync(stdoutFd)
        closeSync(stderrFd)
        reject(error)
      })
      child.once('spawn', () => {
        child.unref()
        closeSync(stdoutFd)
        closeSync(stderrFd)
        if (!child.pid) {
          reject(new Error('Device sync daemon spawn did not yield a PID.'))
          return
        }
        resolve({ pid: child.pid })
      })
    } catch (error) {
      closeSync(stdoutFd)
      closeSync(stderrFd)
      reject(error)
    }
  })
}

export async function isDeviceDaemonHealthy(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(new URL('healthz', `${baseUrl}/`), {
      signal: AbortSignal.timeout(750),
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
): Promise<boolean> {
  const deadline = dependencies.now().valueOf() + timeoutMs

  while (dependencies.now().valueOf() < deadline) {
    if (await isDeviceDaemonHealthy(baseUrl, dependencies.fetchImpl)) {
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
      .map((line) => line.trim())
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

export function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
