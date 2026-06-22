import { describe, expect, it, vi } from "vitest";

import {
  ComposioConnectedAppsRequestError,
  createComposioConnectedAppsClient,
} from "@/src/lib/connected-apps/composio";
import type { HostedConnectedAppsConfig } from "@/src/lib/connected-apps/config";

const config: HostedConnectedAppsConfig = {
  apiKey: "secret-test-key",
  baseUrl: "https://backend.composio.test",
  maxAccountsPerToolkit: 5,
  toolkits: ["gmail", "googlecalendar"],
};

describe("Composio connected-app client", () => {
  it("creates one durable read-only multi-account session", async () => {
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
        preload: { tools: [] },
        search: { enable: true },
        tags: {
          disable: ["destructiveHint"],
          enable: ["readOnlyHint"],
        },
        toolkits: { enable: ["gmail", "googlecalendar"] },
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
    ]);
  });

  it("supports multiple connected accounts and explicit provider revoke", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      if (init?.method === "POST") {
        expect(parsed.pathname).toBe("/api/v3.1/connected_accounts/ca_work/revoke");
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
  });

  it("never includes provider response bodies or API keys in errors", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      new Response(JSON.stringify({
        error: "provider payload with user@example.com",
        token: "provider-secret",
      }), { status: 500 })
    );
    const client = createComposioConnectedAppsClient({ config, fetchImpl });

    const error = await client.search({
      query: "mail",
      sessionId: "trs_session",
    }).catch((value) => value);

    expect(error).toBeInstanceOf(ComposioConnectedAppsRequestError);
    expect(String(error)).not.toContain("user@example.com");
    expect(String(error)).not.toContain("provider-secret");
    expect(String(error)).not.toContain("secret-test-key");
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}
