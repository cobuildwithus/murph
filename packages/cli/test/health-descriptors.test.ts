import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  geneticVariantUpsertPayloadSchema,
  goalUpsertPayloadSchema,
  healthEntityDefinitions,
  regimenRegistryEntityDefinition,
  regimenUpsertPayloadSchema,
} from "@murphai/contracts";
import { test } from "vitest";

import {
  findHealthDescriptorForLookup,
  getHealthRegistryCommandMetadata,
  healthEntityDescriptorByKind,
  inferHealthEntityKind,
} from "@murphai/vault-usecases";
import {
  createExplicitHealthCoreServices,
  createExplicitHealthQueryServices,
} from "@murphai/vault-usecases/testing";

test("CLI health descriptors reuse shared taxonomy lookup metadata and scaffold templates", () => {
  for (const definition of healthEntityDefinitions) {
    const descriptor = healthEntityDescriptorByKind.get(definition.kind);

    assert.ok(descriptor, `missing CLI descriptor for ${definition.kind}`);
    assert.deepEqual(descriptor?.listKinds, definition.listKinds);
    assert.deepEqual(descriptor?.prefixes, definition.prefixes);
    assert.deepEqual(descriptor?.lookupAliases, definition.lookupAliases);

    if (descriptor?.core) {
      assert.deepEqual(descriptor.core.payloadTemplate, definition.scaffoldTemplate);
    }
  }
});

test("generic CLI lookup inference stays anchored to shared aliases and prefixes", () => {
  const goalDescriptor = findHealthDescriptorForLookup("goal_01JSHAREDLOOKUP000000000001");
  const goalKind = inferHealthEntityKind("goal_01JSHAREDLOOKUP000000000001");
  const regimenDescriptor = findHealthDescriptorForLookup("reg_01JSHAREDLOOKUP000000000001");

  assert.equal(goalDescriptor?.kind, "goal");
  assert.equal(goalKind, "goal");
  assert.equal(regimenDescriptor?.kind, "regimen");
});

test("health scaffold descriptors include canonical nested goal, regimen, and genetics examples", () => {
  const goalPayload = healthEntityDescriptorByKind.get("goal")?.core?.payloadTemplate;
  const regimenPayload = healthEntityDescriptorByKind.get("regimen")?.core?.payloadTemplate;
  const geneticsPayload = healthEntityDescriptorByKind.get("genetics")?.core?.payloadTemplate;

  assert.ok(goalPayload);
  assert.ok(regimenPayload);
  assert.ok(geneticsPayload);

  const parsedGoal = goalUpsertPayloadSchema.parse(goalPayload);
  const parsedRegimen = regimenUpsertPayloadSchema.parse(regimenPayload);
  const parsedGenetics = geneticVariantUpsertPayloadSchema.parse(geneticsPayload);

  assert.equal(parsedGoal.metricTargets?.[0]?.comparator, "between");
  assert.equal(parsedGoal.metricTargets?.[0]?.highValue, 9);
  assert.equal(parsedGoal.metricTargets?.[0]?.evaluation.kind, "rolling-window");
  assert.equal(
    parsedGoal.metricTargets?.[0]?.selectionPolicyOverride?.kind,
    "daily-aggregate",
  );
  assert.equal(parsedRegimen.ingredients?.[0]?.compound, "magnesium-glycinate");
  assert.deepEqual(parsedRegimen.relatedGoalIds, [
    "goal_01JNV43AK9SK58T6GX3DWRZH9Q",
  ]);
  assert.deepEqual(parsedGenetics.sourceFamilyMemberIds, [
    "fam_01JNV44M0Y6J8W2W0Q7Y2H1K9M",
  ]);
});

test("assessment list capabilities only advertise supported date-range filtering", () => {
  const descriptor = healthEntityDescriptorByKind.get("assessment");

  assert.ok(descriptor?.query);
  assert.deepEqual(descriptor?.query?.genericListFilterCapabilities, ["date-range"]);
});

test("regimen CLI descriptor reuses CLI-owned registry command and runtime metadata", () => {
  const descriptor = healthEntityDescriptorByKind.get("regimen");
  const command = getHealthRegistryCommandMetadata("regimen");

  assert.ok(descriptor?.command);
  assert.ok(descriptor?.core);
  assert.ok(descriptor?.query);
  assert.equal(descriptor?.command?.commandName, command.commandName);
  assert.equal(descriptor?.command?.description, command.commandDescription);
  assert.equal(descriptor?.command?.payloadFile, command.payloadFile);
  assert.deepEqual(descriptor?.command?.showId, command.showId);
  assert.equal(descriptor?.core?.runtimeMethod, command.runtimeMethod);
  assert.equal(descriptor?.core?.upsertServiceMethod, command.upsertServiceMethod);
  assert.equal(descriptor?.query?.runtimeListMethod, command.runtimeListMethod);
  assert.equal(descriptor?.query?.runtimeShowMethod, command.runtimeShowMethod);
  assert.equal(descriptor?.query?.showServiceMethod, command.showServiceMethod);
  assert.equal(descriptor?.query?.listServiceMethod, command.listServiceMethod);
  assert.equal(descriptor?.core?.resultIdField, regimenRegistryEntityDefinition.registry.idField);
});

