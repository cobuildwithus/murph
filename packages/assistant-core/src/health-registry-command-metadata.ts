import {
  requireHealthEntityRegistryDefinition,
  type HealthEntityRegistryKind,
} from "@murph/contracts";

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
  methodStemPlural: string;
  methodStemSingular: string;
  runtimeMethod?: HealthCoreRuntimeMethodName;
  statusLabel?: string;
}

const healthRegistryCommandDerivationByKind: Record<
  HealthRegistryCommandKind,
  HealthRegistryCommandDerivation
> = {
  goal: {
    commandDescription: "Goal registry commands for the health extension surface.",
    methodStemPlural: "Goals",
    methodStemSingular: "Goal",
    statusLabel: "goal",
  },
  condition: {
    commandDescription: "Condition registry commands for the health extension surface.",
    methodStemPlural: "Conditions",
    methodStemSingular: "Condition",
    statusLabel: "condition",
  },
  allergy: {
    commandDescription: "Allergy registry commands for the health extension surface.",
    methodStemPlural: "Allergies",
    methodStemSingular: "Allergy",
    statusLabel: "allergy",
  },
  protocol: {
    commandDescription: "Protocol registry commands for the health extension surface.",
    methodStemPlural: "Protocols",
    methodStemSingular: "Protocol",
    runtimeMethod: "upsertProtocolItem",
    statusLabel: "protocol",
  },
  family: {
    commandDescription: "Family registry commands for the health extension surface.",
    methodStemPlural: "FamilyMembers",
    methodStemSingular: "FamilyMember",
  },
  genetics: {
    commandDescription: "Genetic variant commands for the health extension surface.",
    methodStemPlural: "GeneticVariants",
    methodStemSingular: "GeneticVariant",
    statusLabel: "genetic-variant",
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
  const singularMethodStem = derivation.methodStemSingular;
  const pluralMethodStem = derivation.methodStemPlural;

  return {
    commandDescription: derivation.commandDescription,
    commandName: kind,
    listServiceMethod: `list${pluralMethodStem}` as HealthQueryListServiceMethodName,
    ...(definition.registry.statusKeys.length > 0 && derivation.statusLabel
      ? {
          listStatusDescription: `Optional ${derivation.statusLabel} status to filter by.`,
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

function toCommandIdExample(noun: string): string {
  return noun.trim().replace(/\s+/gu, "-");
}

export { healthRegistryCommandMetadataByKind };
