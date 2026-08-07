import { withAssistantRuntimeWriteLock } from '@murphai/vault-usecases/assistant-runtime-write-lock'

const vaultRoot = process.argv[2]
if (!vaultRoot) {
  throw new Error('Missing vault root.')
}

await withAssistantRuntimeWriteLock(vaultRoot, async () => {
  process.stdout.write('locked\n')
  process.stdin.resume()
  await new Promise<void>((resolve) => process.stdin.once('end', resolve))
})
