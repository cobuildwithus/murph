import "server-only";

import { after } from "next/server";

export function scheduleHomepageBrowserVaultPreparation(input: {
  memberId: string;
}): void {
  try {
    after(async () => {
      try {
        const { prepareHomepageBrowserVaultBestEffort } = await import(
          "./homepage-preparation-worker"
        );
        await prepareHomepageBrowserVaultBestEffort(input);
      } catch {
        // Advisory preparation and its lazy module graph never affect delivery.
      }
    });
  } catch {
    // Homepage rendering never falls back to running advisory work inline.
  }
}
