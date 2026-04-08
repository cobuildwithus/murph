import { describe, expect, expectTypeOf, it } from "vitest";

import * as cloudflareHostedControl from "@murphai/cloudflare-hosted-control";
import type {
  CloudflareHostedManagedUserCryptoStatus as BarrelCloudflareHostedManagedUserCryptoStatus,
  CloudflareHostedUserEnvStatus as BarrelCloudflareHostedUserEnvStatus,
  CloudflareHostedUserEnvUpdate as BarrelCloudflareHostedUserEnvUpdate,
} from "@murphai/cloudflare-hosted-control";
import type {
  CloudflareHostedManagedUserCryptoStatus,
  CloudflareHostedUserEnvStatus,
  CloudflareHostedUserEnvUpdate,
} from "../src/contracts.ts";

describe("@murphai/cloudflare-hosted-control barrel contracts seam", () => {
  it("keeps contracts as a type-only runtime seam", () => {
    expect("CloudflareHostedUserEnvStatus" in cloudflareHostedControl).toBe(false);
    expect("CloudflareHostedUserEnvUpdate" in cloudflareHostedControl).toBe(false);
    expect("CloudflareHostedManagedUserCryptoStatus" in cloudflareHostedControl).toBe(false);
  });

  it("re-exports the contract interfaces without changing their shapes", () => {
    expectTypeOf<BarrelCloudflareHostedManagedUserCryptoStatus>().toEqualTypeOf<CloudflareHostedManagedUserCryptoStatus>();
    expectTypeOf<BarrelCloudflareHostedUserEnvStatus>().toEqualTypeOf<CloudflareHostedUserEnvStatus>();
    expectTypeOf<BarrelCloudflareHostedUserEnvUpdate>().toEqualTypeOf<CloudflareHostedUserEnvUpdate>();
  });
});
