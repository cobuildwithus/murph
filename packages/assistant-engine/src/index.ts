/**
 * Dedicated local-only assistant runtime surface.
 *
 * This package owns the assistant execution runtime, Codex turn plumbing,
 * CLI-facing assistant runtime contracts, outbox/status/state/store helpers,
 * and hosted/local assistant control primitives used by runtimes and daemons.
 */

export * from './assistant-automation.js'
export * from './assistant-codex.js'
export * from './assistant-context-snapshot.js'
export {
  readAssistantCliSurfaceBootstrapContext,
} from './assistant/cli-surface-bootstrap.js'
export {
  flushPendingAssistantRuntimeIssueWrites,
} from './assistant/issue-reporting.js'
export * from './assistant/device-activity-automations.js'
export * from './assistant/managed-automations.js'
export * from './assistant-cron.js'
export * from './assistant-outbox.js'
export * from './assistant-runtime.js'
export * from './assistant-service.js'
export * from './assistant-state.js'
export * from './assistant-status.js'
export * from './assistant-store.js'
export * from './child-process-env.js'
export * from './outbound-channel.js'
