import { describe, expect, it } from "vitest";

import { buildHostedStorageAad } from "../src/crypto-context.ts";
import { readEncryptedR2Json, writeEncryptedR2Json } from "../src/crypto.ts";
import { parseHostedEmailRouteCandidate } from "../src/hosted-email/route-addressing.ts";
import { parseHostedEmailRouteToken } from "../src/hosted-email/route-crypto.ts";
import {
  createHostedEmailUserAddress,
  resolveHostedEmailInboundRoute,
} from "../src/hosted-email/routes.ts";

import { MemoryEncryptedR2Bucket } from "./test-helpers.js";

class TrackingMemoryEncryptedR2Bucket extends MemoryEncryptedR2Bucket {
  lastPutKey: string | null = null;

  override async put(key: string, value: string): Promise<void> {
    this.lastPutKey = key;
    await super.put(key, value);
  }
}

function createHostedEmailTestConfig() {
  return {
    defaultSubject: "Murph update",
    domain: "Reply.Example.COM",
    fromAddress: "Murph@Reply.Example.COM",
    localPart: "Murph",
    signingSecret: "signing-secret",
  };
}

describe("hosted email route storage", () => {
  it("stores owner-only reply aliases without redundant sender identity state", async () => {
    const bucket = new TrackingMemoryEncryptedR2Bucket();
    const config = createHostedEmailTestConfig();
    const key = new Uint8Array(32).fill(7);
    const keyId = "route:v1";
    const userId = "user-123";

    const address = await createHostedEmailUserAddress({
      bucket,
      config,
      key,
      keyId,
      userId,
    });
    const candidate = parseHostedEmailRouteCandidate(address, config);

    expect(candidate).not.toBeNull();

    const parsedToken = await parseHostedEmailRouteToken({
      secret: config.signingSecret,
      token: candidate!.detail,
    });

    expect(parsedToken).not.toBeNull();
    expect(bucket.lastPutKey).not.toBeNull();

    const stored = await readEncryptedR2Json<Record<string, unknown>>({
      aad: buildHostedStorageAad({
        aliasKey: parsedToken!.aliasKey,
        key: bucket.lastPutKey!,
        purpose: "email-route",
        routeKind: "user",
      }),
      bucket,
      cryptoKey: key,
      expectedKeyId: keyId,
      key: bucket.lastPutKey!,
      parse(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new TypeError("Hosted email route record must be an object.");
        }

        return value as Record<string, unknown>;
      },
      scope: "email-route",
    });

    expect(stored).toEqual({
      schema: "murph.hosted-email-user-route.v2",
      userId,
    });

    const route = await resolveHostedEmailInboundRoute({
      bucket,
      config,
      key,
      keyId,
      to: `Murph+${candidate!.detail}@Reply.Example.COM`,
    });

    expect(route).toEqual({
      authorization: "verified-email",
      identityId: "murph@reply.example.com",
      routeAddress: address,
      userId,
    });
  });

  it("uses the current configured sender identity when resolving inbound reply aliases", async () => {
    const bucket = new TrackingMemoryEncryptedR2Bucket();
    const createConfig = createHostedEmailTestConfig();
    const resolveConfig = {
      ...createConfig,
      fromAddress: "current@reply.example.com",
    };
    const key = new Uint8Array(32).fill(7);
    const keyId = "route:v1";
    const userId = "user-123";

    const address = await createHostedEmailUserAddress({
      bucket,
      config: createConfig,
      key,
      keyId,
      userId,
    });
    const candidate = parseHostedEmailRouteCandidate(address, createConfig);

    expect(candidate).not.toBeNull();
    const parsedToken = await parseHostedEmailRouteToken({
      secret: createConfig.signingSecret,
      token: candidate!.detail,
    });

    expect(parsedToken).not.toBeNull();
    expect(bucket.lastPutKey).not.toBeNull();

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        aliasKey: parsedToken!.aliasKey,
        key: bucket.lastPutKey!,
        purpose: "email-route",
        routeKind: "user",
      }),
      bucket,
      cryptoKey: key,
      key: bucket.lastPutKey!,
      keyId,
      scope: "email-route",
      value: {
        schema: "murph.hosted-email-user-route.v2",
        userId,
      },
    });

    await expect(resolveHostedEmailInboundRoute({
      bucket,
      config: resolveConfig,
      key,
      keyId,
      to: `Murph+${candidate!.detail}@Reply.Example.COM`,
    })).resolves.toEqual({
      authorization: "verified-email",
      identityId: "current@reply.example.com",
      routeAddress: address,
      userId,
    });
  });

  it("rejects legacy v1 reply-alias records instead of accepting them", async () => {
    const bucket = new TrackingMemoryEncryptedR2Bucket();
    const config = createHostedEmailTestConfig();
    const key = new Uint8Array(32).fill(7);
    const keyId = "route:v1";
    const userId = "user-123";

    const address = await createHostedEmailUserAddress({
      bucket,
      config,
      key,
      keyId,
      userId,
    });
    const candidate = parseHostedEmailRouteCandidate(address, config);

    expect(candidate).not.toBeNull();
    const parsedToken = await parseHostedEmailRouteToken({
      secret: config.signingSecret,
      token: candidate!.detail,
    });

    expect(parsedToken).not.toBeNull();
    expect(bucket.lastPutKey).not.toBeNull();

    await writeEncryptedR2Json({
      aad: buildHostedStorageAad({
        aliasKey: parsedToken!.aliasKey,
        key: bucket.lastPutKey!,
        purpose: "email-route",
        routeKind: "user",
      }),
      bucket,
      cryptoKey: key,
      key: bucket.lastPutKey!,
      keyId,
      scope: "email-route",
      value: {
        schema: "murph.hosted-email-user-route.v1",
        senderIdentity: "legacy@reply.example.com",
        userId,
      },
    });

    await expect(resolveHostedEmailInboundRoute({
      bucket,
      config,
      key,
      keyId,
      to: `Murph+${candidate!.detail}@Reply.Example.COM`,
    })).rejects.toThrow("Hosted email user route schema is invalid.");
  });
});
