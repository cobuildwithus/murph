export const ASSISTANTD_VAULT_MISMATCH_CODE = 'ASSISTANTD_VAULT_MISMATCH'

export function createAssistantdVaultMismatchError(_input: {
  configuredVault: string
  requestedVault: string
}): Error & { code: typeof ASSISTANTD_VAULT_MISMATCH_CODE } {
  const error = new Error(
    'Request vault does not match the daemon-bound vault.',
  ) as Error & { code: typeof ASSISTANTD_VAULT_MISMATCH_CODE }
  error.code = ASSISTANTD_VAULT_MISMATCH_CODE
  return error
}
