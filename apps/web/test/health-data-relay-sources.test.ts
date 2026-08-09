import { describe, expect, it } from "vitest";

import {
  HEALTH_DATA_RELAY_SOURCE_IDS,
  HEALTH_DATA_RELAY_SOURCE_UI,
  listHealthDataRelayConnectSources,
} from "../app/(dashboard)/connect/health-data-relay-sources";

describe("health data relay source catalog", () => {
  it("keeps every vendor setup-only and points to the matching Murph app", () => {
    expect(HEALTH_DATA_RELAY_SOURCE_IDS).toEqual([
      "health-connect",
      "samsung-health",
      "mobvoi-health",
      "wyze-scale",
      "eufy-life",
      "vesync-etekcity",
      "ad-heart-track",
      "microlife-connected-health",
    ]);

    const sources = listHealthDataRelayConnectSources();
    expect(sources).toHaveLength(HEALTH_DATA_RELAY_SOURCE_IDS.length);

    for (const source of sources) {
      expect(source.connectTarget).toBeUndefined();
      expect(source.connected).toBeUndefined();
      expect(source.setupGuideId).toBeUndefined();
      expect(source.unavailableActionLabel).toBe("Download app");
      expect(source.unavailableMessage).toBeTruthy();
      expect(source.logo.src).toBe(
        "/brand-logos/connect/wearable-relay.svg",
      );
    }

    for (const id of [
      "health-connect",
      "samsung-health",
      "mobvoi-health",
    ] as const) {
      expect(HEALTH_DATA_RELAY_SOURCE_UI[id].unavailableActionUrl).toBe(
        "https://play.google.com/store/apps/details?id=ai.withmurph.app",
      );
    }

    for (const id of [
      "wyze-scale",
      "eufy-life",
      "vesync-etekcity",
      "ad-heart-track",
      "microlife-connected-health",
    ] as const) {
      expect(HEALTH_DATA_RELAY_SOURCE_UI[id].unavailableActionUrl).toBe(
        "https://apps.apple.com/us/app/murph-ai/id6786145859",
      );
    }
  });
});
