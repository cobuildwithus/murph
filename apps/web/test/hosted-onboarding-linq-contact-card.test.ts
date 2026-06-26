import { afterEach, describe, expect, it, vi } from "vitest";

const linqLineStoreMocks = vi.hoisted(() => ({
  syncHostedLinqConfiguredLinesTx: vi.fn(),
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
  syncHostedLinqConfiguredLinesTx: linqLineStoreMocks.syncHostedLinqConfiguredLinesTx,
}));

import {
  getHostedLinqContactCard,
  listHostedLinqContactCards,
  reconcileHostedLinqContactCards,
  setupHostedLinqContactCard,
  updateHostedLinqContactCard,
} from "@/src/lib/hosted-onboarding/linq-contact-card";

const originalFetch = globalThis.fetch;

afterEach(() => {
  runtimeMocks.getHostedOnboardingEnvironment.mockReset();
  linqLineStoreMocks.syncHostedLinqConfiguredLinesTx.mockReset();

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
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listHostedLinqContactCards()).resolves.toEqual([
      {
        firstName: "Murph",
        imageUrl: null,
        isActive: true,
        lastName: null,
        phoneNumber: "+15550000001",
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

  it("reconciles configured line contact cards without provider-wide scans", async () => {
    const observedAt = new Date("2026-06-25T12:30:00.000Z");
    runtimeMocks.getHostedOnboardingEnvironment.mockReturnValue({
      linqConversationPhoneNumbers: ["+15550000001", "+15550000002", "+15550000002"],
      linqMaxActiveMembersPerConversationPhone: 1000,
    });
    const findMany = vi.fn().mockResolvedValue([
      {
        phoneNumber: "+15550000001",
        providerStatus: "HEALTHY",
      },
      {
        phoneNumber: "+15550000002",
        providerStatus: "AT_RISK",
      },
    ]);
    const prisma = {
      hostedLinqLine: {
        findMany,
      },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.pathname.endsWith("/phone_numbers")) {
        throw new Error("Reconciliation should not scan provider phone numbers.");
      }

      if (url.pathname.endsWith("/contact_card") && url.search === "" && init?.method === "GET") {
        throw new Error("Reconciliation should not scan provider contact cards.");
      }

      if (url.pathname.endsWith("/contact_card")
        && url.searchParams.get("phone_number") === "+15550000001"
        && init?.method === "GET") {
        return createJsonResponse({
          contact_cards: [
            {
              first_name: "Support",
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

      if (url.pathname.endsWith("/contact_card")
        && url.searchParams.get("phone_number") === "+15550000001"
        && init?.method === "PATCH") {
        return createJsonResponse({
          first_name: "Murph",
          is_active: true,
          phone_number: "+15550000001",
        });
      }

      if (url.pathname.endsWith("/contact_card") && init?.method === "POST") {
        return createJsonResponse({
          first_name: "Murph",
          is_active: true,
          phone_number: "+15550000002",
        });
      }

      throw new Error(`Unexpected Linq URL ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileHostedLinqContactCards({
      observedAt,
      prisma: prisma as never,
    })).resolves.toEqual({
      activeCards: 0,
      atRiskLines: 1,
      createdCards: 1,
      criticalLines: 0,
      inactiveCards: 0,
      lineCount: 2,
      updatedCards: 1,
    });

    expect(linqLineStoreMocks.syncHostedLinqConfiguredLinesTx).toHaveBeenCalledWith({
      activeMemberLimit: 1000,
      observedAt,
      phoneNumbers: ["+15550000001", "+15550000002"],
      prisma,
    });
    expect(findMany).toHaveBeenCalledWith({
      orderBy: {
        phoneNumber: "asc",
      },
      select: {
        phoneNumber: true,
        providerStatus: true,
      },
      take: 50,
      where: {
        phoneNumber: {
          in: ["+15550000001", "+15550000002"],
        },
      },
    });
  });

});
