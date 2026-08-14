import type { PrismaClient } from "@prisma/client";

import { HOSTED_USER_ASSERTION_FIRST_INVALID_OFFSET_SECONDS } from "../device-sync/auth";
import { getPrisma } from "../prisma";
import {
  HOSTED_RETENTION_BATCH_SIZE,
  HOSTED_RETENTION_MAX_BATCHES,
} from "./cleanup";

// Legacy rows persisted the signed integer-second expiry rather than the shared
// first-invalid instant. Subtracting the verifier allowance keeps those rows
// through their complete historical acceptance horizon. New rows already store
// first-invalid time and are intentionally retained for one extra allowance.
export async function deleteExpiredHostedBrowserAssertionNonces(input: {
  now: Date;
  prisma?: Pick<PrismaClient, "$executeRaw">;
}): Promise<number> {
  const prisma = input.prisma ?? getPrisma();
  const cleanupCutoff = new Date(
    input.now.getTime()
      - HOSTED_USER_ASSERTION_FIRST_INVALID_OFFSET_SECONDS * 1000,
  );

  let deleted = 0;
  for (let batch = 0; batch < HOSTED_RETENTION_MAX_BATCHES; batch += 1) {
    const count = await prisma.$executeRaw`
      WITH doomed AS MATERIALIZED (
        SELECT browser_nonce."nonce_hash"
        FROM "device_browser_assertion_nonce" AS browser_nonce
        WHERE browser_nonce."expires_at" <= ${cleanupCutoff}
        ORDER BY
          browser_nonce."expires_at" ASC,
          browser_nonce."nonce_hash" ASC
        LIMIT ${HOSTED_RETENTION_BATCH_SIZE}
        FOR UPDATE OF browser_nonce SKIP LOCKED
      )
      DELETE FROM "device_browser_assertion_nonce" AS browser_nonce
      USING doomed
      WHERE browser_nonce."nonce_hash" = doomed."nonce_hash"
    `;
    deleted += count;
    if (count < HOSTED_RETENTION_BATCH_SIZE) {
      break;
    }
  }

  return deleted;
}
