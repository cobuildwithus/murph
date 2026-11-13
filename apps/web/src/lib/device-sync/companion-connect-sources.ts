import "server-only";

import { resolveDeviceConnectSourceById } from "@murphai/device-syncd/connect-config";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { readHostedHealthDataConsentState } from "../legal/consent";
import { getPrisma } from "../prisma";
import { readAppleHealthRelaySetupStep } from "./apple-health-relay-setup-guide";
import { connectSourcePath, connectSourcePngLogoPath, resolveConnectSources } from "./connect-sources";
import { buildHostedDeviceSyncSettingsResponse } from "./settings-service";
import type { HostedDeviceSyncSettingsSource } from "./settings-surface";
import { WHOOP_APPLE_HEALTH_SETUP_STEP } from "./whoop-apple-health-setup-guide";
import { ZEPP_APPLE_HEALTH_SETUP_STEP } from "./zepp-apple-health-setup-guide";

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
        path: connectSourcePath(row.id),
        ...companionStatusSlugField(row.id),
        ...(step ? { relay: { stepTitle: step.title, stepDetail: step.detail } } : {}),
        ...(connected ? { connection: {
          state: needsAttention ? "needs_attention" : "connected",
          ...(needsAttention ? { reason: companionConnectAttentionReason(row) } : {}),
          lastDataAt: row.lastDataAt ?? null,
        } } : {}),
      }];
    }),
  };
}

/**
 * The slug `GET /api/device-sync/companion/status?sourceProviderSlug=` takes
 * for this source's own receipt times. Absent for a wearable that comes in
 * through Apple Health: Murph can't tell its data from the phone's.
 */
function companionStatusSlugField(id: string): { sourceProviderSlug?: string } {
  for (const route of resolveDeviceConnectSourceById(id)?.routes ?? []) {
    if (route.kind !== "unavailable") return { sourceProviderSlug: route.sourceProviderSlug };
  }
  return {};
}

/**
 * Why a source needs attention, so the app can offer its one way back:
 * `fitbit_migration` signs in to Google Health, which Fitbit now syncs
 * through; `connection_reset` needs the old connection removed first, which
 * removes the shared account, so only the website does it; `reconnect` signs
 * in again; `reset_unfinished` means an earlier reset left the old connection
 * in the wearable's own account. Same order as the website's card.
 */
function companionConnectAttentionReason(row: {
  migrationState?: string;
  recoveryKind?: string;
  requiresReconnect?: boolean;
}): "connection_reset" | "fitbit_migration" | "reconnect" | "reset_unfinished" {
  if (row.migrationState === "authorization_required") return "fitbit_migration";
  if (row.recoveryKind === "connection_reset") return "connection_reset";
  if (row.requiresReconnect) return "reconnect";
  return "reset_unfinished";
}
