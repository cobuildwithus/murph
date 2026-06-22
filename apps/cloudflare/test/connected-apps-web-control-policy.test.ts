import { describe, expect, it } from "vitest";

import { HOSTED_CONNECTED_APPS_PATH } from "@murphai/hosted-execution/connected-apps";

import {
  readHostedRunnerWebControlPolicy,
} from "../src/runner-outbound/shared-web-control-policy.ts";

describe("connected-app web-control policy", () => {
  it("allows only the bounded POST route", () => {
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: HOSTED_CONNECTED_APPS_PATH,
    })).toEqual({
      allowed: true,
      operation: "connected_apps",
    });
    expect(readHostedRunnerWebControlPolicy({
      method: "GET",
      path: HOSTED_CONNECTED_APPS_PATH,
    }).allowed).toBe(false);
    expect(readHostedRunnerWebControlPolicy({
      method: "POST",
      path: "/api/internal/connected-apps/arbitrary",
    }).allowed).toBe(false);
  });
});
