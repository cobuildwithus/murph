import {
  buildHostedSecureBoxAad,
  getHostedCryptoDomainForLane,
  openHostedSecureBox,
  parseSerializedHostedSecureBoxEnvelope,
  sealHostedSecureBox,
  serializeHostedSecureBoxEnvelope,
  type HostedCryptoLane,
  type HostedSecureBoxAadFields,
} from "@murphai/runtime-state";

import { unwrapHostedDomainRootForWeb } from "./domain-root-store";

const WEB_SEAL_LANES = new Set<HostedCryptoLane>([
  "hosted-member-private-field",
  "device-sync-external-account-id",
  "device-sync-token",
  "mailbox-payload",
  "email-raw",
]);

export async function encryptHostedWebString(input: {
  aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "tenant" | "userId">;
  lane: HostedCryptoLane;
  scope: string;
  userId: string;
  value: string | null | undefined;
}): Promise<string | null> {
  if (input.value === null || input.value === undefined) {
    return null;
  }
  if (!WEB_SEAL_LANES.has(input.lane)) {
    throw new Error(`Web is not allowed to encrypt hosted ${input.lane} values.`);
  }
  const domain = getHostedCryptoDomainForLane(input.lane);
  const { envelope, rootKey } = await unwrapHostedDomainRootForWeb({
    domain,
    userId: input.userId,
  });
  const aad = buildHostedSecureBoxAad({
    ...input.aad,
    domain,
    lane: input.lane,
    scope: input.scope,
    tenant: "murph-hosted",
    userId: input.userId,
  });
  return serializeHostedSecureBoxEnvelope(
    await sealHostedSecureBox({
      aad,
      domain,
      lane: input.lane,
      plaintext: new TextEncoder().encode(input.value),
      rootKey,
      rootKeyId: envelope.rootKeyId,
      scope: input.scope,
    }),
  );
}

export async function decryptHostedWebString(input: {
  aad: Omit<HostedSecureBoxAadFields, "domain" | "lane" | "tenant" | "userId">;
  lane: HostedCryptoLane;
  scope: string;
  userId: string;
  value: string | null | undefined;
}): Promise<string | null> {
  if (input.value === null || input.value === undefined || input.value.trim().length === 0) {
    return null;
  }
  if (!WEB_SEAL_LANES.has(input.lane)) {
    throw new Error(`Web is not allowed to decrypt hosted ${input.lane} values.`);
  }
  const serializedEnvelope = parseSerializedHostedSecureBoxEnvelope(input.value);
  const domain = getHostedCryptoDomainForLane(input.lane);
  if (serializedEnvelope.domain !== domain) {
    throw new Error(`Hosted secure-box envelope domain mismatch for lane ${input.lane}.`);
  }
  const { envelope, rootKey } = await unwrapHostedDomainRootForWeb({
    domain,
    userId: input.userId,
  });
  if (serializedEnvelope.rootKeyId !== envelope.rootKeyId) {
    throw new Error("Hosted secure-box root rotation is not implemented in greenfield hard-cut mode.");
  }
  const aad = buildHostedSecureBoxAad({
    ...input.aad,
    domain,
    lane: input.lane,
    scope: input.scope,
    tenant: "murph-hosted",
    userId: input.userId,
  });
  const plaintext = await openHostedSecureBox({
    aad,
    envelope: serializedEnvelope,
    expectedDomain: domain,
    expectedLane: input.lane,
    expectedRootKeyId: envelope.rootKeyId,
    expectedScope: input.scope,
    rootKey,
  });
  return new TextDecoder().decode(plaintext);
}
