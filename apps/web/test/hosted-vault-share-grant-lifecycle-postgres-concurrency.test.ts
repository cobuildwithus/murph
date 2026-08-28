import { randomUUID } from "node:crypto";

import {
  buildHostedVaultShareProjectionScopeKey,
  hostedVaultShareProjectionKindToScope,
} from "@murphai/hosted-execution/vault-share";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE,
} from "@/src/lib/hosted-vault-share/delivery-limits";
import {
  grantHostedVaultShareTx,
} from "@/src/lib/hosted-vault-share/share-grant-store";
import { createPrismaClient } from "@/src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const runPostgresProof =
  process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const SLEEP_SCOPE = hostedVaultShareProjectionKindToScope("sleep-times.v0");
const SLEEP_SCOPE_KEY = buildHostedVaultShareProjectionScopeKey(SLEEP_SCOPE);

if (
  runPostgresProof
  && (!databaseUrl || !isClearlyLocalPostgresUrl(databaseUrl))
) {
  throw new Error(
    "The hosted vault-share grant lifecycle proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted vault-share grant lifecycle PostgreSQL concurrency proof",
  () => {
    it("admits concurrent destinations beyond 25 and preserves exact-tuple regrant lifecycle", async () => {
      const first = createPrismaClient({ databaseUrl, poolMax: 1 });
      const second = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const suffix = randomUUID();
      const grantorMemberId = `member_vault_grantor_${suffix}`;
      const existingDestinationMemberIds = Array.from(
        {
          length:
            HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE - 1,
        },
        (_, index) =>
          `member_vault_existing_${String(index).padStart(2, "0")}_${suffix}`,
      );
      const candidateDestinationMemberIds = [
        `member_vault_candidate_a_${suffix}`,
        `member_vault_candidate_b_${suffix}`,
      ];
      const allMemberIds = [
        grantorMemberId,
        ...existingDestinationMemberIds,
        ...candidateDestinationMemberIds,
      ];

      try {
        await observer.hostedMember.createMany({
          data: allMemberIds.map((id) => ({ id })),
        });
        await observer.hostedVaultShare.createMany({
          data: existingDestinationMemberIds.map((destinationMemberId, index) => ({
            destinationMemberId,
            grantedAt: new Date("2026-08-12T12:00:00.000Z"),
            grantorMemberId,
            id: `share_vault_existing_${String(index).padStart(2, "0")}_${suffix}`,
            projectionKind: SLEEP_SCOPE.projectionKind,
            projectionScopeJson: JSON.parse(
              JSON.stringify(SLEEP_SCOPE),
            ) as Prisma.InputJsonValue,
            projectionScopeKey: SLEEP_SCOPE_KEY,
            status: "granted",
          })),
        });

        const attempts = await Promise.allSettled(
          candidateDestinationMemberIds.map((destinationMemberId, index) =>
            (index === 0 ? first : second).$transaction((tx) =>
              grantHostedVaultShareTx({
                destinationMemberId,
                grantorMemberId,
                now: new Date("2026-08-12T12:00:01.000Z"),
                projectionScope: SLEEP_SCOPE,
                tx,
              })
            )
          ),
        );

        const fulfilled = attempts.filter(
          (attempt) => attempt.status === "fulfilled",
        );
        const failureSummary = attempts.flatMap((attempt) => {
          if (attempt.status === "fulfilled") return [];
          return [attempt.reason instanceof Error
            ? `${attempt.reason.name}: ${attempt.reason.message}`
            : "Unknown rejection"];
        }).join("; ");
        expect(fulfilled, failureSummary).toHaveLength(2);
        expect(await observer.hostedVaultShare.count({
          where: {
            grantorMemberId,
            projectionScopeKey: SLEEP_SCOPE_KEY,
            status: "granted",
          },
        })).toBe(HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE + 1);
        const admittedDestinationMemberId = candidateDestinationMemberIds[0];
        if (!admittedDestinationMemberId) {
          throw new Error("Expected an admitted vault-share destination.");
        }
        await observer.hostedVaultShare.update({
          where: {
            grantorMemberId_projectionScopeKey_destinationMemberId: {
              destinationMemberId: admittedDestinationMemberId,
              grantorMemberId,
              projectionScopeKey: SLEEP_SCOPE_KEY,
            },
          },
          data: { projectionSnapshotCiphertext: "ciphertext_ready" },
        });
        await expect(observer.$transaction((tx) =>
          grantHostedVaultShareTx({
            destinationMemberId: admittedDestinationMemberId,
            grantorMemberId,
            now: new Date("2026-08-12T12:00:01.500Z"),
            projectionScope: SLEEP_SCOPE,
            refreshMaterializedProjection: true,
            tx,
          })
        )).resolves.toMatchObject({ requiresProjection: true });
        expect(await observer.hostedVaultShare.count({
          where: {
            grantorMemberId,
            projectionScopeKey: SLEEP_SCOPE_KEY,
            status: "granted",
          },
        })).toBe(HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE + 1);
      } finally {
        await observer.hostedVaultShare.deleteMany({
          where: { grantorMemberId },
        });
        await observer.hostedMember.deleteMany({
          where: { id: { in: allMemberIds } },
        });
        await Promise.all([
          first.$disconnect(),
          second.$disconnect(),
          observer.$disconnect(),
        ]);
      }
    });
  },
);

function isClearlyLocalPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["postgres:", "postgresql:"].includes(url.protocol)
      && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}
