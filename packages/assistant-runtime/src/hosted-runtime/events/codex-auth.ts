import { rm } from "node:fs/promises";
import path from "node:path";

import {
  executeCodexManagedAccountOperation,
} from "@murphai/assistant-engine";
import type {
  HostedExecutionCodexAuthRequestedWake,
} from "@murphai/hosted-execution";
import {
  buildHostedExecutionSafeErrorDetails,
  buildHostedExecutionSafeErrorDiagnostics,
  deriveHostedExecutionErrorCode,
  emitHostedExecutionStructuredLog,
} from "@murphai/hosted-execution";
import {
  HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV,
} from "@murphai/hosted-execution/cli-runtime-bridge";

import type { HostedRuntimePlatform } from "../platform.ts";
import {
  toHostedRuntimeLogCode,
  writeHostedRuntimeLogBestEffort,
} from "../runtime-logs.ts";
import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./mailbox-outcome.ts";

const HOSTED_CODEX_HOME_DIR_NAME = ".codex-hosted";
const HOSTED_CODEX_AUTH_FILE_NAME = "auth.json";

class HostedCodexAuthLocalDeleteError extends Error {
  constructor(cause: unknown) {
    super("Hosted Codex auth local credential delete failed.", { cause });
    this.name = "HostedCodexAuthLocalDeleteError";
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
      await connectHostedCodexManagedAccount({
        codexHome,
        platform: input.platform,
        runtimeEnv: input.runtimeEnv,
        vaultRoot: input.vaultRoot,
        wake: input.wake,
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

    await disconnectHostedCodexManagedAccountBestEffort({
      codexHome,
      platform: input.platform,
      runtimeEnv: input.runtimeEnv,
      vaultRoot: input.vaultRoot,
      wake: input.wake,
    });
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
    if (error instanceof HostedCodexAuthLocalDeleteError) {
      throw error;
    }

    if (input.wake.action === "connect") {
      await removeHostedCodexAuthJsonBestEffort({
        codexHome,
        wake: input.wake,
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
    await writeHostedCodexAuthFailureRuntimeLog({
      action: input.wake.action,
      attemptId: input.wake.attemptId,
      error,
      platform: input.platform,
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

async function writeHostedCodexAuthFailureRuntimeLog(input: {
  action: HostedExecutionCodexAuthRequestedWake["action"];
  attemptId: string;
  error: unknown;
  platform: Pick<HostedRuntimePlatform, "logPort">;
}): Promise<void> {
  const diagnostics = buildHostedExecutionSafeErrorDiagnostics(input.error);
  const details = buildHostedExecutionSafeErrorDetails(input.error);
  const errorCode = toHostedRuntimeLogCode(deriveHostedExecutionErrorCode(input.error));
  const errorCause = typeof details?.codexLoginError === "string"
    ? details.codexLoginError
    : typeof diagnostics?.errorCause === "string"
    ? diagnostics.errorCause
    : null;
  await writeHostedRuntimeLogBestEffort({
    entry: {
      attemptId: input.attemptId,
      component: "assistant",
      errorCode,
      eventCode: "assistant.codex_auth_failed",
      level: "warn",
      phase: "error",
      redactedJson: {
        action: input.action,
        errorCode,
        safeErrorMessage:
          typeof diagnostics?.errorMessage === "string"
            ? diagnostics.errorMessage
            : "Hosted Codex account operation failed.",
        ...(errorCause
          ? { errorCause }
          : {}),
        ...(typeof diagnostics?.errorDetail === "string"
          ? { errorDetail: diagnostics.errorDetail }
          : {}),
        ...(typeof diagnostics?.errorStatus === "number"
          ? { errorStatus: diagnostics.errorStatus }
          : {}),
        retryable: diagnostics?.retryable === true,
      },
    },
    platform: input.platform,
  });
}

async function removeHostedCodexAuthJsonBestEffort(input: {
  codexHome: string;
  wake: HostedExecutionCodexAuthRequestedWake;
}): Promise<void> {
  try {
    await rm(path.join(input.codexHome, HOSTED_CODEX_AUTH_FILE_NAME), { force: true });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: {
        eventCode: "assistant.codex_auth_connect_local_delete_failed",
      },
      error,
      level: "warn",
      message: "Hosted Codex account connect failed and local credential cleanup failed.",
      phase: "wake.running",
      wake: input.wake,
    });
  }
}

async function connectHostedCodexManagedAccount(input: {
  codexHome: string;
  platform: HostedRuntimePlatform;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
  wake: HostedExecutionCodexAuthRequestedWake;
}): Promise<void> {
  const result = await executeCodexManagedAccountOperation({
    action: "connect",
    codexCommand: input.runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV],
    codexHome: input.codexHome,
    env: { ...input.runtimeEnv },
    onDeviceCode: async ({ userCode, verificationUrl }) => {
      await input.platform.codexAuthPort?.update({
        attemptId: input.wake.attemptId,
        phase: "device_code",
        userCode,
        verificationUrl,
      });
    },
    workingDirectory: input.vaultRoot,
  });
  if (result.kind !== "connected") {
    throw new Error("Hosted Codex account connect did not complete.");
  }
}

async function disconnectHostedCodexManagedAccountBestEffort(input: {
  codexHome: string;
  platform: HostedRuntimePlatform;
  runtimeEnv: Readonly<Record<string, string>>;
  vaultRoot: string;
  wake: HostedExecutionCodexAuthRequestedWake;
}): Promise<void> {
  try {
    await executeCodexManagedAccountOperation({
      action: "disconnect",
      codexCommand: input.runtimeEnv[HOSTED_RUNTIME_CODEX_APP_SERVER_COMMAND_ENV],
      codexHome: input.codexHome,
      env: { ...input.runtimeEnv },
      workingDirectory: input.vaultRoot,
    });
  } catch (error) {
    emitHostedExecutionStructuredLog({
      component: "runtime",
      details: {
        eventCode: "assistant.codex_auth_disconnect_remote_failed",
      },
      error,
      level: "warn",
      message: "Hosted Codex account remote disconnect failed; deleting local credential.",
      phase: "wake.running",
      wake: input.wake,
    });
  }

  try {
    await rm(path.join(input.codexHome, HOSTED_CODEX_AUTH_FILE_NAME), { force: true });
  } catch (error) {
    throw new HostedCodexAuthLocalDeleteError(error);
  }
}
