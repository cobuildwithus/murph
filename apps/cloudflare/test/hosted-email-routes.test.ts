import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH } from "@murphai/hosted-execution/hosted-email";

import { parseHostedEmailRouteCandidate } from "../src/hosted-email/route-addressing.ts";
import { parseHostedEmailRouteToken } from "../src/hosted-email/route-crypto.ts";
import {
  createHostedEmailUserAddress,
  resolveHostedEmailIngressRoute,
  resolveHostedEmailInboundRoute,
} from "../src/hosted-email/routes.ts";

const webControlPlane = vi.hoisted(() => ({
  fetchHostedExecutionWebControlPlaneResponse: vi.fn(),
}));

vi.mock("../src/web-control-plane.ts", async () => {
  const actual = await vi.importActual<typeof import("../src/web-control-plane.ts")>(
    "../src/web-control-plane.ts",
  );

  return {
    ...actual,
    fetchHostedExecutionWebControlPlaneResponse: webControlPlane.fetchHostedExecutionWebControlPlaneResponse,
  };
});

function createHostedEmailTestConfig() {
  return {
    defaultSubject: "Murph update",
    domain: "Reply.Example.COM",
    fromAddress: "Murph@Reply.Example.COM",
    localPart: "Murph",
    signingSecret: "signing-secret",
  };
}

const TEST_CALLBACK_SIGNING = {
  keyId: "v1",
  privateKeyJwkJson: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"x\",\"y\":\"y\",\"d\":\"d\"}",
};
const AUTHENTICATED_SENDER = {
  dkimAligned: false,
  dmarcPass: true,
  spfAligned: false,
};

describe("hosted email route callbacks", () => {
  beforeEach(() => {
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers the stable alias key in web before returning the reply address", async () => {
    const config = createHostedEmailTestConfig();
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(new Response(
      JSON.stringify({ ok: true }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));

    const address = await createHostedEmailUserAddress({
      config,
      userId: "user-123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    });
    const candidate = parseHostedEmailRouteCandidate(address, config);

    expect(candidate).not.toBeNull();
    const parsedToken = await parseHostedEmailRouteToken({
      secret: config.signingSecret,
      token: candidate!.detail,
    });

    expect(parsedToken).not.toBeNull();
    expect(webControlPlane.fetchHostedExecutionWebControlPlaneResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://web.example.test",
        boundUserId: "user-123",
        method: "POST",
        path: HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
      }),
    );
  });

  it("uses the current configured sender identity when resolving inbound reply aliases through web-owned lookup", async () => {
    const createConfig = createHostedEmailTestConfig();
    const resolveConfig = {
      ...createConfig,
      fromAddress: "current@reply.example.com",
    };

    webControlPlane.fetchHostedExecutionWebControlPlaneResponse
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ ok: true }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          userId: "user-123",
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      ));

    const address = await createHostedEmailUserAddress({
      config: createConfig,
      userId: "user-123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(resolveHostedEmailInboundRoute({
      config: resolveConfig,
      authenticatedSender: AUTHENTICATED_SENDER,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      to: address,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).resolves.toEqual({
      authorization: "verified-email",
      identityId: "current@reply.example.com",
      routeAddress: address,
      userId: "user-123",
    });
  });

  it("returns null when the web-owned alias lookup misses", async () => {
    const config = createHostedEmailTestConfig();

    webControlPlane.fetchHostedExecutionWebControlPlaneResponse
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ ok: true }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          userId: null,
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 200,
        },
      ));

    const address = await createHostedEmailUserAddress({
      config,
      userId: "user-123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(resolveHostedEmailInboundRoute({
      config,
      authenticatedSender: AUTHENTICATED_SENDER,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      to: address,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).resolves.toBeNull();
  });

  it("returns null for public-sender ingress when the authenticated verdict is absent", async () => {
    const config = createHostedEmailTestConfig();

    await expect(resolveHostedEmailIngressRoute({
      config,
      authenticatedSender: null,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      to: config.fromAddress,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).resolves.toBeNull();

    expect(webControlPlane.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
  });
});