test("registry command metadata derives spaced method stems and status labels from shared nouns", () => {
  const family = getHealthRegistryCommandMetadata("family");
  const genetics = getHealthRegistryCommandMetadata("genetics");

  assert.equal(family.listServiceMethod, "listFamilyMembers");
  assert.equal(family.runtimeMethod, "upsertFamilyMember");
  assert.equal(family.runtimeShowMethod, "showFamilyMember");
  assert.equal(genetics.listServiceMethod, "listGeneticVariants");
  assert.equal(genetics.runtimeMethod, "upsertGeneticVariant");
  assert.equal(genetics.listStatusDescription, "Optional genetic-variant status to filter by.");
});

test("explicit health services reuse shared regimen metadata and nested registry envelopes", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cli-health-"));
  const payloadPath = path.join(vaultRoot, "regimen.json");
  const runtimeCalls: Array<Record<string, unknown>> = [];

  try {
    await writeFile(
      payloadPath,
      JSON.stringify({
        title: "Magnesium glycinate",
      }),
      "utf8",
    );

    const coreServices = createExplicitHealthCoreServices(async () => ({
      core: {
        async upsertRegimen(input: Record<string, unknown>) {
          runtimeCalls.push(input);

          return {
            record: {
              entity: {
                regimenId: "reg_01JSHAREDMETADATA000000000001",
              },
              document: {
                relativePath: "bank/regimens/supplement/sleep/magnesium-glycinate.md",
              },
            },
            created: true,
          };
        },
      } as never,
    }));
    const queryServices = createExplicitHealthQueryServices(async () => ({
      query: {
        async showRegimen() {
          return {
            entity: {
              regimenId: "reg_01JSHAREDMETADATA000000000001",
              title: "Magnesium glycinate",
              kind: "supplement",
              status: "active",
              startedOn: "2026-03-12",
              brand: "Thorne",
              ingredients: [],
            },
            document: {
              relativePath: "bank/regimens/supplement/sleep/magnesium-glycinate.md",
              markdown: "# Magnesium glycinate",
              body: "# Magnesium glycinate",
            },
          };
        },
        async showSupplement() {
          return {
            entity: {
              regimenId: "reg_01JSHAREDMETADATA000000000001",
              title: "Magnesium glycinate",
              kind: "supplement",
              status: "active",
              startedOn: "2026-03-12",
              brand: "Thorne",
              ingredients: [],
            },
            document: {
              relativePath: "bank/regimens/supplement/sleep/magnesium-glycinate.md",
              markdown: "# Magnesium glycinate",
              body: "# Magnesium glycinate",
            },
          };
        },
      } as never,
    }));

    const upsertResult = await coreServices.upsertRegimen({
      input: payloadPath,
      requestId: null,
      vault: vaultRoot,
    });
    const regimenResult = await queryServices.showRegimen({
      id: "reg_01JSHAREDMETADATA000000000001",
      requestId: null,
      vault: vaultRoot,
    });
    const supplementResult = await queryServices.showSupplement({
      id: "reg_01JSHAREDMETADATA000000000001",
      requestId: null,
      vault: vaultRoot,
    });

    assert.equal(runtimeCalls.length, 1);
    assert.equal(runtimeCalls[0]?.vaultRoot, vaultRoot);
    assert.equal(runtimeCalls[0]?.title, "Magnesium glycinate");
    assert.equal(upsertResult.regimenId, "reg_01JSHAREDMETADATA000000000001");
    assert.equal(
      regimenResult.entity.id,
      "reg_01JSHAREDMETADATA000000000001",
    );
    assert.equal(regimenResult.entity.data.brand, "Thorne");
    assert.equal(
      supplementResult.entity.id,
      "reg_01JSHAREDMETADATA000000000001",
    );
    assert.equal(supplementResult.entity.kind, "supplement");
    assert.equal(supplementResult.entity.data.brand, "Thorne");
    assert.equal(
      supplementResult.entity.path,
      "bank/regimens/supplement/sleep/magnesium-glycinate.md",
    );
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
