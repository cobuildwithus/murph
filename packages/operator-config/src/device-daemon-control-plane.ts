import { readFile } from 'node:fs/promises'

import { resolveDeviceSyncBaseUrl } from './device-sync-client.js'
import {
  assertManagedDeviceSyncLoopbackBaseUrl,
  requireManagedDeviceSyncVaultRoot,
  resolveDeviceDaemonPaths,
} from './device-daemon/paths.js'
import {
  defaultIsProcessAlive,
  isDeviceDaemonHealthy,
} from './device-daemon/process.js'
import {
  readDeviceDaemonState,
  resolveManagedControlToken,
} from './device-daemon/state.js'

export interface ExistingManagedDeviceSyncControlPlaneDependencies {
  fetchImpl: typeof fetch
  isProcessAlive(pid: number): boolean
  readFile(path: string): Promise<string>
}

export async function resolveExistingManagedDeviceSyncControlPlane(input: {
  vault: string
  baseUrl?: string | null
  env?: NodeJS.ProcessEnv
  dependencies?: Partial<ExistingManagedDeviceSyncControlPlaneDependencies>
}): Promise<{
  baseUrl: string
  controlToken: string
  managed: true
} | null> {
  const dependencies: ExistingManagedDeviceSyncControlPlaneDependencies = {
    fetchImpl: input.dependencies?.fetchImpl ?? fetch,
    isProcessAlive: input.dependencies?.isProcessAlive ?? defaultIsProcessAlive,
    readFile:
      input.dependencies?.readFile ??
      (async (filePath) => await readFile(filePath, 'utf8')),
  }
  const vault = requireManagedDeviceSyncVaultRoot(input.vault)
  const paths = resolveDeviceDaemonPaths(vault)
  const baseUrl = resolveDeviceSyncBaseUrl(input.baseUrl, input.env ?? process.env)
  const state = await readDeviceDaemonState(paths, dependencies)

  if (state === null || state.baseUrl !== baseUrl) {
    return null
  }

  assertManagedDeviceSyncLoopbackBaseUrl(baseUrl)

  const controlToken = resolveManagedControlToken(paths)
  if (!controlToken || !dependencies.isProcessAlive(state.pid)) {
    return null
  }

  const healthy = await isDeviceDaemonHealthy(
    baseUrl,
    dependencies.fetchImpl,
    controlToken,
  )

  return healthy
    ? {
        baseUrl,
        controlToken,
        managed: true,
      }
    : null
}
