import { beforeEach, expect, test } from "vitest";
import {
  buildHostedSecureBoxAad, HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA,
  openHostedSecureBox, parseSerializedHostedSecureBoxEnvelope,
  type HostedDomainRootKeyEnvelopeV1,
} from "@murphai/runtime-state";
import { getHostedDomainRootUnwrapCache, runWithHostedDomainRootUnwrapCache } from "../src/lib/hosted-crypto/domain-root-unwrap-cache";
import { setHostedSecureBoxStringTestCodecForTests } from "../src/lib/hosted-crypto/secure-box";
import { encryptHostedWebNullableStringFromPreparedRoot } from "../src/lib/hosted-web/encryption";
import { HOSTED_MEMBER_LINQ_PARTICIPANT_CONTACT_FIELD } from "../src/lib/hosted-onboarding/member-private-codecs";

beforeEach(() => setHostedSecureBoxStringTestCodecForTests(null));

test("Linq participant ciphertext retains authenticated member binding when copied to identity", async () => {
  const userId = "member-participant-source";
  const rootKeyId = "udrk:control:participant-source";
  const rootKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const field = HOSTED_MEMBER_LINQ_PARTICIPANT_CONTACT_FIELD;
  const scope = `hosted-member-private-field:${field}`;
  const envelope: HostedDomainRootKeyEnvelopeV1 = {
    authoritySignature: {
      alg: "GCP-KMS-EC-P256-SHA256", keyVersionName: "test-key-version",
      signedAt: "2026-08-11T18:00:00.000Z", signature: "test-signature",
    },
    createdAt: "2026-08-11T18:00:00.000Z", updatedAt: "2026-08-11T18:00:00.000Z",
    domain: "control", generation: 1, rootKeyId,
    schema: HOSTED_DOMAIN_ROOT_KEY_ENVELOPE_SCHEMA, userId, wraps: [],
  };
  await runWithHostedDomainRootUnwrapCache(async () => {
    const root = Promise.resolve({ envelope, rootKey: Uint8Array.from(rootKey) });
    getHostedDomainRootUnwrapCache()?.set(`${userId}|control|${rootKeyId}`, root);
    const ciphertext = await encryptHostedWebNullableStringFromPreparedRoot({
      field, memberId: userId, prepared: { preparedRoot: root, preparedRootKeyId: rootKeyId }, value: "participant@example.test",
    });
    const open = (memberId: string, boundField: string) => openHostedSecureBox({
      aad: buildHostedSecureBoxAad({
        domain: "control", lane: "hosted-member-private-field", scope,
        tenant: "murph-hosted", userId: memberId,
        field: boundField, purpose: "hosted-member-private-field", rowId: memberId, table: "hosted_member",
      }),
      envelope: parseSerializedHostedSecureBoxEnvelope(ciphertext ?? ""),
      expectedDomain: "control", expectedLane: "hosted-member-private-field",
      expectedRootKeyId: rootKeyId, expectedScope: scope, rootKey,
    });
    const plaintext = await open(userId, field);
    try {
      expect(new TextDecoder().decode(plaintext)).toBe("participant@example.test");
    } finally {
      plaintext.fill(0);
    }
    await expect(open("member-other", field)).rejects.toThrow();
    await expect(open(userId, "hosted-member-email-authorization.verified-email")).rejects.toThrow();
  });
  rootKey.fill(0);
});
