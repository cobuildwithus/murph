import { HABITAT_DECLINED_VALUE } from "@murphai/contracts";
import { buildEnvironmentVoiceScript } from "@/app/(dashboard)/environment/environment-voice-script";
import type { BrowserVaultCoreCapableQueryClient } from "@murphai/query/browser-replica-client";

import { deriveCategoryNote, overallGrade } from "@/app/(dashboard)/environment/category-notes";
import { resolveHabitatScene } from "@/app/(dashboard)/environment/home-model";
import {
  selectEnvironmentHabitatIndicatorNotes,
  selectEnvironmentHabitatValues,
} from "@/app/(dashboard)/environment/habitat-values";

export function projectCompanionEnvironmentReport(input: {
  client: BrowserVaultCoreCapableQueryClient;
  generatedAt: string;
  freshness: "fresh" | "stale";
  imperial: boolean;
}) {
  const values = selectEnvironmentHabitatValues(input.client);
  const indicatorNotes = selectEnvironmentHabitatIndicatorNotes(input.client);
  const scene = resolveHabitatScene(values);
  const categories = scene.categories.map((category) =>
    deriveCategoryNote(category, values, indicatorNotes, input.imperial),
  );
  return {
    schema: "murph.companion.environment.v1" as const,
    state: "ready" as const,
    hasEnvironmentData: hasEnvironmentData(values),
    generatedAt: input.generatedAt,
    freshness: input.freshness,
    grade: overallGrade(categories, values),
    categories,
  };
}

function hasEnvironmentData(values: Record<string, Record<string, unknown>>): boolean {
  return Object.values(values).some((aspect) => Object.values(aspect).some(
    (value) => value !== undefined && value !== null && value !== HABITAT_DECLINED_VALUE,
  ));
}

export function projectCompanionEnvironmentVoice(client: BrowserVaultCoreCapableQueryClient) {
  return {
    state: "ready" as const,
    script: buildEnvironmentVoiceScript(
      selectEnvironmentHabitatValues(client),
      selectEnvironmentHabitatIndicatorNotes(client),
    ),
  };
}
