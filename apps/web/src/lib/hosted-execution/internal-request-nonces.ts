import type { PrismaClient } from "@prisma/client";

import { isUniqueViolation } from "../device-sync/prisma-store/prisma-errors";

export interface HostedWebInternalRequestNonceStore {
  consumeHostedWebInternalRequestNonce(input: {
    expiresAt: string;
    method: string;
    nonceHash: string;
    now: string;
    path: string;
    search: string;
    userId: string;
  }): Promise<boolean>;
}

export class PrismaHostedWebInternalRequestNonceStore
  implements HostedWebInternalRequestNonceStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async consumeHostedWebInternalRequestNonce(input: {
    expiresAt: string;
    method: string;
    nonceHash: string;
    now: string;
    path: string;
    search: string;
    userId: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.hostedWebInternalRequestNonce.deleteMany({
        where: {
          expiresAt: {
            lte: new Date(input.now),
          },
        },
      });

      try {
        await tx.hostedWebInternalRequestNonce.create({
          data: {
            createdAt: new Date(input.now),
            expiresAt: new Date(input.expiresAt),
            method: input.method,
            nonceHash: input.nonceHash,
            path: input.path,
            search: input.search,
            userId: input.userId,
          },
        });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) {
          return false;
        }

        throw error;
      }
    });
  }
}
