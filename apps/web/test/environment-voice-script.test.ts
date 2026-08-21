import { describe, expect, it } from "vitest";

import {
  HABITAT_CATALOG,
  HABITAT_DECLINED_VALUE,
} from "@murphai/contracts";

import { buildEnvironmentVoiceScript } from "../app/(dashboard)/environment/environment-voice-script";
import type { HabitatValues } from "../app/(dashboard)/environment/home-model";

describe("environment voice script", () => {
  it("uses focused topics at zero coverage and asks only for city-level location", () => {
    const script = buildEnvironmentVoiceScript({});

    expect(script.flow).toBe("walkthrough");
    expect(script.topics.length).toBeGreaterThan(5);
    expect(script.topics.every((topic) => (topic.fields?.length ?? 0) <= 4))
      .toBe(true);
    expect(script.topics.map((topic) => topic.id.split(":")[0]))
      .toEqual(expect.arrayContaining([
        "sleep",
        "air",
        "light",
        "recovery",
        "workspace",
      ]));
    const location = script.topics
      .flatMap((topic) => topic.fields ?? [])
      .find((field) => field.indicatorId === "location");
    expect(location?.label).toMatch(/city or region/i);
    expect(location?.label).toMatch(/not your address/i);
  });

  it("asks about unknown high and medium context without mixing it into grade coverage", () => {
    const script = buildEnvironmentVoiceScript({
      "sleep-environment": {
        night_temp_c: 19,
        phone_by_bed: HABITAT_DECLINED_VALUE,
      },
    });

    expect(script.flow).toBe("fill-gaps");
    expect(script.initialCoveredDetails).toBe(1);
    const focus = script.topics.flatMap((topic) => topic.focus ?? []);
    expect(focus).toContain("Your city or region, not your address");
    expect(focus).toContain("How fresh air enters your home");
    expect(focus).toContain("Whether you work at home, an office, or both");
    expect(focus).toContain("Whether you use a laptop or external monitor");
    expect(focus).not.toContain("Where your phone stays at night");
    expect(focus).not.toContain("Whether your home has been tested for radon");
    expect(focus).not.toContain("Your drinking water source or filter");
    expect(script.topics[0]?.prompt).toMatch(/Leave .* for later/i);
  });

  it("omits declined gaps and switches to an open update only when collection gaps are resolved", () => {
    const script = buildEnvironmentVoiceScript(
      resolvedCollectionValues(),
    );

    expect(script.flow).toBe("update");
    expect(script.dialogTitle).toBe("Update your environment");
    expect(script.topics).toHaveLength(1);
    expect(script.topics[0].id).toBe("update");
  });
});

function resolvedCollectionValues(): HabitatValues {
  const values: HabitatValues = {};
  for (const aspect of HABITAT_CATALOG.aspects) {
    if (aspect.domain !== "environment" && aspect.domain !== "workspace") {
      continue;
    }
    const indicators: Record<string, typeof HABITAT_DECLINED_VALUE> = {};
    for (const indicator of aspect.indicators) {
      if (indicator.priority !== "low") {
        indicators[indicator.id] = HABITAT_DECLINED_VALUE;
      }
    }
    values[aspect.id] = indicators;
  }
  return values;
}
