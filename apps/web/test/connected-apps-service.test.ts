import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: prismaMocks.getPrisma,
}));

import {
  completeHostedConnectedAppConnection,
  executeHostedConnectedAppsRequest,
  startHostedConnectedAppConnection,
} from "@/src/lib/connected-apps/service";
import { isHostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

interface MemberRow {
  accountGroupMemberships?: Array<{
    group: { billingStatus: string; suspendedAt: Date | null };
    status: string;
  }>;
  billingStatus: "active" | "canceled" | "not_started";
  id: string;
  suspendedAt: Date | null;
}

interface IntentRow {
  alias: string | null;
  claimHash: string;
  completedAt: Date | null;
  connectedAccountId: string | null;
  expiresAt: Date;
  memberId: string;
  startedAt: Date | null;
  toolkit: string;
}

interface SessionRow {
  createdAt: Date;
  memberId: string;
  policyRevision: number;
  remoteSessionId: string;
  updatedAt: Date;
}

interface IntentWhere {
  claimHash?: string;
  completedAt?: null;
  connectedAccountId?: string;
  expiresAt?: {
    gt?: Date;
    lte?: Date;
  };
  memberId?: string;
  startedAt?: null | {
    not: null;
  };
}

interface IntentUpdateData {
  completedAt?: Date | null;
  connectedAccountId?: string | null;
  startedAt?: Date | null;
}

interface FakePrisma {
  $queryRaw: (...args: unknown[]) => Promise<unknown[]>;
  $transaction: <T>(
    callback: (tx: FakePrisma) => Promise<T> | T,
    options?: unknown,
  ) => Promise<T>;
  hostedConnectedAppConnectIntent: {
    create: (input: {
      data: {
        alias: string | null;
        claimHash: string;
        expiresAt: Date;
        memberId: string;
        toolkit: string;
      };
    }) => Promise<IntentRow>;
    deleteMany: (input: { where?: IntentWhere }) => Promise<{ count: number }>;
    findUnique: (input: { where: { claimHash: string } }) => Promise<IntentRow | null>;
    update: (input: {
      data: IntentUpdateData;
      where: { claimHash: string };
    }) => Promise<IntentRow>;
    updateMany: (input: {
      data: IntentUpdateData;
      where: IntentWhere;
    }) => Promise<{ count: number }>;
  };
  hostedConnectedAppsSession: {
    findUnique: (input: { where: { memberId: string } }) => Promise<SessionRow | null>;
    upsert: (input: {
      create: {
        memberId: string;
        policyRevision: number;
        remoteSessionId: string;
      };
      update: {
        policyRevision: number;
        remoteSessionId: string;
      };
      where: { memberId: string };
    }) => Promise<SessionRow>;
  };
  hostedMember: {
    findUnique: (input: {
      where: { id: string };
    }) => Promise<unknown>;
  };
}

class ConnectedAppsPrismaHarness {
  readonly intents = new Map<string, IntentRow>();
  readonly members = new Map<string, MemberRow>();
  readonly sessions = new Map<string, SessionRow>();
  readonly prisma: FakePrisma;

  constructor() {
    this.members.set("hbm_member", {
      billingStatus: "active",
      id: "hbm_member",
      suspendedAt: null,
    });
    this.members.set("hbm_other", {
      billingStatus: "active",
      id: "hbm_other",
      suspendedAt: null,
    });

    const prisma: FakePrisma = {
      $queryRaw: vi.fn(async () => []),
      $transaction: vi.fn(async (callback) => callback(prisma)),
      hostedConnectedAppConnectIntent: {
        create: vi.fn(async ({ data }) => {
          const row: IntentRow = {
            alias: data.alias,
            claimHash: data.claimHash,
            completedAt: null,
            connectedAccountId: null,
            expiresAt: data.expiresAt,
            memberId: data.memberId,
            startedAt: null,
            toolkit: data.toolkit,
          };
          this.intents.set(row.claimHash, row);
          return cloneIntent(row);
        }),
        deleteMany: vi.fn(async ({ where }) => {
          let count = 0;
          for (const [claimHash, row] of this.intents) {
            if (!matchesIntentWhere(row, where)) {
              continue;
            }
            this.intents.delete(claimHash);
            count += 1;
          }
          return { count };
        }),
        findUnique: vi.fn(async ({ where }) =>
          cloneNullableIntent(this.intents.get(where.claimHash) ?? null)
        ),
        update: vi.fn(async ({ data, where }) => {
          const row = this.intents.get(where.claimHash);
          if (!row) {
            throw new Error(`Missing test intent ${where.claimHash}`);
          }
          applyIntentUpdate(row, data);
          return cloneIntent(row);
        }),
        updateMany: vi.fn(async ({ data, where }) => {
          let count = 0;
          for (const row of this.intents.values()) {
            if (!matchesIntentWhere(row, where)) {
              continue;
            }
            applyIntentUpdate(row, data);
            count += 1;
          }
          return { count };
        }),
      },
      hostedConnectedAppsSession: {
        findUnique: vi.fn(async ({ where }) =>
          cloneNullableSession(this.sessions.get(where.memberId) ?? null)
        ),
        upsert: vi.fn(async ({ create, update, where }) => {
          const existing = this.sessions.get(where.memberId);
          const now = new Date();
          const row: SessionRow = existing
            ? {
                ...existing,
                policyRevision: update.policyRevision,
                remoteSessionId: update.remoteSessionId,
                updatedAt: now,
              }
            : {
                createdAt: now,
                memberId: create.memberId,
                policyRevision: create.policyRevision,
                remoteSessionId: create.remoteSessionId,
                updatedAt: now,
              };
          this.sessions.set(where.memberId, row);
          return cloneSession(row);
        }),
      },
      hostedMember: {
        findUnique: vi.fn(async ({ where }) => {
          const member = this.members.get(where.id);
          return member
            ? {
                accountGroupMemberships: member.accountGroupMemberships ?? [],
                billingStatus: member.billingStatus,
                suspendedAt: member.suspendedAt,
                threadContainer: null,
              }
            : null;
        }),
      },
    };
    this.prisma = prisma;
  }

  intentForClaim(claim: string): IntentRow | null {
    return this.intents.get(hashClaim(claim)) ?? null;
  }
}

describe("connected-app service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("COMPOSIO_API_KEY", "secret-test-key");
    vi.stubEnv("COMPOSIO_BASE_URL", "https://backend.composio.test");
    vi.stubEnv("COMPOSIO_CONNECTED_APP_TOOLKITS", "gmail,googlecalendar");
    vi.stubEnv("COMPOSIO_MAX_ACCOUNTS_PER_TOOLKIT", "5");
    vi.stubEnv("HOSTED_ONBOARDING_PUBLIC_BASE_URL", "https://hosted.example.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("binds connect intents to the member and keeps provider-link attempts visible", async () => {
    const harness = installPrismaHarness();
    const claim = await createConnectClaim("hbm_member");
    const wrongMemberFetch = vi.fn(async (): Promise<Response> =>
      jsonResponse({ unexpected: true })
    );

    await expect(startHostedConnectedAppConnection({
      claim,
      fetchImpl: wrongMemberFetch,
      memberId: "hbm_other",
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_INTENT_UNAVAILABLE",
      httpStatus: 410,
    });
    expect(wrongMemberFetch).not.toHaveBeenCalled();

    const failedSessionFetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe("/api/v3.1/tool_router/session");
      expect(init?.method).toBe("POST");
      return jsonResponse({ error: "session failed" }, 500);
    });
    await expect(startHostedConnectedAppConnection({
      claim,
      fetchImpl: failedSessionFetch,
      memberId: "hbm_member",
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_PROVIDER_UNAVAILABLE",
      httpStatus: 503,
    });
    expect(harness.intentForClaim(claim)).toMatchObject({
      connectedAccountId: null,
      memberId: "hbm_member",
      startedAt: null,
      toolkit: "gmail",
    });

    const failedLinkFetch = createStartFetch({
      claim,
      linkStatus: 500,
      remoteSessionId: "trs_member",
    });
    await expect(startHostedConnectedAppConnection({
      claim,
      fetchImpl: failedLinkFetch,
      memberId: "hbm_member",
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_PROVIDER_UNAVAILABLE",
      httpStatus: 503,
    });

    expect(failedLinkFetch).toHaveBeenCalledTimes(2);
    expect(harness.intentForClaim(claim)).toMatchObject({
      connectedAccountId: null,
      memberId: "hbm_member",
      startedAt: expect.any(Date),
      toolkit: "gmail",
    });
  });

  it("lets a family-sponsored member create and start connect intents", async () => {
    const harness = installPrismaHarness();
    harness.members.set("hbm_member", {
      accountGroupMemberships: [{
        group: { billingStatus: "active", suspendedAt: null },
        status: "active",
      }],
      billingStatus: "not_started",
      id: "hbm_member",
      suspendedAt: null,
    });

    const claim = await createConnectClaim("hbm_member");
    expect(claim).toBeTruthy();
    expect(harness.intents.size).toBe(1);
  });

  it("rejects connected-app writes after the hosted member is suspended", async () => {
    const harness = installPrismaHarness();
    harness.members.get("hbm_member")!.suspendedAt = new Date("2026-06-22T12:00:00.000Z");
    const fetchImpl = vi.fn(async (): Promise<Response> =>
      jsonResponse({ unexpected: true })
    );

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      request: {
        input: {
          action: "connect",
          alias: "work",
          toolkit: "gmail",
        },
        operation: "manage",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_MEMBER_INACTIVE",
      httpStatus: 403,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(harness.intents.size).toBe(0);
  });

  it("rejects claimed connection links after the hosted member is suspended", async () => {
    const harness = installPrismaHarness();
    const claim = await createConnectClaim("hbm_member");
    harness.members.get("hbm_member")!.suspendedAt = new Date("2026-06-22T12:00:00.000Z");
    const fetchImpl = createStartFetch({
      claim,
      connectedAccountId: "ca_work",
      remoteSessionId: "trs_member",
    });

    await expect(startHostedConnectedAppConnection({
      claim,
      fetchImpl,
      memberId: "hbm_member",
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_MEMBER_INACTIVE",
      httpStatus: 403,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(harness.intentForClaim(claim)?.startedAt).toBeNull();
  });

  it("verifies callback account id, member query, toolkit, and active status before completion", async () => {
    const harness = installPrismaHarness();
    const claim = await createConnectClaim("hbm_member");
    const startFetch = createStartFetch({
      claim,
      connectedAccountId: "ca_work",
      remoteSessionId: "trs_member",
    });

    await expect(startHostedConnectedAppConnection({
      claim,
      fetchImpl: startFetch,
      memberId: "hbm_member",
    })).resolves.toEqual({
      redirectUrl: "https://oauth.composio.test/connect",
    });

    const callsAfterStart = startFetch.mock.calls.length;
    await expect(completeHostedConnectedAppConnection({
      claim,
      connectedAccountId: "ca_other",
      fetchImpl: startFetch,
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_CALLBACK_INVALID",
      httpStatus: 410,
    });
    expect(startFetch).toHaveBeenCalledTimes(callsAfterStart);
    expect(harness.intentForClaim(claim)?.completedAt).toBeNull();

    const rejectedAccountFetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(init?.method).toBe("GET");
      expectVerificationQuery(url);
      return jsonResponse({
        items: [
          {
            id: "ca_work",
            is_disabled: false,
            status: "ACTIVE",
            toolkit: { name: "Calendar", slug: "googlecalendar" },
          },
          {
            id: "ca_work",
            is_disabled: false,
            status: "INITIALIZING",
            toolkit: { name: "Gmail", slug: "gmail" },
          },
          {
            id: "ca_work",
            is_disabled: true,
            status: "ACTIVE",
            toolkit: { name: "Gmail", slug: "gmail" },
          },
        ],
      });
    });
    await expect(completeHostedConnectedAppConnection({
      claim,
      connectedAccountId: "ca_work",
      fetchImpl: rejectedAccountFetch,
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_CALLBACK_ACCOUNT_MISMATCH",
      httpStatus: 403,
    });
    expect(harness.intentForClaim(claim)?.completedAt).toBeNull();

    const verifiedAccountFetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      expect(init?.method).toBe("GET");
      expectVerificationQuery(url);
      return jsonResponse({
        items: [
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
    const completed = await completeHostedConnectedAppConnection({
      claim,
      connectedAccountId: "ca_work",
      fetchImpl: verifiedAccountFetch,
    });

    expect(completed.account.id).toBe("ca_work");
    expect(completed.account.toolkit.slug).toBe("gmail");
    expect(completed.intent.completedAt).toBeInstanceOf(Date);
    expect(harness.intentForClaim(claim)?.completedAt).toBeInstanceOf(Date);

    const verifiedFetchCallsAfterCompletion = verifiedAccountFetch.mock.calls.length;
    await expect(completeHostedConnectedAppConnection({
      claim,
      connectedAccountId: "ca_work",
      fetchImpl: verifiedAccountFetch,
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_CALLBACK_INVALID",
      httpStatus: 410,
    });
    expect(verifiedAccountFetch).toHaveBeenCalledTimes(verifiedFetchCallsAfterCompletion);
  });

  it("rejects suspended-member callbacks and cleans up the exact provider account", async () => {
    const harness = installPrismaHarness();
    const claim = await createConnectClaim("hbm_member");
    const startFetch = createStartFetch({
      claim,
      connectedAccountId: "ca_work",
      remoteSessionId: "trs_member",
    });
    await startHostedConnectedAppConnection({
      claim,
      fetchImpl: startFetch,
      memberId: "hbm_member",
    });
    harness.members.get("hbm_member")!.suspendedAt = new Date("2026-06-22T12:00:00.000Z");

    const cleanupCalls: Array<{ method: string | undefined; pathname: string }> = [];
    const cleanupFetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      cleanupCalls.push({ method: init?.method, pathname: parsed.pathname });
      if (parsed.pathname === "/api/v3.1/connected_accounts") {
        expect(parsed.searchParams.getAll("connected_account_ids")).toEqual(["ca_work"]);
        expect(parsed.searchParams.getAll("statuses")).toEqual([]);
        expect(parsed.searchParams.getAll("toolkit_slugs")).toEqual(["gmail"]);
        expect(parsed.searchParams.getAll("user_ids")).toEqual(["hbm_member"]);
        return jsonResponse({
          items: [
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
      }
      if (parsed.pathname === "/api/v3.1/connected_accounts/ca_work/revoke") {
        expect(init?.method).toBe("POST");
        return jsonResponse({});
      }
      if (parsed.pathname === "/api/v3.1/connected_accounts/ca_work") {
        expect(init?.method).toBe("DELETE");
        return jsonResponse({});
      }
      throw new Error(`Unexpected Composio request ${String(url)}`);
    });

    await expect(completeHostedConnectedAppConnection({
      claim,
      connectedAccountId: "ca_work",
      fetchImpl: cleanupFetch,
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_MEMBER_INACTIVE",
      httpStatus: 403,
    });

    expect(cleanupCalls).toEqual([
      { method: "GET", pathname: "/api/v3.1/connected_accounts" },
      { method: "POST", pathname: "/api/v3.1/connected_accounts/ca_work/revoke" },
      { method: "DELETE", pathname: "/api/v3.1/connected_accounts/ca_work" },
    ]);
    expect(harness.intentForClaim(claim)?.completedAt).toBeNull();
  });

  it("resolves execution account selectors to one owned Composio account id before egress", async () => {
    installPrismaHarness();
    const executeFetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/tool_router/session") {
        expect(init?.method).toBe("POST");
        return jsonResponse({ session_id: "trs_member" });
      }
      if (parsed.pathname === "/api/v3.1/connected_accounts") {
        expect(init?.method).toBe("GET");
        expect(parsed.searchParams.getAll("user_ids")).toEqual(["hbm_member"]);
        expect(parsed.searchParams.getAll("toolkit_slugs")).toEqual([
          "gmail",
          "googlecalendar",
        ]);
        return jsonResponse({
          items: [
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
      }
      if (parsed.pathname === "/api/v3.1/tool_router/session/trs_member/execute") {
        expect(init?.method).toBe("POST");
        expect(readJsonBody(init)).toEqual({
          account: "ca_work",
          arguments: { query: "newer_than:7d" },
          tool_slug: "GMAIL_FETCH_EMAILS",
        });
        return jsonResponse({ data: [] });
      }
      throw new Error(`Unexpected Composio request ${String(url)}`);
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl: executeFetch,
      memberId: "hbm_member",
      request: {
        input: {
          account: "work",
          arguments: { query: "newer_than:7d" },
          toolSlug: "GMAIL_FETCH_EMAILS",
        },
        operation: "execute",
      },
    })).resolves.toEqual({ data: [] });
    expect(executeFetch).toHaveBeenCalledTimes(3);
  });

  it("executes only allowlisted built-in services without an account", async () => {
    installPrismaHarness();
    const executeFetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/tool_router/session") {
        expect(init?.method).toBe("POST");
        return jsonResponse({ session_id: "trs_member" });
      }
      if (parsed.pathname === "/api/v3.1/tool_router/session/trs_member/execute") {
        expect(init?.method).toBe("POST");
        expect(readJsonBody(init)).toEqual({
          arguments: { query: "pharmacy" },
          tool_slug: "COMPOSIO_SEARCH_GOOGLE_MAPS",
        });
        return jsonResponse({ places: [] });
      }
      if (parsed.pathname === "/api/v3.1/connected_accounts") {
        throw new Error("Built-in services should not resolve a connected account.");
      }
      throw new Error(`Unexpected Composio request ${String(url)}`);
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl: executeFetch,
      memberId: "hbm_member",
      request: {
        input: {
          arguments: { query: "pharmacy" },
          toolSlug: "COMPOSIO_SEARCH_GOOGLE_MAPS",
        },
        operation: "execute",
      },
    })).resolves.toEqual({ places: [] });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl: executeFetch,
      memberId: "hbm_member",
      request: {
        input: {
          arguments: {},
          toolSlug: "GMAIL_FETCH_EMAILS",
        },
        operation: "execute",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_ACCOUNT_REQUIRED",
      httpStatus: 400,
    });
    expect(executeFetch).toHaveBeenCalledTimes(2);
  });

  it("delivers a markup-heavy mailbox read that the raw wire ceiling used to discard", async () => {
    // The provider answers 200 with full HTML envelopes. Judging that payload
    // on wire size threw away a result that fits the assistant budget once the
    // markup is stripped, and the assistant reported it as an outage.
    installPrismaHarness();
    const envelope = `<!doctype html><html><head><style>${".pad{color:red}".repeat(400)}</style></head>`
      + `<body><table><tr><td><p>Voucher code: ABC-123</p>`
      + `<p><a href="https://air.example.com/redeem">Redeem</a></p></td></tr></table></body></html>`;
    const messages = Array.from({ length: 90 }, (_item, index) => ({
      messageId: `msg_${index}`,
      messageText: envelope,
      subject: `Travel credit ${index}`,
    }));
    expect(JSON.stringify({ messages }).length).toBeGreaterThan(512 * 1024);

    const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/tool_router/session") {
        return jsonResponse({ session_id: "trs_member" });
      }
      if (parsed.pathname === "/api/v3.1/tool_router/session/trs_member/search") {
        return jsonResponse({ messages });
      }
      throw new Error(`Unexpected Composio request ${String(url)}`);
    });

    const result = await executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      request: { input: { query: "travel credit" }, operation: "search" },
    }) as { messages: { messageText: string }[] };

    expect(result.messages).toHaveLength(messages.length);
    // The voucher code and its link survive; the markup that made the payload
    // exceed the wire ceiling does not.
    expect(result.messages[0]!.messageText).toContain("Voucher code: ABC-123");
    expect(result.messages[0]!.messageText).toContain("Redeem (https://air.example.com/redeem)");
    expect(result.messages[0]!.messageText).not.toMatch(/<\/?(html|body|table|style|p|a)\b/iu);
  });

  it("asks for a narrower request when a result stays oversized after compaction", async () => {
    installPrismaHarness();
    const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/tool_router/session") {
        return jsonResponse({ session_id: "trs_member" });
      }
      if (parsed.pathname === "/api/v3.1/tool_router/session/trs_member/search") {
        return jsonResponse({ note: "x".repeat(200_000) });
      }
      throw new Error(`Unexpected Composio request ${String(url)}`);
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      request: { input: { query: "everything" }, operation: "search" },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_RESULT_TOO_LARGE",
      httpStatus: 413,
    });
  });

  it("classifies a provider body too large to read as a narrowable request", async () => {
    // The provider answers 200 and the body is simply beyond what the tier can
    // buffer. Reporting that as an outage is what produced the false diagnosis.
    installPrismaHarness();
    const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/tool_router/session") {
        return jsonResponse({ session_id: "trs_member" });
      }
      if (parsed.pathname === "/api/v3.1/tool_router/session/trs_member/search") {
        return new Response(`{"data":"${"x".repeat(5 * 1024 * 1024)}"}`, {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      throw new Error(`Unexpected Composio request ${String(url)}`);
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      request: { input: { query: "everything" }, operation: "search" },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_RESULT_TOO_LARGE",
      httpStatus: 413,
    });
  });

  it("keeps a malformed provider body retryable", async () => {
    // Invalid JSON arrives on a 200 with nothing about the request to blame, so
    // the assistant must not be told that repeating the call cannot work.
    installPrismaHarness();
    const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/tool_router/session") {
        return jsonResponse({ session_id: "trs_member" });
      }
      if (parsed.pathname === "/api/v3.1/tool_router/session/trs_member/search") {
        return new Response("{ truncated", {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      throw new Error(`Unexpected Composio request ${String(url)}`);
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      request: { input: { query: "travel credit" }, operation: "search" },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_PROVIDER_UNAVAILABLE",
      httpStatus: 503,
      retryable: true,
    });
  });

  it("executes OpenWeather through Composio with the server-held API key", async () => {
    vi.stubEnv("OPENWEATHER_API_KEY", "openweather-test-key");
    installPrismaHarness();
    const executeFetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe(
        "/api/v3.1/tools/execute/OPENWEATHER_API_GET_CURRENT_WEATHER",
      );
      expect(init?.method).toBe("POST");
      expect(readJsonBody(init)).toEqual({
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
      });
      return jsonResponse({
        data: { weather: [{ description: "clear sky" }] },
        successful: true,
      });
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl: executeFetch,
      memberId: "hbm_member",
      request: {
        input: {
          arguments: { lat: 40.7128, lon: -74.006, units: "imperial" },
          toolSlug: "OPENWEATHER_API_GET_CURRENT_WEATHER",
        },
        operation: "execute",
      },
    })).resolves.toEqual({ weather: [{ description: "clear sky" }] });

    expect(executeFetch).toHaveBeenCalledTimes(1);
  });

  it("reads official OpenWeather alerts through the fixed server-owned route", async () => {
    vi.stubEnv("OPENWEATHER_API_KEY", "openweather-test-key");
    installPrismaHarness();
    const executeFetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      expect(parsed.origin).toBe("https://api.openweathermap.org");
      expect(parsed.pathname).toBe("/data/3.0/onecall");
      expect(parsed.searchParams.get("lat")).toBe("52.2297");
      expect(parsed.searchParams.get("lon")).toBe("21.0122");
      expect(parsed.searchParams.get("exclude")).toBe(
        "current,minutely,hourly,daily",
      );
      expect(parsed.searchParams.get("appid")).toBe("openweather-test-key");
      expect(init?.method).toBe("GET");
      return jsonResponse({
        alerts: [{
          description: "Extreme heat warning.",
          end: 1_786_032_000,
          event: "Extreme heat",
          sender_name: "National weather service",
          start: 1_785_945_600,
          tags: ["Extreme temperature"],
        }],
      });
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl: executeFetch,
      memberId: "hbm_member",
      request: {
        input: {
          arguments: { lat: 52.2297, lon: 21.0122 },
          toolSlug: "MURPH_OPENWEATHER_GET_NATIONAL_ALERTS",
        },
        operation: "execute",
      },
    })).resolves.toEqual({
      alerts: [{
        description: "Extreme heat warning.",
        end: 1_786_032_000,
        event: "Extreme heat",
        senderName: "National weather service",
        start: 1_785_945_600,
        tags: ["Extreme temperature"],
      }],
    });
    expect(executeFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a maximum-shape official-alert projection within the assistant budget", async () => {
    vi.stubEnv("OPENWEATHER_API_KEY", "openweather-test-key");
    installPrismaHarness();
    const alerts = Array.from({ length: 16 }, (_, index) => ({
      description: `${index}:${"x".repeat(7_998)}`,
      end: 1_786_032_000 + index,
      event: `Alert ${index} ${"e".repeat(230)}`,
      sender_name: `Agency ${index} ${"s".repeat(228)}`,
      start: 1_785_945_600 + index,
      tags: Array.from({ length: 16 }, (__, tagIndex) =>
        `Tag ${tagIndex} ${"t".repeat(112)}`
      ),
    }));
    const executeFetch = vi.fn(async (): Promise<Response> =>
      jsonResponse({ alerts })
    );

    const result = await executeHostedConnectedAppsRequest({
      fetchImpl: executeFetch,
      memberId: "hbm_member",
      request: {
        input: {
          arguments: { lat: 52.2297, lon: 21.0122 },
          toolSlug: "MURPH_OPENWEATHER_GET_NATIONAL_ALERTS",
        },
        operation: "execute",
      },
    });

    expect(result).toMatchObject({ alerts: expect.any(Array) });
    if (
      typeof result !== "object"
      || result === null
      || !("alerts" in result)
      || !Array.isArray(result.alerts)
    ) {
      throw new Error("Expected a bounded official-alert result.");
    }
    expect(result.alerts.length).toBeGreaterThan(0);
    expect(result.alerts.length).toBeLessThan(16);
    expect(executeFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid official-alert coordinates before provider execution", async () => {
    vi.stubEnv("OPENWEATHER_API_KEY", "openweather-test-key");
    installPrismaHarness();
    const executeFetch = vi.fn(async (): Promise<Response> => {
      throw new Error("Invalid coordinates must fail before execution.");
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl: executeFetch,
      memberId: "hbm_member",
      request: {
        input: {
          arguments: { lat: 91, lon: 21.0122 },
          toolSlug: "MURPH_OPENWEATHER_GET_NATIONAL_ALERTS",
        },
        operation: "execute",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_REQUEST_INVALID",
      httpStatus: 400,
      retryable: false,
    });
    expect(executeFetch).not.toHaveBeenCalled();
  });

  it("fails closed before OpenWeather execution when the API key is missing", async () => {
    vi.stubEnv("OPENWEATHER_API_KEY", "");
    installPrismaHarness();
    const executeFetch = vi.fn(async (): Promise<Response> => {
      throw new Error("Missing weather credentials must fail before execution.");
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl: executeFetch,
      memberId: "hbm_member",
      request: {
        input: {
          arguments: { lat: 40.7128, lon: -74.006 },
          toolSlug: "OPENWEATHER_API_GET_CURRENT_WEATHER",
        },
        operation: "execute",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_CONFIGURATION_UNAVAILABLE",
      httpStatus: 503,
    });

    expect(executeFetch).not.toHaveBeenCalled();
  });

  it("requires agent approval and safe arguments for calendar creation", async () => {
    installPrismaHarness();
    const executeFetch = vi.fn(async (): Promise<Response> => {
      throw new Error("Calendar writes should be rejected before contacting Composio.");
    });
    const request = {
      fetchImpl: executeFetch,
      memberId: "hbm_member",
      request: {
        input: {
          account: "calendar",
          arguments: {
            event_duration_hour: 0,
            event_duration_minutes: 30,
            start_datetime: "2026-07-01T10:00:00-04:00",
            summary: "Annual physical",
            timezone: "America/New_York",
          },
          toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
        },
        operation: "execute" as const,
      },
    };

    await expect(executeHostedConnectedAppsRequest(request)).rejects.toMatchObject({
      code: "CONNECTED_APPS_AGENT_APPROVAL_REQUIRED",
      httpStatus: 400,
    });
    await expect(executeHostedConnectedAppsRequest({
      ...request,
      request: {
        ...request.request,
        input: {
          ...request.request.input,
          arguments: {
            ...request.request.input.arguments,
            attendees: ["provider@example.com"],
          },
          agentApproved: true as const,
        },
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_WRITE_ARGUMENT_NOT_ALLOWED",
      httpStatus: 400,
    });
    expect(executeFetch).not.toHaveBeenCalled();
  });

  it.each([
    {
      argumentsValue: {
        event_duration_hour: 0,
        event_duration_minutes: 30,
        location: "123 Main St",
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual physical",
        timezone: "America/New_York",
      },
      expectedArguments: {
        calendar_id: "primary",
        create_meeting_room: false,
        event_duration_hour: 0,
        event_duration_minutes: 30,
        location: "123 Main St",
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual physical",
        timezone: "America/New_York",
      },
      toolkit: "googlecalendar",
      toolkitName: "Google Calendar",
      toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
      version: "20260429_00",
    },
    {
      argumentsValue: {
        body: "Discuss annual physical results.",
        end_datetime: "2026-07-01T10:30:00-04:00",
        location: "123 Main St",
        start_datetime: "2026-07-01T10:00:00-04:00",
        subject: "Annual physical",
        time_zone: "Eastern Standard Time",
      },
      expectedArguments: {
        body: "Discuss annual physical results.",
        end_datetime: "2026-07-01T10:30:00-04:00",
        is_online_meeting: false,
        location: "123 Main St",
        start_datetime: "2026-07-01T10:00:00-04:00",
        subject: "Annual physical",
        time_zone: "Eastern Standard Time",
      },
      toolkit: "outlook",
      toolkitName: "Microsoft Outlook",
      toolSlug: "OUTLOOK_CALENDAR_CREATE_EVENT",
      version: "20260508_00",
    },
  ] as const)("executes confirmed $toolSlug through the direct tool endpoint", async ({
    argumentsValue,
    expectedArguments,
    toolkit,
    toolkitName,
    toolSlug,
    version,
  }) => {
    vi.stubEnv(
      "COMPOSIO_CONNECTED_APP_TOOLKITS",
      "gmail,googlecalendar,outlook",
    );
    installPrismaHarness();
    const requests: Array<{ body: unknown; url: URL }> = [];
    const executeFetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      requests.push({
        body: init?.body ? readJsonBody(init) : null,
        url: parsed,
      });
      if (parsed.pathname === "/api/v3.1/connected_accounts") {
        return jsonResponse({
          items: [
            {
              alias: "calendar",
              id: "ca_calendar",
              is_disabled: false,
              status: "ACTIVE",
              toolkit: { name: toolkitName, slug: toolkit },
              word_id: "quiet-calendar",
            },
          ],
        });
      }
      if (parsed.pathname === `/api/v3.1/tools/execute/${toolSlug}`) {
        return jsonResponse({
          data: { eventId: "evt_123" },
          successful: true,
        });
      }
      if (parsed.pathname.startsWith("/api/v3.1/tool_router/session")) {
        throw new Error("Calendar creation should not use the read-only Tool Router session.");
      }
      throw new Error(`Unexpected Composio request ${String(url)}`);
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl: executeFetch,
      memberId: "hbm_member",
      request: {
        input: {
          account: "calendar",
          arguments: argumentsValue,
          agentApproved: true as const,
          toolSlug,
        },
        operation: "execute",
      },
    })).resolves.toEqual({ eventId: "evt_123" });
    expect(executeFetch).toHaveBeenCalledTimes(2);
    expect(requests.map((request) => ({
      body: request.body,
      pathname: request.url.pathname,
      toolkitSlugs: request.url.searchParams.getAll("toolkit_slugs"),
      userIds: request.url.searchParams.getAll("user_ids"),
    }))).toEqual([
      {
        body: null,
        pathname: "/api/v3.1/connected_accounts",
        toolkitSlugs: [toolkit],
        userIds: ["hbm_member"],
      },
      {
        body: {
          arguments: expectedArguments,
          connected_account_id: "ca_calendar",
          user_id: "hbm_member",
          version,
        },
        pathname: `/api/v3.1/tools/execute/${toolSlug}`,
        toolkitSlugs: [],
        userIds: [],
      },
    ]);
  });

  it("does not mark failed or ambiguous direct calendar creation retryable", async () => {
    installPrismaHarness();
    const buildRequest = () => ({
      memberId: "hbm_member",
      request: {
        input: {
          account: "calendar",
          agentApproved: true as const,
          arguments: {
            event_duration_hour: 0,
            event_duration_minutes: 30,
            start_datetime: "2026-07-01T10:00:00-04:00",
            summary: "Annual physical",
            timezone: "America/New_York",
          },
          toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
        },
        operation: "execute" as const,
      },
    });
    const expectCalendarCreateFailure = async (
      directResponse: "http-502" | "throw" | "unsuccessful",
      expectedDetails: Record<string, unknown>,
      expectedCauseMessage: string,
      expectedRootCauseMessage: string | null = null,
    ) => {
      const error = await executeHostedConnectedAppsRequest({
        ...buildRequest(),
        fetchImpl: buildFetch(directResponse),
      }).catch((value: unknown) => value);
      if (!isHostedOnboardingError(error)) {
        throw new Error("Expected hosted onboarding error.");
      }

      expect(error).toMatchObject({
        code: "CONNECTED_APPS_PROVIDER_UNAVAILABLE",
        details: expectedDetails,
        httpStatus: 400,
        retryable: false,
      });
      expect(error.cause).toBeInstanceOf(Error);
      if (!(error.cause instanceof Error)) {
        throw new Error("Expected hosted error cause.");
      }
      expect(error.cause.message).toContain(
        "ambiguous result",
      );
      expect(error.cause.cause).toBeInstanceOf(Error);
      if (!(error.cause.cause instanceof Error)) {
        throw new Error("Expected original Composio cause.");
      }
      expect(error.cause.cause.message).toContain(expectedCauseMessage);
      if (expectedRootCauseMessage !== null) {
        expect(error.cause.cause.cause).toBeInstanceOf(Error);
        if (!(error.cause.cause.cause instanceof Error)) {
          throw new Error("Expected root transport cause.");
        }
        expect(error.cause.cause.cause.message).toContain(expectedRootCauseMessage);
      }
    };
    const buildFetch = (directResponse: "http-502" | "throw" | "unsuccessful") =>
      vi.fn(async (
        url: string | URL | Request,
      ): Promise<Response> => {
        const parsed = new URL(String(url));
        if (parsed.pathname === "/api/v3.1/connected_accounts") {
          return jsonResponse({
            items: [
              {
                alias: "calendar",
                id: "ca_calendar",
                is_disabled: false,
                status: "ACTIVE",
                toolkit: { name: "Google Calendar", slug: "googlecalendar" },
                word_id: "quiet-calendar",
              },
            ],
          });
        }
        if (parsed.pathname === "/api/v3.1/tools/execute/GOOGLECALENDAR_CREATE_EVENT") {
          if (directResponse === "http-502") {
            return jsonResponse({
              error: {
                code: 2502,
                message: "upstream unavailable",
                slug: "UPSTREAM_UNAVAILABLE",
              },
            }, 502);
          }
          if (directResponse === "throw") {
            throw new Error("socket closed after provider accepted request");
          }
          return jsonResponse({
            data: null,
            error: "permission denied",
            successful: false,
          });
        }
        throw new Error(`Unexpected Composio request ${String(url)}`);
      });

    await expectCalendarCreateFailure(
      "unsuccessful",
      {
        operationName: "GOOGLECALENDAR_CREATE_EVENT",
        type: "composio_direct_execute_unsuccessful",
      },
      "direct tool execution did not succeed",
    );
    await expectCalendarCreateFailure(
      "throw",
      {
        operationName: "GOOGLECALENDAR_CREATE_EVENT",
        type: "composio_transport_error",
      },
      "temporarily unavailable",
      "socket closed after provider accepted request",
    );
    await expectCalendarCreateFailure(
      "http-502",
      {
        operationName: "GOOGLECALENDAR_CREATE_EVENT",
        statusCode: 502,
        type: "composio_http_error",
      },
      "failed with status 502. Provider error: code=2502, slug=UPSTREAM_UNAVAILABLE",
    );
  });

  it("keeps removed-toolkit grants manageable without making them executable", async () => {
    vi.stubEnv("COMPOSIO_CONNECTED_APP_TOOLKITS", "googlecalendar");
    installPrismaHarness();
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/connected_accounts") {
        expect(init?.method).toBe("GET");
        expect(parsed.searchParams.getAll("user_ids")).toEqual(["hbm_member"]);
        expect(parsed.searchParams.getAll("toolkit_slugs")).toEqual([]);
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
      }
      if (parsed.pathname === "/api/v3.1/connected_accounts/ca_gmail/revoke") {
        expect(init?.method).toBe("POST");
        return jsonResponse({});
      }
      throw new Error(`Unexpected Composio request ${String(url)}`);
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      request: {
        input: { action: "list" },
        operation: "manage",
      },
    })).resolves.toMatchObject({
      accounts: [
        {
          id: "ca_gmail",
          toolkit: "gmail",
          toolkitConfigured: false,
        },
      ],
      toolkits: [
        {
          slug: "googlecalendar",
        },
      ],
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      request: {
        input: {
          account: "ca_gmail",
          action: "disconnect",
        },
        operation: "manage",
      },
    })).resolves.toMatchObject({
      account: {
        id: "ca_gmail",
        toolkit: "gmail",
        toolkitConfigured: false,
      },
      status: "disconnected",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not execute against removed-toolkit grants", async () => {
    vi.stubEnv("COMPOSIO_CONNECTED_APP_TOOLKITS", "googlecalendar");
    installPrismaHarness();
    const fetchImpl = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/tool_router/session") {
        expect(init?.method).toBe("POST");
        const body = readJsonBody(init);
        expect(body).toMatchObject({
          toolkits: {
            enable: [
              "googlecalendar",
              "composio_search",
              "instacart",
              "openweather_api",
            ],
          },
        });
        return jsonResponse({ session_id: "trs_member" });
      }
      if (parsed.pathname === "/api/v3.1/connected_accounts") {
        expect(init?.method).toBe("GET");
        expect(parsed.searchParams.getAll("toolkit_slugs")).toEqual(["googlecalendar"]);
        return jsonResponse({ items: [] });
      }
      if (parsed.pathname.includes("/execute")) {
        throw new Error("Removed-toolkit account should not be executable.");
      }
      throw new Error(`Unexpected Composio request ${String(url)}`);
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl,
      memberId: "hbm_member",
      request: {
        input: {
          account: "ca_gmail",
          arguments: {},
          toolSlug: "GMAIL_FETCH_EMAILS",
        },
        operation: "execute",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_ACCOUNT_NOT_FOUND",
      httpStatus: 404,
    });
  });

  it("recreates stored Tool Router sessions when session-defining config changes", async () => {
    const harness = installPrismaHarness();
    const createdSessions: string[] = [];
    const searchFetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/tool_router/session") {
        const body = readJsonBody(init);
        const sessionId = `trs_${createdSessions.length + 1}`;
        createdSessions.push(sessionId);
        return jsonResponse({ session_id: sessionId, toolkits: body.toolkits });
      }
      if (parsed.pathname.endsWith("/search")) {
        return jsonResponse({ tools: [] });
      }
      throw new Error(`Unexpected Composio request ${String(url)}`);
    });

    vi.stubEnv("COMPOSIO_CONNECTED_APP_TOOLKITS", "gmail");
    await executeHostedConnectedAppsRequest({
      fetchImpl: searchFetch,
      memberId: "hbm_member",
      request: {
        input: {
          query: "find mail",
          toolkits: ["gmail"],
        },
        operation: "search",
      },
    });
    const firstRevision = harness.sessions.get("hbm_member")?.policyRevision;

    vi.stubEnv("COMPOSIO_CONNECTED_APP_TOOLKITS", "gmail,googlecalendar");
    await executeHostedConnectedAppsRequest({
      fetchImpl: searchFetch,
      memberId: "hbm_member",
      request: {
        input: {
          query: "find calendar events",
          toolkits: ["googlecalendar"],
        },
        operation: "search",
      },
    });

    expect(createdSessions).toEqual(["trs_1", "trs_2"]);
    expect(harness.sessions.get("hbm_member")).toMatchObject({
      remoteSessionId: "trs_2",
    });
    expect(harness.sessions.get("hbm_member")?.policyRevision).not.toBe(firstRevision);
  });

  it("rejects ambiguous execution account selectors before execution egress", async () => {
    installPrismaHarness();
    const executeFetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/tool_router/session") {
        return jsonResponse({ session_id: "trs_member" });
      }
      if (parsed.pathname === "/api/v3.1/connected_accounts") {
        return jsonResponse({
          items: [
            {
              alias: "work",
              id: "ca_work",
              is_disabled: false,
              status: "ACTIVE",
              toolkit: { name: "Gmail", slug: "gmail" },
              word_id: "bright-river",
            },
            {
              alias: "work",
              id: "ca_personal",
              is_disabled: false,
              status: "ACTIVE",
              toolkit: { name: "Gmail", slug: "gmail" },
              word_id: "quiet-forest",
            },
          ],
        });
      }
      if (parsed.pathname.includes("/execute")) {
        throw new Error("Execute should not be called for ambiguous accounts.");
      }
      throw new Error(`Unexpected Composio request ${String(url)} ${init?.method}`);
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl: executeFetch,
      memberId: "hbm_member",
      request: {
        input: {
          account: "work",
          arguments: {},
          toolSlug: "GMAIL_FETCH_EMAILS",
        },
        operation: "execute",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_ACCOUNT_AMBIGUOUS",
      httpStatus: 409,
    });
  });

  it("rejects stale execution account selectors before execution egress", async () => {
    installPrismaHarness();
    const executeFetch = vi.fn(async (
      url: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const parsed = new URL(String(url));
      if (parsed.pathname === "/api/v3.1/tool_router/session") {
        return jsonResponse({ session_id: "trs_member" });
      }
      if (parsed.pathname === "/api/v3.1/connected_accounts") {
        return jsonResponse({
          items: [
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
      }
      if (parsed.pathname.includes("/execute")) {
        throw new Error("Execute should not be called for stale accounts.");
      }
      throw new Error(`Unexpected Composio request ${String(url)} ${init?.method}`);
    });

    await expect(executeHostedConnectedAppsRequest({
      fetchImpl: executeFetch,
      memberId: "hbm_member",
      request: {
        input: {
          account: "ca_missing",
          arguments: {},
          toolSlug: "GMAIL_FETCH_EMAILS",
        },
        operation: "execute",
      },
    })).rejects.toMatchObject({
      code: "CONNECTED_APPS_ACCOUNT_NOT_FOUND",
      httpStatus: 404,
    });
  });
});

function installPrismaHarness(): ConnectedAppsPrismaHarness {
  const harness = new ConnectedAppsPrismaHarness();
  prismaMocks.getPrisma.mockReturnValue(harness.prisma);
  return harness;
}

async function createConnectClaim(memberId: string): Promise<string> {
  const fetchImpl = vi.fn(async (): Promise<Response> => {
    throw new Error("Creating a local connect intent should not call Composio.");
  });
  const result = await executeHostedConnectedAppsRequest({
    fetchImpl,
    memberId,
    request: {
      input: {
        action: "connect",
        alias: "work",
        toolkit: "gmail",
      },
      operation: "manage",
    },
  });

  expect(fetchImpl).not.toHaveBeenCalled();
  return extractClaim(readStringProperty(result, "connectUrl"));
}

function createStartFetch(input: {
  claim: string;
  connectedAccountId?: string;
  linkStatus?: number;
  remoteSessionId: string;
}): ReturnType<typeof vi.fn<(
  url: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>>> {
  return vi.fn(async (
    url: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/api/v3.1/tool_router/session") {
      expect(init?.method).toBe("POST");
      return jsonResponse({ session_id: input.remoteSessionId });
    }
    if (
      parsed.pathname
      === `/api/v3.1/tool_router/session/${input.remoteSessionId}/link`
    ) {
      expect(init?.method).toBe("POST");
      const body = readJsonBody(init);
      expect(readStringProperty(body, "alias")).toBe("work");
      expect(readStringProperty(body, "toolkit")).toBe("gmail");
      const callbackUrl = new URL(readStringProperty(body, "callback_url"));
      expect(callbackUrl.origin).toBe("https://hosted.example.test");
      expect(callbackUrl.pathname).toBe("/integrations/connect/complete");
      expect(callbackUrl.searchParams.get("claim")).toBe(input.claim);

      return jsonResponse(
        input.linkStatus && input.linkStatus >= 400
          ? { error: "provider failed" }
          : {
              connected_account_id: input.connectedAccountId ?? "ca_work",
              redirect_url: "https://oauth.composio.test/connect",
            },
        input.linkStatus ?? 200,
      );
    }
    throw new Error(`Unexpected Composio request ${String(url)}`);
  });
}

function expectVerificationQuery(url: string | URL | Request): void {
  const parsed = new URL(String(url));
  expect(parsed.origin).toBe("https://backend.composio.test");
  expect(parsed.pathname).toBe("/api/v3.1/connected_accounts");
  expect(parsed.searchParams.get("account_type")).toBe("PRIVATE");
  expect(parsed.searchParams.get("limit")).toBe("100");
  expect(parsed.searchParams.getAll("connected_account_ids")).toEqual(["ca_work"]);
  expect(parsed.searchParams.getAll("statuses")).toEqual(["ACTIVE"]);
  expect(parsed.searchParams.getAll("toolkit_slugs")).toEqual(["gmail"]);
  expect(parsed.searchParams.getAll("user_ids")).toEqual(["hbm_member"]);
}

function matchesIntentWhere(row: IntentRow, where?: IntentWhere): boolean {
  if (!where) {
    return true;
  }
  if (where.claimHash !== undefined && row.claimHash !== where.claimHash) {
    return false;
  }
  if (where.memberId !== undefined && row.memberId !== where.memberId) {
    return false;
  }
  if (
    where.connectedAccountId !== undefined
    && row.connectedAccountId !== where.connectedAccountId
  ) {
    return false;
  }
  if ("completedAt" in where && row.completedAt !== where.completedAt) {
    return false;
  }
  if ("startedAt" in where) {
    if (where.startedAt === null && row.startedAt !== null) {
      return false;
    }
    if (where.startedAt && "not" in where.startedAt && row.startedAt === where.startedAt.not) {
      return false;
    }
  }
  if (where.expiresAt?.gt && row.expiresAt <= where.expiresAt.gt) {
    return false;
  }
  if (where.expiresAt?.lte && row.expiresAt > where.expiresAt.lte) {
    return false;
  }
  return true;
}

function applyIntentUpdate(row: IntentRow, data: IntentUpdateData): void {
  if ("completedAt" in data) {
    row.completedAt = data.completedAt ?? null;
  }
  if ("connectedAccountId" in data) {
    row.connectedAccountId = data.connectedAccountId ?? null;
  }
  if ("startedAt" in data) {
    row.startedAt = data.startedAt ?? null;
  }
}

function extractClaim(connectUrl: string): string {
  const claim = new URL(connectUrl).pathname.split("/").filter(Boolean).pop();
  if (!claim) {
    throw new Error(`Connect URL did not contain a claim: ${connectUrl}`);
  }
  return decodeURIComponent(claim);
}

function hashClaim(claim: string): string {
  return createHash("sha256").update(claim).digest("hex");
}

function readJsonBody(init?: RequestInit): Record<string, unknown> {
  const record = asRecord(JSON.parse(String(init?.body)));
  if (!record) {
    throw new Error("Expected a JSON object request body.");
  }
  return record;
}

function readStringProperty(value: unknown, property: string): string {
  const propertyValue = asRecord(value)?.[property];
  if (typeof propertyValue !== "string") {
    throw new Error(`Expected string property ${property}.`);
  }
  return propertyValue;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cloneNullableIntent(row: IntentRow | null): IntentRow | null {
  return row ? cloneIntent(row) : null;
}

function cloneIntent(row: IntentRow): IntentRow {
  return { ...row };
}

function cloneNullableSession(row: SessionRow | null): SessionRow | null {
  return row ? cloneSession(row) : null;
}

function cloneSession(row: SessionRow): SessionRow {
  return { ...row };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}
