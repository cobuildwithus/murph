import { describe, expect, it } from "vitest";

import * as cloudflareHostedControl from "@murphai/cloudflare-hosted-control";
import { createCloudflareHostedControlClient } from "../src/client.ts";
import { parseCloudflareHostedUserEnvUpdate } from "../src/parsers.ts";
import { buildCloudflareHostedControlUserRunPath } from "../src/routes.ts";

describe("src/index", () => {
  it("re-exports the package surface from the leaf modules", () => {
    expect(cloudflareHostedControl.createCloudflareHostedControlClient).toBe(
      createCloudflareHostedControlClient,
    );
    expect(cloudflareHostedControl.parseCloudflareHostedUserEnvUpdate).toBe(
      parseCloudflareHostedUserEnvUpdate,
    );
    expect(cloudflareHostedControl.buildCloudflareHostedControlUserRunPath).toBe(
      buildCloudflareHostedControlUserRunPath,
    );
    expect("default" in cloudflareHostedControl).toBe(false);
  });
});
