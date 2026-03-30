import type { HealthEntityKind } from "@murph/contracts";

export interface HealthRegistryCommandMetadata {
  commandName: string;
  commandDescription: string;
  listServiceMethod: string;
  listStatusDescription?: string;
  payloadFile: string;
  runtimeListMethod: string;
  runtimeMethod: string;
  runtimeShowMethod: string;
  scaffoldServiceMethod: string;
  showId: {
    description: string;
    example: string;
  };
  showServiceMethod: string;
  upsertServiceMethod: string;
}

export type HealthRegistryCommandKind = Extract<
  HealthEntityKind,
  "goal" | "condition" | "allergy" | "protocol" | "family" | "genetics"
>;

const healthRegistryCommandMetadataByKind: Record<
  HealthRegistryCommandKind,
  HealthRegistryCommandMetadata
> = {
  goal: {
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
  },
  condition: {
    commandDescription: "Condition registry commands for the health extension surface.",
    commandName: "condition",
    listServiceMethod: "listConditions",
    listStatusDescription: "Optional condition status to filter by.",
    payloadFile: "condition.json",
    runtimeListMethod: "listConditions",
    runtimeMethod: "upsertCondition",
    runtimeShowMethod: "showCondition",
    scaffoldServiceMethod: "scaffoldCondition",
    showId: {
      description: "Condition id or slug to show.",
      example: "<condition-id>",
    },
    showServiceMethod: "showCondition",
    upsertServiceMethod: "upsertCondition",
  },
  allergy: {
    commandDescription: "Allergy registry commands for the health extension surface.",
    commandName: "allergy",
    listServiceMethod: "listAllergies",
    listStatusDescription: "Optional allergy status to filter by.",
    payloadFile: "allergy.json",
    runtimeListMethod: "listAllergies",
    runtimeMethod: "upsertAllergy",
    runtimeShowMethod: "showAllergy",
    scaffoldServiceMethod: "scaffoldAllergy",
    showId: {
      description: "Allergy id or slug to show.",
      example: "<allergy-id>",
    },
    showServiceMethod: "showAllergy",
    upsertServiceMethod: "upsertAllergy",
  },
  protocol: {
    commandDescription: "Protocol registry commands for the health extension surface.",
    commandName: "protocol",
    listServiceMethod: "listProtocols",
    listStatusDescription: "Optional protocol status to filter by.",
    payloadFile: "protocol.json",
    runtimeListMethod: "listProtocols",
    runtimeMethod: "upsertProtocolItem",
    runtimeShowMethod: "showProtocol",
    scaffoldServiceMethod: "scaffoldProtocol",
    showId: {
      description: "Protocol id or slug to show.",
      example: "<protocol-id>",
    },
    showServiceMethod: "showProtocol",
    upsertServiceMethod: "upsertProtocol",
  },
  family: {
    commandDescription: "Family registry commands for the health extension surface.",
    commandName: "family",
    listServiceMethod: "listFamilyMembers",
    payloadFile: "family.json",
    runtimeListMethod: "listFamilyMembers",
    runtimeMethod: "upsertFamilyMember",
    runtimeShowMethod: "showFamilyMember",
    scaffoldServiceMethod: "scaffoldFamilyMember",
    showId: {
      description: "Family member id or slug to show.",
      example: "<family-member-id>",
    },
    showServiceMethod: "showFamilyMember",
    upsertServiceMethod: "upsertFamilyMember",
  },
  genetics: {
    commandDescription: "Genetic variant commands for the health extension surface.",
    commandName: "genetics",
    listServiceMethod: "listGeneticVariants",
    listStatusDescription: "Optional genetic-variant status to filter by.",
    payloadFile: "genetics.json",
    runtimeListMethod: "listGeneticVariants",
    runtimeMethod: "upsertGeneticVariant",
    runtimeShowMethod: "showGeneticVariant",
    scaffoldServiceMethod: "scaffoldGeneticVariant",
    showId: {
      description: "Genetic variant id or slug to show.",
      example: "<genetic-variant-id>",
    },
    showServiceMethod: "showGeneticVariant",
    upsertServiceMethod: "upsertGeneticVariant",
  },
};

export function getHealthRegistryCommandMetadata(
  kind: HealthRegistryCommandKind,
): HealthRegistryCommandMetadata {
  return healthRegistryCommandMetadataByKind[kind];
}

export { healthRegistryCommandMetadataByKind };
