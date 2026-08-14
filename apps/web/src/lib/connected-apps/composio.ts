import "server-only";

import Composio, { APIConnectionError, APIError } from "@composio/client";
import type {
  SessionCreateParams,
  SessionExecuteParams,
  SessionLinkParams,
  SessionSearchParams,
} from "@composio/client/resources/tool-router/session/session";

import {
  HOSTED_CONNECTED_APPS_SERVICE_TOOLS,
  type HostedConnectedAppsConfig,
} from "./config";

const COMPOSIO_REQUEST_TIMEOUT_MS = 30_000;
const COMPOSIO_ERROR_RESPONSE_TIMEOUT_MS = 1_000;
const COMPOSIO_ERROR_RESPONSE_LIMIT_BYTES = 64 * 1024;
// Memory ceiling for the raw provider body only. A mailbox read carrying full
// HTML bodies routinely exceeds a few hundred kilobytes before compaction, so
// this sits well above the assistant result budget the route enforces after
// stripping markup; rejecting here would discard a payload that compacts to a
// fraction of its wire size.
const COMPOSIO_RESPONSE_LIMIT_BYTES = 4 * 1024 * 1024;

type ComposioConnectedAccountStatus = NonNullable<
  Composio.ConnectedAccountListParams["statuses"]
>[number];

type ComposioDirectExecuteParams = Composio.ToolExecuteParams & Required<Pick<
  Composio.ToolExecuteParams,
  "arguments" | "user_id" | "version"
>>;

// Composio's high-level Session.search contract supports this filter, while
// the generated REST request type has not yet surfaced it.
type ComposioSessionSearchParams = SessionSearchParams & {
  toolkits?: string[];
};

export interface ComposioConnectedAccount {
  alias: string | null;
  id: string;
  isDisabled: boolean;
  status: string;
  toolkit: {
    name: string;
    slug: string;
  };
  wordId: string | null;
}

export class ComposioConnectedAppsRequestError extends Error {
  readonly operationName: string | null;
  readonly retryable: boolean | null;
  readonly status: number | null;
  readonly type: string | null;

