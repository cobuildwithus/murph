import type { PrismaClient } from "@prisma/client";
import {
  HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
} from "@murphai/hosted-execution/assistant-inference";
import { afterEach, describe, expect, it } from "vitest";

import { setHostedSecureBoxStringTestCodecForTests } from "@/src/lib/hosted-crypto/secure-box";
import {
  decryptHostedInferenceConnection,
  encryptHostedInferenceConnection,
} from "@/src/lib/hosted-inference/connection-crypto";
import {
  parseHostedInferenceConnectionCandidate,
} from "@/src/lib/hosted-inference/connection-policy";
import {
  deleteHostedInferenceConnection,
  readSelectedHostedInferenceConnection,
  readSelectedHostedInferenceConnectionOverride,
  replaceHostedInferenceConnection,
  setHostedInferenceConnectionSelected,
} from "@/src/lib/hosted-inference/connection-store";

const MEMBER_ID = "member_custom_inference";
const CANDIDATE = parseHostedInferenceConnectionCandidate({
  auth: {
    kind: "bearer",
    secret: "member-endpoint-secret",
  },
  contextWindowTokens: 131_072,
  endpointUrl: "https://inference.example.com/v1/responses",
  model: "glm-5.2",
  protocol: "responses",
  supportsImages: false,
});

interface TestConnectionRow {
  configEncrypted: string;
  contextWindowTokens: number;
  createdAt: Date;
  memberId: string;
  protocol: string;
  revision: number;
  selected: boolean;
  supportsImages: boolean;
  updatedAt: Date;
  verificationProfile: string;
  verifiedAt: Date;
}

afterEach(() => {
  installDefaultTestCodec();
});

