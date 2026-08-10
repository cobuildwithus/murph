import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { expect } from "vitest";
import {
  listMurphDynamicToolNames,
} from "@murphai/assistant-engine/assistant-codex";
import {
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  deviceSyncProviderRuntimeSecretEnvKeys,
  deviceSyncProviderRuntimeVariableEnvKeys,
} from "@murphai/device-syncd/config";

const hostedWebSmokeDefaultEncryptionKey = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";
const hostedWebSmokeDefaultEncryptionKeyVersion = "v1";
const hostedLocalContextCompactionSummary = "local-offline-context-compaction-summary";
const hostedLocalResponsesCompactionSummary = "local-offline-compaction-summary";
const temporalDevUiPortOffset = 1_000;
const minTemporalDevFrontendPort = 10_000;
const maxTemporalDevFrontendPort = 65_535 - temporalDevUiPortOffset;
const maxTemporalDevPortReservationAttempts = 1_000;
const defaultHostedRunnerEnvProfiles = [
  "assistant",
] as const;
export const HOSTED_LOCAL_ASSISTANT_STUB_CLEARED_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "CEREBRAS_API_KEY",
  "DEEPSEEK_API_KEY",
  "FIREWORKS_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "HF_TOKEN",
  "HUGGINGFACEHUB_API_TOKEN",
  "HUGGINGFACE_API_KEY",
  "HUGGING_FACE_HUB_TOKEN",
  "LITELLM_PROXY_API_KEY",
  "MISTRAL_API_KEY",
  "NVIDIA_API_KEY",
  "NGC_API_KEY",
  "OPENROUTER_API_KEY",
  "PERPLEXITY_API_KEY",
  "TOGETHER_API_KEY",
  "VENICE_API_KEY",
  "XAI_API_KEY",
  "HOSTED_ASSISTANT_API_KEY_ENV",
  "HOSTED_ASSISTANT_BASE_URL",
  "HOSTED_ASSISTANT_CODEX_COMMAND",
  "HOSTED_ASSISTANT_GATEWAY_ONLY_PROVIDERS",
  "HOSTED_ASSISTANT_OSS",
  "HOSTED_ASSISTANT_PROFILE",
  "HOSTED_ASSISTANT_PROVIDER_NAME",
] as const;
export const HOSTED_LOCAL_DEVICE_SYNC_PROVIDER_CLEARED_ENV_KEYS = [
  ...deviceSyncProviderRuntimeSecretEnvKeys,
  ...deviceSyncProviderRuntimeVariableEnvKeys,
] as const;

export type HostedLocalAssistantProviderMode = "stub" | "live";

/**
 * One scripted Responses API response. A string yields an assistant message;
 * a tool call yields the matching Responses output item the real Codex
 * app-server executes. Hosted Terra uses `custom_tool_call` for code-mode
 * dynamic tools, while shell calls remain ordinary `function_call` items.
 * Tool-call turns consume one queued response per provider request: the call
 * first, then the follow-up text.
 */
type HostedLocalAssistantProviderFunctionCallResponse = {
    functionCall: {
      arguments: Record<string, unknown>;
      name: string;
      namespace?: string;
    };
  };

type HostedLocalAssistantProviderCustomToolCallResponse = {
  customToolCall: {
    input: string;
    name: string;
  };
};

type HostedLocalAssistantProviderToolCallResponse =
  | HostedLocalAssistantProviderCustomToolCallResponse
  | HostedLocalAssistantProviderFunctionCallResponse;

type HostedLocalAssistantProviderHeldTextResponse = {
  beforeResponse?: (() => Promise<void> | void) | null;
  onResponseStarted?: (() => void) | null;
  text: string;
};

export interface HostedLocalAssistantProviderRequestContext {
  requestBody: string;
  requestBodyJson: unknown;
  requestMatchText: string;
}

type HostedLocalAssistantProviderRequestDerivedResponse = {
  deriveResponse(
    input: HostedLocalAssistantProviderRequestContext,
  ): HostedLocalAssistantProviderToolCallResponse | string;
};

export type HostedLocalAssistantProviderScriptedResponse =
  | HostedLocalAssistantProviderScriptedResponsePayload
  | ({
      response: HostedLocalAssistantProviderScriptedResponsePayload;
    } & HostedLocalAssistantProviderResponseScopeOptions);

type HostedLocalAssistantProviderScriptedResponsePayload =
  | string
  | HostedLocalAssistantProviderCustomToolCallResponse
  | HostedLocalAssistantProviderFunctionCallResponse
  | HostedLocalAssistantProviderHeldTextResponse
  | HostedLocalAssistantProviderRequestDerivedResponse;

export interface HostedLocalAssistantProviderResponseScopeOptions {
  matchInputContains?: string | readonly string[] | null;
}

export function scopeHostedLocalAssistantProviderResponse(
  scriptedResponse: HostedLocalAssistantProviderScriptedResponse,
  scope: HostedLocalAssistantProviderResponseScopeOptions = {},
): HostedLocalAssistantProviderScriptedResponse {
  const existingScope = isScopedAssistantProviderScriptedResponse(scriptedResponse)
    ? normalizeAssistantProviderResponseMatchers(scriptedResponse.matchInputContains)
    : [];
  const additionalScope = normalizeAssistantProviderResponseMatchers(scope.matchInputContains);
  const response = normalizeHostedLocalAssistantProviderResponsePayload(
    readHostedLocalAssistantProviderResponsePayload(scriptedResponse),
  );
  const matchInputContains = [...existingScope, ...additionalScope];

  return matchInputContains.length > 0
    ? { matchInputContains, response }
    : response;
}

