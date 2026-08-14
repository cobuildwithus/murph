import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const NATURAL_AUDIENCE_OWNER_DOC_URLS = [
  new URL("../../../ARCHITECTURE.md", import.meta.url),
  new URL("../../../agent-docs/SECURITY.md", import.meta.url),
  new URL("../../../agent-docs/RELIABILITY.md", import.meta.url),
];
const PROTOCOL_OWNER_DOC_URLS = [
  ...NATURAL_AUDIENCE_OWNER_DOC_URLS,
  new URL(
    "../../../agent-docs/product-specs/consented-group-disclosure.md",
    import.meta.url,
  ),
  new URL(
    "../../../agent-docs/references/hosted-runtime-protocol.md",
    import.meta.url,
  ),
];

describe("current-sender durable contract", () => {
  it("keeps natural audience inference and causal clarification in every owner doc", () => {
    for (const url of NATURAL_AUDIENCE_OWNER_DOC_URLS) {
      const ownerDoc = readFileSync(url, "utf8");

      expect(ownerDoc).toMatch(/model infer(?:s|red)\s+group, private/iu);
      expect(ownerDoc).toMatch(/causally monotonic/iu);
      expect(ownerDoc).not.toMatch(/deterministic [“"]ask my Murph[”"] command/iu);
      expect(ownerDoc).not.toMatch(/group is the (?:fixed )?default/iu);
    }
  });

  it("keeps one current-sender read target separate from result delivery", () => {
    for (const url of PROTOCOL_OWNER_DOC_URLS) {
      const ownerDoc = readFileSync(url, "utf8");

      expect(ownerDoc).toMatch(/current_sender_personal/u);
      expect(ownerDoc).toMatch(/result\s+destination/iu);
      expect(ownerDoc).toMatch(/stateful\s+dynamic-tool/iu);
      expect(ownerDoc).toMatch(/provider\s+request\s+order/iu);
    }
  });

  it("keeps one turn-local decision per exact current-sender ref", () => {
    for (const url of PROTOCOL_OWNER_DOC_URLS) {
      const ownerDoc = readFileSync(url, "utf8");

      expect(ownerDoc).toMatch(/turn-local\s+decision\s+claim/iu);
      expect(ownerDoc).toMatch(/in-flight\s+notice/iu);
      expect(ownerDoc).toMatch(
        /different exact refs[\s\S]{0,80}concurrent/iu,
      );
      expect(ownerDoc).toMatch(
        /canonical\s+exact-source\s+request\s+identity/iu,
      );
    }
  });

  it("keeps private and group terminal effects mutually exclusive across retry", () => {
    for (const url of PROTOCOL_OWNER_DOC_URLS) {
      const ownerDoc = readFileSync(url, "utf8");

      expect(ownerDoc).toMatch(
        /fallback[\s\S]{0,320}(?:recovered|recovery|supersed)/iu,
      );
      expect(ownerDoc).toMatch(
        /(?:expired[\s\S]{0,260}(?:private|effect)|(?:private|effect)[\s\S]{0,260}expired)/iu,
      );
    }
  });
});