  constructor(
    message: string,
    status: number | null = null,
    options: {
      cause?: unknown;
      operationName?: string | null;
      retryable?: boolean | null;
      type?: string | null;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ComposioConnectedAppsRequestError";
    this.operationName = options.operationName ?? null;
    this.retryable = options.retryable ?? null;
    this.status = status;
    this.type = options.type ?? null;
  }
}

export function createComposioConnectedAppsClient(input: {
  config: HostedConnectedAppsConfig;
  fetchImpl?: typeof fetch;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const provider = new Composio({
    apiKey: input.config.apiKey,
    baseURL: input.config.baseUrl,
    fetch: createBoundedComposioFetch(fetchImpl),
    logLevel: "off",
    maxRetries: 0,
    timeout: COMPOSIO_REQUEST_TIMEOUT_MS,
  });

  return {
    async createSession(userId: string): Promise<string> {
      const params: SessionCreateParams = {
        execute: { enable_multi_execute: false },
        manage_connections: { enable: false },
        multi_account: {
          enable: true,
          max_accounts_per_toolkit: input.config.maxAccountsPerToolkit,
          require_explicit_selection: true,
        },
        search: { enable: true },
        tags: {
          disable: ["destructiveHint"],
          enable: ["readOnlyHint"],
        },
        tools: buildComposioSessionTools(),
        toolkits: {
          enable: [
            ...input.config.toolkits,
            ...Object.keys(HOSTED_CONNECTED_APPS_SERVICE_TOOLS),
          ],
        },
        user_id: userId,
        workbench: { enable: false },
      };
      const payload = await requestComposio(() =>
        provider.toolRouter.session.create(params)
      );
      const sessionId = normalizeNonEmptyString(asRecord(payload)?.session_id);
      if (!sessionId) {
        throw new ComposioConnectedAppsRequestError(
          "Composio returned an invalid session response.",
        );
      }
      return sessionId;
    },

    async search(inputSearch: {
      query: string;
      sessionId: string;
      toolkits?: readonly string[];
    }): Promise<unknown> {
      const params: ComposioSessionSearchParams = {
        queries: [{ use_case: inputSearch.query }],
      };
      if (inputSearch.toolkits?.length) {
        params.toolkits = [...inputSearch.toolkits];
      }
      return await requestComposio(() =>
        provider.toolRouter.session.search(inputSearch.sessionId, params)
      );
    },

    async execute(inputExecute: {
      account?: string;
      arguments: Record<string, unknown>;
      sessionId: string;
      toolSlug: string;
    }): Promise<unknown> {
      const params: SessionExecuteParams = {
        arguments: inputExecute.arguments,
        tool_slug: inputExecute.toolSlug,
      };
      if (inputExecute.account) {
        params.account = inputExecute.account;
      }
      return await requestComposio(() =>
        provider.toolRouter.session.execute(inputExecute.sessionId, params)
      );
    },

    async executeDirect(inputExecute: {
      account?: string;
      arguments: Record<string, unknown>;
      customAuthParams?: {
        parameters: readonly {
          in: "header" | "query";
          name: string;
          value: string;
        }[];
      };
      toolSlug: string;
      userId: string;
      version: string;
    }): Promise<unknown> {
      const params: ComposioDirectExecuteParams = {
        arguments: inputExecute.arguments,
        user_id: inputExecute.userId,
        version: inputExecute.version,
      };
      if (inputExecute.account) {
        params.connected_account_id = inputExecute.account;
      }
      if (inputExecute.customAuthParams) {
        params.custom_auth_params = {
          parameters: inputExecute.customAuthParams.parameters.map((parameter) => ({
            in: parameter.in,
            name: parameter.name,
            value: parameter.value,
          })),
        };
      }
      const payload = await requestComposio(() =>
        provider.tools.execute(inputExecute.toolSlug, params)
      );
      return readSuccessfulDirectExecutePayload(payload);
    },

    async createLink(inputLink: {
      alias?: string;
      callbackUrl: string;
      sessionId: string;
      toolkit: string;
    }): Promise<{
      connectedAccountId: string;
      redirectUrl: string;
    }> {
      const params: SessionLinkParams = {
        callback_url: inputLink.callbackUrl,
        toolkit: inputLink.toolkit,
      };
      if (inputLink.alias) {
        params.alias = inputLink.alias;
      }
      const payload = await requestComposio(() =>
        provider.toolRouter.session.link(inputLink.sessionId, params)
      );
      const record = asRecord(payload);
      const connectedAccountId = normalizeNonEmptyString(
        record?.connected_account_id,
      );
      const redirectUrl = readHttpsUrl(record?.redirect_url);
      if (!connectedAccountId || !redirectUrl) {
        throw new ComposioConnectedAppsRequestError(
          "Composio returned an invalid connection-link response.",
        );
      }
      return { connectedAccountId, redirectUrl };
    },

    async listAccounts(inputList: {
      accountIds?: readonly string[];
      statuses?: readonly ComposioConnectedAccountStatus[] | null;
      toolkit?: string;
      toolkits?: readonly string[] | null;
      userId: string;
    }): Promise<ComposioConnectedAccount[]> {
      const accounts: ComposioConnectedAccount[] = [];
      let cursor: string | null = null;
      do {
        const params: Composio.ConnectedAccountListParams = {
          account_type: "PRIVATE",
          limit: 100,
          user_ids: [inputList.userId],
        };
        if (cursor) {
          params.cursor = cursor;
        }
        if (inputList.statuses !== null) {
          params.statuses = inputList.statuses
            ? [...inputList.statuses]
            : ["ACTIVE"];
        }
        if (inputList.accountIds?.length) {
          params.connected_account_ids = [...inputList.accountIds];
        }
        const toolkitSlugs = inputList.toolkit
          ? [inputList.toolkit]
          : inputList.toolkits === null
            ? []
            : inputList.toolkits ?? input.config.toolkits;
        if (toolkitSlugs.length > 0) {
          params.toolkit_slugs = [...toolkitSlugs];
        }

        const payload = await requestComposio(() =>
          provider.connectedAccounts.list(params)
        );
        const payloadRecord = asRecord(payload);
        const items = Array.isArray(payloadRecord?.items)
          ? payload.items
          : [];
        accounts.push(...items.flatMap(parseConnectedAccount));
        cursor = normalizeNonEmptyString(payloadRecord?.next_cursor);
      } while (cursor);

      return accounts;
    },

    async renameAccount(accountId: string, alias: string): Promise<void> {
      const params: Composio.ConnectedAccountPatchParams = { alias };
      await requestComposio(() =>
        provider.connectedAccounts.patch(accountId, params)
      );
    },

    async disconnectAccount(accountId: string): Promise<void> {
      await requestComposio(() =>
        provider.post(
          `/api/v3.1/connected_accounts/${encodeURIComponent(accountId)}/revoke`,
        )
      );
    },

    async deleteAccount(accountId: string): Promise<void> {
      const params: Composio.ConnectedAccountDeleteParams = {};
      await requestComposio(() =>
        provider.connectedAccounts.delete(accountId, params)
      );
    },
  };
}

function buildComposioSessionTools(): NonNullable<SessionCreateParams["tools"]> {
  return {
    composio_search: {
      enable: [...HOSTED_CONNECTED_APPS_SERVICE_TOOLS.composio_search.enable],
    },
    instacart: {
      enable: [...HOSTED_CONNECTED_APPS_SERVICE_TOOLS.instacart.enable],
    },
    openweather_api: {
      enable: [...HOSTED_CONNECTED_APPS_SERVICE_TOOLS.openweather_api.enable],
    },
  };
}

function readSuccessfulDirectExecutePayload(
  payload: Composio.ToolExecuteResponse,
): unknown {
  const record = asRecord(payload);
  if (record?.successful !== true) {
    throw new ComposioConnectedAppsRequestError(
      "Composio direct tool execution did not succeed.",
      null,
      {
        retryable: false,
        type: "composio_direct_execute_unsuccessful",
      },
    );
  }
  return Object.hasOwn(record, "data") ? record.data : {};
}

function parseConnectedAccount(
  item: Composio.ConnectedAccountListResponse["items"][number],
): ComposioConnectedAccount[] {
  const record = asRecord(item);
  const toolkit = asRecord(record?.toolkit);
  const id = normalizeNonEmptyString(record?.id);
  const toolkitSlug = normalizeNonEmptyString(toolkit?.slug);
  if (!id || !toolkitSlug) {
    return [];
  }
  return [{
    alias: normalizeNonEmptyString(record?.alias),
    id,
    isDisabled: record?.is_disabled === true,
    status: normalizeNonEmptyString(record?.status) ?? "UNKNOWN",
    toolkit: {
      // Older Composio responses included an undocumented display name. Keep
      // accepting it without claiming it as part of the provider-owned schema.
      name: readString(toolkit, "name") ?? toolkitSlug,
      slug: toolkitSlug,
    },
    wordId: normalizeNonEmptyString(record?.word_id),
  }];
}

async function requestComposio<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    const boundedFailure = findComposioRequestError(error);
    if (boundedFailure) {
      throw boundedFailure;
    }
    if (error instanceof APIError && typeof error.status === "number") {
      throw new ComposioConnectedAppsRequestError(
        withComposioProviderDiagnostic(
          `Composio request failed with status ${error.status}.`,
          error.error,
        ),
        error.status,
        { type: "composio_http_error" },
      );
    }
    throw new ComposioConnectedAppsRequestError(
      "Composio is temporarily unavailable.",
      null,
      {
        cause: error instanceof APIConnectionError && error.cause
          ? error.cause
          : error,
        type: "composio_transport_error",
      },
    );
  }
}

function createBoundedComposioFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (request, init) => {
    const response = await fetchImpl(
      preserveRepeatedComposioListQueryParams(request),
      init,
    );
    if (response.status === 204) {
      return response;
    }

    if (!response.ok) {
      const payload = await readBoundedJsonResponse(response, {
        limitBytes: COMPOSIO_ERROR_RESPONSE_LIMIT_BYTES,
        signal: AbortSignal.timeout(COMPOSIO_ERROR_RESPONSE_TIMEOUT_MS),
      }).catch(() => ({}));
      return rebuildComposioJsonResponse(response, payload);
    }

    try {
      const payload = await readBoundedJsonResponse(response);
      return rebuildComposioJsonResponse(response, payload);
    } catch (error) {
      if (error instanceof ComposioConnectedAppsRequestError) {
        throw error;
      }
      throw new ComposioConnectedAppsRequestError(
        "Composio returned an invalid JSON response.",
        response.status,
        {
          cause: error,
          type: "composio_invalid_json",
        },
      );
    }
  };
}

const COMPOSIO_REPEATED_LIST_QUERY_FIELDS = [
  "connected_account_ids",
  "statuses",
  "toolkit_slugs",
  "user_ids",
] as const;

// The generated client serializes arrays as comma-delimited values. Keep the
// already-deployed repeated-key shape for this endpoint so installing the SDK
// cannot alter account scoping or filtering at the provider boundary.
function preserveRepeatedComposioListQueryParams(
  request: RequestInfo | URL,
): RequestInfo | URL {
  const requestUrl = request instanceof Request ? request.url : String(request);
  const url = new URL(requestUrl);
  if (!url.pathname.endsWith("/api/v3.1/connected_accounts")) {
    return request;
  }

  let changed = false;
  for (const field of COMPOSIO_REPEATED_LIST_QUERY_FIELDS) {
    const values = url.searchParams.getAll(field);
    if (values.length !== 1 || !values[0]?.includes(",")) {
      continue;
    }
    url.searchParams.delete(field);
    for (const value of values[0].split(",")) {
      url.searchParams.append(field, value);
    }
    changed = true;
  }
  if (!changed) {
    return request;
  }
  if (request instanceof Request) {
    return new Request(url, request);
  }
  return request instanceof URL ? url : url.toString();
}

