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

async function selectHostedCodexChatGptAuthStartupMode(input: {
  port: HostedRuntimeCodexAuthPort;
  signal: AbortSignal | null;
  subject: string;
}): Promise<Omit<HostedCodexChatGptAuthPreparation, "resolver">> {
  const response = await input.port.readAccessSeed(
    {
      knownConnectionVersion: null,
      schemaVersion: 1,
    },
    { signal: input.signal },
  );

  if (response.status === "unchanged") {
    throw new Error(
      "Hosted Codex ChatGPT auth seed read returned unchanged without a known connection version.",
    );
  }

  if (response.status === "unavailable") {
    switch (response.reason) {
      case "unconfigured":
        await clearWarmCodexChatGptAuthForSubject(input.subject);
        return {
          clearFileBackedChatGptAuth: false,
          externalChatGptAuth: false,
        };
      case "disconnected":
        await clearWarmCodexChatGptAuthForSubject(input.subject);
        return {
          clearFileBackedChatGptAuth: true,
          externalChatGptAuth: false,
        };
      case "legacy_device_code":
        // Temporary deploy compatibility: keep the existing file-backed auth
        // auto-detection only for a connection explicitly owned by the legacy
        // flow. Stop any warm access-seed process first so switching auth modes
        // cannot retain its bearer; the replacement process may then load the
        // legacy auth.json normally.
        await clearWarmCodexChatGptAuthForSubject(input.subject);
        return {
          clearFileBackedChatGptAuth: false,
          externalChatGptAuth: false,
        };
      case "expired":
      case "needs_attention":
        await clearWarmCodexChatGptAuthForSubject(input.subject);
        break;
    }
  }

  return {
    clearFileBackedChatGptAuth: true,
    externalChatGptAuth: true,
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
