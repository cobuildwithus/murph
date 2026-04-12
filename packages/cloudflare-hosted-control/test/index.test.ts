import { describe, expect, it } from "vitest";

import * as cloudflareHostedControl from "@murphai/cloudflare-hosted-control";
import { createCloudflareHostedControlClient } from "../src/client.ts";
import {
  parseCloudflareHostedManagedUserCryptoStatus,
  parseCloudflareHostedUserEnvStatus,
  parseCloudflareHostedUserEnvUpdate,
} from "../src/parsers.ts";
import {
  buildCloudflareHostedControlPendingUsageUsersPath,
  buildCloudflareHostedControlSharePackPath,
  buildCloudflareHostedControlUserCryptoContextPath,
  buildCloudflareHostedControlUserDispatchPayloadPath,
  buildCloudflareHostedControlUserEventStatusPath,
  buildCloudflareHostedControlUserEnvPath,
  buildCloudflareHostedControlUserPendingUsagePath,
  buildCloudflareHostedControlUserRunPath,
  buildCloudflareHostedControlUserStatusPath,
  buildCloudflareHostedControlUserStoredDispatchPath,
} from "../src/routes.ts";

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
    expect(Object.keys(cloudflareHostedControl).sort()).toEqual([
      "buildCloudflareHostedControlPendingUsageUsersPath",
      "buildCloudflareHostedControlSharePackPath",
      "buildCloudflareHostedControlUserCryptoContextPath",
      "buildCloudflareHostedControlUserDispatchPayloadPath",
      "buildCloudflareHostedControlUserEnvPath",
      "buildCloudflareHostedControlUserEventStatusPath",
      "buildCloudflareHostedControlUserPendingUsagePath",
      "buildCloudflareHostedControlUserRunPath",
      "buildCloudflareHostedControlUserStatusPath",
      "buildCloudflareHostedControlUserStoredDispatchPath",
      "createCloudflareHostedControlClient",
      "parseCloudflareHostedManagedUserCryptoStatus",
      "parseCloudflareHostedUserEnvStatus",
      "parseCloudflareHostedUserEnvUpdate",
    ]);
    expect(cloudflareHostedControl.buildCloudflareHostedControlUserCryptoContextPath).toBe(
      buildCloudflareHostedControlUserCryptoContextPath,
    );
    expect(cloudflareHostedControl.buildCloudflareHostedControlUserDispatchPayloadPath).toBe(
      buildCloudflareHostedControlUserDispatchPayloadPath,
    );
    expect(cloudflareHostedControl.buildCloudflareHostedControlUserEnvPath).toBe(
      buildCloudflareHostedControlUserEnvPath,
    );
    expect(cloudflareHostedControl.buildCloudflareHostedControlUserPendingUsagePath).toBe(
      buildCloudflareHostedControlUserPendingUsagePath,
    );
    expect(cloudflareHostedControl.buildCloudflareHostedControlUserEventStatusPath).toBe(
      buildCloudflareHostedControlUserEventStatusPath,
    );
    expect(cloudflareHostedControl.buildCloudflareHostedControlPendingUsageUsersPath).toBe(
      buildCloudflareHostedControlPendingUsageUsersPath,
    );
    expect(cloudflareHostedControl.buildCloudflareHostedControlSharePackPath).toBe(
      buildCloudflareHostedControlSharePackPath,
    );
    expect(cloudflareHostedControl.buildCloudflareHostedControlUserStatusPath).toBe(
      buildCloudflareHostedControlUserStatusPath,
    );
    expect(cloudflareHostedControl.buildCloudflareHostedControlUserStoredDispatchPath).toBe(
      buildCloudflareHostedControlUserStoredDispatchPath,
    );
    expect(cloudflareHostedControl.parseCloudflareHostedManagedUserCryptoStatus).toBe(
      parseCloudflareHostedManagedUserCryptoStatus,
    );
    expect(cloudflareHostedControl.parseCloudflareHostedUserEnvStatus).toBe(
      parseCloudflareHostedUserEnvStatus,
    );
    expect("default" in cloudflareHostedControl).toBe(false);
  });
});