describe("hosted inference connection", () => {
  it("round-trips one encrypted versioned connection", async () => {
    const encrypted = await encryptHostedInferenceConnection({
      candidate: CANDIDATE,
      memberId: MEMBER_ID,
    });

    expect(encrypted).not.toContain("member-endpoint-secret");
    await expect(decryptHostedInferenceConnection({
      memberId: MEMBER_ID,
      protocol: "responses",
      value: encrypted,
    })).resolves.toEqual({
      auth: CANDIDATE.auth,
      endpointUrl: CANDIDATE.endpointUrl,
      model: CANDIDATE.model,
      protocol: CANDIDATE.protocol,
      schema: "murph.hosted-inference-secret.v1",
    });
  });

  it("binds ciphertext to the inference lane and exact row field", async () => {
    const calls: Array<Record<string, unknown>> = [];
    setHostedSecureBoxStringTestCodecForTests({
      decrypt() {
        throw new Error("Unexpected decrypt.");
      },
      encrypt(input) {
        calls.push(input);
        return "inference-ciphertext";
      },
    });

    await encryptHostedInferenceConnection({
      candidate: CANDIDATE,
      memberId: MEMBER_ID,
    });

    expect(calls).toEqual([
      expect.objectContaining({
        aad: {
          field: "config_encrypted",
          purpose: "hosted-inference-connection",
          rowId: MEMBER_ID,
          table: "hosted_inference_connection",
        },
        lane: "hosted-inference-connection",
        scope: "hosted-inference-connection:config",
        userId: MEMBER_ID,
      }),
    ]);
  });

  it("keeps a verified replacement deselected until explicitly selected", async () => {
    const harness = createStoreHarness();

    const created = await replaceHostedInferenceConnection({
      candidate: CANDIDATE,
      expectedRevision: null,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
      verifiedAt: new Date("2026-07-30T22:00:00.000Z"),
    });
    expect(created).toMatchObject({
      revision: 1,
      selected: false,
      verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
    });
    await expect(readSelectedHostedInferenceConnection({
      memberId: MEMBER_ID,
      prisma: harness.prisma,
    })).resolves.toBeNull();

    const selected = await setHostedInferenceConnectionSelected({
      expectedRevision: 1,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
      selected: true,
    });
    expect(selected.selected).toBe(true);
    await expect(readSelectedHostedInferenceConnection({
      memberId: MEMBER_ID,
      prisma: harness.prisma,
    })).resolves.toMatchObject({
      endpointUrl: CANDIDATE.endpointUrl,
      model: CANDIDATE.model,
      revision: 1,
      selected: true,
    });
    await expect(readSelectedHostedInferenceConnectionOverride({
      memberId: MEMBER_ID,
      prisma: harness.prisma,
    })).resolves.toEqual({
      contextWindowTokens: 131_072,
      modelAlias: "murph-custom-r1",
      protocol: "responses",
      revision: 1,
      supportsImages: false,
      verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
    });

    const replaced = await replaceHostedInferenceConnection({
      candidate: {
        ...CANDIDATE,
        endpointUrl: "https://next.example.com/v1/responses",
      },
      expectedRevision: 1,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
      verifiedAt: new Date("2026-07-30T22:05:00.000Z"),
    });
    expect(replaced).toMatchObject({
      endpointHost: "next.example.com",
      revision: 2,
      selected: false,
    });
  });

  it("fails closed on stale replacement revisions", async () => {
    const harness = createStoreHarness();
    await replaceHostedInferenceConnection({
      candidate: CANDIDATE,
      expectedRevision: null,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
    });

    await expect(replaceHostedInferenceConnection({
      candidate: CANDIDATE,
      expectedRevision: 2,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_INFERENCE_CONNECTION_CONFLICT",
    });
    expect(harness.row?.revision).toBe(1);
  });

  it("never reuses a revision after delete and recreate, so stale selections conflict", async () => {
    const harness = createStoreHarness();
    await replaceHostedInferenceConnection({
      candidate: CANDIDATE,
      expectedRevision: null,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
    });
    // A Settings request observes revision 1, then a concurrent flow deletes
    // the connection and saves a different endpoint before selection commits.
    await deleteHostedInferenceConnection({
      expectedRevision: 1,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
    });
    const recreated = await replaceHostedInferenceConnection({
      candidate: {
        ...CANDIDATE,
        endpointUrl: "https://next.example.com/v1/responses",
      },
      expectedRevision: null,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
    });
    expect(recreated.revision).toBe(2);
    expect(recreated.selected).toBe(false);

    await expect(setHostedInferenceConnectionSelected({
      expectedRevision: 1,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
      selected: true,
    })).rejects.toMatchObject({
      code: "HOSTED_INFERENCE_CONNECTION_CONFLICT",
    });
    expect(harness.row?.selected).toBe(false);

    const selected = await setHostedInferenceConnectionSelected({
      expectedRevision: 2,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
      selected: true,
    });
    expect(selected.selected).toBe(true);
  });

  it("fails closed when selecting against a replaced connection revision", async () => {
    const harness = createStoreHarness();
    await replaceHostedInferenceConnection({
      candidate: CANDIDATE,
      expectedRevision: null,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
    });
    // Simulates a caller that checked eligibility against revision 1 while a
    // concurrent replacement bumped the connection to revision 2.
    await replaceHostedInferenceConnection({
      candidate: {
        ...CANDIDATE,
        endpointUrl: "https://next.example.com/v1/responses",
      },
      expectedRevision: 1,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
    });

    await expect(setHostedInferenceConnectionSelected({
      expectedRevision: 1,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
      selected: true,
    })).rejects.toMatchObject({
      code: "HOSTED_INFERENCE_CONNECTION_CONFLICT",
    });
    expect(harness.row?.selected).toBe(false);
  });

  it("rejects group-room runtime members", async () => {
    const harness = createStoreHarness({ threadContainer: true });

    await expect(replaceHostedInferenceConnection({
      candidate: CANDIDATE,
      expectedRevision: null,
      memberId: MEMBER_ID,
      prisma: harness.prisma,
    })).rejects.toMatchObject({
      code: "HOSTED_INFERENCE_PERSONAL_CHAT_REQUIRED",
    });
  });
});

function createStoreHarness(
  options: { threadContainer?: boolean } = {},
): {
  prisma: PrismaClient;
  readonly row: TestConnectionRow | null;
} {
  let row: TestConnectionRow | null = null;
  let revisionSequence = 0;
  const transactionClient = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      if (strings.join("").includes("nextval")) {
        revisionSequence += 1;
        return [{ revision: revisionSequence }];
      }
      return [];
    },
    hostedInferenceConnection: {
      delete: async () => {
        const current = row;
        row = null;
        return current;
      },
      findUnique: async () => row,
      update: async ({ data }: { data: Partial<TestConnectionRow> }) => {
        if (!row) throw new Error("Missing inference row.");
        row = {
          ...row,
          ...data,
          updatedAt: new Date("2026-07-30T22:10:00.000Z"),
        };
        return row;
      },
      upsert: async ({ create, update }: {
        create: Omit<TestConnectionRow, "createdAt" | "updatedAt">;
        update: Partial<TestConnectionRow>;
      }) => {
        if (row) {
          row = {
            ...row,
            ...update,
            updatedAt: new Date("2026-07-30T22:10:00.000Z"),
          };
        } else {
          row = {
            ...create,
            createdAt: new Date("2026-07-30T22:00:00.000Z"),
            updatedAt: new Date("2026-07-30T22:00:00.000Z"),
          };
        }
        return row;
      },
    },
    hostedMember: {
      findUnique: async () => ({
        id: MEMBER_ID,
        inferenceConnection: row,
        threadContainer: options.threadContainer ? { memberId: MEMBER_ID } : null,
      }),
    },
  };
  const prisma = {
    ...transactionClient,
    $transaction: async (callback: (tx: typeof transactionClient) => unknown) =>
      await callback(transactionClient),
  } as unknown as PrismaClient;

  return {
    prisma,
    get row() {
      return row;
    },
  };
}

function installDefaultTestCodec(): void {
  setHostedSecureBoxStringTestCodecForTests({
    decrypt(input) {
      const parsed = JSON.parse(
        Buffer.from(input.value.replace(/^hsb-test:/u, ""), "base64url")
          .toString("utf8"),
      ) as {
        lane?: string;
        scope?: string;
        userId?: string;
        value?: string;
      };
      if (
        parsed.lane !== input.lane
        || parsed.scope !== input.scope
        || parsed.userId !== input.userId
        || typeof parsed.value !== "string"
      ) {
        throw new Error("Hosted secure-box test codec metadata mismatch.");
      }
      return parsed.value;
    },
    encrypt(input) {
      return `hsb-test:${Buffer.from(JSON.stringify({
        lane: input.lane,
        scope: input.scope,
        userId: input.userId,
        value: input.value,
      }), "utf8").toString("base64url")}`;
    },
  });
}
