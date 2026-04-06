/**
 * CLI facade over the assistant-engine automation surface.
 * The CLI keeps the daemon-aware run loop locally while delegating the rest.
 */
export type {
  AssistantAutoReplyScanResult,
  AssistantAutomationScanResult,
  AssistantInboxScanResult,
  AssistantRunEvent,
} from '@murphai/assistant-engine/assistant-automation'
export {
  runAssistantAutomation,
  type RunAssistantAutomationInput,
} from './automation/run-loop.js'
export {
  scanAssistantAutomationOnce,
} from '@murphai/assistant-engine/assistant-automation'
export {
  scanAssistantAutoReplyOnce,
} from '@murphai/assistant-engine/assistant-automation'
export {
  scanAssistantInboxOnce,
} from '@murphai/assistant-engine/assistant-automation'
