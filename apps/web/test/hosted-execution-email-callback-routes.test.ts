import { Buffer } from "node:buffer";

import { HostedBillingStatus } from "@prisma/client";
import {
  encodeHostedExecutionSignedRequestPayload,
} from "@murphai/hosted-execution/auth";
import {
  HOSTED_EXECUTION_NONCE_HEADER,
  HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER,
  HOSTED_EXECUTION_SIGNATURE_HEADER,
  HOSTED_EXECUTION_TIMESTAMP_HEADER,
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import {
  HOSTED_EMAIL_GROUP_RECIPIENTS_CALLBACK_PATH,
  HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
  HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
  HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
} from "@murphai/hosted-execution/hosted-email";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  lookupHostedMemberByVerifiedEmailAddress: vi.fn(),
  readHostedMemberEmailAuthorization: vi.fn(),
  readHostedMemberIdByAuthorizedDirectPublicSenderAddress: vi.fn(),
  readHostedMemberIdByReplyAliasLookupKey: vi.fn(),
  readHostedGroupEmailRecipients: vi.fn(),
  upsertHostedMemberReplyAliasLookupKeyTx: vi.fn(),
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/src/lib/hosted-onboarding/hosted-member-store", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/hosted-onboarding/hosted-member-store")>(
    "../src/lib/hosted-onboarding/hosted-member-store",
  );

  return {
    ...actual,
    lookupHostedMemberByVerifiedEmailAddress: mocks.lookupHostedMemberByVerifiedEmailAddress,
    readHostedMemberEmailAuthorization: mocks.readHostedMemberEmailAuthorization,
    readHostedMemberIdByAuthorizedDirectPublicSenderAddress:
      mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress,
  };
});

vi.mock("@/src/lib/hosted-onboarding/hosted-member-routing-store", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/hosted-onboarding/hosted-member-routing-store")>(
    "../src/lib/hosted-onboarding/hosted-member-routing-store",
  );

  return {
    ...actual,
    readHostedMemberIdByReplyAliasLookupKey: mocks.readHostedMemberIdByReplyAliasLookupKey,
    upsertHostedMemberReplyAliasLookupKeyTx: mocks.upsertHostedMemberReplyAliasLookupKeyTx,
  };
});

vi.mock("@/src/lib/hosted-groups/group-email", () => ({
  readHostedGroupEmailRecipients:
    mocks.readHostedGroupEmailRecipients,
}));

type GroupRecipientsRouteModule = typeof import(
  "../app/api/internal/hosted-execution/email/group-recipients/route"
);

type RegisterReplyAliasRouteModule = typeof import(
  "../app/api/internal/hosted-execution/email/register-reply-alias/route"
);
type ResolveRouteModule = typeof import(
  "../app/api/internal/hosted-execution/email/resolve-route/route"
);

type MockPrismaClient = ReturnType<typeof createPrismaMock>;

let groupRecipientsRoute: GroupRecipientsRouteModule;
let registerReplyAliasRoute: RegisterReplyAliasRouteModule;
let resolveRoute: ResolveRouteModule;
let currentPrivateJwkJson = "";
let prismaClient: MockPrismaClient;

const originalKeyId = process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID;
const originalPublicJwk = process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK;
const originalPublicKeyring = process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON;
const AUTHENTICATED_SENDER = {
  dkimAligned: false,
  dmarcPass: true,
  spfAligned: false,
};
const VALID_REPLY_ALIAS_KEY = "0123456789abcdef0123456789abcdef";

