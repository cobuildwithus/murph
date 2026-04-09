import { Cli, z } from "incur";
import {
  bindHealthCrudServices,
  createHealthCrudGroup,
} from "./health-command-factory.js";
import {
  createHealthScaffoldResultSchema,
  hasHealthCommandDescriptor,
  healthCoreHasResultCapability,
  healthEntityDescriptorByCommandName,
  healthListResultSchema,
  healthPayloadSchema,
  healthShowResultSchema,
  type HealthCommandDescriptorEntry,
} from "@murphai/vault-usecases";
import { pathSchema } from "@murphai/operator-config/vault-cli-contracts";
import type { VaultServices } from "@murphai/vault-usecases";

function requireHealthCommandDescriptor(commandName: string): HealthCommandDescriptorEntry {
  const descriptor = healthEntityDescriptorByCommandName.get(commandName);

  if (!descriptor || !hasHealthCommandDescriptor(descriptor)) {
    throw new Error(`No health command descriptor exists for "${commandName}".`);
  }

  return descriptor;
}

export function createHealthUpsertResultSchema(
  descriptor: HealthCommandDescriptorEntry,
) {
  const baseShape = createHealthUpsertResultBaseShape(descriptor);

  if (healthCoreHasResultCapability(descriptor, "ledger-file")) {
    return z.object({
      ...baseShape,
      ledgerFile: pathSchema.optional(),
    });
  }

  return z.object({
    ...baseShape,
    path: pathSchema.optional(),
  });
}

function createHealthUpsertResultBaseShape(
  descriptor: HealthCommandDescriptorEntry,
) {
  return {
    vault: pathSchema,
    [descriptor.core.resultIdField]: z.string().min(1),
    lookupId: z.string().min(1),
    created: z.boolean(),
  };
}

function bindCrudServices(
  services: VaultServices,
  descriptor: HealthCommandDescriptorEntry,
) {
  return bindHealthCrudServices(services, {
    list: descriptor.query.listServiceMethod,
    scaffold: descriptor.core.scaffoldServiceMethod,
    show: descriptor.query.showServiceMethod,
    upsert: descriptor.core.upsertServiceMethod,
  });
}

function createHealthEntityCrudConfig(
  services: VaultServices,
  descriptor: HealthCommandDescriptorEntry,
) {
  return {
    commandName: descriptor.command.commandName,
    description: descriptor.command.description,
    descriptions: descriptor.command.descriptions,
    examples: descriptor.command.examples,
    hints: descriptor.command.hints,
    listFilterCapabilities: descriptor.query.genericListFilterCapabilities,
    listStatusDescription: descriptor.command.listStatusDescription,
    noun: descriptor.noun,
    outputs: {
      list: healthListResultSchema,
      scaffold: createHealthScaffoldResultSchema(descriptor.core.scaffoldNoun),
      show: healthShowResultSchema,
      upsert: createHealthUpsertResultSchema(descriptor),
    },
    payloadFile: descriptor.command.payloadFile,
    pluralNoun: descriptor.plural,
    services: bindCrudServices(services, descriptor),
    showId: {
      ...descriptor.command.showId,
      fromUpsert(result: object) {
        return String(
          (result as Record<string, unknown>)[descriptor.core.resultIdField] ?? "",
        );
      },
    },
  };
}

export function registerHealthEntityCrudGroup(
  cli: Cli.Cli,
  services: VaultServices,
  commandName: string,
) {
  cli.command(createHealthEntityCrudGroup(services, commandName));
}

export function createHealthEntityCrudGroup(
  services: VaultServices,
  commandName: string,
) {
  const descriptor = requireHealthCommandDescriptor(commandName);
  return createHealthCrudGroup(createHealthEntityCrudConfig(services, descriptor));
}
