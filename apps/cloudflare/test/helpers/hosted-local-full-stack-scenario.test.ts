import { describe, expect, it } from "vitest";

import {
  buildHostedLocalFullStackWebProcessEnvOverrides,
} from "./hosted-local-full-stack-scenario.js";

describe("hosted local full-stack web process environment", () => {
  it("gives the host web process loopback access to the shared Linq stub", () => {
    expect(buildHostedLocalFullStackWebProcessEnvOverrides({
      LINQ_API_BASE_URL: "http://host.docker.internal:4011/api/partner/v3",
    })).toEqual({
      LINQ_API_BASE_URL: "http://127.0.0.1:4011/api/partner/v3",
    });
  });

  it("does not replace a non-stub Linq origin", () => {
    expect(buildHostedLocalFullStackWebProcessEnvOverrides({
      LINQ_API_BASE_URL: "https://api.linqapp.com/api/partner/v3",
    })).toEqual({});
  });
});
