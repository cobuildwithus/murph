import { createIntegratedVaultServices } from '@murphai/vault-usecases/vault-services'

export function createCliVaultUsecaseServices() {
  return createIntegratedVaultServices({
    async readAssistantOutboxIntent(vault, intentId) {
      const { readAssistantOutboxIntent } = await import(
        '@murphai/assistant-engine/assistant-outbox'
      )
      return readAssistantOutboxIntent(vault, intentId)
    },
  })
}
