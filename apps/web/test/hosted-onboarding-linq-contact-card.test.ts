import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

const linqLineStoreMocks = vi.hoisted(() => ({
  listHostedLinqContactCardLines: vi.fn(),
  readHostedLinqContactCardCandidacySnapshot: vi.fn(),
}));

const linqInventoryMocks = vi.hoisted(() => ({
  syncHostedLinqPhoneNumberInventory: vi.fn(),
}));

const runtimeMocks = vi.hoisted(() => ({
  getHostedOnboardingEnvironment: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  getHostedOnboardingEnvironment: runtimeMocks.getHostedOnboardingEnvironment,
  requireHostedOnboardingLinqConfig: () => ({
    apiBaseUrl: "https://linq.example.test/api/partner/v3",
    apiToken: "linq-token",
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  listHostedLinqContactCardLines: linqLineStoreMocks.listHostedLinqContactCardLines,
  readHostedLinqContactCardCandidacySnapshot:
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot,
}));

vi.mock("@/src/lib/hosted-onboarding/linq-phone-number-inventory", () => ({
  HOSTED_LINQ_PHONE_NUMBER_INVENTORY_SYNC_LIMIT: 250,
  syncHostedLinqPhoneNumberInventory: linqInventoryMocks.syncHostedLinqPhoneNumberInventory,
}));

import {
  isHostedLinqAttachmentSendPrepareFailure,
  sendHostedLinqAttachmentMessage,
} from "@/src/lib/hosted-onboarding/linq-client";
import {
  buildMurphHostedLinqContactCardVcf,
  fetchMurphHostedLinqContactCardVcfPhoto,
  resolveMurphHostedLinqContactCardBackupPhoneNumber,
  getHostedLinqContactCard,
  listHostedLinqContactCards,
  reconcileHostedLinqContactCards,
  setupHostedLinqContactCard,
  updateHostedLinqContactCard,
} from "@/src/lib/hosted-onboarding/linq-contact-card";

const originalFetch = globalThis.fetch;

afterEach(() => {
  runtimeMocks.getHostedOnboardingEnvironment.mockReset();
  linqInventoryMocks.syncHostedLinqPhoneNumberInventory.mockReset();
  linqLineStoreMocks.listHostedLinqContactCardLines.mockReset();
  linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockReset();

  if (originalFetch) {
    vi.stubGlobal("fetch", originalFetch);
    return;
  }

  Reflect.deleteProperty(globalThis, "fetch");
});

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
    },
    status,
  });
}

function readJsonRequestBody(init: RequestInit | undefined): unknown {
  if (typeof init?.body !== "string") {
    throw new Error("Expected JSON request body.");
  }

  return JSON.parse(init.body);
}

