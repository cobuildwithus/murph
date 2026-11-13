import "server-only";

import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { readHostedHealthDataConsentState } from "../legal/consent";
import { getPrisma } from "../prisma";
import { APPLE_HEALTH_RELAY_CONNECT_SOURCE_IDS } from "./apple-health-relay-connect-sources";
import { readAppleHealthRelaySetupStep } from "./apple-health-relay-setup-guide";
import { connectSourcePngLogoPath, resolveConnectSources } from "./connect-sources";
import { buildHostedDeviceSyncSettingsResponse } from "./settings-service";
import type { HostedDeviceSyncSettingsSource } from "./settings-surface";
import { WHOOP_APPLE_HEALTH_SETUP_STEP } from "./whoop-apple-health-setup-guide";
import { ZEPP_APPLE_HEALTH_SETUP_STEP } from "./zepp-apple-health-setup-guide";

const relayIds = new Set<string>(APPLE_HEALTH_RELAY_CONNECT_SOURCE_IDS);

export async function readCompanionConnectSources(
  member: Parameters<typeof buildHostedDeviceSyncSettingsResponse>[0]["member"],
) {
  let settingsSources: HostedDeviceSyncSettingsSource[] = [];
  try {
    if (await readHostedHealthDataConsentState({ memberId: member.id, prisma: getPrisma() }) === "granted") {
      settingsSources = (await buildHostedDeviceSyncSettingsResponse({ member })).sources;
    }
  } catch (error) {
    if (!isHostedOnboardingError(error)
      || (error.code !== "HOSTED_ACCESS_REQUIRED" && error.code !== "HOSTED_CONSENT_REQUIRED")) throw error;
  }
  return {
    schemaVersion: 1,
    sources: resolveConnectSources(settingsSources).flatMap((row) => {
      const needsAttention = Boolean(row.requiresReconnect || row.recoveryKind
        || row.historicalResetIncomplete || row.migrationState === "authorization_required");
      const connected = row.connected || needsAttention || Boolean(row.migrationState);
      if (!connected && (row.id === "mobvoi-health"
        || (row.connectionAvailable === false && row.unavailableMessage && !row.setupGuideId))) return [];
      const step = row.id === "whoop" ? WHOOP_APPLE_HEALTH_SETUP_STEP
        : row.setupGuideId === "zepp-apple-health" ? ZEPP_APPLE_HEALTH_SETUP_STEP
          : row.setupGuideId ? readAppleHealthRelaySetupStep(row.setupGuideId) : undefined;
      return [{
        id: row.id,
        name: row.name,
        logoPath: connectSourcePngLogoPath(row.id),
        path: row.id === "apple-health" ? "apple_health" : relayIds.has(row.id) ? "apple_health_relay" : "web",
        ...(step ? { relay: { stepTitle: step.title, stepDetail: step.detail } } : {}),
        ...(connected ? { connection: {
          state: needsAttention ? "needs_attention" : "connected",
          lastDataAt: row.lastDataAt ?? null,
        } } : {}),
      }];
    }),
  };
}
