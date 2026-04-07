import { Cli, z } from "incur";
import { requestIdFromOptions, withBaseOptions } from "@murphai/operator-config/command-helpers";
import { pathSchema } from "@murphai/operator-config/vault-cli-contracts";
import type { VaultServices } from "@murphai/assistant-engine/vault-services";
import {
  createHealthEntityCrudGroup,
} from "./health-entity-command-registry.js";
import { suggestedCommandsCta } from "./health-command-factory.js";

const rebuildResultSchema = z.object({
  vault: pathSchema,
  profilePath: pathSchema,
  snapshotId: z.string().min(1).nullable(),
  updated: z.boolean(),
})

export function registerProfileCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const profile = createHealthEntityCrudGroup(services, "profile");
  const current = Cli.create("current", {
    description: "Generated current-profile commands.",
  });

  current.command("rebuild", {
    args: z.object({}),
    description: "Rebuild the generated bank/profile/current.md view from the latest accepted profile snapshot.",
    examples: [
      {
        description: "Regenerate the generated current profile view after editing snapshots.",
        options: {
          vault: "./vault",
        },
      },
    ],
    hint: "Run this after accepting a snapshot if you need to refresh the generated current profile document immediately.",
    options: withBaseOptions(),
    output: rebuildResultSchema,
    async run(context) {
      const result = await services.core.rebuildCurrentProfile({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      });

      return context.ok(result, {
        cta: suggestedCommandsCta([
          {
            command: "profile show",
            args: {
              id: "current",
            },
            description: "Show the rebuilt generated current profile.",
            options: {
              vault: true,
            },
          },
          {
            command: "profile list",
            description: "List saved profile snapshots.",
            options: {
              vault: true,
            },
          },
        ]),
      });
    },
  });

  profile.command(current);
  cli.command(profile);
}
