import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

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
  createHostedPhoneLookupKey,
} from "@/src/lib/hosted-onboarding/contact-privacy";
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

  it("reconciles configured line contact cards without provider-wide scans", async () => {
    const observedAt = new Date("2026-06-25T12:30:00.000Z");
    runtimeMocks.getHostedOnboardingEnvironment.mockReturnValue({
      contactPrivacyKeyring: {
        currentVersion: "v1",
        keysByVersion: {
          v1: Buffer.alloc(32),
        },
        readVersions: ["v1"],
      },
      linqConversationPhoneNumbers: ["+15550000001", "+15550000002", "+15550000002"],
      linqMaxActiveMembersPerConversationPhone: 1000,
      publicBaseUrl: "https://app.example.test",
    });
    const contactCardImageUrl = "https://app.example.test/murph_headshot.png";
    const firstLookupKey = createHostedPhoneLookupKey("+15550000001");
    const secondLookupKey = createHostedPhoneLookupKey("+15550000002");
    const findMany = vi.fn().mockResolvedValue([
      {
        phoneNumberLookupKey: firstLookupKey,
        providerStatus: "HEALTHY",
      },
      {
        phoneNumberLookupKey: secondLookupKey,
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

    expect(linqLineStoreMocks.syncHostedLinqConfiguredLinesTx).toHaveBeenCalledWith({
      activeMemberLimit: 1000,
      observedAt,
      phoneNumbers: ["+15550000001", "+15550000002"],
      prisma,
    });
    expect(findMany).toHaveBeenCalledWith({
      select: {
        phoneNumberLookupKey: true,
        providerStatus: true,
      },
      take: 50,
      where: {
        phoneNumberLookupKey: {
          in: [firstLookupKey, secondLookupKey],
        },
      },
    });
  });

  it("treats Linq-hosted contact-card image URLs as current", async () => {
    const observedAt = new Date("2026-06-25T12:30:00.000Z");
    runtimeMocks.getHostedOnboardingEnvironment.mockReturnValue({
      contactPrivacyKeyring: {
        currentVersion: "v1",
        keysByVersion: {
          v1: Buffer.alloc(32),
        },
        readVersions: ["v1"],
      },
      linqConversationPhoneNumbers: ["+15550000001"],
      linqMaxActiveMembersPerConversationPhone: 1000,
      publicBaseUrl: "https://app.example.test",
    });
    const lookupKey = createHostedPhoneLookupKey("+15550000001");
    const findMany = vi.fn().mockResolvedValue([
      {
        phoneNumberLookupKey: lookupKey,
        providerStatus: "HEALTHY",
      },
    ]);
    const prisma = {
      hostedLinqLine: {
        findMany,
      },
    };

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
  it("returns the first healthy configured line that is not the chat's own", async () => {
    runtimeMocks.getHostedOnboardingEnvironment.mockReturnValue({
      contactPrivacyKeyring: {
        currentVersion: "v1",
        keysByVersion: { v1: Buffer.alloc(32) },
        readVersions: ["v1"],
      },
      linqConversationPhoneNumbers: ["+15550000001", "+15550000002", "+15550000003"],
      linqMaxActiveMembersPerConversationPhone: 1000,
      publicBaseUrl: "https://app.example.test",
    });
    const prisma = {
      hostedLinqLine: {
        findMany: vi.fn().mockResolvedValue([
          {
            phoneNumberLookupKey: createHostedPhoneLookupKey("+15550000002"),
            providerStatus: "AT_RISK",
          },
          {
            phoneNumberLookupKey: createHostedPhoneLookupKey("+15550000003"),
            providerStatus: "HEALTHY",
          },
        ]),
      },
    };

    await expect(resolveMurphHostedLinqContactCardBackupPhoneNumber({
      excludePhoneNumber: "+15550000001",
      prisma: prisma as never,
    })).resolves.toBe("+15550000003");
  });

  it("fails soft to null when listing lines is unavailable", async () => {
    runtimeMocks.getHostedOnboardingEnvironment.mockImplementation(() => {
      throw new Error("env unavailable");
    });

    await expect(resolveMurphHostedLinqContactCardBackupPhoneNumber({
      excludePhoneNumber: "+15550000001",
      prisma: {} as never,
    })).resolves.toBeNull();
  });
});
