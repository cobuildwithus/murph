import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildHealthCommonsCatalog } from "../src/catalog.ts";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(packageRoot, "content");

describe("Bryan Johnson sauna onboarding", () => {
  it("materializes the structured onboarding contract in the catalog", async () => {
    const catalog = await buildHealthCommonsCatalog({ contentRoot });
    const protocol = catalog.entities.find(
      (entity) => entity.key === "protocol_variant:dry-sauna/bryan-johnson-blueprint",
    );

    expect(protocol?.experimentOnboarding?.schemaVersion).toBe(
      "murph.commons.experiment-onboarding.v2",
    );
    expect(protocol?.experimentOnboarding?.planDefaults?.testPlanId).toBe(
      "source-attributed-rhr-hrv-21d",
    );
    expect(protocol?.safety?.cautionLevel).toBe("high");
    expect(protocol?.experimentOnboarding).not.toHaveProperty("contextReview");
    expect(protocol?.experimentOnboarding).not.toHaveProperty("logging");
    expect(protocol?.experimentOnboarding).not.toHaveProperty("assistantPolicy");
    expect(protocol?.experimentOnboarding?.setupSlots?.map((slot) => slot.id)).toEqual(
      expect.arrayContaining([
        "run_variant",
        "sauna_temperature_range",
        "hydration_plan",
        "reminder_policy",
      ]),
    );
    expect(
      protocol?.experimentOnboarding?.setupSlots?.find((slot) => slot.id === "weekly_schedule"),
    ).toMatchObject({
      constraints: {
        defaultRunPlanSchedule: {
          kind: "dailyLocal",
          localTime: "07:30",
          timeZone: "UTC",
        },
        runPlanScheduleTimeZonePolicy: "replace_with_user_vault_timezone",
      },
      target: {
        object: "onboardingCapture",
        field: "answers.weeklySchedule",
      },
    });
    expect(protocol?.revision.runSpecRevisionId).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
