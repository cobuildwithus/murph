import { describe, expect, it } from "vitest";

import {
  HostedBrowserVaultReplicaTooLargeError,
  encodeHostedBrowserVaultReplicaJson,
} from "../src/browser-vault-limits.ts";

describe("browser-vault replica limits", () => {
  it("rejects replicas that exceed the configured byte budget", () => {
    expect(() =>
      encodeHostedBrowserVaultReplicaJson({
        maxBytes: 8,
        replica: {
          value: "larger than eight bytes",
        },
      })
    ).toThrow(HostedBrowserVaultReplicaTooLargeError);
  });
});
