import { describe, expect, it, vi } from "vitest";

import {
  ComposioConnectedAppsRequestError,
  createComposioConnectedAppsClient,
} from "@/src/lib/connected-apps/composio";
import {
  formatHostedConnectedAppToolkitLabel,
  readHostedConnectedAppsConfig,
  type HostedConnectedAppsConfig,
} from "@/src/lib/connected-apps/config";

const config: HostedConnectedAppsConfig = {
  apiKey: "secret-test-key",
  baseUrl: "https://backend.composio.test",
  maxAccountsPerToolkit: 5,
  toolkits: ["gmail", "googlecalendar"],
};

describe("Composio connected-app client", () => {
  it("creates one durable constrained multi-account session", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(String(url)).toBe(
        "https://backend.composio.test/api/v3.1/tool_router/session",
      );
      expect(new Headers(init?.headers).get("x-api-key")).toBe("secret-test-key");
      expect(JSON.parse(String(init?.body))).toEqual({
        execute: { enable_multi_execute: false },
        manage_connections: { enable: false },
        multi_account: {
          enable: true,
          max_accounts_per_toolkit: 5,
          require_explicit_selection: true,
        },
        search: { enable: true },
        tags: {
          disable: ["destructiveHint"],
          enable: ["readOnlyHint"],
        },
        tools: {
          composio_search: {
            enable: [
              "COMPOSIO_SEARCH_AMAZON",
              "COMPOSIO_SEARCH_GOOGLE_MAPS",
              "COMPOSIO_SEARCH_NPPESNPI_LOOKUP",
              "COMPOSIO_SEARCH_WALMART",
            ],
          },
          instacart: {
            enable: [
              "INSTACART_CREATE_INSTACART_RECIPE_LINK",
              "INSTACART_CREATE_RECIPE_PAGE",
              "INSTACART_CREATE_SHOPPING_LIST_PAGE",
              "INSTACART_GET_NEARBY_RETAILERS",
            ],
            },
            openweather_api: {
              enable: [
                "OPENWEATHER_API_GET_AIR_POLLUTION_CURRENT",
                "OPENWEATHER_API_GET_CURRENT_WEATHER",
                "OPENWEATHER_API_GET5_DAY_FORECAST",
                "OPENWEATHER_API_GET_GEOCODING_DIRECT",
              ],
            },
        },
        toolkits: {
          enable: [
            "gmail",
            "googlecalendar",
            "composio_search",
            "instacart",
            "openweather_api",
          ],
        },
        user_id: "hbm_member",
        workbench: { enable: false },
      });
      return jsonResponse({ session_id: "trs_session" });
    });

    const client = createComposioConnectedAppsClient({ config, fetchImpl });
    await expect(client.createSession("hbm_member")).resolves.toBe("trs_session");
  });

  it("passes semantic search and exact account execution directly to the session", async () => {
    const requests: Array<{ body: unknown; url: string }> = [];
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      requests.push({
        body: JSON.parse(String(init?.body)),
        url: String(url),
      });
      if (String(url).endsWith("/api/v3.1/tools/execute/GOOGLECALENDAR_CREATE_EVENT")) {
        return jsonResponse({ data: { eventId: "evt_123" }, successful: true });
      }
      if (
        String(url).endsWith(
          "/api/v3.1/tools/execute/OPENWEATHER_API_GET_CURRENT_WEATHER",
        )
      ) {
        return jsonResponse({
          data: { weather: [{ description: "clear sky" }] },
          successful: true,
        });
      }
      return jsonResponse({ ok: true });
    });
    const client = createComposioConnectedAppsClient({ config, fetchImpl });

    await client.search({
      query: "find recent messages with PDF attachments",
      sessionId: "trs_session",
      toolkits: ["gmail"],
    });
    await client.execute({
      account: "work",
      arguments: { query: "has:attachment filename:pdf" },
      sessionId: "trs_session",
      toolSlug: "GMAIL_FETCH_EMAILS",
    });
    await client.execute({
      arguments: { query: "pharmacy" },
      sessionId: "trs_session",
      toolSlug: "COMPOSIO_SEARCH_GOOGLE_MAPS",
    });
    await client.executeDirect({
      account: "calendar",
      arguments: {
        event_duration_hour: 0,
        event_duration_minutes: 30,
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual physical",
        timezone: "America/New_York",
      },
      toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
      userId: "hbm_member",
      version: "20260429_00",
    });
    await client.executeDirect({
      arguments: { lat: 40.7128, lon: -74.006, units: "imperial" },
      customAuthParams: {
        parameters: [{
          in: "query",
          name: "appid",
          value: "openweather-test-key",
        }],
      },
      toolSlug: "OPENWEATHER_API_GET_CURRENT_WEATHER",
      userId: "hbm_member",
      version: "20260414_00",
    });

    expect(requests).toEqual([
      {
        body: {
          queries: [{ use_case: "find recent messages with PDF attachments" }],
          toolkits: ["gmail"],
        },
        url: "https://backend.composio.test/api/v3.1/tool_router/session/trs_session/search",
      },
      {
        body: {
          account: "work",
          arguments: { query: "has:attachment filename:pdf" },
          tool_slug: "GMAIL_FETCH_EMAILS",
        },
        url: "https://backend.composio.test/api/v3.1/tool_router/session/trs_session/execute",
      },
      {
        body: {
          arguments: { query: "pharmacy" },
          tool_slug: "COMPOSIO_SEARCH_GOOGLE_MAPS",
        },
        url: "https://backend.composio.test/api/v3.1/tool_router/session/trs_session/execute",
      },
      {
        body: {
          arguments: {
            event_duration_hour: 0,
            event_duration_minutes: 30,
            start_datetime: "2026-07-01T10:00:00-04:00",
            summary: "Annual physical",
            timezone: "America/New_York",
          },
          connected_account_id: "calendar",
          user_id: "hbm_member",
          version: "20260429_00",
        },
        url: "https://backend.composio.test/api/v3.1/tools/execute/GOOGLECALENDAR_CREATE_EVENT",
      },
      {
        body: {
          arguments: { lat: 40.7128, lon: -74.006, units: "imperial" },
          custom_auth_params: {
            parameters: [{
              in: "query",
              name: "appid",
              value: "openweather-test-key",
            }],
          },
          user_id: "hbm_member",
          version: "20260414_00",
        },
        url: "https://backend.composio.test/api/v3.1/tools/execute/OPENWEATHER_API_GET_CURRENT_WEATHER",
      },
    ]);
  });

  it("does not retain free-form provider text when direct execution is unsuccessful", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({
        data: null,
        error: "permission denied",
        successful: false,
      })
    );
    const client = createComposioConnectedAppsClient({ config, fetchImpl });

    const error = await client.executeDirect({
      account: "calendar",
      arguments: { summary: "Annual physical" },
      toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
      userId: "hbm_member",
      version: "20260429_00",
    }).catch((value) => value);

    expect(error).toBeInstanceOf(ComposioConnectedAppsRequestError);
    expect(error).toMatchObject({ retryable: false });
    expect(String(error)).toBe(
      "ComposioConnectedAppsRequestError: Composio direct tool execution did not succeed.",
    );
    expect(String(error)).not.toContain("permission denied");
    expect(String(error)).not.toContain("secret-test-key");
  });

  it("supports multiple connected accounts and explicit provider revoke/delete", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      if (init?.method === "POST") {
        expect(parsed.pathname).toBe("/api/v3.1/connected_accounts/ca_work/revoke");
        expect(parsed.search).toBe("");
        return new Response(null, { status: 204 });
      }
      if (init?.method === "DELETE") {
        expect(parsed.pathname).toBe("/api/v3.1/connected_accounts/ca_work");
        expect(parsed.search).toBe("");
        return jsonResponse({ success: true });
      }
      expect(parsed.searchParams.get("user_ids")).toBe("hbm_member");
      expect(parsed.searchParams.get("toolkit_slugs")).toBe("gmail");
      return jsonResponse({
        items: [
          {
            alias: "personal",
            id: "ca_personal",
            is_disabled: false,
            status: "ACTIVE",
            toolkit: { name: "Gmail", slug: "gmail" },
            word_id: "quiet-forest",
          },
          {
            alias: "work",
            id: "ca_work",
            is_disabled: false,
            status: "ACTIVE",
            toolkit: { name: "Gmail", slug: "gmail" },
            word_id: "bright-river",
          },
        ],
      });
    });
    const client = createComposioConnectedAppsClient({ config, fetchImpl });

    await expect(client.listAccounts({
      toolkit: "gmail",
      userId: "hbm_member",
    })).resolves.toHaveLength(2);
    await client.disconnectAccount("ca_work");
    await client.deleteAccount("ca_work");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("preserves repeated query parameters for multi-value account filters", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      expect(parsed.searchParams.getAll("connected_account_ids")).toEqual([
        "ca_personal",
        "ca_work",
      ]);
      expect(parsed.searchParams.getAll("statuses")).toEqual([
        "ACTIVE",
        "REVOKED",
      ]);
      expect(parsed.searchParams.getAll("toolkit_slugs")).toEqual([
        "gmail",
        "googlecalendar",
      ]);
      expect(parsed.searchParams.getAll("user_ids")).toEqual(["hbm_member"]);
      return jsonResponse({ items: [] });
    });
    const client = createComposioConnectedAppsClient({ config, fetchImpl });

    await expect(client.listAccounts({
      accountIds: ["ca_personal", "ca_work"],
      statuses: ["ACTIVE", "REVOKED"],
      userId: "hbm_member",
    })).resolves.toEqual([]);
  });

  it("paginates unfiltered owned account listing for deletion-time revocation", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(init?.method).toBe("GET");
      const parsed = new URL(String(url));
      expect(parsed.searchParams.getAll("statuses")).toEqual([]);
      expect(parsed.searchParams.getAll("toolkit_slugs")).toEqual([]);
      expect(parsed.searchParams.getAll("user_ids")).toEqual(["hbm_member"]);
      if (!parsed.searchParams.has("cursor")) {
        return jsonResponse({
          items: [
            {
              alias: "legacy calendar",
              id: "ca_calendar",
              is_disabled: false,
              status: "ACTIVE",
              toolkit: { name: "Google Calendar", slug: "googlecalendar" },
              word_id: "quiet-forest",
            },
          ],
          next_cursor: "page_2",
        });
      }
      expect(parsed.searchParams.get("cursor")).toBe("page_2");
      return jsonResponse({
        items: [
          {
            alias: "work",
            id: "ca_gmail",
            is_disabled: false,
            status: "ACTIVE",
            toolkit: { name: "Gmail", slug: "gmail" },
            word_id: "bright-river",
          },
        ],
      });
    });
    const client = createComposioConnectedAppsClient({ config, fetchImpl });

    await expect(client.listAccounts({
      statuses: null,
      toolkits: null,
      userId: "hbm_member",
    })).resolves.toMatchObject([
      { id: "ca_calendar", toolkit: { slug: "googlecalendar" } },
      { id: "ca_gmail", toolkit: { slug: "gmail" } },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps only structured provider diagnostics from failed HTTP responses", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      new Response(JSON.stringify({
        error: {
          code: 1703,
          message:
            "Provider rejected member@example.test with token=provider-secret.",
          slug: "PROVIDER_AUTH_FAILED",
        },
        token: "provider-secret",
      }), { status: 500 })
    );
    const client = createComposioConnectedAppsClient({ config, fetchImpl });

    const error = await client.search({
      query: "mail",
      sessionId: "trs_session",
    }).catch((value) => value);

    expect(error).toBeInstanceOf(ComposioConnectedAppsRequestError);
    expect(String(error)).toContain(
      "Provider error: code=1703, slug=PROVIDER_AUTH_FAILED.",
    );
    expect(String(error)).not.toContain("member@example.test");
    expect(String(error)).not.toContain("provider-secret");
    expect(String(error)).not.toContain("secret-test-key");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves HTTP status and type when provider error bodies are unusable", async () => {
    const buildResponses = [
      () => new Response("{ truncated", { status: 502 }),
      () => jsonResponse({ error: { message: "upstream unavailable" } }, 502),
      () => new Response("{}", {
        headers: { "content-length": String(5 * 1024 * 1024) },
        status: 502,
      }),
    ];

    for (const buildResponse of buildResponses) {
      const fetchImpl = vi.fn(async (): Promise<Response> => buildResponse());
      const client = createComposioConnectedAppsClient({ config, fetchImpl });

      const error = await client.search({
        query: "mail",
        sessionId: "trs_session",
      }).catch((value) => value);

      expect(error).toBeInstanceOf(ComposioConnectedAppsRequestError);
      expect(error).toMatchObject({
        status: 502,
        type: "composio_http_error",
      });
      expect(String(error)).toBe(
        "ComposioConnectedAppsRequestError: Composio request failed with status 502.",
      );
    }
  });

  it("does not wait past the diagnostic timeout for a streaming HTTP error", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      new Response(new ReadableStream<Uint8Array>({}), { status: 502 })
    );
    const client = createComposioConnectedAppsClient({ config, fetchImpl });
    const startedAt = Date.now();

    const error = await client.search({
      query: "mail",
      sessionId: "trs_session",
    }).catch((value) => value);

    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(error).toMatchObject({
      message: "Composio request failed with status 502.",
      status: 502,
      type: "composio_http_error",
    });
  });

  it("bounds provider response bodies before JSON parsing", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`{"data":"${"x".repeat(5 * 1024 * 1024)}"}`));
          controller.close();
        },
      }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    });
    const client = createComposioConnectedAppsClient({ config, fetchImpl });

    const error = await client.search({
      query: "mail",
      sessionId: "trs_session",
    }).catch((value) => value);

    expect(error).toBeInstanceOf(ComposioConnectedAppsRequestError);
    expect(error).toMatchObject({ status: 200 });
    expect(String(error)).toContain("too large");
    expect(String(error)).not.toContain("secret-test-key");
  });

  it("caps multi-account config to Composio's supported maximum", () => {
    expect(readHostedConnectedAppsConfig({
      COMPOSIO_API_KEY: "secret-test-key",
      COMPOSIO_MAX_ACCOUNTS_PER_TOOLKIT: "20",
    }).maxAccountsPerToolkit).toBe(10);
  });

  it("keeps built-in services out of the connectable toolkit list", () => {
    expect(readHostedConnectedAppsConfig({
      COMPOSIO_API_KEY: "secret-test-key",
      COMPOSIO_CONNECTED_APP_TOOLKITS:
        "gmail,composio_search,instacart,openweather_api",
    }).toolkits).toEqual(["gmail"]);
  });

  it("enables the supported connected apps by default with human labels", () => {
    const defaults = readHostedConnectedAppsConfig({
      COMPOSIO_API_KEY: "secret-test-key",
    });
    expect([...defaults.toolkits].sort()).toEqual([
      "dropbox",
      "gmail",
      "googlecalendar",
      "googledrive",
      "googletasks",
      "notion",
      "one_drive",
      "outlook",
      "todoist",
      "zoho_mail",
    ]);
    expect(defaults.toolkits).not.toContain("strava");
    expect(formatHostedConnectedAppToolkitLabel("googledrive")).toBe("Google Drive");
    expect(formatHostedConnectedAppToolkitLabel("one_drive")).toBe("Microsoft OneDrive");
    expect(formatHostedConnectedAppToolkitLabel("dropbox")).toBe("Dropbox");
    expect(formatHostedConnectedAppToolkitLabel("googletasks")).toBe("Google Tasks");
    expect(formatHostedConnectedAppToolkitLabel("todoist")).toBe("Todoist");
    expect(formatHostedConnectedAppToolkitLabel("notion")).toBe("Notion");
    expect(formatHostedConnectedAppToolkitLabel("outlook")).toBe("Microsoft Outlook");
    expect(formatHostedConnectedAppToolkitLabel("zoho_mail")).toBe("Zoho Mail");
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}
