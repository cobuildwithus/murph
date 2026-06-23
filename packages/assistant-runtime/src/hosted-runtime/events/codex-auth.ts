import { rm } from "node:fs/promises";
import path from "node:path";

import {
  executeCodexManagedAccountOperation,
} from "@murphai/assistant-engine";
import type {
  HostedExecutionCodexAuthRequestedWake,
} from "@murphai/hosted-execution";
import {
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
} from "@murphai/hosted-execution/cli-runtime-bridge";

import type { HostedRuntimePlatform } from "../platform.ts";
import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./mailbox-outcome.ts";

const HOSTED_CODEX_HOME_DIR_NAME = ".codex-hosted";
const HOSTED_CODEX_AUTH_FILE_NAME = "auth.json";

class HostedCodexAuthAttemptSupersededError extends Error {
  constructor() {
    super("Hosted Codex auth attempt was superseded.");
    this.name = "HostedCodexAuthAttemptSupersededError";
  }
}

export async function executeHostedCodexAuthWake(input: {
  operatorHomeRoot: string | null;
  platform: HostedRuntimePlatform;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
  wake: HostedExecutionCodexAuthRequestedWake;
}): Promise<HostedMailboxOutcome> {
  const port = input.platform.codexAuthPort;
  if (!port) {
    throw new Error("Hosted Codex auth wake requires a configured Codex auth port.");
  }
  if (!input.operatorHomeRoot) {
    throw new Error("Hosted Codex auth wake requires an operator home root.");
  }

  const codexHome = path.join(input.operatorHomeRoot, HOSTED_CODEX_HOME_DIR_NAME);
  try {
    if (input.wake.action === "connect") {
      await executeCodexManagedAccountOperation({
        action: "connect",
        codexCommand: input.runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV],
        codexHome,
        env: { ...input.runtimeEnv },
        onDeviceCode: async (deviceCode) => {
          const response = await port.update({
            attemptId: input.wake.attemptId,
            phase: "device_code",
            userCode: deviceCode.userCode,
            verificationUrl: deviceCode.verificationUrl,
          });
          if (!response.applied) {
            throw new HostedCodexAuthAttemptSupersededError();
          }
        },
        workingDirectory: input.vaultRoot,
      });
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "runtime-control",
        postCheckpointRecord: {
          attemptId: input.wake.attemptId,
          kind: "codex-auth.updated",
          phase: "connected",
        },
      });
    }

    await executeCodexManagedAccountOperation({
      action: "disconnect",
      codexCommand: input.runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV],
      codexHome,
      env: { ...input.runtimeEnv },
      workingDirectory: input.vaultRoot,
    });
    await rm(path.join(codexHome, HOSTED_CODEX_AUTH_FILE_NAME), { force: true });
    return createNoopMailboxEffect({
      conversationMetrics: null,
      mailboxLane: "runtime-control",
      postCheckpointRecord: {
        attemptId: input.wake.attemptId,
        kind: "codex-auth.updated",
        phase: "disconnected",
      },
    });
  } catch (error) {
    if (error instanceof HostedCodexAuthAttemptSupersededError) {
      return createNoopMailboxEffect({
        conversationMetrics: null,
        mailboxLane: "runtime-control",
      });
    }

    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: {
        eventCode: "assistant.codex_auth_failed",
      },
      error,
      level: "warn",
      message: "Hosted Codex account operation failed.",
      phase: "wake.running",
      wake: input.wake,
    });
    await port.update({
      attemptId: input.wake.attemptId,
      phase: "failed",
    });
    return createNoopMailboxEffect({
      conversationMetrics: null,
      mailboxLane: "runtime-control",
    });
  }
}
