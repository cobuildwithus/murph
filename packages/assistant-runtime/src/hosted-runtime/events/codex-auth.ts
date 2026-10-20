import { rm } from "node:fs/promises";
import path from "node:path";

import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./mailbox-outcome.ts";

export async function executeHostedCodexAuthWake(input: {
  operatorHomeRoot: string | null;
}): Promise<HostedMailboxOutcome> {
  await removeHostedCodexAuthJson(input.operatorHomeRoot);
  return createNoopMailboxEffect({
    conversationMetrics: null,
    mailboxLane: "runtime-control",
  });
}

export async function removeHostedCodexAuthJson(
  operatorHomeRoot: string | null,
): Promise<void> {
  if (!operatorHomeRoot) {
    throw new Error("Hosted Codex auth cleanup requires an operator home root.");
  }
  await rm(path.join(operatorHomeRoot, ".codex-hosted", "auth.json"), { force: true });
}
