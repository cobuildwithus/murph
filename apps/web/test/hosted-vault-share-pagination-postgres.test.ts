import { randomUUID } from "node:crypto";

import {
  buildHostedVaultShareProjectionScopeKey,
  hostedVaultShareProjectionKindToScope,
} from "@murphai/hosted-execution/vault-share";
import { describe, expect, it } from "vitest";

import {
  HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE,
} from "@/src/lib/hosted-vault-share/delivery-limits";
import {
  findActiveHostedVaultSharePage,
} from "@/src/lib/hosted-vault-share/projection-store";
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
    "The hosted vault-share pagination proof requires a local DATABASE_URL.",
  );
}

describe.skipIf(!runPostgresProof)(
  "hosted vault-share pagination PostgreSQL proof",
  () => {
    it("does not skip an unprocessed destination when regrant changes its generation id", async () => {
      const prisma = createPrismaClient({ databaseUrl, poolMax: 1 });
      const suffix = randomUUID();
      const grantorMemberId = `member_vault_grantor_${suffix}`;
      const destinationMemberIds = Array.from(
        { length: HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE + 1 },
        (_, index) =>
          `member_vault_destination_${String(index + 1).padStart(3, "0")}_${suffix}`,
      );
      const shareIds = destinationMemberIds.map((_, index) =>
        `share_vault_${String(index + 1).padStart(3, "0")}_${suffix}`
      );
      const lastDestinationMemberId =
        destinationMemberIds[destinationMemberIds.length - 1];
      const lastShareId = shareIds[shareIds.length - 1];
      if (!lastDestinationMemberId || !lastShareId) {
        await prisma.$disconnect();
        throw new Error("Expected the one-over vault-share fixture.");
      }
      const regrantedShareId = `share_vault_000_${suffix}`;

      try {
        await prisma.hostedMember.createMany({
          data: [grantorMemberId, ...destinationMemberIds].map((id) => ({ id })),
        });
        await prisma.hostedVaultShare.createMany({
          data: destinationMemberIds.map((destinationMemberId, index) => ({
            destinationMemberId,
            grantedAt: new Date("2026-08-12T12:00:00.000Z"),
            grantorMemberId,
            id: shareIds[index] ?? `share_vault_fallback_${index}_${suffix}`,
            projectionKind: SLEEP_SCOPE.projectionKind,
            projectionScopeJson: SLEEP_SCOPE,
            projectionScopeKey: SLEEP_SCOPE_KEY,
            status: "granted",
          })),
        });

        const firstPage = await findActiveHostedVaultSharePage({
          grantorMemberId,
          prisma,
          projectionScope: SLEEP_SCOPE,
        });
        expect(firstPage.shares).toHaveLength(
          HOSTED_VAULT_SHARE_DELIVER_MAX_SHARES_PER_PAGE,
        );

        await prisma.hostedVaultShare.update({
          data: {
            id: regrantedShareId,
            projectionSnapshotCiphertext: null,
          },
          where: { id: lastShareId },
        });

        await expect(findActiveHostedVaultSharePage({
          continuation: firstPage.continuation,
          grantorMemberId,
          prisma,
          projectionScope: SLEEP_SCOPE,
        })).resolves.toMatchObject({
          continuation: null,
          shares: [
            expect.objectContaining({
              destinationMemberId: lastDestinationMemberId,
              id: regrantedShareId,
            }),
          ],
        });
      } finally {
        await prisma.hostedMember.deleteMany({
          where: { id: { in: [grantorMemberId, ...destinationMemberIds] } },
        });
        await prisma.$disconnect();
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
