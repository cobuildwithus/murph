import { describe, expect, it } from "vitest";

import * as publicApi from "@murphai/vault-usecases";
import {
  createHealthScaffoldResultSchema,
  findHealthDescriptorForLookup,
  getHealthRegistryCommandMetadata,
  hasHealthCommandDescriptor,
  hasHealthCoreDescriptor,
  hasHealthQueryDescriptor,
  healthCoreHasInputCapability,
  healthCoreHasResultCapability,
  healthCoreRuntimeMethodNames,
  healthCoreServiceMethodNames,
  healthEntityDescriptorByCommandName,
  healthEntityDescriptorByKind,
  healthEntityDescriptorByNoun,
  healthListFiltersSchema,
  healthListResultSchema,
  healthQueryHasListFilterCapability,
  healthQueryRuntimeMethodNames,
  healthQueryServiceMethodNames,
  inferHealthEntityKind,
  isHealthQueryableRecordId,
} from "@murphai/vault-usecases";
import { inputFileOptionSchema } from "@murphai/vault-usecases";
import { normalizeRepeatableFlagOption } from "@murphai/vault-usecases";
import * as vaultServicesApi from "@murphai/vault-usecases/vault-services";

describe("health CLI descriptors", () => {
  it("builds the expected descriptor maps and barrel exports", () => {
    const goalDescriptor = healthEntityDescriptorByKind.get("goal");
    const assessmentDescriptor = healthEntityDescriptorByKind.get("assessment");

    expect(goalDescriptor?.command?.commandName).toBe("goal");
    expect(healthEntityDescriptorByCommandName.get("blood-test")?.kind).toBe("blood_test");
    expect(healthEntityDescriptorByCommandName.get("immunization")?.kind).toBe("immunization");
    expect(healthEntityDescriptorByNoun.get("goal")?.kind).toBe("goal");

    expect(goalDescriptor && hasHealthCommandDescriptor(goalDescriptor)).toBe(true);
    expect(assessmentDescriptor && hasHealthCommandDescriptor(assessmentDescriptor)).toBe(false);

    expect(publicApi.inputFileOptionSchema).toBe(inputFileOptionSchema);
    expect(publicApi.normalizeRepeatableFlagOption).toBe(normalizeRepeatableFlagOption);
    expect(typeof publicApi.createIntegratedVaultServices).toBe("function");
    expect(typeof publicApi.createUnwiredVaultServices).toBe("function");
    expect(publicApi.createIntegratedVaultServices).toBe(vaultServicesApi.createIntegratedVaultServices);
    expect(publicApi.createUnwiredVaultServices).toBe(vaultServicesApi.createUnwiredVaultServices);
  });

  it("exposes the expected command metadata, lookup helpers, and method lists", () => {
    const goalDescriptor = healthEntityDescriptorByKind.get("goal");
    const assessmentDescriptor = healthEntityDescriptorByKind.get("assessment");

    if (!goalDescriptor || !assessmentDescriptor) {
      throw new Error("Expected built-in health descriptors to exist.");
    }
    if (!hasHealthQueryDescriptor(goalDescriptor) || !hasHealthQueryDescriptor(assessmentDescriptor)) {
      throw new Error("Expected goal and assessment to define query descriptor metadata.");
    }

    expect(getHealthRegistryCommandMetadata("goal")).toEqual({
      commandDescription: "Goal registry commands for the health extension surface.",
      commandName: "goal",
      listServiceMethod: "listGoals",
      listStatusDescription: "Optional goal status to filter by.",
      payloadFile: "goal.json",
      runtimeListMethod: "listGoals",
      runtimeMethod: "upsertGoal",
      runtimeShowMethod: "showGoal",
      scaffoldServiceMethod: "scaffoldGoal",
      showId: {
        description: "Goal id or slug to show.",
        example: "<goal-id>",
      },
      showServiceMethod: "showGoal",
      upsertServiceMethod: "upsertGoal",
    });

    expect(healthQueryHasListFilterCapability(goalDescriptor, "status")).toBe(true);
    expect(healthQueryHasListFilterCapability(assessmentDescriptor, "date-range")).toBe(true);

    expect(findHealthDescriptorForLookup("goal_sleep")?.kind).toBe("goal");
    expect(findHealthDescriptorForLookup("unknown_lookup")).toBeNull();
    expect(inferHealthEntityKind("goal_sleep")).toBe("goal");
    expect(inferHealthEntityKind("unknown_lookup")).toBeNull();
    expect(isHealthQueryableRecordId("goal_sleep")).toBe(true);
    expect(isHealthQueryableRecordId("unknown_lookup")).toBe(false);

    expect(healthCoreRuntimeMethodNames).toContain("upsertGoal");
    expect(healthCoreRuntimeMethodNames).toContain("appendImmunization");
    expect(healthQueryRuntimeMethodNames).toContain("listGoals");
    expect(healthQueryRuntimeMethodNames).toContain("listImmunizations");
    expect(healthCoreServiceMethodNames).toContain("scaffoldGoal");
    expect(healthCoreServiceMethodNames).toContain("upsertGoal");
    expect(healthCoreServiceMethodNames).toContain("upsertImmunization");
    expect(healthQueryServiceMethodNames).toContain("listGoals");
    expect(healthQueryServiceMethodNames).toContain("listImmunizations");
  });

  it("parses scaffold and list payload shapes", () => {
    expect(
      createHealthScaffoldResultSchema("goal").parse({
        vault: "./vault",
        noun: "goal",
        payload: {
          title: "Sleep better",
        },
      }),
    ).toEqual({
      vault: "./vault",
      noun: "goal",
      payload: {
        title: "Sleep better",
      },
    });

    expect(() =>
      createHealthScaffoldResultSchema("goal").parse({
        vault: "./vault",
        noun: "blood-test",
        payload: {},
      }),
    ).toThrow();

    expect(healthListFiltersSchema.parse({ from: "2026-03-01", kind: "goal" })).toEqual({
      from: "2026-03-01",
      kind: "goal",
      limit: 50,
    });

    expect(
      healthListResultSchema.parse({
        vault: "./vault",
        filters: {
          limit: 10,
        },
        items: [],
        count: 0,
        nextCursor: null,
      }),
    ).toEqual({
      vault: "./vault",
      filters: {
        limit: 10,
      },
      items: [],
      count: 0,
      nextCursor: null,
    });
  });
});
