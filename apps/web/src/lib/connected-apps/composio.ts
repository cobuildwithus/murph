import "server-only";

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

  return {
    async createSession(userId: string): Promise<string> {
      const payload = await requestJson({
        body: {
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
          tools: HOSTED_CONNECTED_APPS_SERVICE_TOOLS,
          toolkits: {
            enable: [
              ...input.config.toolkits,
              ...Object.keys(HOSTED_CONNECTED_APPS_SERVICE_TOOLS),
            ],
          },
          user_id: userId,
          workbench: { enable: false },
        },
        config: input.config,
        fetchImpl,
        method: "POST",
        path: "/api/v3.1/tool_router/session",
      });
      const sessionId = readString(asRecord(payload), "session_id");
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
      return await requestJson({
        body: {
          queries: [{ use_case: inputSearch.query }],
          ...(inputSearch.toolkits?.length
            ? { toolkits: [...inputSearch.toolkits] }
            : {}),
        },
        config: input.config,
        fetchImpl,
        method: "POST",
        path: `/api/v3.1/tool_router/session/${encodeURIComponent(inputSearch.sessionId)}/search`,
      });
    },

    async execute(inputExecute: {
      account?: string;
      arguments: Record<string, unknown>;
      sessionId: string;
      toolSlug: string;
    }): Promise<unknown> {
      return await requestJson({
        body: {
          ...(inputExecute.account ? { account: inputExecute.account } : {}),
          arguments: inputExecute.arguments,
          tool_slug: inputExecute.toolSlug,
        },
        config: input.config,
        fetchImpl,
        method: "POST",
        path: `/api/v3.1/tool_router/session/${encodeURIComponent(inputExecute.sessionId)}/execute`,
      });
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
      userId?: string;
      version: string;
    }): Promise<unknown> {
      const payload = await requestJson({
        body: {
          arguments: inputExecute.arguments,
          ...(inputExecute.account
            ? { connected_account_id: inputExecute.account }
            : {}),
          ...(inputExecute.customAuthParams
            ? { custom_auth_params: inputExecute.customAuthParams }
            : {}),
          ...(inputExecute.userId ? { user_id: inputExecute.userId } : {}),
          version: inputExecute.version,
        },
        config: input.config,
        fetchImpl,
        method: "POST",
        path: `/api/v3.1/tools/execute/${encodeURIComponent(inputExecute.toolSlug)}`,
      });
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
      const payload = await requestJson({
        body: {
          ...(inputLink.alias ? { alias: inputLink.alias } : {}),
          callback_url: inputLink.callbackUrl,
          toolkit: inputLink.toolkit,
        },
        config: input.config,
        fetchImpl,
        method: "POST",
        path: `/api/v3.1/tool_router/session/${encodeURIComponent(inputLink.sessionId)}/link`,
      });
      const record = asRecord(payload);
      const connectedAccountId = readString(record, "connected_account_id");
      const redirectUrl = readHttpsUrl(record, "redirect_url");
      if (!connectedAccountId || !redirectUrl) {
        throw new ComposioConnectedAppsRequestError(
          "Composio returned an invalid connection-link response.",
        );
      }
      return { connectedAccountId, redirectUrl };
    },

    async listAccounts(inputList: {
      accountIds?: readonly string[];
      statuses?: readonly string[] | null;
      toolkit?: string;
      toolkits?: readonly string[] | null;
      userId: string;
    }): Promise<ComposioConnectedAccount[]> {
      const accounts: ComposioConnectedAccount[] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams();
        query.set("account_type", "PRIVATE");
        query.set("limit", "100");
        if (cursor) {
          query.set("cursor", cursor);
        }
        if (inputList.statuses !== null) {
          appendQueryValues(query, "statuses", inputList.statuses ?? ["ACTIVE"]);
        }
        appendQueryValues(query, "user_ids", [inputList.userId]);
        if (inputList.accountIds?.length) {
          appendQueryValues(query, "connected_account_ids", inputList.accountIds);
        }
        const toolkitSlugs = inputList.toolkit
          ? [inputList.toolkit]
          : inputList.toolkits === null
            ? []
            : inputList.toolkits ?? input.config.toolkits;
        appendQueryValues(query, "toolkit_slugs", toolkitSlugs);

        const payload = await requestJson({
          config: input.config,
          fetchImpl,
          method: "GET",
          path: `/api/v3.1/connected_accounts?${query.toString()}`,
        });
        const record = asRecord(payload);
        const items = asArray(record?.items);
        accounts.push(...items.flatMap(parseConnectedAccount));
        cursor = readNullableString(record, "next_cursor");
      } while (cursor);

      return accounts;
    },

    async renameAccount(accountId: string, alias: string): Promise<void> {
      await requestJson({
        body: { alias },
        config: input.config,
        fetchImpl,
        method: "PATCH",
        path: `/api/v3.1/connected_accounts/${encodeURIComponent(accountId)}`,
      });
    },

    async disconnectAccount(accountId: string): Promise<void> {
      await requestJson({
        config: input.config,
        fetchImpl,
        method: "POST",
        path: `/api/v3.1/connected_accounts/${encodeURIComponent(accountId)}/revoke`,
      });
    },

    async deleteAccount(accountId: string): Promise<void> {
      await requestJson({
        config: input.config,
        fetchImpl,
        method: "DELETE",
        path: `/api/v3.1/connected_accounts/${encodeURIComponent(accountId)}`,
      });
    },
  };
}

