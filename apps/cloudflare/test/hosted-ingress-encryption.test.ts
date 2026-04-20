import { describe, expect, it } from "vitest";

import { parseHostedIngressPayload } from "@murphai/hosted-execution/parsers";

import {
  decryptHostedIngressPayloadCiphertext,
  readHostedIngressEncryptionEnvironment,
} from "../src/hosted-ingress-encryption.ts";
import {
  createHostedExecutionTestEnv,
  encryptTestHostedIngressPayload,
} from "./hosted-execution-fixtures.ts";

describe("hosted ingress encryption parity", () => {
  it("decrypts a payload emitted by the web hosted-ingress encoder", async () => {
    const environment = readHostedIngressEncryptionEnvironment(createHostedExecutionTestEnv());
    const { payloadCiphertext } = encryptTestHostedIngressPayload({
      field: "hosted-ingress-inline-payload",
      userId: "member_test",
      value: {
        eventId: "evt_test",
        kind: "member.activated",
        memberChannels: {
          email: false,
          linq: true,
          telegram: false,
        },
        occurredAt: "2026-04-19T00:00:00.000Z",
        userId: "member_test",
      },
    });

    const decryptedPayload = await decryptHostedIngressPayloadCiphertext({
      ciphertext: payloadCiphertext,
      environment,
      userId: "member_test",
    });

    expect(decryptedPayload).toEqual({
      eventId: "evt_test",
      kind: "member.activated",
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      occurredAt: "2026-04-19T00:00:00.000Z",
      userId: "member_test",
    });

    expect(parseHostedIngressPayload({
      decryptedPayload,
      kind: "member.activated",
      occurredAt: "2026-04-19T00:00:00.000Z",
      payloadSchema: "murph.hosted-ingress-execution.v1",
      userId: "member_test",
    })).toEqual({
      eventId: "evt_test",
      kind: "member.activated",
      memberChannels: {
        email: false,
        linq: true,
        telegram: false,
      },
      occurredAt: "2026-04-19T00:00:00.000Z",
      userId: "member_test",
    });
  });
});
