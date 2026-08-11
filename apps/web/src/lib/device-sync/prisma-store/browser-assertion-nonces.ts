import type { PrismaClient } from "@prisma/client";

export class PrismaHostedBrowserAssertionNonceStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async consumeBrowserAssertionNonce(input: {
    nonceHash: string;
    userId: string;
    method: string;
    path: string;
    now: string;
    expiresAt: string;
  }): Promise<boolean> {
    // Keep the volatile clock read in RETURNING so it runs only for an insert
    // that succeeds after any unique-conflict wait; a late row is a tombstone.
    const rows = await this.prisma.$queryRaw<Array<{ admitted: boolean }>>`
      INSERT INTO "device_browser_assertion_nonce" AS browser_nonce (
        "nonce_hash",
        "user_id",
        "method",
        "path",
        "created_at",
        "expires_at"
      )
      VALUES (
        ${input.nonceHash},
        ${input.userId},
        ${input.method},
        ${input.path},
        ${input.now}::timestamptz AT TIME ZONE 'UTC',
        ${input.expiresAt}::timestamptz AT TIME ZONE 'UTC'
      )
      ON CONFLICT ("nonce_hash") DO NOTHING
      RETURNING
        browser_nonce."expires_at" > date_trunc(
          'milliseconds',
          clock_timestamp() AT TIME ZONE 'UTC'
        ) AS "admitted"
    `;

    return rows[0]?.admitted === true;
  }
}
