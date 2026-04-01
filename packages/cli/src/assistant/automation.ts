/**
 * CLI facade over the assistant-core automation surface.
 * The CLI keeps the daemon-aware run loop locally while delegating the rest.
 */
export type {
  AssistantAutoReplyScanResult,
  AssistantAutomationScanResult,
  AssistantInboxScanResult,
  AssistantRunEvent,
} from '@murphai/assistant-core/assistant/automation/shared'
export {
  runAssistantAutomation,
  type RunAssistantAutomationInput,
} from './automation/run-loop.js'
export {
  scanAssistantAutomationOnce,
} from '@murphai/assistant-core/assistant/automation/scanner'
export {
  scanAssistantAutoReplyOnce,
} from '@murphai/assistant-core/assistant/automation/reply'
export {
  scanAssistantInboxOnce,
} from '@murphai/assistant-core/assistant/automation/routing'
