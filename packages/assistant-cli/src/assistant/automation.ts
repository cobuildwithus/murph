/**
 * CLI facade over the assistant-core automation surface.
 * The CLI keeps the daemon-aware run loop locally while delegating the rest.
 */
export type {
  AssistantAutoReplyScanResult,
  AssistantAutomationScanResult,
  AssistantInboxScanResult,
  AssistantRunEvent,
} from '@murphai/assistant-core/assistant-automation'
export {
  runAssistantAutomation,
  type RunAssistantAutomationInput,
} from './automation/run-loop.js'
export {
  scanAssistantAutomationOnce,
} from '@murphai/assistant-core/assistant-automation'
export {
  scanAssistantAutoReplyOnce,
} from '@murphai/assistant-core/assistant-automation'
export {
  scanAssistantInboxOnce,
} from '@murphai/assistant-core/assistant-automation'
