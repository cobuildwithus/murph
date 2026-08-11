import { describe, expect, it } from "vitest";

import {
  buildDeviceProviderApplicationRuntimeConfigs,
  parseDeviceProviderApplicationSecret,
} from "@/src/lib/device-sync/provider-applications/types";

describe("member-owned device provider application secrets", () => {
  it("normalizes a strict Strava client secret and builds runtime config", () => {
    const secret = parseDeviceProviderApplicationSecret({
      expectedProvider: "strava",
      value: {
        schema: "murph.device-provider-application.strava.v1",
        clientId: "  member-client  ",
        clientSecret: "  member-secret  ",
      },
    });

    expect(secret).toEqual({
      schema: "murph.device-provider-application.strava.v1",
      clientId: "member-client",
      clientSecret: "member-secret",
    });
    expect(buildDeviceProviderApplicationRuntimeConfigs({
      provider: "strava",
      secret,
    })).toEqual({
      strava: {
        clientId: "member-client",
        clientSecret: "member-secret",
      },
    });
  });

  it("rejects unknown and missing secret fields", () => {
    expect(() => parseDeviceProviderApplicationSecret({
      expectedProvider: "strava",
      value: {
        schema: "murph.device-provider-application.strava.v1",
        clientId: "member-client",
        clientSecret: "member-secret",
        accessToken: "must-not-be-stored-here",
      },
    })).toThrow(/accessToken/u);

    expect(() => parseDeviceProviderApplicationSecret({
      expectedProvider: "strava",
      value: {
        schema: "murph.device-provider-application.strava.v1",
        clientId: "member-client",
      },
    })).toThrow(/clientSecret/u);
  });
});
