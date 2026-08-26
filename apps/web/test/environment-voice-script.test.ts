import { describe, expect, it } from "vitest";

import {
  ENVIRONMENT_INTERVIEW_TOPIC_GROUPS,
  HABITAT_CATALOG,
  HABITAT_DECLINED_VALUE,
  listEnvironmentInterviewFields,
  type HabitatIndicatorValue,
} from "@murphai/contracts";

import {
  buildEnvironmentVoiceScript,
  buildEnvironmentVoiceScriptForGroup,
  type EnvironmentVoiceField,
} from "../app/(dashboard)/environment/environment-voice-script";
import {
  resolveEnvironmentCoverage,
  resolveHabitatScene,
  type HabitatValues,
} from "../app/(dashboard)/environment/home-model";

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

  it("asks every gradeable condition plus unknown high and medium context", () => {
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
    expect(focus).toContain("Whether there is a TV in your bedroom");
    expect(focus).toContain(
      "Whether anyone smokes indoors or you often use a fireplace or candles",
    );
    expect(focus).not.toContain("Where your phone stays at night");
    expect(focus).not.toContain("Whether your home has been tested for radon");
    expect(focus).not.toContain("Your drinking water source or filter");
    expect(script.topics[0]?.prompt).toBeUndefined();
  });

  it("includes every gradeable report condition in the main interview", () => {
    const script = buildEnvironmentVoiceScript({});
    const includedFields = new Set(
      script.topics.flatMap((topic) =>
        (topic.fields ?? []).map(
          (field) => `${field.aspectId}.${field.indicatorId}`,
        ),
      ),
    );
    const gradeableFields = ENVIRONMENT_INTERVIEW_TOPIC_GROUPS.flatMap(
      (group) => listEnvironmentInterviewFields(group.id),
    )
      .filter(({ indicator }) => indicator.informational !== true)
      .map(({ aspectId, indicator }) => `${aspectId}.${indicator.id}`);

    expect([...includedFields]).toEqual(
      expect.arrayContaining(gradeableFields),
    );

    const gradeableFieldKeys = new Set(gradeableFields);
    const completeValues: HabitatValues = {};
    for (const field of script.topics.flatMap((topic) => topic.fields ?? [])) {
      const key = `${field.aspectId}.${field.indicatorId}`;
      if (!gradeableFieldKeys.has(key)) {
        continue;
      }
      const aspectValues = completeValues[field.aspectId] ?? {};
      aspectValues[field.indicatorId] = exampleValue(field.valueType);
      completeValues[field.aspectId] = aspectValues;
    }

    expect(
      resolveEnvironmentCoverage(resolveHabitatScene(completeValues)).coverage,
    ).toBe(100);
  });

  it("asks again when a report condition is stored without a value", () => {
    const script = buildEnvironmentVoiceScript({
      "sleep-environment": { night_temp_c: null },
    });
    const fields = script.topics.flatMap((topic) => topic.fields ?? []);

    expect(script.flow).toBe("walkthrough");
    expect(script.initialCoveredDetails).toBe(0);
    expect(fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aspectId: "sleep-environment",
          indicatorId: "night_temp_c",
        }),
      ]),
    );

    const groupScript = buildEnvironmentVoiceScriptForGroup("sleep", {
      "sleep-environment": { night_temp_c: null },
    });
    expect(
      groupScript?.topics.flatMap((topic) => topic.fields ?? []),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aspectId: "sleep-environment",
          indicatorId: "night_temp_c",
        }),
      ]),
    );
  });

  it("omits declined gaps and switches to an open update only when collection gaps are resolved", () => {
    const script = buildEnvironmentVoiceScript(
      resolvedCollectionValues(),
    );

    expect(script.flow).toBe("update");
    expect(script.dialogTitle).toBe("Update your environment");
    expect(script.topics).toHaveLength(1);
    expect(script.topics[0].id).toBe("update");
    expect(script.topics[0].fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ indicatorId: "smoke_sources" }),
        expect.objectContaining({ indicatorId: "tv_in_bedroom" }),
      ]),
    );
  });

  it("uses canonical accepted topic ids for category interviews", () => {
    const script = buildEnvironmentVoiceScriptForGroup("sleep", {});

    expect(script).not.toBeNull();
    const topicIds = script?.topics.map((topic) => topic.id) ?? [];
    expect(topicIds).toEqual(
      topicIds.map((_, chunkIndex) => `sleep:${chunkIndex}`),
    );
  });
});

function exampleValue(
  valueType: EnvironmentVoiceField["valueType"],
): HabitatIndicatorValue {
  if (valueType.kind === "enum") {
    const value = valueType.values[0];
    if (value === undefined) {
      throw new TypeError("Environment enum field has no allowed value");
    }
    return value;
  }
  if (valueType.kind === "number") {
    return valueType.min ?? 1;
  }
  if (valueType.kind === "boolean") {
    return false;
  }
  return "known";
}

function resolvedCollectionValues(): HabitatValues {
  const values: HabitatValues = {};
  for (const aspect of HABITAT_CATALOG.aspects) {
    if (aspect.domain !== "environment" && aspect.domain !== "workspace") {
      continue;
    }
    const indicators: Record<string, typeof HABITAT_DECLINED_VALUE> = {};
    for (const indicator of aspect.indicators) {
      if (indicator.priority !== "low" || indicator.informational !== true) {
        indicators[indicator.id] = HABITAT_DECLINED_VALUE;
      }
    }
    values[aspect.id] = indicators;
  }
  return values;
}
