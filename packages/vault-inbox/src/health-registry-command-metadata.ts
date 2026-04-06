import {
  getHealthEntityRegistryCommandMetadata as getSharedHealthEntityRegistryCommandMetadata,
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
  const command = getSharedHealthEntityRegistryCommandMetadata(kind);

  return {
    commandDescription: command.commandDescription,
    commandName: command.commandName,
    listServiceMethod: command.listServiceMethodName as HealthQueryListServiceMethodName,
    ...(command.listStatusDescription
      ? {
          listStatusDescription: command.listStatusDescription,
        }
      : {}),
    payloadFile: command.payloadFile,
    runtimeListMethod: command.runtimeListMethodName as HealthQueryRuntimeListMethodName,
    runtimeMethod: command.runtimeMethodName as HealthCoreRuntimeMethodName,
    runtimeShowMethod: command.runtimeShowMethodName as HealthQueryRuntimeShowMethodName,
    scaffoldServiceMethod: command.scaffoldServiceMethodName as HealthCoreScaffoldServiceMethodName,
    showId: command.showId,
    showServiceMethod: command.showServiceMethodName as HealthQueryShowServiceMethodName,
    upsertServiceMethod: command.upsertServiceMethodName as HealthCoreUpsertServiceMethodName,
  };
}

export { healthRegistryCommandMetadataByKind };