/**
 * Scripts a sandboxed shell execution through the real Codex app-server.
 * Codex 0.145.0 (CODEX_CLI_VERSION in Dockerfile.cloudflare-hosted-runner-base)
 * advertises the unified `exec_command` tool on Linux; bump the tool name here
 * if a Codex upgrade changes the advertised exec tool.
 */
export function buildAssistantProviderShellCommandCall(
  command: string,
): HostedLocalAssistantProviderScriptedResponse {
  return {
    functionCall: {
      arguments: { cmd: command },
      name: "exec_command",
    },
  };
}

/**
 * Scripts a Murph dynamic tool call. The real Codex app-server relays it to
 * the hosted runtime over `item/tool/call`, so the production dynamic-tool
 * execution path runs for real.
 */
export function buildAssistantProviderMurphToolCall(
  tool: string,
  toolArguments: Record<string, unknown>,
): HostedLocalAssistantProviderScriptedResponse {
  return {
    customToolCall: {
      input: buildAssistantProviderMurphCodeModeInput(tool, toolArguments),
      name: "exec",
    },
  };
}

export function buildAssistantProviderRequestDerivedMurphToolCall(
  tool: string,
  deriveArguments: (
    input: HostedLocalAssistantProviderRequestContext,
  ) => Record<string, unknown>,
): HostedLocalAssistantProviderScriptedResponse {
  return {
    deriveResponse(input) {
      return {
        customToolCall: {
          input: buildAssistantProviderMurphCodeModeInput(
            tool,
            deriveArguments(input),
          ),
          name: "exec",
        },
      };
    },
  };
}

function buildAssistantProviderMurphCodeModeInput(
  tool: string,
  toolArguments: Record<string, unknown>,
): string {
  return [
    `const result = await tools.murph__${tool}(${JSON.stringify(toolArguments)});`,
    "text(result);",
  ].join("\n");
}

/**
 * Scripts a vault-cli invocation exactly as production models run it: a shell
 * call executed inside the Codex sandbox with the runner PATH.
 */
export function buildAssistantProviderVaultCliCall(
  args: readonly string[],
): HostedLocalAssistantProviderScriptedResponse {
  return buildAssistantProviderShellCommandCall(
    ["vault-cli", ...args].map(quoteShellArgument).join(" "),
  );
}

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Asserts the real Codex app-server exposed the expected Murph dynamic tools
 * in the most recent recorded `/v1/responses` request body. Direct-tool models
 * advertise every enabled tool in the `murph` namespace. Code-mode models
 * eagerly describe non-deferred tools through `exec`; deferred tools remain
 * available inside Codex through its generic `ALL_TOOLS` discovery mechanism.
 */
export function expectAdvertisedMurphDynamicTools(
  requests: readonly HostedLocalAssistantProviderStubRequest[],
  options: {
    connectedAppsAvailable?: boolean;
    computerToolsAvailable?: boolean;
    groupRoomModelAvailable?: boolean;
    imessageContactAvailable?: boolean;
    messageTargetingAvailable?: boolean;
    pendingVaultFilesAvailable?: boolean;
    physicalNotesAvailable?: boolean;
    phoneCallsAvailable?: boolean;
    progressUpdatesAvailable?: boolean;
    responseCardAvailable?: boolean;
    vaultFileSendAvailable?: boolean;
    askGrokAvailable?: boolean;
  } = {},
): void {
  const lastResponsesRequest = [...requests]
    .reverse()
    .find((request) => request.url === "/v1/responses");
  const expectedToolNames = listMurphDynamicToolNames()
    .filter((name) => {
      if (
        options.computerToolsAvailable !== true
        && name.startsWith("murph.computer_")
      ) {
        return false;
      }

      if (
        options.connectedAppsAvailable !== true
        && name.startsWith("murph.connected_apps_")
      ) {
        return false;
      }

      if (
        options.messageTargetingAvailable !== true
        && (
          name === "murph.react_to_message"
          || name === "murph.select_reply_target"
        )
      ) {
        return false;
      }

      if (
        options.groupRoomModelAvailable !== true
        && name === "murph.group_room_model"
      ) {
        return false;
      }

      if (
        options.imessageContactAvailable !== true
        && name === "murph.imessage_contact"
      ) {
        return false;
      }

      if (
        options.physicalNotesAvailable !== true
        && name === "murph.send_physical_note"
      ) {
        return false;
      }

      if (
        options.progressUpdatesAvailable === false
        && name === "murph.send_progress_update"
      ) {
        return false;
      }

      if (
        options.responseCardAvailable !== true
        && name === "murph.attach_response_card"
      ) {
        return false;
      }

      if (
        options.pendingVaultFilesAvailable !== true
        && name === "murph.pending_vault_files"
      ) {
        return false;
      }

      if (
        options.vaultFileSendAvailable !== true
        && name === "murph.send_vault_file"
      ) {
        return false;
      }

      if (
        options.phoneCallsAvailable !== true
        && name === "murph.create_phone_call"
      ) {
        return false;
      }

      if (
        options.askGrokAvailable !== true
        && name === "murph.ask_grok"
      ) {
        return false;
      }

      return true;
    })
    .map((name) => name.replace(/^murph\./u, ""))
    .sort();
  expect(lastResponsesRequest).toBeDefined();
  const advertisement = readMurphDynamicToolAdvertisement(
    lastResponsesRequest!.body,
  );
  const expectedAdvertisedToolNames = advertisement.codeMode
    ? expectedToolNames.filter((name) => name !== "automation" && name !== "group")
    : expectedToolNames;
  expect(advertisement.toolNames.sort()).toEqual(expectedAdvertisedToolNames);
  if (advertisement.codeMode) {
    expect(advertisement.deferredDiscoveryAvailable).toBe(true);
  }
}

