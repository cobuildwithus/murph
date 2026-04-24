import path from 'node:path'
import { stat } from 'node:fs/promises'
import { VAULT_METADATA_FILE } from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

export async function assertInitializedVaultRoot(vaultRoot: string): Promise<void> {
  try {
    const metadata = await stat(path.join(vaultRoot, VAULT_METADATA_FILE))
    if (metadata.isFile()) {
      return
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error
    }
  }

  throw new VaultCliError(
    'invalid_vault',
    'The selected vault is not initialized. Run `vault-cli init --vault <path>` first.',
  )
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}
