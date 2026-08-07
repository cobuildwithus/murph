import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  decryptHostedGroupJoinOutreachPhoneNumber,
  encryptHostedGroupJoinOutreachPhoneNumber,
} from "@/src/lib/hosted-groups/group-join-outreach-phone-codec";
import { readHostedContactPrivacyKeyring } from "@/src/lib/hosted-onboarding/env";
import {
  decryptHostedLinqDeliveryParticipantPhoneNumber,
  encryptHostedLinqDeliveryParticipantPhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-delivery-participant-phone-codec";
import {
  decryptHostedLinqLinePhoneNumber,
  encryptHostedLinqLinePhoneNumber,
} from "@/src/lib/hosted-onboarding/linq-line-phone-codec";

const PARTICIPANT_PHONE = "+15555550123";

/**
 * Independent restatement of the envelope format that existed before both phone
 * codecs shared one primitive. Key derivation and AAD bytes are part of the
 * stored format, so a refactor that changes either silently strands rows already
 * written in production. Encrypting here and decrypting through the shipped
 * codecs is what proves that did not happen.
 */
function encryptWithOriginalFormat(input: {
  aad: Record<string, unknown>;
  keyPurpose: string;
  phoneNumber: string;
  schema: string;
}): string {
  const keyring = readHostedContactPrivacyKeyring(process.env);
  const version = keyring.currentVersion;
  const keyMaterial = keyring.keysByVersion[version];
  if (!keyMaterial) {
    throw new Error("test keyring is missing its current version");
  }

  const key = createHmac("sha256", keyMaterial)
    .update(`hosted-contact-privacy:${version}:${input.keyPurpose}`)
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify({ ...input.aad, version })));
  const ciphertext = Buffer.concat([
    cipher.update(input.phoneNumber, "utf8"),
    cipher.final(),
  ]);

  return JSON.stringify({
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    schema: input.schema,
    tag: cipher.getAuthTag().toString("base64"),
    version,
  });
}

describe("hosted contact phone envelope", () => {
  it("still decrypts line phones stored in the pre-shared-codec format", () => {
    const stored = encryptWithOriginalFormat({
      aad: {
        purpose: "linq-line-phone",
        schema: "murph.hosted-linq-line-phone.v1",
      },
      keyPurpose: "linq-line-phone",
      phoneNumber: "+15555550100",
      schema: "murph.hosted-linq-line-phone.v1",
    });

    expect(decryptHostedLinqLinePhoneNumber(stored)).toBe("+15555550100");
  });

  it("still decrypts outreach phones stored in the pre-shared-codec format", () => {
    const stored = encryptWithOriginalFormat({
      aad: {
        purpose: "group-join-outreach-phone",
        rowId: "hgrpjoa_opaque",
        schema: "murph.hosted-group-join-outreach-phone.v1",
        table: "hosted_group_join_outreach",
      },
      keyPurpose: "group-join-outreach-phone",
      phoneNumber: PARTICIPANT_PHONE,
      schema: "murph.hosted-group-join-outreach-phone.v1",
    });

    expect(decryptHostedGroupJoinOutreachPhoneNumber({
      encrypted: stored,
      outreachId: "hgrpjoa_opaque",
    })).toBe(PARTICIPANT_PHONE);
  });

  it("round-trips each purpose through the shared primitive", () => {
    const line = encryptHostedLinqLinePhoneNumber("+15555550100");
    expect(line).not.toBeNull();
    expect(decryptHostedLinqLinePhoneNumber(line)).toBe("+15555550100");

    const outreach = encryptHostedGroupJoinOutreachPhoneNumber({
      outreachId: "hgrpjoa_opaque",
      phoneNumber: PARTICIPANT_PHONE,
    });
    expect(outreach).not.toContain(PARTICIPANT_PHONE);
    expect(decryptHostedGroupJoinOutreachPhoneNumber({
      encrypted: outreach,
      outreachId: "hgrpjoa_opaque",
    })).toBe(PARTICIPANT_PHONE);

    const deliveryParticipant =
      encryptHostedLinqDeliveryParticipantPhoneNumber({
        deliveryId: "hld_opaque",
        phoneNumber: PARTICIPANT_PHONE,
      });
    expect(deliveryParticipant).not.toContain(PARTICIPANT_PHONE);
    expect(decryptHostedLinqDeliveryParticipantPhoneNumber({
      deliveryId: "hld_opaque",
      encrypted: deliveryParticipant,
    })).toBe(PARTICIPANT_PHONE);
  });

  it("keeps each purpose and row isolated", () => {
    const outreach = encryptHostedGroupJoinOutreachPhoneNumber({
      outreachId: "hgrpjoa_opaque",
      phoneNumber: PARTICIPANT_PHONE,
    });

    // A row-bound envelope must not decrypt against another row.
    expect(() => decryptHostedGroupJoinOutreachPhoneNumber({
      encrypted: outreach,
      outreachId: "hgrpjoa_other",
    })).toThrow();

    // Nor may one purpose's envelope be read by another purpose's codec.
    expect(() => decryptHostedLinqLinePhoneNumber(outreach)).toThrow();

    const deliveryParticipant =
      encryptHostedLinqDeliveryParticipantPhoneNumber({
        deliveryId: "hld_opaque",
        phoneNumber: PARTICIPANT_PHONE,
      });
    expect(() => decryptHostedLinqDeliveryParticipantPhoneNumber({
      deliveryId: "hld_other",
      encrypted: deliveryParticipant,
    })).toThrow();
    expect(() => decryptHostedGroupJoinOutreachPhoneNumber({
      encrypted: deliveryParticipant,
      outreachId: "hld_opaque",
    })).toThrow();
  });

  it("classifies the delivery participant as owner metadata, blind lookup, and encrypted content only", () => {
    const schema = readFileSync(
      new URL("../prisma/schema.prisma", import.meta.url),
      "utf8",
    );
    const model = schema.match(
      /model HostedLinqDelivery \{(?<body>[\s\S]*?)\n\}/u,
    )?.groups?.body ?? "";

    expect(model).toMatch(/memberId\s+String\?\s+@map\("member_id"\)/u);
    expect(model).toMatch(
      /participantPhoneLookupKey\s+String\?\s+@map\("participant_phone_lookup_key"\)/u,
    );
    expect(model).toMatch(
      /participantPhoneEncrypted\s+String\?\s+@map\("participant_phone_encrypted"\)/u,
    );
    expect(model).not.toMatch(/participantPhone(?:Number)?\s+String/u);
  });
});
