import { Cli, z } from "incur";
import {
  bindHealthCrudServices,
  createHealthCrudGroup,
  registerHealthCrudGroup,
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
} from "../health-cli-descriptors.js";
import type { HealthScaffoldResult } from "../health-cli-method-types.js";
import { pathSchema } from "../vault-cli-contracts.js";
import type { VaultCliServices } from "../vault-cli-services.js";

function requireHealthCommandDescriptor(commandName: string): HealthCommandDescriptorEntry {
  const descriptor = healthEntityDescriptorByCommandName.get(commandName);

  if (!descriptor || !hasHealthCommandDescriptor(descriptor)) {
    throw new Error(`No health command descriptor exists for "${commandName}".`);
  }

  return descriptor;
}

function createHealthUpsertResultSchema(descriptor: HealthCommandDescriptorEntry) {
  if (
    healthCoreHasResultCapability(descriptor, "current-profile-path") ||
    healthCoreHasResultCapability(descriptor, "profile-payload")
  ) {
    return z.object({
      vault: pathSchema,
      [descriptor.core.resultIdField]: z.string().min(1),
      lookupId: z.string().min(1),
      ledgerFile: pathSchema.optional(),
      currentProfilePath: pathSchema.optional(),
      created: z.boolean(),
      profile: healthPayloadSchema.optional(),
    });
  }

  if (healthCoreHasResultCapability(descriptor, "ledger-file")) {
    return z.object({
      vault: pathSchema,
      [descriptor.core.resultIdField]: z.string().min(1),
      lookupId: z.string().min(1),
      ledgerFile: pathSchema.optional(),
      created: z.boolean(),
    });
  }

  return z.object({
    vault: pathSchema,
    [descriptor.core.resultIdField]: z.string().min(1),
    lookupId: z.string().min(1),
    path: pathSchema.optional(),
    created: z.boolean(),
  });
}

function bindCrudServices(
  services: VaultCliServices,
  descriptor: HealthCommandDescriptorEntry,
) {
  return bindHealthCrudServices(services, {
    list: descriptor.query.listServiceMethod,
    scaffold: descriptor.core.scaffoldServiceMethod,
    show: descriptor.query.showServiceMethod,
    upsert: descriptor.core.upsertServiceMethod,
  });
}

type BoundCrudServices = ReturnType<typeof bindCrudServices>;
type BoundCrudShowResult = Awaited<ReturnType<BoundCrudServices["show"]>>;
type BoundCrudListResult = Awaited<ReturnType<BoundCrudServices["list"]>>;

function buildCrudGroupConfig(
  services: VaultCliServices,
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
    noun: descriptor.command.noun,
    outputs: {
      list: healthListResultSchema,
      scaffold: createHealthScaffoldResultSchema(descriptor.core.scaffoldNoun),
      show: healthShowResultSchema,
      upsert: createHealthUpsertResultSchema(descriptor),
    },
    payloadFile: descriptor.command.payloadFile,
    pluralNoun: descriptor.command.pluralNoun,
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
  services: VaultCliServices,
  commandName: string,
) {
  const descriptor = requireHealthCommandDescriptor(commandName);
  registerHealthCrudGroup<
    HealthScaffoldResult<string>,
    object,
    BoundCrudShowResult,
    BoundCrudListResult
  >(cli, buildCrudGroupConfig(services, descriptor));
}

export function createHealthEntityCrudGroup(
  services: VaultCliServices,
  commandName: string,
) {
  const descriptor = requireHealthCommandDescriptor(commandName);
  return createHealthCrudGroup<
    HealthScaffoldResult<string>,
    object,
    BoundCrudShowResult,
    BoundCrudListResult
  >(buildCrudGroupConfig(services, descriptor));
}
