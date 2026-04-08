/**
 * Dedicated local-only assistant runtime surface.
 *
 * This package owns the assistant execution runtime, provider turn plumbing,
 * CLI-facing assistant runtime contracts, outbox/status/state/store helpers,
 * and the local gateway adapter used by hosted runtimes and daemons.
 */

export * from './assistant-automation.js'
export * from './assistant-cli-contracts.js'
export * from './assistant-codex.js'
export * from './assistant-cron.js'
export * from './assistant-outbox.js'
export * from './assistant-provider.js'
export * from './assistant-runtime.js'
export * from './assistant-service.js'
export * from './assistant-state.js'
export * from './assistant-status.js'
export * from './assistant-store.js'
export * from './child-process-env.js'
export * from './gateway-local-adapter.js'
export * from './knowledge.js'
export * from './model-harness.js'
export * from './outbound-channel.js'
export * from './process-kill.js'
