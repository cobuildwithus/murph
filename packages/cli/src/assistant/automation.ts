/**
 * CLI facade over the assistant-core automation surface.
 * The CLI keeps the daemon-aware run loop locally while delegating the rest.
 */
export type {
  AssistantAutoReplyScanResult,
  AssistantAutomationScanResult,
  AssistantInboxScanResult,
  AssistantRunEvent,
} from '@murph/assistant-core/assistant/automation/shared'
export {
  runAssistantAutomation,
  type RunAssistantAutomationInput,
} from './automation/run-loop.js'
export {
  scanAssistantAutomationOnce,
} from '@murph/assistant-core/assistant/automation/scanner'
export {
  scanAssistantAutoReplyOnce,
} from '@murph/assistant-core/assistant/automation/reply'
export {
  scanAssistantInboxOnce,
} from '@murph/assistant-core/assistant/automation/routing'
