import {
  requireHealthEntityRegistryDefinition,
  type HealthEntityRegistryKind,
} from "@murphai/contracts";

import type {
  HealthCoreRuntimeMethodName,
  HealthCoreScaffoldServiceMethodName,
  HealthCoreUpsertServiceMethodName,
  HealthQueryListServiceMethodName,
  HealthQueryRuntimeListMethodName,
  HealthQueryRuntimeShowMethodName,
  HealthQueryShowServiceMethodName,
} from "./health-cli-method-types.js";

export interface HealthRegistryCommandMetadata {
  commandName: HealthRegistryCommandKind;
  commandDescription: string;
  listServiceMethod: HealthQueryListServiceMethodName;
  listStatusDescription?: string;
  payloadFile: string;
  runtimeListMethod: HealthQueryRuntimeListMethodName;
  runtimeMethod: HealthCoreRuntimeMethodName;
  runtimeShowMethod: HealthQueryRuntimeShowMethodName;
  scaffoldServiceMethod: HealthCoreScaffoldServiceMethodName;
  showId: {
    description: string;
    example: string;
  };
  showServiceMethod: HealthQueryShowServiceMethodName;
  upsertServiceMethod: HealthCoreUpsertServiceMethodName;
}

export type HealthRegistryCommandKind = HealthEntityRegistryKind;

interface HealthRegistryCommandDerivation {
  commandDescription: string;
  runtimeMethod?: HealthCoreRuntimeMethodName;
}

const healthRegistryCommandDerivationByKind: Record<
  HealthRegistryCommandKind,
  HealthRegistryCommandDerivation
> = {
  goal: {
    commandDescription: "Goal registry commands for the health extension surface.",
  },
  condition: {
    commandDescription: "Condition registry commands for the health extension surface.",
  },
  allergy: {
    commandDescription: "Allergy registry commands for the health extension surface.",
  },
  protocol: {
    commandDescription: "Protocol registry commands for the health extension surface.",
    runtimeMethod: "upsertProtocolItem",
  },
  family: {
    commandDescription: "Family registry commands for the health extension surface.",
  },
  genetics: {
    commandDescription: "Genetic variant commands for the health extension surface.",
  },
};

const healthRegistryCommandMetadataByKind = {
  goal: buildHealthRegistryCommandMetadata("goal"),
  condition: buildHealthRegistryCommandMetadata("condition"),
  allergy: buildHealthRegistryCommandMetadata("allergy"),
  protocol: buildHealthRegistryCommandMetadata("protocol"),
  family: buildHealthRegistryCommandMetadata("family"),
  genetics: buildHealthRegistryCommandMetadata("genetics"),
} as const satisfies Record<HealthRegistryCommandKind, HealthRegistryCommandMetadata>;

export function getHealthRegistryCommandMetadata(
  kind: HealthRegistryCommandKind,
): HealthRegistryCommandMetadata {
  return healthRegistryCommandMetadataByKind[kind];
}

function buildHealthRegistryCommandMetadata(
  kind: HealthRegistryCommandKind,
): HealthRegistryCommandMetadata {
  const definition = requireHealthEntityRegistryDefinition(kind);
  const derivation = healthRegistryCommandDerivationByKind[kind];
  const singularMethodStem = toHealthRegistryMethodStem(definition.noun);
  const pluralMethodStem = toHealthRegistryMethodStem(definition.plural);

  return {
    commandDescription: derivation.commandDescription,
    commandName: kind,
    listServiceMethod: `list${pluralMethodStem}` as HealthQueryListServiceMethodName,
    ...(definition.registry.statusKeys.length > 0
      ? {
          listStatusDescription: `Optional ${toHealthRegistryStatusLabel(definition.noun)} status to filter by.`,
        }
      : {}),
    payloadFile: `${kind}.json`,
    runtimeListMethod: `list${pluralMethodStem}` as HealthQueryRuntimeListMethodName,
    runtimeMethod:
      derivation.runtimeMethod
      ?? (`upsert${singularMethodStem}` as HealthCoreRuntimeMethodName),
    runtimeShowMethod: `show${singularMethodStem}` as HealthQueryRuntimeShowMethodName,
    scaffoldServiceMethod: `scaffold${singularMethodStem}` as HealthCoreScaffoldServiceMethodName,
    showId: {
      description: `${capitalize(definition.noun)} id or slug to show.`,
      example: `<${toCommandIdExample(definition.noun)}-id>`,
    },
    showServiceMethod: `show${singularMethodStem}` as HealthQueryShowServiceMethodName,
    upsertServiceMethod: `upsert${singularMethodStem}` as HealthCoreUpsertServiceMethodName,
  };
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function toHealthRegistryMethodStem(value: string): string {
  return value
    .trim()
    .split(/[\s_-]+/u)
    .filter(Boolean)
    .map(capitalize)
    .join("");
}

function toHealthRegistryStatusLabel(value: string): string {
  return value.trim().replace(/[\s_]+/gu, "-");
}

function toCommandIdExample(noun: string): string {
  return noun.trim().replace(/\s+/gu, "-");
}

export { healthRegistryCommandMetadataByKind };
