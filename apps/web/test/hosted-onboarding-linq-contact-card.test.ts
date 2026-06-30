import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

const linqLineStoreMocks = vi.hoisted(() => ({
  listHostedLinqContactCardLines: vi.fn(),
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
}));

vi.mock("@/src/lib/hosted-onboarding/linq-phone-number-inventory", () => ({
  syncHostedLinqPhoneNumberInventory: linqInventoryMocks.syncHostedLinqPhoneNumberInventory,
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
  linqInventoryMocks.syncHostedLinqPhoneNumberInventory.mockReset();
  linqLineStoreMocks.listHostedLinqContactCardLines.mockReset();

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

  it("reconciles DB-backed line contact cards after provider inventory sync", async () => {
    const observedAt = new Date("2026-06-25T12:30:00.000Z");
    runtimeMocks.getHostedOnboardingEnvironment.mockReturnValue({
      publicBaseUrl: "https://app.example.test",
    });
    const contactCardImageUrl = "https://app.example.test/murph_headshot.png";
    linqInventoryMocks.syncHostedLinqPhoneNumberInventory.mockResolvedValue({
      syncedCount: 2,
    });
    linqLineStoreMocks.listHostedLinqContactCardLines.mockResolvedValue([
      {
        phoneNumber: "+15550000001",
        phoneNumberHint: "*** 0001",
        phoneNumberLookupKey: "lookup:1",
        providerStatus: "HEALTHY",
      },
      {
        phoneNumber: "+15550000002",
        phoneNumberHint: "*** 0002",
        phoneNumberLookupKey: "lookup:2",
        providerStatus: "AT_RISK",
      },
    ]);
    const prisma = {};

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

      if (url.pathname.endsWith("/contact_card")
        && url.searchParams.get("phone_number") === "+15550000001"
        && init?.method === "PATCH") {
        expect(readJsonRequestBody(init)).toEqual({
          first_name: "Murph",
          image_url: contactCardImageUrl,
        });
        return createJsonResponse({
          first_name: "Murph",
          image_url: contactCardImageUrl,
          is_active: true,
          phone_number: "+15550000001",
        });
      }

      if (url.pathname.endsWith("/contact_card") && init?.method === "POST") {
        expect(readJsonRequestBody(init)).toEqual({
          first_name: "Murph",
          image_url: contactCardImageUrl,
          phone_number: "+15550000002",
        });
        return createJsonResponse({
          first_name: "Murph",
          image_url: contactCardImageUrl,
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

    expect(linqInventoryMocks.syncHostedLinqPhoneNumberInventory).toHaveBeenCalledWith(expect.objectContaining({
      observedAt,
      prisma,
    }));
    expect(linqLineStoreMocks.listHostedLinqContactCardLines).toHaveBeenCalledWith({
      limit: 50,
      prisma,
    });
  });

  it("treats Linq-hosted contact-card image URLs as current", async () => {
    const observedAt = new Date("2026-06-25T12:30:00.000Z");
    runtimeMocks.getHostedOnboardingEnvironment.mockReturnValue({
      publicBaseUrl: "https://app.example.test",
    });
    linqInventoryMocks.syncHostedLinqPhoneNumberInventory.mockResolvedValue({
      syncedCount: 1,
    });
    linqLineStoreMocks.listHostedLinqContactCardLines.mockResolvedValue([
      {
        phoneNumber: "+15550000001",
        phoneNumberHint: "*** 0001",
        phoneNumberLookupKey: "lookup:1",
        providerStatus: "HEALTHY",
      },
    ]);
    const prisma = {};

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
              phone_number: "+15550000001",
            },
          ],
        });
      }

      if (url.pathname.endsWith("/contact_card") && init?.method === "PATCH") {
        throw new Error("Linq-hosted contact card image should not be updated.");
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
      criticalLines: 0,
      inactiveCards: 0,
      lineCount: 1,
      updatedCards: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(linqInventoryMocks.syncHostedLinqPhoneNumberInventory).toHaveBeenCalledWith(expect.objectContaining({
      observedAt,
      prisma,
    }));
    expect(linqLineStoreMocks.listHostedLinqContactCardLines).toHaveBeenCalledWith({
      limit: 50,
      prisma,
    });
  });

});
