import { Cli, z } from "incur";
import { requestIdFromOptions, withBaseOptions } from "@murphai/assistant-core/command-helpers";
import { localDateSchema, pathSchema } from "@murphai/assistant-core/vault-cli-contracts";
import type { VaultServices } from "@murphai/assistant-core/vault-services";
import {
  createHealthEntityCrudGroup,
} from "./health-entity-command-registry.js";
import { suggestedCommandsCta } from "./health-command-factory.js";

const stopResultSchema = z.object({
  vault: pathSchema,
  protocolId: z.string().min(1),
  lookupId: z.string().min(1),
  stoppedOn: localDateSchema.nullable(),
  status: z.string().min(1),
})

export function registerProtocolCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const protocol = createHealthEntityCrudGroup(services, "protocol");
  protocol.command("stop", {
    args: z.object({
      protocolId: z.string().min(1),
    }),
    description: "Stop one protocol while preserving its canonical id.",
    examples: [
      {
        args: {
          protocolId: "<protocol-id>",
        },
        description: "Stop a protocol today.",
        options: {
          vault: "./vault",
        },
      },
      {
        args: {
          protocolId: "<protocol-id>",
        },
        description: "Stop a protocol on a specific calendar day.",
        options: {
          stoppedOn: "2026-03-12",
          vault: "./vault",
        },
      },
    ],
    hint: "Use the canonical protocol id so the stop event is attached to the existing registry record.",
    options: withBaseOptions({
      stoppedOn: localDateSchema.optional(),
    }),
    output: stopResultSchema,
    async run(context) {
      const result = await services.core.stopProtocol({
        protocolId: context.args.protocolId,
        stoppedOn: context.options.stoppedOn,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      });

      return context.ok(result, {
        cta: suggestedCommandsCta([
          {
            command: "protocol show",
            args: {
              id: context.args.protocolId,
            },
            description: "Show the stopped protocol record.",
            options: {
              vault: true,
            },
          },
          {
            command: "protocol list",
            description: "List stopped protocols.",
            options: {
              status: "stopped",
              vault: true,
            },
          },
        ]),
      });
    },
  });

  cli.command(protocol);
}
