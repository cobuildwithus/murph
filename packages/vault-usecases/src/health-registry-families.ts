import {
  allergyRegistryEntityDefinition,
  conditionRegistryEntityDefinition,
  familyRegistryEntityDefinition,
  geneticsRegistryEntityDefinition,
  goalRegistryEntityDefinition,
  protocolRegistryEntityDefinition,
  type HealthEntityDefinitionWithRegistry,
} from "@murphai/contracts";

import {
  getHealthRegistryCommandMetadata,
  type HealthRegistryCommandKind,
  type HealthRegistryCommandMetadata,
} from "./health-registry-command-metadata.js";

export type HealthRegistryFamilyKind = HealthRegistryCommandKind;

export interface HealthRegistryFamily<
  TKind extends HealthRegistryFamilyKind = HealthRegistryFamilyKind,
> {
  command: HealthRegistryCommandMetadata<TKind>;
  definition: HealthEntityDefinitionWithRegistry & { kind: TKind };
  idField: string;
  readEntityIdKeys: readonly string[];
  supportsStatusFilter: boolean;
}

function narrowHealthRegistryDefinition<TKind extends HealthRegistryFamilyKind>(
  definition: HealthEntityDefinitionWithRegistry,
  kind: TKind,
): HealthEntityDefinitionWithRegistry & { kind: TKind } {
  /* v8 ignore start -- fixed shared registry constants are wired to matching kinds */
  if (definition.kind !== kind) {
    throw new Error(`Expected registry entity "${kind}" but received "${definition.kind}".`);
  }
  /* v8 ignore stop */

  return definition as HealthEntityDefinitionWithRegistry & { kind: TKind };
}

function buildReadEntityIdKeys(idKeys: readonly string[]): readonly string[] {
  return [...new Set(["id", ...idKeys])];
}

function buildHealthRegistryFamily<TKind extends HealthRegistryFamilyKind>(input: {
  definition: HealthEntityDefinitionWithRegistry;
  kind: TKind;
}): HealthRegistryFamily<TKind> {
  const definition = narrowHealthRegistryDefinition(input.definition, input.kind);
  const idField = definition.registry.idField;

  /* v8 ignore start -- registry entities always define a canonical id field */
  if (!idField) {
    throw new Error(`Registry entity "${definition.kind}" is missing a canonical id field.`);
  }
  /* v8 ignore stop */

  return {
    command: getHealthRegistryCommandMetadata(input.kind),
    definition,
    idField,
    readEntityIdKeys: buildReadEntityIdKeys(definition.registry.idKeys),
    supportsStatusFilter: definition.registry.statusKeys.length > 0,
  };
}

export const healthRegistryFamilyByKind = {
  goal: buildHealthRegistryFamily({
    definition: goalRegistryEntityDefinition,
    kind: "goal",
  }),
  condition: buildHealthRegistryFamily({
    definition: conditionRegistryEntityDefinition,
    kind: "condition",
  }),
  allergy: buildHealthRegistryFamily({
    definition: allergyRegistryEntityDefinition,
    kind: "allergy",
  }),
  protocol: buildHealthRegistryFamily({
    definition: protocolRegistryEntityDefinition,
    kind: "protocol",
  }),
  family: buildHealthRegistryFamily({
    definition: familyRegistryEntityDefinition,
    kind: "family",
  }),
  genetics: buildHealthRegistryFamily({
    definition: geneticsRegistryEntityDefinition,
    kind: "genetics",
  }),
} as const satisfies Record<HealthRegistryFamilyKind, HealthRegistryFamily>;

export const healthRegistryFamilies: readonly HealthRegistryFamily[] =
  Object.values(healthRegistryFamilyByKind);

export function getHealthRegistryFamily<TKind extends HealthRegistryFamilyKind>(
  kind: TKind,
): HealthRegistryFamily<TKind> {
  return healthRegistryFamilyByKind[kind] as HealthRegistryFamily<TKind>;
}
