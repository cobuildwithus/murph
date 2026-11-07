import { resolveRuntimePaths } from '@murphai/runtime-state/node'
import type { InboxAppEnvironment, InboxServices } from './types.js'
import { ensureConfigFile, ensureDirectory, rebuildRuntime } from '../inbox-services/state.js'
import { fileExists, relativeToVault } from '../inbox-services/shared.js'

export function createInboxInitOps(env: InboxAppEnvironment): Pick<InboxServices, 'init'> {
  const initInboxRuntime = async (input: {
    vault: string
    requestId: string | null
    rebuild?: boolean
    rebuildParserJobs?: boolean
  }) => {
    const paths = resolveRuntimePaths(input.vault)
    const inboxd = await env.loadInbox()
    await inboxd.ensureInboxVault(paths.absoluteVaultRoot)

    const createdPaths: string[] = []
    await ensureDirectory(paths.runtimeRoot, createdPaths, paths.absoluteVaultRoot)
    await ensureDirectory(
      paths.inboxRuntimeRoot,
      createdPaths,
      paths.absoluteVaultRoot,
    )
    await ensureConfigFile(paths, createdPaths)

    if (!(await fileExists(paths.inboxDbPath))) {
      createdPaths.push(relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath))
    }

    const runtime = await inboxd.openInboxRuntime({
      vaultRoot: paths.absoluteVaultRoot,
    })
    runtime.close()

    let rebuiltCaptures = 0
    if (input.rebuild) {
      rebuiltCaptures = await rebuildRuntime(paths, inboxd, {
        enqueueParserJobs: input.rebuildParserJobs ?? true,
      })
    }

    return {
      vault: paths.absoluteVaultRoot,
      runtimeDirectory: relativeToVault(
        paths.absoluteVaultRoot,
        paths.inboxRuntimeRoot,
      ),
      databasePath: relativeToVault(paths.absoluteVaultRoot, paths.inboxDbPath),
      configPath: relativeToVault(paths.absoluteVaultRoot, paths.inboxConfigPath),
      createdPaths,
      rebuiltCaptures,
    }
  }

  return { init: initInboxRuntime }
}