function readMurphDynamicToolAdvertisement(body: string): {
  codeMode: boolean;
  deferredDiscoveryAvailable: boolean;
  toolNames: string[];
} {
  const request = parseJsonObject(body);
  const candidateToolLists: unknown[][] = [];

  // The murph namespace appears in the top-level `tools` array on the full
  // Responses API. Responses Lite models (e.g. gpt-5.6-terra in Codex >= 0.144)
  // relocate the structured tool specs into an `additional_tools` input item
  // and null the top-level `tools`, so look in both places.
  const topLevelTools = request?.tools;
  if (Array.isArray(topLevelTools)) {
    candidateToolLists.push(topLevelTools);
  }

  const input = request?.input;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (
        item
        && typeof item === "object"
        && (item as { type?: unknown }).type === "additional_tools"
      ) {
        const tools = (item as { tools?: unknown }).tools;
        if (Array.isArray(tools)) {
          candidateToolLists.push(tools);
        }
      }
    }
  }

  const murphNamespace = candidateToolLists
    .flat()
    .find((tool): tool is { tools?: unknown } =>
      Boolean(
        tool
        && typeof tool === "object"
        && (tool as { type?: unknown }).type === "namespace"
        && (tool as { name?: unknown }).name === "murph",
      )
    );
  const names = new Set<string>();
  if (murphNamespace && Array.isArray(murphNamespace.tools)) {
    for (const tool of murphNamespace.tools) {
      if (
        tool
        && typeof tool === "object"
        && typeof (tool as { name?: unknown }).name === "string"
      ) {
        names.add((tool as { name: string }).name);
      }
    }
  }

  const execDescriptions = candidateToolLists
    .flat()
    .filter((tool): tool is { description?: unknown } =>
      Boolean(
        tool
        && typeof tool === "object"
        && (tool as { type?: unknown }).type === "custom"
        && (tool as { name?: unknown }).name === "exec",
      )
    )
    .map((tool) => tool.description)
    .filter((description): description is string =>
      typeof description === "string"
    );
  for (const description of execDescriptions) {
    for (const match of description.matchAll(/\bmurph__([a-z0-9_]+)\b/gu)) {
      const name = match[1];
      if (name) {
        names.add(name);
      }
    }
  }

  return {
    codeMode: execDescriptions.length > 0,
    deferredDiscoveryAvailable: execDescriptions.some((description) =>
      description.includes("ALL_TOOLS")
    ),
    toolNames: [...names],
  };
}

export interface HostedLocalAssistantProviderStubState {
  queuedResponses: HostedLocalAssistantProviderScriptedResponse[];
}

export interface HostedLocalAssistantProviderStubRequest {
  body: string;
  method: string;
  observedAtEpochMs?: number;
  url: string;
}

export type HostedLocalAssistantProviderStubUsageMode =
  | "fixed"
  | "request-body-estimate";

interface HostedLocalAssistantProviderUsage {
  input_tokens: number;
  input_tokens_details: {
    cached_tokens: number;
  };
  output_tokens: number;
  output_tokens_details: {
    reasoning_tokens: number;
  };
  total_tokens: number;
}

export function buildHostedAssistantNotificationDecisionResponse(input: {
  privateSummary?: string;
  subject?: string | null;
  text: string;
}): string {
  const text = input.text.trim();
  if (!text) {
    throw new Error("Hosted assistant notification decision text must be non-empty.");
  }

  const privateSummary = input.privateSummary?.trim() || "deliver";
  const subject = input.subject?.trim() || null;

  return JSON.stringify({
    kind: "send_message",
    privateSummary,
    text,
    ...(subject ? { subject } : {}),
  });
}

function dequeueAssistantProviderResponse(input: {
  requestBody?: string;
  requestBodyJson?: unknown;
  fallbackResponseText?: string | null;
  responseState?: HostedLocalAssistantProviderStubState;
}): HostedLocalAssistantProviderScriptedResponsePayload | null {
  const queuedResponses = input.responseState?.queuedResponses;
  if (!queuedResponses || queuedResponses.length === 0) {
    return input.fallbackResponseText ?? null;
  }

  const requestMatchText = buildAssistantProviderRequestMatchText({
    body: input.requestBody,
    bodyJson: input.requestBodyJson,
  });
  let responseIndex = selectMatchingScopedAssistantProviderResponseIndex(
    queuedResponses,
    requestMatchText,
  );
  if (responseIndex < 0) {
    responseIndex = queuedResponses.findIndex((scriptedResponse) =>
      assistantProviderScriptedResponseMatchesRequest(scriptedResponse, requestMatchText)
    );
  }
  if (responseIndex < 0) {
    return input.fallbackResponseText ?? null;
  }

  const scriptedResponse = queuedResponses.splice(responseIndex, 1)[0];
  if (!scriptedResponse) {
    return input.fallbackResponseText ?? null;
  }

  return readHostedLocalAssistantProviderResponsePayload(scriptedResponse);
}

