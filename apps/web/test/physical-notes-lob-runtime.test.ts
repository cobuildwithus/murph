import { describe, expect, it, vi } from "vitest";

import {
  createLobPhysicalNoteRuntime,
  renderPhysicalNoteHtml,
} from "../src/lib/physical-notes/lob-runtime";

describe("Lob physical-note runtime", () => {
  it("submits one full-page image letter with provider idempotency", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        address_placement: "insert_blank_page",
        color: true,
        double_sided: true,
        from: "adr_from",
        mail_type: "usps_first_class",
        use_type: "operational",
        size: "us_letter",
        to: {
          address_city: "Atlanta",
          address_country: "US",
          address_line1: "123 Main St",
          address_state: "GA",
          address_zip: "30308",
          name: "Sam",
        },
      });
      expect(body.file).toContain(
        'src="https://media.example.test/artwork?a=1&amp;b=2"',
      );
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("hpn_1");
      expect(new Headers(init?.headers).get("Lob-Version")).toBe("2024-01-01");
      return Response.json({ id: "ltr_123" });
    });
    const runtime = createLobPhysicalNoteRuntime({
      apiKey: "test_key",
      fetchImpl,
      fromAddressId: "adr_from",
    });

    await expect(runtime.create({
      artworkUrl: "https://media.example.test/artwork?a=1&b=2",
      idempotencyKey: "hpn_1",
      noteId: "hpn_1",
      recipient: {
        addressLine1: "123 Main St",
        city: "Atlanta",
        name: "Sam",
        postalCode: "30308",
        state: "GA",
      },
    })).resolves.toEqual({
      kind: "accepted",
      providerLetterId: "ltr_123",
    });
  });

  it("keeps network and server failures ambiguous", async () => {
    const runtime = createLobPhysicalNoteRuntime({
      apiKey: "test_key",
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(null, {
        status: 503,
      })),
      fromAddressId: "adr_from",
    });
    await expect(runtime.create({
      artworkUrl: "https://media.example.test/artwork",
      idempotencyKey: "hpn_1",
      noteId: "hpn_1",
      recipient: {
        addressLine1: "123 Main St",
        city: "Atlanta",
        name: "Sam",
        postalCode: "30308",
        state: "GA",
      },
    })).resolves.toEqual({ kind: "ambiguous_failure" });
  });

  it("renders only transport layout around the model-owned artwork", () => {
    const html = renderPhysicalNoteHtml("https://media.example.test/artwork");
    expect(html).toContain("object-fit:cover");
    expect(html).toContain("padding:.0625in");
    expect(html).not.toContain("murph ai");
    expect(() => renderPhysicalNoteHtml("http://media.example.test/artwork"))
      .toThrow("HTTPS");
  });
});
