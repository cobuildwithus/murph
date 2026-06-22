import "server-only";

import type { HostedConnectedAppsConfig } from "./config";

const COMPOSIO_REQUEST_TIMEOUT_MS = 30_000;

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
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ComposioConnectedAppsRequestError";
    this.status = status;
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
          preload: { tools: [] },
          search: { enable: true },
          tags: {
            disable: ["destructiveHint"],
            enable: ["readOnlyHint"],
          },
          toolkits: { enable: [...input.config.toolkits] },
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
      account: string;
      arguments: Record<string, unknown>;
      sessionId: string;
      toolSlug: string;
    }): Promise<unknown> {
      return await requestJson({
        body: {
          account: inputExecute.account,
          arguments: inputExecute.arguments,
          tool_slug: inputExecute.toolSlug,
        },
        config: input.config,
        fetchImpl,
        method: "POST",
        path: `/api/v3.1/tool_router/session/${encodeURIComponent(inputExecute.sessionId)}/execute`,
      });
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
      toolkit?: string;
      userId: string;
    }): Promise<ComposioConnectedAccount[]> {
      const query = new URLSearchParams();
      query.set("account_type", "PRIVATE");
      query.set("limit", "100");
      appendQueryValues(query, "statuses", ["ACTIVE"]);
      appendQueryValues(query, "user_ids", [inputList.userId]);
      if (inputList.accountIds?.length) {
        appendQueryValues(query, "connected_account_ids", inputList.accountIds);
      }
      if (inputList.toolkit) {
        appendQueryValues(query, "toolkit_slugs", [inputList.toolkit]);
      } else {
        appendQueryValues(query, "toolkit_slugs", input.config.toolkits);
      }

      const payload = await requestJson({
        config: input.config,
        fetchImpl,
        method: "GET",
        path: `/api/v3.1/connected_accounts?${query.toString()}`,
      });
      const items = asArray(asRecord(payload)?.items);
      return items.flatMap((item) => {
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
      });
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
        method: "DELETE",
        path: `/api/v3.1/connected_accounts/${encodeURIComponent(accountId)}?revoke_on_delete=true`,
      });
    },
  };
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
  } catch {
    throw new ComposioConnectedAppsRequestError(
      "Composio is temporarily unavailable.",
    );
  }

  if (!response.ok) {
    throw new ComposioConnectedAppsRequestError(
      `Composio request failed with status ${response.status}.`,
      response.status,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new ComposioConnectedAppsRequestError(
      "Composio returned an invalid JSON response.",
      response.status,
    );
  }
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
