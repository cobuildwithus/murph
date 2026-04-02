/**
 * Dedicated local-only headless assistant, inbox, vault, and operator-config surface
 * for non-CLI consumers.
 *
 * This package intentionally excludes CLI command routing, Ink/UI entrypoints,
 * assistantd client helpers, and other operator-shell-only helpers so hosted runtimes and
 * daemons can depend on one explicit boundary without importing the published CLI package.
 */

export {
  createIntegratedInboxServices,
  type InboxServices,
} from './inbox-services.js'

export {
  createIntegratedVaultServices,
  type CommandContext,
  type CoreWriteServices,
  type DeviceSyncServices,
  type ImporterServices,
  type QueryServices,
  type VaultServices,
} from './vault-services.js'

export {
  assistantAutomationStateSchema,
  assistantOutboxIntentSchema,
  assistantSessionSchema,
  assistantSelfDeliveryTargetSchema,
  assistantStatusResultSchema,
  type AssistantAskResult,
  type AssistantChannelDelivery,
  type AssistantAutomationState,
  type AssistantCronJob,
  type AssistantCronPreset,
  type AssistantCronRunRecord,
  type AssistantCronSchedule,
  type AssistantCronScheduleInput,
  type AssistantCronTarget,
  type AssistantCronTargetSnapshot,
  type AssistantCronTrigger,
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
  getAssistantCronJobTarget,
  getAssistantCronStatus,
  listAssistantCronJobs,
  listAssistantCronRuns,
  processDueAssistantCronJobs,
  setAssistantCronJobTarget,
  type AssistantCronProcessDueResult,
  type AssistantCronStatusSnapshot,
  type AssistantCronTargetMutationResult,
} from './assistant/cron.js'

export {
  deliverAssistantOutboxMessage,
  dispatchAssistantOutboxIntent,
  drainAssistantOutbox,
  normalizeAssistantDeliveryError,
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
  getAssistantSession,
  isAssistantSessionNotFoundError,
  listAssistantSessions,
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from './assistant/store.js'

export {
  getAssistantStatus,
  readAssistantStatusSnapshot,
  refreshAssistantStatusSnapshot,
} from './assistant/status.js'

export {
  openAssistantConversation,
  sendAssistantMessage,
  updateAssistantSessionOptions,
  type AssistantExecutionContext,
  type AssistantMessageInput,
  type AssistantHostedExecutionContext,
} from './assistant/service.js'

export {
  HOSTED_ASSISTANT_API_KEY_ENV,
  HOSTED_ASSISTANT_APPROVAL_POLICY_ENV,
  HOSTED_ASSISTANT_BASE_URL_ENV,
  HOSTED_ASSISTANT_CODEX_COMMAND_ENV,
  HOSTED_ASSISTANT_CONFIG_ENV_NAMES,
  HOSTED_ASSISTANT_MODEL_ENV,
  HOSTED_ASSISTANT_OSS_ENV,
  HOSTED_ASSISTANT_PROFILE_ENV,
  HOSTED_ASSISTANT_PROVIDER_ENV,
  HOSTED_ASSISTANT_PROVIDER_NAME_ENV,
  HOSTED_ASSISTANT_REASONING_EFFORT_ENV,
  HOSTED_ASSISTANT_SANDBOX_ENV,
  HostedAssistantConfigurationError,
  ensureHostedAssistantOperatorDefaults,
  readHostedAssistantApiKeyEnvName,
  resolveHostedAssistantOperatorDefaultsState,
  type HostedAssistantBootstrapResult,
  type HostedAssistantConfigurationErrorCode,
  type HostedAssistantOperatorConfigState,
} from './hosted-assistant-config.js'

export {
  compileHostedAssistantProfileProviderConfig,
  HOSTED_ASSISTANT_CONFIG_SCHEMA,
  isHostedAssistantProfileReady,
  parseHostedAssistantConfig,
  parseHostedAssistantConfigJson,
  prepareHostedAssistantConfigForWrite,
  resolveActiveHostedAssistantProfile,
  resolveHostedAssistantProfile,
  resolveHostedAssistantProviderConfig,
  resolveReadyHostedAssistantProfile,
  tryParseHostedAssistantConfig,
  type HostedAssistantConfig,
  type HostedAssistantProfile,
} from './hosted-assistant-config.js'

export {
  ROOT_OPTIONS_WITH_VALUES,
  TOP_LEVEL_COMMANDS_REQUIRING_VAULT,
  VAULT_ENV,
  VAULT_ENV_KEYS,
  applyAssistantSelfDeliveryTargetDefaults,
  applyDefaultVaultToArgs,
  buildAssistantProviderDefaultsPatch,
  clearAssistantSelfDeliveryTargets,
  expandConfiguredVaultPath,
  hasExplicitVaultOption,
  listAssistantSelfDeliveryTargets,
  normalizeVaultForConfig,
  readOperatorConfig,
  resolveAssistantOperatorDefaults,
  resolveAssistantProviderDefaults,
  resolveAssistantSelfDeliveryTarget,
  resolveDefaultVault,
  resolveEffectiveTopLevelToken,
  resolveHostedAssistantConfig,
  resolveOperatorConfigPath,
  resolveOperatorHomeDirectory,
  saveAssistantOperatorDefaultsPatch,
  saveAssistantSelfDeliveryTarget,
  saveDefaultVaultConfig,
  saveHostedAssistantConfig,
  type AssistantOperatorDefaults,
  type OperatorConfig,
} from './operator-config.js'