function selectMatchingScopedAssistantProviderResponseIndex(
  queuedResponses: readonly HostedLocalAssistantProviderScriptedResponse[],
  requestMatchText: string,
): number {
  const seenSignatures = new Set<string>();
  let selectedIndex = -1;
  for (let index = 0; index < queuedResponses.length; index += 1) {
    const scriptedResponse = queuedResponses[index]!;
    const matchers = getAssistantProviderScriptedResponseMatchers(scriptedResponse);
    if (
      matchers.length === 0
      || !assistantProviderResponseMatchersMatchRequest(matchers, requestMatchText)
    ) {
      continue;
    }

    const signature = JSON.stringify(matchers);
    if (!seenSignatures.has(signature)) {
      seenSignatures.add(signature);
      selectedIndex = index;
    }
  }

  return selectedIndex;
}

function readHostedLocalAssistantProviderResponsePayload(
  scriptedResponse: HostedLocalAssistantProviderScriptedResponse,
): HostedLocalAssistantProviderScriptedResponsePayload {
  return isScopedAssistantProviderScriptedResponse(scriptedResponse)
    ? scriptedResponse.response
    : scriptedResponse;
}

function normalizeHostedLocalAssistantProviderResponsePayload(
  scriptedResponse: HostedLocalAssistantProviderScriptedResponsePayload,
): HostedLocalAssistantProviderScriptedResponsePayload {
  if (typeof scriptedResponse !== "string") {
    return scriptedResponse;
  }

  const trimmed = scriptedResponse.trim();
  if (!trimmed) {
    throw new Error("Hosted local assistant stub responses must be non-empty.");
  }

  return trimmed;
}

function isScopedAssistantProviderScriptedResponse(
  scriptedResponse: HostedLocalAssistantProviderScriptedResponse,
): scriptedResponse is {
  response: HostedLocalAssistantProviderScriptedResponsePayload;
} & HostedLocalAssistantProviderResponseScopeOptions {
  return (
    typeof scriptedResponse === "object"
    && scriptedResponse !== null
    && "response" in scriptedResponse
  );
}

function normalizeAssistantProviderResponseMatchers(
  matchInputContains: string | readonly string[] | null | undefined,
): string[] {
  const matchers =
    typeof matchInputContains === "string"
      ? [matchInputContains]
      : [...(matchInputContains ?? [])];
  const normalized = matchers.map((matcher) => matcher.trim());
  if (normalized.some((matcher) => matcher.length === 0)) {
    throw new Error("Hosted local assistant stub response matchers must be non-empty.");
  }

  return normalized;
}

function assistantProviderScriptedResponseMatchesRequest(
  scriptedResponse: HostedLocalAssistantProviderScriptedResponse,
  requestMatchText: string,
): boolean {
  const matchInputContains = getAssistantProviderScriptedResponseMatchers(scriptedResponse);

  return matchInputContains.length === 0
    || assistantProviderResponseMatchersMatchRequest(matchInputContains, requestMatchText);
}

function getAssistantProviderScriptedResponseMatchers(
  scriptedResponse: HostedLocalAssistantProviderScriptedResponse,
): string[] {
  return isScopedAssistantProviderScriptedResponse(scriptedResponse)
    ? normalizeAssistantProviderResponseMatchers(scriptedResponse.matchInputContains)
    : [];
}

function assistantProviderResponseMatchersMatchRequest(
  matchInputContains: readonly string[],
  requestMatchText: string,
): boolean {
  return matchInputContains.every((matcher) => requestMatchText.includes(matcher));
}

function buildAssistantProviderRequestMatchText(input: {
  body?: string;
  bodyJson?: unknown;
}): string {
  return [
    input.body ?? "",
    ...collectJsonStringValues(input.bodyJson),
  ].join("\n");
}

function collectJsonStringValues(value: unknown): string[] {
  const strings: string[] = [];

  function visit(current: unknown): void {
    if (typeof current === "string") {
      strings.push(current);
      return;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        visit(item);
      }
      return;
    }

    if (current && typeof current === "object") {
      for (const item of Object.values(current)) {
        visit(item);
      }
    }
  }

  visit(value);
  return strings;
}

function buildAssistantProviderResponsesApiStubResponse(input: {
  modelId: string;
  responseId?: string;
  responseText: string;
  usage: HostedLocalAssistantProviderUsage;
}): Record<string, unknown> {
  return {
    created_at: Math.floor(Date.now() / 1000),
    id: input.responseId ?? "resp_stub_hosted_local_e2e",
    model: input.modelId,
    output: [
      {
        content: [
          {
            annotations: [],
            text: input.responseText,
            type: "output_text",
          },
        ],
        id: "msg_stub_hosted_local_e2e",
        role: "assistant",
        type: "message",
      },
    ],
    usage: input.usage,
  };
}

