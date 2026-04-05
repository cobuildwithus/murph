import { describe, expect, it } from "vitest";

import {
  createHostedUserRootKeyEnvelope,
  generateHostedUserRecipientKeyPair,
  parseHostedUserRootKeyEnvelope,
} from "../src/hosted-user-keys.ts";

describe("parseHostedUserRootKeyEnvelope", () => {
  it("rejects duplicate recipient kinds", async () => {
    const automation = await generateHostedUserRecipientKeyPair();
    const { envelope } = await createHostedUserRootKeyEnvelope({
      recipients: [
        {
          keyId: "automation:v1",
          kind: "automation",
          publicKeyJwk: automation.publicKeyJwk,
        },
      ],
      userId: "user-1",
    });

    expect(() =>
      parseHostedUserRootKeyEnvelope({
        ...envelope,
        recipients: [envelope.recipients[0], envelope.recipients[0]],
      }),
    ).toThrow(/duplicate automation recipients/u);
  });
});
