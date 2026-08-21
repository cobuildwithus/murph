import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  createHostedEmailGroupReplyAliasRoute,
  createHostedEmailUserReplyAliasRoute,
  HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
} from "@murphai/hosted-execution/hosted-email";

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

async function createReplyAliasRegistrationResponse(input: {
  config: ReturnType<typeof createHostedEmailTestConfig>;
  userId: string;
}): Promise<Response> {
  const route = await createHostedEmailUserReplyAliasRoute({
    domain: input.config.domain,
    localPart: input.config.localPart,
    signingSecret: input.config.signingSecret,
    userId: input.userId,
  });
  return new Response(JSON.stringify({
    address: route.address,
    aliasKey: route.aliasKey,
    ok: true,
  }), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status: 200,
  });
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

  it("uses the Web-owned current alias before returning the reply address", async () => {
    const config = createHostedEmailTestConfig();
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValue(
      await createReplyAliasRegistrationResponse({ config, userId: "user-123" }),
    );

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

  it("resolves signed group reply aliases through web-owned sender lookup and exposes group identity", async () => {
    const config = createHostedEmailTestConfig();
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValueOnce(new Response(
      JSON.stringify({
        userId: "group-runtime-member",
      }),
      {
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
        status: 200,
      },
    ));
    const route = await createHostedEmailGroupReplyAliasRoute({
      domain: config.domain,
      groupId: "hgrp_AAAAAAAAAAAAAAAA",
      localPart: config.localPart,
      signingSecret: config.signingSecret,
    });

    await expect(resolveHostedEmailInboundRoute({
      config,
      envelopeFrom: "member@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Member <member@example.com>",
      to: route.address,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).resolves.toEqual({
      authorization: "signed-reply-alias",
      groupId: "hgrp_AAAAAAAAAAAAAAAA",
      identityId: "murph@reply.example.com",
      routeAddress: route.address,
      userId: "group-runtime-member",
    });

    const resolveCall = webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mock.calls[0]?.[0];
    expect(JSON.parse(String(resolveCall?.body))).toEqual({
      envelopeFrom: "member@example.com",
      groupId: "hgrp_AAAAAAAAAAAAAAAA",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Member <member@example.com>",
    });
  });

  it("routes signed group reply alias misses through web-owned From matching without sender-auth proof", async () => {
    const config = createHostedEmailTestConfig();
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mockResolvedValueOnce(new Response(
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
    const route = await createHostedEmailGroupReplyAliasRoute({
      domain: config.domain,
      groupId: "hgrp_AAAAAAAAAAAAAAAA",
      localPart: config.localPart,
      signingSecret: config.signingSecret,
    });

    await expect(resolveHostedEmailInboundRoute({
      config,
      authenticatedSender: null,
      envelopeFrom: "member@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Member <member@example.com>",
      to: route.address,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).resolves.toBeNull();

    const resolveCall = webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mock.calls[0]?.[0];
    expect(JSON.parse(String(resolveCall?.body))).toEqual({
      envelopeFrom: "member@example.com",
      groupId: "hgrp_AAAAAAAAAAAAAAAA",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Member <member@example.com>",
    });
  });

  it("rejects tampered signed group reply aliases before the web alias lookup", async () => {
    const config = createHostedEmailTestConfig();
    const route = await createHostedEmailGroupReplyAliasRoute({
      domain: config.domain,
      groupId: "hgrp_AAAAAAAAAAAAAAAA",
      localPart: config.localPart,
      signingSecret: config.signingSecret,
    });
    const tamperedAddress = route.address.replace("g2-", "g2-rgroup_123-");

    await expect(resolveHostedEmailInboundRoute({
      config,
      authenticatedSender: null,
      envelopeFrom: "member@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Member <member@example.com>",
      to: tamperedAddress,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).resolves.toBeNull();

    expect(webControlPlane.fetchHostedExecutionWebControlPlaneResponse).not.toHaveBeenCalled();
  });

  it("uses the current configured sender identity when resolving inbound reply aliases through web-owned lookup", async () => {
    const createConfig = createHostedEmailTestConfig();
    const resolveConfig = {
      ...createConfig,
      fromAddress: "current@reply.example.com",
    };

    webControlPlane.fetchHostedExecutionWebControlPlaneResponse
      .mockResolvedValueOnce(await createReplyAliasRegistrationResponse({
        config: createConfig,
        userId: "user-123",
      }))
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
      authorization: "signed-reply-alias",
      groupId: null,
      identityId: "current@reply.example.com",
      routeAddress: address,
      userId: "user-123",
    });
  });

  it("resolves signed reply aliases without requiring an authenticated sender verdict", async () => {
    const config = createHostedEmailTestConfig();
    webControlPlane.fetchHostedExecutionWebControlPlaneResponse
      .mockResolvedValueOnce(await createReplyAliasRegistrationResponse({
        config,
        userId: "user-123",
      }))
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
      config,
      userId: "user-123",
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    });

    await expect(resolveHostedEmailInboundRoute({
      config,
      authenticatedSender: null,
      envelopeFrom: "owner@example.com",
      hasRepeatedHeaderFrom: false,
      headerFrom: "Owner <owner@example.com>",
      to: address,
      webCallbackSigning: TEST_CALLBACK_SIGNING,
      webControlBaseUrl: "https://web.example.test",
    })).resolves.toEqual({
      authorization: "signed-reply-alias",
      groupId: null,
      identityId: "murph@reply.example.com",
      routeAddress: address,
      userId: "user-123",
    });

    const resolveCall = webControlPlane.fetchHostedExecutionWebControlPlaneResponse.mock.calls[1]?.[0];
    expect(resolveCall).toEqual(expect.objectContaining({
      body: expect.any(String),
    }));
    const aliasResolveBody = JSON.parse(String(resolveCall?.body));
    expect(aliasResolveBody).toMatchObject({
      aliasKey: expect.any(String),
    });
    expect(aliasResolveBody).not.toHaveProperty("authenticatedSender");
    expect(aliasResolveBody).not.toHaveProperty("envelopeFrom");
    expect(aliasResolveBody).not.toHaveProperty("hasRepeatedHeaderFrom");
    expect(aliasResolveBody).not.toHaveProperty("headerFrom");
  });

  it("returns null when the web-owned alias lookup misses", async () => {
    const config = createHostedEmailTestConfig();

    webControlPlane.fetchHostedExecutionWebControlPlaneResponse
      .mockResolvedValueOnce(await createReplyAliasRegistrationResponse({
        config,
        userId: "user-123",
      }))
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