describe("hosted Linq contact card client", () => {
  it("ships the Murph contact-card headshot as a public PNG asset", () => {
    const bytes = readFileSync(new URL("../public/murph_headshot.png", import.meta.url));

    expect(bytes.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });

  it("lists contact cards", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createJsonResponse({
      contact_cards: [
        {
          first_name: "Murph",
          image_url: null,
          is_active: true,
          last_name: null,
          phone_number: "+15550000001",
        },
        {
          first_name: "Murph",
          is_active: true,
          last_name: null,
          phone_number: "+15550000002",
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listHostedLinqContactCards()).resolves.toEqual([
      {
        firstName: "Murph",
        imageUrl: null,
        imageUrlPresent: true,
        isActive: true,
        lastName: null,
        phoneNumber: "+15550000001",
      },
      {
        firstName: "Murph",
        imageUrl: null,
        imageUrlPresent: false,
        isActive: true,
        lastName: null,
        phoneNumber: "+15550000002",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("contact_card", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("gets one contact card by phone number", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createJsonResponse({
      contact_cards: [
        {
          first_name: "Murph",
          image_url: null,
          is_active: true,
          last_name: null,
          phone_number: "+15550000001",
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getHostedLinqContactCard({
      phoneNumber: "+15550000001",
    })).resolves.toMatchObject({
      firstName: "Murph",
      phoneNumber: "+15550000001",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("contact_card?phone_number=%2B15550000001", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("sets up a contact card", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createJsonResponse({
      first_name: "Murph",
      image_url: null,
      is_active: true,
      last_name: null,
      phone_number: "+15550000001",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(setupHostedLinqContactCard({
      phoneNumber: "+15550000001",
    })).resolves.toMatchObject({
      firstName: "Murph",
      isActive: true,
      phoneNumber: "+15550000001",
    });

    const [, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    expect(readJsonRequestBody(init)).toEqual({
      first_name: "Murph",
      phone_number: "+15550000001",
    });
  });

  it("updates a contact card", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createJsonResponse({
      first_name: "Murph",
      image_url: null,
      is_active: true,
      last_name: null,
      phone_number: "+15550000001",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await updateHostedLinqContactCard({
      firstName: "Murph",
      phoneNumber: "+15550000001",
    });

    const [url, init] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit | undefined];
    expect(url).toEqual(
      new URL("contact_card?phone_number=%2B15550000001", "https://linq.example.test/api/partner/v3/"),
    );
    expect(readJsonRequestBody(init)).toEqual({
      first_name: "Murph",
    });
  });

  it("reconciles DB-backed line contact cards from the owned-line projection", async () => {
    linqInventoryMocks.syncHostedLinqPhoneNumberInventory.mockResolvedValue({
      syncedCount: 2,
    });
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 2,
      lines: [
      {
        isConfigured: true,
        phoneNumber: "+15550000001",
        phoneNumberHint: "*** 0001",
        phoneNumberLookupKey: "lookup:1",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      {
        isConfigured: true,
        phoneNumber: "+15550000002",
        phoneNumberHint: "*** 0002",
        phoneNumberLookupKey: "lookup:2",
        providerReputationStatus: "AT_RISK",
        providerServiceStatus: "ACTIVE",
      },
      ],
    });
    const prisma = { hostedLinqLine: { count: vi.fn().mockResolvedValue(1) } };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.pathname.endsWith("/contact_card") && url.search === "" && init?.method === "GET") {
        throw new Error("Reconciliation should not scan provider contact cards.");
      }

      if (url.pathname.endsWith("/contact_card")
        && url.searchParams.get("phone_number") === "+15550000001"
        && init?.method === "GET") {
        return createJsonResponse({
          contact_cards: [
            {
              first_name: "Murph",
              image_url: null,
              is_active: true,
              phone_number: "+15550000001",
            },
          ],
        });
      }

      if (url.pathname.endsWith("/contact_card")
        && url.searchParams.get("phone_number") === "+15550000002"
        && init?.method === "GET") {
        return createJsonResponse({
          contact_cards: [],
        });
      }

      if (url.pathname.endsWith("/contact_card") && init?.method === "POST") {
        expect(readJsonRequestBody(init)).toEqual({
          first_name: "Murph",
          phone_number: "+15550000002",
        });
        return createJsonResponse({
          first_name: "Murph",
          image_url: null,
          is_active: true,
          phone_number: "+15550000002",
        });
      }

      throw new Error(`Unexpected Linq URL ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileHostedLinqContactCards({
      prisma: prisma as never,
    })).resolves.toEqual({
      activeCards: 1,
      atRiskLines: 1,
      createdCards: 1,
      criticalLines: 0,
      failedLines: 0,
      inactiveCards: 0,
      lineCount: 2,
      updatedCards: 0,
    });

    // Inventory refresh has one scheduled owner (the health cron); the
    // contact-card path must only read the projection.
    expect(linqInventoryMocks.syncHostedLinqPhoneNumberInventory).not.toHaveBeenCalled();
    expect(linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot).toHaveBeenCalledWith({
      limit: 50,
      observedAt: expect.any(Date),
      prisma,
    });
  });

  it("keeps reconciling remaining lines when one line fails and counts the failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    linqInventoryMocks.syncHostedLinqPhoneNumberInventory.mockResolvedValue({
      syncedCount: 2,
    });
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 2,
      lines: [
      {
        isConfigured: true,
        phoneNumber: "+15550000009",
        phoneNumberHint: "*** 0009",
        phoneNumberLookupKey: "lookup:9",
        providerReputationStatus: null,
        providerServiceStatus: null,
      },
      {
        isConfigured: true,
        phoneNumber: "+15550000001",
        phoneNumberHint: "*** 0001",
        phoneNumberLookupKey: "lookup:1",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      ],
    });
    const prisma = { hostedLinqLine: { count: vi.fn().mockResolvedValue(1) } };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.pathname.endsWith("/contact_card")
        && url.searchParams.get("phone_number") === "+15550000009"
        && init?.method === "GET") {
        return createJsonResponse({
          error: {
            code: 2006,
            message: "You do not have permission to send from this phone number",
            status: 403,
          },
          success: false,
        }, 403);
      }

      if (url.pathname.endsWith("/contact_card")
        && url.searchParams.get("phone_number") === "+15550000001"
        && init?.method === "GET") {
        return createJsonResponse({
          contact_cards: [
            {
              first_name: "Murph",
              image_url: null,
              is_active: true,
              phone_number: "+15550000001",
            },
          ],
        });
      }

      throw new Error(`Unexpected Linq URL ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileHostedLinqContactCards({
      prisma: prisma as never,
    })).resolves.toEqual({
      activeCards: 1,
      atRiskLines: 0,
      createdCards: 0,
      criticalLines: 0,
      failedLines: 1,
      inactiveCards: 0,
      lineCount: 2,
      updatedCards: 0,
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Hosted Linq contact-card line reconcile failed.",
      expect.objectContaining({ phoneNumberHint: "*** 0009" }),
    );
    consoleErrorSpy.mockRestore();
  });

  it("attempts every line but fails the run when all lines fail", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    linqInventoryMocks.syncHostedLinqPhoneNumberInventory.mockResolvedValue({
      syncedCount: 2,
    });
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 2,
      lines: [
      {
        isConfigured: true,
        phoneNumber: "+15550000001",
        phoneNumberHint: "*** 0001",
        phoneNumberLookupKey: "lookup:1",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      {
        isConfigured: true,
        phoneNumber: "+15550000002",
        phoneNumberHint: "*** 0002",
        phoneNumberLookupKey: "lookup:2",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      ],
    });
    const prisma = { hostedLinqLine: { count: vi.fn().mockResolvedValue(1) } };

    const fetchMock = vi.fn(async () => createJsonResponse({
      error: {
        code: 2006,
        message: "You do not have permission to send from this phone number",
        status: 403,
      },
      success: false,
    }, 403));
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileHostedLinqContactCards({
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_CONTACT_CARD_RECONCILE_FAILED",
    });

    // Both lines were still attempted and individually logged before the run
    // was surfaced as an outage.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    consoleErrorSpy.mockRestore();
  });

  it("fails the run when every line yields an inactive card without logging request failures", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    linqInventoryMocks.syncHostedLinqPhoneNumberInventory.mockResolvedValue({
      syncedCount: 1,
    });
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 1,
      lines: [
      {
        isConfigured: true,
        phoneNumber: "+15550000001",
        phoneNumberHint: "*** 0001",
        phoneNumberLookupKey: "lookup:1",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      ],
    });
    const prisma = { hostedLinqLine: { count: vi.fn().mockResolvedValue(1) } };

    const fetchMock = vi.fn(async () => createJsonResponse({
      contact_cards: [
        {
          first_name: "Murph",
          image_url: null,
          is_active: false,
          phone_number: "+15550000001",
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileHostedLinqContactCards({
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_CONTACT_CARD_RECONCILE_FAILED",
    });

    // The line responded; it just has no usable active card, so nothing is a
    // per-line request failure worth logging.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("fails the run when the only non-failing lines yield inactive cards", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    linqInventoryMocks.syncHostedLinqPhoneNumberInventory.mockResolvedValue({
      syncedCount: 2,
    });
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 2,
      lines: [
      {
        isConfigured: true,
        phoneNumber: "+15550000009",
        phoneNumberHint: "*** 0009",
        phoneNumberLookupKey: "lookup:9",
        providerReputationStatus: null,
        providerServiceStatus: null,
      },
      {
        isConfigured: true,
        phoneNumber: "+15550000001",
        phoneNumberHint: "*** 0001",
        phoneNumberLookupKey: "lookup:1",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      ],
    });
    const prisma = { hostedLinqLine: { count: vi.fn().mockResolvedValue(1) } };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.searchParams.get("phone_number") === "+15550000009" && init?.method === "GET") {
        return createJsonResponse({
          error: {
            code: 2006,
            message: "You do not have permission to send from this phone number",
            status: 403,
          },
          success: false,
        }, 403);
      }

      return createJsonResponse({
        contact_cards: [
          {
            first_name: "Murph",
            image_url: null,
            is_active: false,
            phone_number: "+15550000001",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileHostedLinqContactCards({
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_CONTACT_CARD_RECONCILE_FAILED",
    });

    // Both lines attempted; only the real request failure is logged.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("fails the run when configured lines exist but none keep validated inventory backing", async () => {
    // Two configured lines exist, but none carries a fresh confirmation.
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 2,
      lines: [],
    });
    const prisma = { hostedLinqLine: { count: vi.fn() } };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileHostedLinqContactCards({
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_CONTACT_CARD_RECONCILE_FAILED",
    });

    // A revoked pool is an outage, not an empty pool: no provider call is
    // made for a number the account no longer owns.
    expect(fetchMock).not.toHaveBeenCalled();

  });

  it("resolves an empty run when no configured lines exist at all", async () => {
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 0,
      lines: [],
    });
    const prisma = { hostedLinqLine: { count: vi.fn() } };
    vi.stubGlobal("fetch", vi.fn());

    await expect(reconcileHostedLinqContactCards({
      prisma: prisma as never,
    })).resolves.toEqual({
      activeCards: 0,
      atRiskLines: 0,
      createdCards: 0,
      criticalLines: 0,
      failedLines: 0,
      inactiveCards: 0,
      lineCount: 0,
      updatedCards: 0,
    });
  });

  it("fails the run when an active provider-only card is the only survivor of a configured outage", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 1,
      lines: [
        {
          isConfigured: true,
          phoneNumber: "+15550000009",
          phoneNumberHint: "*** 0009",
          phoneNumberLookupKey: "lookup:9",
          providerReputationStatus: "HEALTHY",
          providerServiceStatus: "ACTIVE",
        },
        {
          isConfigured: false,
          phoneNumber: "+15550000001",
          phoneNumberHint: "*** 0001",
          phoneNumberLookupKey: "lookup:1",
          providerReputationStatus: "HEALTHY",
          providerServiceStatus: "ACTIVE",
        },
      ],
    });
    const prisma = { hostedLinqLine: { count: vi.fn() } };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.searchParams.get("phone_number") === "+15550000009" && init?.method === "GET") {
        return createJsonResponse({
          error: {
            code: 2006,
            message: "You do not have permission to send from this phone number",
            status: 403,
          },
          success: false,
        }, 403);
      }

      // The unconfigured provider-only line still has a healthy active card.
      return createJsonResponse({
        contact_cards: [
          {
            first_name: "Murph",
            image_url: null,
            is_active: true,
            phone_number: "+15550000001",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    // An active card on a line that cannot own a member conversation must not
    // stand in for the loss of every configured line.
    await expect(reconcileHostedLinqContactCards({
      prisma: prisma as never,
    })).rejects.toMatchObject({
      code: "LINQ_CONTACT_CARD_RECONCILE_FAILED",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    consoleErrorSpy.mockRestore();
  });

  it("succeeds when a configured line keeps a usable card alongside a failing provider-only line", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 1,
      lines: [
        {
          isConfigured: true,
          phoneNumber: "+15550000001",
          phoneNumberHint: "*** 0001",
          phoneNumberLookupKey: "lookup:1",
          providerReputationStatus: "HEALTHY",
          providerServiceStatus: "ACTIVE",
        },
        {
          isConfigured: false,
          phoneNumber: "+15550000009",
          phoneNumberHint: "*** 0009",
          phoneNumberLookupKey: "lookup:9",
          providerReputationStatus: "HEALTHY",
          providerServiceStatus: "ACTIVE",
        },
      ],
    });
    const prisma = { hostedLinqLine: { count: vi.fn() } };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.searchParams.get("phone_number") === "+15550000009" && init?.method === "GET") {
        return createJsonResponse({ success: false }, 403);
      }

      return createJsonResponse({
        contact_cards: [
          {
            first_name: "Murph",
            image_url: null,
            is_active: true,
            phone_number: "+15550000001",
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileHostedLinqContactCards({
      prisma: prisma as never,
    })).resolves.toMatchObject({
      activeCards: 1,
      failedLines: 1,
      lineCount: 2,
    });
    consoleErrorSpy.mockRestore();
  });

  it("rethrows caller cancellation instead of counting it as a line failure", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    linqInventoryMocks.syncHostedLinqPhoneNumberInventory.mockResolvedValue({
      syncedCount: 2,
    });
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 2,
      lines: [
      {
        isConfigured: true,
        phoneNumber: "+15550000001",
        phoneNumberHint: "*** 0001",
        phoneNumberLookupKey: "lookup:1",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      {
        isConfigured: true,
        phoneNumber: "+15550000002",
        phoneNumberHint: "*** 0002",
        phoneNumberLookupKey: "lookup:2",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      ],
    });
    const prisma = { hostedLinqLine: { count: vi.fn().mockResolvedValue(1) } };
    const abortController = new AbortController();
    const abortReason = new Error("cron request aborted");

    const fetchMock = vi.fn(async () => {
      abortController.abort(abortReason);
      throw abortReason;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileHostedLinqContactCards({
      prisma: prisma as never,
      signal: abortController.signal,
    })).rejects.toBe(abortReason);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("corrects a non-Murph first name without clearing legacy provider fields", async () => {
    linqInventoryMocks.syncHostedLinqPhoneNumberInventory.mockResolvedValue({
      syncedCount: 1,
    });
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 1,
      lines: [
      {
        isConfigured: true,
        phoneNumber: "+15550000001",
        phoneNumberHint: "*** 0001",
        phoneNumberLookupKey: "lookup:1",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      ],
    });
    const prisma = { hostedLinqLine: { count: vi.fn().mockResolvedValue(1) } };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.pathname.endsWith("/contact_card")
        && url.searchParams.get("phone_number") === "+15550000001"
        && init?.method === "GET") {
        return createJsonResponse({
          contact_cards: [
            {
              first_name: "Murphy",
              image_url: "https://cdn.linqapp.com/example/contact-card/sample/image-current.png",
              is_active: true,
              last_name: "Legacy",
              phone_number: "+15550000001",
            },
          ],
        });
      }

      if (url.pathname.endsWith("/contact_card")
        && url.searchParams.get("phone_number") === "+15550000001"
        && init?.method === "PATCH") {
        expect(readJsonRequestBody(init)).toEqual({
          first_name: "Murph",
        });
        return createJsonResponse({
          first_name: "Murph",
          image_url: "https://cdn.linqapp.com/example/contact-card/sample/image-current.png",
          is_active: true,
          last_name: "Legacy",
          phone_number: "+15550000001",
        });
      }

      throw new Error(`Unexpected Linq URL ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileHostedLinqContactCards({
      prisma: prisma as never,
    })).resolves.toEqual({
      activeCards: 0,
      atRiskLines: 0,
      createdCards: 0,
      criticalLines: 0,
      failedLines: 0,
      inactiveCards: 0,
      lineCount: 1,
      updatedCards: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps legacy provider fields when the contact-card first name is current", async () => {
    linqInventoryMocks.syncHostedLinqPhoneNumberInventory.mockResolvedValue({
      syncedCount: 1,
    });
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 1,
      lines: [
      {
        isConfigured: true,
        phoneNumber: "+15550000001",
        phoneNumberHint: "*** 0001",
        phoneNumberLookupKey: "lookup:1",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      ],
    });
    const prisma = { hostedLinqLine: { count: vi.fn().mockResolvedValue(1) } };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.pathname.endsWith("/contact_card")
        && url.searchParams.get("phone_number") === "+15550000001"
        && init?.method === "GET") {
        return createJsonResponse({
          contact_cards: [
            {
              first_name: "Murph",
              image_url: "https://cdn.linqapp.com/example/contact-card/sample/image-current.png",
              is_active: true,
              last_name: "Legacy",
              phone_number: "+15550000001",
            },
          ],
        });
      }

      throw new Error(`Unexpected Linq URL ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileHostedLinqContactCards({
      prisma: prisma as never,
    })).resolves.toEqual({
      activeCards: 1,
      atRiskLines: 0,
      createdCards: 0,
      criticalLines: 0,
      failedLines: 0,
      inactiveCards: 0,
      lineCount: 1,
      updatedCards: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Inventory refresh has one scheduled owner (the health cron); the
    // contact-card path must only read the projection.
    expect(linqInventoryMocks.syncHostedLinqPhoneNumberInventory).not.toHaveBeenCalled();
    expect(linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot).toHaveBeenCalledWith({
      limit: 50,
      observedAt: expect.any(Date),
      prisma,
    });
  });

});

describe("buildMurphHostedLinqContactCardVcf", () => {
  it("builds a CRLF vCard 3.0 for the line without a photo", () => {
    const vcf = buildMurphHostedLinqContactCardVcf({
      phoneNumber: "+15557770000",
      photo: null,
    });

    expect(vcf).toBe([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:;Murph;;;",
      "FN:Murph",
      "TEL;TYPE=CELL:+15557770000",
      "END:VCARD",
    ].join("\r\n") + "\r\n");
  });

  it("adds a labeled backup number when a second line is available", () => {
    const vcf = buildMurphHostedLinqContactCardVcf({
      backupPhoneNumber: "+15558880000",
      phoneNumber: "+15557770000",
      photo: null,
    });

    expect(vcf).toBe([
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:;Murph;;;",
      "FN:Murph",
      "TEL;TYPE=CELL:+15557770000",
      "item1.TEL:+15558880000",
      "item1.X-ABLabel:backup",
      "END:VCARD",
    ].join("\r\n") + "\r\n");

    expect(buildMurphHostedLinqContactCardVcf({
      backupPhoneNumber: "+15557770000",
      phoneNumber: "+15557770000",
      photo: null,
    })).not.toContain("item1.TEL");
  });

  it("embeds the photo as folded base64 that unfolds losslessly", () => {
    const base64 = Buffer.from(new Uint8Array(512).fill(7)).toString("base64");
    const vcf = buildMurphHostedLinqContactCardVcf({
      phoneNumber: "+15557770000",
      photo: { base64, type: "PNG" },
    });

    const lines = vcf.split("\r\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
    const unfolded = vcf.replace(/\r\n[ ]/gu, "");
    expect(unfolded).toContain(`PHOTO;ENCODING=b;TYPE=PNG:${base64}`);
  });

  it("rejects an unusable line phone number", () => {
    expect(() => buildMurphHostedLinqContactCardVcf({
      phoneNumber: "not-a-phone",
      photo: null,
    })).toThrow(/phone number/u);
  });
});

describe("fetchMurphHostedLinqContactCardVcfPhoto", () => {
  it("returns embedded base64 for a healthy png response", async () => {
    runtimeMocks.getHostedOnboardingEnvironment.mockReturnValue({
      publicBaseUrl: "https://www.withmurph.ai",
    });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(bytes, {
      headers: { "content-type": "image/png" },
      status: 200,
    }));

    await expect(fetchMurphHostedLinqContactCardVcfPhoto({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).resolves.toEqual({
      base64: Buffer.from(bytes).toString("base64"),
      type: "PNG",
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://www.withmurph.ai/murph_headshot.png",
      expect.anything(),
    );
  });

  it("keeps a local photo timeout when caller cancellation is supplied", async () => {
    runtimeMocks.getHostedOnboardingEnvironment.mockReturnValue({
      publicBaseUrl: "https://www.withmurph.ai",
    });
    const callerSignal = new AbortController().signal;
    const localTimeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout")
      .mockReturnValue(localTimeout.signal);
    const fetchImpl = vi.fn((
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("Expected a photo-fetch abort signal."));
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));

    try {
      const photoPromise = fetchMurphHostedLinqContactCardVcfPhoto({
        fetchImpl: fetchImpl as unknown as typeof fetch,
        signal: callerSignal,
      });

      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(timeoutSpy).toHaveBeenCalledWith(5_000);
      const signal = fetchImpl.mock.calls[0]?.[1]?.signal;
      if (!signal) {
        throw new Error("Expected a composed photo-fetch abort signal.");
      }
      expect(signal).not.toBe(callerSignal);
      expect(signal.aborted).toBe(false);

      localTimeout.abort();

      await expect(photoPromise).resolves.toBeNull();
      expect(signal.aborted).toBe(true);
      expect(callerSignal.aborted).toBe(false);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("fails soft to null on provider errors and oversized bodies", async () => {
    runtimeMocks.getHostedOnboardingEnvironment.mockReturnValue({
      publicBaseUrl: "https://www.withmurph.ai",
    });

    await expect(fetchMurphHostedLinqContactCardVcfPhoto({
      fetchImpl: vi.fn().mockResolvedValue(new Response("nope", { status: 500 })) as unknown as typeof fetch,
    })).resolves.toBeNull();

    await expect(fetchMurphHostedLinqContactCardVcfPhoto({
      fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch,
    })).resolves.toBeNull();

    const oversized = new Uint8Array(2 * 1024 * 1024 + 1);
    await expect(fetchMurphHostedLinqContactCardVcfPhoto({
      fetchImpl: vi.fn().mockResolvedValue(new Response(oversized, {
        headers: { "content-type": "image/png" },
        status: 200,
      })) as unknown as typeof fetch,
    })).resolves.toBeNull();
  });
});

describe("resolveMurphHostedLinqContactCardBackupPhoneNumber", () => {
  it("reads the existing projection and returns the first healthy alternate without provider sync", async () => {
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockResolvedValue({
      configuredLineCount: 4,
      lines: [
      {
        isConfigured: true,
        phoneNumber: "+15550000001",
        phoneNumberHint: "*** 0001",
        phoneNumberLookupKey: "lookup:1",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      {
        isConfigured: true,
        phoneNumber: "+15550000002",
        phoneNumberHint: "*** 0002",
        phoneNumberLookupKey: "lookup:2",
        providerReputationStatus: "AT_RISK",
        providerServiceStatus: "ACTIVE",
      },
      {
        isConfigured: true,
        phoneNumber: "+15550000004",
        phoneNumberHint: "*** 0004",
        phoneNumberLookupKey: "lookup:4",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "FLAGGED",
      },
      {
        isConfigured: true,
        phoneNumber: "+15550000003",
        phoneNumberHint: "*** 0003",
        phoneNumberLookupKey: "lookup:3",
        providerReputationStatus: "HEALTHY",
        providerServiceStatus: "ACTIVE",
      },
      ],
    });
    const providerFetch = vi.fn(() => {
      throw new Error("Backup selection must not call Linq.");
    });
    vi.stubGlobal("fetch", providerFetch);
    const prisma = { hostedLinqLine: { count: vi.fn().mockResolvedValue(1) } };

    await expect(resolveMurphHostedLinqContactCardBackupPhoneNumber({
      excludePhoneNumber: "+15550000001",
      prisma: prisma as never,
    })).resolves.toBe("+15550000003");

    expect(linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot).toHaveBeenCalledOnce();
    expect(linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot).toHaveBeenCalledWith({
      limit: 50,
      prisma,
    });
    expect(linqInventoryMocks.syncHostedLinqPhoneNumberInventory).not.toHaveBeenCalled();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("fails soft to null when the projection read is unavailable", async () => {
    linqLineStoreMocks.readHostedLinqContactCardCandidacySnapshot.mockRejectedValue(
      new Error("projection unavailable"),
    );

    await expect(resolveMurphHostedLinqContactCardBackupPhoneNumber({
      excludePhoneNumber: "+15550000001",
      prisma: {} as never,
    })).resolves.toBeNull();

    expect(linqInventoryMocks.syncHostedLinqPhoneNumberInventory).not.toHaveBeenCalled();
  });
});

describe("sendHostedLinqAttachmentMessage failure phases", () => {
  it("tags pre-send failures as prepare and leaves message-send failures ambiguous", async () => {
    const attachmentCreated = createJsonResponse({
      attachment_id: "att_1",
      required_headers: { "content-type": "text/vcard" },
      upload_url: "https://uploads.example.test/att_1",
    });

    // Attachment create fails: provably nothing was sent.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    let prepareError: unknown;
    await sendHostedLinqAttachmentMessage({
      bytes: new Uint8Array([1]),
      chatId: "chat_group_1",
      contentType: "text/vcard",
      fileName: "Murph.vcf",
    }).catch((error: unknown) => {
      prepareError = error;
    });
    expect(isHostedLinqAttachmentSendPrepareFailure(prepareError)).toBe(true);

    // Create + upload succeed, the final message POST fails: ambiguous.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(String(input));
      if (url.pathname.endsWith("/attachments")) {
        return attachmentCreated.clone();
      }
      if (url.hostname === "uploads.example.test") {
        return new Response(null, { status: 200 });
      }
      if (url.pathname.endsWith("/messages")) {
        return new Response("nope", { status: 500 });
      }
      throw new Error(`Unexpected Linq URL ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    let sendError: unknown;
    await sendHostedLinqAttachmentMessage({
      bytes: new Uint8Array([1]),
      chatId: "chat_group_1",
      contentType: "text/vcard",
      fileName: "Murph.vcf",
    }).catch((error: unknown) => {
      sendError = error;
    });
    expect(sendError).toBeTruthy();
    expect(isHostedLinqAttachmentSendPrepareFailure(sendError)).toBe(false);
  });
});
