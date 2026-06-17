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
  type HealthCoreScaffoldServiceMethodName,
  type HealthCoreServiceMethods,
  type HealthCoreUpsertServiceMethodName,
  type HealthCommandDescriptorEntry,
  type HealthQueryListServiceMethodName,
  type HealthQueryServiceMethods,
  type HealthQueryShowServiceMethodName,
} from "@murphai/vault-usecases";
import { pathSchema } from "@murphai/operator-config/vault-cli-contracts";
import type { VaultServices } from "@murphai/vault-usecases";

type DescriptorBackedVaultServices = VaultServices & {
  core: VaultServices["core"] & HealthCoreServiceMethods;
  query: VaultServices["query"] & HealthQueryServiceMethods;
};

function requireHealthCommandDescriptor(commandName: string): HealthCommandDescriptorEntry {
  const descriptor = healthEntityDescriptorByCommandName.get(commandName);

  if (!descriptor || !hasHealthCommandDescriptor(descriptor)) {
    throw new Error(`No health command descriptor exists for "${commandName}".`);
  }

  return descriptor;
}

export function createHealthJsonImportResultSchema(
  descriptor: HealthCommandDescriptorEntry,
) {
  const baseShape = createHealthJsonImportResultBaseShape(descriptor);

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

function createHealthJsonImportResultBaseShape(
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
  const descriptorBackedServices = services as DescriptorBackedVaultServices;
  const methodNames = {
    list: descriptor.query.listServiceMethod,
    scaffold: descriptor.core.scaffoldServiceMethod,
    show: descriptor.query.showServiceMethod,
    upsert: descriptor.core.upsertServiceMethod,
  } satisfies {
    list: HealthQueryListServiceMethodName;
    scaffold: HealthCoreScaffoldServiceMethodName;
    show: HealthQueryShowServiceMethodName;
    upsert: HealthCoreUpsertServiceMethodName;
  };

  return bindHealthCrudServices(descriptorBackedServices, {
    list: methodNames.list,
    scaffold: methodNames.scaffold,
    show: methodNames.show,
    upsert: methodNames.upsert,
  });
}

function createHealthEntityCrudConfig(
  services: VaultServices,
  descriptor: HealthCommandDescriptorEntry,
) {
  return {
    commandName: descriptor.command.commandName,
    description: descriptor.command.description,
    descriptions: {
      list: descriptor.command.descriptions.list,
      scaffold: descriptor.command.descriptions.scaffold,
      show: descriptor.command.descriptions.show,
      importJson: descriptor.command.descriptions.upsert,
    },
    examples: descriptor.command.examples
      ? {
          list: descriptor.command.examples.list,
          scaffold: descriptor.command.examples.scaffold,
          show: descriptor.command.examples.show,
          importJson: descriptor.command.examples.upsert,
        }
      : undefined,
    hints: descriptor.command.hints
      ? {
          list: descriptor.command.hints.list,
          scaffold: descriptor.command.hints.scaffold,
          show: descriptor.command.hints.show,
          importJson: descriptor.command.hints.upsert,
        }
      : undefined,
    listFilterCapabilities: descriptor.query.genericListFilterCapabilities,
    listStatusDescription: descriptor.command.listStatusDescription,
    noun: descriptor.noun,
    outputs: {
      list: healthListResultSchema,
      scaffold: createHealthScaffoldResultSchema(descriptor.core.scaffoldNoun),
      show: healthShowResultSchema,
      importJson: createHealthJsonImportResultSchema(descriptor),
    },
    payloadSchema: descriptor.core.payloadSchema
      ? {
          examples: [descriptor.core.payloadTemplate],
          schema: descriptor.core.payloadSchema,
          schemaName: `${descriptor.command.commandName}-import-payload`,
        }
      : undefined,
    payloadFile: descriptor.command.payloadFile,
    pluralNoun: descriptor.plural,
    services: bindCrudServices(services, descriptor),
    showId: {
      ...descriptor.command.showId,
      fromImportJsonResult(result: object) {
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
