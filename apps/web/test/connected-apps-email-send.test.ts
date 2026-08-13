import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getHostedConnectedAppsWritePolicy } from "@/src/lib/connected-apps/config";
import { executeHostedConnectedAppsRequest } from "@/src/lib/connected-apps/service";
import { HostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

describe("connected-app email sends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("COMPOSIO_API_KEY", "secret-test-key");
    vi.stubEnv("COMPOSIO_BASE_URL", "https://backend.composio.test");
    vi.stubEnv(
      "COMPOSIO_CONNECTED_APP_TOOLKITS",
      "gmail,googlecalendar,outlook",
    );
    vi.stubEnv("COMPOSIO_MAX_ACCOUNTS_PER_TOOLKIT", "5");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends Gmail through the exact approved direct route", async () => {
    const fetchImpl = createSuccessfulEmailFetch({
      expectedArguments: {
        body: "Please help with my account.",
        recipient_email: "support@example.com",
        subject: "Account help",
        user_id: "me",
      },
      toolkit: "gmail",
      toolSlug: "GMAIL_SEND_EMAIL",
      version: "20260721_00",
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      prisma: {} as never,
      request: {
        input: {
          account: "work",
          agentApproved: true,
          arguments: {
            body: "Please help with my account.",
            recipient_email: "support@example.com",
            subject: "Account help",
          },
          toolSlug: "GMAIL_SEND_EMAIL",
        },
        operation: "execute",
      },
    })).resolves.toEqual({ messageId: "msg_123" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("sends Outlook mail while forcing a sent-item copy", async () => {
    const fetchImpl = createSuccessfulEmailFetch({
      expectedArguments: {
        body: "Please help with my account.",
        save_to_sent_items: true,
        subject: "Account help",
        to_email: "support@example.com",
        user_id: "me",
      },
      toolkit: "outlook",
      toolSlug: "OUTLOOK_SEND_EMAIL",
      version: "20260724_00",
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      prisma: {} as never,
      request: {
        input: {
          account: "work",
          agentApproved: true,
          arguments: {
            body: "Please help with my account.",
            subject: "Account help",
            to_email: "support@example.com",
          },
          toolSlug: "OUTLOOK_SEND_EMAIL",
        },
        operation: "execute",
      },
    })).resolves.toEqual({ messageId: "msg_123" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("requires explicit agent approval before sending", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({ unexpected: true })
    );

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      prisma: {} as never,
      request: {
        input: {
          account: "work",
          arguments: {
            body: "Please help with my account.",
            recipient_email: "support@example.com",
            subject: "Account help",
          },
          toolSlug: "GMAIL_SEND_EMAIL",
        },
        operation: "execute",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_AGENT_APPROVAL_REQUIRED",
      message: "Approve the email before sending it.",
      retryable: false,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects attachments outside the approved email contract", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({ unexpected: true })
    );

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      prisma: {} as never,
      request: {
        input: {
          account: "work",
          agentApproved: true,
          arguments: {
            attachment: {
              mimetype: "text/plain",
              name: "notes.txt",
              s3key: "unapproved",
            },
            body: "Please help with my account.",
            recipient_email: "support@example.com",
            subject: "Account help",
          },
          toolSlug: "GMAIL_SEND_EMAIL",
        },
        operation: "execute",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_WRITE_ARGUMENT_NOT_ALLOWED",
      message: "That email action includes unsupported options.",
      retryable: false,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    {
      argumentsValue: {
        body: "Please help with my account.",
        recipient_email: "support@example.com",
        subject: "Account help",
        user_id: "another-sender@example.com",
      },
      toolSlug: "GMAIL_SEND_EMAIL" as const,
    },
    {
      argumentsValue: {
        body: "Please help with my account.",
        save_to_sent_items: false,
        subject: "Account help",
        to_email: "support@example.com",
      },
      toolSlug: "OUTLOOK_SEND_EMAIL" as const,
    },
  ])("rejects model-supplied server-owned fields for $toolSlug", async ({
    argumentsValue,
    toolSlug,
  }) => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({ unexpected: true })
    );

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      prisma: {} as never,
      request: {
        input: {
          account: "work",
          agentApproved: true,
          arguments: argumentsValue,
          toolSlug,
        },
        operation: "execute",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_WRITE_ARGUMENT_NOT_ALLOWED",
      message: "That email action includes unsupported options.",
      retryable: false,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    {
      argumentsValue: {
        body: "Please help with my account.",
        recipient_email: "support@example.com",
      },
      toolSlug: "GMAIL_SEND_EMAIL" as const,
    },
    {
      argumentsValue: {
        body: "Please help with my account.",
        subject: "Account help",
      },
      toolSlug: "GMAIL_SEND_EMAIL" as const,
    },
    {
      argumentsValue: {
        body: "Please help with my account.",
        to_email: "support@example.com",
      },
      toolSlug: "OUTLOOK_SEND_EMAIL" as const,
    },
    {
      argumentsValue: {
        body: "Please help with my account.",
        recipient_email: "support@example.com",
        subject: "   ",
      },
      toolSlug: "GMAIL_SEND_EMAIL" as const,
    },
    {
      argumentsValue: {
        body: "\t",
        subject: "Account help",
        to_email: "support@example.com",
      },
      toolSlug: "OUTLOOK_SEND_EMAIL" as const,
    },
  ])("rejects incomplete $toolSlug calls before provider egress", async ({
    argumentsValue,
    toolSlug,
  }) => {
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({ unexpected: true })
    );

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      prisma: {} as never,
      request: {
        input: {
          account: "work",
          agentApproved: true,
          arguments: argumentsValue,
          toolSlug,
        },
        operation: "execute",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_WRITE_ARGUMENT_REQUIRED",
      message: "That email action is missing required fields.",
      retryable: false,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not treat inherited object keys as approved write routes", () => {
    expect(getHostedConnectedAppsWritePolicy("constructor")).toBeNull();
    expect(getHostedConnectedAppsWritePolicy("toString")).toBeNull();
  });

  it("rejects a disabled account before email dispatch", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/connected_accounts") {
        return jsonResponse({
          items: [{
            alias: "work",
            id: "ca_disabled",
            is_disabled: true,
            status: "ACTIVE",
            toolkit: { name: "Gmail", slug: "gmail" },
            word_id: "disabled-mail",
          }],
          next_cursor: null,
        });
      }
      throw new Error(`Email dispatch must not run after ${parsed.pathname}`);
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      prisma: {} as never,
      request: {
        input: {
          account: "work",
          agentApproved: true,
          arguments: {
            body: "Please help with my account.",
            recipient_email: "support@example.com",
            subject: "Account help",
          },
          toolSlug: "GMAIL_SEND_EMAIL",
        },
        operation: "execute",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_ACCOUNT_NOT_FOUND",
      retryable: false,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps account lookup failures before email dispatch", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/connected_accounts") {
        return jsonResponse({ error: "temporarily unavailable" }, 503);
      }
      throw new Error(`Email dispatch must not run after ${parsed.pathname}`);
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      prisma: {} as never,
      request: {
        input: {
          account: "work",
          agentApproved: true,
          arguments: {
            body: "Please help with my account.",
            recipient_email: "support@example.com",
            subject: "Account help",
          },
          toolSlug: "GMAIL_SEND_EMAIL",
        },
        operation: "execute",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_WRITE_PREFLIGHT_UNAVAILABLE",
      message: "Connected account verification is temporarily unavailable.",
      retryable: true,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("makes an ambiguous provider outcome non-retryable", async () => {
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/connected_accounts") {
        return connectedAccountResponse("gmail");
      }
      if (parsed.pathname === "/api/v3.1/tools/execute/GMAIL_SEND_EMAIL") {
        return jsonResponse({
          error: {
            code: 1703,
            message:
              "Gmail rejected member@example.test with token=provider-secret.",
            slug: "PROVIDER_AUTH_FAILED",
          },
          token: "provider-secret",
        }, 400);
      }
      throw new Error(`Unexpected Composio request: ${parsed.pathname}`);
    });

    const error = await executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      prisma: {} as never,
      request: {
        input: {
          account: "work",
          agentApproved: true,
          arguments: {
            body: "Please help with my account.",
            recipient_email: "support@example.com",
            subject: "Account help",
          },
          toolSlug: "GMAIL_SEND_EMAIL",
        },
        operation: "execute",
      },
    }).catch((value) => value);

    expect(error).toBeInstanceOf(HostedOnboardingError);
    if (!(error instanceof HostedOnboardingError)) {
      throw error;
    }
    expect(error).toMatchObject({
      code: "CONNECTED_APPS_PROVIDER_UNAVAILABLE",
      cause: {
        message:
          "Composio email sending returned an ambiguous result. Composio request failed with status 400. Provider error: code=1703, slug=PROVIDER_AUTH_FAILED.",
      },
      details: {
        operationName: "GMAIL_SEND_EMAIL",
        statusCode: 400,
        type: "composio_http_error",
      },
      retryable: false,
    });
    expect(error.details).not.toHaveProperty("providerErrorMessage");
    if (!(error.cause instanceof Error)) {
      throw new Error("Expected connected-app error cause.");
    }
    expect(error.cause.message).not.toContain("member@example.test");
    expect(error.cause.message).not.toContain("provider-secret");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

function createSuccessfulEmailFetch(input: {
  expectedArguments: Record<string, unknown>;
  toolkit: "gmail" | "outlook";
  toolSlug: "GMAIL_SEND_EMAIL" | "OUTLOOK_SEND_EMAIL";
  version: string;
}) {
  return vi.fn(async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/api/v3.1/connected_accounts") {
      expect(init?.method).toBe("GET");
      expect(parsed.searchParams.getAll("user_ids")).toEqual(["hbm_member"]);
      expect(parsed.searchParams.getAll("toolkit_slugs")).toEqual([
        input.toolkit,
      ]);
      return connectedAccountResponse(input.toolkit);
    }
    if (parsed.pathname === `/api/v3.1/tools/execute/${input.toolSlug}`) {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        arguments: input.expectedArguments,
        connected_account_id: "ca_email",
        user_id: "hbm_member",
        version: input.version,
      });
      return jsonResponse({
        data: { messageId: "msg_123" },
        successful: true,
      });
    }
    throw new Error(`Unexpected Composio request: ${parsed.pathname}`);
  });
}

function connectedAccountResponse(toolkit: "gmail" | "outlook"): Response {
  const otherToolkit = toolkit === "gmail" ? "outlook" : "gmail";
  return jsonResponse({
    items: [
      {
        alias: "work",
        id: "ca_other",
        is_disabled: false,
        status: "ACTIVE",
        toolkit: {
          name: otherToolkit === "gmail" ? "Gmail" : "Microsoft Outlook",
          slug: otherToolkit,
        },
        word_id: "other-mail",
      },
      {
        alias: "work",
        id: "ca_email",
        is_disabled: false,
        status: "ACTIVE",
        toolkit: {
          name: toolkit === "gmail" ? "Gmail" : "Microsoft Outlook",
          slug: toolkit,
        },
        word_id: "steady-mail",
      },
    ],
    next_cursor: null,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}
