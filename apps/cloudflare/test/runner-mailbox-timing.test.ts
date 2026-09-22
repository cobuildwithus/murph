import { describe, expect, it } from "vitest";
import { readMailboxWebTiming } from "../src/runner-outbound/mailbox-timing.ts";

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
