import { describe, expect, it } from "vitest";

import {
  HABITAT_CATALOG,
  HABITAT_DECLINED_VALUE,
} from "@murphai/contracts";

import { buildEnvironmentVoiceScript } from "../app/(dashboard)/environment/environment-voice-script";
import type { HabitatValues } from "../app/(dashboard)/environment/home-model";

describe("environment voice script", () => {
  it("uses one five-topic walkthrough at zero coverage and asks only for city-level location", () => {
    const script = buildEnvironmentVoiceScript({});

    expect(script.flow).toBe("walkthrough");
    expect(script.topics).toHaveLength(5);
    expect(script.topics.map((topic) => topic.id)).toEqual([
      "sleep",
      "air",
      "light",
      "recovery",
      "workspace",
    ]);
    expect(script.topics[1].prompt).toMatch(/city or approximate region/i);
    expect(script.topics[1].prompt).toMatch(/never your address/i);
  });

  it("asks about unknown high and medium context without mixing it into grade coverage", () => {
    const script = buildEnvironmentVoiceScript({
      "sleep-environment": {
        night_temp_c: 19,
        phone_by_bed: HABITAT_DECLINED_VALUE,
      },
    });

    expect(script.flow).toBe("fill-gaps");
    const focus = script.topics.flatMap((topic) => topic.focus ?? []);
    expect(focus).toContain("City / region");
    expect(focus).toContain("Ventilation");
    expect(focus).toContain("Work mode");
    expect(focus).toContain("Screen setup");
    expect(focus).not.toContain("Phone by bed");
    expect(focus).not.toContain("Radon tested");
    expect(focus).not.toContain("Drinking water");
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
