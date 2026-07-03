import { Cli, z } from "incur";

import {
  PROFILE_DISPLAY_NAME_MAX_LENGTH,
  profileDocumentSnapshotSchema,
} from "@murphai/contracts";
import {
  readProfileDocument,
  setProfileDisplayName,
} from "@murphai/core";

const vaultOptionSchema = z.object({
  vault: z.string().min(1).describe("Vault root."),
});

const profileShowResultSchema = z.object({
  vault: z.string().min(1),
  document: profileDocumentSnapshotSchema,
});

export function registerProfileCommands(cli: Cli.Cli) {
  const profile = Cli.create("profile", {
    description:
      "Canonical typed profile document commands. Structured profile facts such as the preferred display name live here, not in freeform memory.",
  });

  profile.command("show", {
    args: z.object({}),
    description: "Show the canonical profile document.",
    options: vaultOptionSchema,
    output: profileShowResultSchema,
    async run({ options }) {
      return {
        vault: options.vault,
        document: await readProfileDocument(options.vault),
      };
    },
  });

  profile.command("set-name", {
    description:
      "Set the user's preferred display name in the canonical profile document.",
    args: z.object({
      displayName: z
        .string()
        .trim()
        .min(1)
        .max(PROFILE_DISPLAY_NAME_MAX_LENGTH)
        .describe("The user's preferred display name."),
    }),
    options: vaultOptionSchema,
    output: profileShowResultSchema,
    async run({ args, options }) {
      return {
        vault: options.vault,
        document: await setProfileDisplayName(options.vault, {
          displayName: args.displayName,
        }),
      };
    },
  });

  cli.command(profile);
}