async function prepareAssistantProviderScriptedResponse(
  scriptedResponse: HostedLocalAssistantProviderScriptedResponsePayload,
  requestContext: HostedLocalAssistantProviderRequestContext,
): Promise<string | HostedLocalAssistantProviderToolCallResponse> {
  if (
    typeof scriptedResponse === "string"
    || "customToolCall" in scriptedResponse
    || "functionCall" in scriptedResponse
  ) {
    return scriptedResponse;
  }
  if ("deriveResponse" in scriptedResponse) {
    return scriptedResponse.deriveResponse(requestContext);
  }

  scriptedResponse.onResponseStarted?.();
  await scriptedResponse.beforeResponse?.();
  return scriptedResponse.text;
}

function writeAssistantProviderResponsesApiStubStream(input: {
  modelId: string;
  response: ServerResponse;
  responseId: string;
  responseText: string;
  usage: HostedLocalAssistantProviderUsage;
}): void {
  const messageId = `msg_${input.responseId}`;
  const content = {
    annotations: [],
    text: input.responseText,
    type: "output_text",
  };
  const outputItem = {
    content: [content],
    id: messageId,
    role: "assistant",
    status: "completed",
    type: "message",
  };
  const completedResponse = {
    ...buildAssistantProviderResponsesApiStubResponse({
      modelId: input.modelId,
      responseId: input.responseId,
      responseText: input.responseText,
      usage: input.usage,
    }),
    output: [outputItem],
    status: "completed",
  };

  input.response.statusCode = 200;
  input.response.setHeader("cache-control", "no-cache");
  input.response.setHeader("content-type", "text/event-stream; charset=utf-8");
  writeAssistantProviderSseEvent(input.response, "response.created", {
    response: {
      ...completedResponse,
      output: [],
      status: "in_progress",
    },
    type: "response.created",
  });
  writeAssistantProviderSseEvent(input.response, "response.output_item.added", {
    item: {
      ...outputItem,
      content: [],
      status: "in_progress",
    },
    output_index: 0,
    type: "response.output_item.added",
  });
  writeAssistantProviderSseEvent(input.response, "response.content_part.added", {
    content_index: 0,
    item_id: messageId,
    output_index: 0,
    part: {
      annotations: [],
      text: "",
      type: "output_text",
    },
    type: "response.content_part.added",
  });
  writeAssistantProviderSseEvent(input.response, "response.output_text.delta", {
    content_index: 0,
    delta: input.responseText,
    item_id: messageId,
    output_index: 0,
    type: "response.output_text.delta",
  });
  writeAssistantProviderSseEvent(input.response, "response.output_text.done", {
    content_index: 0,
    item_id: messageId,
    output_index: 0,
    text: input.responseText,
    type: "response.output_text.done",
  });
  writeAssistantProviderSseEvent(input.response, "response.content_part.done", {
    content_index: 0,
    item_id: messageId,
    output_index: 0,
    part: content,
    type: "response.content_part.done",
  });
  writeAssistantProviderSseEvent(input.response, "response.output_item.done", {
    item: outputItem,
    output_index: 0,
    type: "response.output_item.done",
  });
  writeAssistantProviderSseEvent(input.response, "response.completed", {
    response: completedResponse,
    type: "response.completed",
  });
  input.response.write("data: [DONE]\n\n");
  input.response.end();
}

function buildAssistantProviderToolCallItem(input: {
  responseId: string;
  toolCall: HostedLocalAssistantProviderToolCallResponse;
}): Record<string, unknown> {
  if ("customToolCall" in input.toolCall) {
    return {
      call_id: `call_${input.responseId}`,
      id: `ctcall_${input.responseId}`,
      input: input.toolCall.customToolCall.input,
      name: input.toolCall.customToolCall.name,
      status: "completed",
      type: "custom_tool_call",
    };
  }

  return {
    arguments: JSON.stringify(input.toolCall.functionCall.arguments),
    call_id: `call_${input.responseId}`,
    id: `fcall_${input.responseId}`,
    name: input.toolCall.functionCall.name,
    ...(input.toolCall.functionCall.namespace
      ? { namespace: input.toolCall.functionCall.namespace }
      : {}),
    status: "completed",
    type: "function_call",
  };
}

function writeAssistantProviderToolCallStubStream(input: {
  modelId: string;
  response: ServerResponse;
  responseId: string;
  toolCallItem: Record<string, unknown>;
  usage: HostedLocalAssistantProviderUsage;
}): void {
  const completedResponse = {
    created_at: Math.floor(Date.now() / 1000),
    id: input.responseId,
    model: input.modelId,
    output: [input.toolCallItem],
    status: "completed",
    usage: input.usage,
  };

  input.response.statusCode = 200;
  input.response.setHeader("cache-control", "no-cache");
  input.response.setHeader("content-type", "text/event-stream; charset=utf-8");
  writeAssistantProviderSseEvent(input.response, "response.created", {
    response: {
      ...completedResponse,
      output: [],
      status: "in_progress",
    },
    type: "response.created",
  });
  writeAssistantProviderSseEvent(input.response, "response.output_item.added", {
    item: {
      ...input.toolCallItem,
      status: "in_progress",
    },
    output_index: 0,
    type: "response.output_item.added",
  });
  writeAssistantProviderSseEvent(input.response, "response.output_item.done", {
    item: input.toolCallItem,
    output_index: 0,
    type: "response.output_item.done",
  });
  writeAssistantProviderSseEvent(input.response, "response.completed", {
    response: completedResponse,
    type: "response.completed",
  });
  input.response.write("data: [DONE]\n\n");
  input.response.end();
}

