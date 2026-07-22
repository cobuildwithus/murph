import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildHealthCommonsCatalog } from "@murphai/health-commons";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentRoot = path.join(packageRoot, "content");

const standardBaselineDays = 14;

const baselineExceptions = new Map([
  [
    "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol#lipid-panel-12-week",
    {
      baselineDays: 0,
      reason: "The existing lipid panel is the point-in-time baseline evidence.",
    },
  ],
  [
    "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol#lipid-panel-8-week-minimum",
    {
      baselineDays: 0,
      reason: "The existing lipid panel is the point-in-time baseline evidence.",
    },
  ],
]);

describe("Health Commons experiment baseline policy", () => {
  it("uses two-week baselines by default and composes total durations from each plan", async () => {
    const catalog = await buildHealthCommonsCatalog({ contentRoot });
    const observedExceptions = new Set<string>();
    let standardPlanCount = 0;

    for (const protocol of catalog.entities.filter(
      (entity) => entity.entityType === "protocol_variant",
    )) {
      for (const plan of protocol.testPlans ?? []) {
        expect(
          plan.durationDays,
          `${protocol.key}#${plan.planId} duration must equal baseline plus intervention`,
        ).toBe(plan.baselineDays + plan.interventionDays);

        if (plan.baselineDays === standardBaselineDays) {
          standardPlanCount += 1;
          continue;
        }

        const planKey = `${protocol.key}#${plan.planId}`;
        const exception = baselineExceptions.get(planKey);
        expect(
          exception?.reason,
          `${planKey} needs a reviewed reason for a baseline other than ${standardBaselineDays} days`,
        ).toBeDefined();
        expect(
          exception?.baselineDays,
          `${planKey} must keep its reviewed exceptional baseline duration`,
        ).toBe(plan.baselineDays);
        observedExceptions.add(planKey);
      }
    }

    expect(standardPlanCount).toBeGreaterThan(observedExceptions.size);
    expect(observedExceptions).toEqual(new Set(baselineExceptions.keys()));
  });

  it("keeps Daily Step Floor timing exclusively on its fixed two-week test plan", async () => {
    const catalog = await buildHealthCommonsCatalog({ contentRoot });
    const dailyStepFloor = catalog.entities.find(
      (entity) => entity.key === "protocol_variant:daily-step-floor/daily-step-floor",
    );

    expect(dailyStepFloor?.testPlans).toEqual([
      expect.objectContaining({
        baselineDays: 14,
        durationDays: 42,
        interventionDays: 28,
        planId: "wearable-step-floor-42d",
      }),
    ]);
    expect(
      dailyStepFloor?.experimentOnboarding?.setupSlots?.map((slot) => slot.id),
    ).not.toContain("baseline_window");
    const runnablePlan = JSON.stringify({
      experimentOnboarding: dailyStepFloor?.experimentOnboarding,
      protocol: dailyStepFloor?.protocol,
    });
    expect(runnablePlan).not.toMatch(/7\s*[–-]\s*14\s+days?/iu);
    expect(runnablePlan).not.toMatch(/(?:7|seven)[\s-]+day\s+baseline/iu);
    expect(runnablePlan).toMatch(/14 day baseline/iu);
  });
});