function readSuccessfulDirectExecutePayload(payload: unknown): unknown {
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

function parseConnectedAccount(item: unknown): ComposioConnectedAccount[] {
  const record = asRecord(item);
  const toolkit = asRecord(record?.toolkit);
  const id = readString(record, "id");
  const toolkitSlug = readString(toolkit, "slug");
  if (!id || !toolkitSlug) {
    return [];
  }
  return [{
    alias: readNullableString(record, "alias"),
    id,
    isDisabled: record?.is_disabled === true,
    status: readString(record, "status") ?? "UNKNOWN",
    toolkit: {
      name: readString(toolkit, "name") ?? toolkitSlug,
      slug: toolkitSlug,
    },
    wordId: readNullableString(record, "word_id"),
  }];
}

async function requestJson(input: {
  body?: unknown;
  config: HostedConnectedAppsConfig;
  fetchImpl: typeof fetch;
  method: "DELETE" | "GET" | "PATCH" | "POST";
  path: string;
  signal?: AbortSignal | null;
}): Promise<unknown> {
  const timeoutSignal = AbortSignal.timeout(COMPOSIO_REQUEST_TIMEOUT_MS);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await input.fetchImpl(`${input.config.baseUrl}${input.path}`, {
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      headers: {
        accept: "application/json",
        ...(input.body === undefined ? {} : { "content-type": "application/json" }),
        "x-api-key": input.config.apiKey,
      },
      method: input.method,
      signal,
    });
  } catch (error) {
    throw new ComposioConnectedAppsRequestError(
      "Composio is temporarily unavailable.",
      null,
      {
        cause: error,
        type: "composio_transport_error",
      },
    );
  }

  if (!response.ok) {
    const payload = await readBoundedJsonResponse(response, {
      limitBytes: COMPOSIO_ERROR_RESPONSE_LIMIT_BYTES,
      signal: AbortSignal.timeout(COMPOSIO_ERROR_RESPONSE_TIMEOUT_MS),
    }).catch(() => null);
    throw new ComposioConnectedAppsRequestError(
      withComposioProviderDiagnostic(
        `Composio request failed with status ${response.status}.`,
        payload,
      ),
      response.status,
      { type: "composio_http_error" },
    );
  }

  try {
    return await readBoundedJsonResponse(response);
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

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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

function readNullableString(
  record: Record<string, unknown> | null | undefined,
  field: string,
): string | null {
  const value = record?.[field];
  return typeof value === "string" && value.trim() ? value : null;
}

function readHttpsUrl(
  record: Record<string, unknown> | null,
  field: string,
): string | null {
  const value = readString(record, field);
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function appendQueryValues(
  query: URLSearchParams,
  field: string,
  values: readonly string[],
): void {
  for (const value of values) {
    query.append(field, value);
  }
}
