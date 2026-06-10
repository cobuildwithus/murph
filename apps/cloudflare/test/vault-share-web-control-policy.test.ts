import { describe, expect, it } from "vitest";

import { HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH } from "@murphai/hosted-execution/routes";

import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";

describe("vault-share web control policy", () => {
  it("allows POST to the vault-share deliver path as a dedicated operation", () => {
    const policy = readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
    });

    expect(policy).toEqual({
      allowed: true,
      operation: "vault_share_deliver",
    });
  });

  it("blocks GET on the vault-share deliver path", () => {
    const policy = readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_RUNTIME_VAULT_SHARE_DELIVER_PATH,
    });

    expect(policy.allowed).toBe(false);
  });
});