describe("hosted execution email callback routes", () => {
  beforeAll(async () => {
    groupRecipientsRoute = await import(
      "../app/api/internal/hosted-execution/email/group-recipients/route"
    );
    registerReplyAliasRoute = await import(
      "../app/api/internal/hosted-execution/email/register-reply-alias/route"
    );
    resolveRoute = await import(
      "../app/api/internal/hosted-execution/email/resolve-route/route"
    );
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaClient = createPrismaMock();
    mocks.getPrisma.mockReturnValue(prismaClient);
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue(null);
    mocks.readHostedMemberEmailAuthorization.mockResolvedValue(null);
    mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress.mockResolvedValue(null);
    mocks.readHostedMemberIdByReplyAliasLookupKey.mockResolvedValue(null);
    mocks.readHostedGroupEmailRecipients.mockResolvedValue({
      recipients: [],
      status: "ok",
    });
    mocks.upsertHostedMemberReplyAliasLookupKeyTx.mockResolvedValue(undefined);

    const keyPair = await crypto.subtle.generateKey(
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      true,
      ["sign", "verify"],
    );
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

    process.env.HOSTED_WEB_CALLBACK_SIGNING_KEY_ID = "v1";
    process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK = JSON.stringify(publicJwk);
    process.env.HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON = JSON.stringify({
      v1: publicJwk,
    });
    currentPrivateJwkJson = JSON.stringify(privateJwk);
  });

  afterEach(() => {
    restoreEnv("HOSTED_WEB_CALLBACK_SIGNING_KEY_ID", originalKeyId);
    restoreEnv("HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK", originalPublicJwk);
    restoreEnv(
      "HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_KEYRING_JSON",
      originalPublicKeyring,
    );
  });

  it("returns gone when a signed group-recipient callback names a deleted group", async () => {
    mocks.readHostedGroupEmailRecipients.mockResolvedValue({
      status: "unavailable",
      unavailableReason: "group_not_found",
    });

    const response = await groupRecipientsRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({ groupId: "group_123" }),
      path: HOSTED_EMAIL_GROUP_RECIPIENTS_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: "runtime_member_123",
    }));

    expect(response.status).toBe(410);
    expect(mocks.readHostedGroupEmailRecipients).toHaveBeenCalledWith({
      groupId: "group_123",
      runtimeMemberId: "runtime_member_123",
    });
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_GROUP_EMAIL_GROUP_NOT_FOUND",
        message: "Hosted group email target no longer exists.",
        retryable: false,
      },
    });
  });

  it("terminally supersedes stale group email authorization before provider entry", async () => {
    mocks.readHostedGroupEmailRecipients.mockResolvedValue({
      status: "unavailable",
      unavailableReason: "group_email_authorization_changed",
    });

    const response = await groupRecipientsRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        expectedGroupEmailAuthorizationProof: "a".repeat(64),
        groupId: "group_123",
      }),
      path: HOSTED_EMAIL_GROUP_RECIPIENTS_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: "runtime_member_123",
    }));

    expect(response.status).toBe(410);
    expect(mocks.readHostedGroupEmailRecipients).toHaveBeenCalledWith({
      expectedGroupEmailAuthorizationProof: "a".repeat(64),
      groupId: "group_123",
      runtimeMemberId: "runtime_member_123",
    });
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_GROUP_EMAIL_AUTHORIZATION_CHANGED",
        message: "Hosted group email authorization changed.",
        retryable: false,
      },
    });
  });

  it("keeps transient group-recipient authority unavailability retryable by status", async () => {
    mocks.readHostedGroupEmailRecipients.mockResolvedValue({
      status: "unavailable",
      unavailableReason: "runtime_inactive",
    });

    const response = await groupRecipientsRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({ groupId: "group_123" }),
      path: HOSTED_EMAIL_GROUP_RECIPIENTS_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: "runtime_member_123",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_GROUP_EMAIL_RECIPIENTS_UNAVAILABLE",
        message: "Hosted group email recipients are unavailable.",
        retryable: false,
      },
    });
  });

  it("passes the signed group email authorization proof to final recipient resolution", async () => {
    mocks.readHostedGroupEmailRecipients.mockResolvedValue({
      recipients: [
        { address: "member@example.test", memberId: "member_123" },
      ],
      status: "ok",
    });
    const authorizationProof = "a".repeat(64);

    const response = await groupRecipientsRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        expectedGroupEmailAuthorizationProof: authorizationProof,
        groupId: "group_123",
      }),
      path: HOSTED_EMAIL_GROUP_RECIPIENTS_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: "runtime_member_123",
    }));

    expect(response.status).toBe(200);
    expect(mocks.readHostedGroupEmailRecipients).toHaveBeenCalledWith({
      expectedGroupEmailAuthorizationProof: authorizationProof,
      groupId: "group_123",
      runtimeMemberId: "runtime_member_123",
    });
    await expect(response.json()).resolves.toEqual({
      recipients: [
        { address: "member@example.test", memberId: "member_123" },
      ],
    });
  });

  it("accepts a signed reply-alias registration callback for the bound member", async () => {
    const response = await registerReplyAliasRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        aliasKey: VALID_REPLY_ALIAS_KEY,
      }),
      path: HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: "member_123",
    }));

    expect(response.status).toBe(200);
    expect(mocks.upsertHostedMemberReplyAliasLookupKeyTx).toHaveBeenCalledWith({
      memberId: "member_123",
      prisma: prismaClient.transactionClient,
      replyAliasLookupKey: VALID_REPLY_ALIAS_KEY,
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
    });
  });

  it("rejects reply-alias registration callbacks without a non-empty alias key", async () => {
    const response = await registerReplyAliasRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({}),
      path: HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: "member_123",
    }));

    expect(response.status).toBe(400);
    expect(mocks.upsertHostedMemberReplyAliasLookupKeyTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EMAIL_REPLY_ALIAS_INVALID",
        message: "Hosted email reply alias registration requires a current-format alias key.",
        retryable: false,
      },
    });
  });

  it("rejects reply-alias registration callbacks with malformed alias keys", async () => {
    const response = await registerReplyAliasRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        aliasKey: "replyalias1234",
      }),
      path: HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: "member_123",
    }));

    expect(response.status).toBe(400);
    expect(mocks.upsertHostedMemberReplyAliasLookupKeyTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EMAIL_REPLY_ALIAS_INVALID",
        message: "Hosted email reply alias registration requires a current-format alias key.",
        retryable: false,
      },
    });
  });

  it("rejects oversized reply-alias registration bodies before callback nonce consumption", async () => {
    const response = await registerReplyAliasRoute.POST(
      new Request(`https://join.example.test${HOSTED_EMAIL_REGISTER_REPLY_ALIAS_CALLBACK_PATH}`, {
        body: JSON.stringify({
          aliasKey: "x".repeat(3_000),
        }),
        headers: {
          "content-type": "application/json; charset=utf-8",
          [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(413);
    expect(prismaClient.transactionClient.hostedWebInternalRequestNonce.create).not.toHaveBeenCalled();
    expect(mocks.upsertHostedMemberReplyAliasLookupKeyTx).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_EMAIL_REPLY_ALIAS_BODY_TOO_LARGE",
        message: "Hosted email reply alias registration body is too large.",
        retryable: false,
      },
    });
  });

  it("accepts a signed alias-route resolution callback without provider sender authentication", async () => {
    mocks.readHostedMemberIdByReplyAliasLookupKey.mockResolvedValue("member_123");

    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        aliasKey: VALID_REPLY_ALIAS_KEY,
        envelopeFrom: "owner@example.com",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Owner <owner@example.com>",
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(mocks.readHostedMemberIdByReplyAliasLookupKey).toHaveBeenCalledWith({
      prisma: prismaClient,
      replyAliasLookupKey: VALID_REPLY_ALIAS_KEY,
    });
    expect(prismaClient.hostedMember.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "member_123",
      },
    }));
    expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      userId: "member_123",
    });
  });

  it("returns userId null for alias-route resolution when the alias lookup misses", async () => {
    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        aliasKey: VALID_REPLY_ALIAS_KEY,
        authenticatedSender: AUTHENTICATED_SENDER,
        envelopeFrom: "owner@example.com",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Owner <owner@example.com>",
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(prismaClient.hostedMember.findUnique).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      userId: null,
    });
  });

  it("uses the signed alias owner instead of trusting envelope or header sender fields", async () => {
    mocks.readHostedMemberIdByReplyAliasLookupKey.mockResolvedValue("member_123");

    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        aliasKey: VALID_REPLY_ALIAS_KEY,
        authenticatedSender: AUTHENTICATED_SENDER,
        envelopeFrom: "attacker@example.com",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Attacker <attacker@example.com>",
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(mocks.readHostedMemberIdByReplyAliasLookupKey).toHaveBeenCalledWith({
      prisma: prismaClient,
      replyAliasLookupKey: VALID_REPLY_ALIAS_KEY,
    });
    expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      userId: "member_123",
    });
  });

  it("resolves signed aliases even when raw sender metadata is absent", async () => {
    mocks.readHostedMemberIdByReplyAliasLookupKey.mockResolvedValue("member_123");

    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        aliasKey: VALID_REPLY_ALIAS_KEY,
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      userId: "member_123",
    });
  });

  it("resolves signed aliases for sponsored Family members", async () => {
    mocks.readHostedMemberIdByReplyAliasLookupKey.mockResolvedValue("member_123");
    prismaClient.hostedMember.findUnique.mockResolvedValue(createHostedMemberAccessState({
      billingStatus: HostedBillingStatus.not_started,
      memberships: [
        {
          group: {
            billingStatus: HostedBillingStatus.active,
            suspendedAt: null,
          },
          status: "active",
        },
      ],
    }));

    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        aliasKey: VALID_REPLY_ALIAS_KEY,
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      userId: "member_123",
    });
  });

  it("resolves signed group route callbacks for a current grantor by verified From address", async () => {
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue({
      core: { id: "member_123" },
    });
    prismaClient.hostedGroup.findUnique.mockResolvedValue({
      members: [{ memberId: "member_123" }],
      runtimeMemberId: "group_runtime_member",
    });
    prismaClient.hostedVaultShare.findFirst.mockResolvedValue({
      grantorMemberId: "member_123",
    });

    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        envelopeFrom: "member@example.com",
        groupId: "hgrp_123",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Member <member@example.com>",
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(mocks.lookupHostedMemberByVerifiedEmailAddress).toHaveBeenCalledWith({
      address: "member@example.com",
      prisma: prismaClient,
    });
    expect(prismaClient.hostedGroup.findUnique).toHaveBeenCalledWith({
      select: {
        members: { select: { memberId: true } },
        runtimeMemberId: true,
      },
      where: { id: "hgrp_123" },
    });
    expect(prismaClient.hostedVaultShare.findFirst).toHaveBeenCalledWith({
      select: { grantorMemberId: true },
      where: {
        destinationMemberId: "group_runtime_member",
        grantorMemberId: "member_123",
        projectionKind: "group-email.v0",
        status: "granted",
      },
    });
    expect(mocks.readHostedMemberIdByReplyAliasLookupKey).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress).not.toHaveBeenCalled();
    expect(prismaClient.hostedMember.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "group_runtime_member",
      },
    }));
    await expect(response.json()).resolves.toEqual({
      userId: "group_runtime_member",
    });
  });

  it("returns userId null for signed group route callbacks from suspended grantors before runtime resolution", async () => {
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue({
      core: { id: "member_123" },
    });
    prismaClient.hostedMember.findUnique.mockResolvedValue(createHostedMemberAccessState({
      suspendedAt: new Date("2026-07-06T12:00:00.000Z"),
    }));
    prismaClient.hostedGroup.findUnique.mockResolvedValue({
      members: [{ memberId: "member_123" }],
      runtimeMemberId: "group_runtime_member",
    });
    prismaClient.hostedVaultShare.findFirst.mockResolvedValue({
      grantorMemberId: "member_123",
    });

    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        envelopeFrom: "member@example.com",
        groupId: "hgrp_123",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Member <member@example.com>",
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(prismaClient.hostedMember.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "member_123",
      },
    }));
    expect(prismaClient.hostedMember.findUnique).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      userId: null,
    });
  });

  it("returns userId null for signed group route callbacks when the From address is not verified", async () => {
    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        envelopeFrom: "member@example.com",
        groupId: "hgrp_123",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Member <member@example.com>",
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(mocks.lookupHostedMemberByVerifiedEmailAddress).toHaveBeenCalledWith({
      address: "member@example.com",
      prisma: prismaClient,
    });
    expect(prismaClient.hostedGroup.findUnique).not.toHaveBeenCalled();
    expect(prismaClient.hostedVaultShare.findFirst).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      userId: null,
    });
  });

  it("returns userId null for signed group route callbacks when the From address owner is not a current group member", async () => {
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue({
      core: { id: "outsider_member" },
    });
    prismaClient.hostedGroup.findUnique.mockResolvedValue({
      members: [{ memberId: "member_123" }],
      runtimeMemberId: "group_runtime_member",
    });

    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        envelopeFrom: "outsider@example.com",
        groupId: "hgrp_123",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Outsider <outsider@example.com>",
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(prismaClient.hostedVaultShare.findFirst).not.toHaveBeenCalled();
    expect(prismaClient.hostedMember.findUnique).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      userId: null,
    });
  });

  it("returns userId null for signed group route callbacks when the sender has revoked the group email grant", async () => {
    mocks.lookupHostedMemberByVerifiedEmailAddress.mockResolvedValue({
      core: { id: "member_123" },
    });
    prismaClient.hostedGroup.findUnique.mockResolvedValue({
      members: [{ memberId: "member_123" }],
      runtimeMemberId: "group_runtime_member",
    });
    prismaClient.hostedVaultShare.findFirst.mockResolvedValue(null);

    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        envelopeFrom: "member@example.com",
        groupId: "hgrp_123",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Member <member@example.com>",
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(prismaClient.hostedMember.findUnique).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      userId: null,
    });
  });

  it.each([
    {
      billingStatus: HostedBillingStatus.active,
      label: "suspended",
      suspendedAt: new Date("2026-04-16T12:00:00.000Z"),
    },
    {
      billingStatus: HostedBillingStatus.canceled,
      label: "canceled",
      suspendedAt: null,
    },
    {
      billingStatus: HostedBillingStatus.paused,
      label: "paused",
      suspendedAt: null,
    },
    {
      billingStatus: HostedBillingStatus.unpaid,
      label: "unpaid",
      suspendedAt: null,
    },
  ])(
    "returns userId null for alias-route resolution when the resolved member is $label",
    async ({ billingStatus, suspendedAt }) => {
      mocks.readHostedMemberIdByReplyAliasLookupKey.mockResolvedValue("member_123");
      prismaClient.hostedMember.findUnique.mockResolvedValue(createHostedMemberAccessState({
        billingStatus,
        suspendedAt,
      }));

      const response = await resolveRoute.POST(await createSignedCallbackRequest({
        body: JSON.stringify({
          aliasKey: VALID_REPLY_ALIAS_KEY,
          authenticatedSender: AUTHENTICATED_SENDER,
          envelopeFrom: "owner@example.com",
          hasRepeatedHeaderFrom: false,
          headerFrom: "Owner <owner@example.com>",
        }),
        path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
        privateJwkJson: currentPrivateJwkJson,
        userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
      }));

      expect(response.status).toBe(200);
      expect(mocks.readHostedMemberEmailAuthorization).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toEqual({
        userId: null,
      });
    },
  );

  it("accepts a signed direct-public sender resolution callback only for the fixed service principal", async () => {
    mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress.mockResolvedValue("member_456");

    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        authenticatedSender: AUTHENTICATED_SENDER,
        envelopeFrom: "owner@example.com",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Owner <owner@example.com>",
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress).toHaveBeenCalledWith({
      address: "owner@example.com",
      prisma: prismaClient,
    });
    expect(prismaClient.hostedMember.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "member_456",
      },
    }));
    await expect(response.json()).resolves.toEqual({
      userId: "member_456",
    });
  });

  it("returns userId null for direct-public sender resolution when provider authentication is absent", async () => {
    mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress.mockResolvedValue("member_456");

    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        envelopeFrom: "owner@example.com",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Owner <owner@example.com>",
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      userId: null,
    });
  });

  it("returns userId null for direct-public sender resolution when envelope and header senders do not match", async () => {
    mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress.mockResolvedValue("member_456");

    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        authenticatedSender: AUTHENTICATED_SENDER,
        envelopeFrom: "owner@example.com",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Attacker <attacker@example.com>",
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
    }));

    expect(response.status).toBe(200);
    expect(mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress).not.toHaveBeenCalled();
    expect(prismaClient.hostedMember.findUnique).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      userId: null,
    });
  });

  it.each([
    {
      billingStatus: HostedBillingStatus.active,
      label: "suspended",
      suspendedAt: new Date("2026-04-16T12:00:00.000Z"),
    },
    {
      billingStatus: HostedBillingStatus.canceled,
      label: "canceled",
      suspendedAt: null,
    },
    {
      billingStatus: HostedBillingStatus.paused,
      label: "paused",
      suspendedAt: null,
    },
    {
      billingStatus: HostedBillingStatus.unpaid,
      label: "unpaid",
      suspendedAt: null,
    },
  ])(
    "returns userId null for direct-public sender resolution when the resolved member is $label",
    async ({ billingStatus, suspendedAt }) => {
      mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress.mockResolvedValue("member_456");
      prismaClient.hostedMember.findUnique.mockResolvedValue(createHostedMemberAccessState({
        billingStatus,
        suspendedAt,
      }));

      const response = await resolveRoute.POST(await createSignedCallbackRequest({
        body: JSON.stringify({
          authenticatedSender: AUTHENTICATED_SENDER,
          envelopeFrom: "owner@example.com",
          hasRepeatedHeaderFrom: false,
          headerFrom: "Owner <owner@example.com>",
        }),
        path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
        privateJwkJson: currentPrivateJwkJson,
        userId: HOSTED_EMAIL_ROUTE_RESOLUTION_CALLBACK_USER_ID,
      }));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        userId: null,
      });
    },
  );

  it("rejects route-resolution callbacks from any non-service-principal binding", async () => {
    const response = await resolveRoute.POST(await createSignedCallbackRequest({
      body: JSON.stringify({
        envelopeFrom: "owner@example.com",
        hasRepeatedHeaderFrom: false,
        headerFrom: "Owner <owner@example.com>",
      }),
      path: HOSTED_EMAIL_RESOLVE_ROUTE_CALLBACK_PATH,
      privateJwkJson: currentPrivateJwkJson,
      userId: "member_123",
    }));

    expect(response.status).toBe(401);
    expect(mocks.readHostedMemberIdByAuthorizedDirectPublicSenderAddress).not.toHaveBeenCalled();
    expect(mocks.readHostedMemberIdByReplyAliasLookupKey).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "HOSTED_CLOUDFLARE_CALLBACK_UNAUTHORIZED",
        message: "Hosted Cloudflare callback is not authorized.",
        retryable: false,
      },
    });
  });
});

