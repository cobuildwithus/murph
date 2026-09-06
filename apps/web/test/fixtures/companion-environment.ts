import { createBrowserVaultCoreQueryClient, type BrowserVaultEntity } from "@murphai/query/browser-replica-client";
import type { HabitatValues } from "@/app/(dashboard)/environment/home-model";

export const environmentValues: HabitatValues = {
  "sleep-environment": {
    night_temp_c: 24, darkness: "blackout", night_noise: "quiet",
    co2_typical_ppm: 800, mattress_satisfaction: "good", bedding_overheating: "never",
    phone_by_bed: true, tv_in_bedroom: false,
  },
  "home-air": { damp_or_mold: "none", smoke_sources: "none" },
  lighting: { evening_light: "warm_dim", morning_light_access: "balcony_or_garden", daytime_light: "by_window" },
  workspace: { screen_at_eye_level: true, breaks: "irregular", wrist_complaints: false },
};

export function environmentClient(values: HabitatValues = environmentValues) {
  const entities: BrowserVaultEntity[] = Object.entries(values).map(([aspect, indicators]) => ({
    attributes: { aspect, indicators }, bodyPreview: null, date: null,
    experimentSlug: null, family: "habitat", id: `habitat:${aspect}`, kind: "habitat",
    links: [], lookupIds: [], occurredAt: null, recordClass: "bank", status: null,
    stream: null, tags: [], title: aspect,
  }));
  return createBrowserVaultCoreQueryClient({
    schema: "murph.browser-vault-replica.core.v1",
    assistantSummary: { highlights: [], latestDate: null },
    entities, experimentRunCards: [], hasLabBiomarkers: false,
    identity: { dataVersion: "synthetic-v1", generatedAt: "2026-09-06T12:00:00.000Z",
      replicaSchema: "murph.browser-vault-replica", sourceBundleHash: "b".repeat(64) },
    policy: { id: "health-vault-browser", bodyPreviewChars: 280, excludedFamilies: [],
      includedFamilies: [], metricLookbackDays: 365 },
    timelineRows: [], weeklySampleSummaries: [],
  });
}
