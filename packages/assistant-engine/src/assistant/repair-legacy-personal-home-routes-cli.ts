import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  repairLegacyPersonalHomeAutomationRoutesFromInputs,
} from "./managed-automations.js";

export interface LegacyPersonalHomeRouteRepairCliOptions {
  apply: boolean;
  help: boolean;
  inputIds: string[];
  vaultRoot: string;
}

const usage = `Usage:
  pnpm --dir packages/assistant-engine repair:legacy-personal-home-routes -- \\
    --vault-root <vault-root> \\
    --input-id <audited-input-id> [--input-id <audited-input-id> ...] \\
    --apply

Repairs legacy personal automation routes from exact retained direct-Linq inputs.
The command does not scan input history and makes no changes without --apply.`;

export function parseLegacyPersonalHomeRouteRepairArgs(
  argv: readonly string[],
): LegacyPersonalHomeRouteRepairCliOptions {
  let apply = false;
  let help = false;
  let vaultRoot = "";
  const inputIds: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      continue;
    }
    if (argument === "--apply") {
      apply = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--vault-root" || argument === "--input-id") {
      const value = argv[index + 1]?.trim() ?? "";
      if (value.length === 0 || value.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      index += 1;
      if (argument === "--vault-root") {
        if (vaultRoot.length > 0) {
          throw new Error("--vault-root may be provided only once");
        }
        vaultRoot = value;
      } else {
        inputIds.push(value);
      }
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  if (help) {
    return { apply, help, inputIds: [], vaultRoot: "" };
  }
  if (!apply) {
    throw new Error("--apply is required");
  }
  if (vaultRoot.length === 0) {
    throw new Error("--vault-root is required");
  }
  const uniqueInputIds = [...new Set(inputIds)];
  if (uniqueInputIds.length === 0) {
    throw new Error("at least one --input-id is required");
  }

  return {
    apply,
    help,
    inputIds: uniqueInputIds,
    vaultRoot,
  };
}

export async function runLegacyPersonalHomeRouteRepairCli(
  argv: readonly string[],
): Promise<number> {
  const options = parseLegacyPersonalHomeRouteRepairArgs(argv);
  if (options.help) {
    console.log(usage);
    return 0;
  }

  const updated = await repairLegacyPersonalHomeAutomationRoutesFromInputs({
    inputIds: options.inputIds,
    vaultRoot: options.vaultRoot,
  });
  console.log(
    `Legacy personal-home route repair completed: ${updated} route(s) updated from ${options.inputIds.length} audited input(s).`,
  );
  return updated;
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runLegacyPersonalHomeRouteRepairCli(process.argv.slice(2)).catch(() => {
    console.error("Legacy personal-home route repair failed. No identifiers were logged.");
    process.exitCode = 1;
  });
}
