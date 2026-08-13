import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const OWNER_DOC_URLS = [
  new URL("../../../ARCHITECTURE.md", import.meta.url),
  new URL("../../../agent-docs/SECURITY.md", import.meta.url),
  new URL("../../../agent-docs/RELIABILITY.md", import.meta.url),
];

describe("current-sender durable contract", () => {
  it("keeps natural audience inference and causal clarification in every owner doc", () => {
    for (const url of OWNER_DOC_URLS) {
      const ownerDoc = readFileSync(url, "utf8");

      expect(ownerDoc).toMatch(/model infer(?:s|red)\s+group, private/iu);
      expect(ownerDoc).toMatch(/causally monotonic/iu);
      expect(ownerDoc).not.toMatch(/deterministic [“"]ask my Murph[”"] command/iu);
      expect(ownerDoc).not.toMatch(/group is the (?:fixed )?default/iu);
    }
  });
});