function writeAssistantProviderContextCompactionStubStream(input: {
  modelId: string;
  response: ServerResponse;
  responseId: string;
  usage: HostedLocalAssistantProviderUsage;
}): void {
  const outputItem = {
    encrypted_content: hostedLocalContextCompactionSummary,
    type: "context_compaction",
  };
  const completedResponse = {
    created_at: Math.floor(Date.now() / 1000),
    id: input.responseId,
    model: input.modelId,
    output: [outputItem],
    status: "completed",
    usage: input.usage,
  };

  input.response.statusCode = 200;
  input.response.setHeader("cache-control", "no-cache");
  input.response.setHeader("content-type", "text/event-stream; charset=utf-8");
  writeAssistantProviderSseEvent(input.response, "response.created", {
    response: {
      ...completedResponse,
      output: [],
      status: "in_progress",
    },
    type: "response.created",
  });
  writeAssistantProviderSseEvent(input.response, "response.output_item.done", {
    item: outputItem,
    output_index: 0,
    type: "response.output_item.done",
  });
  writeAssistantProviderSseEvent(input.response, "response.completed", {
    response: completedResponse,
    type: "response.completed",
  });
  input.response.write("data: [DONE]\n\n");
  input.response.end();
}

function writeAssistantProviderSseEvent(
  response: ServerResponse,
  event: string,
  payload: Record<string, unknown>,
): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function startAssistantProviderStubServer(input: {
  fallbackResponseText?: string | null;
  maxResponsesApiRequestBodies?: number;
  modelId?: string;
  onRequest?: (request: HostedLocalAssistantProviderStubRequest) => void;
  responseState?: HostedLocalAssistantProviderStubState;
  usageMode?: HostedLocalAssistantProviderStubUsageMode;
} = {}): Promise<ReturnType<typeof createServer>> {
  const modelId = input.modelId ?? "gpt-5.6-terra";
  let responseSequence = 0;
  let responsesApiRequestBodyCount = 0;

  const server = createServer(async (request, response) => {
    const observedAtEpochMs = Date.now();
    const requestMethod = request.method ?? "GET";
    const requestUrl = request.url ?? "/";
    if (
      requestMethod === "POST"
      && requestUrl === "/v1/responses"
      && typeof input.maxResponsesApiRequestBodies === "number"
      && responsesApiRequestBodyCount >= input.maxResponsesApiRequestBodies
    ) {
      response.setHeader("connection", "close");
      writeJsonResponse(response, 429, {
        error: "Assistant provider stub captured the maximum configured Responses API request bodies.",
      });
      request.destroy();
      return;
    }

    const body = await readRequestBody(request);
    const requestRecord = {
      body,
      method: requestMethod,
      observedAtEpochMs,
      url: requestUrl,
    } satisfies HostedLocalAssistantProviderStubRequest;
    input.onRequest?.(requestRecord);
    if (process.env.MURPH_E2E_DEBUG_ASSISTANT_PROVIDER_STUB === "1") {
      console.log(
        `[assistant-provider-stub] ${requestRecord.method} ${requestRecord.url}`,
      );
    }

    if (request.method === "GET" && request.url === "/v1/models") {
      writeJsonResponse(response, 200, {
        data: [
          {
            id: modelId,
          },
        ],
      });
      return;
    }

    if (request.method === "POST" && request.url === "/v1/responses/compact") {
      const bodyJson = parseJsonObject(body);
      if (!bodyJson || typeof bodyJson !== "object") {
        writeJsonResponse(response, 400, {
          error: "Assistant provider stub requires a compact request with a JSON object body.",
        });
        return;
      }

      writeJsonResponse(response, 200, {
        output: [
          {
            encrypted_content: hostedLocalResponsesCompactionSummary,
            type: "compaction_summary",
          },
        ],
      });
      return;
    }

    if (request.method === "POST" && request.url === "/v1/responses") {
      responsesApiRequestBodyCount += 1;
      const bodyJson = parseJsonObject(body);
      if (!bodyJson || typeof bodyJson !== "object") {
        writeJsonResponse(response, 400, {
          error: "Assistant provider stub requires a responses request with a JSON object body.",
        });
        return;
      }

      responseSequence += 1;
      const responseId = `resp_stub_hosted_local_e2e_${responseSequence}`;
      if (isContextCompactionResponsesRequest(bodyJson)) {
        const usage = buildAssistantProviderStubUsage({
          body,
          responseText: hostedLocalContextCompactionSummary,
          usageMode: input.usageMode ?? "fixed",
        });
        if (bodyJson.stream === true) {
          writeAssistantProviderContextCompactionStubStream({
            modelId,
            response,
            responseId,
            usage,
          });
          return;
        }

        writeJsonResponse(response, 200, {
          ...buildAssistantProviderResponsesApiStubResponse({
            modelId,
            responseId,
            responseText: hostedLocalContextCompactionSummary,
            usage,
          }),
          output: [
            {
              encrypted_content: hostedLocalContextCompactionSummary,
              type: "context_compaction",
            },
          ],
        });
        return;
      }

      const scriptedResponse = dequeueAssistantProviderResponse({
        fallbackResponseText: input.fallbackResponseText,
        requestBody: body,
        requestBodyJson: bodyJson,
        responseState: input.responseState,
      });
      if (!scriptedResponse) {
        writeJsonResponse(response, 500, {
          error: "Assistant provider stub received a responses request without a queued response.",
        });
        return;
      }

      const preparedScriptedResponse =
        await prepareAssistantProviderScriptedResponse(scriptedResponse, {
          requestBody: body,
          requestBodyJson: bodyJson,
          requestMatchText: buildAssistantProviderRequestMatchText({
            body,
            bodyJson,
          }),
        });

      if (typeof preparedScriptedResponse !== "string") {
        const toolCallItem = buildAssistantProviderToolCallItem({
          responseId,
          toolCall: preparedScriptedResponse,
        });
        const usage = buildAssistantProviderStubUsage({
          body,
          responseText: JSON.stringify(toolCallItem),
          usageMode: input.usageMode ?? "fixed",
        });
        if (bodyJson.stream === true) {
          writeAssistantProviderToolCallStubStream({
            modelId,
            response,
            responseId,
            toolCallItem,
            usage,
          });
          return;
        }

        writeJsonResponse(response, 200, {
          created_at: Math.floor(Date.now() / 1000),
          id: responseId,
          model: modelId,
          output: [toolCallItem],
          status: "completed",
          usage,
        });
        return;
      }

      const responseText = preparedScriptedResponse;
      const usage = buildAssistantProviderStubUsage({
        body,
        responseText,
        usageMode: input.usageMode ?? "fixed",
      });

      if (bodyJson.stream === true) {
        writeAssistantProviderResponsesApiStubStream({
          modelId,
          response,
          responseId,
          responseText,
          usage,
        });
        return;
      }

      writeJsonResponse(response, 200, buildAssistantProviderResponsesApiStubResponse({
        modelId,
        responseId,
        responseText,
        usage,
      }));
      return;
    }

    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      const bodyJson = parseJsonObject(body);
      if (!bodyJson || !Array.isArray(bodyJson.messages)) {
        writeJsonResponse(response, 400, {
          error: "Assistant provider stub requires a chat completion request with a messages array.",
        });
        return;
      }

      const scriptedResponse = dequeueAssistantProviderResponse({
        fallbackResponseText: input.fallbackResponseText,
        requestBody: body,
        requestBodyJson: bodyJson,
        responseState: input.responseState,
      });
      if (!scriptedResponse) {
        writeJsonResponse(response, 500, {
          error: "Assistant provider stub received a completion request without a queued response.",
        });
        return;
      }
      if (typeof scriptedResponse !== "string") {
        writeJsonResponse(response, 500, {
          error: "Assistant provider stub only supports scripted text responses on /v1/chat/completions.",
        });
        return;
      }
      const responseText = scriptedResponse;

      writeJsonResponse(response, 200, {
        id: "chatcmpl_stub_hosted_local_e2e",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: responseText,
            },
          },
        ],
        usage: {
          prompt_tokens: 24,
          completion_tokens: 11,
          total_tokens: 35,
        },
      });
      return;
    }

    writeJsonResponse(response, 404, {
      error: `Unhandled assistant provider stub route: ${request.method ?? "GET"} ${request.url ?? "/"}`,
    });
  });

  await listenStubServer(server);
  return server;
}

