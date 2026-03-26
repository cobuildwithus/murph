// @ts-nocheck

import {
  createIntegratedInboxCliServices,
  createIntegratedVaultCliServices,
  readAssistantAutomationState,
  runAssistantAutomation,
  saveAssistantAutomationState,
} from "healthybob";
import {
  createInboxPipeline,
  normalizeLinqWebhookEvent,
  openInboxRuntime,
  parseLinqWebhookEvent,
  rebuildRuntimeFromVault,
} from "@healthybob/inboxd";

export function createHostedCliRuntime() {
  return {
    createIntegratedInboxCliServices,
    createIntegratedVaultCliServices,
    readAssistantAutomationState,
    runAssistantAutomation,
    saveAssistantAutomationState,
  };
}

export function createHostedInboxdRuntime() {
  return {
    createInboxPipeline,
    normalizeLinqWebhookEvent,
    openInboxRuntime,
    parseLinqWebhookEvent,
    rebuildRuntimeFromVault,
  };
}
