/**
 * Headless assistant, inbox, vault, and operator-config surface for non-CLI consumers.
 *
 * This subpath intentionally excludes CLI command routing, Ink/UI entrypoints, and other
 * operator-shell-only helpers so hosted runtimes and daemons can depend on one explicit
 * application boundary. The exported assistant/session/status helpers execute locally and do
 * not consult assistantd environment fallbacks.
 */

export {
  createIntegratedInboxCliServices,
  createIntegratedInboxCliServices as createIntegratedInboxServices,
  type InboxCliServices,
  type InboxCliServices as InboxServices,
} from './inbox-services.js'

export {
  createIntegratedVaultCliServices,
  createIntegratedVaultCliServices as createIntegratedVaultServices,
  createUnwiredVaultCliServices,
  createUnwiredVaultCliServices as createUnwiredVaultServices,
  type CommandContext,
  type CoreWriteServices,
  type DeviceSyncServices,
  type ImporterServices,
  type QueryServices,
  type VaultCliServices,
  type VaultCliServices as VaultServices,
} from './vault-cli-services.js'

export {
  assistantAutomationStateSchema,
  type AssistantCronJob,
  type AssistantCronRunRecord,
  assistantOutboxIntentSchema,
  assistantSelfDeliveryTargetSchema,
  type AssistantAskResult,
  type AssistantAutomationState,
  type AssistantChannelDelivery,
  type AssistantOutboxIntent,
  type AssistantRunResult,
  type AssistantSelfDeliveryTarget,
  type AssistantStatusResult,
  type AssistantSession,
} from './assistant-cli-contracts.js'

export {
  runAssistantAutomation,
  type RunAssistantAutomationInput,
} from './assistant/automation.js'

export {
  getAssistantCronJob,
  getAssistantCronStatus,
  listAssistantCronJobs,
  listAssistantCronRuns,
  processDueAssistantCronJobsLocal as processDueAssistantCronJobs,
  type AssistantCronStatusSnapshot,
  type AssistantCronProcessDueResult,
} from './assistant/cron.js'

export {
  dispatchAssistantOutboxIntent,
  drainAssistantOutboxLocal as drainAssistantOutbox,
  listAssistantOutboxIntents,
  readAssistantOutboxIntent,
  shouldDispatchAssistantOutboxIntent,
  type AssistantOutboxDispatchHooks,
  type AssistantOutboxDispatchMode,
} from './assistant/outbox.js'

export {
  assertAssistantCronJobId,
  assertAssistantOutboxIntentId,
  assertAssistantSessionId,
} from './assistant/state-ids.js'

export {
  getAssistantSessionLocal as getAssistantSession,
  isAssistantSessionNotFoundError,
  listAssistantSessionsLocal as listAssistantSessions,
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from './assistant/store.js'

export {
  getAssistantStatusLocal as getAssistantStatus,
  readAssistantStatusSnapshot,
  refreshAssistantStatusSnapshot,
} from './assistant/status.js'

export {
  openAssistantConversationLocal as openAssistantConversation,
  sendAssistantMessageLocal as sendAssistantMessage,
  updateAssistantSessionOptionsLocal as updateAssistantSessionOptions,
  type AssistantMessageInput,
} from './assistant/service.js'

export {
  readOperatorConfig,
  resolveAssistantSelfDeliveryTarget,
  resolveOperatorConfigPath,
  resolveOperatorHomeDirectory,
  saveAssistantSelfDeliveryTarget,
  type AssistantOperatorDefaults,
  type OperatorConfig,
} from './operator-config.js'
