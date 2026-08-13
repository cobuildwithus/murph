import { describe, expect, it, vi } from "vitest";

import {
  createLobPhysicalNoteRuntime,
  renderPhysicalNoteHtml,
} from "../src/lib/physical-notes/lob-runtime";

describe("Lob physical-note runtime", () => {
  it("submits one full-page image letter with provider idempotency", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe(
        "https://api.lob.com/v1/letters",
      );
      expect(request.method).toBe("POST");
      expect(init?.redirect).toBe("error");
      const body = await request.json();
      expect(body).toEqual({
        address_placement: "insert_blank_page",
        color: true,
        double_sided: true,
        file: expect.stringContaining(
          'src="https://media.example.test/artwork?a=1&amp;b=2"',
        ),
        from: "adr_from",
        mail_type: "usps_first_class",
        metadata: {
          murph_physical_note_id: "hpn_1",
        },
        size: "us_letter",
        to: {
          address_city: "Atlanta",
          address_country: "US",
          address_line1: "123 Main St",
          address_line2: "Apt 4",
          address_state: "GA",
          address_zip: "30308",
          name: "Sam",
        },
        use_type: "operational",
      });
      expect(request.headers.get("authorization")).toBe(
        "Basic dGVzdF9rZXk6",
      );
      expect(request.headers.get("content-type")).toBe("application/json");
      expect(request.headers.get("Idempotency-Key")).toBe("hpn_1");
      expect(request.headers.get("Lob-Version")).toBe("2024-01-01");
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
        addressLine2: "Apt 4",
        city: "Atlanta",
        name: "Sam",
        postalCode: "30308",
        state: "GA",
      },
    })).resolves.toEqual({
      kind: "accepted",
      providerLetterId: "ltr_123",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("keeps request-construction failures ambiguous before provider transport", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const runtime = createLobPhysicalNoteRuntime({
      apiKey: "test_key",
      fetchImpl,
      fromAddressId: "adr_from",
    });

    await expect(
      runtime.create({
        artworkUrl: "http://media.example.test/artwork",
        idempotencyKey: "hpn_invalid_artwork",
        noteId: "hpn_invalid_artwork",
        recipient: {
          addressLine1: "123 Main St",
          city: "Atlanta",
          name: "Sam",
          postalCode: "30308",
          state: "GA",
        },
      }),
    ).resolves.toEqual({ kind: "ambiguous_failure" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not enter provider transport when the caller is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();
    const runtime = createLobPhysicalNoteRuntime({
      apiKey: "test_key",
      fetchImpl,
      fromAddressId: "adr_from",
    });

    await expect(runtime.create({
      artworkUrl: "https://media.example.test/artwork",
      idempotencyKey: "hpn_aborted",
      noteId: "hpn_aborted",
      recipient: {
        addressLine1: "123 Main St",
        city: "Atlanta",
        name: "Sam",
        postalCode: "30308",
        state: "GA",
      },
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps network, server, and malformed-success writes ambiguous without retrying", async () => {
    const responses: Array<() => Promise<Response>> = [
      async () => {
        throw new Error("network unavailable");
      },
      async () => new Response(JSON.stringify({
        error: { message: "provider internal detail" },
      }), {
        headers: { "content-type": "application/json" },
        status: 503,
      }),
      async () => Response.json({ id: "not-a-letter-id" }),
    ];

    for (const response of responses) {
      const fetchImpl = vi.fn<typeof fetch>(response);
      const runtime = createLobPhysicalNoteRuntime({
        apiKey: "test_key",
        fetchImpl,
        fromAddressId: "adr_from",
      });
      await expect(runtime.create({
        artworkUrl: "https://media.example.test/artwork",
        idempotencyKey: "hpn_ambiguous",
        noteId: "hpn_ambiguous",
        recipient: {
          addressLine1: "123 Main St",
          city: "Atlanta",
          name: "Sam",
          postalCode: "30308",
          state: "GA",
        },
      })).resolves.toEqual({ kind: "ambiguous_failure" });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it("normalizes definite provider rejections to their status only", async () => {
    const cancel = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      new ReadableStream({ cancel }),
      {
        status: 422,
      },
    ));
    const runtime = createLobPhysicalNoteRuntime({
      apiKey: "test_key",
      fetchImpl,
      fromAddressId: "adr_from",
    });

    await expect(runtime.create({
      artworkUrl: "https://media.example.test/artwork",
      idempotencyKey: "hpn_rejected",
      noteId: "hpn_rejected",
      recipient: {
        addressLine1: "123 Main St",
        city: "Atlanta",
        name: "Sam",
        postalCode: "30308",
        state: "GA",
      },
    })).resolves.toEqual({
      kind: "definite_failure",
      status: 422,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("uses the write-only provider deadline", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.signal).toBe(timeoutSpy.mock.results[0]?.value);
      return Response.json({ id: "ltr_timeout" });
    });
    const runtime = createLobPhysicalNoteRuntime({
      apiKey: "test_key",
      fetchImpl,
      fromAddressId: "adr_from",
    });

    try {
      await expect(
        runtime.create({
          artworkUrl: "https://media.example.test/artwork",
          idempotencyKey: "hpn_write_timeout",
          noteId: "hpn_write_timeout",
          recipient: {
            addressLine1: "123 Main St",
            city: "Atlanta",
            name: "Sam",
            postalCode: "30308",
            state: "GA",
          },
        }),
      ).resolves.toEqual({
        kind: "accepted",
        providerLetterId: "ltr_timeout",
      });
      expect(timeoutSpy).toHaveBeenCalledOnce();
      expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("finds an accepted letter through Lob's exact metadata filter", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe(
        "https://api.lob.com/v1/letters?limit=2&metadata%5Bmurph_physical_note_id%5D=hpn_lookup",
      );
      expect(request.method).toBe("GET");
      expect(request.headers.get("authorization")).toMatch(/^Basic /u);
      expect(request.headers.get("Lob-Version")).toBe("2024-01-01");
      expect(init?.body).toBeUndefined();
      expect(init?.redirect).toBe("error");
      return Response.json({
        data: [{ id: "ltr_lookup" }],
      });
    });
    const runtime = createLobPhysicalNoteRuntime({
      apiKey: "test_key",
      fetchImpl,
      fromAddressId: "adr_from",
    });

    await expect(runtime.findLetterByNoteId({
      noteId: "hpn_lookup",
    })).resolves.toEqual({
      kind: "accepted",
      providerLetterId: "ltr_lookup",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("treats a valid empty Lob metadata result as definitively absent", async () => {
    const runtime = createLobPhysicalNoteRuntime({
      apiKey: "test_key",
      fetchImpl: vi.fn<typeof fetch>(async () => Response.json({ data: [] })),
      fromAddressId: "adr_from",
    });

    await expect(runtime.findLetterByNoteId({
      noteId: "hpn_absent",
    })).resolves.toEqual({ kind: "absent" });
  });

  it("keeps multiple Lob metadata matches indeterminate", async () => {
    const runtime = createLobPhysicalNoteRuntime({
      apiKey: "test_key",
      fetchImpl: vi.fn<typeof fetch>(async () => Response.json({
        data: [{ id: "ltr_first" }, { id: "ltr_second" }],
      })),
      fromAddressId: "adr_from",
    });

    await expect(runtime.findLetterByNoteId({
      noteId: "hpn_multiple",
    })).resolves.toEqual({ kind: "indeterminate" });
  });

  it("uses the short lookup-only provider deadline", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.signal).toBe(timeoutSpy.mock.results[0]?.value);
      return Response.json({ data: [] });
    });
    const runtime = createLobPhysicalNoteRuntime({
      apiKey: "test_key",
      fetchImpl,
      fromAddressId: "adr_from",
    });

    try {
      await expect(runtime.findLetterByNoteId({
        noteId: "hpn_short_timeout",
      })).resolves.toEqual({ kind: "absent" });
      expect(timeoutSpy).toHaveBeenCalledOnce();
      expect(timeoutSpy).toHaveBeenCalledWith(5_000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("keeps failed and malformed Lob metadata lookups indeterminate", async () => {
    const responses: Array<() => Promise<Response>> = [
      async () => {
        throw new Error("network unavailable");
      },
      async () => new Response(JSON.stringify({
        error: { message: "provider lookup detail" },
      }), {
        headers: { "content-type": "application/json" },
        status: 503,
      }),
      async () => Response.json({ data: [{ object: "letter" }] }),
    ];

    for (const response of responses) {
      const fetchImpl = vi.fn<typeof fetch>(response);
      const runtime = createLobPhysicalNoteRuntime({
        apiKey: "test_key",
        fetchImpl,
        fromAddressId: "adr_from",
      });
      await expect(runtime.findLetterByNoteId({
        noteId: "hpn_indeterminate",
      })).resolves.toEqual({ kind: "indeterminate" });
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it("keeps a timed-out Lob metadata lookup indeterminate", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason);
        }, { once: true });
      })
    );
    const runtime = createLobPhysicalNoteRuntime({
      apiKey: "test_key",
      fetchImpl,
      fromAddressId: "adr_from",
    });

    await expect(runtime.findLetterByNoteId({
      noteId: "hpn_timeout",
      signal: AbortSignal.timeout(1),
    })).resolves.toEqual({ kind: "indeterminate" });
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
