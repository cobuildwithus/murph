import {
  clearWarmCodexChatGptAuthForSubject,
  type AssistantCodexChatGptAuthResolution,
  type AssistantCodexChatGptAuthResolver,
} from "@murphai/assistant-engine";
import type {
  HostedCodexAuthSeedResponse,
} from "@murphai/hosted-execution/runtime-control";

import type {
  HostedRuntimeCodexAuthPort,
} from "./platform.ts";

export interface HostedCodexChatGptAuthPreparation {
  clearFileBackedChatGptAuth: boolean;
  externalChatGptAuth: boolean;
  resolver: AssistantCodexChatGptAuthResolver | null;
}

type HostedCodexChatGptAuthMode = Omit<
  HostedCodexChatGptAuthPreparation,
  "resolver"
>;

interface HostedCodexChatGptAuthModeSelection {
  clearWarmChatGptAuth: boolean;
  mode: HostedCodexChatGptAuthMode;
}

export interface HostedCodexChatGptAuthModeChange {
  changed: boolean;
  clearWarmChatGptAuth: boolean;
}

export async function prepareHostedCodexChatGptAuth(input: {
  port: HostedRuntimeCodexAuthPort | null | undefined;
  signal?: AbortSignal | null;
  subject: string;
}): Promise<HostedCodexChatGptAuthPreparation> {
  if (!input.port) {
    return {
      clearFileBackedChatGptAuth: false,
      externalChatGptAuth: false,
      resolver: null,
    };
  }

  const startupMode = await selectHostedCodexChatGptAuthStartupMode({
    port: input.port,
    signal: input.signal ?? null,
    subject: input.subject,
  });
  return {
    ...startupMode,
    resolver: startupMode.externalChatGptAuth
      ? createHostedCodexChatGptAuthResolver(input.port)
      : null,
  };
}

export async function readHostedCodexChatGptAuthModeChange(input: {
  prepared: HostedCodexChatGptAuthPreparation;
  port: HostedRuntimeCodexAuthPort | null | undefined;
  signal?: AbortSignal | null;
}): Promise<HostedCodexChatGptAuthModeChange> {
  if (!input.port) {
    return { changed: false, clearWarmChatGptAuth: false };
  }

  const selection = await readHostedCodexChatGptAuthModeSelection({
    port: input.port,
    signal: input.signal ?? null,
  });
  const changed = selection.mode.clearFileBackedChatGptAuth
      !== input.prepared.clearFileBackedChatGptAuth
    || selection.mode.externalChatGptAuth !== input.prepared.externalChatGptAuth;
  return {
    changed,
    clearWarmChatGptAuth: changed && selection.clearWarmChatGptAuth,
  };
}

async function selectHostedCodexChatGptAuthStartupMode(input: {
  port: HostedRuntimeCodexAuthPort;
  signal: AbortSignal | null;
  subject: string;
}): Promise<HostedCodexChatGptAuthMode> {
  const selection = await readHostedCodexChatGptAuthModeSelection(input);
  if (selection.clearWarmChatGptAuth) {
    await clearWarmCodexChatGptAuthForSubject(input.subject);
  }
  return selection.mode;
}

async function readHostedCodexChatGptAuthModeSelection(input: {
  port: HostedRuntimeCodexAuthPort;
  signal: AbortSignal | null;
}): Promise<HostedCodexChatGptAuthModeSelection> {
  const response = await input.port.readAccessSeed(
    {
      includeCredentials: false,
      knownConnectionVersion: null,
      schemaVersion: 1,
    },
    { signal: input.signal },
  );

  if (response.status === "available") {
    throw new Error(
      "Hosted Codex ChatGPT auth metadata read unexpectedly returned credentials.",
    );
  }

  if (response.status === "available_metadata") {
    return {
      clearWarmChatGptAuth: false,
      mode: {
        clearFileBackedChatGptAuth: true,
        externalChatGptAuth: true,
      },
    };
  }

  if (response.status === "unchanged") {
    throw new Error(
      "Hosted Codex ChatGPT auth metadata read returned unchanged without a known connection version.",
    );
  }

  if (response.status === "unavailable") {
    switch (response.reason) {
      case "unconfigured":
        return {
          clearWarmChatGptAuth: true,
          mode: {
            clearFileBackedChatGptAuth: false,
            externalChatGptAuth: false,
          },
        };
      case "disconnected":
        return {
          clearWarmChatGptAuth: true,
          mode: {
            clearFileBackedChatGptAuth: true,
            externalChatGptAuth: false,
          },
        };
      case "legacy_device_code":
        // Temporary deploy compatibility: keep the existing file-backed auth
        // auto-detection only for a connection explicitly owned by the legacy
        // flow. Stop any warm access-seed process first so switching auth modes
        // cannot retain its bearer; the replacement process may then load the
        // legacy auth.json normally.
        return {
          clearWarmChatGptAuth: true,
          mode: {
            clearFileBackedChatGptAuth: false,
            externalChatGptAuth: false,
          },
        };
      case "expired":
      case "needs_attention":
        break;
    }
  }

  return {
    clearWarmChatGptAuth: response.status === "unavailable",
    mode: {
      clearFileBackedChatGptAuth: true,
      externalChatGptAuth: true,
    },
  };
}

function createHostedCodexChatGptAuthResolver(
  port: HostedRuntimeCodexAuthPort,
): AssistantCodexChatGptAuthResolver {
  return {
    async reportLoginResult(resultInput) {
      const response = await port.update({
        attemptId: resultInput.connectionVersion,
        phase: resultInput.result,
      });
      switch (response.status) {
        case "applied":
        case "already_applied":
          return "current";
        case "superseded":
          return "superseded";
      }
    },
    async resolve(resolveInput) {
      const response = await port.readAccessSeed(
        {
          includeCredentials: true,
          knownConnectionVersion: resolveInput.knownConnectionVersion,
          schemaVersion: 1,
        },
        { signal: resolveInput.signal ?? null },
      );
      return projectHostedCodexChatGptAuthResolution(
        response,
        resolveInput.knownConnectionVersion,
      );
    },
  };
}

function projectHostedCodexChatGptAuthResolution(
  response: HostedCodexAuthSeedResponse,
  knownConnectionVersion: string | null,
): AssistantCodexChatGptAuthResolution {
  switch (response.status) {
    case "available_metadata":
      throw new Error(
        "Hosted Codex ChatGPT auth credential read returned metadata without credentials.",
      );
    case "available":
      return {
        accessToken: response.accessToken,
        chatgptAccountId: response.chatgptAccountId,
        connectionVersion: response.connectionVersion,
        expiresAt: response.expiresAt,
        kind: "login",
      };
    case "unchanged":
      if (
        knownConnectionVersion === null
        || response.connectionVersion !== knownConnectionVersion
      ) {
        throw new Error(
          "Hosted Codex ChatGPT auth seed read returned an invalid unchanged connection version.",
        );
      }
      return { kind: "unchanged" };
    case "unavailable":
      return {
        authRequired:
          response.reason === "expired"
          || response.reason === "needs_attention",
        connectionVersion: response.connectionVersion,
        kind: "logout",
      };
  }
}