function createPrismaMock() {
  const consumedNonces = new Set<string>();
  const transactionClient = {
    hostedAccountGroupInvite: {
      count: vi.fn(async () => 0),
    },
    hostedWebInternalRequestNonce: {
      create: vi.fn(async (input: {
        data: {
          method: string;
          nonceHash: string;
          path: string;
          search: string;
          userId: string;
        };
      }) => {
        const key = [
          input.data.userId,
          input.data.method,
          input.data.path,
          input.data.search,
          input.data.nonceHash,
        ].join("|");

        if (consumedNonces.has(key)) {
          throw new Error("Nonce already consumed in test.");
        }

        consumedNonces.add(key);
        return input.data;
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  };

  return {
    $transaction: vi.fn(async (callback: (transaction: typeof transactionClient) => Promise<unknown>) =>
      callback(transactionClient)
    ),
    hostedMember: {
      findUnique: vi.fn(async (): Promise<unknown | null> => createHostedMemberAccessState({})),
    },
    hostedGroup: {
      findUnique: vi.fn(async (): Promise<unknown | null> => null),
    },
    hostedVaultShare: {
      findFirst: vi.fn(async (): Promise<unknown | null> => null),
    },
    transactionClient,
  };
}

async function createSignedCallbackRequest(input: {
  body: string;
  path: string;
  privateJwkJson: string;
  userId: string;
}): Promise<Request> {
  const headers = await createHostedCloudflareCallbackHeaders({
    keyId: "v1",
    method: "POST",
    nonce: crypto.randomUUID().replace(/-/gu, ""),
    path: input.path,
    payload: input.body,
    privateKeyJwkJson: input.privateJwkJson,
    search: "",
    timestamp: new Date().toISOString(),
    userId: input.userId,
  });

  return new Request(`https://join.example.test${input.path}`, {
    body: input.body,
    headers: {
      ...headers,
      "content-type": "application/json; charset=utf-8",
      [HOSTED_EXECUTION_USER_ID_HEADER]: input.userId,
    },
    method: "POST",
  });
}

async function createHostedCloudflareCallbackHeaders(input: {
  keyId: string;
  method: string;
  nonce: string;
  path: string;
  payload: string;
  privateKeyJwkJson: string;
  search: string;
  timestamp: string;
  userId: string;
}): Promise<Record<string, string>> {
  const key = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(input.privateKeyJwkJson) as JsonWebKey,
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    false,
    ["sign"],
  );

  const encodedPayload = encodeHostedExecutionSignedRequestPayload({
    method: input.method,
    nonce: input.nonce,
    path: input.path,
    payload: input.payload,
    search: input.search,
    timestamp: input.timestamp,
    userId: input.userId,
  });
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      {
        hash: "SHA-256",
        name: "ECDSA",
      },
      key,
      encodedPayload,
    ),
  );

  return {
    [HOSTED_EXECUTION_NONCE_HEADER]: input.nonce,
    [HOSTED_EXECUTION_SIGNING_KEY_ID_HEADER]: input.keyId,
    [HOSTED_EXECUTION_SIGNATURE_HEADER]: Buffer.from(signature).toString("base64url"),
    [HOSTED_EXECUTION_TIMESTAMP_HEADER]: input.timestamp,
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

function createHostedMemberAccessState(input: {
  billingStatus?: HostedBillingStatus;
  memberships?: Array<{
    group: {
      billingStatus: HostedBillingStatus;
      suspendedAt: Date | null;
    };
    status: string;
  }>;
  suspendedAt?: Date | null;
}) {
  return {
    accountGroupMemberships: input.memberships ?? [],
    billingStatus: input.billingStatus ?? HostedBillingStatus.active,
    suspendedAt: input.suspendedAt ?? null,
    threadContainer: null,
  };
}
