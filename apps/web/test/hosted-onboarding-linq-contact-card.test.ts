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
      observedAt,
      prisma: prisma as never,
    })).resolves.toEqual({
      activeCards: 1,
      atRiskLines: 1,
      createdCards: 1,
      criticalLines: 0,
      inactiveCards: 0,
      lineCount: 2,
      updatedCards: 0,
    });

    expect(linqInventoryMocks.syncHostedLinqPhoneNumberInventory).toHaveBeenCalledWith(expect.objectContaining({
      maxLines: 250,
      observedAt,
      prisma,
    }));
    expect(linqLineStoreMocks.listHostedLinqContactCardLines).toHaveBeenCalledWith({
      limit: 50,
      prisma,
    });
  });

  it("clears existing provider contact-card images during reconciliation", async () => {
    const observedAt = new Date("2026-06-25T12:30:00.000Z");
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
        expect(readJsonRequestBody(init)).toEqual({
          first_name: "Murph",
          image_url: null,
        });
        return createJsonResponse({
          first_name: "Murph",
          image_url: null,
          is_active: true,
          phone_number: "+15550000001",
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
      atRiskLines: 0,
      createdCards: 0,
      criticalLines: 0,
      inactiveCards: 0,
      lineCount: 1,
      updatedCards: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(linqInventoryMocks.syncHostedLinqPhoneNumberInventory).toHaveBeenCalledWith(expect.objectContaining({
      maxLines: 250,
      observedAt,
      prisma,
    }));
    expect(linqLineStoreMocks.listHostedLinqContactCardLines).toHaveBeenCalledWith({
      limit: 50,
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
      {
        phoneNumber: "+15550000003",
        phoneNumberHint: "*** 0003",
        phoneNumberLookupKey: "lookup:3",
        providerStatus: "HEALTHY",
      },
    ]);

    await expect(resolveMurphHostedLinqContactCardBackupPhoneNumber({
      excludePhoneNumber: "+15550000001",
      prisma: {} as never,
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