export async function stopHttpStubServer(
  server: ReturnType<typeof createServer> | null,
): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

export async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function buildAssistantProviderStubUsage(input: {
  body: string;
  responseText: string;
  usageMode: HostedLocalAssistantProviderStubUsageMode;
}): HostedLocalAssistantProviderUsage {
  if (input.usageMode === "fixed") {
    return {
      input_tokens: 24,
      input_tokens_details: {
        cached_tokens: 0,
      },
      output_tokens: 11,
      output_tokens_details: {
        reasoning_tokens: 0,
      },
      total_tokens: 35,
    };
  }

  const inputTokens = estimateTokensFromUtf8Bytes(input.body);
  const outputTokens = estimateTokensFromUtf8Bytes(input.responseText);

  return {
    input_tokens: inputTokens,
    input_tokens_details: {
      cached_tokens: 0,
    },
    output_tokens: outputTokens,
    output_tokens_details: {
      reasoning_tokens: 0,
    },
    total_tokens: inputTokens + outputTokens,
  };
}

function estimateTokensFromUtf8Bytes(value: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(value, "utf8") / 4));
}

export function resolveHostedAssistantLocalDevEnv(
  source: NodeJS.ProcessEnv,
  assistantProviderMode: HostedLocalAssistantProviderMode,
  assistantProviderStubBaseUrl: string | null,
  scenarioLabel: string,
): NodeJS.ProcessEnv {
  if (assistantProviderMode === "stub") {
    const normalizedAssistantProviderStubBaseUrl = assistantProviderStubBaseUrl?.trim();
    if (!normalizedAssistantProviderStubBaseUrl) {
      throw new Error(`${scenarioLabel} requires an assistant provider stub base URL in stub mode.`);
    }

    return {
      ...buildHostedAssistantStubEnvClearances(),
      HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
      HOSTED_ASSISTANT_PROVIDER: "openai",
      HOSTED_ASSISTANT_REASONING_EFFORT: "low",
      [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]:
        normalizedAssistantProviderStubBaseUrl,
      NODE_ENV: "test",
      OPENAI_API_KEY: "stub-local-openai-key",
    };
  }

  const provider = source.HOSTED_ASSISTANT_PROVIDER?.trim();
  const model = source.HOSTED_ASSISTANT_MODEL?.trim();

  if (!provider || !model) {
    throw new Error(
      [
        `${scenarioLabel} requires explicit hosted assistant config in live mode.`,
        "Set HOSTED_ASSISTANT_PROVIDER and HOSTED_ASSISTANT_MODEL before enabling live mode.",
      ].join(" "),
    );
  }

  return {};
}

