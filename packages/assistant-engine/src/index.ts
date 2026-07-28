/**
 * Dedicated local-only assistant runtime surface.
 *
 * This package owns the assistant execution runtime, Codex turn plumbing,
 * CLI-facing assistant runtime contracts, outbox/status/state/store helpers,
 * and hosted/local assistant control primitives used by runtimes and daemons.
 */

export * from './assistant-automation.js'
export * from './assistant-ask.js'
export type {
  AssistantAutomationOperationScope,
} from './assistant/automation/operation-scope.js'
export * from './assistant-codex.js'
export * from './assistant-context-snapshot.js'
export {
  readAssistantCliSurfaceBootstrapContext,
} from './assistant/cli-surface-bootstrap.js'
export type {
  AssistantConnectedAppsPort,
} from './assistant/connected-apps-port.js'
export {
  ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES,
  ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_RESULT_CODE_UNITS,
} from './assistant/group-shared-read-limits.js'
export * from './assistant/group-newsletter-automation.js'
export type {
  AssistantGroupParticipantDisplayName,
  AssistantHostedGroupParticipantDisplayNameReader,
  AssistantHostedGroupPermissionOfferRequest,
  AssistantHostedGroupPermissionOfferTool,
  AssistantHostedGroupSharedMember,
  AssistantHostedGroupSharedProjection,
  AssistantHostedGroupSharedReader,
  AssistantHostedGroupSharedReadRequest,
  AssistantHostedGroupSharedReadResponse,
  AssistantHostedGroupSharedRecord,
  AssistantHostedImageGenerationLauncher,
  AssistantHostedImageGenerationResult,
} from './assistant/execution-context.js'
export {
  flushPendingAssistantRuntimeIssueWrites,
  recordAssistantRuntimeIssueInputsBestEffort,
  resolveAssistantDiagnosticsPolicy,
} from './assistant/issue-reporting.js'
export type {
  AssistantRuntimeIssueInput,
} from './assistant/issue-reporting.js'
export * from './assistant/device-activity-automations.js'
export * from './assistant/managed-automations.js'
export * from './assistant/onboarding-followup-automation.js'
export * from './assistant-cron.js'
export * from './assistant-outbox.js'
export * from './assistant-runtime.js'
export * from './assistant-service.js'
export * from './assistant-state.js'
export * from './assistant-status.js'
export * from './assistant-store.js'
export * from './child-process-env.js'
export * from './outbound-channel.js'
