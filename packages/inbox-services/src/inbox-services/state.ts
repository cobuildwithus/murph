import type {
  InboxPaths,
  InboxRuntimeModule,
  RuntimeStore,
} from '../inbox-app/types.js'
import { mkdir } from 'node:fs/promises'
import { resolveRuntimePaths } from '@murphai/runtime-state/node'
import {
  fileExists,
  relativeToVault,
} from './shared.js'

export async function ensureInitialized(
  loadInbox: () => Promise<InboxRuntimeModule>,
  vaultRoot: string,
): Promise<InboxPaths> {
  return ensureInitializedWithInbox(await loadInbox(), vaultRoot)
}

export async function ensureInitializedWithInbox(
  inboxd: InboxRuntimeModule,
  vaultRoot: string,
): Promise<InboxPaths> {
  const paths = resolveRuntimePaths(vaultRoot)
  await inboxd.ensureInboxVault(paths.absoluteVaultRoot)

  return paths
}

export async function withInitializedInboxRuntime<TResult>(
  loadInbox: () => Promise<InboxRuntimeModule>,
  vaultRoot: string,
  fn: (input: {
    paths: InboxPaths
    runtime: RuntimeStore
  }) => Promise<TResult>,
): Promise<TResult> {
  const inboxd = await loadInbox()
  const paths = await ensureInitializedWithInbox(inboxd, vaultRoot)
  const runtime = await inboxd.openInboxRuntime({
    vaultRoot: paths.absoluteVaultRoot,
  })

  try {
    return await fn({ paths, runtime })
  } finally {
    runtime.close()
  }
}

export async function ensureDirectory(
  absolutePath: string,
  createdPaths: string[],
  vaultRoot: string,
): Promise<void> {
  if (!(await fileExists(absolutePath))) {
    createdPaths.push(relativeToVault(vaultRoot, absolutePath))
  }
  await mkdir(absolutePath, { recursive: true })
}

export async function rebuildRuntime(
  paths: InboxPaths,
  inboxd: InboxRuntimeModule,
  options: {
    enqueueParserJobs?: boolean
  } = {},
): Promise<number> {
  const runtime = await inboxd.openInboxRuntime({
    vaultRoot: paths.absoluteVaultRoot,
  })

  try {
    return await inboxd.rebuildRuntimeFromVault({
      enqueueParserJobs: options.enqueueParserJobs ?? true,
      vaultRoot: paths.absoluteVaultRoot,
      runtime,
    })
  } finally {
    runtime.close()
  }
}