function buildHostedAssistantStubEnvClearances(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of HOSTED_LOCAL_ASSISTANT_STUB_CLEARED_ENV_KEYS) {
    env[key] = undefined;
  }
  return env;
}

export function buildHostedLocalDeviceSyncProviderEnvClearances(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of HOSTED_LOCAL_DEVICE_SYNC_PROVIDER_CLEARED_ENV_KEYS) {
    env[key] = "";
  }
  return env;
}

export function resolveHostedLocalSmokeWebEnv(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION:
      source.HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION
      ?? hostedWebSmokeDefaultEncryptionKeyVersion,
    HOSTED_CONTACT_PRIVACY_KEYS:
      source.HOSTED_CONTACT_PRIVACY_KEYS
      ?? `v1:${hostedWebSmokeDefaultEncryptionKey}`,
  };
}

export function resolveHostedAssistantProviderMode(
  source: NodeJS.ProcessEnv,
): HostedLocalAssistantProviderMode {
  const explicitMode = source.MURPH_E2E_ASSISTANT_PROVIDER_MODE?.trim().toLowerCase();
  if (explicitMode === "stub" || explicitMode === "live") {
    return explicitMode;
  }

  if (explicitMode) {
    throw new Error(
      `Unsupported hosted local assistant provider mode: ${source.MURPH_E2E_ASSISTANT_PROVIDER_MODE}`,
    );
  }

  const legacyStub = source.MURPH_E2E_STUB_ASSISTANT_PROVIDER?.trim();
  if (legacyStub) {
    return legacyStub === "0" ? "live" : "stub";
  }

  return "stub";
}

export function buildStableNumericSuffix(value: string, length: number): string {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) % 10_000_000;
  }

  return String(hash).padStart(length, "0").slice(-length);
}

export function mergeRequiredEnvProfile(
  existingProfiles: string | undefined,
  requiredProfile: string,
): string {
  const profiles = new Set(
    [
      defaultHostedRunnerEnvProfiles.join(","),
      existingProfiles,
    ]
      .filter((entry): entry is string => typeof entry === "string")
      .join(",")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  profiles.add(requiredProfile);
  return Array.from(profiles).join(",");
}

export function requireBoundTcpPort(
  server: ReturnType<typeof createServer>,
  label: string,
): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`Expected the ${label} server to bind a TCP port.`);
  }

  return address.port;
}

export function buildHostLoopbackStubBaseUrl(
  server: ReturnType<typeof createServer>,
  label: string,
): string {
  return `http://127.0.0.1:${requireBoundTcpPort(server, label)}`;
}

export async function reserveLocalTcpPort(): Promise<number> {
  const server = createNetServer();

  return await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected a local TCP port reservation."));
        return;
      }

      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve(port);
      });
    });
  });
}

export async function reserveLocalTemporalTcpPort(input: {
  excludedPorts?: Iterable<number>;
} = {}): Promise<number> {
  const excludedPorts = new Set(input.excludedPorts ?? []);
  const candidateCount = maxTemporalDevFrontendPort - minTemporalDevFrontendPort + 1;
  const firstOffset = Math.floor(Math.random() * candidateCount);
  const attempts = Math.min(candidateCount, maxTemporalDevPortReservationAttempts);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = minTemporalDevFrontendPort + ((firstOffset + attempt) % candidateCount);
    if (!isLocalTemporalTcpPortCandidateUsable({ excludedPorts, port })) {
      continue;
    }

    const uiPort = port + temporalDevUiPortOffset;
    if (await canBindLocalTcpPort(port) && await canBindLocalTcpPort(uiPort)) {
      return port;
    }
  }

  throw new Error("Unable to reserve a local Temporal TCP port with an available UI companion port.");
}

export function isLocalTemporalTcpPortCandidateUsable(input: {
  excludedPorts?: Iterable<number>;
  port: number;
}): boolean {
  if (
    !Number.isSafeInteger(input.port)
    || input.port <= 0
    || input.port > maxTemporalDevFrontendPort
  ) {
    return false;
  }

  const excludedPorts = new Set(input.excludedPorts ?? []);
  return !excludedPorts.has(input.port)
    && !excludedPorts.has(input.port + temporalDevUiPortOffset);
}

async function canBindLocalTcpPort(port: number): Promise<boolean> {
  const server = createNetServer();
  return await new Promise<boolean>((resolve) => {
    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => {
        resolve(!error);
      });
    });
  });
}

async function listenStubServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function isContextCompactionResponsesRequest(value: Record<string, unknown>): boolean {
  return containsContextCompactionTrigger(value);
}

function containsContextCompactionTrigger(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(containsContextCompactionTrigger);
  }

  const record = value as Record<string, unknown>;
  if (record.type === "context_compaction" && record.encrypted_content === undefined) {
    return true;
  }

  return Object.values(record).some(containsContextCompactionTrigger);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