function rebuildComposioJsonResponse(
  response: Response,
  payload: unknown,
): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(payload), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function findComposioRequestError(
  error: unknown,
): ComposioConnectedAppsRequestError | null {
  let current = error;
  const visited = new Set<unknown>();
  while (current instanceof Error && !visited.has(current)) {
    if (current instanceof ComposioConnectedAppsRequestError) {
      return current;
    }
    visited.add(current);
    current = current.cause;
  }
  return null;
}

async function readBoundedJsonResponse(
  response: Response,
  options: {
    limitBytes?: number;
    signal?: AbortSignal;
  } = {},
): Promise<unknown> {
  const limitBytes = options.limitBytes ?? COMPOSIO_RESPONSE_LIMIT_BYTES;
  const contentLength = parseContentLength(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > limitBytes) {
    throw new ComposioConnectedAppsRequestError(
      "Composio response was too large.",
      response.status,
      { type: "composio_response_too_large" },
    );
  }

  const text = await readBoundedResponseText(response, {
    limitBytes,
    signal: options.signal,
  });
  return JSON.parse(text);
}

async function readBoundedResponseText(
  response: Response,
  options: {
    limitBytes: number;
    signal?: AbortSignal;
  },
): Promise<string> {
  if (options.signal?.aborted) {
    throw options.signal.reason;
  }
  const body = response.body;
  if (!body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > options.limitBytes) {
      throw new ComposioConnectedAppsRequestError(
        "Composio response was too large.",
        response.status,
        { type: "composio_response_too_large" },
      );
    }
    return text;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const abortRead = () => {
    void reader.cancel(options.signal?.reason).catch(() => undefined);
  };
  options.signal?.addEventListener("abort", abortRead, { once: true });
  if (options.signal?.aborted) {
    abortRead();
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (options.signal?.aborted) {
        throw options.signal.reason;
      }
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > options.limitBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ComposioConnectedAppsRequestError(
          "Composio response was too large.",
          response.status,
          { type: "composio_response_too_large" },
        );
      }
      chunks.push(value);
    }
  } finally {
    options.signal?.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function parseContentLength(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(
  record: Record<string, unknown> | null | undefined,
  field: string,
): string | null {
  const value = record?.[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function withComposioProviderDiagnostic(message: string, payload: unknown): string {
  const error = asRecord(asRecord(payload)?.error);
  const code = error?.code;
  const slug = error?.slug;
  const fields = [
    ...(typeof code === "number" && Number.isSafeInteger(code) && code >= 0
      ? [`code=${code}`]
      : []),
    ...(typeof slug === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(slug)
      ? [`slug=${slug}`]
      : []),
  ];
  return fields.length > 0
    ? `${message} Provider error: ${fields.join(", ")}.`
    : message;
}

function normalizeNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readHttpsUrl(value: unknown): string | null {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
