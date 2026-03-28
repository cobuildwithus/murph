import assert from "node:assert/strict";

import {
  hasHealthEntityRegistry,
  healthEntityDefinitionByKind,
} from "@murph/contracts";
import { test } from "vitest";

import {
  allergyRegistryDefinition,
  conditionRegistryDefinition,
  familyRegistryDefinition,
  geneticsRegistryDefinition,
  goalRegistryDefinition,
  protocolRegistryDefinition,
  toRegistryRecord,
} from "../src/health/registries.ts";

test("query registry definitions inherit canonical registry metadata from shared health entity definitions", () => {
  const registryDefinitions = [
    ["goal", goalRegistryDefinition],
    ["condition", conditionRegistryDefinition],
    ["allergy", allergyRegistryDefinition],
    ["protocol", protocolRegistryDefinition],
    ["family", familyRegistryDefinition],
    ["genetics", geneticsRegistryDefinition],
  ] as const;

  for (const [kind, registryDefinition] of registryDefinitions) {
    const definition = healthEntityDefinitionByKind.get(kind);

    assert.ok(definition, `missing health entity definition for ${kind}`);
    assert.ok(
      definition && hasHealthEntityRegistry(definition),
      `missing health registry metadata for ${kind}`,
    );

    if (!definition || !hasHealthEntityRegistry(definition)) {
      continue;
    }

    assert.equal(registryDefinition.directory, definition.registry.directory);
    assert.deepEqual(registryDefinition.idKeys, definition.registry.idKeys);
    assert.deepEqual(registryDefinition.titleKeys, definition.registry.titleKeys);
    assert.deepEqual(registryDefinition.statusKeys, definition.registry.statusKeys);
    assert.equal(typeof registryDefinition.transform, "function");
    assert.equal(
      typeof registryDefinition.compare,
      definition.registry.sortBehavior ? "function" : "undefined",
    );
  }
});

test("protocol registry projection keeps the shared relative-path grouping rule", () => {
  const projected = toRegistryRecord(
    {
      relativePath: "bank/protocols/supplements/sleep/magnesium-glycinate.md",
      markdown: "",
      body: "",
      attributes: {
        protocolId: "prot_01",
        title: "Magnesium glycinate",
        status: "active",
        kind: "supplement",
      },
    },
    protocolRegistryDefinition,
  );

  assert.equal(projected?.group, "supplements/sleep");
});
