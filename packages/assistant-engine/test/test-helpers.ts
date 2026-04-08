import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

export async function createTempVaultContext(prefix: string): Promise<{
  parentRoot: string
  vaultRoot: string
}> {
  const parentRoot = await mkdtemp(path.join(tmpdir(), prefix))
  const vaultRoot = path.join(parentRoot, 'vault')
  await mkdir(vaultRoot, {
    recursive: true,
  })
  return {
    parentRoot,
    vaultRoot,
  }
}

export function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return {
    promise,
    reject,
    resolve,
  }
}

export function restoreEnvironmentVariable(
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}
