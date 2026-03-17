import { stat } from "node:fs/promises";

import {
  readBiomarkerLibraryPage,
  type BiomarkerLibraryPage,
} from "@healthybob/query";

import {
  buildExampleVaultPath,
  buildSuggestedCommand,
  getConfiguredVaultRoot,
  HEALTHYBOB_VAULT_ENV,
} from "./vault";

export interface ReadyRhrPageResult {
  page: BiomarkerLibraryPage;
  status: "ready";
}

export interface MissingConfigRhrPageResult {
  envVar: typeof HEALTHYBOB_VAULT_ENV;
  exampleVaultPath: string;
  status: "missing-config";
  suggestedCommand: string;
}

export interface NotFoundRhrPageResult {
  message: string;
  status: "not-found";
}

export interface ErrorRhrPageResult {
  envVar: typeof HEALTHYBOB_VAULT_ENV;
  hint: string;
  message: string;
  recoveryCommand: string;
  status: "error";
}

export type RhrPageResult =
  | ReadyRhrPageResult
  | MissingConfigRhrPageResult
  | NotFoundRhrPageResult
  | ErrorRhrPageResult;

export async function loadRestingHeartRatePageFromEnv(): Promise<RhrPageResult> {
  return loadRestingHeartRatePage({
    vaultRoot: getConfiguredVaultRoot(),
  });
}

export async function loadRestingHeartRatePage(options: {
  vaultRoot?: string | null;
} = {}): Promise<RhrPageResult> {
  const vaultRoot = options.vaultRoot ?? null;

  if (!vaultRoot) {
    return {
      envVar: HEALTHYBOB_VAULT_ENV,
      exampleVaultPath: buildExampleVaultPath(),
      status: "missing-config",
      suggestedCommand: buildSuggestedCommand(),
    };
  }

  try {
    const rootStats = await stat(vaultRoot);
    if (!rootStats.isDirectory()) {
      throw new Error("Vault root is not a directory.");
    }

    const page = await readBiomarkerLibraryPage(vaultRoot, "resting-heart-rate");
    if (!page) {
      return {
        message: "The configured vault does not include a resting-heart-rate library page yet.",
        status: "not-found",
      };
    }

    return {
      page,
      status: "ready",
    };
  } catch {
    return {
      envVar: HEALTHYBOB_VAULT_ENV,
      hint: "Confirm the configured vault path points at a Healthy Bob vault root, then restart the local app.",
      message: "The configured vault could not be read.",
      recoveryCommand: buildSuggestedCommand(),
      status: "error",
    };
  }
}
