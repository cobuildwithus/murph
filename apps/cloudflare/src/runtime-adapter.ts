// @ts-nocheck

import {
  createDeviceSyncService,
  createDeviceSyncRegistry,
  createOuraDeviceSyncProvider,
  createWhoopDeviceSyncProvider,
} from "@healthybob/device-syncd";
import {
  createIntegratedInboxCliServices,
  createIntegratedVaultCliServices,
  drainAssistantOutbox,
  getAssistantCronStatus,
  readAssistantAutomationState,
  refreshAssistantStatusSnapshot,
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
import {
  createConfiguredParserRegistry,
  createInboxParserService,
} from "@healthybob/parsers";

export function createHostedCliRuntime() {
  return {
    createIntegratedInboxCliServices,
    createIntegratedVaultCliServices,
    drainAssistantOutbox,
    getAssistantCronStatus,
    readAssistantAutomationState,
    refreshAssistantStatusSnapshot,
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

export function createHostedParsersRuntime() {
  return {
    createConfiguredParserRegistry,
    createInboxParserService,
  };
}

export function createHostedDeviceSyncRuntime(input: {
  publicBaseUrl?: string | null;
  secret?: string | null;
  vaultRoot: string;
}) {
  const registry = createDeviceSyncRegistry();

  if (process.env.WHOOP_CLIENT_ID && process.env.WHOOP_CLIENT_SECRET) {
    registry.register(
      createWhoopDeviceSyncProvider({
        clientId: process.env.WHOOP_CLIENT_ID,
        clientSecret: process.env.WHOOP_CLIENT_SECRET,
      }),
    );
  }

  if (process.env.OURA_CLIENT_ID && process.env.OURA_CLIENT_SECRET) {
    registry.register(
      createOuraDeviceSyncProvider({
        clientId: process.env.OURA_CLIENT_ID,
        clientSecret: process.env.OURA_CLIENT_SECRET,
      }),
    );
  }

  if (registry.list().length === 0) {
    return null;
  }

  const secret = input.secret ?? process.env.DEVICE_SYNC_SECRET ?? null;
  const publicBaseUrl = input.publicBaseUrl ?? process.env.DEVICE_SYNC_PUBLIC_BASE_URL ?? null;

  if (!secret || !publicBaseUrl) {
    return null;
  }

  return createDeviceSyncService({
    secret,
    config: {
      publicBaseUrl,
      vaultRoot: input.vaultRoot,
    },
    registry,
  });
}
