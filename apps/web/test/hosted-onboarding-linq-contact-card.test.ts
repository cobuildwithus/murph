import { afterEach, describe, expect, it, vi } from "vitest";

const linqLineStoreMocks = vi.hoisted(() => ({
  upsertHostedLinqLineForPhoneTx: vi.fn(),
}));

vi.mock("@/src/lib/hosted-onboarding/runtime", () => ({
  requireHostedOnboardingLinqConfig: () => ({
    apiBaseUrl: "https://linq.example.test/api/partner/v3",
    apiToken: "linq-token",
  }),
}));

vi.mock("@/src/lib/hosted-onboarding/linq-line-store", () => ({
  upsertHostedLinqLineForPhoneTx: linqLineStoreMocks.upsertHostedLinqLineForPhoneTx,
}));

import {
  listHostedLinqContactCards,
  listHostedLinqPhoneNumbers,
  reconcileHostedLinqContactCards,
  setupHostedLinqContactCard,
  shareHostedLinqContactCard,
  updateHostedLinqContactCard,
} from "@/src/lib/hosted-onboarding/linq-contact-card";

const originalFetch = globalThis.fetch;

afterEach(() => {
  linqLineStoreMocks.upsertHostedLinqLineForPhoneTx.mockReset();

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
  it("lists phone numbers with provider reputation", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => createJsonResponse({
      phone_numbers: [
        {
          id: "line_1",
          phone_number: "+15550000001",
          reputation: {
            status: "AT_RISK",
            doc_url: "https://docs.linqapp.com/guides/phone-numbers/phone-health#at-risk",
          },
        },
        {
          id: "line_2",
          phone_number: "+15550000002",
          health_status: {
            status: "CRITICAL",
            doc_url: "https://docs.linqapp.com/guides/phone-numbers/phone-health#critical",
          },
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listHostedLinqPhoneNumbers()).resolves.toEqual([
      {
        id: "line_1",
        phoneNumber: "+15550000001",
        reputationDocUrl: "https://docs.linqapp.com/guides/phone-numbers/phone-health#at-risk",
        reputationStatus: "AT_RISK",
      },
      {
        id: "line_2",
        phoneNumber: "+15550000002",
        reputationDocUrl: "https://docs.linqapp.com/guides/phone-numbers/phone-health#critical",
        reputationStatus: "CRITICAL",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("phone_numbers", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        method: "GET",
      }),
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

  it("shares the contact card into an existing chat without a body", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await shareHostedLinqContactCard({
      chatId: "chat_123",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("chats/chat_123/share_contact_card", "https://linq.example.test/api/partner/v3/"),
      expect.objectContaining({
        body: undefined,
        method: "POST",
      }),
    );
  });

  it("reconciles provider reputation without auto-enabling disabled lines", async () => {
    const observedAt = new Date("2026-06-25T12:00:00.000Z");
    const findUnique = vi.fn()
      .mockResolvedValueOnce({ egressPolicy: "disabled" })
      .mockResolvedValueOnce({ egressPolicy: "enabled" });
    const update = vi.fn().mockResolvedValue(null);
    const prisma = {
      hostedLinqLine: {
        findUnique,
        update,
      },
    };
    linqLineStoreMocks.upsertHostedLinqLineForPhoneTx.mockImplementation(
      async (input: { phoneNumber: string }) => ({
        phoneNumber: input.phoneNumber,
      }),
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.pathname.endsWith("/phone_numbers")) {
        return createJsonResponse({
          phone_numbers: [
            {
              id: "line_healthy",
              phone_number: "+15550000001",
              reputation: {
                status: "HEALTHY",
              },
            },
            {
              id: "line_risk",
              phone_number: "+15550000002",
              reputation: {
                doc_url: "https://docs.linqapp.com/guides/phone-numbers/phone-health#at-risk",
                status: "AT_RISK",
              },
            },
          ],
        });
      }

      if (url.pathname.endsWith("/contact_card") && url.search === "" && init?.method === "GET") {
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

      if (url.pathname.endsWith("/contact_card") && url.searchParams.has("phone_number")) {
        return createJsonResponse({
          first_name: "Murph",
          is_active: true,
          phone_number: url.searchParams.get("phone_number"),
        });
      }

      if (url.pathname.endsWith("/contact_card")) {
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

    expect(linqLineStoreMocks.upsertHostedLinqLineForPhoneTx).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, {
      where: {
        phoneNumber: "+15550000001",
      },
      data: {
        healthStatus: "healthy",
        providerReason: null,
        providerStatus: "HEALTHY",
        providerUpdatedAt: observedAt,
      },
    });
    expect(update).toHaveBeenNthCalledWith(2, {
      where: {
        phoneNumber: "+15550000002",
      },
      data: {
        egressPolicy: "avoid_new_assignments",
        healthStatus: "degraded",
        providerReason: "https://docs.linqapp.com/guides/phone-numbers/phone-health#at-risk",
        providerStatus: "AT_RISK",
        providerUpdatedAt: observedAt,
      },
    });
  });

  it("pauses outbound for critical provider reputation", async () => {
    const observedAt = new Date("2026-06-25T13:00:00.000Z");
    const findUnique = vi.fn().mockResolvedValue({ egressPolicy: "enabled" });
    const update = vi.fn().mockResolvedValue(null);
    const prisma = {
      hostedLinqLine: {
        findUnique,
        update,
      },
    };
    linqLineStoreMocks.upsertHostedLinqLineForPhoneTx.mockImplementation(
      async (input: { phoneNumber: string }) => ({
        phoneNumber: input.phoneNumber,
      }),
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(String(input));

      if (url.pathname.endsWith("/phone_numbers")) {
        return createJsonResponse({
          phone_numbers: [
            {
              id: "line_critical",
              phone_number: "+15550000003",
              reputation: {
                doc_url: "https://docs.linqapp.com/guides/phone-numbers/phone-health#critical",
                status: "CRITICAL",
              },
            },
          ],
        });
      }

      if (url.pathname.endsWith("/contact_card") && init?.method === "GET") {
        return createJsonResponse({
          contact_cards: [
            {
              first_name: "Murph",
              is_active: true,
              phone_number: "+15550000003",
            },
          ],
        });
      }

      throw new Error(`Unexpected Linq URL ${url.pathname}${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(reconcileHostedLinqContactCards({
      observedAt,
      prisma: prisma as never,
    })).resolves.toEqual({
      activeCards: 1,
      atRiskLines: 0,
      createdCards: 0,
      criticalLines: 1,
      inactiveCards: 0,
      lineCount: 1,
      updatedCards: 0,
    });

    expect(update).toHaveBeenCalledWith({
      where: {
        phoneNumber: "+15550000003",
      },
      data: {
        egressPolicy: "disabled",
        healthStatus: "unhealthy",
        providerReason: "https://docs.linqapp.com/guides/phone-numbers/phone-health#critical",
        providerStatus: "CRITICAL",
        providerUpdatedAt: observedAt,
      },
    });
  });
});
