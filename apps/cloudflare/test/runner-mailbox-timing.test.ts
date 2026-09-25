import { describe, expect, it } from "vitest";
import { readMailboxWebTiming, readMailboxVercelRegions } from "../src/runner-outbound/mailbox-timing.ts";

describe("mailbox Web timing allowlist", () => {
  it.each([undefined, "", "x".repeat(2049)])("accepts missing or rejects oversized headers", (header) => {
    expect(readMailboxWebTiming(new Response(null, {
      headers: header ? { "server-timing": header } : {},
    }))).toEqual({});
  });
  it("keeps only bounded numeric durations with known internal names", () => {
    const response = new Response(null, { headers: { "server-timing": [
      "murph_mailbox_auth;dur=0", " murph_mailbox_projection;dur=850 ",
      "murph_mailbox_total;dur=600001", "murph_mailbox_crypto;dur=-1",
      "murph_mailbox_access;dur=NaN", "murph_mailbox_group;dur=1;desc=private",
      "murph_mailbox_constructor;dur=2", "murph_mailbox_unknown;dur=3",
    ].join(",") } });
    expect(readMailboxWebTiming(response)).toEqual({ mailboxWebAuthMs: 0, mailboxWebProjectionMs: 850 });
  });
});

describe("mailbox platform regions", () => {
  it.each(["iad1", "sfo1::iad1"])("retains only the region path %s", (regions) => {
    expect(readMailboxVercelRegions(new Response(null, { headers: {
      "x-vercel-id": `${regions}::synthetic-request-123`,
    } }))).toEqual({ mailboxVercelRegions: regions });
  });
  it.each(["", "private-value", "iad1::private value", "iad1::", "IAD1::synthetic",
    "iad1::sfo1::fra1::lhr1::cdg1::synthetic", "iad1::" + "x".repeat(257)])(
    "omits malformed or oversized platform metadata", (header) => {
      expect(readMailboxVercelRegions(new Response(null, { headers: { "x-vercel-id": header } }))).toEqual({});
    },
  );
  it("accepts old responses without region metadata", () => {
    expect(readMailboxVercelRegions(new Response(null))).toEqual({});
  });
});
