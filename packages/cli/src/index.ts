import { Cli } from 'incur'
import { createVaultCli } from './vault-cli.js'

const cli: Cli.Cli = createVaultCli()

export default cli
export { createVaultCli, CLI_DESCRIPTION } from './vault-cli.js'
export {
  createIntegratedInboxServices,
  createIntegratedInboxServices as createIntegratedInboxCliServices,
  type InboxCliServices,
  type InboxServices,
} from './inbox-services.js'
export {
  createIntegratedVaultServices,
  createUnwiredVaultServices,
  type CommandContext,
  type CoreWriteServices,
  type DeviceSyncServices,
  type ImporterServices,
  type QueryServices,
  type VaultServices,
} from './vault-services.js'
export {
  createIntegratedVaultCliServices,
  createUnwiredVaultCliServices,
  type VaultCliServices,
} from './vault-cli-services.js'
export * from './vault-cli-contracts.js'
export * from './inbox-cli-contracts.js'
export * from './vault-cli-errors.js'
export * from './assistant-harness.js'
export * from './assistant-cli-tools.js'
export * from './inbox-model-contracts.js'
export * from './inbox-model-harness.js'
export * from './assistant-cli-contracts.js'
export * from './assistant/store.js'
export {
  redactAssistantStateDocumentListEntry,
  redactAssistantStateDocumentSnapshot,
} from './assistant/state.js'
export * from './assistant-provider.js'
export * from './assistant-channel.js'
export * from './assistant-runtime.js'
export * from './assistant/cron.js'
export {
  runAssistantAutomation,
  type RunAssistantAutomationInput,
} from './assistant/automation.js'
export {
  dispatchAssistantOutboxIntent,
  listAssistantOutboxIntents,
  shouldDispatchAssistantOutboxIntent,
  type AssistantChannelDelivery,
  type AssistantOutboxDispatchHooks,
} from './assistant/outbox.js'
export { refreshAssistantStatusSnapshot } from './assistant/status.js'
export * from './assistant-codex.js'
export * from './assistant/state-ids.js'
export * from './assistant/memory.js'
export * from './agentmail-runtime.js'
export * from './research-runtime.js'
export * from './research-cli-contracts.js'

export {
  resolveAssistantSelfDeliveryTarget,
  saveAssistantSelfDeliveryTarget,
} from './operator-config.js'
