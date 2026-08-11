import type { PrismaClient } from "@prisma/client";

export interface HostedCallbackRequestNonceStore {
  consumeHostedCallbackRequestNonce(input: {
    expiresAt: string;
    method: string;
    nonceHash: string;
    now: string;
    path: string;
    search: string;
    userId: string;
  }): Promise<boolean>;
}

export class PrismaHostedCallbackRequestNonceStore
  implements HostedCallbackRequestNonceStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async consumeHostedCallbackRequestNonce(input: {
    expiresAt: string;
    method: string;
    nonceHash: string;
    now: string;
    path: string;
    search: string;
    userId: string;
  }): Promise<boolean> {
    // Keep the volatile clock read in RETURNING so it runs only for an insert
    // that succeeds after any unique-conflict wait; a late row is a tombstone.
    const rows = await this.prisma.$queryRaw<Array<{ admitted: boolean }>>`
      INSERT INTO "hosted_web_internal_request_nonce" AS request_nonce (
        "nonce_hash",
        "user_id",
        "method",
        "path",
        "search",
        "created_at",
        "expires_at"
      )
      VALUES (
        ${input.nonceHash},
        ${input.userId},
        ${input.method},
        ${input.path},
        ${input.search},
        ${input.now}::timestamptz AT TIME ZONE 'UTC',
        ${input.expiresAt}::timestamptz AT TIME ZONE 'UTC'
      )
      ON CONFLICT ("nonce_hash") DO NOTHING
      RETURNING
        request_nonce."expires_at" >= date_trunc(
          'milliseconds',
          clock_timestamp() AT TIME ZONE 'UTC'
        ) AS "admitted"
    `;

    return rows[0]?.admitted === true;
  }
}

export type HostedWebInternalRequestNonceStore = HostedCallbackRequestNonceStore;
export const PrismaHostedWebInternalRequestNonceStore = PrismaHostedCallbackRequestNonceStore;
