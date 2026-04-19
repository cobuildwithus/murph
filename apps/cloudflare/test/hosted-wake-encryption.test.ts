import { describe, expect, it } from "vitest";

import { parseHostedWakeExecutionPayload } from "@murphai/hosted-execution/parsers";

import {
  decryptHostedWakePayloadCiphertext,
  readHostedWakeEncryptionEnvironment,
} from "../src/hosted-wake-encryption.ts";
import { createHostedExecutionTestEnv } from "./hosted-execution-fixtures.ts";

const WEB_GENERATED_MEMBER_ACTIVATION_CIPHERTEXT =
  "hbds:v1:kFI8rTMA3_QuTqNE:_Kg31cbv19HdJ8A41HHcDQ:RUZg0HRjhsmwZrJZ7szNeH1Ge2RAO4u5hDVWgqkOJx1yRDatK51Vk1rSTh5b5MPmwE_jWlnYm_mQnmf-2_bCVwHAlPoiuwcFopMb_tSxFe6GbaSIYtJWS6P_4CE-rnvI0JwG_0qcrgCMpCyt7KK14DEkjupj1rdsGy9a8r6NxjC99dO2-Ioqg4VPRu3pQvXtxkq3rPsKqYuj02of6PrqgPDAERMWLmAcFrhsNn8";

describe("hosted wake encryption parity", () => {
  it("decrypts a payload emitted by the web hosted-wake encoder", async () => {
    const environment = readHostedWakeEncryptionEnvironment(createHostedExecutionTestEnv());

    const decryptedPayload = await decryptHostedWakePayloadCiphertext({
      ciphertext: WEB_GENERATED_MEMBER_ACTIVATION_CIPHERTEXT,
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

    expect(parseHostedWakeExecutionPayload({
      decryptedPayload,
      kind: "member.activated",
      occurredAt: "2026-04-19T00:00:00.000Z",
      payloadSchema: "murph.hosted-wake-execution.v1",
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
