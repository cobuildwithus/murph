import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const productSpec = readFileSync(
  new URL(
    "../../../agent-docs/product-specs/hosted-usage-topups.md",
    import.meta.url,
  ),
  "utf8",
);
const normalizedProductSpec = productSpec.replace(/\s+/gu, " ");

describe("hosted usage-credit durable product contract", () => {
  it("owns the current monthly-primary and one-time-secondary truth", () => {
    expect(normalizedProductSpec).toContain(
      "capped monthly sponsorship as the primary choice",
    );
    expect(normalizedProductSpec).toContain(
      "one-time contribution as the secondary choice",
    );
    expect(normalizedProductSpec).toMatch(
      /activation and automatic refills are ordinary exact \$5 purchases/iu,
    );
    expect(normalizedProductSpec).toMatch(
      /post-settlement usage path.*never calls Stripe or waits for payment/iu,
    );
    expect(normalizedProductSpec).toMatch(
      /Stripe event reconciliation is the only authority.*grants the \$5/iu,
    );
    expect(normalizedProductSpec).toContain(
      "unused credit",
    );
    expect(normalizedProductSpec).toMatch(
      /private monthly maximum never changes the public acknowledgment or creates a running bit/iu,
    );
  });

  it("rejects obsolete message-pack and reply-path refill promises", () => {
    expect(productSpec).not.toMatch(/100\s*\/\s*200\s*\/\s*400/iu);
    expect(productSpec).not.toMatch(/(?:100|200|400)[- ]message/iu);
    expect(productSpec).not.toMatch(/recurring refill is out of scope/iu);
    expect(productSpec).not.toMatch(/approximately?\s+\d+\s+messages/iu);
    expect(productSpec).not.toMatch(/\$0\.05\s+(?:per|a)\s+message/iu);
  });
});
