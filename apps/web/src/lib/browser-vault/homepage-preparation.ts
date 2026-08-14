import "server-only";

import {
  assessBrowserVaultReplicaFreshness,
} from "@murphai/hosted-execution";
import {
  parseHostedBrowserVaultReplicaRef,
} from "@murphai/hosted-execution/parsers";
import { after } from "next/server";

import {
  signalHostedBrowserVaultRefreshRuntime,
} from "@/src/lib/hosted-orchestration/signal-runtime";
import { readHostedWorkspace } from "@/src/lib/hosted-workspace/store";
import { getPrisma } from "@/src/lib/prisma";

import { assertBrowserVaultMemberAuthority } from "./authority";

export function scheduleHomepageBrowserVaultPreparation(input: {
  memberId: string;
}): void {
  try {
    after(() => prepareHomepageBrowserVaultBestEffort(input));
  } catch {
    // Homepage rendering never falls back to running advisory work inline.
  }
}

async function prepareHomepageBrowserVaultBestEffort(input: {
  memberId: string;
}): Promise<void> {
  try {
    const prisma = getPrisma();
    await assertBrowserVaultMemberAuthority({
      memberId: input.memberId,
      prisma,
    });

    const workspace = await readHostedWorkspace({
      prisma,
      userId: input.memberId,
    });
    const replicaRef = readHomepageBrowserVaultReplicaRef(
      workspace?.browserVaultReplicaRef ?? null,
    );
    const freshness = assessBrowserVaultReplicaFreshness({
      now: new Date(),
      replicaRef,
    });

    if (!freshness.shouldRefresh) {
      return;
    }

    await signalHostedBrowserVaultRefreshRuntime({
      prisma,
      userId: input.memberId,
    });
  } catch {
    // Browser-vault preparation is advisory and must never affect homepage delivery.
  }
}

function readHomepageBrowserVaultReplicaRef(value: unknown) {
  try {
    return parseHostedBrowserVaultReplicaRef(
      value,
      "Homepage browser-vault preparation workspace replica ref",
    );
  } catch {
    return null;
  }
}
