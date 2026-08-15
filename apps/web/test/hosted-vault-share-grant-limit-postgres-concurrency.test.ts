import { randomUUID } from "node:crypto";

import {
  buildHostedVaultShareProjectionScopeKey,
  hostedVaultShareProjectionKindToScope,
} from "@murphai/hosted-execution/vault-share";
import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION,
} from "@/src/lib/hosted-vault-share/delivery-limits";
import {
  findActiveHostedVaultShares,
} from "@/src/lib/hosted-vault-share/projection-store";
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
    "The hosted vault-share grant-limit proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted vault-share grant-limit PostgreSQL concurrency proof",
  () => {
    it("atomically admits only the 25th grant and fails closed on a corrupt 26th row", async () => {
      const first = createPrismaClient({ databaseUrl, poolMax: 1 });
      const second = createPrismaClient({ databaseUrl, poolMax: 1 });
      const observer = createPrismaClient({ databaseUrl, poolMax: 1 });
      const suffix = randomUUID();
      const grantorMemberId = `member_vault_grantor_${suffix}`;
      const existingDestinationMemberIds = Array.from(
        {
          length:
            HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION - 1,
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
        expect(fulfilled, failureSummary).toHaveLength(1);
        const rejected = attempts.filter(
          (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
        );
        expect(rejected).toHaveLength(1);
        expect(rejected[0]?.reason).toMatchObject({
          code: "HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_REACHED",
          httpStatus: 409,
        });
        expect(await observer.hostedVaultShare.count({
          where: {
            grantorMemberId,
            projectionScopeKey: SLEEP_SCOPE_KEY,
            status: "granted",
          },
        })).toBe(HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION);
        const admittedDestinationMemberId = candidateDestinationMemberIds[
          attempts.findIndex((attempt) => attempt.status === "fulfilled")
        ];
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
        })).toBe(HOSTED_GROUP_VAULT_SHARE_GRANT_LIMIT_PER_GRANTOR_PROJECTION);

        const rejectedAttemptIndex = attempts.findIndex(
          (attempt) => attempt.status === "rejected",
        );
        const corruptDestinationMemberId =
          candidateDestinationMemberIds[rejectedAttemptIndex];
        if (!corruptDestinationMemberId) {
          throw new Error("Expected a rejected vault-share destination.");
        }
        await observer.hostedVaultShare.create({
          data: {
            destinationMemberId: corruptDestinationMemberId,
            grantedAt: new Date("2026-08-12T12:00:02.000Z"),
            grantorMemberId,
            id: `share_vault_corrupt_${suffix}`,
            projectionKind: SLEEP_SCOPE.projectionKind,
            projectionScopeJson: JSON.parse(
              JSON.stringify(SLEEP_SCOPE),
            ) as Prisma.InputJsonValue,
            projectionScopeKey: SLEEP_SCOPE_KEY,
            status: "granted",
          },
        });
        await expect(findActiveHostedVaultShares({
          grantorMemberId,
          prisma: observer,
          projectionScope: SLEEP_SCOPE,
        })).rejects.toMatchObject({
          code: "HOSTED_VAULT_SHARE_GRANT_LIMIT_INVARIANT_VIOLATION",
          httpStatus: 503,
        });
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
