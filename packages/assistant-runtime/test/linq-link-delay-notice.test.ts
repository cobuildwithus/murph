import { expect, it } from "vitest";

import { buildHostedLinqLinkDelayNotice } from "../src/hosted-runtime/linq-link-delay-notice.ts";

it("varies delay notices across intents while keeping every replay stable", () => {
  const notices = new Set<string>();
  for (let index = 0; index < 1_000; index += 1) {
    const intentId = `synthetic_link_delivery_${index}`;
    const message = buildHostedLinqLinkDelayNotice(intentId);
    expect(buildHostedLinqLinkDelayNotice(intentId)).toBe(message);
    notices.add(message);
  }
  expect(notices.size).toBe(30);
  for (const message of notices) {
    expect(message.length).toBeLessThan(120);
    expect(message).toMatch(/\blink\b/i);
    expect(message).not.toMatch(/https?:|\b(?:seconds?|minutes?|outage|guaranteed)\b/i);
  }
});
