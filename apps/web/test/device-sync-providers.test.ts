import { describe, expect, it } from "vitest";

import { createConfiguredDeviceSyncProviders } from "@murphai/device-syncd/config";

import { createHostedDeviceSyncRegistry } from "@/src/lib/device-sync/providers";

describe("createHostedDeviceSyncRegistry", () => {
  it("matches the shared configured-provider registry assembly path", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      GARMIN_CLIENT_ID: "garmin-client",
      GARMIN_CLIENT_SECRET: "garmin-secret",
      WHOOP_CLIENT_ID: "whoop-client",
      WHOOP_CLIENT_SECRET: "whoop-secret",
      OURA_CLIENT_ID: "oura-client",
      OURA_CLIENT_SECRET: "oura-secret",
    };

    const hostedProviders = createHostedDeviceSyncRegistry(env).list().map((provider) => provider.provider);
    const sharedProviders = createConfiguredDeviceSyncProviders(env).map((provider) => provider.provider);

    expect(hostedProviders).toEqual(sharedProviders);
    expect(hostedProviders).toEqual(["garmin", "whoop", "oura"]);
  });
});
